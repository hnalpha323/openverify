/**
 * C62.1, C62.5: the chip file parsers. EF.SOD is read as CMS SignedData over the LDS security
 * object (version 0 or 1, the listed data groups and their hashes, the signer identifier, the
 * embedded DSC, the signature the reuse lookup indexes); DG1 gives the MRZ exactly; DG2 the face
 * image of ISO/IEC 19794-5 or 39794-5; DG15 the AA key within the C62.1 bounds. Inputs are
 * synthetic chips or hand-written TLVs.
 */
import { describe, expect, it } from 'vitest';
import { concatBytes, fromHex, toHex, utf8 } from './bytes.js';
import {
  algorithmIdentifier,
  explicit,
  implicitPrimitive,
  integer,
  objectIdentifier,
  octetString,
  sequence,
  setOf,
  tlv,
} from './der.js';
import { EmrtdError } from './errors.js';
import { ICAO_OIDS } from './oids.js';
import {
  activeAuthenticationHashOf,
  parseDg1,
  parseDg15,
  parseDg2,
  parseSod,
  readSod,
} from './parse.js';
import { buildChip, type TestChipOptions } from './testing/chip.js';
import { seededBytes } from './testing/keys.js';
import { buildCsca, buildDsc } from './testing/x509.js';

const now = new Date('2026-07-01T12:00:00Z');
const TD3 = [
  'P<UTOQUILL<<ROWAN<ASH'.padEnd(44, '<'),
  'X12345678<UTO9001014M3101016'.padEnd(42, '<') + '00',
];
const JPEG = concatBytes(fromHex('ffd8ffe0'), seededBytes('jpeg', 60));
const JP2 = concatBytes(fromHex('0000000c6a5020200d0a870a'), seededBytes('jp2', 40));
const J2K = concatBytes(fromHex('ff4fff51'), seededBytes('j2k', 40));

function chip(overrides: Partial<TestChipOptions> = {}) {
  const csca = buildCsca({ seed: 'parse-csca', now });
  const dsc = buildDsc({ seed: 'parse-dsc', issuer: csca, now });
  return {
    dsc,
    ...buildChip({
      dsc,
      mrzLines: TD3,
      portrait: { bytes: JPEG, mimeType: 'image/jpeg', width: 240, height: 320 },
      activeAuthentication: { kind: 'ec', curve: 'P-256' },
      seed: 'parse-chip',
      ...overrides,
    }),
  };
}

function refusal(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof EmrtdError) {
      return error.message;
    }
    throw error;
  }
  return 'none';
}

describe('parseSod (C62.5, C62.6)', () => {
  it('reads the LDS version, digest, listed groups, signer and signature', () => {
    const { files } = chip();
    const sod = parseSod(files.sod);
    expect(sod).toMatchObject({
      version: 1,
      hashAlgorithm: 'sha256',
      listedDataGroups: [1, 2, 14, 15],
      signerIdentifier: 'subject_key_identifier',
      embedsDsc: true,
    });
    expect(sod.signature.length).toBeGreaterThan(60);
    expect(toHex(files.sod)).toContain(toHex(sod.signature));
  });

  it('reads version 0, SHA-1, issuer-and-serial signers and SODs without their DSC', () => {
    expect(parseSod(chip({ variants: ['sod-v0'] }).files.sod).version).toBe(0);
    expect(parseSod(chip({ variants: ['sha1'] }).files.sod).hashAlgorithm).toBe('sha1');
    expect(parseSod(chip({ variants: ['issuer-and-serial-sid'] }).files.sod)).toMatchObject({
      signerIdentifier: 'issuer_and_serial',
      embedsDsc: true,
    });
    expect(parseSod(chip({ variants: ['dsc-not-embedded'] }).files.sod).embedsDsc).toBe(false);
    expect(parseSod(chip({ variants: ['wrong-signer-identifier'] }).files.sod).embedsDsc).toBe(
      false,
    );
  });

  it('reads what PA needs and notes trailing bytes after the SOD', () => {
    const { files } = chip({ variants: ['trailing-bytes'] });
    const contents = readSod(files.sod);
    expect(contents.trailingBytes).toBe(true);
    expect([...contents.hashes.keys()]).toEqual([1, 2, 14, 15]);
    expect(contents.hashOid).toBe('2.16.840.1.101.3.4.2.1');
    expect(contents.signedData.certificates).toHaveLength(1);
    expect(contents.signedData.signer.sid.kind).toBe('subject_key_identifier');
    expect(readSod(chip().files.sod).trailingBytes).toBe(false);
  });

  it('reads an unknown LDS digest as null', () => {
    const lds = sequence(
      integer(0),
      sequence(objectIdentifier('1.2.3.4')),
      sequence(sequence(integer(1), octetString(new Uint8Array(32)))),
    );
    // parseSod reads the LDS security object before any signature check, so no signer is needed.
    const signerInfo = sequence(
      integer(3),
      implicitPrimitive(0, new Uint8Array(20)),
      algorithmIdentifier('2.16.840.1.101.3.4.2.1'),
      algorithmIdentifier('1.2.840.10045.4.3.2'),
      octetString(new Uint8Array(64)),
    );
    const signedData = sequence(
      integer(3),
      setOf([]),
      sequence(objectIdentifier(ICAO_OIDS.ldsSecurityObject), explicit(0, octetString(lds))),
      setOf([signerInfo]),
    );
    const sod = tlv(
      0x77,
      sequence(objectIdentifier('1.2.840.113549.1.7.2'), explicit(0, signedData)),
    );
    expect(parseSod(sod)).toMatchObject({
      hashAlgorithm: null,
      listedDataGroups: [1],
      embedsDsc: false,
    });
  });

  it.each([
    ['a malformed SOD', () => chip({ variants: ['malformed-sod'] }).files.sod],
    ['another tag', () => tlv(0x76, sequence())],
    ['garbage inside the SOD', () => tlv(0x77, fromHex('0102'))],
    [
      'a SignedData of another content type',
      () => tlv(0x77, sequence(objectIdentifier('1.2.840.113549.1.7.1'), tlv(0xa0, sequence()))),
    ],
  ])('refuses %s', (_label, sod) => {
    expect(refusal(() => parseSod(sod()))).toBe('parseSod: chip_data_malformed');
  });
});

describe('hostile strings inside a chip file (Workflow 5C review P002)', () => {
  it('refuses a SOD or a DG15 holding a BMPString of odd length with chip_data_malformed', () => {
    expect(refusal(() => parseSod(fromHex('77051e03414243')))).toBe(
      'parseSod: chip_data_malformed',
    );
    expect(refusal(() => parseDg15(fromHex('6f051e03414243')))).toBe(
      'parseDg15: chip_data_malformed',
    );
  });
});

describe('parseDg1 (C62.1)', () => {
  it.each([
    ['TD3', TD3],
    ['TD2', ['I<UTOQUILL<<ROWAN'.padEnd(36, '<'), 'X12345678<UTO9001014M3101016'.padEnd(36, '<')]],
    [
      'TD1',
      [
        'I<UTOX12345678<'.padEnd(30, '<'),
        '9001014M3101016UTO'.padEnd(30, '<'),
        'QUILL<<ROWAN'.padEnd(30, '<'),
      ],
    ],
  ])('reads a %s MRZ exactly', (_format, lines) => {
    const dg1 = tlv(0x61, tlv(0x5f1f, utf8(lines.join(''))));
    expect(parseDg1(dg1)).toEqual({ mrzLines: lines });
    expect(parseDg1(concatBytes(dg1, fromHex('0000'))).mrzLines).toEqual(lines);
  });

  it.each([
    ['another tag', tlv(0x62, tlv(0x5f1f, utf8('<'.repeat(88))))],
    ['no MRZ element', tlv(0x61, tlv(0x5f20, utf8('<'.repeat(88))))],
    ['an MRZ of another length', tlv(0x61, tlv(0x5f1f, utf8('<'.repeat(87))))],
    ['characters outside the MRZ set', tlv(0x61, tlv(0x5f1f, utf8('a'.repeat(88))))],
  ])('refuses %s', (_label, dg1) => {
    expect(refusal(() => parseDg1(dg1))).toBe('parseDg1: chip_data_malformed');
  });
});

/** An ISO/IEC 19794-5 face record around `image` (Doc 9303-10 §4.7.2). */
function faceRecord(image: Uint8Array, imageType: number, featurePoints = 0): Uint8Array {
  const block = 20 + 8 * featurePoints + 12 + image.length;
  const u32 = (value: number) => fromHex(value.toString(16).padStart(8, '0'));
  const u16 = (value: number) => fromHex(value.toString(16).padStart(4, '0'));
  return concatBytes(
    utf8('FAC\u0000010\u0000'),
    u32(14 + block),
    u16(1),
    u32(block),
    u16(featurePoints),
    new Uint8Array(14),
    new Uint8Array(8 * featurePoints),
    new Uint8Array([1, imageType]),
    u16(240),
    u16(320),
    new Uint8Array(6),
    image,
  );
}

const dg2Of = (bdb: Uint8Array) =>
  tlv(
    0x75,
    tlv(0x7f61, tlv(0x02, fromHex('01')), tlv(0x7f60, tlv(0xa1, tlv(0x80, fromHex('0101'))), bdb)),
  );

describe('parseDg2 (C62.1)', () => {
  it('reads the 19794-5 face image of a synthetic chip', () => {
    expect(parseDg2(chip().files.dataGroups[2] ?? new Uint8Array())).toEqual({
      format: 'iso19794-5',
      mimeType: 'image/jpeg',
      image: JPEG,
      width: 240,
      height: 320,
    });
  });

  it.each([
    ['a JPEG 2000 file', JP2, 1, 'image/jp2'],
    ['a raw J2K codestream', J2K, 1, 'image/jp2'],
    ['a JPEG behind feature points', JPEG, 0, 'image/jpeg'],
  ] as const)('reads %s by its bytes', (_label, image, imageType, mimeType) => {
    const parsed = parseDg2(
      dg2Of(tlv(0x5f2e, faceRecord(image, imageType, image === JPEG ? 2 : 0))),
    );
    expect(parsed).toMatchObject({ format: 'iso19794-5', mimeType, width: 240, height: 320 });
    expect(toHex(parsed.image)).toBe(toHex(image));
  });

  it('reads the 39794-5 face image of a synthetic chip, sizes unstated', () => {
    expect(
      parseDg2(chip({ portraitFormat: 'iso39794-5' }).files.dataGroups[2] ?? new Uint8Array()),
    ).toEqual({
      format: 'iso39794-5',
      mimeType: 'image/jpeg',
      image: JPEG,
      width: null,
      height: null,
    });
  });

  it.each([
    ['another tag', () => tlv(0x76, sequence())],
    ['no biometric group', () => tlv(0x75, tlv(0x02, fromHex('01')))],
    [
      'no biometric data block',
      () => tlv(0x75, tlv(0x7f61, tlv(0x02, fromHex('01')), tlv(0x7f60, tlv(0xa1, sequence())))),
    ],
    [
      'another record format',
      () => dg2Of(tlv(0x5f2e, concatBytes(utf8('FAC\u0000030\u0000'), new Uint8Array(40)))),
    ],
    ['a record shorter than its header', () => dg2Of(tlv(0x5f2e, utf8('FAC\u0000010\u0000')))],
    ['an image past the record', () => dg2Of(tlv(0x5f2e, faceRecord(JPEG, 0).subarray(0, 60)))],
    ['bytes that are no image', () => dg2Of(tlv(0x5f2e, faceRecord(seededBytes('noise', 30), 0)))],
    ['a 39794-5 block without an image', () => dg2Of(tlv(0x7f2e, tlv(0xa1, sequence())))],
  ])('refuses %s', (_label, dg2) => {
    expect(refusal(() => parseDg2(dg2()))).toBe('parseDg2: chip_data_malformed');
  });
});

describe('parseDg15 (C62.1, C62.6)', () => {
  it('reads the AA key of a synthetic chip', () => {
    const { files, activeAuthenticationKey } = chip();
    expect(parseDg15(files.dataGroups[15] ?? new Uint8Array())).toEqual({
      keyAlgorithm: 'ec',
      spki: activeAuthenticationKey?.spki,
    });
    const rsa = chip({ activeAuthentication: { kind: 'rsa', bits: 1024 } }).files.dataGroups[15];
    expect(parseDg15(rsa ?? new Uint8Array()).keyAlgorithm).toBe('rsa');
  });

  it('refuses a key outside the bounds and a file that is no DG15', () => {
    const oversized = chip({ activeAuthentication: { kind: 'oversized-rsa' } }).files
      .dataGroups[15];
    expect(refusal(() => parseDg15(oversized ?? new Uint8Array()))).toBe(
      'parseDg15: algorithm_unsupported',
    );
    expect(refusal(() => parseDg15(tlv(0x6e, sequence())))).toBe('parseDg15: chip_data_malformed');
    expect(refusal(() => parseDg15(tlv(0x6f, sequence(), sequence())))).toBe(
      'parseDg15: chip_data_malformed',
    );
  });
});

describe('activeAuthenticationHashOf (Doc 9303-11 §6.1)', () => {
  it("reads DG14's AA algorithm, and nothing from anything else", () => {
    expect(activeAuthenticationHashOf(chip().files.dataGroups[14] ?? new Uint8Array())).toBe(
      'sha256',
    );
    const other = tlv(
      0x6e,
      setOf([sequence(objectIdentifier('0.4.0.127.0.7.2.2.3.2.1'), integer(1))]),
    );
    expect(activeAuthenticationHashOf(other)).toBeNull();
    expect(activeAuthenticationHashOf(fromHex('0102'))).toBeNull();
    const unknown = tlv(
      0x6e,
      setOf([sequence(objectIdentifier('2.23.136.1.1.5'), integer(1), objectIdentifier('1.2.3'))]),
    );
    expect(activeAuthenticationHashOf(unknown)).toBeNull();
  });
});
