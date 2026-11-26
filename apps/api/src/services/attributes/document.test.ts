/**
 * C52.8, C54.1: the `document` attribute hook. It reads the verification's extraction (the class,
 * its confidence, the page count and the media type in the clear; the extracted `fields` opened
 * from the sealed column) and, before the job ran, the media type of the uploaded document; it
 * serves only what the contract schema takes; it masks `fields` member-wise (C53.7); and it
 * serves `fields: null` once the inquiry is redacted, the rest kept. Every value is synthetic.
 */
import { DOCUMENT_VERIFICATION_ATTRIBUTES, newId } from '@openverify/contracts';
import {
  createFile,
  createVerification,
  encryptBytes,
  getVerification,
  redactInquiryRecords,
  type Db,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedDocumentExtraction,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UNMASKED, piiMaskFor } from '../../auth/pii.js';
import type { Principal } from '../../ports.js';
import { documentAttributes } from './document.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

const FIELDS = {
  name: 'QUINN VALEMONT',
  'address-street-1': '14 LANTERN ROW',
  'address-city': 'MERIDALE',
  'address-subdivision': 'UT',
  'address-postal-code': '00000',
  'address-country-code': 'US',
  'issue-date': '2026-09-30',
  issuer: 'UTOPIA WATER BOARD',
};

/** Every C52.8 `fields` member, `null` unless given. */
const ALL_FIELDS = {
  name: null,
  'address-street-1': null,
  'address-street-2': null,
  'address-city': null,
  'address-subdivision': null,
  'address-postal-code': null,
  'address-country-code': null,
  'issue-date': null,
  issuer: null,
  'expiration-date': null,
};

const documentAttributesSchema = z.strictObject(DOCUMENT_VERIFICATION_ATTRIBUTES);

/** A user without `pii:view`. */
const MASKED_USER = {
  kind: 'user',
  permissions: new Set(['inquiries:read']),
} as unknown as Principal;

async function documentVerification(
  options: { mimeType?: 'image/jpeg' | 'application/pdf' | null } = {},
): Promise<{ inquiryId: string; verification: VerificationWithChecks }> {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId: inquiry.id, type: 'document' });
  const mimeType = options.mimeType === undefined ? 'application/pdf' : options.mimeType;
  if (mimeType !== null) {
    const fileId = newId('file');
    const bytes = Buffer.from('synthetic document bytes');
    await createFile(db, environmentId, {
      id: fileId,
      verificationId: id,
      kind: 'document',
      storageKey: `${environmentId}/${fileId}`,
      mimeType,
      byteSize: bytes.byteLength,
      sha256: 'a'.repeat(64),
      wrappedDek: encryptBytes(bytes, database.keyring, { context: fileId }).wrappedDek,
    });
  }
  const verification = await getVerification(db, environmentId, id);
  if (verification === null) {
    throw new Error('the verification was not written');
  }
  return { inquiryId: inquiry.id, verification };
}

describe('documentAttributes.load (C52.8)', () => {
  it('serves the uploaded media type alone before the job read the document', async () => {
    const { verification } = await documentVerification({ mimeType: 'image/jpeg' });

    const attributes = await documentAttributes.load(db, verification);

    expect(attributes).toEqual({
      'document-type': null,
      'document-type-confidence': null,
      'page-count': null,
      'mime-type': 'image/jpeg',
      fields: null,
    });
    expect(documentAttributesSchema.safeParse(attributes).success).toBe(true);
  });

  it('serves nothing without an upload or an extraction', async () => {
    const { verification } = await documentVerification({ mimeType: null });

    expect(await documentAttributes.load(db, verification)).toEqual({
      'document-type': null,
      'document-type-confidence': null,
      'page-count': null,
      'mime-type': null,
      fields: null,
    });
  });

  it('serves the extraction: the class, its confidence, the pages, the media type and every field', async () => {
    const { inquiryId, verification } = await documentVerification({ mimeType: 'image/jpeg' });
    await seedDocumentExtraction(db, environmentId, {
      verificationId: verification.id,
      inquiryId,
      documentType: 'utility_bill',
      typeConfidence: 0.91,
      pageCount: 2,
      mimeType: 'application/pdf',
      fields: FIELDS,
    });

    const attributes = await documentAttributes.load(db, verification);

    expect(attributes).toEqual({
      'document-type': 'utility_bill',
      'document-type-confidence': 0.91,
      'page-count': 2,
      'mime-type': 'application/pdf',
      fields: { ...ALL_FIELDS, ...FIELDS },
    });
    expect(documentAttributesSchema.safeParse(attributes).success).toBe(true);
  });

  it('serves only what the contract takes: an unknown member left out, an invalid value null', async () => {
    const { inquiryId, verification } = await documentVerification();
    await seedDocumentExtraction(db, environmentId, {
      verificationId: verification.id,
      inquiryId,
      documentType: 'unknown',
      typeConfidence: 0.31,
      fields: {
        name: 'QUINN VALEMONT',
        'issue-date': '2026-02-30',
        'address-country-code': 'usa',
        nickname: 'Q',
      },
    });

    const attributes = await documentAttributes.load(db, verification);

    expect(attributes).toMatchObject({
      'document-type': 'unknown',
      'document-type-confidence': 0.31,
      fields: { ...ALL_FIELDS, name: 'QUINN VALEMONT' },
    });
    expect(documentAttributesSchema.safeParse(attributes).success).toBe(true);
  });

  it('serves fields as null once the inquiry is redacted, and keeps what is not personal', async () => {
    const { inquiryId, verification } = await documentVerification();
    await seedDocumentExtraction(db, environmentId, {
      verificationId: verification.id,
      inquiryId,
      documentType: 'bank_statement',
      typeConfidence: 0.7,
      pageCount: 3,
      fields: FIELDS,
    });
    await redactInquiryRecords(db, environmentId, inquiryId);

    expect(await documentAttributes.load(db, verification)).toEqual({
      'document-type': 'bank_statement',
      'document-type-confidence': 0.7,
      'page-count': 3,
      'mime-type': 'application/pdf',
      fields: null,
    });
  });
});

describe('documentAttributes.mask (C53.7)', () => {
  const served = {
    'document-type': 'utility_bill',
    'document-type-confidence': 0.91,
    'page-count': 2,
    'mime-type': 'application/pdf',
    fields: { ...ALL_FIELDS, ...FIELDS },
  };

  it('leaves everything to a principal with pii:view', () => {
    expect(documentAttributes.mask(served, UNMASKED)).toEqual(served);
  });

  it('masks fields member-wise without pii:view, keeping the class, pages and media type', () => {
    expect(documentAttributes.mask(served, piiMaskFor(MASKED_USER))).toEqual({
      ...served,
      fields: ALL_FIELDS,
    });
  });
});
