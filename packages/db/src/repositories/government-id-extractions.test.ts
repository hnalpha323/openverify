/**
 * C31.7 storage of the government ID extraction: one row per verification, the fields sealed to
 * their row, the blind index and the perceptual hash with its pigeonhole bands (C34), and
 * redaction. Every value is synthetic: a fictional holder of the test issuer Utopia.
 */
import type { ExtractedFields } from '@openverify/core';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { governmentIdExtractions } from '../schema.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createGovernmentIdExtraction,
  getGovernmentIdExtraction,
  redactGovernmentIdExtractions,
  type NewGovernmentIdExtractionInput,
} from './government-id-extractions.js';
import { REWRAP_TABLES, rewrapTableBatch } from './key-rotation.js';
import { redactInquiryRecords } from './redaction.js';
import { createVerification } from './verifications.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const MARKER = 'Valemont-synthetic-pii';

const fields: ExtractedFields = {
  'name-first': 'QUINN',
  'name-middle': null,
  'name-last': `VALEMONT ${MARKER}`,
  birthdate: '1990-02-14',
  sex: 'X',
  nationality: 'UTO',
  'identification-number': 'X12K45P78',
  'personal-number': null,
  'issue-date': '2024-03-01',
  'expiration-date': '2034-02-28',
  'issuing-authority-code': 'UTO',
  'address-street-1': '12 LANTERN ROW',
  'address-street-2': null,
  'address-city': 'NORTH HAVEN',
  'address-subdivision': null,
  'address-postal-code': 'UT 1024',
  'address-country-code': null,
  endorsements: null,
  restrictions: null,
  'vehicle-class': null,
};

const INDEX = 'a'.repeat(64);
const PHASH = '0123456789abcdef';

async function governmentId() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  return { environmentId: environment.id, inquiryId: inquiry.id, verificationId: verification.id };
}

const input = (verificationId: string): NewGovernmentIdExtractionInput => ({
  verificationId,
  fields,
  fieldSources: { 'name-last': ['mrz', 'viz'], birthdate: ['mrz'] },
  identificationNumberIndex: INDEX,
  frontPhash: PHASH,
});

describe('government ID extractions (C31.7)', () => {
  it('stores one extraction per verification and reads it back decrypted', async () => {
    const { environmentId, verificationId } = await governmentId();

    const created = await createGovernmentIdExtraction(
      database.db,
      environmentId,
      input(verificationId),
    );

    const expected = {
      environmentId,
      verificationId,
      fields,
      fieldSources: { 'name-last': ['mrz', 'viz'], birthdate: ['mrz'] },
      identificationNumberIndex: INDEX,
      frontPhash: PHASH,
      frontPhashBands: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef],
      redactedAt: null,
    };
    expect(created).toMatchObject(expected);
    expect(await getGovernmentIdExtraction(database.db, environmentId, verificationId)).toEqual(
      created,
    );
  });

  it('seals the fields to their row, so no value is stored in plain text', async () => {
    const { environmentId, verificationId } = await governmentId();
    await createGovernmentIdExtraction(database.db, environmentId, input(verificationId));

    const raw = await database.db.execute(
      sql`select fields, field_sources from government_id_extractions
           where verification_id = ${verificationId}`,
    );
    const stored = JSON.stringify(raw.rows);
    expect(stored).toContain('ov1.');
    expect(stored).not.toContain(MARKER);
    expect(stored).not.toContain('1990-02-14');
    expect(stored).not.toContain('X12K45P78');
    expect(SEALED.governmentIdExtractionFields).toBe('government_id_extractions.fields');
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'government_id_extractions',
      column: 'fields',
      aad: 'row',
    });
  });

  it('replaces the extraction of a verification processed again (a job retry)', async () => {
    const { environmentId, verificationId } = await governmentId();
    await createGovernmentIdExtraction(database.db, environmentId, input(verificationId));

    const again = await createGovernmentIdExtraction(database.db, environmentId, {
      ...input(verificationId),
      frontPhash: 'ffffffffffffffff',
    });

    expect(again.frontPhash).toBe('ffffffffffffffff');
    expect(again.frontPhashBands).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
  });

  it('accepts an extraction without a blind index or perceptual hash', async () => {
    const { environmentId, verificationId } = await governmentId();

    const created = await createGovernmentIdExtraction(database.db, environmentId, {
      ...input(verificationId),
      identificationNumberIndex: null,
      frontPhash: null,
    });

    expect(created).toMatchObject({
      identificationNumberIndex: null,
      frontPhash: null,
      frontPhashBands: null,
    });
  });

  it('keeps to its environment', async () => {
    const { environmentId, verificationId } = await governmentId();
    await createGovernmentIdExtraction(database.db, environmentId, input(verificationId));
    const other = await createTestTenant(database.db);

    expect(
      await getGovernmentIdExtraction(database.db, other.environment.id, verificationId),
    ).toBeNull();
    await expect(
      createGovernmentIdExtraction(database.db, other.environment.id, input(verificationId)),
    ).rejects.toThrow();
  });

  it.each([
    ['a perceptual hash that is not 16 hex characters', { frontPhash: '0123' }],
    ['an upper-case perceptual hash', { frontPhash: '0123456789ABCDEF' }],
    ['a blind index that is not a SHA-256 hex digest', { identificationNumberIndex: 'abc' }],
  ])('refuses %s', async (_label, change) => {
    const { environmentId, verificationId } = await governmentId();
    await expect(
      createGovernmentIdExtraction(database.db, environmentId, {
        ...input(verificationId),
        ...change,
      }),
    ).rejects.toThrow();
  });

  it('redacts the fields, the blind index and the perceptual hash with its bands', async () => {
    const { environmentId, verificationId } = await governmentId();
    await createGovernmentIdExtraction(database.db, environmentId, input(verificationId));
    const at = new Date('2026-12-01T00:00:00.000Z');

    expect(
      await redactGovernmentIdExtractions(database.db, environmentId, [verificationId], at),
    ).toBe(1);
    expect(
      await redactGovernmentIdExtractions(database.db, environmentId, [verificationId], at),
    ).toBe(0);

    expect(
      await getGovernmentIdExtraction(database.db, environmentId, verificationId),
    ).toMatchObject({
      fields: null,
      fieldSources: { 'name-last': ['mrz', 'viz'], birthdate: ['mrz'] },
      identificationNumberIndex: null,
      frontPhash: null,
      frontPhashBands: null,
      redactedAt: at,
    });
    const raw = await database.db.execute(
      sql`select * from government_id_extractions where verification_id = ${verificationId}`,
    );
    expect(JSON.stringify(raw.rows)).not.toContain('ov1.');
  });

  it('is redacted with its inquiry (C16 redactInquiryRecords)', async () => {
    const { environmentId, inquiryId, verificationId } = await governmentId();
    await createGovernmentIdExtraction(database.db, environmentId, input(verificationId));

    await redactInquiryRecords(database.db, environmentId, inquiryId, {
      at: new Date('2026-12-01T00:00:00.000Z'),
    });

    expect(
      await getGovernmentIdExtraction(database.db, environmentId, verificationId),
    ).toMatchObject({ fields: null, identificationNumberIndex: null, frontPhash: null });
  });

  it('takes part in the KEK rewrap, keyed by verification id', async () => {
    const { environmentId, verificationId } = await governmentId();
    await createGovernmentIdExtraction(database.db, environmentId, input(verificationId));

    expect(REWRAP_TABLES).toContain('government_id_extractions');
    const batch = await rewrapTableBatch(database.db, 'government_id_extractions', {
      keyring: database.keyring,
      dryRun: true,
    });
    expect(batch.scanned).toBeGreaterThan(0);
  });
});

describe('the government_id_extractions table (C31.7, C34)', () => {
  const config = () => getTableConfig(governmentIdExtractions);

  it('indexes the blind index per environment, for unredacted rows', () => {
    expect(
      config().indexes.map(({ config: index }) => ({
        name: index.name,
        partial: index.where !== undefined,
        columns: index.columns.map((part) => ('name' in part ? part.name : 'sql')),
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          name: 'government_id_extractions_environment_id_identification_number_index_idx',
          partial: true,
          columns: ['environment_id', 'identification_number_index'],
        },
      ]),
    );
  });

  it('indexes each of the eight perceptual-hash bands per environment, for the pigeonhole lookup', () => {
    const names = config().indexes.map(({ config: index }) => index.name);
    for (let band = 0; band < 8; band += 1) {
      expect(names).toContain(
        `government_id_extractions_environment_id_front_phash_band_${String(band)}_idx`,
      );
    }
  });
});
