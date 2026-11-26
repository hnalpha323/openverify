/**
 * C65.3: the synthetic chips, read with asn1js and verified with node:crypto, independently of
 * the package's own parsers: the SOD is CMS SignedData over an LDS security object that hashes
 * every listed data group, signed by the DSC over its signed attributes; each variant changes
 * one thing; Active Authentication answers in ISO/IEC 9796-2 scheme 1 or plain ECDSA.
 */
import { constants, createHash, publicEncrypt, verify } from 'node:crypto';
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import { concatBytes, toHex } from '../bytes.js';
import { HASH_ALGORITHM_OIDS, ICAO_OIDS } from '../oids.js';
import { buildChip, signActiveAuthentication, type TestChipOptions } from './chip.js';
import { seededBytes, type TestKeySpec } from './keys.js';
import { buildCsca, buildDsc } from './x509.js';

const now = new Date('2026-07-01T12:00:00Z');
const MRZ = [
  'P<UTOQUILL<<ROWAN<ASH'.padEnd(44, '<'),
  'X12345678<UTO9001014M3101016'.padEnd(42, '<') + '00',
];
const JPEG = concatBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), seededBytes('jpeg', 60));

function pki() {
  const csca = buildCsca({ seed: 'chip-csca', now });
  const dsc = buildDsc({ seed: 'chip-dsc', issuer: csca, now });
  return { csca, dsc };
}

function chip(overrides: Partial<TestChipOptions> = {}) {
  const { csca, dsc } = pki();
  return {
    csca,
    dsc,
    ...buildChip({
      dsc,
      mrzLines: MRZ,
      portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
      activeAuthentication: { kind: 'ec', curve: 'P-256' },
      seed: 'chip',
      ...overrides,
    }),
  };
}

type Block = asn1js.AsnType;
const items = (block: Block | undefined): Block[] =>
  (block as asn1js.Constructed | undefined)?.valueBlock.value ?? [];
function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}
const oid = (block: Block | undefined) => (block as asn1js.ObjectIdentifier).getValue();
const octets = (block: Block | undefined) =>
  new Uint8Array((block as asn1js.OctetString).getValue());
/** An implicitly tagged primitive's contents (the SignerInfo's `[0]` key identifier). */
const primitive = (block: Block | undefined) =>
  new Uint8Array((block as asn1js.Primitive).valueBlock.valueHexView);

/** The SOD read with asn1js: the SignedData parts the tests look at. */
function sodParts(sod: Uint8Array) {
  const contentInfo = sod.subarray(sod[1] === 0x82 ? 4 : sod[1] === 0x81 ? 3 : 2);
  const parsed = asn1js.fromBER(contentInfo, { parseEmbedded: false });
  const [type, wrapped] = items(parsed.result);
  const signedData = items(items(wrapped)[0]);
  const encapsulated = items(signedData[2]);
  const eContent = octets(items(encapsulated[1])[0]);
  const certificates = signedData.length === 5 ? items(signedData[3]) : [];
  const signerInfo = items(items(signedData[signedData.length - 1])[0]);
  const lds = items(asn1js.fromBER(eContent).result);
  const hashes = new Map(
    items(lds[2]).map((entry) => {
      const [number, hash] = items(entry);
      return [(number as asn1js.Integer).valueBlock.valueDec, toHex(octets(hash))] as const;
    }),
  );
  const signedAttributes = new Uint8Array(must(signerInfo[3]).valueBeforeDecodeView);
  signedAttributes[0] = 0x31;
  const attributes = new Map(
    items(asn1js.fromBER(signedAttributes).result).map((attribute) => {
      const [attributeType, values] = items(attribute);
      return [oid(attributeType), items(values)[0]] as const;
    }),
  );
  return {
    contentType: oid(type),
    version: (signedData[0] as asn1js.Integer).valueBlock.valueDec,
    eContentType: oid(encapsulated[0]),
    eContent,
    certificates: certificates.map((certificate) =>
      toHex(new Uint8Array(certificate.valueBeforeDecodeView)),
    ),
    sid: must(signerInfo[1]),
    digestOid: oid(items(signerInfo[2])[0]),
    signedAttributes,
    attributes,
    signature: octets(signerInfo[5]),
    ldsVersion: (lds[0] as asn1js.Integer).valueBlock.valueDec,
    ldsHashOid: oid(items(lds[1])[0]),
    ldsHasVersionInfo: lds.length === 4,
    hashes,
  };
}

const sha = (hash: string, bytes: Uint8Array) => createHash(hash).update(bytes).digest('hex');

describe('buildChip (C65.3)', () => {
  it('writes DG1, DG2, DG14, DG15 and EF.COM, and a SOD the DSC signed over all four', () => {
    const { files, dsc, activeAuthenticationKey } = chip();
    expect(Object.keys(files.dataGroups)).toEqual(['1', '2', '14', '15']);
    expect(files.com?.[0]).toBe(0x60);
    const dg1 = files.dataGroups[1] ?? new Uint8Array();
    expect(toHex(dg1.subarray(0, 5))).toBe('615b5f1f58');
    expect(new TextDecoder().decode(dg1.subarray(5))).toBe(MRZ.join(''));
    expect(toHex((files.dataGroups[2] ?? new Uint8Array()).subarray(0, 1))).toBe('75');
    expect(toHex(files.dataGroups[15] ?? new Uint8Array())).toBe(
      `6f${toHex(new Uint8Array([activeAuthenticationKey?.spki.length ?? 0]))}${toHex(activeAuthenticationKey?.spki ?? new Uint8Array())}`,
    );
    // DG14 names the AA protocol (2.23.136.1.1.5) and plain ECDSA with SHA-256.
    expect(toHex(files.dataGroups[14] ?? new Uint8Array())).toContain('0606678108010105');
    expect(toHex(files.dataGroups[14] ?? new Uint8Array())).toContain('060a04007f00070101040103');

    const sod = sodParts(files.sod);
    expect(files.sod[0]).toBe(0x77);
    expect(sod).toMatchObject({
      contentType: '1.2.840.113549.1.7.2',
      version: 3,
      eContentType: ICAO_OIDS.ldsSecurityObject,
      certificates: [toHex(dsc.der)],
      digestOid: HASH_ALGORITHM_OIDS.sha256,
      ldsVersion: 1,
      ldsHashOid: HASH_ALGORITHM_OIDS.sha256,
      ldsHasVersionInfo: true,
    });
    for (const [number, file] of Object.entries(files.dataGroups)) {
      expect(sod.hashes.get(Number(number)), `DG${number}`).toBe(sha('sha256', file));
    }
    expect(toHex(primitive(sod.sid))).toBe(toHex(dsc.keyIdentifier));
    expect(oid(sod.attributes.get('1.2.840.113549.1.9.3'))).toBe(ICAO_OIDS.ldsSecurityObject);
    expect(toHex(octets(sod.attributes.get('1.2.840.113549.1.9.4')))).toBe(
      sha('sha256', sod.eContent),
    );
    expect(verify('sha256', sod.signedAttributes, dsc.key.publicKey, sod.signature)).toBe(true);
  });

  it('is the same chip for the same seed, and leaves DG14 and DG15 out without an AA key', () => {
    expect(toHex(chip().files.sod)).toBe(toHex(chip().files.sod));
    const { files, activeAuthenticationKey } = chip({ activeAuthentication: undefined });
    expect(Object.keys(files.dataGroups)).toEqual(['1', '2']);
    expect(activeAuthenticationKey).toBeNull();
    expect([...sodParts(files.sod).hashes.keys()]).toEqual([1, 2]);
  });

  it('signs with an RSA DSC as rsaEncryption or RSASSA-PSS', () => {
    const { csca } = pki();
    const dsc = buildDsc({ seed: 'chip-rsa', issuer: csca, now, key: { kind: 'rsa', bits: 2048 } });
    for (const sodSignature of [{ rsa: 'rsa-encryption' }, { rsa: 'pss' }] as const) {
      const { files } = buildChip({
        dsc,
        mrzLines: MRZ,
        portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
        seed: 'rsa-chip',
        sodSignature,
      });
      const sod = sodParts(files.sod);
      const padding =
        sodSignature.rsa === 'pss'
          ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }
          : { padding: constants.RSA_PKCS1_PADDING };
      expect(
        verify(
          'sha256',
          sod.signedAttributes,
          { key: dsc.key.publicKey, ...padding },
          sod.signature,
        ),
      ).toBe(true);
    }
  });

  it('writes an ISO/IEC 39794-5 portrait on request', () => {
    const dg2 = chip({ portraitFormat: 'iso39794-5' }).files.dataGroups[2] ?? new Uint8Array();
    expect(toHex(dg2)).toContain('7f2e');
    expect(toHex(dg2)).toContain(toHex(JPEG));
  });

  it('withholds the data groups asked, which the SOD still lists', () => {
    const { files } = chip({ withhold: [15] });
    expect(Object.keys(files.dataGroups)).toEqual(['1', '2', '14']);
    expect([...sodParts(files.sod).hashes.keys()]).toEqual([1, 2, 14, 15]);
  });

  it.each([
    [
      'tampered-dg1',
      ({ files, sod }: Variant) =>
        sod.hashes.get(1) !== sha('sha256', files.dataGroups[1] ?? new Uint8Array()),
    ],
    [
      'tampered-dg2',
      ({ files, sod }: Variant) =>
        sod.hashes.get(2) !== sha('sha256', files.dataGroups[2] ?? new Uint8Array()),
    ],
    ['sod-v0', ({ sod }: Variant) => sod.ldsVersion === 0 && !sod.ldsHasVersionInfo],
    [
      'sha1',
      ({ sod }: Variant) =>
        sod.ldsHashOid === HASH_ALGORITHM_OIDS.sha1 && sod.digestOid === HASH_ALGORITHM_OIDS.sha1,
    ],
    ['dsc-not-embedded', ({ sod }: Variant) => sod.certificates.length === 0],
    [
      'issuer-and-serial-sid',
      ({ sod, csca }: Variant) =>
        toHex(new Uint8Array(items(sod.sid)[0]?.valueBeforeDecodeView ?? [])) ===
        toHex(csca.subjectName),
    ],
    [
      'dg1-issuer-mismatch',
      ({ files }: Variant) => new TextDecoder().decode(files.dataGroups[1]).includes('P<UTXQUILL'),
    ],
    [
      'aa-wrong-key',
      ({ files, activeAuthenticationKey }: Variant) =>
        !toHex(files.dataGroups[15] ?? new Uint8Array()).includes(
          toHex(activeAuthenticationKey?.spki ?? new Uint8Array([1])),
        ),
    ],
    [
      'tampered-sod-signature',
      ({ sod, dsc }: Variant) =>
        !verify('sha256', sod.signedAttributes, dsc.key.publicKey, sod.signature),
    ],
    [
      'message-digest-mismatch',
      ({ sod }: Variant) =>
        toHex(octets(sod.attributes.get('1.2.840.113549.1.9.4'))) !== sha('sha256', sod.eContent),
    ],
    [
      'content-type-mismatch',
      ({ sod }: Variant) =>
        oid(sod.attributes.get('1.2.840.113549.1.9.3')) !== ICAO_OIDS.ldsSecurityObject,
    ],
    [
      'wrong-signer-identifier',
      ({ sod, dsc }: Variant) => toHex(primitive(sod.sid)) !== toHex(dsc.keyIdentifier),
    ],
    [
      'unlisted-dg15',
      ({ files, sod }: Variant) => files.dataGroups[15] !== undefined && !sod.hashes.has(15),
    ],
  ] as const)('the %s variant changes only what it names', (variant, holds) => {
    const built = chip({ variants: [variant] });
    expect(holds({ ...built, sod: sodParts(built.files.sod) })).toBe(true);
  });

  it('writes a malformed SOD and trailing bytes on request', () => {
    const malformed = chip({ variants: ['malformed-sod'] }).files.sod;
    expect(malformed[0]).toBe(0x77);
    expect(() => sodParts(malformed)).toThrow();
    const trailing = chip({ variants: ['trailing-bytes'] }).files;
    const plain = chip().files;
    expect(toHex(trailing.sod).startsWith(toHex(plain.sod))).toBe(true);
    expect(trailing.sod.length).toBeGreaterThan(plain.sod.length);
    expect((trailing.dataGroups[2] ?? []).length).toBeGreaterThan(
      (plain.dataGroups[2] ?? []).length,
    );
  });
});

type Variant = ReturnType<typeof chip> & { sod: ReturnType<typeof sodParts> };

describe('signActiveAuthentication (C65.3)', () => {
  const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it('answers in plain ECDSA over SHA-256 of the nonce for an EC key', () => {
    const key = chip().activeAuthenticationKey;
    if (key === null) {
      throw new Error('the chip has an AA key');
    }
    const response = signActiveAuthentication(key, nonce);
    expect(response).toHaveLength(64);
    expect(
      verify('sha256', nonce, { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, response),
    ).toBe(true);
  });

  it.each([
    ['sha256', [0x34, 0xcc]],
    ['sha1', [0xbc]],
  ] as const)('answers in ISO/IEC 9796-2 scheme 1 with %s for an RSA key', (hash, trailer) => {
    const spec: TestKeySpec = { kind: 'rsa', bits: 1024 };
    const key = chip({ activeAuthentication: spec }).activeAuthenticationKey;
    if (key === null) {
      throw new Error('the chip has an AA key');
    }
    const response = signActiveAuthentication(key, nonce, { hash });
    expect(response).toHaveLength(128);
    // Recover the representative with the public key: 0x6A || M1 || H(M1 || nonce) || trailer.
    const f = publicEncrypt({ key: key.publicKey, padding: constants.RSA_NO_PADDING }, response);
    const digestLength = hash === 'sha1' ? 20 : 32;
    expect(f[0]).toBe(0x6a);
    expect([...f.subarray(f.length - trailer.length)]).toEqual(trailer);
    const m1 = f.subarray(1, f.length - trailer.length - digestLength);
    const digest = f.subarray(f.length - trailer.length - digestLength, f.length - trailer.length);
    expect(createHash(hash).update(concatBytes(m1, nonce)).digest().equals(digest)).toBe(true);
  });
});
