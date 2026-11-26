/**
 * C57.4 at the logic level: every enabled crypto wallet check is evaluated over one context, every
 * evaluator emits only its C51.2 reasons, the job learns when to ask `evmRpc`, and the decision
 * engine reads the results as the plan says.
 */
import {
  checkResultSchema,
  decideVerification,
  defaultTemplateConfig,
  type CheckResult,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import { utf8 } from './bytes.js';
import { cryptoWalletContractCheck } from './context.js';
import { evaluateCryptoWalletChecks } from './evaluate.js';
import { CRYPTO_WALLET_EVALUATORS } from './evaluators.js';
import type { CryptoWalletCheckInput } from './inputs.js';
import { CRYPTO_WALLET_EVALUATOR_REASONS } from './reasons.js';
import {
  BITCOIN_CHAIN,
  SANDBOX_CONTRACT_WALLET,
  SOLANA_CHAIN,
  TEST_CHALLENGE,
  XRPL_CHAIN,
  bitcoinTestAddresses,
  evmCryptoInput,
  evmTestAddress,
  signBip137,
  signPersonalMessage,
  testPrivateKey,
} from './testing.js';

const C51_2 = {
  crypto_wallet_validity_detection: [
    'input_missing',
    'address_invalid',
    'address_checksum_invalid',
  ],
  crypto_wallet_disallowed_chain_detection: ['input_missing', 'chain_not_allowed', 'no_allowlist'],
  crypto_wallet_statement_comparison: ['input_missing', 'statement_mismatch'],
  crypto_wallet_address_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'signature_invalid',
    'signature_address_mismatch',
    'expected_address_mismatch',
    'signature_inconclusive',
    'ownership_proof_unsupported',
    'contract_wallet_not_allowed',
  ],
};
const CHECKS = Object.keys(C51_2);
const EVERY_CHECK = {
  checks: Object.fromEntries(CHECKS.map((id) => [id, { enabled: true, required: true }])),
};

const owner = testPrivateKey('evaluate/owner');
const btcKey = testPrivateKey('evaluate/btc');
const VARIANTS: CryptoWalletCheckInput[] = [
  evmCryptoInput('evaluate/alice'),
  evmCryptoInput('evaluate/alice', { expectedAddress: evmTestAddress(owner) }),
  evmCryptoInput('evaluate/alice', { submission: null }),
  evmCryptoInput('evaluate/alice', { challenge: null }),
  evmCryptoInput('evaluate/alice', { walletAddress: '0x1234' }),
  evmCryptoInput('evaluate/alice', { chainId: null }),
  evmCryptoInput('evaluate/alice', { walletAddress: SANDBOX_CONTRACT_WALLET }),
  ...[
    { kind: 'not_configured' } as const,
    { kind: 'error' } as const,
    ...[
      { hasCode: false, signatureValid: null },
      { hasCode: true, signatureValid: true },
      { hasCode: true, signatureValid: false },
    ].map((result) => ({
      kind: 'result' as const,
      provider: { id: 'sandbox', sandbox: true },
      result,
    })),
  ].map((contractWallet) =>
    evmCryptoInput('evaluate/alice', {
      walletAddress: SANDBOX_CONTRACT_WALLET,
      submission: { signature: signPersonalMessage(utf8(TEST_CHALLENGE), owner) },
      contractWallet,
    }),
  ),
  {
    ...evmCryptoInput('x'),
    chainId: BITCOIN_CHAIN,
    walletAddress: bitcoinTestAddresses(btcKey, 'bitcoin').p2wsh,
    submission: { signature: signBip137('bitcoin', utf8(TEST_CHALLENGE), btcKey, 'p2wpkh') },
  },
  {
    ...evmCryptoInput('x'),
    chainId: XRPL_CHAIN,
    walletAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  },
  { ...evmCryptoInput('x'), chainId: SOLANA_CHAIN, walletAddress: 'not base58 0OIl' },
];

function expectListedReasons(results: readonly CheckResult[]): void {
  for (const result of results) {
    expect(checkResultSchema.parse(result)).toEqual(result);
    expect(result.status).not.toBe('pending');
    for (const reason of result.reasons) {
      expect(
        CRYPTO_WALLET_EVALUATOR_REASONS[result.name],
        `${result.name} emitted ${reason}`,
      ).toContain(reason);
    }
  }
}

describe('the crypto wallet reasons (C51.2)', () => {
  it('lists exactly the C51.2 row of each check, with its shared reasons first', () => {
    expect(CRYPTO_WALLET_EVALUATOR_REASONS).toEqual(C51_2);
  });

  it('has an evaluator for every crypto wallet check', () => {
    expect(Object.keys(CRYPTO_WALLET_EVALUATORS).sort()).toEqual([...CHECKS].sort());
  });

  it('emits only listed reasons over every outcome', () => {
    for (const input of VARIANTS) {
      for (const template of [EVERY_CHECK, { ...EVERY_CHECK, 'allowed-chains': ['eip155:1'] }]) {
        expectListedReasons(evaluateCryptoWalletChecks(input, template));
      }
    }
  });
});

describe('evaluateCryptoWalletChecks (C57.4)', () => {
  it('evaluates the enabled checks in configuration order', () => {
    const template = {
      checks: {
        crypto_wallet_statement_comparison: { enabled: true, required: true },
        crypto_wallet_validity_detection: { enabled: false, required: false },
        crypto_wallet_address_comparison: { enabled: true, required: true },
      },
    };
    expect(
      evaluateCryptoWalletChecks(evmCryptoInput('order'), template).map((result) => result.name),
    ).toEqual(['crypto_wallet_statement_comparison', 'crypto_wallet_address_comparison']);
  });

  it('refuses a check of another type and a config that breaks its schema', () => {
    expect(() =>
      evaluateCryptoWalletChecks(evmCryptoInput('x'), {
        checks: { phone_number_otp_comparison: { enabled: true, required: true } },
      }),
    ).toThrow(InvalidCheckConfigError);
    expect(() =>
      evaluateCryptoWalletChecks(evmCryptoInput('x'), {
        checks: {
          crypto_wallet_address_comparison: {
            enabled: true,
            required: true,
            config: { 'bip137-mode': 'any' },
          },
        },
      }),
    ).toThrow(InvalidCheckConfigError);
  });

  it('passes a genuine wallet on the registry default template', () => {
    const template = defaultTemplateConfig('crypto_wallet');
    const results = evaluateCryptoWalletChecks(evmCryptoInput('decide/genuine'), template);
    expect(results.map((result) => [result.name, result.status])).toEqual(
      expect.arrayContaining([
        ['crypto_wallet_validity_detection', 'passed'],
        ['crypto_wallet_disallowed_chain_detection', 'not_applicable'],
        ['crypto_wallet_statement_comparison', 'passed'],
        ['crypto_wallet_address_comparison', 'passed'],
      ]),
    );
    expect(decideVerification(results, template).status).toBe('passed');
  });

  // Workflow 5C review P004: a replayed signature over another message never passes, whether the
  // statement check is required, advisory or disabled.
  it.each([
    ['required', { enabled: true, required: true }],
    ['advisory', { enabled: true, required: false }],
    ['disabled', { enabled: false, required: false }],
  ] as const)(
    'fails a replayed signature over another message with the statement check %s',
    (_label, statement) => {
      const defaults = defaultTemplateConfig('crypto_wallet');
      const template = {
        checks: { ...defaults.checks, crypto_wallet_statement_comparison: statement },
      };
      const forum = utf8('I own this address. Posted on a public forum last year.');
      const input = evmCryptoInput('decide/replay', {
        submission: {
          signature: signPersonalMessage(forum, testPrivateKey('decide/replay')),
          signedMessage: Buffer.from(forum).toString('base64'),
        },
      });
      const results = evaluateCryptoWalletChecks(input, template);

      expect(
        results.find((result) => result.name === 'crypto_wallet_address_comparison'),
      ).toMatchObject({ status: 'failed', reasons: ['signature_invalid'] });
      expect(decideVerification(results, template).status).toBe('failed');
    },
  );

  it('fails another key’s signature as a retryable user mistake when the RPC finds no contract', () => {
    const template = defaultTemplateConfig('crypto_wallet');
    const input = evmCryptoInput('decide/claimed', {
      submission: {
        signature: signPersonalMessage(utf8(TEST_CHALLENGE), testPrivateKey('decide/other')),
      },
      contractWallet: {
        kind: 'result',
        provider: { id: 'sandbox', sandbox: true },
        result: { hasCode: false, signatureValid: null },
      },
    });
    const decision = decideVerification(evaluateCryptoWalletChecks(input, template), template);
    expect(decision.status).toBe('failed');
    expect(decision.status === 'failed' ? decision.retryable : null).toBe(true);
  });

  it('sends a wrong-account EVM signature to review without an RPC, and an XRP Ledger wallet too', () => {
    const template = defaultTemplateConfig('crypto_wallet');
    const wrongAccount = evmCryptoInput('decide/claimed', {
      submission: {
        signature: signPersonalMessage(utf8(TEST_CHALLENGE), testPrivateKey('decide/other')),
      },
    });
    expect(
      decideVerification(evaluateCryptoWalletChecks(wrongAccount, template), template).status,
    ).toBe('needs_review');
    const xrpl = {
      ...evmCryptoInput('x'),
      chainId: XRPL_CHAIN,
      walletAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    };
    expect(decideVerification(evaluateCryptoWalletChecks(xrpl, template), template).status).toBe(
      'needs_review',
    );
  });
});

describe('cryptoWalletContractCheck (C57.4)', () => {
  const template = defaultTemplateConfig('crypto_wallet');

  it('asks the RPC only for an EVM signature that does not recover the claimed address', () => {
    expect(cryptoWalletContractCheck(evmCryptoInput('contract/alice'), template)).toBeNull();
    const check = cryptoWalletContractCheck(
      evmCryptoInput('contract/alice', {
        walletAddress: SANDBOX_CONTRACT_WALLET,
        submission: { signature: signPersonalMessage(utf8(TEST_CHALLENGE), owner) },
      }),
      template,
    );
    expect(check?.address).toBe(SANDBOX_CONTRACT_WALLET);
    expect(check?.digest).toHaveLength(32);
    expect(check?.signature).toHaveLength(65);
  });

  it('asks nothing without a submission, for another chain, or for an invalid address', () => {
    expect(
      cryptoWalletContractCheck(evmCryptoInput('c', { submission: null }), template),
    ).toBeNull();
    expect(
      cryptoWalletContractCheck(evmCryptoInput('c', { walletAddress: '0x1' }), template),
    ).toBeNull();
    const key = testPrivateKey('contract/btc');
    expect(
      cryptoWalletContractCheck(
        {
          ...evmCryptoInput('c'),
          chainId: BITCOIN_CHAIN,
          walletAddress: bitcoinTestAddresses(key, 'bitcoin').p2pkh,
          submission: {
            signature: signBip137('bitcoin', utf8(TEST_CHALLENGE), testPrivateKey('o'), 'p2pkh'),
          },
        },
        template,
      ),
    ).toBeNull();
  });
});
