/**
 * `crypto_wallet_statement_comparison` (R, fraud, required, C57.4): the verified signature covers
 * exactly the challenge we issued. It passes only when the address check's signature verified
 * (a key's, or a contract wallet's ERC-1271 answer) over bytes that equal the challenge's UTF-8
 * bytes, after unwrapping a Solana off-chain envelope that names the claimed key among its
 * signatories. A verified signature over other bytes fails `statement_mismatch` (a replayed or
 * altered message); without a verified signature it answers `input_missing`.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { equalBytes, utf8 } from './bytes.js';
import type { CryptoWalletContext } from './context.js';
import { isSolanaOffchainEnvelope, unwrapSolanaOffchainMessage } from './solana-offchain.js';

const CHECK_ID = 'crypto_wallet_statement_comparison';

/**
 * Whether `signedBytes` are our challenge: its UTF-8 bytes exactly, or (Solana) an off-chain
 * envelope of them that names the claimed key among its signatories. `null` for any other bytes;
 * the envelope's version when one was unwrapped. The address check reads it too (Workflow 5C
 * review P004): a signature over any other bytes proves no control here.
 */
export function challengeCoverage(
  context: CryptoWalletContext,
  signedBytes: Uint8Array,
): { readonly envelope: 0 | 1 | null } | null {
  const challenge = context.input.challenge;
  if (challenge === null || context.address?.valid !== true) {
    return null;
  }
  const expected = utf8(challenge.message);
  if (context.address.address.family === 'solana' && isSolanaOffchainEnvelope(signedBytes)) {
    const envelope = unwrapSolanaOffchainMessage(signedBytes);
    const signer = context.address.address.payload;
    return envelope !== null &&
      envelope.signatories.some((key) => equalBytes(key, signer)) &&
      equalBytes(envelope.content, expected)
      ? { envelope: envelope.version }
      : null;
  }
  return equalBytes(signedBytes, expected) ? { envelope: null } : null;
}

export function cryptoWalletStatementComparison(context: CryptoWalletContext): CheckResult {
  const signedBytes = verifiedBytes(context);
  if (signedBytes === null || context.input.challenge === null || context.address?.valid !== true) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing']);
  }
  const covered = challengeCoverage(context, signedBytes);
  if (covered === null) {
    return checkResult(CHECK_ID, 'failed', ['statement_mismatch']);
  }
  return covered.envelope === null
    ? checkResult(CHECK_ID, 'passed')
    : checkResult(CHECK_ID, 'passed', [], {
        envelope: `solana-offchain-v${String(covered.envelope)}`,
      });
}

/**
 * The bytes a signature verified for the claimed address: a key's, or a contract wallet's whose
 * ERC-1271 answer accepted them; `null` without such a signature.
 */
function verifiedBytes(context: CryptoWalletContext): Uint8Array | null {
  const { verification } = context;
  if (verification?.outcome === 'verified') {
    return verification.signedBytes;
  }
  const contract = context.input.contractWallet;
  const contractAccepted =
    contract?.kind === 'result' &&
    contract.result.hasCode &&
    contract.result.signatureValid === true;
  return contractAccepted &&
    (verification?.outcome === 'address_mismatch' || verification?.outcome === 'not_recovered') &&
    verification.contractCheck !== null
    ? verification.signedBytes
    : null;
}
