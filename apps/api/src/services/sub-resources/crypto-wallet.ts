/**
 * C54.1, C57.2: canceling a `crypto-wallet` verification (the inquiry's expiry or actions, or its
 * own 11th challenge) closes its open challenge (`superseded`), so it can never be submitted; a
 * consumed challenge stays as it is. No event: a challenge has none. Runs in the transaction that
 * cancels, after the inquiry and the verification were locked (C40.6).
 */
import { supersedeOpenCryptoChallenges } from '@openverify/db';
import type { SubResourceHook } from './index.js';

export const cryptoWalletSubResources: SubResourceHook = {
  async onVerificationCanceled(tx, _events, verification) {
    await supersedeOpenCryptoChallenges(tx, verification.environmentId, verification.id);
    return { staged: [], storageKeys: [] };
  },
};
