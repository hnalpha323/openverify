/**
 * C209.3, C221.8 (Workflow 10E Stage 1a, contracts-10e): `contracts/fixtures/emrtd/utopia-chip.json`,
 * the synthetic Utopia chip the Android reader's JVM test answers APDUs from
 * (`android/openverify-nfc`, an in-process chip responder driven through the real JMRTD service).
 *
 * The file holds, for one chip built from this file's own case table and a fixed seed:
 *
 * - `mrz`: the two TD3 lines DG1 holds, and the three fields a reader opens the chip with, each with
 *   its check digit computed here;
 * - `bac`: the Basic Access Control values those fields give (Doc 9303-11 §9.7.1.1 and §9.7.2:
 *   `K_seed`, then `K_enc` and `K_mac` with odd parity), computed here with `node:crypto` alone, so
 *   the JVM responder does not take them from the Kotlin code it is testing;
 * - `files`: EF.COM, EF.SOD and the data groups, with the file identifiers of Doc 9303-10 §3.11;
 * - `active-authentication`: the chip's responses to a short list of fixed 8-byte nonces, signed by
 *   `testSignDigest` over the nonce's SHA-256 as the server's sandbox chip signs
 *   (`apps/api/src/services/sandbox-chip.ts`), so the responder and the sandbox chip answer as one
 *   chip. **No private key is exported**: a responder can answer only the listed nonces.
 *
 * Everything is synthetic (issuer `UTO`, a specimen name, a "portrait" of seeded noise that is no
 * image). The chip passes Passive Authentication under the Utopia test anchor and Active
 * Authentication for every listed nonce, which the cases below check with the server's own verifiers.
 *
 * Assert-only (C221.8): the test fails when the committed file differs from what the builders give,
 * and writes it only under `UPDATE_CONTRACT_FIXTURES=1` (then run Prettier over it), so a plain test
 * run never changes the working tree. It imports only the implementation, never another test file.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyActiveAuthentication } from '../active-authentication.js';
import { fromHex, toHex, utf8 } from '../bytes.js';
import { verifyPassiveAuthentication } from '../passive-authentication.js';
import { signActiveAuthentication } from './chip.js';
import { seededBytes, testSignDigest } from './keys.js';
import { UTOPIA, buildUtopiaChip, buildUtopiaCrl, testTrustStore } from './utopia.js';

const FIXTURE = new URL('../../../../contracts/fixtures/emrtd/utopia-chip.json', import.meta.url);

/** The case table: one chip, built around one instant from one seed. */
const NOW = new Date('2026-11-01T00:00:00Z');
const SEED = 'openverify/emrtd/utopia-chip-export/v1';
const DOCUMENT_NUMBER = 'X12345678';
const DATE_OF_BIRTH = '900101';
const DATE_OF_EXPIRY = '310101';
/** The 8-byte challenges a responder can answer; the server's are random, so a test passes one of these. */
const NONCES = ['0000000000000000', '0011223344556677', '0123456789abcdef', 'ffffffffffffffff'];
/** Seeded noise behind a JPEG marker: long enough to span several reads, and no image. */
const PORTRAIT_NOISE_BYTES = 3000;

/** The MRZ check digit (Doc 9303-3 §4.9): weights 7, 3, 1 over 0-9, A-Z as 10-35 and `<` as 0. */
function checkDigit(field: string): string {
  let sum = 0;
  for (let index = 0; index < field.length; index += 1) {
    const code = field.charCodeAt(index);
    // '<' is 0; '0'-'9' are 0-9; 'A'-'Z' are 10-35.
    const value = code === 0x3c ? 0 : code <= 0x39 ? code - 0x30 : code - 55;
    sum += value * ([7, 3, 1][index % 3] ?? 0);
  }
  return String(sum % 10);
}

function mrzLines(): readonly [string, string] {
  const number = DOCUMENT_NUMBER + checkDigit(DOCUMENT_NUMBER);
  const birth = DATE_OF_BIRTH + checkDigit(DATE_OF_BIRTH);
  const expiry = DATE_OF_EXPIRY + checkDigit(DATE_OF_EXPIRY);
  const optional = '<'.repeat(14) + checkDigit('<'.repeat(14));
  const composite = checkDigit(number + birth + expiry + optional);
  return [
    'P<UTOQUILL<<ROWAN<ASH'.padEnd(44, '<'),
    `${number}${UTOPIA.alpha3}${birth}M${expiry}${optional}${composite}`,
  ];
}

const sha1 = (bytes: Uint8Array) => new Uint8Array(createHash('sha1').update(bytes).digest());
const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** A DES key's bytes with odd parity in each (Doc 9303-11 §9.7.1.1). */
function oddParity(bytes: Uint8Array): Uint8Array {
  return bytes.map((byte) => {
    let ones = 0;
    for (let bit = 1; bit < 8; bit += 1) {
      ones += (byte >> bit) & 1;
    }
    return (byte & 0xfe) | (ones % 2 === 0 ? 1 : 0);
  });
}

/** `K_seed` from the three fields, and the two 3DES keys derived from it with counters 1 and 2. */
function basicAccessControl(information: string) {
  const seed = sha1(utf8(information)).slice(0, 16);
  const derive = (counter: number) =>
    oddParity(sha1(new Uint8Array([...seed, 0, 0, 0, counter])).slice(0, 16));
  return { seed, encryption: derive(1), mac: derive(2) };
}

function buildExport() {
  const lines = mrzLines();
  const information =
    DOCUMENT_NUMBER +
    checkDigit(DOCUMENT_NUMBER) +
    DATE_OF_BIRTH +
    checkDigit(DATE_OF_BIRTH) +
    DATE_OF_EXPIRY +
    checkDigit(DATE_OF_EXPIRY);
  const chip = buildUtopiaChip({
    now: NOW,
    seed: SEED,
    mrzLines: lines,
    portrait: {
      bytes: new Uint8Array([
        ...fromHex('ffd8ffe000104a464946'),
        ...seededBytes(`${SEED}/portrait`, PORTRAIT_NOISE_BYTES),
      ]),
      mimeType: 'image/jpeg',
    },
  });
  const bac = basicAccessControl(information);
  const group = (number: 1 | 2 | 14 | 15) => chip.files.dataGroups[number] ?? new Uint8Array();
  const files = [
    {
      name: 'com',
      kind: 'chip-com',
      identifier: '011e',
      bytes: chip.files.com ?? new Uint8Array(),
    },
    { name: 'sod', kind: 'chip-sod', identifier: '011d', bytes: chip.files.sod },
    { name: 'dg1', kind: 'chip-dg1', identifier: '0101', bytes: group(1) },
    { name: 'dg2', kind: 'chip-dg2', identifier: '0102', bytes: group(2) },
    { name: 'dg14', kind: 'chip-dg14', identifier: '010e', bytes: group(14) },
    { name: 'dg15', kind: 'chip-dg15', identifier: '010f', bytes: group(15) },
  ];
  const signer = chip.activeAuthenticationKey;
  if (signer === null) {
    throw new Error('the Utopia chip has an Active Authentication key');
  }
  const responses = NONCES.map((nonce) => ({
    nonce,
    response: toHex(
      testSignDigest(signer, sha256(fromHex(nonce)), { ec: 'plain', hash: 'sha256' }),
    ),
  }));
  const document = {
    version: 1,
    description:
      'Synthetic. The Utopia test chip for the Android reader (C209.3): written by packages/emrtd/src/testing/utopia-chip-export.test.ts under UPDATE_CONTRACT_FIXTURES=1. No real document, no image, no private value: the Active Authentication responses are precomputed for the listed nonces only.',
    issuer: UTOPIA.alpha3,
    built: { now: NOW.toISOString(), seed: SEED },
    mrz: {
      lines,
      'document-number': DOCUMENT_NUMBER,
      'date-of-birth': DATE_OF_BIRTH,
      'date-of-expiry': DATE_OF_EXPIRY,
      information,
    },
    bac: {
      'k-seed': toHex(bac.seed),
      'k-enc': toHex(bac.encryption),
      'k-mac': toHex(bac.mac),
    },
    files: files.map(({ name, kind, identifier, bytes }) => ({
      name,
      kind,
      'file-identifier': identifier,
      'short-identifier': identifier.slice(2),
      length: bytes.length,
      sha256: toHex(sha256(bytes)),
      content: base64(bytes),
    })),
    'active-authentication': {
      algorithm: 'ecdsa-plain',
      curve: 'P-256',
      hash: 'sha256',
      responses,
    },
  };
  return { chip, document, signer };
}

describe('contracts/fixtures/emrtd/utopia-chip.json (C209.3)', () => {
  const { chip, document, signer } = buildExport();

  it('holds a valid TD3 MRZ of the Utopia issuer, and the fields that open the chip', () => {
    const [first, second] = document.mrz.lines;
    expect(first).toHaveLength(44);
    expect(second).toHaveLength(44);
    // 33·7 + 1·3 + 2·1 + 3·7 + 4·3 + 5·1 + 6·7 + 7·3 + 8·1 = 345, so the digit is 5.
    expect(second.slice(0, 10)).toBe('X123456785');
    expect(second.slice(10, 13)).toBe('UTO');
    expect(document.mrz.information).toHaveLength(24);
    // Doc 9303-3's own worked check digit: the weights 7, 3, 1 over a date field.
    expect(checkDigit('520727')).toBe('3');
  });

  it('derives the access values as Doc 9303-11 Appendix D.2 works them', () => {
    // The standard's published example: document number L898902C, 1969-08-06, 1994-06-23.
    const worked = basicAccessControl('L898902C<369080619406236');
    expect(toHex(worked.seed)).toBe('239ab9cb282daf66231dc5a4df6bfbae');
    expect(toHex(worked.encryption)).toBe('ab94fdecf2674fdfb9b391f85d7f76f2');
    expect(toHex(worked.mac)).toBe('7962d9ece03d1acd4c76089dce131543');
  });

  it('passes Passive Authentication under the Utopia test anchor', () => {
    const trust = testTrustStore({
      anchors: [chip.csca],
      crls: [buildUtopiaCrl({ csca: chip.csca, now: NOW })],
    });
    const report = verifyPassiveAuthentication(chip.files, trust, {
      now: NOW,
      acceptSha1: false,
      issuerCountry: (code) => (code === UTOPIA.alpha3 ? UTOPIA.alpha2 : null),
    });
    expect(report).toMatchObject({
      integrity: 'established',
      revocation: 'unrevoked',
      issuingState: 'UTO',
    });
  });

  it('answers each listed nonce as the chip key does, and the server verifies each', () => {
    expect(document['active-authentication'].responses).toHaveLength(NONCES.length);
    for (const { nonce, response } of document['active-authentication'].responses) {
      // The prehashed signer and the chip's own signer over the nonce agree (RFC 6979).
      expect(response).toBe(toHex(signActiveAuthentication(signer, fromHex(nonce))));
      expect(fromHex(response)).toHaveLength(64);
      expect(
        verifyActiveAuthentication({
          dg15: chip.files.dataGroups[15] ?? null,
          dg15Listed: true,
          integrity: 'established',
          nonce: fromHex(nonce),
          response: fromHex(response),
          dg14: chip.files.dataGroups[14] ?? null,
        }).outcome,
      ).toBe('verified');
    }
  });

  it('lists the six files with their identifiers, and exports no private value', () => {
    expect(document.files.map((file) => `${file.name}:${file['file-identifier']}`)).toEqual([
      'com:011e',
      'sod:011d',
      'dg1:0101',
      'dg2:0102',
      'dg14:010e',
      'dg15:010f',
    ]);
    expect(document.files.every((file) => file.length > 0)).toBe(true);
    // DG2 spans several reads of a chip's file.
    expect(document.files.find((file) => file.name === 'dg2')?.length).toBeGreaterThan(2048);
    const text = JSON.stringify(document);
    expect(text).not.toMatch(/PRIVATE|private-key|"d":/u);
  });

  it('is the committed file', () => {
    const expected = `${JSON.stringify(document, null, 2)}\n`;
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      mkdirSync(new URL('.', FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, expected);
    }
    expect(existsSync(FIXTURE), 'run once with UPDATE_CONTRACT_FIXTURES=1').toBe(true);
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(expected));
  });
});
