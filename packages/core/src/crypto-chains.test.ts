import { describe, expect, it } from 'vitest';
import {
  CRYPTO_CHAINS,
  CRYPTO_INPUT_LIMITS,
  CRYPTO_SIGNATURE_SCHEMES,
  EVM_CHAIN_ID_PATTERN,
  cryptoChainFamily,
  cryptoChainIdSchema,
  cryptoChainSchemes,
  isCryptoChainId,
  normalizeCryptoChainId,
} from './crypto-chains.js';

/**
 * C57.1, checked against the ChainAgnostic namespaces repository at commit 463bae5 (2026-09-03):
 * `bip122/caip2.md` (the first 32 hex characters of the genesis block hash), `solana/caip2.md`
 * (the first 32 characters of the base58 genesis hash), `tron/caip2.md` (the decimal chain id;
 * the hexadecimal `tron:0x2b6653dc` is a deprecated alias), `xrpl/caip2.md` (the network id)
 * and `eip155/caip2.md` (the decimal EIP-155 chain id).
 */
const FIXED_CHAINS = [
  ['bip122:000000000019d6689c085ae165831e93', 'bitcoin', 'Bitcoin'],
  ['bip122:000000000933ea01ad0ee984209779ba', 'bitcoin', 'Bitcoin testnet'],
  ['bip122:12a765e31ffd4059bada1e25190f6e98', 'litecoin', 'Litecoin'],
  ['bip122:1a91e3dace36e2be3bf030a65679fe82', 'dogecoin', 'Dogecoin'],
  ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana', 'Solana'],
  ['tron:728126428', 'tron', 'TRON'],
  ['xrpl:0', 'xrpl', 'XRP Ledger'],
] as const;

describe('CRYPTO_CHAINS (C57.1)', () => {
  it('lists the fixed-id chains with their CAIP-2 ids, families and names, in order', () => {
    expect(CRYPTO_CHAINS.map(({ id, family, name }) => [id, family, name])).toEqual(FIXED_CHAINS);
    expect(Object.isFrozen(CRYPTO_CHAINS)).toBe(true);
  });

  it('names the ownership proofs each chain accepts', () => {
    expect(cryptoChainSchemes('eip155:1')).toEqual(['eip191']);
    expect(cryptoChainSchemes('bip122:000000000019d6689c085ae165831e93')).toEqual([
      'bip137',
      'bip322-simple',
      'bip322-legacy',
    ]);
    expect(cryptoChainSchemes('bip122:000000000933ea01ad0ee984209779ba')).toEqual([
      'bip137',
      'bip322-simple',
      'bip322-legacy',
    ]);
    expect(cryptoChainSchemes('bip122:12a765e31ffd4059bada1e25190f6e98')).toEqual(['bip137']);
    expect(cryptoChainSchemes('bip122:1a91e3dace36e2be3bf030a65679fe82')).toEqual(['bip137']);
    expect(cryptoChainSchemes('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toEqual([
      'solana-ed25519',
    ]);
    expect(cryptoChainSchemes('tron:728126428')).toEqual(['tron-v2']);
    // XRP: validity only; no ownership proof exists for it (C50.4).
    expect(cryptoChainSchemes('xrpl:0')).toEqual([]);
    expect(cryptoChainSchemes('cosmos:cosmoshub-4')).toEqual([]);
  });

  it('only names signature schemes from the C57.3 list', () => {
    const named = new Set(CRYPTO_CHAINS.flatMap((chain) => chain.schemes));
    for (const scheme of named) {
      expect(CRYPTO_SIGNATURE_SCHEMES).toContain(scheme);
    }
    expect(CRYPTO_SIGNATURE_SCHEMES).toEqual([
      'eip191',
      'bip137',
      'bip322-simple',
      'bip322-legacy',
      'solana-ed25519',
      'tron-v2',
    ]);
  });
});

describe('chain ids', () => {
  it.each([
    'eip155:1',
    'eip155:137',
    'eip155:11155111',
    `eip155:${'9'.repeat(32)}`,
    ...FIXED_CHAINS.map(([id]) => id),
  ])('accepts %s', (id) => {
    expect(isCryptoChainId(id)).toBe(true);
    expect(cryptoChainIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    'eip155:0',
    'eip155:01',
    'eip155:-1',
    'eip155:',
    `eip155:${'9'.repeat(33)}`,
    'eip155:1 ',
    'EIP155:1',
    // The hexadecimal TRON form is a deprecated alias: normalise it first.
    'tron:0x2b6653dc',
    'tron:2494104990',
    'bip122:000000000019D6689C085AE165831E93',
    'bip122:000000000000000000651ef99cb9fcbe',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    'xrpl:1',
    'cosmos:cosmoshub-4',
    '',
    'constructor',
  ])('refuses %j', (id) => {
    expect(isCryptoChainId(id)).toBe(false);
    expect(cryptoChainIdSchema.safeParse(id).success).toBe(false);
  });

  it('refuses values that are not strings', () => {
    expect(isCryptoChainId(1)).toBe(false);
    expect(isCryptoChainId(null)).toBe(false);
    expect(cryptoChainIdSchema.safeParse(1).success).toBe(false);
  });

  it('matches EVM chains by the eip155 pattern', () => {
    expect(EVM_CHAIN_ID_PATTERN.test('eip155:10')).toBe(true);
    expect(EVM_CHAIN_ID_PATTERN.test('eip155:0')).toBe(false);
  });

  it('names the family of a chain, or null for one it does not know', () => {
    expect(cryptoChainFamily('eip155:8453')).toBe('evm');
    expect(cryptoChainFamily('bip122:000000000019d6689c085ae165831e93')).toBe('bitcoin');
    expect(cryptoChainFamily('bip122:000000000933ea01ad0ee984209779ba')).toBe('bitcoin');
    expect(cryptoChainFamily('bip122:12a765e31ffd4059bada1e25190f6e98')).toBe('litecoin');
    expect(cryptoChainFamily('bip122:1a91e3dace36e2be3bf030a65679fe82')).toBe('dogecoin');
    expect(cryptoChainFamily('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe('solana');
    expect(cryptoChainFamily('tron:728126428')).toBe('tron');
    expect(cryptoChainFamily('xrpl:0')).toBe('xrpl');
    expect(cryptoChainFamily('xrpl:1')).toBeNull();
    expect(cryptoChainFamily('toString')).toBeNull();
  });

  it('normalises the deprecated hexadecimal TRON id and leaves every other value as it is', () => {
    expect(normalizeCryptoChainId('tron:0x2b6653dc')).toBe('tron:728126428');
    expect(normalizeCryptoChainId('tron:728126428')).toBe('tron:728126428');
    expect(normalizeCryptoChainId('eip155:1')).toBe('eip155:1');
    expect(normalizeCryptoChainId('anything')).toBe('anything');
  });
});

describe('CRYPTO_INPUT_LIMITS (C57.1)', () => {
  it('bounds the address, the signature and the signed message', () => {
    expect(CRYPTO_INPUT_LIMITS).toEqual({
      addressMaxLength: 128,
      signatureMaxLength: 1024,
      messageMaxBytes: 4096,
    });
    expect(Object.isFrozen(CRYPTO_INPUT_LIMITS)).toBe(true);
  });
});
