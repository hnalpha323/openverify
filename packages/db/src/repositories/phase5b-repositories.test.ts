/**
 * C54.4: the Workflow 5B repository reads other agents use (the attributes, the guard, the job,
 * the NFC publish rule and Passive Authentication's trust store), redaction (C53.6) and the chip
 * read index rebuild (C53.4). Rows are written with the `@openverify/db/testing` seeders, as their
 * owners' write functions will write them. Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chipDocumentNumberIndex, chipSodIndex } from '../blind-index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedBusinessRegistryRecord,
  seedChipChallenge,
  seedChipRead,
  seedDocumentExtraction,
  seedTrustAnchor,
  seedTrustAnchorMembership,
  seedTrustAnchorSource,
  seedTrustCrl,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createVerification,
  getBusinessRegistryRecord,
  getChipChallenge,
  getChipRead,
  getDocumentExtraction,
  getSubmittedChipChallenge,
  hasNonSandboxTrustAnchor,
  listChipChallenges,
  loadTrustStore,
  openBusinessRegistryRecord,
  openChipChallengeEvidence,
  openChipReadEvidence,
  openDocumentExtractionFields,
  rebuildChipReadIndexes,
  redactBusinessRegistryRecords,
  redactChipChallenges,
  redactChipReads,
  redactDocumentExtractions,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-23T08:00:00.000Z');
const LATER = new Date('2026-10-23T08:05:00.000Z');
const KEY = new Uint8Array(32).fill(9);
const OTHER_KEY = new Uint8Array(32).fill(4);

async function verificationOf(type: 'document' | 'government_id_nfc' | 'database_business') {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type,
  });
  return { env: environment.id, inquiryId: inquiry.id, verificationId: verification.id };
}

describe('document extractions (C53.3, C60)', () => {
  it('reads the class, confidence, pages and media type apart from the sealed values', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('document');
    await seedDocumentExtraction(database.db, env, {
      verificationId,
      inquiryId,
      documentType: 'utility_bill',
      typeConfidence: 0.83,
      pageCount: 2,
      mimeType: 'application/pdf',
      fields: { name: 'QUINN VALEMONT', 'issue-date': '2026-09-30', issuer: null },
      at: AT,
    });

    expect(await getDocumentExtraction(database.db, env, verificationId)).toEqual({
      verificationId,
      inquiryId,
      documentType: 'utility_bill',
      typeConfidence: 0.83,
      pageCount: 2,
      mimeType: 'application/pdf',
      createdAt: AT,
      redactedAt: null,
    });
    expect(await openDocumentExtractionFields(database.db, env, verificationId)).toEqual({
      name: 'QUINN VALEMONT',
      'issue-date': '2026-09-30',
      issuer: null,
    });
    const other = (await createTestTenant(database.db)).environment.id;
    expect(await getDocumentExtraction(database.db, other, verificationId)).toBeNull();
    expect(await openDocumentExtractionFields(database.db, other, verificationId)).toBeNull();
  });

  it('redacts the values once, keeping the first time', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('document');
    await seedDocumentExtraction(database.db, env, {
      verificationId,
      inquiryId,
      fields: { name: 'QUINN VALEMONT' },
    });

    expect(await redactDocumentExtractions(database.db, env, [verificationId], AT)).toBe(1);
    expect(await redactDocumentExtractions(database.db, env, [verificationId], LATER)).toBe(1);
    expect(await redactDocumentExtractions(database.db, env, [], AT)).toBe(0);
    expect(await openDocumentExtractionFields(database.db, env, verificationId)).toBeNull();
    expect((await getDocumentExtraction(database.db, env, verificationId))?.redactedAt).toEqual(AT);
  });
});

describe('chip challenges (C53.3, C62.5)', () => {
  it('reads one, the newest first, the submitted one, and the sealed evidence', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
    const older = await seedChipChallenge(database.db, env, {
      verificationId,
      inquiryId,
      status: 'superseded',
      createdAt: AT,
    });
    const submitted = await seedChipChallenge(database.db, env, {
      verificationId,
      inquiryId,
      status: 'submitted',
      createdAt: LATER,
      submittedAt: LATER,
      aaResponse: 'c3ludGhldGljIEFB',
      deviceReport: '{"read-ms":1200}',
    });

    expect((await listChipChallenges(database.db, env, verificationId)).map((c) => c.id)).toEqual([
      submitted,
      older,
    ]);
    expect(await getSubmittedChipChallenge(database.db, env, verificationId)).toMatchObject({
      id: submitted,
      status: 'submitted',
      submittedAt: LATER,
      nonceSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
    expect(await getChipChallenge(database.db, env, older)).toMatchObject({
      status: 'superseded',
      verificationId,
      inquiryId,
      redactedAt: null,
    });
    expect(await openChipChallengeEvidence(database.db, env, submitted)).toEqual({
      aaResponse: 'c3ludGhldGljIEFB',
      deviceReport: '{"read-ms":1200}',
    });
    expect(await openChipChallengeEvidence(database.db, env, older)).toEqual({
      aaResponse: null,
      deviceReport: null,
    });
    const other = (await createTestTenant(database.db)).environment.id;
    expect(await getChipChallenge(database.db, other, submitted)).toBeNull();
    expect(await openChipChallengeEvidence(database.db, other, submitted)).toBeNull();
    expect(await getSubmittedChipChallenge(database.db, other, verificationId)).toBeNull();
  });

  it('redacts the AA response and the device report', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
    const id = await seedChipChallenge(database.db, env, {
      verificationId,
      inquiryId,
      status: 'submitted',
      aaResponse: 'c3ludGhldGljIEFB',
      deviceReport: '{}',
    });

    expect(await redactChipChallenges(database.db, env, [verificationId], AT)).toBe(1);
    expect(await redactChipChallenges(database.db, env, [], AT)).toBe(0);
    expect(await openChipChallengeEvidence(database.db, env, id)).toEqual({
      aaResponse: null,
      deviceReport: null,
    });
    expect((await getChipChallenge(database.db, env, id))?.redactedAt).toEqual(AT);
  });
});

describe('chip reads (C53.3, C62.6)', () => {
  const signature = new Uint8Array(96).fill(0x2a);

  it('reads the summary, and the DG1 fields and SOD signature sealed apart', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
    await seedChipRead(database.db, env, {
      verificationId,
      inquiryId,
      fields: { 'name-last': 'VALEMONT', 'identification-number': 'X12K45P78' },
      sodSignature: signature,
      sodSignatureIndex: 'b'.repeat(64),
      selfieBound: true,
      issuingCountry: 'UTO',
      paSummary: { integrity: 'established', revocation: 'unrevoked' },
      at: AT,
    });

    expect(await getChipRead(database.db, env, verificationId)).toEqual({
      verificationId,
      inquiryId,
      integrity: 'established',
      selfieBound: true,
      issuingCountry: 'UTO',
      paSummary: { integrity: 'established', revocation: 'unrevoked' },
      sodSignatureIndex: 'b'.repeat(64),
      documentNumberIndex: null,
      createdAt: AT,
      redactedAt: null,
    });
    const evidence = await openChipReadEvidence(database.db, env, verificationId);
    expect(evidence?.fields).toEqual({
      'name-last': 'VALEMONT',
      'identification-number': 'X12K45P78',
    });
    expect([...(evidence?.sodSignature ?? [])]).toEqual([...signature]);
    const other = (await createTestTenant(database.db)).environment.id;
    expect(await getChipRead(database.db, other, verificationId)).toBeNull();
  });

  it('redacts the sealed values, both indexes and the issuing state', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
    await seedChipRead(database.db, env, {
      verificationId,
      inquiryId,
      sodSignatureIndex: 'c'.repeat(64),
      documentNumberIndex: 'd'.repeat(64),
    });

    expect(await redactChipReads(database.db, env, [verificationId], AT)).toBe(1);
    expect(await redactChipReads(database.db, env, [], AT)).toBe(0);
    expect(await openChipReadEvidence(database.db, env, verificationId)).toBeNull();
    expect(await getChipRead(database.db, env, verificationId)).toMatchObject({
      sodSignatureIndex: null,
      documentNumberIndex: null,
      issuingCountry: null,
      redactedAt: AT,
    });
  });

  it('rebuilds both indexes of every unredacted read from its sealed values', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
    await seedChipRead(database.db, env, {
      verificationId,
      inquiryId,
      fields: { 'identification-number': 'X12K45P78' },
      sodSignature: signature,
      issuingCountry: 'UTO',
      sodSignatureIndex: chipSodIndex(OTHER_KEY, { environmentId: env, signature }),
    });
    const redacted = await verificationOf('government_id_nfc');
    await seedChipRead(database.db, redacted.env, {
      verificationId: redacted.verificationId,
      inquiryId: redacted.inquiryId,
    });
    await redactChipReads(database.db, redacted.env, [redacted.verificationId], AT);

    const result = await rebuildChipReadIndexes(database.db, KEY, { batchSize: 1 });

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(await getChipRead(database.db, env, verificationId)).toMatchObject({
      sodSignatureIndex: chipSodIndex(KEY, { environmentId: env, signature }),
      documentNumberIndex: chipDocumentNumberIndex(KEY, {
        environmentId: env,
        issuingState: 'UTO',
        documentNumber: 'X12K45P78',
      }),
    });
    expect(await getChipRead(database.db, redacted.env, redacted.verificationId)).toMatchObject({
      sodSignatureIndex: null,
      documentNumberIndex: null,
    });
    await expect(rebuildChipReadIndexes(database.db, new Uint8Array(3))).rejects.toThrow();
  });
});

describe('business registry records (C53.3, C61.1)', () => {
  it('reads the source and fetch time apart from the sealed summary, and redacts it', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('database_business');
    await seedBusinessRegistryRecord(database.db, env, {
      verificationId,
      inquiryId,
      source: 'gleif',
      record: {
        recordId: '5493000SYNTHETIC0001',
        legalName: 'Utopia Widgets Ltd',
        status: 'ISSUED',
        jurisdiction: null,
        registeredAddress: null,
      },
      fetchedAt: AT,
    });

    expect(await getBusinessRegistryRecord(database.db, env, verificationId)).toMatchObject({
      verificationId,
      inquiryId,
      source: 'gleif',
      fetchedAt: AT,
      redactedAt: null,
    });
    expect(await openBusinessRegistryRecord(database.db, env, verificationId)).toEqual({
      recordId: '5493000SYNTHETIC0001',
      legalName: 'Utopia Widgets Ltd',
      status: 'ISSUED',
      jurisdiction: null,
      registeredAddress: null,
    });

    expect(await redactBusinessRegistryRecords(database.db, env, [verificationId], AT)).toBe(1);
    expect(await redactBusinessRegistryRecords(database.db, env, [], AT)).toBe(0);
    expect(await openBusinessRegistryRecord(database.db, env, verificationId)).toBeNull();
    expect((await getBusinessRegistryRecord(database.db, env, verificationId))?.redactedAt).toEqual(
      AT,
    );
    const other = (await createTestTenant(database.db)).environment.id;
    expect(await getBusinessRegistryRecord(database.db, other, verificationId)).toBeNull();
  });
});

describe('the trust store Passive Authentication reads (C62.7, C62.8)', () => {
  let counter = 0;
  const certificate = () => {
    counter += 1;
    return createHash('sha256')
      .update(`synthetic certificate ${String(counter)}`)
      .digest();
  };

  beforeEach(async () => {
    await database.client.query(
      'truncate trust_anchor_memberships, trust_anchors, trust_anchor_sources, trust_crls',
    );
  });

  it('gives a production environment no sandbox-only anchor, filtered in SQL, and a sandbox one every anchor', async () => {
    await seedTrustAnchorSource(database.db, { id: 'bsi-de' });
    const issued = await seedTrustAnchor(database.db, {
      certificate: certificate(),
      country: 'DE',
    });
    await seedTrustAnchorMembership(database.db, { sourceId: 'bsi-de', anchorId: issued });
    const utopia = await seedTrustAnchor(database.db, {
      certificate: certificate(),
      country: 'UT',
      sandboxOnly: true,
    });

    const production = await loadTrustStore(database.db, { environmentKind: 'production' });
    const sandbox = await loadTrustStore(database.db, { environmentKind: 'sandbox' });

    expect(production.anchors.map((anchor) => anchor.id)).toEqual([issued]);
    expect(production.anchors.every((anchor) => !anchor.sandboxOnly)).toBe(true);
    expect(sandbox.anchors.map((anchor) => anchor.id).sort()).toEqual([issued, utopia].sort());
  });

  it('marks an anchor withdrawn when no enabled source lists it any more', async () => {
    await seedTrustAnchorSource(database.db, { id: 'bsi-de' });
    await seedTrustAnchorSource(database.db, { id: 'npkd-nl', enabled: false });
    const listed = await seedTrustAnchor(database.db, { certificate: certificate() });
    const dropped = await seedTrustAnchor(database.db, { certificate: certificate() });
    const disabledOnly = await seedTrustAnchor(database.db, { certificate: certificate() });
    await seedTrustAnchorMembership(database.db, { sourceId: 'bsi-de', anchorId: listed });
    await seedTrustAnchorMembership(database.db, {
      sourceId: 'bsi-de',
      anchorId: dropped,
      withdrawnAt: AT,
    });
    await seedTrustAnchorMembership(database.db, { sourceId: 'npkd-nl', anchorId: disabledOnly });

    const { anchors } = await loadTrustStore(database.db, { environmentKind: 'production' });
    const withdrawn = Object.fromEntries(anchors.map((anchor) => [anchor.id, anchor.withdrawn]));

    expect(withdrawn).toEqual({ [listed]: false, [dropped]: true, [disabledOnly]: true });
  });

  it('returns each anchor with its certificate and the CRLs as stored', async () => {
    const der = certificate();
    const id = await seedTrustAnchor(database.db, {
      certificate: der,
      country: 'UT',
      ski: 'ab'.repeat(20),
      aki: null,
      isLink: true,
      sandboxOnly: true,
    });
    const crl = certificate();
    await seedTrustCrl(database.db, {
      der: crl,
      issuerCountry: 'UT',
      issuerKeyId: 'ab'.repeat(20),
      thisUpdate: AT,
      nextUpdate: null,
    });

    const store = await loadTrustStore(database.db, { environmentKind: 'sandbox' });

    expect(store.anchors).toEqual([
      {
        id,
        certificate: new Uint8Array(der),
        country: 'UT',
        subjectDn: 'C=UT, CN=Synthetic CSCA',
        ski: 'ab'.repeat(20),
        aki: null,
        notBefore: new Date('2026-01-01T00:00:00.000Z'),
        notAfter: new Date('2040-01-01T00:00:00.000Z'),
        isLink: true,
        sandboxOnly: true,
        withdrawn: true,
      },
    ]);
    expect(store.crls).toEqual([
      {
        der: new Uint8Array(crl),
        issuerCountry: 'UT',
        issuerKeyId: 'ab'.repeat(20),
        thisUpdate: AT,
        nextUpdate: null,
      },
    ]);
  });

  it('says whether a production environment has an anchor to verify against (C50.4, H28)', async () => {
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(false);
    await seedTrustAnchorSource(database.db, { id: 'bsi-de' });
    const utopia = await seedTrustAnchor(database.db, {
      certificate: certificate(),
      sandboxOnly: true,
    });
    await seedTrustAnchorMembership(database.db, { sourceId: 'bsi-de', anchorId: utopia });
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(false);
    const dropped = await seedTrustAnchor(database.db, { certificate: certificate() });
    await seedTrustAnchorMembership(database.db, {
      sourceId: 'bsi-de',
      anchorId: dropped,
      withdrawnAt: AT,
    });
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(false);
    const listed = await seedTrustAnchor(database.db, { certificate: certificate() });
    await seedTrustAnchorMembership(database.db, { sourceId: 'bsi-de', anchorId: listed });
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(true);
  });
});
