/**
 * BIP-322 against its published vectors (bitcoin/bips d77863fb9e9b), and over our challenges with
 * seeded keys signed through `@scure/btc-signer`.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { base64, hex } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { validateCryptoAddress, type CryptoAddress } from './addresses.js';
import {
  bip322MessageHash,
  bip322TransactionIds,
  outputScriptOf,
  verifyBip322Simple,
} from './bip322.js';
import { utf8 } from './bytes.js';
import {
  BITCOIN_CHAIN,
  BITCOIN_TESTNET_CHAIN,
  bitcoinTestAddresses,
  encodeWitness,
  signBip322Simple,
  testPrivateKey,
} from './testing.js';
import {
  BIP322_ERROR_VECTORS,
  BIP322_FULL_VECTORS,
  BIP322_PROOF_OF_FUNDS_VECTORS,
  BIP322_SIMPLE_VECTORS,
  BIP322_TRANSACTION_VECTORS,
} from './vectors/bip322.js';

function decoded(address: string, chainId = BITCOIN_CHAIN): CryptoAddress {
  const result = validateCryptoAddress(chainId, address);
  if (!result.valid) {
    throw new Error(`invalid ${address}`);
  }
  return result.address;
}

const outcome = (address: string, message: string, signature: string) =>
  verifyBip322Simple(decoded(address), utf8(message), signature).outcome;

/** Witness items of a simple signature, to build variants of it. */
function witnessOf(signature: string): Uint8Array[] {
  const bytes = base64.decode(signature.startsWith('smp') ? signature.slice(3) : signature);
  const items: Uint8Array[] = [];
  let offset = 1;
  for (let index = 0; index < (bytes[0] ?? 0); index += 1) {
    const length = bytes[offset] ?? 0;
    items.push(bytes.slice(offset + 1, offset + 1 + length));
    offset += 1 + length;
  }
  return items;
}
const simple = (items: readonly Uint8Array[]) => `smp${base64.encode(encodeWitness(items))}`;

describe('the BIP-322 virtual transactions', () => {
  it.each(BIP322_TRANSACTION_VECTORS)('hashes $message for $address', (vector) => {
    const message = utf8(vector.message);
    expect(hex.encode(bip322MessageHash(message))).toBe(vector.message_hash);
    expect(bip322TransactionIds(message, outputScriptOf(decoded(vector.address)))).toEqual({
      toSpend: vector.to_spend_tx_hash,
      toSign: vector.to_sign_tx_hash,
    });
  });

  it('writes the output script of every kind', () => {
    const addresses = bitcoinTestAddresses(testPrivateKey('bip322/scripts'), 'bitcoin');
    expect(hex.encode(outputScriptOf(decoded(addresses.p2pkh))).slice(0, 6)).toBe('76a914');
    expect(hex.encode(outputScriptOf(decoded(addresses.p2shP2wpkh))).slice(0, 4)).toBe('a914');
    expect(hex.encode(outputScriptOf(decoded(addresses.p2wpkh))).slice(0, 4)).toBe('0014');
    expect(hex.encode(outputScriptOf(decoded(addresses.p2wsh))).slice(0, 4)).toBe('0020');
    expect(hex.encode(outputScriptOf(decoded(addresses.p2tr))).slice(0, 4)).toBe('5120');
  });
});

describe('verifyBip322Simple: the published vectors', () => {
  const cases = BIP322_SIMPLE_VECTORS.flatMap((vector) =>
    vector.signatures.map((signature) => ({ ...vector, signature })),
  );

  it.each(cases.filter((vector) => !vector.type.startsWith('p2wsh')))(
    'verifies the $type signature of $message',
    ({ address, message, signature }) => {
      expect(outcome(address, message, signature)).toBe('verified');
    },
  );

  it.each(cases.filter((vector) => vector.type.startsWith('p2wsh')))(
    'calls the $type signature inconclusive: a script needs an interpreter',
    ({ address, message, signature }) => {
      expect(outcome(address, message, signature)).toBe('inconclusive');
    },
  );

  it.each(
    [...BIP322_FULL_VECTORS, ...BIP322_PROOF_OF_FUNDS_VECTORS].flatMap((vector) =>
      vector.signatures.map((signature) => ({ ...vector, signature })),
    ),
  )('calls the full or proof-of-funds $type signature inconclusive, never verified', (vector) => {
    expect(outcome(vector.address, vector.message, vector.signature)).toBe('inconclusive');
  });

  it.each(BIP322_ERROR_VECTORS)('never verifies: $description', (vector) => {
    const kind = decoded(vector.address).kind;
    const result = outcome(vector.address, vector.message, vector.signature);
    expect(result).not.toBe('verified');
    if (vector.signature.startsWith('ful') || kind === 'p2wsh') {
      expect(result).toBe('inconclusive');
    } else if (/signer|address/.test(vector.description) && kind === 'p2wpkh') {
      expect(result).toBe('address_mismatch');
    } else {
      expect(result).toBe('invalid');
    }
  });
});

describe('verifyBip322Simple: our challenges', () => {
  const key = testPrivateKey('bip322/alice');
  const addresses = bitcoinTestAddresses(key, 'bitcoin');
  const message = 'verify.example.org wants you to sign in with your Bitcoin account:';

  it.each(['p2wpkh', 'p2tr'] as const)('verifies a %s signature, prefixed or bare', (kind) => {
    const signature = signBip322Simple(kind, utf8(message), key);
    expect(outcome(addresses[kind], message, signature)).toBe('verified');
    expect(outcome(addresses[kind], message, signature.slice(3))).toBe('verified');
    expect(outcome(addresses[kind], `${message}.`, signature)).toBe('invalid');
  });

  it('verifies on the testnet chain', () => {
    const testnet = bitcoinTestAddresses(key, 'testnet');
    const signature = signBip322Simple('p2wpkh', utf8(message), key, 'testnet');
    expect(
      verifyBip322Simple(decoded(testnet.p2wpkh, BITCOIN_TESTNET_CHAIN), utf8(message), signature)
        .outcome,
    ).toBe('verified');
  });

  it('enforces the required rules on a P2WPKH witness', () => {
    const [signature = new Uint8Array(), publicKey = new Uint8Array()] = witnessOf(
      signBip322Simple('p2wpkh', utf8(message), key),
    );
    const der = signature.slice(0, -1);
    const parsed = secp256k1.Signature.fromBytes(der, 'der');
    const highS = new secp256k1.Signature(parsed.r, secp256k1.Point.CURVE().n - parsed.s).toBytes(
      'der',
    );
    const variants: [string, Uint8Array[]][] = [
      ['a high-s signature (LOW_S)', [Uint8Array.from([...highS, 0x01]), publicKey]],
      ['SIGHASH_NONE', [Uint8Array.from([...der, 0x02]), publicKey]],
      ['a third item (CLEANSTACK)', [signature, publicKey, new Uint8Array([1])]],
      ['one item', [signature]],
      ['an uncompressed key', [signature, secp256k1.getPublicKey(key, false)]],
    ];
    for (const [why, items] of variants) {
      expect(outcome(addresses.p2wpkh, message, simple(items)), why).toBe('invalid');
    }
    const other = secp256k1.getPublicKey(testPrivateKey('bip322/bob'), true);
    expect(outcome(addresses.p2wpkh, message, simple([signature, other]))).toBe('address_mismatch');
  });

  it('enforces the sighash rules of a P2TR key-path witness', () => {
    const [schnorrSignature = new Uint8Array()] = witnessOf(
      signBip322Simple('p2tr', utf8(message), key),
    );
    expect(
      outcome(addresses.p2tr, message, simple([Uint8Array.from([...schnorrSignature, 0x00])])),
    ).toBe('invalid');
    expect(
      outcome(addresses.p2tr, message, simple([Uint8Array.from([...schnorrSignature, 0x02])])),
    ).toBe('invalid');
    // An annex or a script-path spend needs more than a key: never verified.
    expect(
      outcome(addresses.p2tr, message, simple([schnorrSignature, Uint8Array.from([0x50, 1])])),
    ).toBe('inconclusive');
    expect(
      outcome(
        addresses.p2tr,
        message,
        simple([schnorrSignature, new Uint8Array([0x51]), new Uint8Array(33)]),
      ),
    ).toBe('inconclusive');
  });

  it('calls P2PKH, P2SH and future witness versions inconclusive for the simple format', () => {
    const signature = signBip322Simple('p2wpkh', utf8(message), key);
    expect(outcome(addresses.p2pkh, message, signature)).toBe('inconclusive');
    expect(outcome(addresses.p2shP2wpkh, message, signature)).toBe('inconclusive');
    expect(outcome('BC1SW50QGDZ25J', message, signature)).toBe('inconclusive');
  });

  it.each([
    [
      'trailing bytes',
      `smp${base64.encode(Uint8Array.from([...encodeWitness([new Uint8Array(64)]), 0]))}`,
    ],
    ['a truncated item', `smp${base64.encode(Uint8Array.from([1, 64, 1, 2, 3]))}`],
    ['unpadded base64', 'smpAA'],
    ['a signature longer than 1 KiB', `smp${'A'.repeat(1400)}`],
  ])('refuses %s', (_why, signature) => {
    expect(outcome(addresses.p2wpkh, message, signature)).toBe('invalid');
  });
});
