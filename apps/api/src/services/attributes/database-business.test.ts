/**
 * C52.8, C53.7: a business registry verification's attributes are the business as entered (every
 * C52.8 member present, `null` when absent; the body's `country-code` served as
 * `address-country-code`) and the register's record it was judged against (record id, legal name,
 * source, status). The PII members are masked for a principal without `pii:view` and `null` once
 * redacted; the source, which is not PII, stays. Every value is synthetic.
 */
import { DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import {
  createVerification,
  putBusinessRegistryRecord,
  redactBusinessRegistryRecords,
  redactVerificationInputs,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UNMASKED, piiMaskFor } from '../../auth/pii.js';
import { userPrincipal } from '../../test-support/principals.js';
import { databaseBusinessAttributes } from './database-business.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const NAMES = Object.keys(DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES);
const attributesSchema = z.strictObject(DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES);
const nulls = Object.fromEntries(NAMES.map((name) => [name, null]));
const AT = new Date('2026-10-24T12:00:00.000Z');
const VALUES = {
  'business-name': 'Utopia Synthetic Widgets Ltd',
  'country-code': 'GB',
  'registration-number': '01234567',
  lei: '5493001KJTIIGC8Y1R12',
  'address-street-1': '1 Placeholder Row',
  'address-city': 'Utopia Town',
  'address-postal-code': 'UT1 0ZZ',
  'associated-persons': [{ 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' }],
};
const viewer = piiMaskFor(
  userPrincipal({ organizationId: 'org_x', environmentId: 'env_x', permissions: [] }),
);

async function businessVerification(): Promise<VerificationWithChecks> {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'database_business',
  });
  return { ...verification, checks: [] };
}

async function judged() {
  const verification = await businessVerification();
  await seedVerificationInputs(database.db, verification.environmentId, {
    verificationId: verification.id,
    inquiryId: verification.inquiryId,
    values: VALUES,
  });
  await putBusinessRegistryRecord(database.db, verification.environmentId, {
    verificationId: verification.id,
    inquiryId: verification.inquiryId,
    source: 'companies-house',
    record: {
      recordId: '01234567',
      legalName: 'UTOPIA SYNTHETIC WIDGETS LIMITED',
      status: 'active',
      jurisdiction: 'england-wales',
      registeredAddress: '1 Placeholder Row, Utopia Town, UT1 0ZZ, GB',
    },
    fetchedAt: AT,
  });
  return verification;
}

const UNMASKED_ATTRIBUTES = {
  'business-name': 'Utopia Synthetic Widgets Ltd',
  'registration-number': '01234567',
  lei: '5493001KJTIIGC8Y1R12',
  'address-street-1': '1 Placeholder Row',
  'address-street-2': null,
  'address-city': 'Utopia Town',
  'address-subdivision': null,
  'address-postal-code': 'UT1 0ZZ',
  'address-country-code': 'GB',
  'associated-persons': [{ 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' }],
  'registry-record-id': '01234567',
  'registry-legal-name': 'UTOPIA SYNTHETIC WIDGETS LIMITED',
  'registry-source': 'companies-house',
  'registry-status': 'active',
};

describe('the database-business attributes (C52.8)', () => {
  it('are every member null before values are entered', async () => {
    const verification = await businessVerification();

    await expect(databaseBusinessAttributes.load(database.db, verification)).resolves.toEqual(
      nulls,
    );
  });

  it('are the business as entered and the register’s record, in the contract’s shape', async () => {
    const verification = await judged();

    const loaded = await databaseBusinessAttributes.load(database.db, verification);

    expect(loaded).toEqual(UNMASKED_ATTRIBUTES);
    expect(attributesSchema.safeParse(loaded).success).toBe(true);
    expect(databaseBusinessAttributes.mask(loaded, UNMASKED)).toEqual(UNMASKED_ATTRIBUTES);
  });

  it('hide the PII members from a principal without pii:view', async () => {
    const verification = await judged();

    const masked = databaseBusinessAttributes.mask(
      await databaseBusinessAttributes.load(database.db, verification),
      viewer,
    );

    expect(masked).toEqual({
      ...UNMASKED_ATTRIBUTES,
      'business-name': null,
      'address-street-1': null,
      'address-city': null,
      'address-postal-code': null,
      'address-country-code': null,
      'associated-persons': null,
      'registry-legal-name': null,
    });
    expect(attributesSchema.safeParse(masked).success).toBe(true);
  });

  it('are null once redacted, keeping the register’s source', async () => {
    const verification = await judged();
    await redactVerificationInputs(database.db, verification.environmentId, [verification.id], AT);
    await redactBusinessRegistryRecords(
      database.db,
      verification.environmentId,
      [verification.id],
      AT,
    );

    await expect(databaseBusinessAttributes.load(database.db, verification)).resolves.toEqual({
      ...nulls,
      'registry-source': 'companies-house',
    });
  });
});
