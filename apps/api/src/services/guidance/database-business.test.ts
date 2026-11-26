/**
 * C52.2: a business registry verification's flow view: whether its step collects associated
 * persons, the inputs every configured match group names (`required-inputs`, as the inputs route
 * enforces them), and whether its values were received. Never a value.
 */
import { FLOW_DATABASE_BUSINESS_ATTRIBUTES } from '@openverify/contracts';
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';
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
import { databaseBusinessGuidance } from './database-business.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const flowAttributesSchema = z.strictObject(FLOW_DATABASE_BUSINESS_ATTRIBUTES);
const STEP: FlowStep = { id: 'business', type: 'database_business' };

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

function attributes(
  verification: VerificationWithChecks,
  step: FlowStep | undefined,
  config: VerificationTemplateConfig | undefined = defaultTemplateConfig('database_business'),
) {
  return databaseBusinessGuidance.flowAttributes({
    deps: {} as ApiDependencies,
    db: database.db,
    verification,
    step,
    config,
  });
}

describe('the database-business guidance (C52.2)', () => {
  it('requires the business name under the default groups, and collects no persons by default', async () => {
    const verification = await businessVerification();

    const flow = await attributes(verification, STEP);

    expect(flow).toEqual({
      guidance: { 'collect-associated-persons': false, 'required-inputs': ['business-name'] },
      'inputs-received': false,
    });
    expect(flowAttributesSchema.safeParse(flow).success).toBe(true);
  });

  it('follows the step’s persons and the template’s match groups', async () => {
    const verification = await businessVerification();
    const config = defaultTemplateConfig('database_business');
    config.checks.database_business_identity_comparison = {
      enabled: true,
      required: true,
      config: {
        'match-groups': [{ name: 'partial', 'registration-number': 'full', address: 'partial' }],
      },
    };

    const flow = await attributes(
      verification,
      { ...STEP, type: 'database_business', collectAssociatedPersons: true },
      config,
    );

    expect(flow).toMatchObject({
      guidance: {
        'collect-associated-persons': true,
        'required-inputs': ['business-name', 'registration-number', 'address-street-1'],
      },
    });
  });

  it('says the values were received once they were, without any value', async () => {
    const verification = await businessVerification();
    await seedVerificationInputs(database.db, verification.environmentId, {
      verificationId: verification.id,
      inquiryId: verification.inquiryId,
      values: { 'business-name': 'Utopia Synthetic Widgets Ltd', 'country-code': 'GB' },
    });

    const flow = await attributes(verification, STEP);

    expect(flow).toMatchObject({ 'inputs-received': true });
    expect(JSON.stringify(flow)).not.toContain('Utopia');
  });

  it('gives no guidance without a business step', async () => {
    const verification = await businessVerification();

    expect(await attributes(verification, undefined)).toEqual({
      guidance: null,
      'inputs-received': false,
    });
  });
});
