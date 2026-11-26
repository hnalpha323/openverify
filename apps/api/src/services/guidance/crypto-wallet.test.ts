/**
 * C52.2: the crypto wallet guidance hook on its own: the offered chains and the signing methods,
 * and `null` when the pinned flow has no crypto wallet step or offers no chain the type allows.
 */
import { defaultTemplateConfig } from '@openverify/core';
import type { Db, VerificationWithChecks } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import type { ApiDependencies } from '../context.js';
import { TEST_CHAINS } from '../crypto-challenges/testing.js';
import { cryptoWalletGuidance } from './crypto-wallet.js';

const context = {
  deps: {} as ApiDependencies,
  db: {} as Db,
  verification: {} as VerificationWithChecks,
};
const STEP = {
  id: 'wallet',
  type: 'crypto_wallet' as const,
  chains: [TEST_CHAINS.ethereum, TEST_CHAINS.solana],
  signing: ['wallet' as const, 'paste' as const],
};

describe('cryptoWalletGuidance (C52.2)', () => {
  it('names the offered chains and the signing methods', async () => {
    expect(
      await cryptoWalletGuidance.flowAttributes({
        ...context,
        step: STEP,
        config: defaultTemplateConfig('crypto_wallet'),
      }),
    ).toEqual({ guidance: { chains: STEP.chains, signing: STEP.signing } });
  });

  it('is null without a crypto wallet step', async () => {
    expect(
      await cryptoWalletGuidance.flowAttributes({ ...context, step: undefined, config: undefined }),
    ).toEqual({ guidance: null });
    expect(
      await cryptoWalletGuidance.flowAttributes({
        ...context,
        step: { id: 'email', type: 'email_otp' },
        config: undefined,
      }),
    ).toEqual({ guidance: null });
  });

  it('is null when the type allows none of the step’s chains', async () => {
    expect(
      await cryptoWalletGuidance.flowAttributes({
        ...context,
        step: STEP,
        config: { ...defaultTemplateConfig('crypto_wallet'), 'allowed-chains': [TEST_CHAINS.tron] },
      }),
    ).toEqual({ guidance: null });
  });
});
