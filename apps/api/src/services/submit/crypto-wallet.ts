/**
 * C57.3, C52.6: the `crypto-wallet` submit. The body carries `{ crypto: { challenge-id,
 * signature, signed-message?, scheme? } }` and nothing else. Under the C40.6 locks (the inquiry,
 * the verification, then the challenge), the named challenge is consumed once by a conditional
 * update (`initiated`, of this verification, unexpired at the server clock) with the signature,
 * the signed message and the scheme sealed to it; the job checks the signature. Every refusal of
 * the challenge, a missing `crypto` member included, answers one 409 `crypto_challenge_invalid`
 * body, so the answer tells nothing about which it was. A repeated submit of a `submitted`
 * verification must name the challenge that submitted it.
 */
import { consumeCryptoChallenge, getCryptoChallenge } from '@openverify/db';
import { cryptoChallengeInvalid } from '../crypto-challenges/rules.js';
import type { SubmitGuard } from './index.js';
import { assertOnlyMember } from './standard.js';

export const cryptoWalletSubmit: SubmitGuard = {
  submittableStatuses: ['initiated'],
  checkBody(ctx) {
    assertOnlyMember(ctx, 'crypto');
    if (ctx.body?.crypto === undefined) {
      throw cryptoChallengeInvalid();
    }
  },
  async inTransaction(ctx) {
    const submitted = ctx.body?.crypto;
    if (submitted === undefined) {
      throw cryptoChallengeInvalid();
    }
    const consumed = await consumeCryptoChallenge(ctx.tx, ctx.verification.environmentId, {
      id: submitted['challenge-id'],
      verificationId: ctx.verification.id,
      now: ctx.now,
      submission: {
        signature: submitted.signature,
        signedMessage: submitted['signed-message'] ?? null,
        scheme: submitted.scheme ?? null,
      },
    });
    if (consumed === null) {
      throw cryptoChallengeInvalid();
    }
    return { files: ctx.files, staged: [] };
  },
  async repeat({ deps, verification, body }) {
    const submitted = body?.crypto;
    const challenge =
      submitted === undefined
        ? null
        : await getCryptoChallenge(deps.db, verification.environmentId, submitted['challenge-id']);
    // C3: only the challenge that submitted the verification repeats its submit.
    if (
      challenge?.verificationId !== verification.id ||
      (challenge.status !== 'submitted' && challenge.status !== 'processed')
    ) {
      throw cryptoChallengeInvalid();
    }
  },
};
