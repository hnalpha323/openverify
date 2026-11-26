/**
 * C57.2, C57.3: the rules of a wallet challenge that need no database: the chains a verification
 * offers (the step's, within the type's `allowed-chains`), whether an EVM address must carry its
 * EIP-55 checksum (`require-evm-checksum`), the address the inquiry expects (its field
 * `crypto_wallet_address`), the 16-character base62 nonce, and the problems every refusal answers.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';
import { CRYPTO_CHALLENGE_NONCE_LENGTH } from '@openverify/contracts';
import {
  cryptoWalletValidityDetectionConfigSchema,
  type VerificationTemplateConfig,
} from '@openverify/core';
import type { FlowStep } from '@openverify/flow-spec';
import { Phase5ProblemError } from '../../errors.js';

/** The pinned flow's crypto wallet step. */
export type CryptoWalletStep = Extract<FlowStep, { type: 'crypto_wallet' }>;

/** C57.2: the inquiry field a claimed address must equal, once canonicalised, when it is set. */
export const EXPECTED_ADDRESS_FIELD = 'crypto_wallet_address';

/** C57.3: the one body of every refused challenge (its golden problem's detail). */
export const CRYPTO_CHALLENGE_INVALID_DETAIL =
  'The challenge is unknown, used, superseded or expired; create a new one.';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 409 `crypto_challenge_invalid`, with the one detail of C57.3 unless told otherwise. */
export function cryptoChallengeInvalid(
  detail: string = CRYPTO_CHALLENGE_INVALID_DETAIL,
): Phase5ProblemError {
  return new Phase5ProblemError('crypto_challenge_invalid', detail);
}

/** 422 `crypto_chain_not_offered`. */
export function cryptoChainNotOffered(): Phase5ProblemError {
  return new Phase5ProblemError(
    'crypto_chain_not_offered',
    'This chain is not offered in this verification.',
  );
}

/** 422 `crypto_address_invalid`. */
export function cryptoAddressInvalid(): Phase5ProblemError {
  return new Phase5ProblemError(
    'crypto_address_invalid',
    'The wallet address is not valid for the chain.',
  );
}

/** 422 `crypto_expected_address_mismatch`. */
export function cryptoExpectedAddressMismatch(): Phase5ProblemError {
  return new Phase5ProblemError(
    'crypto_expected_address_mismatch',
    'The wallet address is not the one this verification expects.',
  );
}

/** C57.2: the step's chains that the type's `allowed-chains` (when set) also allows, in order. */
export function offeredCryptoChains(
  step: CryptoWalletStep,
  config: VerificationTemplateConfig | undefined,
): string[] {
  const allowed = config?.['allowed-chains'];
  return allowed === undefined
    ? [...step.chains]
    : step.chains.filter((chain) => allowed.includes(chain));
}

/** C51.3: whether the enabled validity check sets `require-evm-checksum`. */
export function requiresEvmChecksum(config: VerificationTemplateConfig | undefined): boolean {
  const check = config?.checks.crypto_wallet_validity_detection;
  if (check?.enabled !== true) {
    return false;
  }
  const parsed = cryptoWalletValidityDetectionConfigSchema.safeParse(check.config ?? {});
  return parsed.success && parsed.data['require-evm-checksum'] === true;
}

/** C57.2: the inquiry's expected address (a non-empty string field), or `null`. PII. */
export function expectedCryptoAddressOf(
  fields: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  const value = fields?.[EXPECTED_ADDRESS_FIELD];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** C57.2: a new 16-character base62 nonce from a CSPRNG (`randomInt` returns `[0, max)`). */
export function newCryptoChallengeNonce(
  randomInt: (max: number) => number = (max) => cryptoRandomInt(max),
): string {
  let nonce = '';
  for (let index = 0; index < CRYPTO_CHALLENGE_NONCE_LENGTH; index += 1) {
    nonce += BASE62[randomInt(BASE62.length)] ?? '';
  }
  return nonce;
}
