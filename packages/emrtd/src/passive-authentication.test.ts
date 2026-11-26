/**
 * C62.2 (H02, H15): Passive Authentication with integrity apart from revocation, over the C65.3
 * variants. `broken` only when an anchor chosen by AKI→SKI verifies the DSC, the SOD parsed
 * cleanly, and its signature or an uploaded data group's hash fails; every gap on our side or
 * defect on the issuer's is `not_established` (review), never `broken`; revocation comes only
 * from the store's CRLs, and nothing is fetched. Every chip and certificate is synthetic.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { concatBytes, fromHex, toHex } from './bytes.js';
import { octetString } from './der.js';
import { ICAO_OIDS } from './oids.js';
import { verifyPassiveAuthentication } from './passive-authentication.js';
import { buildChip, type TestChipOptions } from './testing/chip.js';
import { seededBytes } from './testing/keys.js';
import {
  buildCrl,
  buildCsca,
  buildDsc,
  buildLinkCertificate,
  type TestCertificate,
  type TestCscaOptions,
  type TestDscOptions,
} from './testing/x509.js';
import type { PassiveAuthenticationOptions, TrustAnchor, TrustCrl, TrustStore } from './types.js';

const now = new Date('2026-07-01T12:00:00Z');
const DAY = 86_400_000;
const MRZ = [
  'P<UTOQUILL<<ROWAN<ASH'.padEnd(44, '<'),
  'X12345678<UTO9001014M3101016'.padEnd(42, '<') + '00',
];
const JPEG = concatBytes(fromHex('ffd8ffe0'), seededBytes('pa-jpeg', 60));
const issuerCountry = (code: string) => ({ UTO: 'UT', D: 'DE' })[code] ?? null;

function anchorOf(certificate: TestCertificate, extra: Partial<TrustAnchor> = {}): TrustAnchor {
  return {
    id: createHash('sha256').update(certificate.der).digest('hex'),
    certificate: certificate.der,
    country: certificate.country,
    ski: toHex(certificate.keyIdentifier),
    aki: null,
    isLink: false,
    sandboxOnly: true,
    withdrawn: false,
    ...extra,
  };
}

function crlOf(
  csca: TestCertificate,
  revoked: readonly string[] = [],
  nextUpdateDays = 30,
): TrustCrl {
  const thisUpdate = new Date(now.getTime() - DAY);
  return {
    der: buildCrl({ issuer: csca, now, thisUpdate, nextUpdateDays, revokedSerials: revoked }),
    issuerCountry: csca.country,
    issuerKeyId: toHex(csca.keyIdentifier),
    thisUpdate,
    nextUpdate: new Date(thisUpdate.getTime() + nextUpdateDays * DAY),
  };
}

interface Setup {
  readonly csca?: Partial<TestCscaOptions>;
  readonly dsc?: Partial<TestDscOptions>;
  readonly chip?: Partial<TestChipOptions>;
}

function setup({
  csca: cscaOptions = {},
  dsc: dscOptions = {},
  chip: chipOptions = {},
}: Setup = {}) {
  const csca = buildCsca({ seed: 'pa-csca', now, ...cscaOptions });
  const dsc = buildDsc({ seed: 'pa-dsc', issuer: csca, now, ...dscOptions });
  const chip = buildChip({
    dsc,
    mrzLines: MRZ,
    portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
    activeAuthentication: { kind: 'ec', curve: 'P-256' },
    seed: 'pa-chip',
    ...chipOptions,
  });
  const trust: TrustStore = { anchors: [anchorOf(csca)], crls: [crlOf(csca)] };
  return { csca, dsc, chip, files: chip.files, trust };
}

function verify(
  files: ReturnType<typeof setup>['files'],
  trust: TrustStore,
  options: Partial<PassiveAuthenticationOptions> = {},
) {
  return verifyPassiveAuthentication(files, trust, {
    now,
    acceptSha1: true,
    issuerCountry,
    ...options,
  });
}

describe('verifyPassiveAuthentication: established (C62.2)', () => {
  it('establishes a well-formed chip under its CSCA and finds it unrevoked', () => {
    const { csca, dsc, files, trust } = setup();
    expect(verify(files, trust)).toEqual({
      integrity: 'established',
      integrityReason: null,
      revocation: 'unrevoked',
      revocationGap: null,
      dataGroups: { 1: 'identical', 2: 'identical', 14: 'identical', 15: 'identical' },
      hashAlgorithm: 'sha256',
      signatureAlgorithm: 'ecdsa-with-sha256',
      anchor: {
        id: createHash('sha256').update(csca.der).digest('hex'),
        country: 'UT',
        matchedBy: 'aki',
        isLink: false,
        sandboxOnly: true,
      },
      dsc: { country: 'UT', notBefore: dsc.notBefore, notAfter: dsc.notAfter, embedded: true },
      issuingState: 'UTO',
      flags: [],
    });
  });

  it.each([
    [
      'named P-256 keys',
      { key: { kind: 'ec', curve: 'P-256' } },
      { key: { kind: 'ec', curve: 'P-256' } },
      {},
    ],
    [
      'explicit brainpool P-384',
      { key: { kind: 'ec', curve: 'brainpoolP384r1', explicitParameters: true } },
      {},
      {},
    ],
    [
      'an RSA-3072 CSCA signing with PSS, an RSA DSC signing as rsaEncryption',
      { key: { kind: 'rsa', bits: 3072 }, signature: { rsa: 'pss' } },
      { key: { kind: 'rsa', bits: 2048 } },
      { sodSignature: { rsa: 'rsa-encryption' } },
    ],
    [
      'an RSA DSC signing with PSS',
      {},
      { key: { kind: 'rsa', bits: 2048 } },
      { sodSignature: { rsa: 'pss' } },
    ],
    [
      'an RSA DSC signing with PKCS#1 v1.5 by name',
      {},
      { key: { kind: 'rsa', bits: 2048 } },
      { sodSignature: { rsa: 'pkcs1' } },
    ],
  ] as const)('establishes a chip with %s', (_label, csca, dsc, chip) => {
    const { files, trust } = setup({ csca, dsc, chip });
    expect(verify(files, trust)).toMatchObject({
      integrity: 'established',
      revocation: 'unrevoked',
    });
  });

  it('establishes SOD version 0, an issuer-and-serial signer and trailing bytes, flagged', () => {
    for (const [variant, flag] of [
      ['sod-v0', 'sod-v0'],
      ['issuer-and-serial-sid', null],
      ['trailing-bytes', 'trailing-bytes'],
    ] as const) {
      const { files, trust } = setup({ chip: { variants: [variant] } });
      const report = verify(files, trust);
      expect(report.integrity, variant).toBe('established');
      expect(report.flags).toEqual(flag === null ? [] : [flag]);
    }
  });

  it('takes SHA-1 with a flag when accepted, and goes to review when not (C51.3)', () => {
    const { files, trust } = setup({ chip: { variants: ['sha1'] } });
    expect(verify(files, trust)).toMatchObject({
      integrity: 'established',
      hashAlgorithm: 'sha1',
      flags: ['sha1'],
    });
    expect(verify(files, trust, { acceptSha1: false })).toMatchObject({
      integrity: 'not_established',
      integrityReason: 'algorithm_unsupported',
    });
  });

  it('finds the signer among the embedded certificates when the identifier names none', () => {
    const { files, trust } = setup({ chip: { variants: ['wrong-signer-identifier'] } });
    expect(verify(files, trust)).toMatchObject({
      integrity: 'established',
      flags: ['signer-identifier-mismatch'],
    });
  });

  it('takes a link certificate from the old CSCA as the anchor of the new key (rollover)', () => {
    const old = buildCsca({ seed: 'pa-csca', now });
    const next = buildCsca({ seed: 'pa-csca-next', now });
    const link = buildLinkCertificate({ from: old, to: next, now });
    const dsc = buildDsc({ seed: 'pa-dsc-next', issuer: next, now });
    const { files } = buildChip({
      dsc,
      mrzLines: MRZ,
      portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
      seed: 'pa-next',
    });
    const trust = {
      anchors: [anchorOf(old), anchorOf(link, { isLink: true, aki: toHex(old.keyIdentifier) })],
      crls: [crlOf(next)],
    };
    expect(verify(files, trust)).toMatchObject({
      integrity: 'established',
      anchor: { matchedBy: 'aki', isLink: true },
      flags: ['link-anchor'],
    });
  });

  it('falls back to the issuer DN when the DSC has no AKI, accepting it only because it verifies', () => {
    const { files, trust } = setup({ dsc: { omitAuthorityKeyIdentifier: true } });
    expect(verify(files, trust)).toMatchObject({
      integrity: 'established',
      anchor: { matchedBy: 'issuer_dn' },
      flags: ['issuer-dn-match'],
    });
  });

  it('reports withheld and unlisted data groups without breaking integrity', () => {
    const withheld = setup({ chip: { withhold: [15] } });
    expect(verify(withheld.files, withheld.trust)).toMatchObject({
      integrity: 'established',
      dataGroups: { 1: 'identical', 2: 'identical', 14: 'identical', 15: 'missing_from_upload' },
    });
    const unlisted = setup({ chip: { variants: ['unlisted-dg15'] } });
    expect(verify(unlisted.files, unlisted.trust)).toMatchObject({
      integrity: 'established',
      dataGroups: { 15: 'not_listed' },
    });
  });
});

describe('verifyPassiveAuthentication: broken is proven tampering only (C62.2, H02)', () => {
  it.each([
    ['tampered-dg1', 'dg_hash_mismatch', { 1: 'not_identical', 2: 'identical' }],
    ['tampered-dg2', 'dg_hash_mismatch', { 1: 'identical', 2: 'not_identical' }],
    ['tampered-sod-signature', 'sod_signature_invalid', { 1: 'identical' }],
    ['message-digest-mismatch', 'sod_signature_invalid', {}],
  ] as const)('%s breaks integrity with %s', (variant, reason, groups) => {
    const { files, trust } = setup({ chip: { variants: [variant] } });
    expect(verify(files, trust)).toMatchObject({
      integrity: 'broken',
      integrityReason: reason,
      dataGroups: groups,
      revocation: 'unrevoked',
    });
  });

  it('breaks integrity even when the DSC has expired: the tampering is still proven', () => {
    const { files, trust } = setup({
      dsc: {
        notBefore: new Date('2020-01-01T00:00:00Z'),
        notAfter: new Date('2021-01-01T00:00:00Z'),
      },
      chip: { variants: ['tampered-dg1'] },
    });
    expect(verify(files, trust)).toMatchObject({
      integrity: 'broken',
      integrityReason: 'dg_hash_mismatch',
    });
  });

  it('does not break integrity on a DN-only anchor: the mismatch goes to review, flagged', () => {
    const { files, trust } = setup({
      dsc: { omitAuthorityKeyIdentifier: true },
      chip: { variants: ['tampered-dg1'] },
    });
    expect(verify(files, trust)).toMatchObject({
      integrity: 'not_established',
      integrityReason: 'trust_anchor_unavailable',
      dataGroups: { 1: 'not_identical' },
      flags: ['issuer-dn-match', 'dg-hash-mismatch'],
    });
  });
});

describe('verifyPassiveAuthentication: not established is review, never broken (C62.2, C62.3)', () => {
  it.each([
    ['a malformed SOD', { chip: { variants: ['malformed-sod'] } }, 'chip_data_malformed'],
    [
      'a signed content type that is not the LDS',
      { chip: { variants: ['content-type-mismatch'] } },
      'chip_data_malformed',
    ],
    ['no DSC in the SOD', { chip: { variants: ['dsc-not-embedded'] } }, 'dsc_missing'],
    [
      'an expired DSC',
      {
        dsc: {
          notBefore: new Date('2020-01-01T00:00:00Z'),
          notAfter: new Date('2021-01-01T00:00:00Z'),
        },
      },
      'certificate_expired',
    ],
    [
      'an expired CSCA',
      {
        csca: {
          notBefore: new Date('2010-01-01T00:00:00Z'),
          notAfter: new Date('2025-01-01T00:00:00Z'),
        },
      },
      'certificate_expired',
    ],
    ['a DSC with cA true', { dsc: { ca: true } }, 'certificate_profile_invalid'],
    [
      'a DSC with the master list signer EKU',
      { dsc: { extendedKeyUsage: [ICAO_OIDS.cscaMasterListSigningKey] } },
      'certificate_profile_invalid',
    ],
    [
      'a DSC without digitalSignature',
      { dsc: { keyUsage: ['nonRepudiation'] } },
      'certificate_profile_invalid',
    ],
    [
      'a DSC with an unknown critical extension',
      {
        dsc: {
          extraExtensions: [
            { oid: '1.2.3.4.5', critical: true, value: octetString(new Uint8Array(1)) },
          ],
        },
      },
      'certificate_profile_invalid',
    ],
    [
      'a CSCA without keyCertSign',
      { csca: { keyUsage: ['cRLSign'] } },
      'certificate_profile_invalid',
    ],
    [
      'a DG1 issuer outside the DSC country',
      { chip: { variants: ['dg1-issuer-mismatch'] } },
      'issuer_country_inconsistent',
    ],
    [
      'a DSC of another country than its CSCA',
      { dsc: { country: 'XX' } },
      'issuer_country_inconsistent',
    ],
    [
      'a 16,384-bit DSC modulus',
      { dsc: { key: { kind: 'oversized-rsa' } } },
      'algorithm_unsupported',
    ],
    [
      'a DSC on a curve outside the allowlist',
      { dsc: { key: { kind: 'ec', curve: 'secp256k1', explicitParameters: true } } },
      'algorithm_unsupported',
    ],
    ['no DG1 uploaded', { chip: { withhold: [1] } }, 'input_missing'],
  ] as const satisfies readonly (readonly [string, Setup, string])[])(
    '%s: not established, %s',
    (_label, options, reason) => {
      const { files, trust } = setup(options);
      const report = verify(files, trust);
      expect(report.integrity).toBe('not_established');
      expect(report.integrityReason).toBe(reason);
    },
  );

  it('flags a DG1 issuer that has no country', () => {
    const { files, trust } = setup({ chip: { variants: ['dg1-issuer-mismatch'] } });
    expect(verify(files, trust).flags).toContain('issuer-country-unmapped');
    expect(verify(files, trust, { issuerCountry: () => 'XX' }).flags).not.toContain(
      'issuer-country-unmapped',
    );
  });

  it('answers trust_anchor_unavailable for a CSCA rollover whose new key the store lacks, with AKI or without', () => {
    for (const omitAuthorityKeyIdentifier of [false, true]) {
      const old = buildCsca({ seed: 'pa-csca', now });
      const next = buildCsca({ seed: 'pa-csca-next', now });
      const dsc = buildDsc({ seed: 'pa-dsc-next', issuer: next, now, omitAuthorityKeyIdentifier });
      const { files } = buildChip({
        dsc,
        mrzLines: MRZ,
        portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
        seed: 'pa-next',
      });
      expect(verify(files, { anchors: [anchorOf(old)], crls: [] })).toMatchObject({
        integrity: 'not_established',
        integrityReason: 'trust_anchor_unavailable',
        anchor: null,
      });
    }
  });

  // Workflow 5C review P002: a SOD asn1js throws on is malformed chip data (review), not a crash.
  it('answers chip_data_malformed for a SOD holding a BMPString of odd length', () => {
    expect(
      verify({ sod: fromHex('77051e03414243'), dataGroups: {} }, { anchors: [], crls: [] }),
    ).toMatchObject({ integrity: 'not_established', integrityReason: 'chip_data_malformed' });
  });

  it('answers trust_anchor_unavailable for an empty store or an unreadable anchor', () => {
    const { files } = setup();
    expect(verify(files, { anchors: [], crls: [] }).integrityReason).toBe(
      'trust_anchor_unavailable',
    );
    const broken = anchorOf(setup().csca, { certificate: fromHex('3000') });
    expect(verify(files, { anchors: [broken], crls: [] }).integrityReason).toBe(
      'trust_anchor_unavailable',
    );
  });

  it('answers trust_anchor_withdrawn for an anchor no enabled source lists (C62.7)', () => {
    const { csca, files } = setup();
    expect(
      verify(files, { anchors: [anchorOf(csca, { withdrawn: true })], crls: [] }),
    ).toMatchObject({
      integrity: 'not_established',
      integrityReason: 'trust_anchor_withdrawn',
      anchor: { matchedBy: 'aki' },
    });
  });

  it('stops at the time budget (C62.1)', () => {
    const { files, trust } = setup();
    expect(verify(files, trust, { timeBudgetMs: 0 })).toMatchObject({
      integrity: 'not_established',
      integrityReason: 'chip_data_malformed',
      flags: ['time-budget-exceeded'],
    });
  });

  it('answers algorithm_unsupported, even for a tampered chip, after a failed self-test (C62.9)', () => {
    const { files, trust } = setup({ chip: { variants: ['tampered-dg1'] } });
    const failed = { ok: false, failures: ['brainpoolP256r1-explicit'], node: 'x', openssl: 'y' };
    expect(verify(files, trust, { selfTest: failed })).toMatchObject({
      integrity: 'not_established',
      integrityReason: 'algorithm_unsupported',
      flags: expect.arrayContaining(['self-test-failed']) as unknown,
    });
  });
});

describe('verifyPassiveAuthentication: revocation apart from integrity (C62.2, C62.7)', () => {
  it('finds a DSC on a current CRL revoked, its integrity still established', () => {
    const { csca, dsc, files } = setup();
    expect(
      verify(files, { anchors: [anchorOf(csca)], crls: [crlOf(csca, [dsc.serialNumber])] }),
    ).toMatchObject({
      integrity: 'established',
      revocation: 'revoked',
      revocationGap: null,
    });
  });

  it('answers undetermined without a current CRL: crl_unavailable, or no_distribution_point', () => {
    const named = setup({
      csca: { crlDistributionPoint: 'https://pkd.example.invalid/UT.crl' },
      dsc: { crlDistributionPoint: 'https://pkd.example.invalid/UT.crl' },
    });
    expect(verify(named.files, { anchors: named.trust.anchors, crls: [] })).toMatchObject({
      integrity: 'established',
      revocation: 'undetermined',
      revocationGap: 'crl_unavailable',
    });
    const unnamed = setup();
    expect(verify(unnamed.files, { anchors: unnamed.trust.anchors, crls: [] })).toMatchObject({
      revocation: 'undetermined',
      revocationGap: 'no_distribution_point',
    });
  });

  // Workflow 5C review P001, P007: serial numbers are unique per issuer only (RFC 5280 §4.1.2.2),
  // so only a CRL issued under the DSC's CSCA name decides: another CSCA of the same country can
  // neither revoke the DSC nor vouch for it.
  describe('with two CSCAs of one country under different names', () => {
    const first = buildCsca({ seed: 'pa-csca', now, commonName: 'CSCA Utopia' });
    const second = buildCsca({ seed: 'pa-csca-second', now, commonName: 'CSCA Utopia 2' });
    const dsc = buildDsc({ seed: 'pa-dsc', issuer: first, now });
    const { files } = buildChip({
      dsc,
      mrzLines: MRZ,
      portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
      seed: 'pa-chip',
    });
    const anchors = [anchorOf(first), anchorOf(second)];

    it('does not revoke the DSC for a serial the other CSCA revoked', () => {
      expect(
        verify(files, { anchors, crls: [crlOf(first), crlOf(second, [dsc.serialNumber])] }),
      ).toMatchObject({ integrity: 'established', revocation: 'unrevoked', revocationGap: null });
    });

    it("leaves revocation undetermined when only the other CSCA's CRL is current", () => {
      expect(verify(files, { anchors, crls: [crlOf(second)] })).toMatchObject({
        integrity: 'established',
        revocation: 'undetermined',
        revocationGap: 'no_distribution_point',
      });
      expect(verify(files, { anchors, crls: [crlOf(second, [dsc.serialNumber])] })).toMatchObject({
        revocation: 'undetermined',
        revocationGap: 'no_distribution_point',
      });
    });

    it("revokes the DSC on its own CSCA's CRL", () => {
      expect(
        verify(files, { anchors, crls: [crlOf(second), crlOf(first, [dsc.serialNumber])] }),
      ).toMatchObject({ integrity: 'established', revocation: 'revoked', revocationGap: null });
    });
  });

  it("takes the CRL a new key signs under the CSCA's unchanged name for an old key's DSC", () => {
    const old = buildCsca({ seed: 'pa-csca', now });
    const next = buildCsca({ seed: 'pa-csca-next', now });
    const dsc = buildDsc({ seed: 'pa-dsc-old', issuer: old, now });
    const { files } = buildChip({
      dsc,
      mrzLines: MRZ,
      portrait: { bytes: JPEG, mimeType: 'image/jpeg' },
      seed: 'pa-old',
    });
    const anchors = [anchorOf(old), anchorOf(next)];
    expect(verify(files, { anchors, crls: [crlOf(next)] })).toMatchObject({
      integrity: 'established',
      revocation: 'unrevoked',
    });
    expect(verify(files, { anchors, crls: [crlOf(next, [dsc.serialNumber])] })).toMatchObject({
      revocation: 'revoked',
    });
  });

  it('reads a stale CRL, a CRL of another country and an unreadable CRL as no current CRL', () => {
    const { csca, files } = setup({
      csca: { crlDistributionPoint: 'https://pkd.example.invalid/UT.crl' },
    });
    const stale = { ...crlOf(csca), nextUpdate: new Date(now.getTime() - 1) };
    const foreign = { ...crlOf(csca), issuerCountry: 'XX' };
    const unreadable = { ...crlOf(csca), der: fromHex('3000') };
    const undated = { ...crlOf(csca), nextUpdate: null };
    const future = { ...crlOf(csca), thisUpdate: new Date(now.getTime() + DAY) };
    for (const crl of [stale, foreign, unreadable, undated, future]) {
      expect(verify(files, { anchors: [anchorOf(csca)], crls: [crl] })).toMatchObject({
        revocation: 'undetermined',
        revocationGap: 'crl_unavailable',
      });
    }
  });
});

describe('verifyPassiveAuthentication fetches nothing (C62.7)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes no network call for a DSC whose distribution point is a URL', () => {
    const calls = [
      vi.spyOn(globalThis, 'fetch'),
      vi.spyOn(http, 'request'),
      vi.spyOn(http, 'get'),
      vi.spyOn(https, 'request'),
      vi.spyOn(https, 'get'),
      vi.spyOn(net, 'connect'),
    ];
    const { files, trust } = setup({
      dsc: { crlDistributionPoint: 'https://pkd.example.invalid/UT.crl' },
    });
    verify(files, { anchors: trust.anchors, crls: [] });
    for (const call of calls) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('imports no network module anywhere in the package', () => {
    const root = path.resolve(import.meta.dirname);
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(10);
    for (const file of sources) {
      const text = readFileSync(path.join(root, file), 'utf8');
      expect(text, file).not.toMatch(/from 'node:(?:http|https|net|dns|tls|dgram)'|\bfetch\(/);
    }
  });
});
