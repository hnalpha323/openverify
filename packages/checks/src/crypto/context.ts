/**
 * The shared evaluation context of the crypto wallet checks (C57.4): the input, the template, the
 * validated address and the signature verification, built once per verification by
 * `evaluateCryptoWalletChecks`.
 */
import { isCryptoChainId, type VerificationTemplateConfig } from '@openverify/core';
import { phase5CheckConfig } from '../contact/phase5-config.js';
import { validateCryptoAddress, type CryptoAddressValidation } from './addresses.js';
import type { CryptoWalletCheckInput } from './inputs.js';
import {
  verifyWalletSignature,
  type EvmContractCheck,
  type WalletSignatureVerification,
} from './verify.js';

export interface CryptoWalletContext {
  input: CryptoWalletCheckInput;
  template: VerificationTemplateConfig;
  /** The claimed address's validation, or `null` without a chain or an address. */
  address: CryptoAddressValidation | null;
  /** The signature's verification, or `null` without a valid address, challenge or submission. */
  verification: WalletSignatureVerification | null;
}

/**
 * Builds the context.
 * @throws {InvalidCheckConfigError} when the address check's config breaks its schema.
 */
export function cryptoWalletContext(
  input: CryptoWalletCheckInput,
  template: VerificationTemplateConfig,
): CryptoWalletContext {
  const { chainId, walletAddress, challenge, submission } = input;
  const address =
    chainId === null || walletAddress === null || !isCryptoChainId(chainId)
      ? null
      : validateCryptoAddress(chainId, walletAddress);
  const mode = phase5CheckConfig(template, 'crypto_wallet_address_comparison').values[
    'bip137-mode'
  ];
  const verification =
    address?.valid !== true || challenge === null || submission === null
      ? null
      : verifyWalletSignature({
          address: address.address,
          message: challenge.message,
          signature: submission.signature,
          signedMessage: submission.signedMessage,
          scheme: submission.scheme,
          bip137Mode: mode === 'strict' ? 'strict' : 'loose',
        });
  return { input, template, address, verification };
}

/**
 * The `evmRpc` question the job must ask before it evaluates (C57.4): set when the chain is EVM
 * and the signature does not recover the claimed address, `null` otherwise.
 * @throws {InvalidCheckConfigError} when the address check's config breaks its schema.
 */
export function cryptoWalletContractCheck(
  input: CryptoWalletCheckInput,
  template: VerificationTemplateConfig,
): EvmContractCheck | null {
  const { verification } = cryptoWalletContext(input, template);
  return verification?.outcome === 'address_mismatch' || verification?.outcome === 'not_recovered'
    ? verification.contractCheck
    : null;
}
