/**
 * C53.3, C61.1: the write of `business_registry_records` (`api-kyb`): the decision transaction of a
 * business registry verification seals the register's non-personal summary (record id, legal
 * name, status, jurisdiction, registered address; never officers or PSCs) to the verification, and
 * a re-run replaces it while the row is unredacted. No value lies in clear in the row. Every value
 * is synthetic.
 */
import { sql } from 'drizzle-orm';
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
  getBusinessRegistryRecord,
  openBusinessRegistryRecord,
  putBusinessRegistryRecord,
  redactBusinessRegistryRecords,
  type BusinessRegistryRecordSummary,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-24T08:00:00.000Z');
const LATER = new Date('2026-10-24T08:05:00.000Z');

const SUMMARY: BusinessRegistryRecordSummary = {
  recordId: '01234567',
  legalName: 'Quillfeather Synthetic Widgets Ltd',
  status: 'active',
  jurisdiction: 'england-wales',
  registeredAddress: '1 Placeholder Row, Utopia Town, UT1 0ZZ, GB',
};

async function businessVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verificationId = testId('ver');
  await createVerification(database.db, environment.id, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'database_business',
  });
  return { environmentId: environment.id, inquiryId: inquiry.id, verificationId };
}

describe('putBusinessRegistryRecord (C53.3, C61.1)', () => {
  it('seals the summary to the verification and records the source and when it was fetched', async () => {
    const { environmentId, inquiryId, verificationId } = await businessVerification();

    const row = await putBusinessRegistryRecord(database.db, environmentId, {
      verificationId,
      inquiryId,
      source: 'companies-house',
      record: SUMMARY,
      fetchedAt: AT,
    });

    expect(row).toMatchObject({
      verificationId,
      inquiryId,
      source: 'companies-house',
      fetchedAt: AT,
      redactedAt: null,
    });
    expect(await getBusinessRegistryRecord(database.db, environmentId, verificationId)).toEqual(
      row,
    );
    expect(await openBusinessRegistryRecord(database.db, environmentId, verificationId)).toEqual(
      SUMMARY,
    );
  });

  it('keeps no value in clear in the row', async () => {
    const { environmentId, inquiryId, verificationId } = await businessVerification();
    await putBusinessRegistryRecord(database.db, environmentId, {
      verificationId,
      inquiryId,
      source: 'gleif',
      record: SUMMARY,
      fetchedAt: AT,
    });

    const raw = await database.db.execute(
      sql`select * from business_registry_records where verification_id = ${verificationId}`,
    );
    const text = JSON.stringify(raw.rows);
    for (const value of ['Quillfeather', 'Placeholder Row', 'england-wales', '01234567']) {
      expect(text).not.toContain(value);
    }
  });

  it('replaces the record of a re-run while the row is unredacted', async () => {
    const { environmentId, inquiryId, verificationId } = await businessVerification();
    await putBusinessRegistryRecord(database.db, environmentId, {
      verificationId,
      inquiryId,
      source: 'companies-house',
      record: SUMMARY,
      fetchedAt: AT,
    });

    const replaced = await putBusinessRegistryRecord(database.db, environmentId, {
      verificationId,
      inquiryId,
      source: 'gleif',
      record: { ...SUMMARY, recordId: '5493001KJTIIGC8Y1R12', status: 'ISSUED' },
      fetchedAt: LATER,
    });

    expect(replaced).toMatchObject({ source: 'gleif', fetchedAt: LATER });
    expect(await openBusinessRegistryRecord(database.db, environmentId, verificationId)).toEqual({
      ...SUMMARY,
      recordId: '5493001KJTIIGC8Y1R12',
      status: 'ISSUED',
    });
  });

  it('never writes over a redacted record', async () => {
    const { environmentId, inquiryId, verificationId } = await businessVerification();
    await putBusinessRegistryRecord(database.db, environmentId, {
      verificationId,
      inquiryId,
      source: 'sandbox',
      record: SUMMARY,
      fetchedAt: AT,
    });
    await redactBusinessRegistryRecords(database.db, environmentId, [verificationId], AT);

    await expect(
      putBusinessRegistryRecord(database.db, environmentId, {
        verificationId,
        inquiryId,
        source: 'sandbox',
        record: SUMMARY,
        fetchedAt: LATER,
      }),
    ).rejects.toThrow(/redacted/);
    expect(await openBusinessRegistryRecord(database.db, environmentId, verificationId)).toBeNull();
  });

  it('refuses a verification of another environment', async () => {
    const { inquiryId, verificationId } = await businessVerification();
    const other = (await createTestTenant(database.db)).environment.id;

    await expect(
      putBusinessRegistryRecord(database.db, other, {
        verificationId,
        inquiryId,
        source: 'sandbox',
        record: SUMMARY,
        fetchedAt: AT,
      }),
    ).rejects.toThrow(/another environment/);
  });
});
