/**
 * `crypto_wallet_address_comparison` (R+A, user behaviour, category `fraud`, required, C57.4): the
 * signature over our single-use challenge proves control of the claimed address. The signed bytes
 * must be that challenge, or a Solana off-chain envelope of it naming the claimed key; a valid
 * signature over any other bytes fails `signature_invalid` (Workflow 5C review P004), so the
 * binding holds even with the statement check advisory or disabled.
 *
 * - No chain, address, challenge or submission, or an invalid address: `input_missing`.
 * - An inquiry `expected-address` that differs after canonicalisation: `expected_address_mismatch`.
 * - A key's signature that verifies for the address passes, flagged `high-s` and `bip137-loose`;
 *   a high-s ECDSA signature fails `signature_invalid` unless `allow-high-s` (default true).
 * - A valid signature by another key: `signature_address_mismatch`; a malformed or failing one:
 *   `signature_invalid`; a form we cannot verify (BIP-322 full or proof of funds, P2WSH, a P2SH
 *   script, an ERC-6492 envelope): `signature_inconclusive` (review).
 * - XRP Ledger, or a Solana program account: `ownership_proof_unsupported` (review).
 * - EVM, when no key matches: with `evmRpc` unbound `provider_not_configured`, failed
 *   `execution_error` (ADR 0002 §3e, decision 51: review); no code at the address fails
 *   `signature_address_mismatch` (or `signature_invalid` for bytes no key could have made); code
 *   whose ERC-1271 answer is the magic value passes only with `allow-contract-wallets` or an equal
 *   `expected-address`, else `contract_wallet_not_allowed` (review), flagged `contract-wallet`;
 *   any other ERC-1271 answer fails `signature_invalid`.
 *
 * Metadata: the scheme and the flags; never an address, signature or message.
 */
import type { CheckResult } from '@openverify/core';
import { booleanIn, phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult, type CheckResultOptions } from '../result.js';
import { cryptoAddressesEqual } from './addresses.js';
import type { CryptoWalletContext } from './context.js';
import { challengeCoverage } from './crypto-wallet-statement-comparison.js';
import type { WalletSignatureVerification } from './verify.js';

const CHECK_ID = 'crypto_wallet_address_comparison';
const KEYS = ['bip137-mode', 'allow-high-s', 'allow-contract-wallets'] as const;

export function cryptoWalletAddressComparison(context: CryptoWalletContext): CheckResult {
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const options = phase5ResultOptions(config, KEYS);
  const { input, address, verification } = context;
  if (address?.valid !== true || verification === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const expected = input.expectedAddress ?? null;
  if (
    expected !== null &&
    !cryptoAddressesEqual(address.address.chainId, address.address.canonical, expected)
  ) {
    return checkResult(CHECK_ID, 'failed', ['expected_address_mismatch'], {}, options);
  }
  const fail = (reason: string, metadata: Record<string, unknown> = {}, extra = options) =>
    checkResult(CHECK_ID, 'failed', [reason], metadata, extra);
  const review = (reason: string, metadata: Record<string, unknown> = {}, extra = options) =>
    checkResult(CHECK_ID, 'not_applicable', [reason], metadata, extra);
  switch (verification.outcome) {
    case 'unsupported':
      return review('ownership_proof_unsupported');
    case 'inconclusive':
      return review('signature_inconclusive', schemeOf(verification));
    case 'invalid':
      return fail('signature_invalid', schemeOf(verification));
    case 'verified': {
      const metadata = flagsOf(verification);
      // Workflow 5C review P004: a signature over bytes that are not our challenge proves
      // nothing here, whatever the statement check is set to.
      if (challengeCoverage(context, verification.signedBytes) === null) {
        return fail('signature_invalid', metadata);
      }
      return verification.highS && !booleanIn(config, 'allow-high-s', true)
        ? fail('signature_invalid', metadata)
        : checkResult(CHECK_ID, 'passed', [], metadata, options);
    }
    case 'address_mismatch':
    case 'not_recovered':
      if (verification.contractCheck === null) {
        return fail('signature_address_mismatch', flagsOf(verification));
      }
      // P004: a contract can accept only our challenge as proof too.
      if (challengeCoverage(context, verification.signedBytes) === null) {
        return fail('signature_invalid', flagsOf(verification));
      }
      return contractWallet(context, verification, {
        options,
        allowed: booleanIn(config, 'allow-contract-wallets', false) || expected !== null,
        fail,
        review,
      });
  }
}

interface ContractWalletRules {
  options: CheckResultOptions;
  /** `allow-contract-wallets`, or an expected address the claimed one equals. */
  allowed: boolean;
  fail: (
    reason: string,
    metadata?: Record<string, unknown>,
    extra?: CheckResultOptions,
  ) => CheckResult;
  review: (
    reason: string,
    metadata?: Record<string, unknown>,
    extra?: CheckResultOptions,
  ) => CheckResult;
}

/**
 * An EVM signature no claimed key made: only the address's contract code can accept it (C57.4).
 * Without a bound RPC the question cannot be asked (decision 51: review).
 */
function contractWallet(
  context: CryptoWalletContext,
  verification: Extract<
    WalletSignatureVerification,
    { outcome: 'address_mismatch' | 'not_recovered' }
  >,
  rules: ContractWalletRules,
): CheckResult {
  const metadata = flagsOf(verification);
  const outcome = context.input.contractWallet;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return rules.review('provider_not_configured', metadata);
  }
  if (outcome.kind === 'error') {
    return rules.review('execution_error', metadata);
  }
  const withProvider = { ...rules.options, provider: outcome.provider };
  const { hasCode, signatureValid } = outcome.result;
  if (!hasCode) {
    return rules.fail(
      verification.outcome === 'address_mismatch'
        ? 'signature_address_mismatch'
        : 'signature_invalid',
      metadata,
      withProvider,
    );
  }
  const contract = { ...metadata, 'contract-wallet': true };
  if (signatureValid === null) {
    return rules.review('execution_error', contract, withProvider);
  }
  if (!signatureValid) {
    return rules.fail('signature_invalid', contract, withProvider);
  }
  // A contract wallet proves control of a contract, not of a person (decision 20).
  return rules.allowed
    ? checkResult(CHECK_ID, 'passed', [], contract, withProvider)
    : rules.review('contract_wallet_not_allowed', contract, withProvider);
}

function schemeOf(verification: { scheme: string | null }): Record<string, unknown> {
  return verification.scheme === null ? {} : { scheme: verification.scheme };
}

/** The scheme and the flags of a verification: `high-s` for ECDSA schemes, `bip137-loose`. */
function flagsOf(verification: WalletSignatureVerification): Record<string, unknown> {
  const flags: Record<string, unknown> = schemeOf(verification);
  if ('highS' in verification && ECDSA_SCHEMES.has(verification.scheme)) {
    flags['high-s'] = verification.highS;
  }
  if (verification.outcome === 'verified' && verification.bip137Loose) {
    flags['bip137-loose'] = true;
  }
  return flags;
}

/** The schemes whose signature has an `s` that may be high. */
const ECDSA_SCHEMES: ReadonlySet<string> = new Set([
  'eip191',
  'bip137',
  'bip322-legacy',
  'tron-v2',
]);
