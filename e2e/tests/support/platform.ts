/**
 * Phase 2 spec helpers: the `@openverify/node` client (C18) as a customer backend uses it,
 * with every response recorded so specs can read platform headers (C12); the dashboard API
 * (C4, C15) as the dashboard BFF calls it; and the flow API (C3, C10) as the hosted flow calls
 * it, without a browser.
 */
import { readFile } from 'node:fs/promises';
import {
  createInquiryTemplateAttributesSchema,
  flowSessionResponseSchema,
  flowVerificationDocumentSchema,
  type DefaultInquiryTemplateAttributes,
  type FlowSessionResponse,
  type FlowVerificationResource,
} from '@openverify/contracts';
import { createClient, type OpenVerifyClient } from '@openverify/node';
import { FIXTURES } from '../../src/paths.js';
import type { StackInfo } from '../../src/stack-info.js';

export interface RecordedResponse {
  method: string;
  url: string;
  status: number;
  headers: Headers;
}

export interface RecordingClient {
  client: OpenVerifyClient;
  /** Every response, oldest first. */
  responses: RecordedResponse[];
  /** The latest response. */
  last: () => RecordedResponse;
}

/**
 * A server API client for an API key or a dashboard user session token. It never retries, so
 * an error answer reaches the spec as it was sent.
 */
export function recordingClient(apiUrl: string, token: string): RecordingClient {
  const responses: RecordedResponse[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    responses.push({
      method: init?.method ?? 'GET',
      url,
      status: response.status,
      headers: response.headers,
    });
    return response;
  };
  return {
    client: createClient({ apiKey: token, baseUrl: apiUrl, fetch: recordingFetch, maxRetries: 0 }),
    responses,
    last: () => {
      const response = responses.at(-1);
      if (response === undefined) {
        throw new Error('No request was sent yet');
      }
      return response;
    },
  };
}

/** The C7 default template's attributes, under another name. */
export async function defaultTemplateAttributes(
  name: string,
): Promise<DefaultInquiryTemplateAttributes> {
  // The default template is flow-spec 1 (Workflow 9A: a version's flow is either version).
  const parsed = createInquiryTemplateAttributesSchema.parse(
    JSON.parse(await readFile(FIXTURES.defaultTemplate, 'utf8')),
  ) as DefaultInquiryTemplateAttributes;
  return { ...parsed, name };
}

export interface JsonAnswer {
  status: number;
  headers: Headers;
  body: unknown;
}

async function jsonAnswer(response: Response): Promise<JsonAnswer> {
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? null : (JSON.parse(text) as unknown),
  };
}

/** One dashboard API request (`/api/v1/dashboard<path>`), with the session token if given. */
export async function dashboardRequest(
  stack: StackInfo,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<JsonAnswer> {
  return jsonAnswer(
    await fetch(`${stack.apiUrl}/api/v1/dashboard${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
}

/**
 * Signs an operator without MFA in through the dashboard API and returns the `ovu_` session
 * token, which the server API also accepts (C12).
 */
export async function signInToApi(
  stack: StackInfo,
  credentials: { email: string; password: string },
): Promise<string> {
  const answer = await dashboardRequest(stack, 'POST', '/sessions', { body: credentials });
  if (answer.status !== 201) {
    throw new Error(`Sign-in answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
  }
  return (answer.body as { token: string }).token;
}

/** The flow API (`/api/v1/flow`) with one session token, as the hosted flow calls it. */
export function flowApi(apiUrl: string, sessionToken: string) {
  const call = async (method: 'GET' | 'POST', path: string, body?: BodyInit, json = true) =>
    jsonAnswer(
      await fetch(`${apiUrl}/api/v1/flow${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${sessionToken}`,
          ...(json && body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body === undefined ? {} : { body }),
      }),
    );
  const expectOk = (answer: JsonAnswer, what: string) => {
    if (answer.status < 200 || answer.status > 299) {
      throw new Error(`${what} answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
    }
    return answer.body;
  };
  return {
    async session(): Promise<FlowSessionResponse> {
      return flowSessionResponseSchema.parse(expectOk(await call('GET', '/session'), 'session'));
    },
    async consent(textKeys: readonly string[]): Promise<void> {
      expectOk(
        await call(
          'POST',
          '/consent',
          JSON.stringify({ accepted: true, 'text-keys': textKeys, locale: 'en' }),
        ),
        'consent',
      );
    },
    async createVerification(type: 'government-id' | 'selfie'): Promise<string> {
      const body = expectOk(
        await call('POST', '/verifications', JSON.stringify({ type })),
        'create verification',
      );
      return (body as { data: { id: string } }).data.id;
    },
    /** Uploads one image file; returns the file id. */
    async upload(verificationId: string, kind: string, file: string): Promise<string> {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', new Blob([await readFile(file)], { type: 'image/jpeg' }), 'upload.jpg');
      const body = expectOk(
        await call('POST', `/verifications/${verificationId}/files`, form, false),
        'upload',
      );
      return (body as { data: { id: string } }).data.id;
    },
    /** `POST /flow/verifications/:id/submit`, as the hosted flow sends it once the files are in. */
    async submit(verificationId: string): Promise<FlowVerificationResource> {
      const answer = await call('POST', `/verifications/${verificationId}/submit`);
      if (answer.status !== 202) {
        throw new Error(`submit answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
      }
      return flowVerificationDocumentSchema.parse(answer.body).data;
    },
    /** `GET /flow/verifications/:id`: the status and retry hints the hosted flow polls. */
    async verification(verificationId: string): Promise<FlowVerificationResource> {
      return flowVerificationDocumentSchema.parse(
        expectOk(await call('GET', `/verifications/${verificationId}`), 'verification'),
      ).data;
    },
  };
}

export type FlowApi = ReturnType<typeof flowApi>;

/** Accepts the consent texts the session's consent step names, as the hosted flow does. */
export async function giveFlowConsent(flow: FlowApi): Promise<void> {
  const consent = (await flow.session()).flow.steps.find((step) => step.type === 'consent');
  await flow.consent(consent?.type === 'consent' ? consent.textKeys : []);
}

/**
 * The hosted flow's government ID step without a browser: a new verification, both sides
 * uploaded, then submitted for the checks. Returns the verification id.
 */
export async function submitGovernmentId(
  flow: FlowApi,
  sides: { front: string; back: string },
): Promise<string> {
  const verificationId = await flow.createVerification('government-id');
  await flow.upload(verificationId, 'front', sides.front);
  await flow.upload(verificationId, 'back', sides.back);
  await flow.submit(verificationId);
  return verificationId;
}

/** Polls the flow API until the verification is decided, and returns its flow view. */
export async function settledFlowVerification(
  flow: FlowApi,
  verificationId: string,
  timeoutMs = 120_000,
): Promise<FlowVerificationResource> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const verification = await flow.verification(verificationId);
    if (!['initiated', 'confirmed', 'submitted'].includes(verification.attributes.status)) {
      return verification;
    }
    if (Date.now() > deadline) {
      throw new Error(`${verificationId} was still ${verification.attributes.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** A redeemed one-time link or session-token request, raw (C10). */
export async function redeemOneTimeLink(
  apiUrl: string,
  body: { 'inquiry-id': string; 'one-time-token': string },
): Promise<JsonAnswer> {
  return jsonAnswer(
    await fetch(`${apiUrl}/api/v1/flow/one-time-links/redeem`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
