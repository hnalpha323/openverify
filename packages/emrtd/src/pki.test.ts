/**
 * C62.2, C62.7: certificates and CRLs parsed over pkijs with their original bytes, and their
 * signatures verified through node:crypto (never pkijs' WebCrypto verify, which refuses explicit
 * EC parameters). Every certificate is a synthetic Utopia one.
 */
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { concatBytes, fromHex, toHex, utf8 } from './bytes.js';
import { integer, octetString, sequence } from './der.js';
import { EmrtdError } from './errors.js';
import { ICAO_OIDS } from './oids.js';
import {
  parseCertificate,
  parseCrl,
  verifyCertificateSignature,
  verifyCrlSignature,
} from './pki.js';
import { buildCrl, buildCsca, buildDsc, buildLinkCertificate } from './testing/x509.js';

const now = new Date('2026-07-01T12:00:00Z');
const URL_TEXT = 'https://pkd.example.invalid/UT.crl';

/** The CSCA and DSC most cases read, built on first use (so each case fails on its own). */
function pki() {
  const csca = buildCsca({ seed: 'pki-csca', now, crlDistributionPoint: URL_TEXT });
  const dsc = buildDsc({ seed: 'pki-dsc', issuer: csca, now, crlDistributionPoint: URL_TEXT });
  return { csca, dsc };
}

function codeOf(call: () => unknown): string {
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

describe('parseCertificate (C62.2, C62.7)', () => {
  it('reads a CSCA with its original bytes', () => {
    const { csca } = pki();
    const parsed = parseCertificate(csca.der);
    const reference = new X509Certificate(Buffer.from(csca.der));
    expect(parsed).toMatchObject({
      sha256: reference.fingerprint256.replaceAll(':', '').toLowerCase(),
      subjectDn: 'C=UT, O=OpenVerify Test, CN=CSCA Utopia',
      issuerDn: 'C=UT, O=OpenVerify Test, CN=CSCA Utopia',
      subjectDnKey: 'c=ut, o=openverify test, cn=csca utopia',
      issuerDnKey: 'c=ut, o=openverify test, cn=csca utopia',
      country: 'UT',
      serialNumber: csca.serialNumber,
      ski: toHex(csca.keyIdentifier),
      aki: toHex(csca.keyIdentifier),
      notBefore: csca.notBefore,
      notAfter: csca.notAfter,
      isCa: true,
      keyUsage: ['keyCertSign', 'cRLSign'],
      extendedKeyUsage: [],
      crlDistributionPoints: ['https://pkd.example.invalid/UT.crl'],
      unknownCriticalExtensions: [],
      signatureAlgorithm: { oid: '1.2.840.10045.4.3.2', parameters: null },
    });
    expect(toHex(parsed.der)).toBe(toHex(csca.der));
    expect(toHex(parsed.spki)).toBe(toHex(csca.key.spki));
    expect(toHex(csca.der)).toContain(toHex(parsed.tbs));
    expect(parsed.signatureValue.length).toBeGreaterThan(60);
  });

  it('reads a Document Signer: its AKI, digital signature and distribution point', () => {
    const { csca, dsc } = pki();
    expect(parseCertificate(dsc.der)).toMatchObject({
      issuerDn: 'C=UT, O=OpenVerify Test, CN=CSCA Utopia',
      aki: toHex(csca.keyIdentifier),
      ski: toHex(dsc.keyIdentifier),
      isCa: false,
      keyUsage: ['digitalSignature'],
      crlDistributionPoints: ['https://pkd.example.invalid/UT.crl'],
    });
  });

  it('reads absent identifiers as null and the master list signer EKU', () => {
    const { csca } = pki();
    const bare = buildDsc({
      seed: 'pki-bare',
      issuer: csca,
      now,
      omitAuthorityKeyIdentifier: true,
      omitSubjectKeyIdentifier: true,
      extendedKeyUsage: [ICAO_OIDS.cscaMasterListSigningKey],
    });
    expect(parseCertificate(bare.der)).toMatchObject({
      aki: null,
      ski: null,
      extendedKeyUsage: [ICAO_OIDS.cscaMasterListSigningKey],
      crlDistributionPoints: [],
    });
  });

  it('lists critical extensions it does not understand, tolerates malformed non-critical ones', () => {
    const { csca } = pki();
    const odd = buildDsc({
      seed: 'pki-odd',
      issuer: csca,
      now,
      omitSubjectKeyIdentifier: true,
      extraExtensions: [
        { oid: '1.2.3.4.5', critical: true, value: octetString(utf8('x')) },
        { oid: '1.2.3.4.6', critical: false, value: octetString(utf8('y')) },
        // A non-critical SKI that is no OCTET STRING: tolerated, read as absent.
        { oid: '2.5.29.14', critical: false, value: integer(5) },
        // A critical policy extension the verifier knows and does not need to read.
        { oid: '2.5.29.32', critical: true, value: sequence() },
      ],
    });
    expect(parseCertificate(odd.der)).toMatchObject({
      ski: null,
      unknownCriticalExtensions: ['1.2.3.4.5'],
    });
    const broken = buildDsc({
      seed: 'pki-broken',
      issuer: csca,
      now,
      extraExtensions: [{ oid: '2.5.29.19', critical: true, value: integer(1) }],
    });
    expect(parseCertificate(broken.der).unknownCriticalExtensions).toEqual(['2.5.29.19']);
  });

  it.each([
    ['garbage', () => fromHex('0102')],
    ['trailing bytes', () => concatBytes(pki().csca.der, fromHex('00'))],
    ['a SEQUENCE that is no certificate', () => sequence(integer(1))],
  ])('refuses %s', (_label, der) => {
    expect(codeOf(() => parseCertificate(der()))).toBe('parseCertificate: chip_data_malformed');
  });
});

describe('verifyCertificateSignature (C62.2)', () => {
  it('verifies a DSC under its CSCA and nothing else', () => {
    const { csca, dsc } = pki();
    const parsedCsca = parseCertificate(csca.der);
    const other = parseCertificate(buildCsca({ seed: 'pki-other', now }).der);
    expect(verifyCertificateSignature(parseCertificate(dsc.der), parsedCsca)).toBe(true);
    expect(verifyCertificateSignature(parseCertificate(dsc.der), other)).toBe(false);
  });

  it('refuses a certificate whose TBS bytes changed', () => {
    const { csca, dsc } = pki();
    const der = new Uint8Array(dsc.der);
    // One letter of the distribution point URL: the structure holds, the signature does not.
    const letter = Buffer.from(der).indexOf(Buffer.from('UT.crl'));
    der[letter] = 0x56;
    const changed = parseCertificate(der);
    expect(changed.crlDistributionPoints).toEqual(['https://pkd.example.invalid/VT.crl']);
    expect(verifyCertificateSignature(changed, parseCertificate(csca.der))).toBe(false);
  });

  it('verifies a link certificate under the old key and RSASSA-PSS CSCAs', () => {
    const { csca } = pki();
    const parsedCsca = parseCertificate(csca.der);
    const next = buildCsca({ seed: 'pki-next', now });
    const link = parseCertificate(buildLinkCertificate({ from: csca, to: next, now }).der);
    expect(verifyCertificateSignature(link, parsedCsca)).toBe(true);
    const rsa = buildCsca({
      seed: 'pki-rsa',
      now,
      key: { kind: 'rsa', bits: 2048 },
      signature: { rsa: 'pss' },
    });
    const parsedRsa = parseCertificate(rsa.der);
    expect(verifyCertificateSignature(parsedRsa, parsedRsa)).toBe(true);
  });

  it('takes SHA-1 by default and refuses it on request', () => {
    const { csca } = pki();
    const parsedCsca = parseCertificate(csca.der);
    const sha1 = parseCertificate(
      buildDsc({ seed: 'pki-sha1', issuer: csca, now, signature: { hash: 'sha1' } }).der,
    );
    expect(verifyCertificateSignature(sha1, parsedCsca)).toBe(true);
    expect(verifyCertificateSignature(sha1, parsedCsca, { acceptSha1: false })).toBe(false);
  });

  it('verifies nothing under a key outside the bounds', () => {
    for (const key of [{ kind: 'oversized-rsa' }, { kind: 'ec', curve: 'secp256k1' }] as const) {
      const issuer = buildCsca({ seed: 'pki-out-of-bounds', now, key });
      const parsed = parseCertificate(issuer.der);
      expect(verifyCertificateSignature(parsed, parsed)).toBe(false);
    }
  });
});

describe('parseCrl and verifyCrlSignature (C62.7)', () => {
  it('reads a CRL with its issuer, key identifier, dates, number and revoked serials', () => {
    const { csca, dsc } = pki();
    const der = buildCrl({ issuer: csca, now, revokedSerials: [dsc.serialNumber], crlNumber: 7 });
    expect(parseCrl(der)).toMatchObject({
      issuerDn: 'C=UT, O=OpenVerify Test, CN=CSCA Utopia',
      issuerDnKey: 'c=ut, o=openverify test, cn=csca utopia',
      issuerCountry: 'UT',
      issuerKeyId: toHex(csca.keyIdentifier),
      thisUpdate: now,
      nextUpdate: new Date(now.getTime() + 30 * 86_400_000),
      crlNumber: '7',
      revokedSerials: [dsc.serialNumber],
    });
    expect(toHex(parseCrl(der).der)).toBe(toHex(der));
  });

  it('reads a CRL that revokes nothing', () => {
    const { csca } = pki();
    expect(parseCrl(buildCrl({ issuer: csca, now })).revokedSerials).toEqual([]);
  });

  it('verifies a CRL under its CSCA only', () => {
    const { csca, dsc } = pki();
    const crl = parseCrl(buildCrl({ issuer: csca, now }));
    expect(verifyCrlSignature(crl, parseCertificate(csca.der))).toBe(true);
    expect(verifyCrlSignature(crl, parseCertificate(dsc.der))).toBe(false);
  });

  it('refuses a CRL that cannot be read', () => {
    expect(codeOf(() => parseCrl(sequence(integer(1))))).toBe('parseCrl: chip_data_malformed');
  });

  // Workflow 5C review P002: a re-tagged string makes asn1js throw its own RangeError.
  it('refuses a CRL whose issuer country is a UniversalString of two bytes', () => {
    const { csca } = pki();
    const hex = toHex(buildCrl({ issuer: csca, now }));
    const hostile = fromHex(hex.replace('13025554', '1c025554'));
    expect(toHex(hostile)).not.toBe(hex);
    expect(codeOf(() => parseCrl(hostile))).toBe('parseCrl: chip_data_malformed');
  });
});
