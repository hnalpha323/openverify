/**
 * C50.5, C59.6: settling reads the source of each server-created AAMVA attempt
 * (`verification_inputs.source_verification_id`), so a silent AAMVA step bound to the latest
 * decided government ID verification settles the inquiry.
 */
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import {
  createVerification,
  getInquiry,
  redactInquiryRecords,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type VerificationStatus,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  type TestDatabase,
} from '@openverify/db/testing';
import type { Flow } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../jobs/testing.js';
import { createRecordingEventPublisher, fixedClock } from '../test-support/fakes.js';
import { settleInquiry } from './inquiry-settlement.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** Consent, a government ID step, then the silent AAMVA step (C59.6). */
function silentAamvaTemplate() {
  const attributes = defaultInquiryTemplateAttributes();
  const steps = attributes.flow.steps.filter((step) => step.type !== 'selfie');
  const completion = steps.findIndex((step) => step.type === 'completion');
  const flow: Flow = {
    ...attributes.flow,
    steps: [
      ...steps.slice(0, completion),
      { id: 'aamva', type: 'aamva', source: 'government_id' },
      ...steps.slice(completion),
    ],
  };
  const config = { ...attributes['verification-config'], aamva: defaultTemplateConfig('aamva') };
  delete config.selfie;
  return { flow, config };
}

async function verificationOf(
  inquiryId: string,
  type: 'government_id' | 'aamva',
  status: VerificationStatus,
): Promise<string> {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type });
  if (status === 'skipped') {
    await setVerificationStatus(db, environmentId, id, { to: 'skipped' });
  } else {
    await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
    await setVerificationStatus(db, environmentId, id, { to: status });
  }
  return id;
}

describe('settleInquiry with a silent AAMVA step (C50.5, C59.6)', () => {
  it('completes once the attempt bound to the decided ID is done, reading its source', async () => {
    const { flow, config } = silentAamvaTemplate();
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow,
      verificationConfig: config,
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
    const id = await verificationOf(inquiry.id, 'government_id', 'passed');
    const aamva = await verificationOf(inquiry.id, 'aamva', 'skipped');
    await seedVerificationInputs(db, environmentId, {
      verificationId: aamva,
      inquiryId: inquiry.id,
      values: {},
      source: 'government_id',
      sourceVerificationId: id,
    });
    const deps = {
      db,
      events: createRecordingEventPublisher(),
      clock: fixedClock(),
      logger: createCapturingLogger(),
    };

    await expect(settleInquiry(deps, environmentId, inquiry.id, flow)).resolves.toBe('completed');
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('completed');
  });
});

describe('settleInquiry on a redacted pending inquiry (owner decision 5 after Workflow 6C)', () => {
  it.each([
    ['passed', 'completed'],
    ['failed', 'failed'],
    ['needs_review', 'needs_review'],
  ] as const)(
    'leaves it pending and publishes nothing, where a government ID %s settles it %s unredacted',
    async (verificationStatus, settled) => {
      const { flow, config } = silentAamvaTemplate();
      const governmentIdOnly: Flow = {
        ...flow,
        steps: flow.steps.filter((step) => step.type !== 'aamva'),
      };
      const pendingWith = async () => {
        const { inquiry } = await createTestInquiry(db, environmentId, {
          flow: governmentIdOnly,
          verificationConfig: config,
        });
        await transitionInquiryStatus(db, environmentId, inquiry.id, {
          from: 'created',
          to: 'pending',
        });
        await verificationOf(inquiry.id, 'government_id', verificationStatus);
        return inquiry.id;
      };
      const settle = (inquiryId: string, events = createRecordingEventPublisher()) =>
        settleInquiry(
          { db, events, clock: fixedClock(), logger: createCapturingLogger() },
          environmentId,
          inquiryId,
          governmentIdOnly,
        );
      // The same inquiry without the redaction settles.
      await expect(settle(await pendingWith())).resolves.toBe(settled);
      const id = await pendingWith();
      await redactInquiryRecords(db, environmentId, id);
      const events = createRecordingEventPublisher();

      await expect(settle(id, events)).resolves.toBe('pending');
      expect(await getInquiry(db, environmentId, id)).toMatchObject({
        status: 'pending',
        completedAt: null,
        failedAt: null,
      });
      expect(events.events).toEqual([]);
    },
  );
});
