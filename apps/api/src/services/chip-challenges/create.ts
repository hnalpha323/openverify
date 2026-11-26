/**
 * C62.5: `POST /api/v1/flow/verifications/:id/chip-challenges` (see `index.ts`).
 */
import {
  CHIP_CHALLENGE_LIMIT,
  CHIP_CHALLENGE_TTL_SECONDS,
  stepForVerificationType,
  stepMaxAttempts,
  toTimestamp,
  type FlowChipChallengeResponse,
} from '@openverify/contracts';
import {
  countChipChallenges,
  createChipChallenge,
  getInquiryTemplateVersion,
  listInquiryVerifications,
  supersedeOpenChipChallenges,
  type ChipChallenge,
  type Db,
  type Inquiry,
  type VerificationWithChecks,
} from '@openverify/db';
import type { FlowStep } from '@openverify/flow-spec';
import type { FlowSession } from '../../auth/flow-session.js';
import type { StagedEvent } from '../../events/index.js';
import { ConflictError, UnprocessableContentError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import {
  requireFlowVerification,
  requireFlowVerificationUnderLock,
} from '../flow-preconditions.js';
import { transitionInquiryInTx } from '../inquiries.js';
import { storedFlowView } from '../stored-flow.js';
import { governmentIdNfcSubResources } from '../sub-resources/government-id-nfc.js';
import {
  fileIdsByVerification,
  moveVerification,
  stageVerificationEvent,
} from '../verifications.js';
import { chipChallengeInvalid, chipNonceSha256, newChipChallengeNonce } from './rules.js';

/** The pinned flow's NFC step. */
export type NfcStep = Extract<FlowStep, { type: 'nfc' }>;

/** The pinned version's NFC step. */
async function pinnedStepOf(deps: ApiDependencies, inquiry: Inquiry): Promise<NfcStep> {
  const version = await getInquiryTemplateVersion(
    deps.db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    throw new Error(`Inquiry ${inquiry.id} has no template version`);
  }
  const step = stepForVerificationType(storedFlowView(version.flow), 'government_id_nfc');
  if (step?.type !== 'nfc') {
    throw new UnprocessableContentError('The flow has no government-id-nfc step.');
  }
  return step;
}

/**
 * C62.5 at the challenge cap: closes the open challenge, cancels the verification with
 * `verification.canceled`, and, when the step has no attempt left, fails the inquiry (C30.5,
 * `inquiry.failed`), all in `tx`. Returns the events to dispatch after commit.
 */
async function cancelAtChallengeLimit(
  tx: Db,
  deps: ApiDependencies,
  verification: VerificationWithChecks,
  inquiry: Inquiry,
  step: NfcStep,
  now: Date,
): Promise<StagedEvent[]> {
  const { events } = deps;
  const { environmentId } = inquiry;
  const staged = [
    ...(await governmentIdNfcSubResources.onVerificationCanceled(tx, events, verification)).staged,
  ];
  const moved = await moveVerification(tx, verification, 'canceled', now);
  if (moved === null) {
    // The verification row is locked, so only a change before the lock gets here.
    throw new ConflictError('The verification is no longer initiated.');
  }
  if (moved.event !== null) {
    const files = await fileIdsByVerification(tx, environmentId, [verification.id]);
    staged.push(
      await stageVerificationEvent(
        tx,
        events,
        moved.event,
        { ...moved.verification, checks: verification.checks },
        files.get(verification.id) ?? [],
      ),
    );
  }
  const attempts = (await listInquiryVerifications(tx, environmentId, inquiry.id)).filter(
    (attempt) => attempt.type === 'government_id_nfc',
  );
  if (attempts.length >= stepMaxAttempts(step)) {
    const failed = await transitionInquiryInTx(tx, deps, inquiry, 'failed');
    staged.push(...(failed?.staged ?? []));
  }
  return staged;
}

/**
 * A new challenge for the session's NFC verification: its id, the nonce the chip signs and its
 * expiry, returned once (C62.5).
 * @throws {Phase5ProblemError} 409 `chip_challenge_invalid` once the 11th challenge canceled the
 *   verification.
 */
export async function createFlowChipChallenge(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
): Promise<FlowChipChallengeResponse> {
  const { db, clock, events, ids } = deps;
  const { environmentId } = session;
  const { inquiry, verification } = await requireFlowVerification(deps, session, verificationId, {
    types: ['government_id_nfc'],
  });
  const step = await pinnedStepOf(deps, inquiry);
  const nonce = newChipChallengeNonce();

  const outcome = await db.transaction(
    async (tx): Promise<{ challenge: ChipChallenge | null; staged: StagedEvent[] }> => {
      // C40.6: the inquiry (re-checked open and unredacted), then the verification, then its
      // challenges.
      const locked = await requireFlowVerificationUnderLock(tx, session, verification.id);
      const now = clock.now();
      const current = { ...locked.verification, checks: verification.checks };
      if ((await countChipChallenges(tx, environmentId, current.id)) >= CHIP_CHALLENGE_LIMIT) {
        return {
          challenge: null,
          staged: await cancelAtChallengeLimit(tx, deps, current, locked.inquiry, step, now),
        };
      }
      await supersedeOpenChipChallenges(tx, environmentId, current.id, { now });
      const challenge = await createChipChallenge(tx, environmentId, {
        id: ids.newId('chc'),
        verificationId: current.id,
        inquiryId: locked.inquiry.id,
        nonceSha256: chipNonceSha256(nonce),
        createdAt: now,
        expiresAt: new Date(now.getTime() + CHIP_CHALLENGE_TTL_SECONDS * 1000),
      });
      return { challenge, staged: [] };
    },
  );
  await events.dispatch(outcome.staged);
  if (outcome.challenge === null) {
    throw chipChallengeInvalid(
      `The verification reached its ${String(CHIP_CHALLENGE_LIMIT)} chip challenges and was canceled; start a new attempt.`,
    );
  }
  return {
    id: outcome.challenge.id,
    nonce,
    'expires-at': toTimestamp(outcome.challenge.expiresAt),
  };
}
