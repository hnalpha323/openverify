/**
 * Workflow 5B spec helpers (C52, C60, C61, C62, C65.5): an inquiry prefilled with fields, the
 * flow API calls a client makes for a document, a business, a selfie uploaded as stills (the
 * sandbox upload fallback, C19, C46.1) and a chip (C62.5, as a Phase 10 reader will send it), and
 * what the console's API serves of an inquiry's files. Every value a spec sends is synthetic.
 */
import { readFile } from 'node:fs/promises';
import {
  CLIENT_ELAPSED_MS_FIELD,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  SELFIE_POSE_FILE_KINDS,
  dashboardInquiryDocumentSchema,
  flowChipChallengeResponseSchema,
  flowSelfieCaptureDocumentSchema,
  type CreateInquiryTemplateAttributes,
  type SelfiePose,
} from '@openverify/contracts';
import type { StackInfo } from '../../src/stack-info.js';
import { dashboardRequest, recordingClient } from './platform.js';

/** A new inquiry on a new template, prefilled with `fields` (C52.8's references, C60.6). */
export async function startPrefilledInquiry(
  stack: StackInfo,
  template: CreateInquiryTemplateAttributes,
  referenceId: string,
  fields: Readonly<Record<string, string>> = {},
): Promise<{ inquiryId: string; flowUrl: string; sessionToken: string }> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: created } = await client.inquiryTemplates.create(template);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': created.id,
    'reference-id': referenceId,
    fields,
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  return {
    inquiryId: inquiry.id,
    flowUrl: resumed.meta['flow-url'],
    sessionToken: resumed.meta['session-token'],
  };
}

interface FlowAnswer {
  status: number;
  body: unknown;
}

/** The flow API with one session token, for the 5B steps. */
export function phase5bFlow(stack: StackInfo, sessionToken: string) {
  const send = async (path: string, init: { body?: BodyInit; json?: unknown } = {}) => {
    const response = await fetch(`${stack.apiUrl}/api/v1/flow${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        accept: 'application/json',
        ...(init.json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text === '' ? null : (JSON.parse(text) as unknown),
    } satisfies FlowAnswer;
  };
  const expected = (answer: FlowAnswer, status: number, what: string): unknown => {
    if (answer.status !== status) {
      throw new Error(`${what} answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
    }
    return answer.body;
  };
  const upload = async (
    verificationId: string,
    kind: string,
    bytes: Uint8Array,
    fields: Readonly<Record<string, string>> = {},
  ): Promise<string> => {
    const form = new FormData();
    form.append('kind', kind);
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, value);
    }
    form.append('file', new Blob([new Uint8Array(bytes)]), 'upload.bin');
    const body = expected(
      await send(`/verifications/${verificationId}/files`, { body: form }),
      201,
      `upload ${kind}`,
    );
    return (body as { data: { id: string } }).data.id;
  };
  return {
    /** `POST /verifications`; returns the verification id. */
    async create(type: string): Promise<string> {
      const body = expected(
        await send('/verifications', { json: { type } }),
        201,
        `create ${type}`,
      );
      return (body as { data: { id: string } }).data.id;
    },
    /** C52.3: `POST /verifications/:id/inputs`. */
    async enterInputs(verificationId: string, values: Readonly<Record<string, unknown>>) {
      expected(
        await send(`/verifications/${verificationId}/inputs`, { json: values }),
        200,
        'inputs',
      );
    },
    upload,
    /** `POST /verifications/:id/submit`, with the type's body when it takes one. */
    async submit(verificationId: string, body?: unknown): Promise<void> {
      expected(
        await send(
          `/verifications/${verificationId}/submit`,
          body === undefined ? {} : { json: body },
        ),
        202,
        'submit',
      );
    },
    /**
     * A selfie verification uploaded as stills: an `upload` capture (the sandbox fallback), each
     * prompted pose's file in the server's order, then submitted with the capture.
     */
    async submitSelfie(stills: (pose: SelfiePose) => string): Promise<string> {
      const verificationId = await this.create('selfie');
      const capture = flowSelfieCaptureDocumentSchema.parse(
        expected(
          await send(`/verifications/${verificationId}/selfies`, { json: { method: 'upload' } }),
          201,
          'selfie capture',
        ),
      ).data;
      let elapsed = 800;
      for (const pose of capture.attributes.prompts) {
        await upload(verificationId, SELFIE_POSE_FILE_KINDS[pose], await readFile(stills(pose)), {
          [SELFIE_CAPTURE_ID_FIELD]: capture.id,
          [SELFIE_CAPTURE_NONCE_FIELD]: capture.attributes.nonce,
          [CLIENT_ELAPSED_MS_FIELD]: String(elapsed),
        });
        elapsed += 1_500;
      }
      await this.submit(verificationId, {
        capture: { id: capture.id, nonce: capture.attributes.nonce },
      });
      return verificationId;
    },
    /** C62.5: `POST /verifications/:id/chip-challenges`. */
    async chipChallenge(verificationId: string) {
      return flowChipChallengeResponseSchema.parse(
        expected(
          await send(`/verifications/${verificationId}/chip-challenges`, { json: {} }),
          201,
          'chip challenge',
        ),
      );
    },
  };
}

/** The files the console's API lists for an inquiry's verifications, with their kinds (C4). */
export async function consoleFiles(
  stack: StackInfo,
  token: string,
  inquiryId: string,
): Promise<{ id: string; kind: string; mimeType: string; verificationId: string }[]> {
  const answer = await dashboardRequest(stack, 'GET', `/inquiries/${inquiryId}`, { token });
  if (answer.status !== 200) {
    throw new Error(`the console inquiry answered ${String(answer.status)}`);
  }
  const document = dashboardInquiryDocumentSchema.parse(answer.body);
  return document.included.flatMap((resource) =>
    resource.type === 'file'
      ? [
          {
            id: resource.id,
            kind: resource.attributes.kind,
            mimeType: resource.attributes['mime-type'],
            verificationId: resource.relationships.verification.data.id,
          },
        ]
      : [],
  );
}

/** `GET /dashboard/files/:id/content` (C4, C52.4): the status, the headers and the bytes. */
export async function consoleFileContent(stack: StackInfo, token: string, fileId: string) {
  const response = await fetch(`${stack.apiUrl}/api/v1/dashboard/files/${fileId}/content`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}
