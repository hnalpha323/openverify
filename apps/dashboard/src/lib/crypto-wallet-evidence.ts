/**
 * The crypto wallet evidence as the console shows it (C52.8, C57, C66), read from the
 * verification answer only: the claimed and expected addresses (PII, exactly as the API masked
 * them for this operator), the chain and the signature scheme, and from the checks the address
 * type, the checksum and the flags. Metadata is `unknown` in the contract, so a value of the wrong
 * shape counts as not recorded.
 */
import type { VerificationResource } from '@openverify/contracts';
import type { CheckProvider } from '@openverify/core';
import { metadataString } from './otp-evidence';

export type CryptoWalletVerification = Extract<
  VerificationResource,
  { type: 'verification/crypto-wallet' }
>;

/**
 * The flag keys the checks record (C57.4), in the order the console lists them, with the check
 * that records each and the type of its value.
 */
const FLAG_SOURCES = [
  ['high-s', 'crypto_wallet_address_comparison', 'boolean'],
  ['bip137-loose', 'crypto_wallet_address_comparison', 'boolean'],
  ['contract-wallet', 'crypto_wallet_address_comparison', 'boolean'],
  ['on-curve', 'crypto_wallet_validity_detection', 'boolean'],
  ['envelope', 'crypto_wallet_statement_comparison', 'string'],
] as const;

export const CRYPTO_FLAG_KEYS = FLAG_SOURCES.map(([flag]) => flag);
export type CryptoFlagKey = (typeof FLAG_SOURCES)[number][0];

/** One recorded flag and its value. */
export interface CryptoFlag {
  readonly flag: CryptoFlagKey;
  readonly value: string | boolean;
}

export interface CryptoWalletEvidence {
  /** As the API sent it: `null` when masked, redacted or not claimed yet. */
  readonly walletAddress: string | null;
  /** The inquiry's expected address (C57.2), as the API sent it. */
  readonly expectedAddress: string | null;
  readonly chainId: string | null;
  /** The scheme of the consumed challenge, else the address check's. */
  readonly scheme: string | null;
  /** `crypto_wallet_validity_detection`'s `address-type`. */
  readonly addressType: string | null;
  /** `crypto_wallet_validity_detection`'s `checksum`. */
  readonly checksum: string | null;
  /** Every flag the checks recorded, in `CRYPTO_FLAG_KEYS` order. */
  readonly flags: readonly CryptoFlag[];
  /** The EVM RPC the address check asked about a contract wallet (C57.5), or `null`. */
  readonly rpc: CheckProvider | null;
}

export function cryptoWalletEvidenceOf(
  verification: CryptoWalletVerification,
): CryptoWalletEvidence {
  const { attributes } = verification;
  const metadataOf = (name: string) =>
    attributes.checks.find((check) => check.name === name)?.metadata ?? {};
  const validity = metadataOf('crypto_wallet_validity_detection');
  const address = attributes.checks.find(
    (check) => check.name === 'crypto_wallet_address_comparison',
  );
  const flags = FLAG_SOURCES.flatMap(([flag, check, type]): CryptoFlag[] => {
    const value = metadataOf(check)[flag];
    return typeof value === type && (typeof value === 'boolean' || value !== '')
      ? [{ flag, value: value as string | boolean }]
      : [];
  });
  return {
    walletAddress: attributes['wallet-address'] ?? null,
    expectedAddress: attributes['expected-address'] ?? null,
    chainId: attributes['chain-id'] ?? null,
    scheme:
      attributes['signature-scheme'] ??
      metadataString(metadataOf('crypto_wallet_address_comparison'), 'scheme'),
    addressType: metadataString(validity, 'address-type'),
    checksum: metadataString(validity, 'checksum'),
    flags,
    // C57.5: the address check names a provider only when it asked the EVM RPC.
    rpc: address?.provenance?.provider ?? null,
  };
}
