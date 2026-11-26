import { CRYPTO_CHAINS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { NAMED_CHAIN_IDS, chainName, isEvmChain } from './chains';

describe('chain names (C57.1)', () => {
  it('names every fixed chain the server knows', () => {
    const missing = CRYPTO_CHAINS.map(({ id }) => id).filter((id) => !NAMED_CHAIN_IDS.includes(id));

    expect(missing).toEqual([]);
  });

  it('names a known EVM network by its message and any other by its number', () => {
    expect(chainName('eip155:1')).toEqual({ key: 'ethereum' });
    expect(chainName('eip155:424242')).toEqual({ key: 'evm', number: '424242' });
    expect(isEvmChain('eip155:424242')).toBe(true);
  });

  it('falls back to the id of a chain it has no words for', () => {
    expect(chainName('cosmos:cosmoshub-4')).toEqual({ key: null, id: 'cosmos:cosmoshub-4' });
    expect(isEvmChain('eip155:0')).toBe(false);
  });
});
