/**
 * C171.4 (WCAG 2.2.1; Workflow 9A, api-flow-engine): `POST /flow/selfie-captures/:id/extend` moves
 * an open capture's `expires_at` by 180 s (`SELFIE_CAPTURE_TTL_SECONDS`), up to
 * {@link SELFIE_CAPTURE_EXTENSION_LIMIT} times per capture, outside the cap of 10 captures (an
 * extension creates no capture), and is refused once the capture is no longer open: submitted,
 * errored, expired or extended its last time (409 `selfie_capture_not_extendable`). The route is
 * frozen in the shared `routes/flow/index.ts` by `foundation-9a` (Stage 1b (S)) and delegates here.
 *
 * The count of extensions is the capture's lifetime past its own: `expires_at - created_at - 180 s`
 * over 180 s, so no column holds it. Only the current step's capture is extended (C151.4), under
 * the inquiry's lock and the capture's.
 */
import { SELFIE_CAPTURE_TTL_SECONDS, type SelfieCaptureDocument } from '@openverify/contracts';
import { getSelfieCapture, lockSelfieCapture, selfieCaptures } from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import type { FlowSession } from '../auth/flow-session.js';
import { NotFoundError } from '../errors.js';
import type { ApiDependencies } from '../services/context.js';
import { assertInquiryOpenUnderLock } from '../services/flow-preconditions.js';
import { selfieCaptureResourceOf } from '../services/selfie-captures.js';
import { assertCurrentStepInTx } from './current-step.js';
import { FlowEngineProblemError } from './problems.js';

/**
 * C171.4: how many times one capture may be extended. WCAG 2.2.1 asks for "at least ten"; ten
 * bounds a capture's life at 33 minutes (ours, provisional; the basis is 2.2.1's minimum).
 */
export const SELFIE_CAPTURE_EXTENSION_LIMIT = 10;

const TTL_MS = SELFIE_CAPTURE_TTL_SECONDS * 1000;

const notExtendable = (detail: string) =>
  new FlowEngineProblemError('selfie_capture_not_extendable', detail);

/** Extends the session's capture `captureId`, answering it without its nonce. */
export async function extendSelfieCapture(
  deps: ApiDependencies,
  session: FlowSession,
  captureId: string,
): Promise<SelfieCaptureDocument> {
  const { db, clock } = deps;
  const { environmentId, inquiryId } = session;
  return db.transaction(async (tx) => {
    await assertInquiryOpenUnderLock(tx, environmentId, inquiryId);
    const found = await getSelfieCapture(tx, environmentId, captureId);
    if (found?.inquiryId !== inquiryId) {
      throw new NotFoundError(`Selfie capture ${captureId} was not found.`);
    }
    await assertCurrentStepInTx(
      tx,
      { environmentId, inquiryId },
      { kind: 'upload', verificationId: found.verificationId, verificationType: 'selfie' },
    );
    const capture = await lockSelfieCapture(tx, environmentId, found.verificationId, captureId);
    const now = clock.now().getTime();
    if (capture?.status !== 'initiated') {
      throw notExtendable('The selfie capture is no longer open; start a new capture.');
    }
    if (capture.expiresAt.getTime() <= now) {
      throw notExtendable('The selfie capture has expired; start a new capture.');
    }
    const extensions = Math.round(
      (capture.expiresAt.getTime() - capture.createdAt.getTime() - TTL_MS) / TTL_MS,
    );
    if (extensions >= SELFIE_CAPTURE_EXTENSION_LIMIT) {
      throw notExtendable('The selfie capture cannot be extended again; start a new capture.');
    }
    await tx
      .update(selfieCaptures)
      .set({ expiresAt: new Date(capture.expiresAt.getTime() + TTL_MS) })
      .where(
        and(eq(selfieCaptures.environmentId, environmentId), eq(selfieCaptures.id, captureId)),
      );
    const extended = await getSelfieCapture(tx, environmentId, captureId);
    if (extended === null) {
      throw new NotFoundError(`Selfie capture ${captureId} was not found.`);
    }
    return { data: await selfieCaptureResourceOf(tx, extended) };
  });
}
