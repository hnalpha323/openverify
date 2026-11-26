/**
 * C40.4, C52.6: the selfie's submit, unchanged from Phase 4. A selfie names its capture
 * (`{ capture: { id, nonce, device? } }`), and one created since Phase 4 must (409
 * `selfie_capture_required`, C40.7). Under the C40.6 locks the capture is checked
 * (`selfie_capture_invalid` for a wrong nonce or a foreign, superseded, consumed or expired
 * capture, one body for all) and complete (`selfie_capture_incomplete`), then consumed once
 * (`consumeSelfieCapture`) with its device snapshot sealed, and `selfie.submitted` is staged
 * before `verification.submitted`. A repeated submit must name the capture that submitted it. A
 * selfie without a capture (before Phase 4) needs its required files.
 */
import {
  SELFIE_POSE_FILE_KINDS,
  sanitizeDeviceLabel,
  type FlowSubmitVerificationBody,
  type SelfieDeviceSnapshot,
} from '@openverify/contracts';
import { consumeSelfieCapture, lockSelfieCapture, type LockedSelfieCapture } from '@openverify/db';
import {
  nonceMatches,
  SelfieCaptureConflictError,
  selfieCaptureInvalid,
  stageSelfieEvent,
} from '../selfie-captures.js';
import type { SubmitGuard } from './index.js';
import { assertOnlyMember, assertRequiredFiles } from './standard.js';

/** The capture a selfie submit names (C40.4). */
type SubmittedCapture = NonNullable<FlowSubmitVerificationBody['capture']>;

/**
 * C40.4: the device snapshot as it is sealed: the label without control or bidirectional
 * characters and cut to `DEVICE_LABEL_MAX_LENGTH`; every other member was bounded by the schema.
 */
function sanitizedDevice(
  device: SelfieDeviceSnapshot | undefined,
): SelfieDeviceSnapshot | undefined {
  return device?.label === undefined
    ? device
    : { ...device, label: sanitizeDeviceLabel(device.label) };
}

/**
 * C40.4: whether `capture` (read with its nonce digest, `null` when the scoped lookup found
 * none) can be consumed at `now`.
 * @throws {SelfieCaptureConflictError} `selfie_capture_invalid` otherwise, one body for all.
 */
function assertCaptureOpen(
  capture: LockedSelfieCapture | null,
  presented: SubmittedCapture,
  now: Date,
): asserts capture is LockedSelfieCapture {
  const nonceOk = nonceMatches(capture?.nonceSha256 ?? null, presented.nonce);
  if (
    capture === null ||
    !nonceOk ||
    capture.status !== 'initiated' ||
    capture.expiresAt.getTime() <= now.getTime()
  ) {
    throw selfieCaptureInvalid();
  }
}

/**
 * C40.4 completeness: every prompt of the capture has a file stored under it.
 * @throws {SelfieCaptureConflictError} `selfie_capture_incomplete` naming the missing poses.
 */
function assertCaptureComplete(
  capture: LockedSelfieCapture,
  files: readonly { kind: string; selfieCaptureId: string | null }[],
): void {
  const missing = capture.prompts.filter(
    (pose) =>
      !files.some(
        (file) => file.kind === SELFIE_POSE_FILE_KINDS[pose] && file.selfieCaptureId === capture.id,
      ),
  );
  if (missing.length > 0) {
    throw new SelfieCaptureConflictError(
      'selfie_capture_incomplete',
      `The capture has no file for: ${missing.join(', ')}.`,
    );
  }
}

export const selfieSubmit: SubmitGuard = {
  submittableStatuses: ['initiated'],
  checkBody(ctx) {
    assertOnlyMember(ctx, 'capture');
    if (ctx.verification.selfieCaptureRequired && ctx.body?.capture === undefined) {
      throw new SelfieCaptureConflictError(
        'selfie_capture_required',
        'A selfie is submitted with its capture: create one, upload each pose, then submit it.',
      );
    }
  },
  async inTransaction(ctx) {
    const capture = ctx.body?.capture;
    if (capture === undefined) {
      assertRequiredFiles(ctx);
      return { files: ctx.files, staged: [] };
    }
    const { tx, verification, now } = ctx;
    const held = await lockSelfieCapture(
      tx,
      verification.environmentId,
      verification.id,
      capture.id,
    );
    assertCaptureOpen(held, capture, now);
    assertCaptureComplete(held, ctx.files);
    const device = sanitizedDevice(capture.device);
    const consumed = await consumeSelfieCapture(tx, verification.environmentId, {
      id: held.id,
      verificationId: verification.id,
      now,
      ...(device === undefined ? {} : { device }),
    });
    if (consumed === null) {
      throw selfieCaptureInvalid();
    }
    return {
      files: ctx.files.filter((file) => file.selfieCaptureId === held.id),
      staged: [await stageSelfieEvent(tx, ctx.deps.events, 'selfie.submitted', consumed)],
    };
  },
  async repeat({ deps, verification, body }) {
    const capture = body?.capture;
    if (capture === undefined) {
      return;
    }
    // C40.4: only the capture that submitted the verification repeats its submit.
    const held = await lockSelfieCapture(
      deps.db,
      verification.environmentId,
      verification.id,
      capture.id,
    );
    if (!nonceMatches(held?.nonceSha256 ?? null, capture.nonce) || held?.status !== 'submitted') {
      throw selfieCaptureInvalid();
    }
  },
};
