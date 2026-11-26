/**
 * The C40 selfie capture on the API (Workflow 4A Stage 3, api-flow): one camera or upload
 * session of a selfie verification, issued with a nonce, an expiry and ordered pose prompts.
 *
 * - The nonce is 128 bits from a CSPRNG, returned once and stored only as its SHA-256; every
 *   comparison is `timingSafeEqual` over SHA-256 digests (C40.2, C40.4).
 * - The `selfie` resource (C40.1) is the payload of the `selfie.*` events and of
 *   `GET /api/v1/selfies/:id`; it never carries the nonce or device data.
 * - Every write runs in the caller's transaction under the C40.6 lock order (the inquiry with
 *   its `redacted_at` re-checked, then the verification, then the capture).
 */
import { createHash, randomBytes, randomInt as cryptoRandomInt, timingSafeEqual } from 'node:crypto';
import {
  buildSelfieCaptureResource,
  SELFIE_CAPTURE_GUIDANCE_DEFAULTS,
  verificationConfigSchema,
  type SelfieCaptureDocument,
  type SelfieCaptureGuidance,
  type SelfieCaptureResource,
  type SelfiePose,
  type SelfieVerificationDetails,
} from '@openverify/contracts';
import { selfiePoseDetectionConfigSchema } from '@openverify/core';
import {
  errorOpenSelfieCaptures,
  getSelfieCapture,
  listSelfieCaptures,
  selfieCapturePromptTimings,
  type Db,
  type SelfieCapture,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import { AppError, NotFoundError } from '../errors.js';
import type { FileStorage } from '../ports.js';
import { deleteRenditionsForFilesInTx } from './cases/attachments/renditions.js';

/** A CSPRNG integer in `[0, max)`. */
export type RandomInt = (max: number) => number;

/** The `selfie.*` events (C40.8). */
export type SelfieEventName =
  | 'selfie.created'
  | 'selfie.submitted'
  | 'selfie.processed'
  | 'selfie.errored';

/** A C40 problem `code` (`SELFIE_CAPTURE_PROBLEM_CODES`). */
export type SelfieCaptureProblemCode =
  | 'selfie_capture_limit'
  | 'selfie_capture_incomplete'
  | 'selfie_capture_invalid'
  | 'selfie_capture_required';

/** 409 with a C40 problem `code`, which the flow and Android act on. */
export class SelfieCaptureConflictError extends AppError {
  override name = 'SelfieCaptureConflictError';

  constructor(code: SelfieCaptureProblemCode, detail: string) {
    super({ status: 409, detail, code });
  }
}

/**
 * C40.4: the one body for a wrong nonce and for a foreign, superseded, expired or consumed
 * capture, so the answer tells nothing about which it was.
 */
export function selfieCaptureInvalid(): SelfieCaptureConflictError {
  return new SelfieCaptureConflictError(
    'selfie_capture_invalid',
    'The selfie capture cannot be used; start a new capture.',
  );
}

/**
 * C40.2: the prompts of a new capture, `center` first; with `liveness: active` the step's side
 * poses follow in an order drawn with `randomInt` (a CSPRNG by default, Fisher-Yates), with
 * `passive` in the step's order. A stored step that lists `center` later, or not at all (before
 * the publish-time rule), still prompts it first.
 */
export function selfieCapturePrompts(
  step: { poses: readonly SelfiePose[]; liveness: 'passive' | 'active' },
  randomInt: RandomInt = cryptoRandomInt,
): SelfiePose[] {
  const sides: SelfiePose[] = step.poses.filter((pose) => pose !== 'center');
  if (step.liveness === 'active') {
    for (let index = sides.length - 1; index > 0; index -= 1) {
      const other = randomInt(index + 1);
      const held = sides[index];
      const drawn = sides[other];
      if (held !== undefined && drawn !== undefined) {
        sides[index] = drawn;
        sides[other] = held;
      }
    }
  }
  return ['center', ...sides];
}

/** SHA-256 of a nonce, the only form it is stored in. */
export function nonceDigest(nonce: string): Uint8Array {
  return createHash('sha256').update(nonce, 'utf8').digest();
}

/** C40.2: a new nonce, 128 bits from a CSPRNG as 22 base64url characters, and its digest. */
export function newSelfieCaptureNonce(): { nonce: string; digest: Uint8Array } {
  const nonce = randomBytes(16).toString('base64url');
  return { nonce, digest: nonceDigest(nonce) };
}

/** A digest no nonce has, compared against when there is no capture, so timing says nothing. */
const NO_CAPTURE_DIGEST = new Uint8Array(32);

/**
 * C40.4: whether `nonce` is the one whose digest is stored, by `timingSafeEqual` over the two
 * SHA-256 digests. With no stored digest (no such capture), the comparison still runs and fails.
 */
export function nonceMatches(stored: Uint8Array | null, nonce: string): boolean {
  const presented = nonceDigest(nonce);
  const expected = stored?.byteLength === 32 ? stored : NO_CAPTURE_DIGEST;
  return timingSafeEqual(presented, expected) && stored !== null;
}

/**
 * C40.2 `guidance`: the pose thresholds of the pinned version's `selfie_pose_detection` config,
 * else the provisional defaults (C39.3, C40.11), and the client's hold time.
 */
export function selfieCaptureGuidance(verificationConfig: unknown): SelfieCaptureGuidance {
  const parsed = verificationConfigSchema.safeParse(verificationConfig);
  const raw = parsed.success
    ? parsed.data.selfie?.checks.selfie_pose_detection?.config
    : undefined;
  const config = selfiePoseDetectionConfigSchema.safeParse(raw ?? {});
  const values = config.success ? config.data : {};
  return {
    'max-center-yaw-ratio':
      values['max-center-yaw-ratio'] ?? SELFIE_CAPTURE_GUIDANCE_DEFAULTS['max-center-yaw-ratio'],
    'min-side-yaw-ratio-change':
      values['min-side-yaw-ratio-change'] ??
      SELFIE_CAPTURE_GUIDANCE_DEFAULTS['min-side-yaw-ratio-change'],
    'hold-ms': SELFIE_CAPTURE_GUIDANCE_DEFAULTS['hold-ms'],
  };
}

/** The `selfie` resource of a capture, with its `prompt-timings` (C40.1). */
export async function selfieCaptureResourceOf(
  db: Db,
  capture: SelfieCapture,
): Promise<SelfieCaptureResource> {
  return buildSelfieCaptureResource({
    ...capture,
    promptTimings: await selfieCapturePromptTimings(db, capture.environmentId, capture.id),
  });
}

/** Stages a `selfie.*` event with the capture resource as its payload, in `tx` (C40.8). */
export async function stageSelfieEvent(
  tx: Db,
  events: TransactionalEventPublisher,
  name: SelfieEventName,
  capture: SelfieCapture,
): Promise<StagedEvent> {
  return events.stage(tx, {
    environmentId: capture.environmentId,
    name,
    payload: { data: await selfieCaptureResourceOf(tx, capture) },
  });
}

/** What erroring a verification's open capture leaves to do once the transaction commits. */
export interface ErroredCaptures {
  /** One `selfie.errored` per capture, to dispatch. */
  staged: StagedEvent[];
  /** The storage objects of the capture's deleted file rows, to delete (best effort). */
  storageKeys: string[];
}

/**
 * C40.2: moves the verification's open capture to `errored` with `errorCode` (`superseded`,
 * `expired` or `canceled`), deletes its file rows, and stages `selfie.errored`, in `tx`. The
 * objects of the deleted rows are returned for deletion after commit; one whose delete fails is
 * crypto-shredded, since its wrapped data key went with the row.
 */
export async function errorOpenSelfieCaptureInTx(
  tx: Db,
  events: TransactionalEventPublisher,
  environmentId: string,
  verificationId: string,
  errorCode: 'superseded' | 'expired' | 'canceled',
): Promise<ErroredCaptures> {
  const { captures, files } = await errorOpenSelfieCaptures(
    tx,
    environmentId,
    verificationId,
    errorCode,
  );
  const staged: StagedEvent[] = [];
  for (const capture of captures) {
    staged.push(await stageSelfieEvent(tx, events, 'selfie.errored', capture));
  }
  // C135.3 (Stage 1a amendment 9; `api-case-files`): the deleted files' rendition pages go too.
  const renditionKeys = await deleteRenditionsForFilesInTx(tx, {
    environmentId,
    fileIds: files.map((file) => file.id),
  });
  return { staged, storageKeys: [...files.map((file) => file.storageKey), ...renditionKeys] };
}

/**
 * Deletes the given storage objects, best effort: a failure leaves a crypto-shredded object.
 * Returns how many could not be deleted.
 */
export async function deleteObjects(storage: FileStorage, keys: readonly string[]): Promise<number> {
  let failed = 0;
  for (const key of keys) {
    await storage.delete(key).catch(() => {
      failed += 1;
    });
  }
  return failed;
}

/**
 * C40.1 `GET /api/v1/selfies/:id`.
 * @throws {NotFoundError} when the capture is not in this environment.
 */
export async function getSelfieCaptureDocument(
  db: Db,
  environmentId: string,
  id: string,
): Promise<SelfieCaptureDocument> {
  const capture = await getSelfieCapture(db, environmentId, id);
  if (capture === null) {
    throw new NotFoundError(`Selfie capture ${id} was not found.`);
  }
  return { data: await selfieCaptureResourceOf(db, capture) };
}

/**
 * C40.1, C40.10: a selfie verification's captures as its resource shows them, from `captures`
 * (newest first, any verification): their ids, and the one submit consumed (`submitted`, or
 * `processed` once the worker is done), whose method, liveness and prompts the attributes show.
 */
export function selfieDetailsOf(
  captures: readonly SelfieCapture[],
  verificationId: string,
): SelfieVerificationDetails {
  const own = captures.filter((capture) => capture.verificationId === verificationId);
  const consumed = own.find(
    (capture) => capture.status === 'processed' || capture.status === 'submitted',
  );
  return {
    captureIds: own.map((capture) => capture.id),
    capture:
      consumed === undefined
        ? null
        : { method: consumed.method, liveness: consumed.liveness, prompts: consumed.prompts },
  };
}

/** {@link selfieDetailsOf} one verification, read from `db`. */
export async function selfieDetailsForVerification(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<SelfieVerificationDetails> {
  return selfieDetailsOf(
    await listSelfieCaptures(db, environmentId, { verificationId }),
    verificationId,
  );
}

/** The `selfie` resources of `captures`, in their order. */
export async function selfieCaptureResources(
  db: Db,
  captures: readonly SelfieCapture[],
): Promise<SelfieCaptureResource[]> {
  const resources: SelfieCaptureResource[] = [];
  for (const capture of captures) {
    resources.push(await selfieCaptureResourceOf(db, capture));
  }
  return resources;
}
