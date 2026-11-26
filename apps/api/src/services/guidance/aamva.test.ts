/**
 * C52.2, C59.6: an AAMVA verification's flow view: where its values come from (the user's form,
 * or the server reading the inquiry's licence) and whether they were received. Never a value.
 */
import { FLOW_AAMVA_ATTRIBUTES } from '@openverify/contracts';
import { createVerification, type VerificationWithChecks } from '@openverify/db';
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
import type { ApiDependencies } from '../context.js';
import { aamvaGuidance } from './aamva.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const flowAttributesSchema = z.strictObject(FLOW_AAMVA_ATTRIBUTES);

async function aamvaVerification(): Promise<VerificationWithChecks> {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'aamva',
  });
  return { ...verification, checks: [] };
}

function attributes(
  verification: VerificationWithChecks,
  source: 'form' | 'government_id' | undefined,
) {
  return aamvaGuidance.flowAttributes({
    deps: {} as ApiDependencies,
    db: database.db,
    verification,
    step: source === undefined ? undefined : { id: 'aamva', type: 'aamva', source },
    config: undefined,
  });
}

describe('the AAMVA guidance (C52.2)', () => {
  it.each(['form', 'government_id'] as const)('names the %s source', async (source) => {
    const verification = await aamvaVerification();

    const flow = await attributes(verification, source);

    expect(flow).toEqual({ guidance: { source }, 'inputs-received': false });
    expect(flowAttributesSchema.safeParse(flow).success).toBe(true);
  });

  it('says the values were received once they were, without any value', async () => {
    const verification = await aamvaVerification();
    await seedVerificationInputs(database.db, verification.environmentId, {
      verificationId: verification.id,
      inquiryId: verification.inquiryId,
      values: { 'name-first': 'Synthia', 'identification-number': 'D1234567' },
    });

    const flow = await attributes(verification, 'form');

    expect(flow).toEqual({ guidance: { source: 'form' }, 'inputs-received': true });
  });

  it('gives no guidance without an AAMVA step', async () => {
    const verification = await aamvaVerification();

    expect(await attributes(verification, undefined)).toEqual({
      guidance: null,
      'inputs-received': false,
    });
  });
});
