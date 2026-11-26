/**
 * The `database` job (C59.1, C59.3) through `processVerification`: the entered values, the step's
 * collected fields and the inquiry's fields go to the C59 evaluators with the bound provider's
 * answer. The provider is asked about the country and the collected fields only, with the inquiry's
 * reference id only when it is the sandbox; an unbound provider answers `provider_not_configured`,
 * a failed one is retried and then `execution_error`; no result carries an entered value. Every
 * value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';
import {
  createInquiry,
  createVerification,
  getInquiry,
  getVerification,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowSchema, type FlowStep } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type {
  DatabaseLookupRequest,
  DatabaseLookupResult,
  DatabaseProvider,
  ProviderBindings,
  SandboxDatabaseContext,
  SandboxDatabaseProvider,
} from '../ports.js';
import { ProviderError } from '../providers/errors.js';
import { createSandboxDatabaseProvider } from '../providers/database/sandbox.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from './testing.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');

const DATABASE_STEP: FlowStep = {
  id: 'database',
  type: 'database',
  fields: [
    'name_first',
    'name_last',
    'birthdate',
    'address_street_1',
    'address_city',
    'address_postal_code',
    'address_country_code',
  ],
};
const FLOW = flowSchema.parse({
  metadata: { specVersion: 1, id: 'database-only', version: 1, name: 'Database' },
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    DATABASE_STEP,
    { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
  ],
  transitions: [],
});
const VALUES = {
  'name-first': 'Bob',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'address-street-1': '123 Main Street',
  'address-city': 'Springfield',
  'address-postal-code': '62704',
  'address-country-code': 'US',
};

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

/** A submitted database verification of a pending inquiry, with its entered values. */
async function submitted(
  options: {
    referenceId?: string;
    fields?: Record<string, string>;
    /** C149.4 (Workflow 9B): the fields kept as set at creation (`POST /inquiries`). */
    initialFields?: Record<string, string>;
    config?: VerificationTemplateConfig;
    values?: Record<string, string>;
  } = {},
) {
  const created = await createTestInquiry(db, environmentId, {
    flow: FLOW,
    verificationConfig: { database: options.config ?? defaultTemplateConfig('database') },
    ...(options.referenceId === undefined ? {} : { referenceId: options.referenceId }),
    ...(options.fields === undefined ? {} : { fields: options.fields }),
  });
  const inquiry =
    options.initialFields === undefined
      ? created.inquiry
      : await createInquiry(db, environmentId, {
          id: newId('inq'),
          inquiryTemplateId: created.template.id,
          inquiryTemplateVersionId: created.template.latestVersion.id,
          accountId: created.inquiry.accountId,
          ...(options.fields === undefined ? {} : { fields: options.fields }),
          initialFields: options.initialFields,
        });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId: inquiry.id, type: 'database' });
  await seedVerificationInputs(db, environmentId, {
    verificationId: id,
    inquiryId: inquiry.id,
    values: options.values ?? VALUES,
  });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return { inquiryId: inquiry.id, id };
}

/** A sandbox provider that records what it was asked. */
function recordingSandbox() {
  const sandbox = createSandboxDatabaseProvider();
  const asked: { request: DatabaseLookupRequest; context: SandboxDatabaseContext }[] = [];
  const provider: SandboxDatabaseProvider = {
    ...sandbox,
    lookup: (request, context) => {
      asked.push({ request, context });
      return sandbox.lookup(request, context);
    },
  };
  return { provider, asked };
}

function setup(bound?: DatabaseProvider | SandboxDatabaseProvider) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  const providers: ProviderBindings = {
    sandbox: bound === undefined ? {} : { database: bound },
    production: {},
  };
  const deps: ProcessVerificationDeps = {
    db,
    storage: createMemoryStorage(),
    keyring: database.keyring,
    vision: createFakeVision().client,
    events,
    clock: { now: () => NOW },
    logger,
    providers,
  };
  return { deps, logger };
}

const job = (verificationId: string) => ({ environmentId, verificationId });

async function checksOf(id: string) {
  const checks = (await getVerification(db, environmentId, id))?.checks ?? [];
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

describe('processVerification: database (C59)', () => {
  it('passes an identity the sandbox echoes, labelled sandbox, and completes the inquiry', async () => {
    const { inquiryId, id } = await submitted();
    const { provider } = recordingSandbox();

    const result = await processVerification(job(id), setup(provider).deps);

    expect(result).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'completed',
    });
    const checks = await checksOf(id);
    expect(checks.database_identity_comparison).toMatchObject({
      status: 'passed',
      requirement: 'required',
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('completed');
  });

  it('asks about the country and the collected fields only, with the reference id for the sandbox', async () => {
    const { id } = await submitted({ referenceId: 'customer-7' });
    const { provider, asked } = recordingSandbox();

    await processVerification(job(id), setup(provider).deps);

    expect(asked).toEqual([
      { request: { country: 'US', fields: VALUES }, context: { referenceId: 'customer-7' } },
    ]);
  });

  it('gives a real provider the request alone', async () => {
    const { id } = await submitted({ referenceId: 'customer-8' });
    const calls: unknown[][] = [];
    const real: DatabaseProvider = {
      id: 'registry',
      sandbox: false,
      lookup: (...args: unknown[]): Promise<DatabaseLookupResult> => {
        calls.push(args);
        return Promise.resolve({ outcome: 'not_found', authoritative: true });
      },
    };

    await processVerification(job(id), setup(real).deps);

    expect(calls).toEqual([[{ country: 'US', fields: VALUES }]]);
    expect((await checksOf(id)).database_identity_comparison).toMatchObject({
      status: 'failed',
      reasons: ['record_not_found'],
      provenance: { provider: { id: 'registry', sandbox: false } },
    });
  });

  it('fails another surname as low_confidence_match, and the inquiry with it', async () => {
    const { inquiryId, id } = await submitted({ referenceId: 'sandbox-database-name-mismatch' });

    const result = await processVerification(job(id), setup(createSandboxDatabaseProvider()).deps);

    expect(result).toMatchObject({ verificationStatus: 'failed', inquiryStatus: 'failed' });
    expect((await checksOf(id)).database_identity_comparison).toMatchObject({
      status: 'failed',
      reasons: ['low_confidence_match'],
    });
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('failed');
  });

  it('sends a thin file to review as insufficient_data', async () => {
    const { id } = await submitted({ referenceId: 'sandbox-database-no-birthdate' });

    const result = await processVerification(job(id), setup(createSandboxDatabaseProvider()).deps);

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(id)).database_identity_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['insufficient_data'],
    });
  });

  it('answers provider_not_configured without a bound provider, which goes to review', async () => {
    const { id } = await submitted();

    const result = await processVerification(job(id), setup().deps);

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(id)).database_identity_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
  });

  it('retries a failed provider, then records execution_error on the last attempt', async () => {
    const { id } = await submitted();
    const failing: SandboxDatabaseProvider = {
      id: 'sandbox',
      sandbox: true,
      lookup: () => Promise.reject(new ProviderError('down', { retryable: true })),
    };
    const { deps, logger } = setup(failing);

    await expect(processVerification(job(id), deps)).rejects.toBeInstanceOf(ProviderError);
    expect((await getVerification(db, environmentId, id))?.status).toBe('submitted');

    const result = await processVerification(job(id), deps, { lastAttempt: true });

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(id)).database_identity_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
    expect(JSON.stringify(logger.entries)).not.toContain('Testerton');
  });

  it('asks no provider when no enabled check needs one', async () => {
    const config = defaultTemplateConfig('database');
    const { id } = await submitted({
      config: {
        ...config,
        checks: Object.fromEntries(
          Object.keys(config.checks).map((name) => [
            name,
            name === 'database_po_box_detection'
              ? { enabled: true, required: true }
              : { enabled: false, required: false },
          ]),
        ),
      },
    });
    const { provider, asked } = recordingSandbox();

    const result = await processVerification(job(id), setup(provider).deps);

    expect(asked).toEqual([]);
    expect(result).toMatchObject({ verificationStatus: 'passed' });
  });

  it('compares the values with the inquiry fields it was created with', async () => {
    const { id } = await submitted({
      fields: { name_first: 'Bob', name_last: 'Testerton', birthdate: '1990-05-17' },
    });
    const mismatched = await submitted({
      fields: { name_first: 'Bob', name_last: 'Quillfeather' },
    });
    const provider = createSandboxDatabaseProvider();

    await processVerification(job(id), setup(provider).deps);
    await processVerification(job(mismatched.id), setup(provider).deps);

    expect((await checksOf(id)).database_inquiry_comparison).toMatchObject({ status: 'passed' });
    expect((await checksOf(mismatched.id)).database_inquiry_comparison).toMatchObject({
      status: 'failed',
      reasons: ['inquiry_field_mismatch'],
    });
  });

  it('records which compared fields were set at creation and which were entered later (C149.4)', async () => {
    // B47 (Workflow 9B, api-flow-carry): the birthdate came with POST /inquiries, the name later.
    const { id } = await submitted({
      fields: { name_first: 'Bob', name_last: 'Testerton', birthdate: '1990-05-17' },
      initialFields: { birthdate: '1990-05-17' },
    });

    await processVerification(job(id), setup(createSandboxDatabaseProvider()).deps);

    expect((await checksOf(id)).database_inquiry_comparison).toMatchObject({
      status: 'passed',
      metadata: { 'comparison-source': { name: 'entered', birthdate: 'initial' } },
    });
  });

  it('puts no entered value in a check result or a log', async () => {
    const { id } = await submitted({ referenceId: 'sandbox-database-address-mismatch' });
    const { deps, logger } = setup(createSandboxDatabaseProvider());

    await processVerification(job(id), deps);

    const stored = JSON.stringify(await checksOf(id));
    for (const value of Object.values(VALUES).filter((value) => value.length > 2)) {
      expect(stored).not.toContain(value);
      expect(JSON.stringify(logger.entries)).not.toContain(value);
    }
  });

  it('fails a verification whose processing cannot finish, writing nothing of its own', async () => {
    const { inquiryId, id } = await submitted();

    expect(await failVerificationAfterError(job(id), setup().deps, 'invalid_template')).toEqual({
      outcome: 'failed',
      inquiryStatus: 'failed',
    });
    expect((await getVerification(db, environmentId, id))?.status).toBe('failed');
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('failed');
  });
});
