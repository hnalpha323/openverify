/**
 * C65.3: the synthetic Utopia X.509, read and verified by node:crypto's X509Certificate as an
 * independent parser (and asn1js for the CRL): CSCAs self-signed on explicit brainpool and on
 * RSA-3072 with PSS, Document Signers issued by them, link certificates, v2 CRLs.
 */
import { X509Certificate, verify } from 'node:crypto';
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import { toHex } from '../bytes.js';
import { parseCertificate } from '../pki.js';
import { testKeyPair, testSignatureAlgorithm } from './keys.js';
import { buildCrl, buildCsca, buildDsc, buildLinkCertificate } from './x509.js';

const now = new Date('2026-07-01T12:00:00Z');
const DAY = 86_400_000;
const node = (der: Uint8Array) => new X509Certificate(Buffer.from(der));

describe('buildCsca (C65.3)', () => {
  it('writes a self-signed Utopia CSCA on explicit brainpool, the same for the same seed and now', () => {
    const csca = buildCsca({ seed: 'csca-a', now });
    expect(toHex(csca.der)).toBe(toHex(buildCsca({ seed: 'csca-a', now }).der));
    const parsed = node(csca.der);
    expect(parsed.subject).toBe('C=UT\nO=OpenVerify Test\nCN=CSCA Utopia');
    expect(parsed.issuer).toBe(parsed.subject);
    expect(parsed.ca).toBe(true);
    expect(parsed.verify(parsed.publicKey)).toBe(true);
    expect(parsed.publicKey.asymmetricKeyDetails?.namedCurve).toBe('brainpoolP256r1');
    expect(BigInt(`0x${parsed.serialNumber}`)).toBe(BigInt(`0x${csca.serialNumber}`));
    expect(csca).toMatchObject({
      country: 'UT',
      notBefore: new Date(now.getTime() - DAY),
      notAfter: new Date(now.getTime() + 5479 * DAY),
    });
    expect(csca.keyIdentifier).toHaveLength(20);
    expect(new Date(parsed.validFrom)).toEqual(csca.notBefore);
    expect(new Date(parsed.validTo)).toEqual(csca.notAfter);
  });

  it('writes an RSA-3072 CSCA signed with RSASSA-PSS, and takes a country, a name and a validity', () => {
    const csca = buildCsca({
      seed: 'csca-b',
      now,
      key: { kind: 'rsa', bits: 3072 },
      signature: { rsa: 'pss' },
      country: 'XX',
      commonName: 'CSCA Utopia B',
      validityDays: 10,
    });
    const parsed = node(csca.der);
    expect(parsed.subject).toBe('C=XX\nO=OpenVerify Test\nCN=CSCA Utopia B');
    expect(parsed.verify(parsed.publicKey)).toBe(true);
    expect(parsed.publicKey.asymmetricKeyDetails?.modulusLength).toBe(3072);
    expect(csca.notAfter).toEqual(new Date(now.getTime() + 10 * DAY));
  });
});

describe('buildDsc (C65.3)', () => {
  const csca = buildCsca({ seed: 'csca-a', now });

  it('writes a Document Signer the CSCA issued', () => {
    const dsc = buildDsc({ seed: 'dsc-a', issuer: csca, now });
    const parsed = node(dsc.der);
    expect(parsed.issuer).toBe(node(csca.der).subject);
    expect(parsed.subject.startsWith('C=UT\nO=OpenVerify Test\nCN=Utopia Document Signer ')).toBe(
      true,
    );
    expect(parsed.ca).toBe(false);
    expect(parsed.checkIssued(node(csca.der))).toBe(true);
    expect(parsed.verify(node(csca.der).publicKey)).toBe(true);
    expect(dsc.country).toBe('UT');
    expect(toHex(dsc.issuerName)).toBe(toHex(csca.subjectName));
    expect(toHex(csca.issuerName)).toBe(toHex(csca.subjectName));
    expect(dsc.notAfter).toEqual(new Date(now.getTime() + 3743 * DAY));
  });

  it('takes another key, signature, validity and the cA defect', () => {
    const dsc = buildDsc({
      seed: 'dsc-b',
      issuer: csca,
      now,
      key: { kind: 'ec', curve: 'P-256' },
      signature: { hash: 'sha384' },
      ca: true,
      notBefore: new Date('2020-01-01T00:00:00Z'),
      notAfter: new Date('2021-01-01T00:00:00Z'),
    });
    const parsed = node(dsc.der);
    // OpenSSL's `ca` also needs keyCertSign; the defect is `cA` true on a signing key.
    expect(parseCertificate(dsc.der).isCa).toBe(true);
    expect(parsed.ca).toBe(false);
    expect(parsed.verify(node(csca.der).publicKey)).toBe(true);
    expect(parsed.validTo).toContain('2021');
  });
});

describe('buildLinkCertificate (C65.3)', () => {
  it('certifies the new CSCA key with the old one, under the same name', () => {
    const old = buildCsca({ seed: 'csca-old', now });
    const next = buildCsca({ seed: 'csca-new', now });
    const link = buildLinkCertificate({ from: old, to: next, now });
    const parsed = node(link.der);
    expect(parsed.subject).toBe(node(next.der).subject);
    expect(parsed.verify(node(old.der).publicKey)).toBe(true);
    expect(parsed.verify(node(next.der).publicKey)).toBe(false);
    expect(parsed.ca).toBe(true);
    expect(link.key).toBe(next.key);
    expect(toHex(link.issuerName)).toBe(toHex(old.subjectName));
    expect(toHex(link.keyIdentifier)).toBe(toHex(next.keyIdentifier));
  });
});

describe('buildCrl (C65.3)', () => {
  it('writes a v2 CRL the CSCA signed, listing the revoked serials', () => {
    const csca = buildCsca({ seed: 'csca-a', now });
    const dsc = buildDsc({ seed: 'dsc-revoked', issuer: csca, now });
    const crl = buildCrl({ issuer: csca, now, revokedSerials: [dsc.serialNumber], crlNumber: 7 });
    const [tbs, , signature] = (asn1js.fromBER(crl).result as asn1js.Sequence).valueBlock.value;
    const fields = (tbs as asn1js.Sequence).valueBlock.value;
    expect((fields[0] as asn1js.Integer).valueBlock.valueDec).toBe(1);
    expect((fields[3] as asn1js.UTCTime).toDate()).toEqual(new Date('2026-07-01T12:00:00Z'));
    expect((fields[4] as asn1js.UTCTime).toDate()).toEqual(new Date(now.getTime() + 30 * DAY));
    expect((fields[5] as asn1js.Sequence).valueBlock.value).toHaveLength(1);
    const tbsBytes = (tbs as asn1js.Sequence).valueBeforeDecodeView;
    const value = (signature as asn1js.BitString).valueBlock.valueHexView;
    expect(verify('sha256', tbsBytes, csca.key.publicKey, value)).toBe(true);
  });

  it('leaves the revoked list out when none is revoked, and takes this update and its span', () => {
    const csca = buildCsca({ seed: 'csca-a', now });
    const crl = buildCrl({
      issuer: csca,
      now,
      thisUpdate: new Date('2026-01-01T00:00:00Z'),
      nextUpdateDays: 90,
    });
    const tbs = (asn1js.fromBER(crl).result as asn1js.Sequence).valueBlock.value[0];
    const fields = (tbs as asn1js.Sequence).valueBlock.value;
    expect((fields[4] as asn1js.UTCTime).toDate()).toEqual(new Date('2026-04-01T00:00:00Z'));
    expect(fields[5]?.idBlock.tagClass).toBe(3);
  });
});

describe('testSignatureAlgorithm', () => {
  it('names the algorithm testSign signs with', () => {
    const key = testKeyPair('alg', { kind: 'rsa', bits: 2048 });
    expect(toHex(testSignatureAlgorithm(key, { rsa: 'pss' }))).toContain('2a864886f70d01010a');
    const ec = testKeyPair('alg', { kind: 'ec', curve: 'P-384' });
    expect(toHex(testSignatureAlgorithm(ec))).toBe('300a06082a8648ce3d040303');
  });
});
