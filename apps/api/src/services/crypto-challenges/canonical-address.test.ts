/**
 * C57.2, C53.4: the address index is computed in `packages/db` (`canonicalCryptoAddress`, which
 * the challenge create and the `blind-index:rebuild` both use), while the challenge route compares
 * addresses with the checks package (`cryptoAddressesEqual`). The two canonical forms must agree,
 * or the rebuild would index another form than the comparison reads; this test pins them to each
 * other over every address family. Addresses are published examples or test wallets.
 */
import { cryptoAddressesEqual, validateCryptoAddress } from '@openverify/checks';
import { canonicalCryptoAddress } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { testSolanaWallet, testWalletAddress, TEST_CHAINS } from './testing.js';

const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const TESTNET = 'bip122:000000000933ea01ad0ee984209779ba';

const ADDRESSES: readonly [string, string][] = [
  [TEST_CHAINS.ethereum, CHECKSUMMED],
  [TEST_CHAINS.ethereum, CHECKSUMMED.toLowerCase()],
  [TEST_CHAINS.base, testWalletAddress('canonical/evm')],
  [TEST_CHAINS.bitcoin, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
  [TEST_CHAINS.bitcoin, 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'],
  [TEST_CHAINS.bitcoin, 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'],
  [TEST_CHAINS.bitcoin, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
  [TEST_CHAINS.bitcoin, '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
  [TESTNET, 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7'],
  [TEST_CHAINS.solana, testSolanaWallet('canonical/solana').address],
  [TEST_CHAINS.tron, 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'],
  ['xrpl:0', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'],
];

describe('the canonical wallet address (C57.2, C53.4)', () => {
  it.each(ADDRESSES)('is the same in the index and the comparison on %s: %s', (chain, address) => {
    const validation = validateCryptoAddress(chain, address);

    expect(validation.valid).toBe(true);
    expect(canonicalCryptoAddress(chain, address)).toBe(
      validation.valid ? validation.address.canonical : null,
    );
  });

  it('indexes two addresses alike exactly when the comparison finds them equal', () => {
    for (const [chain, left] of ADDRESSES) {
      for (const [other, right] of ADDRESSES) {
        if (chain === other) {
          expect(
            canonicalCryptoAddress(chain, left) === canonicalCryptoAddress(chain, right),
            `${left} and ${right}`,
          ).toBe(cryptoAddressesEqual(chain, left, right));
        }
      }
    }
  });
});
