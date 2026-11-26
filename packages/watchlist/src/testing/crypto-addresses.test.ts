import { validateCryptoAddress } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import {
  BASE58_BITCOIN,
  BASE58_RIPPLE,
  DEFAULT_CRYPTO_TICKERS,
  PUBLISHED_TEST_ADDRESSES,
  SYNTHETIC_CRYPTO_FORMATS,
  base58CheckEncode,
  base58Encode,
  bech32Bytes,
  cashAddress,
  segwitV0Address,
  syntheticCryptoAddress,
  type SyntheticCryptoFormat,
} from './crypto-addresses.js';
import { seededRandom } from './random.js';

const hex = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'hex'));

const CHAINS = {
  ethereum: 'eip155:1',
  bitcoin: 'bip122:000000000019d6689c085ae165831e93',
  testnet: 'bip122:000000000933ea01ad0ee984209779ba',
  litecoin: 'bip122:12a765e31ffd4059bada1e25190f6e98',
  dogecoin: 'bip122:1a91e3dace36e2be3bf030a65679fe82',
  solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  tron: 'tron:728126428',
  xrpl: 'xrpl:0',
} as const;

/** BIP-173's checksum, verified independently of the encoder under test. */
function bech32Verifies(address: string): boolean {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const separator = address.lastIndexOf('1');
  const hrp = address.slice(0, separator);
  const data = Array.from(address.slice(separator + 1), (character) => CHARSET.indexOf(character));
  const values = [
    ...Array.from(hrp, (character) => character.charCodeAt(0) >> 5),
    0,
    ...Array.from(hrp, (character) => character.charCodeAt(0) & 31),
    ...data,
  ];
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let check = 1;
  for (const value of values) {
    const top = check >>> 25;
    check = (((check & 0x1ffffff) << 5) ^ value) >>> 0;
    generator.forEach((word, bit) => {
      if (((top >>> bit) & 1) === 1) {
        check = (check ^ word) >>> 0;
      }
    });
  }
  return !data.includes(-1) && check === 1;
}

const VALIDATED: Partial<Record<SyntheticCryptoFormat, { chain: string; kind: string }>> = {
  evm_lower: { chain: CHAINS.ethereum, kind: 'evm' },
  evm_checksummed: { chain: CHAINS.ethereum, kind: 'evm' },
  bitcoin_p2pkh: { chain: CHAINS.bitcoin, kind: 'p2pkh' },
  bitcoin_p2sh: { chain: CHAINS.bitcoin, kind: 'p2sh' },
  bitcoin_p2wpkh: { chain: CHAINS.bitcoin, kind: 'p2wpkh' },
  bitcoin_testnet_p2wpkh: { chain: CHAINS.testnet, kind: 'p2wpkh' },
  litecoin_p2pkh: { chain: CHAINS.litecoin, kind: 'p2pkh' },
  litecoin_p2wpkh: { chain: CHAINS.litecoin, kind: 'p2wpkh' },
  dogecoin_p2pkh: { chain: CHAINS.dogecoin, kind: 'p2pkh' },
  solana: { chain: CHAINS.solana, kind: 'solana' },
  tron: { chain: CHAINS.tron, kind: 'tron' },
  xrpl: { chain: CHAINS.xrpl, kind: 'xrpl' },
};

const B58 = '[1-9A-HJ-NP-Za-km-z]';
const SHAPES: Partial<Record<SyntheticCryptoFormat, RegExp>> = {
  bitcoin_cash: /^bitcoincash:q[02-9ac-hj-np-z]{41}$/,
  monero: new RegExp(`^4${B58}{94}$`),
  dash: new RegExp(`^X${B58}{33}$`),
  zcash_transparent: new RegExp(`^t1${B58}{33}$`),
  bitcoin_gold: new RegExp(`^G${B58}{33}$`),
  bnb_beacon: /^bnb1[02-9ac-hj-np-z]{38}$/,
};

describe('encoders', () => {
  it('writes base58 and base58check as the published vectors do', () => {
    expect(BASE58_BITCOIN).toHaveLength(58);
    expect(BASE58_RIPPLE).toHaveLength(58);
    expect(base58Encode(new TextEncoder().encode('Hello World!'))).toBe('2NEpo7TZRRrLZSi2U');
    expect(base58Encode(Uint8Array.from([0, 0, 1]))).toBe('112');
    expect(base58CheckEncode(new Uint8Array(21))).toBe('1111111111111111111114oLvT2');
  });

  it('writes BIP-173’s P2WPKH example from its witness program', () => {
    const program = hex('751e76e8199196d454941c45d1b3a323f1433bd6');
    const address = segwitV0Address('bc', program);
    expect(address).toBe(PUBLISHED_TEST_ADDRESSES.bip173P2wpkh);
    const checked = validateCryptoAddress(CHAINS.bitcoin, address);
    expect(checked.valid && Buffer.from(checked.address.payload).toString('hex')).toBe(
      '751e76e8199196d454941c45d1b3a323f1433bd6',
    );
  });

  it('writes the CashAddr specification’s examples beside their legacy forms', () => {
    const hash = hex('76a04053bda0a88bda5177b86a15c3b29f559873');
    expect(base58CheckEncode(Uint8Array.from([0x00, ...hash]))).toBe(
      '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu',
    );
    expect(cashAddress('bitcoincash', 'p2pkh', hash)).toBe(
      'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
    );
    expect(cashAddress('bitcoincash', 'p2sh', hash)).toBe(
      'bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq',
    );
  });

  it('writes plain bech32 bytes with a checksum that verifies', () => {
    const address = bech32Bytes('bnb', hex('00112233445566778899aabbccddeeff00112233'));
    expect(address.startsWith('bnb1')).toBe(true);
    expect(bech32Verifies(address)).toBe(true);
    expect(bech32Verifies(`${address.slice(0, -1)}q`)).toBe(false);
  });
});

describe('published test addresses', () => {
  it('are valid EVM and Bitcoin addresses', () => {
    for (const address of [
      PUBLISHED_TEST_ADDRESSES.hardhatAccount0,
      PUBLISHED_TEST_ADDRESSES.eip55Example,
    ]) {
      const checked = validateCryptoAddress(CHAINS.ethereum, address);
      expect(checked.valid && checked.address.checksum).toBe('valid');
    }
    expect(validateCryptoAddress(CHAINS.bitcoin, PUBLISHED_TEST_ADDRESSES.bip173P2wpkh).valid).toBe(
      true,
    );
  });
});

describe('syntheticCryptoAddress', () => {
  it('has a default ticker for every format', () => {
    for (const format of SYNTHETIC_CRYPTO_FORMATS) {
      expect(DEFAULT_CRYPTO_TICKERS[format]).toMatch(/^[A-Z]{2,5}$/);
    }
  });

  it('writes every C57 chain format as an address the Phase 5 validator accepts', () => {
    const random = seededRandom('crypto');
    for (const [format, expected] of Object.entries(VALIDATED)) {
      for (let index = 0; index < 20; index += 1) {
        const address = syntheticCryptoAddress(random, format as SyntheticCryptoFormat);
        expect(address.format).toBe(format);
        expect(address.ticker).toBe(DEFAULT_CRYPTO_TICKERS[format as SyntheticCryptoFormat]);
        const checked = validateCryptoAddress(expected.chain, address.raw);
        expect(checked.valid, `${format} ${address.raw}`).toBe(true);
        expect(checked.valid && checked.address.kind).toBe(expected.kind);
      }
    }
    const lower = syntheticCryptoAddress(random, 'evm_lower').raw;
    expect(lower).toBe(lower.toLowerCase());
    const mixed = validateCryptoAddress(
      CHAINS.ethereum,
      syntheticCryptoAddress(random, 'evm_checksummed').raw,
    );
    expect(mixed.valid && mixed.address.checksum).toBe('valid');
    expect(syntheticCryptoAddress(random, 'bitcoin_testnet_p2wpkh').raw.startsWith('tb1q')).toBe(
      true,
    );
  });

  it('writes the other formats in their shapes, and an unclassified string in none', () => {
    const random = seededRandom('crypto-shapes');
    for (const [format, shape] of Object.entries(SHAPES)) {
      const address = syntheticCryptoAddress(random, format as SyntheticCryptoFormat);
      expect(address.raw).toMatch(shape);
    }
    expect(bech32Verifies(syntheticCryptoAddress(random, 'bnb_beacon').raw)).toBe(true);
    const unclassified = syntheticCryptoAddress(random, 'unclassified').raw;
    expect(Object.values(SHAPES).some((shape) => shape.test(unclassified))).toBe(false);
    expect(
      Object.values(CHAINS).some((chain) => validateCryptoAddress(chain, unclassified).valid),
    ).toBe(false);
  });

  it('keeps a ticker it is given (tickers do not name chains) and is reproducible', () => {
    const tether = syntheticCryptoAddress(seededRandom('usdt'), 'tron', 'USDT');
    expect(tether.ticker).toBe('USDT');
    expect(syntheticCryptoAddress(seededRandom('usdt'), 'tron', 'USDT')).toEqual(tether);
  });
});
