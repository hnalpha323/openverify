/**
 * What the crypto wallet evaluators read (C57): typed objects `api-crypto` builds from the
 * verification, its processed challenge (the message we issued and what the user submitted), the
 * inquiry's expected address and, for an EVM signature that recovers no matching key, the `evmRpc`
 * provider's answer. Addresses, signatures and messages are read, never copied into a result.
 */
import type { CryptoSignatureScheme } from '@openverify/core';
import type { ProviderOutcome } from '../government-id/inputs.js';

/** The challenge the server issued (C57.2). */
export interface CryptoChallengeInput {
  message: string;
}

/** What the user submitted (C57.3 `crypto`). */
export interface CryptoSubmissionInput {
  signature: string;
  signedMessage?: string | null | undefined;
  scheme?: CryptoSignatureScheme | null | undefined;
}

/**
 * The `evmRpc` answer for the claimed address (C57.4, C57.5): whether it holds contract code and,
 * when it does, whether ERC-1271 `isValidSignature` returned exactly `0x1626ba7e` padded to 32
 * bytes (`null` when the call was not made).
 */
export interface ContractWalletResult {
  hasCode: boolean;
  signatureValid: boolean | null;
}

/** The crypto wallet checks (C57.4). */
export interface CryptoWalletCheckInput {
  /** The canonical CAIP-2 chain id the user chose, or `null`. */
  chainId: string | null;
  /** The claimed address, or `null` when none was entered. */
  walletAddress: string | null;
  /** The inquiry field `crypto_wallet_address`, when set. */
  expectedAddress?: string | null | undefined;
  /** The processed challenge, or `null` without one. */
  challenge: CryptoChallengeInput | null;
  /** The submitted signature, or `null` without one. */
  submission: CryptoSubmissionInput | null;
  /** The `evmRpc` answer; absent when the job asked none (`cryptoWalletContractCheck` says when). */
  contractWallet?: ProviderOutcome<ContractWalletResult> | undefined;
}
