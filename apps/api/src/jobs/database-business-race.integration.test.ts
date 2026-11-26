/**
 * C53.3, C53.6, C40.6 against Postgres 17 row locks (Testcontainers), for the one Postgres writer
 * of `api-kyb`, the registry record a business verification's decision seals
 * (`business_registry_records`), in the pattern of `aamva-race.integration.test.ts`:
 * - the record is written in the decision transaction, after the inquiry is locked and checked
 *   unredacted: a redaction that starts during that write waits for its commit, then nulls the
 *   record with the entered values; a decision after a redaction writes no record;
 * - two jobs of one verification decide it once, with one record and one `verification.passed`.
 * The register is the sandbox one; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { eventPayloadSchema, newId } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import {
  createDatabase,
  createKeyring,
  createVerification,
  getBusinessRegistryRecord,
  getVerification,
  getVerificationInputs,
  listEvents,
  openBusinessRegistryRecord,
  redactInquiryRecords,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  transitionInquiryStatus,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  startIntegrationPostgres,
  ifSet,
} from '@openverify/db/testing';
import { flowSchema } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import { createSandboxBusinessRegistryProvider } from '../providers/business-registry/index.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from './testing.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const keyring = createKeyring(randomBytes(32));
/** Long enough for a statement that takes no lock to finish first. */
const WAIT_MS = 1_500;

const FLOW = flowSchema.parse({
  metadata: { specVersion: 1, id: 'kyb-races', version: 1, name: 'KYB races' },
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    { id: 'business', type: 'database_business' },
    { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
  ],
  transitions: [],
});

const VALUES = {
  'business-name': 'Utopia Synthetic Widgets Ltd',
  'country-code': 'GB',
  'registration-number': '01234567',
  'address-street-1': '1 Placeholder Row',
};

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/** A submitted business verification of a pending inquiry, with its entered values. */
async function submitted() {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: FLOW,
    verificationConfig: { 'database-business': defaultTemplateConfig('database_business') },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const id = newId('ver');
  await createVerification(db, environmentId, {
    id,
    inquiryId: inquiry.id,
    type: 'database_business',
  });
  await seedVerificationInputs(db, environmentId, {
    verificationId: id,
    inquiryId: inquiry.id,
    values: VALUES,
  });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return { inquiryId: inquiry.id, id };
}

/**
 * The job's dependencies. `inTransaction` runs once, inside the decision transaction, when it
 * stages its first event: after the registry record is written.
 */
function jobDeps(inTransaction?: () => Promise<void>): ProcessVerificationDeps {
  const logger = createCapturingLogger();
  const publisher = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  let pending = inTransaction;
  const events: TransactionalEventPublisher = {
    publish: (input) => publisher.publish(input),
    stage: async (tx, input) => {
      const hook = pending;
      pending = undefined;
      await hook?.();
      return publisher.stage(tx, input);
    },
    dispatch: (staged) => publisher.dispatch(staged),
  };
  return {
    db,
    storage: createMemoryStorage(),
    keyring,
    vision: createFakeVision().client,
    events,
    clock: { now: () => NOW },
    logger,
    providers: {
      sandbox: { businessRegistry: createSandboxBusinessRegistryProvider() },
      production: {},
    },
  };
}

/** Whether `promise` settles within {@link WAIT_MS}. */
async function settlesWithin(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  const watched = promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.race([watched, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  return settled;
}

/** Runs `during` while a raw client holds the inquiry row lock with `statements` applied. */
async function holdingInquiry<T>(
  inquiryId: string,
  statements: readonly [string, unknown[]][],
  during: () => Promise<T>,
): Promise<{ outcome: unknown; waited: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM inquiries WHERE id = $1 FOR UPDATE', [inquiryId]);
    for (const [text, values] of statements) {
      await client.query(text, values);
    }
    const running = during().then(
      (value: unknown) => value,
      (error: unknown) => error,
    );
    const waited = !(await settlesWithin(running));
    await client.query('COMMIT');
    return { outcome: await running, waited };
  } finally {
    client.release();
  }
}

describe('C53.3: the registry record in the decision, and a redaction (C53.6, C40.6)', () => {
  it('seals the record in the decision transaction; a redaction that starts then waits and nulls it', async () => {
    const { inquiryId, id } = await submitted();
    let redaction: Promise<unknown> | undefined;
    let redactionWaited = false;
    const deps = jobDeps(async () => {
      redaction = redactInquiryRecords(db, environmentId, inquiryId, { at: NOW });
      redactionWaited = !(await settlesWithin(redaction));
    });

    const result = await processVerification({ environmentId, verificationId: id }, deps);
    await redaction;

    expect(result).toMatchObject({ verificationStatus: 'passed' });
    expect(redactionWaited).toBe(true);
    expect(await getBusinessRegistryRecord(db, environmentId, id)).toMatchObject({
      source: 'sandbox',
      redactedAt: NOW,
    });
    expect(await openBusinessRegistryRecord(db, environmentId, id)).toBeNull();
    expect(await getVerificationInputs(db, environmentId, id)).toMatchObject({ values: null });
  });

  it('a decision after a redaction waits for it, then writes no record', async () => {
    const { inquiryId, id } = await submitted();

    const { outcome, waited } = await holdingInquiry(
      inquiryId,
      [['UPDATE inquiries SET redacted_at = $2 WHERE id = $1', [inquiryId, NOW]]],
      () => processVerification({ environmentId, verificationId: id }, jobDeps()),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ name: 'PermanentJobError', reason: 'inquiry_redacted' });
    expect(await getBusinessRegistryRecord(db, environmentId, id)).toBeNull();
    expect((await getVerification(db, environmentId, id))?.status).toBe('submitted');
  });
});

describe('C40.6: two jobs of one business verification', () => {
  it('decide it once, with one record and one verification.passed', async () => {
    const { id } = await submitted();

    const outcomes = await Promise.allSettled([
      processVerification({ environmentId, verificationId: id }, jobDeps()),
      processVerification({ environmentId, verificationId: id }, jobDeps()),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await getVerification(db, environmentId, id))?.status).toBe('passed');
    expect(await openBusinessRegistryRecord(db, environmentId, id)).toMatchObject({
      recordId: '01234567',
    });
    const page = await listEvents(db, environmentId, { size: 100 });
    // Earlier cases redacted their inquiries, whose event payloads are stubs now: read ids only.
    const passed = page.items.filter(
      (event) =>
        event.name === 'verification.passed' &&
        (event.payload as { data?: { id?: unknown } }).data?.id === id,
    );
    expect(eventPayloadSchema.parse(passed[0]?.payload)).toMatchObject({
      data: { id, attributes: { status: 'passed', 'registry-source': 'sandbox' } },
    });
    expect(passed).toHaveLength(1);
  });
});
