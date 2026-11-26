/**
 * Address validity per chain (C57.1) against the BIP-173 and BIP-350 lists, the EIP-55 vectors,
 * published TRON and XRP Ledger addresses, seeded keys, and (dev only) the
 * bitcoin-address-validation oracle.
 */
import { base58, createBase58check, hex } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { Network, validate as oracleValidate } from 'bitcoin-address-validation';
import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import { cryptoAddressesEqual, validateCryptoAddress } from './addresses.js';
import {
  BITCOIN_CHAIN,
  BITCOIN_TESTNET_CHAIN,
  DOGECOIN_CHAIN,
  ETHEREUM_CHAIN,
  LITECOIN_CHAIN,
  SOLANA_CHAIN,
  TRON_CHAIN,
  XRPL_CHAIN,
  bitcoinTestAddresses,
  evmTestAddress,
  solanaProgramDerivedAddress,
  solanaTestKey,
  testPrivateKey,
  tronTestAddress,
} from './testing.js';
import { EIP55_TEST_ADDRESSES } from './vectors/ethereum.js';
import {
  BIP173_INVALID_ADDRESSES,
  BIP350_INVALID_ADDRESSES,
  BIP350_VALID_ADDRESSES,
} from './vectors/segwit-addresses.js';

const valid = (chainId: string, address: string) => {
  const result = validateCryptoAddress(chainId, address);
  if (!result.valid) {
    throw new Error(`${address} refused on ${chainId}: ${result.reason}`);
  }
  return result.address;
};
const reasonOf = (chainId: string, address: string, requireEvmChecksum = false) => {
  const result = validateCryptoAddress(chainId, address, { requireEvmChecksum });
  return result.valid ? 'valid' : result.reason;
};
/** Replaces the last character with another of the same alphabet. */
const lastCharacterChanged = (address: string, alphabet: string) => {
  const last = address.at(-1) ?? '';
  const replacement = alphabet[(alphabet.indexOf(last) + 1) % alphabet.length] ?? '';
  return `${address.slice(0, -1)}${replacement}`;
};
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

describe('EVM addresses', () => {
  it('accepts the EIP-55 vectors on any EVM chain, flagging the unchecksummed ones', () => {
    for (const address of EIP55_TEST_ADDRESSES) {
      for (const chainId of [ETHEREUM_CHAIN, 'eip155:137', 'eip155:8453']) {
        const decoded = valid(chainId, address);
        expect(decoded).toMatchObject({
          family: 'evm',
          kind: 'evm',
          canonical: address.toLowerCase(),
        });
        expect(decoded.payload).toHaveLength(20);
      }
    }
    expect(valid(ETHEREUM_CHAIN, EIP55_TEST_ADDRESSES[0] ?? '').checksum).toBe('absent');
    expect(valid(ETHEREUM_CHAIN, EIP55_TEST_ADDRESSES[4] ?? '').checksum).toBe('valid');
  });

  it('fails a wrong mixed case as a checksum error, and a missing one only when required', () => {
    const published = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
    expect(reasonOf(ETHEREUM_CHAIN, published.replace('aAeb', 'aaeb'))).toBe(
      'address_checksum_invalid',
    );
    expect(reasonOf(ETHEREUM_CHAIN, published.toLowerCase(), true)).toBe(
      'address_checksum_invalid',
    );
    expect(reasonOf(ETHEREUM_CHAIN, published, true)).toBe('valid');
  });

  it.each([
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe',
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAedd',
    '0X5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeg',
    ' 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '',
  ])('refuses %j', (address) => {
    expect(reasonOf(ETHEREUM_CHAIN, address)).toBe('address_invalid');
  });
});

describe('Bitcoin segwit addresses (BIP-173, BIP-350)', () => {
  it.each(BIP350_VALID_ADDRESSES)('accepts $address', ({ address, scriptPubKey }) => {
    const chainId = address.toLowerCase().startsWith('tb') ? BITCOIN_TESTNET_CHAIN : BITCOIN_CHAIN;
    const decoded = valid(chainId, address);
    const version = decoded.witnessVersion ?? -1;
    const versionByte = version === 0 ? '00' : (0x50 + version).toString(16);
    const length = decoded.payload.length.toString(16).padStart(2, '0');
    expect(`${versionByte}${length}${hex.encode(decoded.payload)}`).toBe(scriptPubKey);
    expect(decoded.canonical).toBe(address.toLowerCase());
    expect(decoded.checksum).toBe('valid');
  });

  it('names the segwit kinds', () => {
    expect(valid(BITCOIN_CHAIN, 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4').kind).toBe('p2wpkh');
    expect(
      valid(BITCOIN_TESTNET_CHAIN, 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7')
        .kind,
    ).toBe('p2wsh');
    expect(
      valid(BITCOIN_CHAIN, 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0').kind,
    ).toBe('p2tr');
    expect(valid(BITCOIN_CHAIN, 'BC1SW50QGDZ25J').kind).toBe('witness_unknown');
  });

  it.each([...BIP350_INVALID_ADDRESSES, ...BIP173_INVALID_ADDRESSES])(
    'refuses $address ($reason)',
    ({ address, reason }) => {
      const expected =
        /checksum/i.test(reason) && !/character/i.test(reason)
          ? 'address_checksum_invalid'
          : 'address_invalid';
      const chainId = address.toLowerCase().startsWith('tb')
        ? BITCOIN_TESTNET_CHAIN
        : BITCOIN_CHAIN;
      expect(reasonOf(chainId, address)).toBe(expected);
    },
  );

  it('refuses an address of the other network and one longer than 90 characters', () => {
    expect(reasonOf(BITCOIN_TESTNET_CHAIN, 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4')).toBe(
      'address_invalid',
    );
    expect(reasonOf(BITCOIN_CHAIN, `bc1q${'q'.repeat(87)}`)).toBe('address_invalid');
  });
});

describe('Bitcoin base58 addresses and the oracle', () => {
  it('accepts every single-key address of seeded keys, as the oracle does', () => {
    for (let index = 0; index < 25; index += 1) {
      const key = testPrivateKey(`bitcoin/${String(index)}`);
      for (const [network, chainId, oracleNetwork] of [
        ['bitcoin', BITCOIN_CHAIN, Network.mainnet],
        ['testnet', BITCOIN_TESTNET_CHAIN, Network.testnet],
      ] as const) {
        const addresses = bitcoinTestAddresses(key, network);
        const kinds = {
          p2pkh: 'p2pkh',
          p2pkhUncompressed: 'p2pkh',
          p2shP2wpkh: 'p2sh',
          p2wpkh: 'p2wpkh',
          p2wsh: 'p2wsh',
          p2tr: 'p2tr',
        } as const;
        for (const [name, address] of Object.entries(addresses) as [keyof typeof kinds, string][]) {
          expect(oracleValidate(address, oracleNetwork)).toBe(true);
          expect(valid(chainId, address).kind).toBe(kinds[name]);
          const other = network === 'bitcoin' ? BITCOIN_TESTNET_CHAIN : BITCOIN_CHAIN;
          expect(reasonOf(other, address)).toBe('address_invalid');
          const alphabet = address.startsWith('bc1') || address.startsWith('tb1') ? BECH32 : BASE58;
          const typo = lastCharacterChanged(address, alphabet);
          expect(oracleValidate(typo, oracleNetwork)).toBe(false);
          expect(reasonOf(chainId, typo)).toBe('address_checksum_invalid');
        }
      }
    }
  });

  it('keeps base58 addresses exactly as entered', () => {
    const { p2pkh } = bitcoinTestAddresses(testPrivateKey('bitcoin/canonical'), 'bitcoin');
    expect(valid(BITCOIN_CHAIN, p2pkh).canonical).toBe(p2pkh);
    expect(reasonOf(BITCOIN_CHAIN, p2pkh.toLowerCase())).not.toBe('valid');
  });
});

describe('Litecoin and Dogecoin addresses', () => {
  it('accepts Litecoin L, M, legacy 3 and ltc1 addresses, and no Bitcoin-only form', () => {
    const key = testPrivateKey('litecoin/0');
    const litecoin = bitcoinTestAddresses(key, 'litecoin');
    expect(litecoin.p2pkh.startsWith('L')).toBe(true);
    expect(litecoin.p2shP2wpkh.startsWith('M')).toBe(true);
    expect(valid(LITECOIN_CHAIN, litecoin.p2pkh).kind).toBe('p2pkh');
    expect(valid(LITECOIN_CHAIN, litecoin.p2shP2wpkh).kind).toBe('p2sh');
    expect(valid(LITECOIN_CHAIN, litecoin.p2wpkh).kind).toBe('p2wpkh');
    expect(valid(LITECOIN_CHAIN, litecoin.p2tr).kind).toBe('p2tr');
    const bitcoin = bitcoinTestAddresses(key, 'bitcoin');
    expect(valid(LITECOIN_CHAIN, bitcoin.p2shP2wpkh).kind).toBe('p2sh');
    expect(reasonOf(LITECOIN_CHAIN, bitcoin.p2pkh)).toBe('address_invalid');
    expect(reasonOf(LITECOIN_CHAIN, bitcoin.p2wpkh)).toBe('address_invalid');
  });

  it('accepts Dogecoin D and P2SH addresses and refuses segwit', () => {
    expect(valid(DOGECOIN_CHAIN, 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE').kind).toBe('p2pkh');
    const dogecoin = bitcoinTestAddresses(testPrivateKey('dogecoin/0'), 'dogecoin');
    expect(dogecoin.p2pkh.startsWith('D')).toBe(true);
    expect(valid(DOGECOIN_CHAIN, dogecoin.p2pkh).kind).toBe('p2pkh');
    expect(valid(DOGECOIN_CHAIN, dogecoin.p2shP2wpkh).kind).toBe('p2sh');
    expect(reasonOf(DOGECOIN_CHAIN, dogecoin.p2wpkh)).toBe('address_invalid');
    expect(reasonOf(DOGECOIN_CHAIN, lastCharacterChanged(dogecoin.p2pkh, BASE58))).toBe(
      'address_checksum_invalid',
    );
  });
});

describe('Solana addresses', () => {
  it('accepts 32-byte base58 keys, with no checksum, recording that they are on the curve', () => {
    const { address, publicKey } = solanaTestKey('alice');
    const decoded = valid(SOLANA_CHAIN, address);
    expect(decoded).toMatchObject({
      kind: 'solana',
      checksum: 'none',
      onCurve: true,
      canonical: address,
    });
    expect(decoded.payload).toEqual(publicKey);
  });

  it('accepts a program-derived address and records that no key can sign for it', () => {
    const programId = solanaTestKey('program').publicKey;
    const pda = base58.encode(
      solanaProgramDerivedAddress([new TextEncoder().encode('vault')], programId),
    );
    expect(valid(SOLANA_CHAIN, pda)).toMatchObject({ onCurve: false, checksum: 'none' });
  });

  it.each([
    ['31 bytes', base58.encode(new Uint8Array(31).fill(7))],
    ['33 bytes', base58.encode(new Uint8Array(33).fill(7))],
    ['a character outside the alphabet', `0${solanaTestKey('alice').address.slice(1)}`],
    ['an empty value', ''],
  ])('refuses %s', (_why, address) => {
    expect(reasonOf(SOLANA_CHAIN, address)).toBe('address_invalid');
  });
});

describe('TRON addresses', () => {
  it('accepts the published zero account and seeded addresses', () => {
    const zero = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
    expect(createBase58check(sha256).encode(new Uint8Array([0x41, ...new Uint8Array(20)]))).toBe(
      zero,
    );
    expect(valid(TRON_CHAIN, zero)).toMatchObject({
      kind: 'tron',
      checksum: 'valid',
      canonical: zero,
    });
    for (let index = 0; index < 10; index += 1) {
      const address = tronTestAddress(testPrivateKey(`tron/${String(index)}`));
      expect(address).toHaveLength(34);
      expect(valid(TRON_CHAIN, address).payload).toHaveLength(20);
      expect(reasonOf(TRON_CHAIN, lastCharacterChanged(address, BASE58))).toBe(
        'address_checksum_invalid',
      );
    }
  });

  it('refuses another chain’s base58check and the hex form', () => {
    expect(reasonOf(TRON_CHAIN, 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE')).toBe('address_invalid');
    expect(reasonOf(TRON_CHAIN, `41${'00'.repeat(20)}`)).toBe('address_invalid');
  });
});

describe('XRP Ledger addresses', () => {
  it.each([
    'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    'rrrrrrrrrrrrrrrrrrrrrhoLvTp',
    'rrrrrrrrrrrrrrrrrrrrBZbvji',
  ])('accepts the published address %s', (address) => {
    expect(valid(XRPL_CHAIN, address)).toMatchObject({ kind: 'xrpl', checksum: 'valid' });
  });

  it('fails a typo as a checksum error and refuses X-addresses and Bitcoin addresses', () => {
    expect(reasonOf(XRPL_CHAIN, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTi')).toBe(
      'address_checksum_invalid',
    );
    expect(reasonOf(XRPL_CHAIN, 'X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ')).toBe(
      'address_invalid',
    );
    expect(reasonOf(XRPL_CHAIN, '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs')).toBe('address_invalid');
  });
});

describe('every chain', () => {
  it('refuses an unknown chain and caps the input before decoding', () => {
    expect(reasonOf('cosmos:cosmoshub-4', 'cosmos1qqqqqqqq')).toBe('address_invalid');
    expect(
      cpuMilliseconds(() => {
        for (const chainId of [
          BITCOIN_CHAIN,
          SOLANA_CHAIN,
          TRON_CHAIN,
          XRPL_CHAIN,
          ETHEREUM_CHAIN,
        ]) {
          expect(reasonOf(chainId, '1'.repeat(100_000))).toBe('address_invalid');
          expect(reasonOf(chainId, 'z'.repeat(129))).toBe('address_invalid');
        }
      }),
    ).toBeLessThan(200);
  });
});

describe('cryptoAddressesEqual (C57.2)', () => {
  it('compares EVM addresses without case and bech32 addresses lower-cased', () => {
    const lower = evmTestAddress(testPrivateKey('equal/evm'));
    expect(
      cryptoAddressesEqual(ETHEREUM_CHAIN, lower, lower.toUpperCase().replace('0X', '0x')),
    ).toBe(true);
    expect(
      cryptoAddressesEqual(
        BITCOIN_CHAIN,
        'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      ),
    ).toBe(true);
  });

  it('compares base58 addresses exactly and is false when either side is invalid', () => {
    const { p2pkh } = bitcoinTestAddresses(testPrivateKey('equal/btc'), 'bitcoin');
    expect(cryptoAddressesEqual(BITCOIN_CHAIN, p2pkh, p2pkh)).toBe(true);
    expect(cryptoAddressesEqual(BITCOIN_CHAIN, p2pkh, `${p2pkh} `)).toBe(false);
    expect(cryptoAddressesEqual(ETHEREUM_CHAIN, 'nope', 'nope')).toBe(false);
    const other = evmTestAddress(testPrivateKey('equal/other'));
    expect(
      cryptoAddressesEqual(ETHEREUM_CHAIN, other, evmTestAddress(testPrivateKey('equal/evm'))),
    ).toBe(false);
  });
});
