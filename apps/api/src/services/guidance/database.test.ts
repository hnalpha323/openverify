/**
 * C52.2: a database verification's flow view: the body members its step collects and the ones it
 * must carry (the step's `requiredFields`, and always the name and the country, without which no
 * source can be asked), and whether its values were received. Never a value.
 */
import { FLOW_DATABASE_ATTRIBUTES } from '@openverify/contracts';
import { createVerification, type VerificationWithChecks } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import type { FlowStep } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ApiDependencies } from '../context.js';
import { databaseGuidance } from './database.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const flowAttributesSchema = z.strictObject(FLOW_DATABASE_ATTRIBUTES);

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

const STEP: FlowStep = {
  id: 'database',
  type: 'database',
  fields: ['name_first', 'name_last', 'birthdate', 'address_street_1', 'address_country_code'],
};

function attributes(verification: VerificationWithChecks, step: FlowStep | undefined) {
  return databaseGuidance.flowAttributes({
    deps: {} as ApiDependencies,
    db: database.db,
    verification,
    step,
    config: undefined,
  });
}

describe('the database guidance (C52.2)', () => {
  it('names the collected members and, without requiredFields, the name and the country as required', async () => {
    const verification = await databaseVerification();

    const flow = await attributes(verification, STEP);

    expect(flow).toEqual({
      guidance: {
        fields: ['name-first', 'name-last', 'birthdate', 'address-street-1', 'address-country-code'],
        'required-fields': ['name-first', 'name-last', 'address-country-code'],
      },
      'inputs-received': false,
    });
    expect(flowAttributesSchema.safeParse(flow).success).toBe(true);
  });

  it('adds the step requiredFields to them, in the step order', async () => {
    const verification = await databaseVerification();

    const flow = await attributes(verification, {
      ...STEP,
      requiredFields: ['birthdate', 'address_street_1'],
    });

    expect(flow).toMatchObject({
      guidance: {
        'required-fields': [
          'name-first',
          'name-last',
          'birthdate',
          'address-street-1',
          'address-country-code',
        ],
      },
    });
  });

  it('says the values were received once they were, without any value', async () => {
    const verification = await databaseVerification();
    await seedVerificationInputs(database.db, verification.environmentId, {
      verificationId: verification.id,
      inquiryId: verification.inquiryId,
      values: { 'name-first': 'Synthia', 'name-last': 'Testerton', 'address-country-code': 'US' },
    });

    const flow = await attributes(verification, STEP);

    expect(flow).toMatchObject({ 'inputs-received': true });
    expect(JSON.stringify(flow)).not.toContain('Synthia');
  });

  it('gives no guidance without a database step', async () => {
    const verification = await databaseVerification();

    expect(await attributes(verification, undefined)).toEqual({
      guidance: null,
      'inputs-received': false,
    });
  });
});
