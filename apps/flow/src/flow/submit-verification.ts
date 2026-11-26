/**
 * Sends one attempt of a verification step: create (or reuse) the verification, upload each
 * captured image by kind, then submit it for processing. Progress is kept in a mutable record,
 * so a retry after a failed request resumes where it stopped instead of creating another
 * verification (which would use up an attempt) or uploading the same image twice.
 */
import type {
  CreateFlowVerificationBody,
  FileKind,
  FlowVerificationResource,
} from '@openverify/contracts';
import { FlowApiError, type FlowApiClient } from '../api/flow-api-client';
import { captureMethodOf } from '../lib/capture-methods';

export interface SubmissionProgress {
  /** The verification being filled, once created (or the `initiated` one being reused). */
  verificationId: string | null;
  /** Kinds already uploaded to that verification. */
  readonly uploaded: Set<FileKind>;
}

export function newSubmissionProgress(verificationId: string | null): SubmissionProgress {
  return { verificationId, uploaded: new Set() };
}

/** The API type a verification is created with (C50.1); every step creates its own. */
export type VerificationApiType = CreateFlowVerificationBody['type'];

export interface SubmitVerificationOptions {
  readonly client: FlowApiClient;
  /** The image steps: their files are uploaded before the submit. */
  readonly type: 'government-id' | 'selfie';
  /** Images in upload order. */
  readonly files: readonly (readonly [FileKind, Blob])[];
  readonly progress: SubmissionProgress;
  readonly signal?: AbortSignal;
}

/**
 * A create whose outcome the client cannot read: its answer never arrived (a timeout or a network
 * error), so it may or may not have reached the server; or it came back 2xx with a body the
 * contract does not describe, so the server made the verification but the answer cannot be used
 * (2E follow-up). The flow API has no idempotency key: only the session can say what was made.
 */
const isUnreadCreate = (error: unknown): error is FlowApiError =>
  error instanceof FlowApiError &&
  (error.kind === 'timeout' || error.kind === 'network' || error.kind === 'invalid-response');

/** Progress whose create got no usable answer and could not be checked yet. */
const unconfirmedCreates = new WeakSet<SubmissionProgress>();

/**
 * The newest verification of `type` when it is `initiated`: after a create whose answer was lost
 * or unreadable, the one that request created (one that existed before would have been reused
 * from the start).
 */
async function initiatedVerification(
  client: FlowApiClient,
  type: VerificationApiType,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const { verifications } = await client.getSession(signal);
  const latest = verifications.filter(({ type: kind }) => kind === `verification/${type}`).at(-1);
  return latest?.attributes.status === 'initiated' ? latest.id : undefined;
}

/**
 * Creates the verification, at most once per progress record (Workflow 2D F018). When the answer
 * is lost (a timeout or a network error) or unreadable (a 2xx with an unexpected body, the 2E
 * follow-up), the server may have created it, and a second create would use up another attempt:
 * the session says whether it did. When the session cannot be read either, the original error
 * stands and the next attempt reads it first.
 */
async function createOnce(
  client: FlowApiClient,
  type: VerificationApiType,
  progress: SubmissionProgress,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (unconfirmedCreates.has(progress)) {
    const created = await initiatedVerification(client, type, signal);
    unconfirmedCreates.delete(progress);
    if (created !== undefined) {
      return created;
    }
  }
  try {
    return (await client.createVerification({ type }, signal)).id;
  } catch (error) {
    if (!isUnreadCreate(error)) {
      throw error;
    }
    unconfirmedCreates.add(progress);
    const created = await initiatedVerification(client, type, signal).catch(() => undefined);
    if (created === undefined) {
      throw error;
    }
    unconfirmedCreates.delete(progress);
    return created;
  }
}

/**
 * The verification `progress` is filling: the one already started, or a new one, created at most
 * once (see `createOnce`). The selfie capture protocol and the Phase 5 steps (C64.1) create
 * their verification this way too.
 */
export async function ensureVerification(
  client: FlowApiClient,
  type: VerificationApiType,
  progress: SubmissionProgress,
  signal?: AbortSignal,
): Promise<string> {
  progress.verificationId ??= await createOnce(client, type, progress, signal);
  return progress.verificationId;
}

/** Uploads every image and submits the verification; rejects with the first API error. */
export async function submitVerification({
  client,
  type,
  files,
  progress,
  signal,
}: SubmitVerificationOptions): Promise<FlowVerificationResource> {
  const verificationId = await ensureVerification(client, type, progress, signal);
  for (const [kind, file] of files) {
    if (!progress.uploaded.has(kind)) {
      // C153.2: the client-reported capture method, when the photo says how it was taken.
      const method = captureMethodOf(file);
      await (method === undefined
        ? client.uploadFile(verificationId, kind, file, signal)
        : client.uploadFile(verificationId, kind, file, signal, undefined, method));
      progress.uploaded.add(kind);
    }
  }
  return client.submitVerification(verificationId, signal);
}
