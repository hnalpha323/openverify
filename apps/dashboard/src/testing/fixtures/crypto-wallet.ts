/**
 * Synthetic crypto wallet verifications for the console's tests (C57, C66), built on the golden
 * fixture (`contracts/fixtures/api/verification-crypto-wallet.json` through `phase5Verification`),
 * with the checks' metadata as the evaluators write it (C57.4). The EVM address is EIP-55's
 * published all-caps example, the contract wallet the sandbox RPC's documented one (C57.5); the
 * Bitcoin and Solana values are invented strings, never a real account.
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { CryptoWalletVerification } from '../../lib/crypto-wallet-evidence';
import { phase5Verification } from '../phase5-fixtures';

/** The golden fixture's address and chain. */
export const WALLET_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
export const ETHEREUM = 'eip155:1';
/** The sandbox `evmRpc` provider's contract wallet (C57.5). */
export const SANDBOX_CONTRACT_WALLET = '0x00000000000000000000000000000000000c0de5';
export const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';
export const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
/** Invented, and not a valid address of either chain. */
export const SYNTHETIC_BITCOIN_ADDRESS = '1SyntheticConsoleTestAddress0000';
export const SYNTHETIC_SOLANA_ADDRESS = 'SyntheticConsoleTestAccount11111111111111111';

const ADDRESS_PROVENANCE = {
  'implementation-version': 1,
  thresholds: { 'bip137-mode': 'loose', 'allow-high-s': true, 'allow-contract-wallets': false },
};

/** One crypto wallet check as the evaluators write it, passed, with `overrides`. */
function walletCheck(
  name: VerificationCheck['name'],
  overrides: Partial<VerificationCheck>,
): VerificationCheck {
  return {
    name,
    status: 'passed',
    reasons: [],
    requirement: 'required',
    metadata: {},
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: {} },
    category: 'fraud',
    ...overrides,
  };
}

/** The four checks of a crypto wallet verification, each passed unless `overrides` says. */
export function walletChecks(
  overrides: {
    readonly validity?: Partial<VerificationCheck>;
    readonly chain?: Partial<VerificationCheck>;
    readonly statement?: Partial<VerificationCheck>;
    readonly address?: Partial<VerificationCheck>;
  } = {},
): VerificationCheck[] {
  return [
    walletCheck('crypto_wallet_validity_detection', {
      metadata: { checksum: 'absent', 'address-type': 'evm' },
      provenance: { 'implementation-version': 1, thresholds: { 'require-evm-checksum': false } },
      ...overrides.validity,
    }),
    walletCheck('crypto_wallet_disallowed_chain_detection', {
      status: 'not_applicable',
      reasons: ['no_allowlist'],
      ...overrides.chain,
    }),
    walletCheck('crypto_wallet_statement_comparison', { ...overrides.statement }),
    walletCheck('crypto_wallet_address_comparison', {
      metadata: { scheme: 'eip191', 'high-s': false },
      provenance: ADDRESS_PROVENANCE,
      ...overrides.address,
    }),
  ];
}

export interface CryptoWalletFixtureOptions {
  readonly id?: string;
  /** Replaces the golden's status, checks and type attributes, member by member. */
  readonly attributes?: Partial<CryptoWalletVerification['attributes']>;
  /** As the API serves it to an operator without `pii:view`, or after a redaction. */
  readonly masked?: boolean;
}

/** The golden crypto wallet verification (passed, EIP-191 on Ethereum), with `attributes`. */
export function cryptoWalletVerification(
  options: CryptoWalletFixtureOptions = {},
): CryptoWalletVerification {
  const golden = phase5Verification('verification/crypto-wallet');
  const verification = phase5Verification('verification/crypto-wallet', {
    ...(options.id === undefined ? {} : { id: options.id }),
    masked: options.masked ?? false,
    attributes: { ...golden.attributes, ...options.attributes },
  });
  if (verification.type !== 'verification/crypto-wallet') {
    throw new Error('The crypto wallet fixture is of another type');
  }
  return verification;
}

/**
 * C57.4, decision 20: the owner key of the sandbox contract wallet signed, the contract accepted
 * it (ERC-1271), and the template does not allow contract wallets, so the address check answered
 * `contract_wallet_not_allowed` and the verification went to review.
 */
export function contractWalletVerification(
  options: Omit<CryptoWalletFixtureOptions, 'attributes'> = {},
): CryptoWalletVerification {
  return cryptoWalletVerification({
    ...options,
    attributes: {
      status: 'needs_review',
      'wallet-address': SANDBOX_CONTRACT_WALLET,
      checks: walletChecks({
        address: {
          status: 'not_applicable',
          reasons: ['contract_wallet_not_allowed'],
          metadata: { scheme: 'eip191', 'high-s': false, 'contract-wallet': true },
          provenance: { ...ADDRESS_PROVENANCE, provider: { id: 'sandbox', sandbox: true } },
        },
      }),
    },
  });
}

/** C57.4: a Bitcoin P2PKH address proven with a high-s BIP-137 signature read loosely. */
export function looseBitcoinVerification(): CryptoWalletVerification {
  return cryptoWalletVerification({
    attributes: {
      'wallet-address': SYNTHETIC_BITCOIN_ADDRESS,
      'chain-id': BITCOIN,
      'signature-scheme': 'bip137',
      checks: walletChecks({
        validity: { metadata: { checksum: 'valid', 'address-type': 'p2pkh' } },
        address: { metadata: { scheme: 'bip137', 'high-s': true, 'bip137-loose': true } },
      }),
    },
  });
}

/**
 * C57.1, C57.4: a Solana program account (off the ed25519 curve), whose control no signature can
 * prove, so the address check answered `ownership_proof_unsupported` and the statement, without
 * a verified signature, `input_missing`: the verification went to review.
 */
export function solanaProgramAccountVerification(): CryptoWalletVerification {
  return cryptoWalletVerification({
    attributes: {
      status: 'needs_review',
      'wallet-address': SYNTHETIC_SOLANA_ADDRESS,
      'chain-id': SOLANA,
      'signature-scheme': 'solana-ed25519',
      checks: walletChecks({
        validity: { metadata: { checksum: 'none', 'address-type': 'solana', 'on-curve': false } },
        statement: { status: 'not_applicable', reasons: ['input_missing'] },
        address: {
          status: 'not_applicable',
          reasons: ['ownership_proof_unsupported'],
          metadata: {},
        },
      }),
    },
  });
}

/**
 * C57.4: a Solana key account that signed the challenge inside a Solana off-chain message
 * (version 1), which the server unwrapped before comparing the challenge.
 */
export function solanaEnvelopeVerification(): CryptoWalletVerification {
  return cryptoWalletVerification({
    attributes: {
      'wallet-address': SYNTHETIC_SOLANA_ADDRESS,
      'chain-id': SOLANA,
      'signature-scheme': 'solana-ed25519',
      checks: walletChecks({
        validity: { metadata: { checksum: 'none', 'address-type': 'solana', 'on-curve': true } },
        statement: { metadata: { envelope: 'solana-offchain-v1' } },
        address: { metadata: { scheme: 'solana-ed25519' } },
      }),
    },
  });
}
