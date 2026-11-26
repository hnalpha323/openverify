/**
 * C62.6 (P01, H16): Active Authentication over the server's 8-byte nonce with the DG15 key, RSA
 * ISO/IEC 9796-2 scheme 1 or plain ECDSA. Verified when the response verifies; failed when a
 * well-formed response does not; malformed when it cannot be read; withheld when the SOD lists
 * DG15 and the key or the response is missing; not listed when the verified SOD lists no DG15;
 * untrusted when integrity is not established. Keys and responses are synthetic.
 */
import { constants, privateEncrypt } from 'node:crypto';
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import { algorithmIdentifier, bitString, sequence, tlv } from './der.js';
import { ALGORITHM_OIDS } from './oids.js';
import { bytesToBigInt, concatBytes, fromHex, unsignedBytes } from './bytes.js';
import { verifyActiveAuthentication } from './active-authentication.js';
import { buildChip, signActiveAuthentication } from './testing/chip.js';
import { seededBytes, type TestKeyPair, type TestKeySpec } from './testing/keys.js';
import { buildCsca, buildDsc } from './testing/x509.js';
import type { ActiveAuthenticationInput } from './types.js';

const now = new Date('2026-07-01T12:00:00Z');
const MRZ = [
  'P<UTOQUILL<<ROWAN<ASH'.padEnd(44, '<'),
  'X12345678<UTO9001014M3101016'.padEnd(42, '<') + '00',
];
const nonce = fromHex('0102030405060708');

function chipWith(activeAuthentication: TestKeySpec, variants: readonly 'aa-wrong-key'[] = []) {
  const csca = buildCsca({ seed: 'aa-csca', now });
  const dsc = buildDsc({ seed: 'aa-dsc', issuer: csca, now });
  const chip = buildChip({
    dsc,
    mrzLines: MRZ,
    portrait: { bytes: fromHex('ffd8ffe000'), mimeType: 'image/jpeg' },
    activeAuthentication,
    seed: `aa-${JSON.stringify(activeAuthentication)}`,
    variants,
  });
  const key = chip.activeAuthenticationKey;
  if (key === null) {
    throw new Error('the chip has an AA key');
  }
  return { files: chip.files, key };
}

function input(
  files: ReturnType<typeof chipWith>['files'],
  response: Uint8Array | null,
  overrides: Partial<ActiveAuthenticationInput> = {},
): ActiveAuthenticationInput {
  return {
    dg15: files.dataGroups[15] ?? null,
    dg15Listed: true,
    integrity: 'established',
    nonce,
    response,
    dg14: files.dataGroups[14] ?? null,
    ...overrides,
  };
}

const modulusOf = (key: TestKeyPair) =>
  bytesToBigInt(Buffer.from(String(key.publicKey.export({ format: 'jwk' }).n), 'base64url'));

describe('verifyActiveAuthentication: plain ECDSA (C62.6)', () => {
  it.each([
    [{ kind: 'ec', curve: 'P-256' }],
    [{ kind: 'ec', curve: 'brainpoolP384r1', explicitParameters: true }],
    [{ kind: 'ec', curve: 'P-521' }],
  ] as const)('verifies a response from %j over this nonce, with or without DG14', (spec) => {
    const { files, key } = chipWith(spec);
    const response = signActiveAuthentication(key, nonce);
    expect(verifyActiveAuthentication(input(files, response))).toEqual({
      outcome: 'verified',
      scheme: 'ecdsa-plain',
      hashAlgorithm: 'sha256',
    });
    expect(verifyActiveAuthentication(input(files, response, { dg14: null })).outcome).toBe(
      'verified',
    );
  });

  it('finds the digest without DG14 by trying each one', () => {
    const { files, key } = chipWith({ kind: 'ec', curve: 'P-384' });
    const response = signActiveAuthentication(key, nonce, { hash: 'sha384' });
    expect(verifyActiveAuthentication(input(files, response, { dg14: null }))).toEqual({
      outcome: 'verified',
      scheme: 'ecdsa-plain',
      hashAlgorithm: 'sha384',
    });
  });

  it('fails a well-formed response over another nonce, or from another key', () => {
    const { files, key } = chipWith({ kind: 'ec', curve: 'P-256' });
    const replay = signActiveAuthentication(key, fromHex('0807060504030201'));
    expect(verifyActiveAuthentication(input(files, replay))).toEqual({
      outcome: 'failed',
      scheme: 'ecdsa-plain',
      hashAlgorithm: 'sha256',
    });
    const wrong = chipWith({ kind: 'ec', curve: 'P-256' }, ['aa-wrong-key']);
    expect(
      verifyActiveAuthentication(input(wrong.files, signActiveAuthentication(wrong.key, nonce)))
        .outcome,
    ).toBe('failed');
  });

  it('reads a response of the wrong length as malformed', () => {
    const { files, key } = chipWith({ kind: 'ec', curve: 'P-256' });
    const response = signActiveAuthentication(key, nonce);
    expect(verifyActiveAuthentication(input(files, response.subarray(1)))).toMatchObject({
      outcome: 'malformed',
      scheme: 'ecdsa-plain',
    });
  });
});

describe('verifyActiveAuthentication: RSA ISO/IEC 9796-2 scheme 1 (C62.6)', () => {
  it.each([
    ['sha256', 1024],
    ['sha1', 1024],
    ['sha512', 2048],
  ] as const)('verifies a %s response from an RSA-%i key', (hash, bits) => {
    const { files, key } = chipWith({ kind: 'rsa', bits });
    expect(
      verifyActiveAuthentication(input(files, signActiveAuthentication(key, nonce, { hash }))),
    ).toEqual({
      outcome: 'verified',
      scheme: 'rsa-iso9796-2',
      hashAlgorithm: hash,
    });
  });

  it('verifies the response n - s (9796-2 takes either representative)', () => {
    const { files, key } = chipWith({ kind: 'rsa', bits: 1024 });
    const response = signActiveAuthentication(key, nonce);
    const complement = unsignedBytes(modulusOf(key) - bytesToBigInt(response), 128);
    expect(verifyActiveAuthentication(input(files, complement)).outcome).toBe('verified');
  });

  it('fails a response over another nonce, and representatives without the header or trailer', () => {
    const { files, key } = chipWith({ kind: 'rsa', bits: 1024 });
    expect(
      verifyActiveAuthentication(
        input(files, signActiveAuthentication(key, fromHex('0000000000000000'))),
      ),
    ).toMatchObject({ outcome: 'failed', scheme: 'rsa-iso9796-2' });
    const raw = (representative: Uint8Array) =>
      new Uint8Array(
        privateEncrypt({ key: key.privateKey, padding: constants.RSA_NO_PADDING }, representative),
      );
    const body = seededBytes('aa-body', 125);
    for (const representative of [
      concatBytes(fromHex('4a'), body, fromHex('34cc')),
      concatBytes(fromHex('6a'), body, fromHex('99cc')),
      concatBytes(fromHex('6a'), seededBytes('aa-short', 126), fromHex('bc')),
    ]) {
      expect(verifyActiveAuthentication(input(files, raw(representative))).outcome).toBe('failed');
    }
  });

  it('reads a response of the wrong length or one past the modulus as malformed', () => {
    const { files, key } = chipWith({ kind: 'rsa', bits: 1024 });
    const response = signActiveAuthentication(key, nonce);
    expect(verifyActiveAuthentication(input(files, response.subarray(2))).outcome).toBe(
      'malformed',
    );
    expect(verifyActiveAuthentication(input(files, new Uint8Array(128).fill(0xff))).outcome).toBe(
      'malformed',
    );
  });
});

describe('verifyActiveAuthentication: no verdict without trusted evidence (C62.6, P01, H16)', () => {
  const { files, key } = chipWith({ kind: 'ec', curve: 'P-256' });
  const response = signActiveAuthentication(key, nonce);

  it.each([
    ['not established', 'not_established'],
    ['broken', 'broken'],
  ] as const)('does not trust the DG15 key when integrity is %s', (_label, integrity) => {
    expect(verifyActiveAuthentication(input(files, response, { integrity }))).toEqual({
      outcome: 'untrusted_key',
      scheme: null,
      hashAlgorithm: null,
    });
  });

  it('answers not_listed when the verified SOD lists no DG15', () => {
    expect(
      verifyActiveAuthentication(input(files, null, { dg15: null, dg15Listed: false })).outcome,
    ).toBe('not_listed');
    // An unlisted DG15 the client sent anyway is not the chip's AA key.
    expect(verifyActiveAuthentication(input(files, response, { dg15Listed: false })).outcome).toBe(
      'not_listed',
    );
  });

  it('answers withheld when the SOD lists DG15 but the response or DG15 is missing', () => {
    expect(verifyActiveAuthentication(input(files, null)).outcome).toBe('withheld');
    expect(verifyActiveAuthentication(input(files, response, { dg15: null })).outcome).toBe(
      'withheld',
    );
  });

  it('reads a DG15 key outside the bounds, or no DG15 at all, as malformed', () => {
    for (const spec of [{ kind: 'oversized-rsa' }, { kind: 'ec', curve: 'secp256k1' }] as const) {
      const odd = chipWith(spec);
      expect(verifyActiveAuthentication(input(odd.files, response)).outcome).toBe('malformed');
    }
    expect(
      verifyActiveAuthentication(input(files, response, { dg15: fromHex('6f00') })).outcome,
    ).toBe('malformed');
  });

  it('reads an RSASSA-PSS DG15 key, which Active Authentication never uses, as malformed', () => {
    const rsa = chipWith({ kind: 'rsa', bits: 1024 });
    // The same RSA public key under the RSASSA-PSS OID: OpenSSL imports it, but refuses it a raw
    // RSA operation and a JWK export.
    const info = asn1js.fromBER(rsa.key.spki).result as asn1js.Sequence;
    const bits = (info.valueBlock.value[1] as asn1js.BitString).valueBlock.valueHexView;
    const dg15 = tlv(
      0x6f,
      sequence(algorithmIdentifier(ALGORITHM_OIDS.rsassaPss), bitString(bits)),
    );
    expect(
      verifyActiveAuthentication(
        input(rsa.files, signActiveAuthentication(rsa.key, nonce), { dg15 }),
      ),
    ).toMatchObject({ outcome: 'malformed', scheme: 'rsa-iso9796-2' });
  });

  it("refuses a nonce that is not the challenge's 8 bytes", () => {
    expect(() =>
      verifyActiveAuthentication(input(files, response, { nonce: new Uint8Array(7) })),
    ).toThrow(RangeError);
  });
});
