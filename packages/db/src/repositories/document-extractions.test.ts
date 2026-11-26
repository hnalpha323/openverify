/**
 * C53.3, C54.1: the document job's write of a verification's extraction (`putDocumentExtraction`),
 * in its decision transaction: the class, confidence, page count and media type in the clear, the
 * extracted values sealed to the row; a re-run replaces them; another environment's verification
 * and a redacted row are refused. Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createVerification,
  getDocumentExtraction,
  openDocumentExtractionFields,
  putDocumentExtraction,
  redactDocumentExtractions,
  type DocumentExtractionInput,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-23T08:00:00.000Z');

const FIELDS = {
  name: 'QUINN VALEMONT',
  'address-street-1': '14 LANTERN ROW',
  'address-street-2': null,
  'address-city': 'MERIDALE',
  'address-subdivision': 'UT',
  'address-postal-code': '00000',
  'address-country-code': 'US',
  'issue-date': '2026-09-30',
  issuer: 'UTOPIA WATER BOARD',
  'expiration-date': null,
};

async function documentVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'document',
  });
  return { env: environment.id, inquiryId: inquiry.id, verificationId: verification.id };
}

function inputOf(
  ids: { inquiryId: string; verificationId: string },
  overrides: Partial<DocumentExtractionInput> = {},
): DocumentExtractionInput {
  return {
    verificationId: ids.verificationId,
    inquiryId: ids.inquiryId,
    documentType: 'utility_bill',
    typeConfidence: 0.91,
    fields: FIELDS,
    pageCount: 2,
    mimeType: 'application/pdf',
    ...overrides,
  };
}

/** The row as Postgres holds it, every column as text. */
async function rawRow(verificationId: string): Promise<string> {
  const result = await database.client.query(
    'select * from document_extractions where verification_id = $1',
    [verificationId],
  );
  return JSON.stringify(result.rows);
}

describe('putDocumentExtraction (C53.3)', () => {
  it('writes the class, confidence, pages and media type, and seals the values to the row', async () => {
    const ids = await documentVerification();

    const written = await putDocumentExtraction(database.db, ids.env, inputOf(ids));

    expect(written).toMatchObject({
      verificationId: ids.verificationId,
      inquiryId: ids.inquiryId,
      documentType: 'utility_bill',
      typeConfidence: 0.91,
      pageCount: 2,
      mimeType: 'application/pdf',
      redactedAt: null,
    });
    expect(await getDocumentExtraction(database.db, ids.env, ids.verificationId)).toEqual(written);
    expect(await openDocumentExtractionFields(database.db, ids.env, ids.verificationId)).toEqual(
      FIELDS,
    );
    const raw = await rawRow(ids.verificationId);
    for (const value of ['QUINN', 'LANTERN', 'MERIDALE', 'UTOPIA WATER', '2026-09-30']) {
      expect(raw).not.toContain(value);
    }
  });

  it('keeps an unclassified document: other or unknown, without a confidence', async () => {
    const ids = await documentVerification();

    await putDocumentExtraction(
      database.db,
      ids.env,
      inputOf(ids, {
        documentType: 'unknown',
        typeConfidence: null,
        mimeType: 'image/jpeg',
        pageCount: 1,
      }),
    );

    expect(await getDocumentExtraction(database.db, ids.env, ids.verificationId)).toMatchObject({
      documentType: 'unknown',
      typeConfidence: null,
      pageCount: 1,
      mimeType: 'image/jpeg',
    });
  });

  it('replaces the values on a re-run of the job, keeping when it was first written', async () => {
    const ids = await documentVerification();
    await putDocumentExtraction(database.db, ids.env, inputOf(ids));
    const first = await getDocumentExtraction(database.db, ids.env, ids.verificationId);

    const replaced = await putDocumentExtraction(
      database.db,
      ids.env,
      inputOf(ids, {
        documentType: 'bank_statement',
        typeConfidence: 0.64,
        pageCount: 3,
        fields: { ...FIELDS, issuer: 'UTOPIA SAVINGS BANK', 'issue-date': '2026-10-01' },
      }),
    );

    expect(replaced).toMatchObject({
      documentType: 'bank_statement',
      typeConfidence: 0.64,
      pageCount: 3,
      createdAt: first?.createdAt,
    });
    expect(
      await openDocumentExtractionFields(database.db, ids.env, ids.verificationId),
    ).toMatchObject({ issuer: 'UTOPIA SAVINGS BANK', 'issue-date': '2026-10-01' });
  });

  it('refuses a verification of another environment, before and after it has a row', async () => {
    const ids = await documentVerification();
    const other = (await createTestTenant(database.db)).environment.id;

    await expect(putDocumentExtraction(database.db, other, inputOf(ids))).rejects.toThrow();
    await putDocumentExtraction(database.db, ids.env, inputOf(ids));
    await expect(
      putDocumentExtraction(database.db, other, inputOf(ids, { documentType: 'lease' })),
    ).rejects.toThrow(/another environment or redacted/);
    expect(await getDocumentExtraction(database.db, ids.env, ids.verificationId)).toMatchObject({
      documentType: 'utility_bill',
    });
  });

  it('never writes over a redacted extraction', async () => {
    const ids = await documentVerification();
    await putDocumentExtraction(database.db, ids.env, inputOf(ids));
    await redactDocumentExtractions(database.db, ids.env, [ids.verificationId], AT);

    await expect(putDocumentExtraction(database.db, ids.env, inputOf(ids))).rejects.toThrow(
      /another environment or redacted/,
    );
    expect(await openDocumentExtractionFields(database.db, ids.env, ids.verificationId)).toBeNull();
    expect(await getDocumentExtraction(database.db, ids.env, ids.verificationId)).toMatchObject({
      redactedAt: AT,
    });
  });

  it.each([
    ['a number', { ...FIELDS, 'address-postal-code': 12345 }],
    ['an object', { ...FIELDS, name: { first: 'QUINN' } }],
  ])('refuses a value that is %s, writing nothing', async (_, fields) => {
    const ids = await documentVerification();

    await expect(
      putDocumentExtraction(
        database.db,
        ids.env,
        inputOf(ids, { fields: fields as unknown as DocumentExtractionInput['fields'] }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(await getDocumentExtraction(database.db, ids.env, ids.verificationId)).toBeNull();
  });
});
