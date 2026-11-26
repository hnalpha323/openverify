/**
 * C52.2: a business website verification's flow view: an empty guidance object (the step needs
 * none), and whether its URL was received. Never a value.
 */
import { FLOW_BUSINESS_WEBSITE_ATTRIBUTES } from '@openverify/contracts';
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
import { businessWebsiteGuidance } from './business-website.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const STEP: FlowStep = { id: 'website', type: 'business_website' };

async function websiteVerification(): Promise<VerificationWithChecks> {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'business_website',
  });
  return { ...verification, checks: [] };
}

const attributes = (verification: VerificationWithChecks, step: FlowStep | undefined) =>
  businessWebsiteGuidance.flowAttributes({
    deps: {} as ApiDependencies,
    db: database.db,
    verification,
    step,
    config: undefined,
  });

describe('the business-website guidance (C52.2)', () => {
  it('is an empty object for a website step, and says whether the URL was received', async () => {
    const verification = await websiteVerification();

    const before = await attributes(verification, STEP);
    await seedVerificationInputs(database.db, verification.environmentId, {
      verificationId: verification.id,
      inquiryId: verification.inquiryId,
      values: { 'website-url': 'https://utopia-widgets.example/' },
    });
    const after = await attributes(verification, STEP);

    expect(before).toEqual({ guidance: {}, 'inputs-received': false });
    expect(after).toEqual({ guidance: {}, 'inputs-received': true });
    expect(z.strictObject(FLOW_BUSINESS_WEBSITE_ATTRIBUTES).safeParse(after).success).toBe(true);
    expect(JSON.stringify(after)).not.toContain('utopia');
  });

  it('gives no guidance without a website step', async () => {
    const verification = await websiteVerification();

    expect(await attributes(verification, undefined)).toEqual({
      guidance: null,
      'inputs-received': false,
    });
  });
});
