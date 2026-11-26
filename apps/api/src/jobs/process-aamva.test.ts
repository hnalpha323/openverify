/**
 * The `aamva` job (C59.4, C59.5, C50.7) through `processVerification`: the entered or copied
 * values go to the bound AAMVA DLDV provider (the card's jurisdiction and the values, nothing
 * else), and the C59 evaluators judge its verdict. A jurisdiction outside DLDV moves the
 * verification `submitted -> skipped` (`verification.skipped`) for the silent source, or for the
 * form when the template says `on-jurisdiction-not-participating: skip`; otherwise it is review.
 * The sandbox endings (`0000`, `0001`, `0002`, `5555`, `9999`) reach each outcome. No result or
 * log carries a value. Every value is synthetic.
 */
import { eventPayloadSchema, newId } from '@openverify/contracts';
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';
import {
  createVerification,
  getInquiry,
  getVerification,
  listEvents,
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
import { flowSchema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type { AamvaLookupProvider, AamvaLookupRequest, ProviderBindings } from '../ports.js';
import { ProviderError } from '../providers/errors.js';
import { createSandboxAamvaProvider } from '../providers/sandbox.js';
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

const flowOf = (source: 'form' | 'government_id') =>
  flowSchema.parse({
    metadata: { specVersion: 1, id: 'aamva-only', version: 1, name: 'AAMVA' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
      { id: 'aamva', type: 'aamva', source },
      { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
    ],
    transitions: [],
  });

const VALUES = {
  'name-first': 'Avery',
  'name-last': 'Example',
  birthdate: '1990-04-12',
  'identification-number': 'D1234567',
  'issuing-authority': 'CA',
  'expiration-date': '2030-04-12',
  'address-postal-code': '90001',
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

/** A submitted AAMVA verification of a pending inquiry with the form or the silent step. */
async function submitted(
  number: string,
  options: { source?: 'form' | 'government_id'; config?: VerificationTemplateConfig } = {},
) {
  const source = options.source ?? 'form';
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: flowOf(source),
    verificationConfig: { aamva: options.config ?? defaultTemplateConfig('aamva') },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  let sourceVerificationId: string | undefined;
  if (source === 'government_id') {
    sourceVerificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: sourceVerificationId,
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    // The decided ID the silent attempt is bound to (C50.5).
    await setVerificationStatus(db, environmentId, sourceVerificationId, { to: 'submitted' });
    await setVerificationStatus(db, environmentId, sourceVerificationId, { to: 'passed' });
  }
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId: inquiry.id, type: 'aamva' });
  await seedVerificationInputs(db, environmentId, {
    verificationId: id,
    inquiryId: inquiry.id,
    values: { ...VALUES, 'identification-number': number },
    ...(sourceVerificationId === undefined
      ? {}
      : { source: 'government_id' as const, sourceVerificationId }),
  });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return { inquiryId: inquiry.id, id };
}

function setup(aamva?: AamvaLookupProvider) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  const providers: ProviderBindings = {
    sandbox: aamva === undefined ? {} : { aamva },
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

async function eventNames(resourceId: string): Promise<string[]> {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items
    .filter((event) => eventPayloadSchema.parse(event.payload).data.id === resourceId)
    .reverse()
    .map((event) => event.name);
}

const sandbox = () => setup(createSandboxAamvaProvider());

describe('processVerification: AAMVA (C59.4, C59.5)', () => {
  it('passes a record the sandbox matches, labelled sandbox, and completes the inquiry', async () => {
    const { inquiryId, id } = await submitted('D1234567');

    expect(await processVerification(job(id), sandbox().deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'completed',
    });
    expect((await checksOf(id)).aamva_identity_comparison).toMatchObject({
      status: 'passed',
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('completed');
  });

  it('asks the provider about the jurisdiction and the values alone', async () => {
    const { id } = await submitted('D1234567');
    const asked: unknown[][] = [];
    const sandboxProvider = createSandboxAamvaProvider();
    const recording: AamvaLookupProvider = {
      ...sandboxProvider,
      lookup: (...args: [AamvaLookupRequest]) => {
        asked.push(args);
        return sandboxProvider.lookup(...args);
      },
    };

    await processVerification(job(id), setup(recording).deps);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toHaveLength(1);
    expect(asked[0]?.[0]).toMatchObject({
      jurisdiction: 'CA',
      fields: {
        'name-first': 'Avery',
        'name-last': 'Example',
        birthdate: '1990-04-12',
        'identification-number': 'D1234567',
        'expiration-date': '2030-04-12',
        'address-postal-code': '90001',
      },
    });
  });

  it.each([
    ['D1230000', 'failed', ['record_mismatch'], 'failed', ['name_mismatch'], 'passed', []],
    ['D1230001', 'failed', ['record_mismatch'], 'failed', ['name_mismatch'], 'passed', []],
    ['D1230002', 'failed', ['record_mismatch'], 'passed', [], 'passed', []],
    [
      'D1239999',
      'failed',
      ['record_not_found'],
      'failed',
      ['record_not_found'],
      'failed',
      ['record_not_found'],
    ],
  ] as const)(
    'judges the sandbox ending of %s: identity %s %j, name %s %j, number %s %j',
    async (number, identity, identityReasons, name, nameReasons, idNumber, idNumberReasons) => {
      const { id } = await submitted(number);

      const result = await processVerification(job(id), sandbox().deps);

      expect(result).toMatchObject({ verificationStatus: 'failed', inquiryStatus: 'failed' });
      const checks = await checksOf(id);
      expect(checks.aamva_identity_comparison).toMatchObject({
        status: identity,
        reasons: identityReasons,
      });
      expect(checks.aamva_name_comparison).toMatchObject({ status: name, reasons: nameReasons });
      expect(checks.aamva_identification_number_comparison).toMatchObject({
        status: idNumber,
        reasons: idNumberReasons,
      });
    },
  );

  it('passes a postal code mismatch the template ignores', async () => {
    const config = defaultTemplateConfig('aamva');
    const { id } = await submitted('D1230002', {
      config: {
        ...config,
        checks: {
          ...config.checks,
          aamva_identity_comparison: {
            enabled: true,
            required: true,
            config: { 'ignored-fields': ['address-postal-code'] },
          },
        },
      },
    });

    expect(await processVerification(job(id), sandbox().deps)).toMatchObject({
      verificationStatus: 'passed',
    });
  });

  it('sends a form outside DLDV to review by default', async () => {
    const { id } = await submitted('D1235555');

    const result = await processVerification(job(id), sandbox().deps);

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(id)).aamva_identity_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['jurisdiction_not_participating'],
    });
  });

  it('skips a form outside DLDV when the template says so, and the inquiry completes', async () => {
    const config = defaultTemplateConfig('aamva');
    const { inquiryId, id } = await submitted('D1235555', {
      config: {
        ...config,
        checks: {
          ...config.checks,
          aamva_identity_comparison: {
            enabled: true,
            required: true,
            config: { 'on-jurisdiction-not-participating': 'skip' },
          },
        },
      },
    });

    const result = await processVerification(job(id), sandbox().deps);

    expect(result).toMatchObject({ inquiryStatus: 'completed' });
    expect((await getVerification(db, environmentId, id))?.status).toBe('skipped');
    expect((await checksOf(id)).aamva_identity_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['jurisdiction_not_participating'],
      requirement: 'required',
    });
    expect(await eventNames(id)).toEqual(['verification.skipped']);
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('completed');
  });

  it('always skips the silent step outside DLDV (C59.6)', async () => {
    const { inquiryId, id } = await submitted('D1235555', { source: 'government_id' });

    await processVerification(job(id), sandbox().deps);

    expect((await getVerification(db, environmentId, id))?.status).toBe('skipped');
    expect(await eventNames(id)).toEqual(['verification.skipped']);
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('completed');
  });

  it('answers provider_not_configured without a bound provider, which goes to review', async () => {
    const { id } = await submitted('D1234567');

    expect(await processVerification(job(id), setup().deps)).toMatchObject({
      verificationStatus: 'needs_review',
    });
    expect((await checksOf(id)).aamva_identity_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
  });

  it('retries a failed provider, then records execution_error on the last attempt', async () => {
    const { id } = await submitted('D1234567');
    const failing: AamvaLookupProvider = {
      id: 'sandbox',
      sandbox: true,
      lookup: () => Promise.reject(new ProviderError('down', { retryable: true })),
    };
    const { deps } = setup(failing);

    await expect(processVerification(job(id), deps)).rejects.toBeInstanceOf(ProviderError);
    expect(await processVerification(job(id), deps, { lastAttempt: true })).toMatchObject({
      verificationStatus: 'needs_review',
    });
    expect((await checksOf(id)).aamva_identity_comparison).toMatchObject({
      reasons: ['execution_error'],
    });
  });

  it('puts no value in a check result or a log', async () => {
    const { id } = await submitted('D1230001');
    const { deps, logger } = sandbox();

    await processVerification(job(id), deps);

    const stored = JSON.stringify(await checksOf(id));
    for (const value of [...Object.values(VALUES), 'D1230001'].filter((v) => v.length > 2)) {
      expect(stored).not.toContain(value);
      expect(JSON.stringify(logger.entries)).not.toContain(value);
    }
  });

  it('fails a form whose processing cannot finish, and the inquiry with it', async () => {
    const { inquiryId, id } = await submitted('D1234567');

    expect(await failVerificationAfterError(job(id), sandbox().deps, 'invalid_template')).toEqual({
      outcome: 'failed',
      inquiryStatus: 'failed',
    });
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('failed');
  });
});
