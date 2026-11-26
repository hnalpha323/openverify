/** EIP-55 against the EIP's eight test addresses and the micro-eth-signer oracle (dev only). */
import { addr } from 'micro-eth-signer';
import { describe, expect, it } from 'vitest';
import { eip55Checksum, toEip55Address } from './eip55.js';
import { evmTestAddress, testPrivateKey } from './testing.js';
import { EIP55_TEST_ADDRESSES } from './vectors/ethereum.js';

describe('EIP-55 (C57.1)', () => {
  it.each(EIP55_TEST_ADDRESSES)('reproduces the published form of %s', (published) => {
    expect(toEip55Address(published.slice(2).toLowerCase())).toBe(published);
    expect(toEip55Address(published.slice(2).toUpperCase())).toBe(published);
  });

  it('calls the all-caps and all-lower vectors unchecksummed and the mixed ones valid', () => {
    expect(EIP55_TEST_ADDRESSES.map(eip55Checksum)).toEqual([
      'absent',
      'absent',
      'absent',
      'absent',
      'valid',
      'valid',
      'valid',
      'valid',
    ]);
  });

  it('finds a single wrong letter case', () => {
    const published = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
    expect(eip55Checksum(published.replace('aAeb', 'aaeb'))).toBe('invalid');
    expect(eip55Checksum(published.replace('BeAed', 'BeAeD'))).toBe('invalid');
  });

  it('agrees with the micro-eth-signer oracle on 200 seeded addresses', () => {
    for (let index = 0; index < 200; index += 1) {
      const lower = evmTestAddress(testPrivateKey(`eip55/${String(index)}`));
      const checksummed = toEip55Address(lower.slice(2));
      expect(checksummed).toBe(addr.addChecksum(lower));
      expect(eip55Checksum(checksummed)).toBe(
        checksummed === lower || checksummed === `0x${lower.slice(2).toUpperCase()}`
          ? 'absent'
          : 'valid',
      );
    }
  });
});
