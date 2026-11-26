/**
 * Test helpers for the C40 selfie capture protocol on the flow API: a consented session with a
 * selfie verification, then create, per-pose upload and submit, as the hosted flow and Android
 * call them. Only tests import this file. Every image is the harness's synthetic bytes.
 */
import {
  CLIENT_ELAPSED_MS_FIELD,
  defaultInquiryTemplateAttributes,
  flowSelfieCaptureDocumentSchema,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  SELFIE_POSE_FILE_KINDS,
  type CreateInquiryTemplateAttributes,
  type SelfieDeviceSnapshot,
  type SelfiePose,
} from '@openverify/contracts';
import type { LightMyRequestResponse } from 'fastify';
import {
  bearer,
  createTemplate,
  expectStatus,
  IMAGES,
  multipart,
  openFlowSession,
  type MultipartFile,
  type TestApi,
} from '../../test-support/harness.js';

export const FLOW = '/api/v1/flow';
export const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

/** A capture as the flow holds it: id, nonce and prompts. */
export interface HeldCapture {
  id: string;
  nonce: string;
  prompts: SelfiePose[];
  expiresAt: string;
}

/** A fresh, distinct JPEG for each pose, so no two files share a digest. */
export function poseImage(seed: number): Uint8Array {
  const bytes = new Uint8Array(IMAGES.jpeg.length + 4);
  bytes.set(IMAGES.jpeg);
  new DataView(bytes.buffer).setUint32(IMAGES.jpeg.length, seed);
  return bytes;
}

let seed = 1;
const nextImage = () => poseImage((seed += 1));

export interface SelfieFlow {
  inquiryId: string;
  sessionToken: string;
  verificationId: string;
}

/**
 * C151.4 (Workflow 9A): only the current step accepts a verification, so these templates put the
 * selfie step right after consent; the steps after it are the default flow's.
 */
export function selfieAfterConsent(attributes: CreateInquiryTemplateAttributes): void {
  // The default template's flow is v1 (amendment 27): its steps are one array type.
  const steps = attributes.flow.steps as unknown[] as { type: string }[];
  const index = steps.findIndex((candidate) => candidate.type === 'selfie');
  const [selfie] = index < 0 ? [] : steps.splice(index, 1);
  if (selfie !== undefined) {
    steps.splice(steps[0]?.type === 'consent' ? 1 : 0, 0, selfie);
  }
}

/** The template with `change` applied to its selfie step (and anything else). */
export async function templateWithSelfie(
  api: TestApi,
  change: (
    step: Extract<CreateInquiryTemplateAttributes['flow']['steps'][number], { type: 'selfie' }>,
    attributes: CreateInquiryTemplateAttributes,
  ) => void,
  token = api.token,
): Promise<string> {
  const attributes = defaultInquiryTemplateAttributes();
  const step = attributes.flow.steps.find((candidate) => candidate.type === 'selfie');
  if (step?.type !== 'selfie') {
    throw new Error('the default template has a selfie step');
  }
  change(step, attributes);
  selfieAfterConsent(attributes);
  return createTemplate(api, token, attributes);
}

/** A session that consented, with a selfie verification ready for a capture. */
export async function selfieFlow(
  api: TestApi,
  options: { templateId?: string; token?: string; consent?: boolean } = {},
): Promise<SelfieFlow> {
  const { inquiryId, sessionToken } = await openFlowSession(api, {
    templateId:
      options.templateId ??
      (await templateWithSelfie(api, () => undefined, options.token ?? api.token)),
    ...(options.token === undefined ? {} : { token: options.token }),
  });
  if (options.consent !== false) {
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `${FLOW}/consent`,
        headers: bearer(sessionToken),
        payload: CONSENT_BODY,
      }),
      201,
    );
  }
  const created = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `${FLOW}/verifications`,
      headers: bearer(sessionToken),
      payload: { type: 'selfie' },
    }),
    201,
  );
  return { inquiryId, sessionToken, verificationId: created.data.id };
}

/** `POST /flow/verifications/:id/selfies`. */
export function postCapture(
  api: TestApi,
  flow: Pick<SelfieFlow, 'sessionToken' | 'verificationId'>,
  method: 'camera' | 'upload' = 'camera',
): Promise<LightMyRequestResponse> {
  return api.app.inject({
    method: 'POST',
    url: `${FLOW}/verifications/${flow.verificationId}/selfies`,
    headers: bearer(flow.sessionToken),
    payload: { method },
  });
}

/** Creates a capture and returns what the flow keeps of it. */
export async function createCapture(
  api: TestApi,
  flow: Pick<SelfieFlow, 'sessionToken' | 'verificationId'>,
  method: 'camera' | 'upload' = 'camera',
): Promise<HeldCapture> {
  const response = await postCapture(api, flow, method);
  if (response.statusCode !== 201) {
    throw new Error(`expected HTTP 201, got ${String(response.statusCode)}: ${response.body}`);
  }
  const { data } = flowSelfieCaptureDocumentSchema.parse(response.json());
  return {
    id: data.id,
    nonce: data.attributes.nonce,
    prompts: [...data.attributes.prompts],
    expiresAt: data.attributes['expires-at'],
  };
}

/** `POST /flow/verifications/:id/files` with the given fields (capture fields first, as clients send them). */
export async function uploadFields(
  api: TestApi,
  flow: Pick<SelfieFlow, 'sessionToken' | 'verificationId'>,
  fields: Readonly<Record<string, string | MultipartFile>>,
): Promise<LightMyRequestResponse> {
  const { payload, headers } = await multipart(fields);
  return api.app.inject({
    method: 'POST',
    url: `${FLOW}/verifications/${flow.verificationId}/files`,
    headers: { ...bearer(flow.sessionToken), ...headers },
    payload,
  });
}

/** Uploads one pose of `capture`, with the client's elapsed time. */
export function uploadPose(
  api: TestApi,
  flow: Pick<SelfieFlow, 'sessionToken' | 'verificationId'>,
  capture: Pick<HeldCapture, 'id' | 'nonce'>,
  pose: SelfiePose,
  options: { elapsedMs?: number; bytes?: Uint8Array; nonce?: string } = {},
): Promise<LightMyRequestResponse> {
  return uploadFields(api, flow, {
    kind: SELFIE_POSE_FILE_KINDS[pose],
    [SELFIE_CAPTURE_ID_FIELD]: capture.id,
    [SELFIE_CAPTURE_NONCE_FIELD]: options.nonce ?? capture.nonce,
    [CLIENT_ELAPSED_MS_FIELD]: String(options.elapsedMs ?? 1000),
    file: { bytes: options.bytes ?? nextImage() },
  });
}

/** Uploads every prompted pose of `capture`, in prompt order. */
export async function uploadAllPoses(
  api: TestApi,
  flow: Pick<SelfieFlow, 'sessionToken' | 'verificationId'>,
  capture: HeldCapture,
): Promise<void> {
  let elapsedMs = 800;
  for (const pose of capture.prompts) {
    expectStatus(await uploadPose(api, flow, capture, pose, { elapsedMs }), 201);
    elapsedMs += 1500;
  }
}

/** `POST /flow/verifications/:id/submit` naming `capture` (or with `body` as given). */
export function submitCapture(
  api: TestApi,
  flow: Pick<SelfieFlow, 'sessionToken' | 'verificationId'>,
  capture: Pick<HeldCapture, 'id' | 'nonce'> | null,
  device?: SelfieDeviceSnapshot,
): Promise<LightMyRequestResponse> {
  return api.app.inject({
    method: 'POST',
    url: `${FLOW}/verifications/${flow.verificationId}/submit`,
    headers: bearer(flow.sessionToken),
    ...(capture === null
      ? {}
      : {
          payload: {
            capture: {
              id: capture.id,
              nonce: capture.nonce,
              ...(device === undefined ? {} : { device }),
            },
          },
        }),
  });
}

/** The `code` member of a problem response. */
export function problemCode(response: LightMyRequestResponse): string | undefined {
  return response.json<{ code?: string }>().code;
}
