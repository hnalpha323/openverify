/**
 * C83, C82.4: the sandbox `cryptoExposure` provider (sandbox environments only; Phase 6 ships no
 * real adapter). It calls nothing and answers by the address's ending: an EVM address ending in
 * `dead` has indirect exposure (two hops away), one ending in `beef` is in a sanctioned cluster
 * itself, any other EVM address has none, and another chain is not rated. Every address here is
 * synthetic.
 */
import { describe, expect, it } from 'vitest';
import { createCryptoExposureProvider } from './index.js';

const provider = createCryptoExposureProvider('sandbox');
const evm = (ending: string) => `0x${'1'.repeat(40 - ending.length)}${ending}`;

describe('the sandbox crypto exposure provider (C83)', () => {
  it('is labelled a sandbox', () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
  });

  it('rates an EVM address ending in dead as indirectly exposed', async () => {
    await expect(provider.exposure({ chainId: 'eip155:1', address: evm('dead') })).resolves.toEqual(
      {
        outcome: 'rated',
        categories: ['sanctioned_entity'],
        direct: 0,
        indirect: 0.25,
      },
    );
  });

  it('rates an EVM address ending in beef as directly exposed, on any EVM chain', async () => {
    const answer = { outcome: 'rated', categories: ['sanctioned_entity'], direct: 1, indirect: 0 };

    await expect(
      provider.exposure({ chainId: 'eip155:137', address: evm('beef') }),
    ).resolves.toEqual(answer);
    // C79.3: an EVM address the query names no chain for is still EVM.
    await expect(provider.exposure({ chainId: 'unknown', address: evm('beef') })).resolves.toEqual(
      answer,
    );
  });

  it('rates any other EVM address as unexposed', async () => {
    await expect(provider.exposure({ chainId: 'eip155:1', address: evm('cafe') })).resolves.toEqual(
      { outcome: 'rated', categories: [], direct: 0, indirect: 0 },
    );
  });

  it('does not rate another chain: unavailable, never a pass', async () => {
    await expect(
      provider.exposure({
        chainId: 'bip122:000000000019d6689c085ae165831e93',
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      }),
    ).resolves.toEqual({ outcome: 'unavailable', reason: 'unsupported_chain' });
    await expect(
      provider.exposure({ chainId: 'unknown', address: 'not-an-address' }),
    ).resolves.toEqual({ outcome: 'unavailable', reason: 'unsupported_chain' });
  });
});
