/**
 * C54.1, C62.5: canceling a `government-id-nfc` verification (the inquiry's expiry or actions, or
 * its own 11th challenge) closes its open chip challenge (`superseded`), so it can never be
 * submitted; a consumed challenge stays as it is, and the job clears its AA response and device
 * report when processing ends. No event: a challenge has none. Runs in the transaction that
 * cancels, after the inquiry and the verification were locked (C40.6).
 */
import { supersedeOpenChipChallenges } from '@openverify/db';
import type { SubResourceHook } from './index.js';

export const governmentIdNfcSubResources: SubResourceHook = {
  async onVerificationCanceled(tx, _events, verification) {
    await supersedeOpenChipChallenges(tx, verification.environmentId, verification.id);
    return { staged: [], storageKeys: [] };
  },
};
