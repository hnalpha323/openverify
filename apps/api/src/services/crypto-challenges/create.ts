/**
 * C57.2: `POST /api/v1/flow/verifications/:id/crypto-challenges` (see `index.ts`).
 */
import {
  buildCryptoChallengeMessage,
  cryptoAddressesEqual,
  validateCryptoAddress,
} from '@openverify/checks';
import {
  CRYPTO_CHALLENGE_LIMIT,
  CRYPTO_CHALLENGE_TTL_SECONDS,
  stepForVerificationType,
  stepMaxAttempts,
  toTimestamp,
  verificationConfigSchema,
  type CreateCryptoChallengeBody,
  type FlowCryptoChallengeResponse,
} from '@openverify/contracts';
import {
  countCryptoChallenges,
  createCryptoChallenge,
  getEnvironment,
  getInquiryTemplateVersion,
  getOrganization,
  listInquiryVerifications,
  supersedeOpenCryptoChallenges,
  type CryptoChallenge,
  type Db,
  type Inquiry,
  type VerificationWithChecks,
} from '@openverify/db';
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
import { cryptoWalletSubResources } from '../sub-resources/crypto-wallet.js';
import { fileIdsByVerification, moveVerification, stageVerificationEvent } from '../verifications.js';
import {
  cryptoAddressInvalid,
  cryptoChainNotOffered,
  cryptoChallengeInvalid,
  cryptoExpectedAddressMismatch,
  expectedCryptoAddressOf,
  newCryptoChallengeNonce,
  offeredCryptoChains,
  requiresEvmChecksum,
  type CryptoWalletStep,
} from './rules.js';

/** The organization the statement names (C55.9 sanitises it in the message builder). */
async function organizationNameOf(db: Db, environmentId: string): Promise<string> {
  const environment = await getEnvironment(db, environmentId);
  const organization =
    environment === null ? null : await getOrganization(db, environment.organizationId);
  return organization?.name ?? '';
}

/** The pinned version's crypto wallet step and the type's configuration. */
async function pinnedStepOf(deps: ApiDependencies, inquiry: Inquiry) {
  const version = await getInquiryTemplateVersion(
    deps.db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    throw new Error(`Inquiry ${inquiry.id} has no template version`);
  }
  const step = stepForVerificationType(storedFlowView(version.flow), 'crypto_wallet');
  if (step?.type !== 'crypto_wallet') {
    throw new UnprocessableContentError('The flow has no crypto-wallet step.');
  }
  const config = verificationConfigSchema.safeParse(version.verificationConfig);
  return { step, config: config.success ? config.data['crypto-wallet'] : undefined };
}

/**
 * C57.2 at the challenge cap: closes the open challenge, cancels the verification with
 * `verification.canceled`, and, when the step has no attempt left, fails the inquiry (C30.5,
 * `inquiry.failed`), all in `tx`. Returns the events to dispatch after commit.
 */
async function cancelAtChallengeLimit(
  tx: Db,
  deps: ApiDependencies,
  verification: VerificationWithChecks,
  inquiry: Inquiry,
  step: CryptoWalletStep,
  now: Date,
): Promise<StagedEvent[]> {
  const { events } = deps;
  const { environmentId } = inquiry;
  const staged = [
    ...(await cryptoWalletSubResources.onVerificationCanceled(tx, events, verification)).staged,
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
    (attempt) => attempt.type === 'crypto_wallet',
  );
  if (attempts.length >= stepMaxAttempts(step)) {
    const failed = await transitionInquiryInTx(tx, deps, inquiry, 'failed');
    staged.push(...(failed?.staged ?? []));
  }
  return staged;
}

/**
 * A new challenge for the session's crypto wallet verification: its id, the message to sign and
 * its expiry, returned once (C57.2).
 * @throws {Phase5ProblemError} 422 `crypto_chain_not_offered`, `crypto_address_invalid` or
 *   `crypto_expected_address_mismatch` before any write; 409 `crypto_challenge_invalid` once the
 *   11th challenge canceled the verification.
 */
export async function createFlowCryptoChallenge(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  body: CreateCryptoChallengeBody,
): Promise<FlowCryptoChallengeResponse> {
  const { db, clock, events, ids } = deps;
  const { environmentId } = session;
  const { inquiry, verification } = await requireFlowVerification(deps, session, verificationId, {
    types: ['crypto_wallet'],
  });
  const { step, config } = await pinnedStepOf(deps, inquiry);
  const chainId = body['chain-id'];
  const address = body['wallet-address'];
  if (!offeredCryptoChains(step, config).includes(chainId)) {
    throw cryptoChainNotOffered();
  }
  if (!validateCryptoAddress(chainId, address, { requireEvmChecksum: requiresEvmChecksum(config) }).valid) {
    throw cryptoAddressInvalid();
  }
  const expected = expectedCryptoAddressOf(inquiry.fields);
  if (expected !== null && !cryptoAddressesEqual(chainId, expected, address)) {
    throw cryptoExpectedAddressMismatch();
  }
  const organizationName = await organizationNameOf(db, environmentId);
  const nonce = newCryptoChallengeNonce();

  const outcome = await db.transaction(
    async (tx): Promise<{ challenge: CryptoChallenge | null; message: string; staged: StagedEvent[] }> => {
      // C40.6: the inquiry (re-checked open and unredacted), then the verification, then its
      // challenges.
      const locked = await requireFlowVerificationUnderLock(tx, session, verification.id);
      const now = clock.now();
      const current = { ...locked.verification, checks: verification.checks };
      if ((await countCryptoChallenges(tx, environmentId, current.id)) >= CRYPTO_CHALLENGE_LIMIT) {
        return {
          challenge: null,
          message: '',
          staged: await cancelAtChallengeLimit(tx, deps, current, locked.inquiry, step, now),
        };
      }
      await supersedeOpenCryptoChallenges(tx, environmentId, current.id, { now });
      const expiresAt = new Date(now.getTime() + CRYPTO_CHALLENGE_TTL_SECONDS * 1000);
      const message = buildCryptoChallengeMessage({
        chainId,
        address,
        origin: deps.flowPublicUrl,
        organizationName,
        nonce,
        issuedAt: now,
        expiresAt,
        requestId: current.id,
      });
      const challenge = await createCryptoChallenge(tx, environmentId, {
        id: ids.newId('cwc'),
        verificationId: current.id,
        inquiryId: locked.inquiry.id,
        chainId,
        walletAddress: address,
        message,
        blindIndexKey: deps.blindIndexKey,
        createdAt: now,
        expiresAt,
      });
      return { challenge, message, staged: [] };
    },
  );
  await events.dispatch(outcome.staged);
  if (outcome.challenge === null) {
    throw cryptoChallengeInvalid(
      `The verification reached its ${String(CRYPTO_CHALLENGE_LIMIT)} wallet challenges and was canceled; start a new attempt.`,
    );
  }
  return {
    id: outcome.challenge.id,
    message: outcome.message,
    'expires-at': toTimestamp(outcome.challenge.expiresAt),
  };
}
