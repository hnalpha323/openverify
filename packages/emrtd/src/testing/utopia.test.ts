/**
 * C62.8, C65.3, C65.5: the Utopia PKI the dev seed and the e2e run build, and the generation-time
 * bound. The CSCA is the same within a calendar year and keeps its key across years; its CRL is
 * fresh on each seed; a per-run chip under it passes Passive and Active Authentication.
 */
import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from '../bytes.js';
import { verifyActiveAuthentication } from '../active-authentication.js';
import { verifyPassiveAuthentication } from '../passive-authentication.js';
import { parseCertificate, parseCrl, verifyCrlSignature } from '../pki.js';
import { buildChip, signActiveAuthentication } from './chip.js';
import { buildCsca, buildDsc } from './x509.js';
import {
  UTOPIA,
  UTOPIA_CSCA_SEED,
  buildUtopiaChip,
  buildUtopiaCrl,
  buildUtopiaCsca,
  testTrustStore,
} from './utopia.js';

const DAY = 86_400_000;
const now = new Date('2026-10-23T09:30:00Z');
const MRZ = [
  'P<UTOQUILL<<ROWAN<ASH'.padEnd(44, '<'),
  'X12345678<UTO9001014M3101016'.padEnd(42, '<') + '00',
];
const JPEG = fromHex('ffd8ffe000104a464946');
const issuerCountry = (code: string) => (code === UTOPIA.alpha3 ? UTOPIA.alpha2 : null);

describe('buildUtopiaCsca (C62.8)', () => {
  it('is the same certificate within a calendar year, valid from last year for sixteen years', () => {
    const csca = buildUtopiaCsca({ now });
    expect(toHex(csca.der)).toBe(
      toHex(buildUtopiaCsca({ now: new Date('2026-02-01T00:00:00Z') }).der),
    );
    expect(csca).toMatchObject({
      country: 'UT',
      notBefore: new Date('2025-01-01T00:00:00Z'),
      notAfter: new Date('2041-01-01T00:00:00Z'),
    });
    expect(parseCertificate(csca.der)).toMatchObject({
      subjectDn: 'C=UT, O=OpenVerify Test, CN=CSCA Utopia',
      isCa: true,
    });
    expect(csca.key.spec).toEqual({
      kind: 'ec',
      curve: 'brainpoolP256r1',
      explicitParameters: true,
    });
    expect(csca.key.seed).toBe(UTOPIA_CSCA_SEED);
  });

  it('keeps its key, name and key identifier in another year', () => {
    const next = buildUtopiaCsca({ now: new Date('2027-03-01T00:00:00Z') });
    const csca = buildUtopiaCsca({ now });
    expect(toHex(next.der)).not.toBe(toHex(csca.der));
    expect(toHex(next.keyIdentifier)).toBe(toHex(csca.keyIdentifier));
    expect(toHex(next.subjectName)).toBe(toHex(csca.subjectName));
  });
});

describe('buildUtopiaCrl (C62.8)', () => {
  it('is current for 90 days from now, numbered by the day, signed by the CSCA', () => {
    const csca = buildUtopiaCsca({ now });
    const crl = parseCrl(buildUtopiaCrl({ csca, now, revokedSerials: ['0a'] }));
    expect(crl).toMatchObject({
      issuerCountry: 'UT',
      issuerKeyId: toHex(csca.keyIdentifier),
      thisUpdate: new Date('2026-10-23T09:30:00Z'),
      nextUpdate: new Date(now.getTime() + 90 * DAY),
      crlNumber: String(Math.floor(now.getTime() / DAY)),
      revokedSerials: ['0a'],
    });
    expect(verifyCrlSignature(crl, parseCertificate(csca.der))).toBe(true);
    const later = parseCrl(buildUtopiaCrl({ csca, now: new Date(now.getTime() + DAY) }));
    expect(Number(later.crlNumber)).toBeGreaterThan(Number(crl.crlNumber));
  });
});

describe('buildUtopiaChip (C65.5)', () => {
  it('builds a per-run chip that passes PA under the seeded CSCA and AA over the nonce', () => {
    const utopia = buildUtopiaChip({
      now,
      seed: 'e2e-run-1',
      mrzLines: MRZ,
      portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
    });
    const csca = buildUtopiaCsca({ now });
    expect(toHex(utopia.csca.der)).toBe(toHex(csca.der));
    expect(parseCertificate(utopia.dsc.der).aki).toBe(toHex(csca.keyIdentifier));
    const trust = testTrustStore({ anchors: [csca], crls: [buildUtopiaCrl({ csca, now })] });
    const report = verifyPassiveAuthentication(utopia.files, trust, {
      now,
      acceptSha1: true,
      issuerCountry,
    });
    expect(report).toMatchObject({
      integrity: 'established',
      revocation: 'unrevoked',
      issuingState: 'UTO',
    });
    const key = utopia.activeAuthenticationKey;
    expect(key?.spec).toEqual({ kind: 'ec', curve: 'P-256', explicitParameters: false });
    const nonce = fromHex('0011223344556677');
    expect(
      verifyActiveAuthentication({
        dg15: utopia.files.dataGroups[15] ?? null,
        dg15Listed: true,
        integrity: report.integrity,
        nonce,
        response: key === null ? null : signActiveAuthentication(key, nonce),
        dg14: utopia.files.dataGroups[14] ?? null,
      }).outcome,
    ).toBe('verified');
  });

  it('builds the same chip for the same run seed, another for another', () => {
    const options = {
      now,
      mrzLines: MRZ,
      portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
    } as const;
    const first = buildUtopiaChip({ ...options, seed: 'e2e-run-2' });
    expect(toHex(first.files.sod)).toBe(
      toHex(buildUtopiaChip({ ...options, seed: 'e2e-run-2' }).files.sod),
    );
    expect(toHex(first.files.sod)).not.toBe(
      toHex(buildUtopiaChip({ ...options, seed: 'e2e-run-3' }).files.sod),
    );
  });
});

describe('testTrustStore', () => {
  it('reads anchors and CRLs as the repository loader returns them', () => {
    const csca = buildUtopiaCsca({ now });
    const crl = buildUtopiaCrl({ csca, now });
    const store = testTrustStore({ anchors: [csca], crls: [crl] });
    expect(store.anchors).toEqual([
      {
        id: parseCertificate(csca.der).sha256,
        certificate: csca.der,
        country: 'UT',
        ski: toHex(csca.keyIdentifier),
        aki: toHex(csca.keyIdentifier),
        isLink: false,
        sandboxOnly: true,
        withdrawn: false,
      },
    ]);
    expect(store.crls).toEqual([
      {
        der: crl,
        issuerCountry: 'UT',
        issuerKeyId: toHex(csca.keyIdentifier),
        thisUpdate: parseCrl(crl).thisUpdate,
        nextUpdate: parseCrl(crl).nextUpdate,
      },
    ]);
    expect(testTrustStore({ anchors: [] })).toEqual({ anchors: [], crls: [] });
  });
});

/**
 * The CPU time `run` takes, which other processes on a loaded machine do not stretch: these budgets
 * bound the work, and a wall clock would measure the machine (12,956 ms at a load of 47).
 */
function cpuMilliseconds(run: () => void): number {
  const before = process.cpuUsage();
  run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

describe('generation time (C65.3)', () => {
  it('builds a fresh RSA chip set (a 3,072-bit CSCA, a 2,048-bit DSC and AA key) within 10 seconds of CPU time', () => {
    const run = `${String(Date.now())}-${String(Math.random())}`;
    const milliseconds = cpuMilliseconds(() => {
      const csca = buildCsca({ seed: `timing-csca-${run}`, now, key: { kind: 'rsa', bits: 3072 } });
      const dsc = buildDsc({
        seed: `timing-dsc-${run}`,
        issuer: csca,
        now,
        key: { kind: 'rsa', bits: 2048 },
      });
      buildChip({
        dsc,
        mrzLines: MRZ,
        portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
        activeAuthentication: { kind: 'rsa', bits: 2048 },
        seed: `timing-chip-${run}`,
      });
    });
    expect(milliseconds).toBeLessThan(10_000);
  });

  it('builds a fresh Utopia chip (elliptic curves only) within 2 seconds of CPU time', () => {
    const milliseconds = cpuMilliseconds(() => {
      buildUtopiaChip({
        now,
        seed: `timing-utopia-${String(Date.now())}`,
        mrzLines: MRZ,
        portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
      });
    });
    expect(milliseconds).toBeLessThan(2_000);
  });
});
