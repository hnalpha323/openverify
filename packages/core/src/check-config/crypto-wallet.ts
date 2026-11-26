/**
 * Crypto wallet check config (C51.3, C57). Owned by `checks-contact-crypto` in Workflow 5A
 * Stage 2; amendments to these keys are recorded in the plan.
 */
import { z } from 'zod';
import { defaultsTable, provisionalDefault } from './basis.js';

/** How strictly a BIP-137 header must name the address type (C57.1). */
export const BIP137_MODES = ['strict', 'loose'] as const;

export const cryptoWalletValidityDetectionConfigSchema = z.strictObject({
  /** Refuse an EVM address without its EIP-55 checksum, at challenge creation (C57.2). */
  'require-evm-checksum': z.boolean().optional(),
});

export const cryptoWalletAddressComparisonConfigSchema = z.strictObject({
  'bip137-mode': z.enum(BIP137_MODES).optional(),
  /** Accept a high-s ECDSA message signature, with a flag. */
  'allow-high-s': z.boolean().optional(),
  /** Let a contract wallet (ERC-1271) pass without an equal expected address (C57.4). */
  'allow-contract-wallets': z.boolean().optional(),
});

/** C51.3: the crypto wallet check defaults. */
export const CRYPTO_WALLET_CHECK_CONFIG_DEFAULTS = defaultsTable({
  crypto_wallet_validity_detection: {
    'require-evm-checksum': provisionalDefault(
      false,
      'research C5 (docs/research/phase5-libraries.md, owner item C5; decision 19): an all-lower or all-upper EVM address is valid and flagged checksum: absent',
    ),
  },
  crypto_wallet_address_comparison: {
    'bip137-mode': provisionalDefault(
      'loose',
      'research C5 (decision 19): wallets sign segwit addresses with legacy headers, so loose, restricted to the claimed script type',
    ),
    'allow-high-s': provisionalDefault(
      true,
      'EIP-2 refuses high-s in transactions only; a message signature with high s is flagged, not refused (decision 19)',
    ),
    'allow-contract-wallets': provisionalDefault(
      false,
      'ours (decision 20): a contract wallet proves control of a contract, not of a person, so it goes to review',
    ),
  },
});
