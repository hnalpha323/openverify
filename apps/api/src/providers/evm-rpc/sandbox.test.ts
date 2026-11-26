/**
 * C57.5: the sandbox EVM provider. Its contract wallet accepts its owner key's 65-byte signature
 * of the digest and nothing else; every other address is an account without code. The owner key
 * comes from its label (no key is committed); every signature here is a test wallet's.
 */
import { eip191Digest, recoverEvmSigner } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import { signTestDigest, testWalletAddress } from '../../services/crypto-challenges/testing.js';
import type { EvmRpcProvider } from '../../ports.js';
import { ProviderError } from '../errors.js';
import { ERC1271_CALL_GAS, encodeIsValidSignatureCall, isErc1271MagicResult } from './erc1271.js';
import {
  SANDBOX_CONTRACT_WALLET,
  SANDBOX_CONTRACT_WALLET_OWNER,
  SANDBOX_CONTRACT_WALLET_OWNER_LABEL,
  createSandboxEvmRpcProvider,
} from './sandbox.js';

/** A fresh provider per call, so a stub fails each test on its own. */
const sandbox = (): EvmRpcProvider => createSandboxEvmRpcProvider();
const DIGEST = eip191Digest(new TextEncoder().encode('synthetic challenge'));
const isValidSignature = (signature: Uint8Array, to = SANDBOX_CONTRACT_WALLET) =>
  sandbox().call('eip155:1', {
    to,
    data: encodeIsValidSignatureCall(DIGEST, signature),
    gas: ERC1271_CALL_GAS,
  });

describe('the sandbox EVM provider (C57.5)', () => {
  it('is the sandbox, and its owner address is the address of the labelled test key', () => {
    const rpc = sandbox();
    expect({ id: rpc.id, sandbox: rpc.sandbox }).toEqual({ id: 'sandbox', sandbox: true });
    expect(SANDBOX_CONTRACT_WALLET_OWNER).toBe(
      testWalletAddress(SANDBOX_CONTRACT_WALLET_OWNER_LABEL),
    );
  });

  it('serves code at the contract wallet in any case, on any EVM chain, and none elsewhere', async () => {
    const rpc = sandbox();
    for (const chain of ['eip155:1', 'eip155:8453']) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(await rpc.getCode(chain, SANDBOX_CONTRACT_WALLET)).toMatch(/^0x(?:[0-9a-f]{2})+$/u);
      expect(
        await rpc.getCode(chain, SANDBOX_CONTRACT_WALLET.toUpperCase().replace('0X', '0x')),
      ).not.toBe('0x');
      expect(await rpc.getCode(chain, testWalletAddress('sandbox/someone'))).toBe('0x');
    }
  });

  it("accepts the owner's signature of the digest, which recovers to the owner, not the contract", async () => {
    const signature = signTestDigest(DIGEST, SANDBOX_CONTRACT_WALLET_OWNER_LABEL);

    expect(recoverEvmSigner(DIGEST, signature)?.address).toBe(SANDBOX_CONTRACT_WALLET_OWNER);
    expect(isErc1271MagicResult(await isValidSignature(signature))).toBe(true);
  });

  it('refuses another key, another digest and bytes that are no signature', async () => {
    const rpc = sandbox();
    const other = signTestDigest(DIGEST, 'sandbox/someone');
    const otherDigest = signTestDigest(
      eip191Digest(new TextEncoder().encode('another challenge')),
      SANDBOX_CONTRACT_WALLET_OWNER_LABEL,
    );

    for (const signature of [other, otherDigest, new Uint8Array(65), new Uint8Array(12).fill(1)]) {
      const answer = await isValidSignature(signature);
      expect(answer).toBe(`0xffffffff${'0'.repeat(56)}`);
      expect(isErc1271MagicResult(answer)).toBe(false);
    }
    expect(
      await rpc.call('eip155:1', { to: SANDBOX_CONTRACT_WALLET, data: '0x1234', gas: 1 }),
    ).toBe(`0xffffffff${'0'.repeat(56)}`);
  });

  it('runs no code at an account without code', async () => {
    const signature = signTestDigest(DIGEST, SANDBOX_CONTRACT_WALLET_OWNER_LABEL);

    expect(await isValidSignature(signature, SANDBOX_CONTRACT_WALLET_OWNER)).toBe('0x');
  });

  it('answers EVM chains only', async () => {
    const rpc = sandbox();
    await expect(
      rpc.getCode('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', SANDBOX_CONTRACT_WALLET),
    ).rejects.toMatchObject({
      code: 'chain_not_configured',
      retryable: false,
    });
    await expect(
      rpc.call('tron:728126428', { to: SANDBOX_CONTRACT_WALLET, data: '0x', gas: 1 }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
