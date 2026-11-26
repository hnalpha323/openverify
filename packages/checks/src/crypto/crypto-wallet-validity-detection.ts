/**
 * `crypto_wallet_validity_detection` (R, user behaviour, category `fraud`, required, C57.4): the
 * claimed address is an address of its chain (`validateCryptoAddress`). A wrong checksum fails
 * `address_checksum_invalid`, any other malformed address `address_invalid`; with
 * `require-evm-checksum` an EVM address without its EIP-55 checksum fails
 * `address_checksum_invalid` too. No chain or address, or a chain Phase 5 does not know, answers
 * `input_missing`. Metadata: the checksum state, the address kind and, for Solana, `on-curve`;
 * never the address.
 */
import type { CheckResult } from '@openverify/core';
import { booleanIn, phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import { validateCryptoAddress } from './addresses.js';
import type { CryptoWalletContext } from './context.js';

const CHECK_ID = 'crypto_wallet_validity_detection';
const KEYS = ['require-evm-checksum'] as const;

export function cryptoWalletValidityDetection(context: CryptoWalletContext): CheckResult {
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const options = phase5ResultOptions(config, KEYS);
  const { chainId, walletAddress } = context.input;
  if (context.address === null || chainId === null || walletAddress === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const validation = validateCryptoAddress(chainId, walletAddress, {
    requireEvmChecksum: booleanIn(config, 'require-evm-checksum', false),
  });
  if (!validation.valid) {
    return checkResult(CHECK_ID, 'failed', [validation.reason], {}, options);
  }
  const { address } = validation;
  return checkResult(
    CHECK_ID,
    'passed',
    [],
    {
      checksum: address.checksum,
      'address-type': address.kind,
      ...(address.onCurve === undefined ? {} : { 'on-curve': address.onCurve }),
    },
    options,
  );
}
