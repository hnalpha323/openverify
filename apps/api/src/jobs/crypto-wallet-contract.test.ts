/**
 * C51.2 contract for the crypto wallet job: what its evaluators may emit is exactly what the
 * contracts publish for the four `crypto_wallet_*` checks, so the job never writes a reason the
 * clients and the console do not know. `packages/checks` cannot import `@openverify/contracts`,
 * so the two lists meet here.
 */
import { readFileSync } from 'node:fs';
import { CRYPTO_WALLET_EVALUATOR_REASONS, evaluateCryptoWalletChecks } from '@openverify/checks';
import {
  CRYPTO_WALLET_CHECK_IDS,
  CRYPTO_WALLET_CHECK_REASONS,
  cryptoWalletVerificationResourceSchema,
} from '@openverify/contracts';
import { CHECK_REGISTRY, defaultTemplateConfig } from '@openverify/core';
import { describe, expect, it } from 'vitest';

describe('the crypto wallet reasons (C51.2)', () => {
  it('are the same per check, in the same order, in the evaluators and the contracts', () => {
    expect(CRYPTO_WALLET_EVALUATOR_REASONS).toEqual(CRYPTO_WALLET_CHECK_REASONS);
  });

  it('cover every crypto wallet check of the registry', () => {
    const registered = CHECK_REGISTRY.filter(
      (check) => check.verificationType === 'crypto_wallet',
    ).map((check) => check.id);

    expect([...registered].sort()).toEqual([...CRYPTO_WALLET_CHECK_IDS].sort());
    expect(Object.keys(CRYPTO_WALLET_EVALUATOR_REASONS).sort()).toEqual(
      [...CRYPTO_WALLET_CHECK_IDS].sort(),
    );
  });
});

describe('the golden crypto wallet fixture (C52.8, C57.1)', () => {
  it('shows the validity metadata and thresholds the evaluator writes for its address', () => {
    const fixture = cryptoWalletVerificationResourceSchema.parse(
      (
        JSON.parse(
          readFileSync(
            new URL(
              '../../../../contracts/fixtures/api/verification-crypto-wallet.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ) as { data: unknown }
      ).data,
    );
    const { attributes } = fixture;
    const NAME = 'crypto_wallet_validity_detection';

    const evaluated = evaluateCryptoWalletChecks(
      {
        chainId: attributes['chain-id'] ?? '',
        walletAddress: attributes['wallet-address'] ?? '',
        challenge: null,
        submission: null,
      },
      defaultTemplateConfig('crypto_wallet'),
    ).find((check) => check.name === NAME);
    const golden = attributes.checks.find((check) => check.name === NAME);

    expect(evaluated).toBeDefined();
    expect(golden).toMatchObject({
      status: evaluated?.status,
      metadata: evaluated?.metadata,
      provenance: { thresholds: evaluated?.provenance.thresholds },
    });
  });
});
