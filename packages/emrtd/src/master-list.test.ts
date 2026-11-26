/**
 * C62.7: CSCA master lists parsed within their own caps and verified against a pinned root: the
 * eContentType and signed contentType (2.23.136.1.1.2), the signer's EKU (2.23.136.1.1.3) and
 * key usage, its issuance by the root or by a CSCA the root's link certifies, its validity at
 * signing time, `messageDigest`, and the signature over the original signed attributes. The
 * synthetic list is checked with asn1js and node:crypto too.
 */
import { createHash, verify } from 'node:crypto';
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import { toHex } from './bytes.js';
import { EmrtdError } from './errors.js';
import { MASTER_LIST_LIMITS } from './limits.js';
import { ICAO_OIDS } from './oids.js';
import { parseCertificate, parseMasterList, verifyMasterList } from './pki.js';
import { buildMasterList, type TestMasterListOptions } from './testing/master-list.js';
import { buildCsca, buildLinkCertificate } from './testing/x509.js';

const now = new Date('2026-07-01T12:00:00Z');
const signingTime = new Date('2026-06-15T08:00:00Z');

function fixtures() {
  const root = buildCsca({ seed: 'ml-root', now, country: 'XA', commonName: 'CSCA Xanadu' });
  const listed = [
    buildCsca({ seed: 'ml-utopia', now }),
    buildCsca({
      seed: 'ml-utopia-b',
      now,
      key: { kind: 'ec', curve: 'P-256' },
      commonName: 'CSCA Utopia B',
    }),
  ];
  return { root, listed };
}

function list(overrides: Partial<TestMasterListOptions> = {}) {
  const { root, listed } = fixtures();
  const der = buildMasterList({
    signerSeed: 'ml-signer',
    root,
    certificates: listed,
    signingTime,
    ...overrides,
  });
  return { root, listed, der };
}

describe('buildMasterList (C65.3)', () => {
  it('writes SignedData of a master list signed by an EKU signer the root issued', () => {
    const { root, listed, der } = list();
    const [type, wrapped] = (asn1js.fromBER(der).result as asn1js.Sequence).valueBlock.value;
    expect((type as asn1js.ObjectIdentifier).getValue()).toBe('1.2.840.113549.1.7.2');
    const signedData = ((wrapped as asn1js.Constructed).valueBlock.value[0] as asn1js.Sequence)
      .valueBlock.value;
    const encapsulated = (signedData[2] as asn1js.Sequence).valueBlock.value;
    expect((encapsulated[0] as asn1js.ObjectIdentifier).getValue()).toBe(ICAO_OIDS.cscaMasterList);
    const signerInfo = ((signedData[4] as asn1js.Set).valueBlock.value[0] as asn1js.Sequence)
      .valueBlock.value;
    const attributes = new Uint8Array((signerInfo[3] as asn1js.Constructed).valueBeforeDecodeView);
    attributes[0] = 0x31;
    const signer = parseCertificate(
      new Uint8Array(
        ((signedData[3] as asn1js.Constructed).valueBlock.value[0] as asn1js.Sequence)
          .valueBeforeDecodeView,
      ),
    );
    expect(signer).toMatchObject({
      extendedKeyUsage: [ICAO_OIDS.cscaMasterListSigningKey],
      aki: toHex(root.keyIdentifier),
    });
    const signature = (signerInfo[5] as asn1js.OctetString).valueBlock.valueHexView;
    const { key } = parseCertificateKey(signer.spki);
    expect(verify('sha256', attributes, key, signature)).toBe(true);
    expect(listed).toHaveLength(2);
  });
});

function parseCertificateKey(spki: Uint8Array) {
  return { key: { key: Buffer.from(spki), format: 'der' as const, type: 'spki' as const } };
}

describe('parseMasterList (C62.7)', () => {
  it('reads the listed certificates, the signer and the signing time', () => {
    const { listed, der } = list();
    const parsed = parseMasterList(der);
    expect(parsed).toMatchObject({
      eContentType: ICAO_OIDS.cscaMasterList,
      signingTime,
      unreadableCertificates: 0,
    });
    // certList is a SET OF, so DER keeps it sorted by encoding, not in the order given.
    expect(parsed.certificates.map((certificate) => certificate.sha256).sort()).toEqual(
      listed
        .map((certificate) => createHash('sha256').update(certificate.der).digest('hex'))
        .sort(),
    );
    expect(parsed.signer?.extendedKeyUsage).toEqual([ICAO_OIDS.cscaMasterListSigningKey]);
    expect(toHex(parsed.der)).toBe(toHex(der));
  });

  it('reads a list without its signer, and refuses what is no master list', () => {
    expect(parseMasterList(list({ variants: ['signer-not-embedded'] }).der).signer).toBeNull();
    const refusal = (bytes: Uint8Array) => {
      try {
        parseMasterList(bytes);
      } catch (error) {
        return error instanceof EmrtdError ? error.message : 'other';
      }
      return 'none';
    };
    expect(refusal(new Uint8Array([0x30, 0x00]))).toBe('parseMasterList: chip_data_malformed');
    expect(refusal(new Uint8Array(MASTER_LIST_LIMITS.maxBytes + 1))).toBe(
      'parseMasterList: limit_exceeded',
    );
  });

  it('caps a master list at 16 MiB, 64 levels and a million TLVs', () => {
    expect(MASTER_LIST_LIMITS).toEqual({
      maxBytes: 16 * 1024 * 1024,
      maxDepth: 64,
      maxNodes: 1_000_000,
    });
  });
});

describe('verifyMasterList (C62.7)', () => {
  it('verifies a list against its pinned root', () => {
    const { root, der } = list();
    expect(verifyMasterList(parseMasterList(der), parseCertificate(root.der), { now })).toEqual({
      verified: true,
    });
  });

  it('verifies a list signed under a newer CSCA the root links to', () => {
    const { root, listed } = fixtures();
    const next = buildCsca({ seed: 'ml-root-next', now, country: 'XA', commonName: 'CSCA Xanadu' });
    const link = buildLinkCertificate({ from: root, to: next, now });
    const der = buildMasterList({
      signerSeed: 'ml-signer-next',
      root,
      signerIssuer: next,
      certificates: [...listed, link],
      signingTime,
    });
    expect(verifyMasterList(parseMasterList(der), parseCertificate(root.der), { now })).toEqual({
      verified: true,
    });
  });

  it.each([
    ['wrong-content-type', 'content_type_invalid'],
    ['signer-not-embedded', 'signer_missing'],
    ['signer-without-eku', 'signer_profile_invalid'],
    ['tampered-content', 'message_digest_mismatch'],
    ['bad-signature', 'signature_invalid'],
  ] as const)('refuses the %s variant: %s', (variant, failure) => {
    const { root, der } = list({ variants: [variant] });
    expect(verifyMasterList(parseMasterList(der), parseCertificate(root.der), { now })).toEqual({
      verified: false,
      failure,
    });
  });

  it('refuses a signer another root issued, or one expired at signing time', () => {
    const { root, listed } = fixtures();
    const other = buildCsca({ seed: 'ml-other', now, country: 'XA', commonName: 'CSCA Xanadu' });
    const foreign = buildMasterList({
      signerSeed: 'ml-signer-other',
      root,
      signerIssuer: other,
      certificates: listed,
      signingTime,
    });
    expect(verifyMasterList(parseMasterList(foreign), parseCertificate(root.der), { now })).toEqual(
      {
        verified: false,
        failure: 'signer_not_issued_by_root',
      },
    );
    const expired = buildMasterList({
      signerSeed: 'ml-signer-old',
      root,
      certificates: listed,
      signingTime,
      signerNotAfter: new Date('2026-06-01T00:00:00Z'),
    });
    expect(verifyMasterList(parseMasterList(expired), parseCertificate(root.der), { now })).toEqual(
      {
        verified: false,
        failure: 'signer_expired',
      },
    );
  });
});
