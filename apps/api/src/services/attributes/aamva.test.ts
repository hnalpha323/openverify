/**
 * C52.8, C53.7, C59.6: an AAMVA verification's attributes are where its values came from (`form`
 * or `government_id`, never PII) and the values themselves, every C52.8 member present (`null`
 * when absent, the values all `null` once redacted, the source kept), masked for a principal
 * without `pii:view`.
 */
import { AAMVA_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
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
import { aamvaAttributes } from './aamva.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const VALUE_NAMES = Object.keys(AAMVA_VERIFICATION_ATTRIBUTES).filter((name) => name !== 'source');
const attributesSchema = z.strictObject(AAMVA_VERIFICATION_ATTRIBUTES);
const VALUES = {
  'name-first': 'Synthia',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'identification-number': 'D1234567',
  'issuing-authority': 'CA',
  'expiration-date': '2030-05-17',
};
const nulls = Object.fromEntries(VALUE_NAMES.map((name) => [name, null]));
const viewer = piiMaskFor(
  userPrincipal({ organizationId: 'org_x', environmentId: 'env_x', permissions: [] }),
);

async function aamvaVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const make = async (type: 'aamva' | 'government_id'): Promise<VerificationWithChecks> => ({
    ...(await createVerification(database.db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type,
    })),
    checks: [],
  });
  return { governmentId: await make('government_id'), aamva: await make('aamva') };
}

describe('the AAMVA attributes (C52.8, C59.6)', () => {
  it('are every member null before values are entered or copied', async () => {
    const { aamva } = await aamvaVerification();

    await expect(aamvaAttributes.load(database.db, aamva)).resolves.toEqual({
      source: null,
      ...nulls,
    });
  });

  it('name the form as the source of entered values', async () => {
    const { aamva } = await aamvaVerification();
    await seedVerificationInputs(database.db, aamva.environmentId, {
      verificationId: aamva.id,
      inquiryId: aamva.inquiryId,
      values: VALUES,
    });

    const attributes = await aamvaAttributes.load(database.db, aamva);

    expect(attributes).toEqual({ source: 'form', ...nulls, ...VALUES });
    expect(attributesSchema.safeParse(attributes).success).toBe(true);
  });

  it('name the government ID as the source of copied values, and keep it once redacted', async () => {
    const { governmentId, aamva } = await aamvaVerification();
    await seedVerificationInputs(database.db, aamva.environmentId, {
      verificationId: aamva.id,
      inquiryId: aamva.inquiryId,
      values: VALUES,
      source: 'government_id',
      sourceVerificationId: governmentId.id,
    });

    expect(await aamvaAttributes.load(database.db, aamva)).toEqual({
      source: 'government_id',
      ...nulls,
      ...VALUES,
    });
    await redactVerificationInputs(database.db, aamva.environmentId, [aamva.id], new Date());
    expect(await aamvaAttributes.load(database.db, aamva)).toEqual({
      source: 'government_id',
      ...nulls,
    });
  });

  it('are masked without pii:view, all but the source', () => {
    const attributes = { source: 'government_id', ...nulls, ...VALUES };

    expect(aamvaAttributes.mask(attributes, viewer)).toEqual({ source: 'government_id', ...nulls });
    expect(aamvaAttributes.mask(attributes, UNMASKED)).toEqual(attributes);
  });
});
