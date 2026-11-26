/** C57.3, C57.4: the one dispatch over chains and schemes, and what it tells the job about EVM contracts. */
import { base58, base64, hex } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { validateCryptoAddress, type CryptoAddress } from './addresses.js';
import { utf8 } from './bytes.js';
import { eip191Digest } from './eip191.js';
import {
  BITCOIN_CHAIN,
  DOGECOIN_CHAIN,
  ETHEREUM_CHAIN,
  LITECOIN_CHAIN,
  SANDBOX_CONTRACT_WALLET,
  SOLANA_CHAIN,
  TRON_CHAIN,
  XRPL_CHAIN,
  bitcoinTestAddresses,
  evmTestAddress,
  signBip137,
  signBip322Simple,
  signPersonalMessage,
  signSolanaMessage,
  signTronMessage,
  solanaOffchainEnvelope,
  solanaProgramDerivedAddress,
  solanaTestKey,
  testPrivateKey,
  tronTestAddress,
} from './testing.js';
import { verifyWalletSignature, type WalletSignatureInput } from './verify.js';

const MESSAGE = 'verify.example.org wants you to sign in with your Ethereum account:\n0x';

function decoded(chainId: string, address: string): CryptoAddress {
  const result = validateCryptoAddress(chainId, address);
  if (!result.valid) {
    throw new Error(`invalid ${address}`);
  }
  return result.address;
}

const verify = (
  chainId: string,
  address: string,
  signature: string,
  overrides: Partial<WalletSignatureInput> = {},
) =>
  verifyWalletSignature({
    address: decoded(chainId, address),
    message: MESSAGE,
    signature,
    bip137Mode: 'loose',
    ...overrides,
  });

describe('verifyWalletSignature: EVM (EIP-191)', () => {
  const key = testPrivateKey('verify/evm');
  const address = evmTestAddress(key);

  it('verifies the claimed key’s signature over the challenge, inferring eip191', () => {
    const result = verify(ETHEREUM_CHAIN, address, signPersonalMessage(utf8(MESSAGE), key));
    expect(result).toEqual({
      outcome: 'verified',
      scheme: 'eip191',
      signedBytes: utf8(MESSAGE),
      highS: false,
      bip137Loose: false,
    });
  });

  it('reports a high-s signature', () => {
    const result = verify(
      ETHEREUM_CHAIN,
      address,
      signPersonalMessage(utf8(MESSAGE), key, { highS: true }),
    );
    expect(result).toMatchObject({ outcome: 'verified', highS: true });
  });

  it('names the ERC-1271 question when another key signed (a Safe-shaped owner signature)', () => {
    const owner = testPrivateKey('verify/safe-owner');
    const signature = signPersonalMessage(utf8(MESSAGE), owner);
    const result = verify(ETHEREUM_CHAIN, SANDBOX_CONTRACT_WALLET, signature);
    expect(result).toEqual({
      outcome: 'address_mismatch',
      scheme: 'eip191',
      signedBytes: utf8(MESSAGE),
      highS: false,
      contractCheck: {
        address: SANDBOX_CONTRACT_WALLET,
        digest: eip191Digest(utf8(MESSAGE)),
        signature: hex.decode(signature.slice(2)),
      },
    });
  });

  it('asks the contract about bytes no key could have made', () => {
    const multisig = `0x${'ab'.repeat(130)}`;
    expect(verify(ETHEREUM_CHAIN, SANDBOX_CONTRACT_WALLET, multisig)).toMatchObject({
      outcome: 'not_recovered',
      scheme: 'eip191',
      contractCheck: { address: SANDBOX_CONTRACT_WALLET, signature: hex.decode('ab'.repeat(130)) },
    });
  });

  it('calls an ERC-6492 envelope inconclusive and refuses what is not hex', () => {
    const wrapped = `0x${'11'.repeat(96)}${'6492'.repeat(16)}`;
    expect(verify(ETHEREUM_CHAIN, address, wrapped)).toEqual({
      outcome: 'inconclusive',
      scheme: 'eip191',
    });
    expect(verify(ETHEREUM_CHAIN, address, 'not hex')).toEqual({
      outcome: 'invalid',
      scheme: 'eip191',
    });
    expect(verify(ETHEREUM_CHAIN, address, '0x')).toEqual({ outcome: 'invalid', scheme: 'eip191' });
  });

  it('verifies over a signed-message the wallet returned, as base64 of its bytes', () => {
    const other = utf8('another message');
    const result = verify(ETHEREUM_CHAIN, address, signPersonalMessage(other, key), {
      signedMessage: base64.encode(other),
    });
    expect(result).toMatchObject({ outcome: 'verified', signedBytes: other });
    expect(
      verify(ETHEREUM_CHAIN, address, signPersonalMessage(other, key), {
        signedMessage: 'not base64!',
      }),
    ).toEqual({ outcome: 'invalid', scheme: 'eip191' });
  });

  it('refuses a scheme the chain does not accept', () => {
    expect(
      verify(ETHEREUM_CHAIN, address, signPersonalMessage(utf8(MESSAGE), key), {
        scheme: 'bip137',
      }),
    ).toEqual({ outcome: 'invalid', scheme: 'bip137' });
  });
});

describe('verifyWalletSignature: Bitcoin, Litecoin and Dogecoin', () => {
  const key = testPrivateKey('verify/btc');
  const addresses = bitcoinTestAddresses(key, 'bitcoin');

  it('infers BIP-137 from a 65-byte signature and BIP-322 simple otherwise', () => {
    expect(
      verify(BITCOIN_CHAIN, addresses.p2pkh, signBip137('bitcoin', utf8(MESSAGE), key, 'p2pkh')),
    ).toMatchObject({
      outcome: 'verified',
      scheme: 'bip137',
    });
    expect(
      verify(BITCOIN_CHAIN, addresses.p2wpkh, signBip322Simple('p2wpkh', utf8(MESSAGE), key)),
    ).toMatchObject({
      outcome: 'verified',
      scheme: 'bip322-simple',
      highS: false,
      bip137Loose: false,
    });
    expect(
      verify(BITCOIN_CHAIN, addresses.p2tr, signBip322Simple('p2tr', utf8(MESSAGE), key).slice(3)),
    ).toMatchObject({ outcome: 'verified', scheme: 'bip322-simple' });
  });

  it('flags a loose BIP-137 header and refuses it in strict mode', () => {
    const electrum = signBip137('bitcoin', utf8(MESSAGE), key, 'p2pkh');
    expect(verify(BITCOIN_CHAIN, addresses.p2wpkh, electrum)).toMatchObject({
      outcome: 'verified',
      bip137Loose: true,
    });
    expect(verify(BITCOIN_CHAIN, addresses.p2wpkh, electrum, { bip137Mode: 'strict' })).toEqual({
      outcome: 'invalid',
      scheme: 'bip137',
    });
  });

  it('reads BIP-322 legacy as BIP-137 restricted to P2PKH', () => {
    const signature = signBip137('bitcoin', utf8(MESSAGE), key, 'p2pkh');
    expect(
      verify(BITCOIN_CHAIN, addresses.p2pkh, signature, { scheme: 'bip322-legacy' }),
    ).toMatchObject({
      outcome: 'verified',
      scheme: 'bip322-legacy',
    });
    expect(verify(BITCOIN_CHAIN, addresses.p2wpkh, signature, { scheme: 'bip322-legacy' })).toEqual(
      {
        outcome: 'invalid',
        scheme: 'bip322-legacy',
      },
    );
  });

  it('calls the full and proof-of-funds formats inconclusive', () => {
    for (const prefix of ['ful', 'pof']) {
      expect(verify(BITCOIN_CHAIN, addresses.p2wpkh, `${prefix}AAAA`)).toEqual({
        outcome: 'inconclusive',
        scheme: 'bip322-simple',
      });
    }
  });

  it('reports another key without a contract question', () => {
    const other = testPrivateKey('verify/btc-other');
    expect(
      verify(BITCOIN_CHAIN, addresses.p2pkh, signBip137('bitcoin', utf8(MESSAGE), other, 'p2pkh')),
    ).toMatchObject({
      outcome: 'address_mismatch',
      scheme: 'bip137',
      contractCheck: null,
    });
  });

  it('verifies Litecoin and Dogecoin with BIP-137 and refuses BIP-322 there', () => {
    const litecoin = bitcoinTestAddresses(key, 'litecoin').p2wpkh;
    expect(
      verify(LITECOIN_CHAIN, litecoin, signBip137('litecoin', utf8(MESSAGE), key, 'p2wpkh')),
    ).toMatchObject({
      outcome: 'verified',
      scheme: 'bip137',
    });
    const dogecoin = bitcoinTestAddresses(key, 'dogecoin').p2pkh;
    expect(
      verify(DOGECOIN_CHAIN, dogecoin, signBip137('dogecoin', utf8(MESSAGE), key, 'p2pkh')),
    ).toMatchObject({
      outcome: 'verified',
    });
    expect(
      verify(LITECOIN_CHAIN, litecoin, signBip322Simple('p2wpkh', utf8(MESSAGE), key), {
        scheme: 'bip322-simple',
      }),
    ).toEqual({ outcome: 'invalid', scheme: 'bip322-simple' });
  });
});

describe('verifyWalletSignature: TRON, Solana and the XRP Ledger', () => {
  it('verifies TRON signMessageV2 and reports another key', () => {
    const key = testPrivateKey('verify/tron');
    const address = tronTestAddress(key);
    expect(verify(TRON_CHAIN, address, signTronMessage(utf8(MESSAGE), key))).toMatchObject({
      outcome: 'verified',
      scheme: 'tron-v2',
    });
    expect(verify(TRON_CHAIN, address, signTronMessage(utf8(MESSAGE), key).slice(2))).toMatchObject(
      {
        outcome: 'verified',
      },
    );
    expect(
      verify(
        TRON_CHAIN,
        address,
        signTronMessage(utf8(MESSAGE), testPrivateKey('verify/tron-other')),
      ),
    ).toMatchObject({ outcome: 'address_mismatch', contractCheck: null });
    expect(verify(TRON_CHAIN, address, '0x1234')).toEqual({
      outcome: 'invalid',
      scheme: 'tron-v2',
    });
  });

  it('verifies a Solana signature over the challenge or over an envelope the wallet returned', () => {
    const alice = solanaTestKey('verify/alice');
    expect(
      verify(SOLANA_CHAIN, alice.address, signSolanaMessage(utf8(MESSAGE), alice.seed)),
    ).toMatchObject({
      outcome: 'verified',
      scheme: 'solana-ed25519',
      highS: false,
    });
    const envelope = solanaOffchainEnvelope(1, utf8(MESSAGE), [alice.publicKey]);
    expect(
      verify(SOLANA_CHAIN, alice.address, signSolanaMessage(envelope, alice.seed), {
        signedMessage: base64.encode(envelope),
      }),
    ).toMatchObject({ outcome: 'verified', signedBytes: envelope });
    const bob = solanaTestKey('verify/bob');
    expect(verify(SOLANA_CHAIN, alice.address, signSolanaMessage(utf8(MESSAGE), bob.seed))).toEqual(
      {
        outcome: 'invalid',
        scheme: 'solana-ed25519',
      },
    );
  });

  it('cannot prove a Solana program account or an XRP Ledger account', () => {
    const pda = solanaProgramDerivedAddress(
      [utf8('vault')],
      solanaTestKey('verify/program').publicKey,
    );
    const pdaAddress = base58.encode(pda);
    expect(verify(SOLANA_CHAIN, pdaAddress, 'x')).toEqual({ outcome: 'unsupported', scheme: null });
    expect(verify(XRPL_CHAIN, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'x')).toEqual({
      outcome: 'unsupported',
      scheme: null,
    });
  });

  it('never throws on hostile input', () => {
    const address = evmTestAddress(testPrivateKey('verify/hostile'));
    for (const signature of ['', 'x'.repeat(2000), `0x${'f'.repeat(2000)}`, '\u0000']) {
      expect(() => verify(ETHEREUM_CHAIN, address, signature)).not.toThrow();
      expect(() => verify(SOLANA_CHAIN, solanaTestKey('h').address, signature)).not.toThrow();
      expect(() =>
        verify(BITCOIN_CHAIN, bitcoinTestAddresses(testPrivateKey('h'), 'bitcoin').p2tr, signature),
      ).not.toThrow();
    }
  });
});
