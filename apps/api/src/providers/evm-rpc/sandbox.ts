/**
 * C57.5: the `sandbox` EVM provider (sandbox environments only, ADR 0002 §3d), deterministic on
 * every `eip155` chain:
 *
 * | Address | `eth_getCode` | `isValidSignature(hash, signature)` |
 * |---|---|---|
 * | `0x00000000000000000000000000000000000c0de5` (any case), a contract wallet | synthetic code | the magic value when `signature` is a 65-byte signature of `hash` by its owner key, else `0xffffffff` padded |
 * | any other address, an account without code | `0x` | `0x` (a call to an account runs no code) |
 *
 * The owner key is a fixed test key: the SHA-256 of `openverify/test-wallet/` followed by
 * {@link SANDBOX_CONTRACT_WALLET_OWNER_LABEL}, the derivation the crypto test wallets use. Only
 * its address is here; tests and the e2e derive the key from the label, so no key is committed.
 * A 65-byte owner signature recovers to the owner, never to the contract, so the address check
 * asks this provider (C57.4).
 */
import { recoverEvmSigner } from '@openverify/checks';
import { EVM_CHAIN_ID_PATTERN } from '@openverify/core';
import type { EvmRpcProvider } from '../../ports.js';
import { ProviderError } from '../errors.js';
import { decodeIsValidSignatureCall, ERC1271_MAGIC_VALUE } from './erc1271.js';

/** C57.5: the contract wallet the sandbox serves. */
export const SANDBOX_CONTRACT_WALLET = '0x00000000000000000000000000000000000c0de5';
/** The label of the sandbox contract wallet's owner key (see the file header). */
export const SANDBOX_CONTRACT_WALLET_OWNER_LABEL = 'sandbox/contract-wallet-owner';
/** The address of that owner key, lower-case. */
export const SANDBOX_CONTRACT_WALLET_OWNER = '0x0e956ba07dc897863a2413a7130e9183a0a991b1';

/** Synthetic runtime code (PUSH0 PUSH0 REVERT): anything but `0x` says "a contract lives here". */
const SANDBOX_CONTRACT_CODE = '0x5f5ffd';
/** What the contract answers to a signature it does not accept. */
const NOT_ACCEPTED = `0xffffffff${'0'.repeat(56)}`;
const MAGIC = `${ERC1271_MAGIC_VALUE}${'0'.repeat(56)}`;

/** Resolves on an EVM chain; rejects (`chain_not_configured`) on any other. */
const evmOnly = (chainId: string): Promise<void> =>
  EVM_CHAIN_ID_PATTERN.test(chainId)
    ? Promise.resolve()
    : Promise.reject(
        new ProviderError('The sandbox EVM RPC serves EVM chains only', {
          retryable: false,
          code: 'chain_not_configured',
        }),
      );

const isContractWallet = (address: string): boolean =>
  address.toLowerCase() === SANDBOX_CONTRACT_WALLET;

/** The sandbox EVM provider. */
export function createSandboxEvmRpcProvider(): EvmRpcProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    getCode: (chainId, address) =>
      evmOnly(chainId).then(() => (isContractWallet(address) ? SANDBOX_CONTRACT_CODE : '0x')),
    call: (chainId, request) =>
      evmOnly(chainId).then(() => {
        if (!isContractWallet(request.to)) {
          return '0x';
        }
        const decoded = decodeIsValidSignatureCall(request.data.toLowerCase());
        const signer =
          decoded === null ? null : recoverEvmSigner(decoded.digest, decoded.signature);
        return signer?.address === SANDBOX_CONTRACT_WALLET_OWNER ? MAGIC : NOT_ACCEPTED;
      }),
  };
}
