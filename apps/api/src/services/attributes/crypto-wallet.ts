/**
 * C52.8, C54.1: the `crypto-wallet` verification's attributes, from its challenges (C57.2): the
 * claimed address (as the user wrote it) and the chain of the challenge a submit consumed, else
 * of its newest challenge; the signature scheme once one was consumed (as the submit named it, or
 * as the job established it); and the inquiry field `crypto_wallet_address` the address had to
 * equal. `wallet-address` and `expected-address` are PII: masked for a principal without
 * `pii:view` (C53.7) and `null` once the inquiry is redacted (C53.6).
 */
import { cryptoSignatureSchemeSchema } from '@openverify/core';
import { getInquiry, listCryptoChallenges, openCryptoChallengeEvidence } from '@openverify/db';
import { expectedCryptoAddressOf } from '../crypto-challenges/rules.js';
import type { VerificationAttributeHook } from './index.js';

export const cryptoWalletAttributes: VerificationAttributeHook = {
  async load(db, verification) {
    const { environmentId } = verification;
    const challenges = await listCryptoChallenges(db, environmentId, verification.id);
    const consumed = challenges.find(
      (challenge) => challenge.status === 'submitted' || challenge.status === 'processed',
    );
    const shown = consumed ?? challenges[0];
    const evidence =
      shown === undefined ? null : await openCryptoChallengeEvidence(db, environmentId, shown.id);
    const inquiry = await getInquiry(db, environmentId, verification.inquiryId);
    const scheme = cryptoSignatureSchemeSchema.safeParse(consumed?.scheme);
    return {
      'wallet-address': evidence?.walletAddress ?? null,
      'expected-address': expectedCryptoAddressOf(inquiry?.fields),
      'chain-id': shown?.chainId ?? null,
      'signature-scheme': scheme.success ? scheme.data : null,
    };
  },
  mask: (attributes, mask) => mask.attributes(attributes),
};
