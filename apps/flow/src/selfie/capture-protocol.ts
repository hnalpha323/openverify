/**
 * The selfie capture protocol on the client (C40): create (or reuse) the verification and create
 * the capture before the first prompt; upload each pose with the capture id, the nonce and the
 * elapsed time as soon as it is taken; submit naming the capture, with the device snapshot. The
 * nonce lives in memory only: after a reload, or a 409 `selfie_capture_invalid`, the client
 * creates a new capture and starts the prompts again.
 */
import {
  CLIENT_ELAPSED_MS_MAX,
  SELFIE_POSE_FILE_KINDS,
  type CreateSelfieCaptureBody,
  type FlowVerificationResource,
  type SelfieCaptureGuidance,
  type SelfieDeviceSnapshot,
  type SelfiePose,
} from '@openverify/contracts';
import { FlowApiError, type CaptureMethod, type FlowApiClient } from '../api/flow-api-client';
import { ensureVerification, type SubmissionProgress } from '../flow/submit-verification';

/** A capture the client holds: its id, nonce and prompts, never written anywhere. */
export interface OpenCapture {
  readonly id: string;
  readonly nonce: string;
  /** The poses to prompt, in the server's order (`center` first). */
  readonly prompts: readonly SelfiePose[];
  readonly expiresAt: string;
  readonly guidance: SelfieCaptureGuidance;
  /** The client's clock (`performance.now()`) when the create answer arrived. */
  readonly openedAt: number;
}

export interface OpenSelfieCaptureOptions {
  readonly client: FlowApiClient;
  readonly progress: SubmissionProgress;
  readonly method: CreateSelfieCaptureBody['method'];
  readonly now: () => number;
  readonly signal?: AbortSignal;
}

/** Creates (or reuses) the verification, then creates a capture on it. */
export async function openSelfieCapture({
  client,
  progress,
  method,
  now,
  signal,
}: OpenSelfieCaptureOptions): Promise<{
  readonly verificationId: string;
  readonly capture: OpenCapture;
}> {
  const verificationId = await ensureVerification(client, 'selfie', progress, signal);
  const { id, attributes } = await client.createSelfieCapture(verificationId, { method }, signal);
  return {
    verificationId,
    capture: {
      id,
      nonce: attributes.nonce,
      prompts: attributes.prompts,
      expiresAt: attributes['expires-at'],
      guidance: attributes.guidance,
      openedAt: now(),
    },
  };
}

/** Milliseconds since the capture was opened, as the upload field takes them (C40.3). */
export function clientElapsedMs(capture: Pick<OpenCapture, 'openedAt'>, now: number): number {
  return Math.min(Math.max(Math.round(now - capture.openedAt), 0), CLIENT_ELAPSED_MS_MAX);
}

export interface UploadSelfiePoseOptions {
  readonly client: FlowApiClient;
  readonly verificationId: string;
  readonly capture: OpenCapture;
  readonly pose: SelfiePose;
  readonly photo: Blob;
  readonly now: () => number;
  readonly signal?: AbortSignal;
  /** C153.2 (Workflow 9A): how the photo was taken, reported with the upload. */
  readonly captureMethod?: CaptureMethod;
}

/** Uploads one pose of the capture. */
export async function uploadSelfiePose({
  client,
  verificationId,
  capture,
  pose,
  photo,
  now,
  signal,
  captureMethod,
}: UploadSelfiePoseOptions): Promise<void> {
  const fields = {
    captureId: capture.id,
    nonce: capture.nonce,
    clientElapsedMs: clientElapsedMs(capture, now()),
  };
  await (captureMethod === undefined
    ? client.uploadFile(verificationId, SELFIE_POSE_FILE_KINDS[pose], photo, signal, fields)
    : client.uploadFile(
        verificationId,
        SELFIE_POSE_FILE_KINDS[pose],
        photo,
        signal,
        fields,
        captureMethod,
      ));
}

export interface SubmitSelfieCaptureOptions {
  readonly client: FlowApiClient;
  readonly verificationId: string;
  readonly capture: Pick<OpenCapture, 'id' | 'nonce'>;
  readonly device?: SelfieDeviceSnapshot;
  readonly signal?: AbortSignal;
}

/** Submits the verification, naming the capture (C40.4). */
export async function submitSelfieCapture({
  client,
  verificationId,
  capture,
  device,
  signal,
}: SubmitSelfieCaptureOptions): Promise<FlowVerificationResource> {
  return client.submitVerification(verificationId, signal, {
    capture: {
      id: capture.id,
      nonce: capture.nonce,
      ...(device === undefined ? {} : { device }),
    },
  });
}

export type CaptureFailure =
  /** The capture can no longer be used (wrong nonce, expired, superseded, incomplete): open a new one. */
  | 'capture-invalid'
  /** The verification reached its capture limit and was canceled: the session starts a new attempt. */
  | 'capture-limit'
  /** Some other 409: the verification moved on; the session knows where the user is. */
  | 'conflict'
  | 'other';

const BY_CODE: ReadonlyMap<string, CaptureFailure> = new Map([
  ['selfie_capture_invalid', 'capture-invalid'],
  // Every prompt has a file before submit, so an incomplete capture lost one: start again.
  ['selfie_capture_incomplete', 'capture-invalid'],
  ['selfie_capture_limit', 'capture-limit'],
]);

/** What a failed capture request means for the flow. */
export function captureFailure(error: unknown): CaptureFailure {
  if (!(error instanceof FlowApiError) || error.kind !== 'http' || error.status !== 409) {
    return 'other';
  }
  const code = error.problem?.code;
  return (code === undefined ? undefined : BY_CODE.get(code)) ?? 'conflict';
}
