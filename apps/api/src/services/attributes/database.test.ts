/**
 * C52.8, C53.7: a database verification's attributes are its entered values, every C52.8 member
 * present (`null` when not entered, and all `null` once redacted), masked member by member for a
 * principal without `pii:view`.
 */
import { DATABASE_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import {
  createVerification,
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
import { piiMaskFor, UNMASKED } from '../../auth/pii.js';
import { userPrincipal } from '../../test-support/principals.js';
import { databaseAttributes } from './database.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const NAMES = Object.keys(DATABASE_VERIFICATION_ATTRIBUTES);
const attributesSchema = z.strictObject(DATABASE_VERIFICATION_ATTRIBUTES);
const VALUES = {
  'name-first': 'Synthia',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'address-street-1': '123 Main Street',
  'address-city': 'Springfield',
  'address-country-code': 'US',
  'phone-number': '+15555550100',
};
const nulls = Object.fromEntries(NAMES.map((name) => [name, null]));
const viewer = piiMaskFor(
  userPrincipal({ organizationId: 'org_x', environmentId: 'env_x', permissions: [] }),
);

async function databaseVerification(): Promise<VerificationWithChecks> {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'database',
  });
  return { ...verification, checks: [] };
}

describe('the database attributes (C52.8)', () => {
  it('are every member null before values are entered', async () => {
    const verification = await databaseVerification();

    await expect(databaseAttributes.load(database.db, verification)).resolves.toEqual(nulls);
  });

  it('are the entered values, every other member null', async () => {
    const verification = await databaseVerification();
    await seedVerificationInputs(database.db, verification.environmentId, {
      verificationId: verification.id,
      inquiryId: verification.inquiryId,
      values: VALUES,
    });

    const attributes = await databaseAttributes.load(database.db, verification);

    expect(attributes).toEqual({ ...nulls, ...VALUES });
    expect(attributesSchema.safeParse(attributes).success).toBe(true);
  });

  it('are every member null once redacted', async () => {
    const verification = await databaseVerification();
    await seedVerificationInputs(database.db, verification.environmentId, {
      verificationId: verification.id,
      inquiryId: verification.inquiryId,
      values: VALUES,
    });
    await redactVerificationInputs(
      database.db,
      verification.environmentId,
      [verification.id],
      new Date(),
    );

    await expect(databaseAttributes.load(database.db, verification)).resolves.toEqual(nulls);
  });

  it('are masked member by member without pii:view, and kept with it', () => {
    const attributes = { ...nulls, ...VALUES };

    expect(databaseAttributes.mask(attributes, viewer)).toEqual(nulls);
    expect(databaseAttributes.mask(attributes, UNMASKED)).toEqual(attributes);
  });
});
