/**
 * The `database_business` job (C61.1, C61.7) through `processVerification`: the entered business
 * goes to the bound registers in the C61.1 order of asking (the national ones first, then GLEIF),
 * stopping at the first record found, and the C61.7 evaluators judge the answers. A register
 * receives the business only (never the reference id or a person); an unbound register is
 * `provider_not_configured`, a failing one is retried, then `execution_error`. The record found
 * is sealed to the verification in the decision transaction; no result carries an entered value
 * or a person. Every value is synthetic; the sandbox register answers by its documented endings.
 */
import { newId } from '@openverify/contracts';
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';
import {
  createVerification,
  getBusinessRegistryRecord,
  getVerification,
  openBusinessRegistryRecord,
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
import { createEventPublisher } from '../../events/index.js';
import type {
  BusinessRegistryLookupResult,
  BusinessRegistryProvider,
  BusinessRegistryRequest,
  BusinessRegistrySource,
  ProviderBindings,
} from '../../ports.js';
import { createSandboxBusinessRegistryProvider } from '../../providers/business-registry/index.js';
import { ProviderError } from '../../providers/errors.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from '../process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from '../testing.js';
import { databaseBusinessJob } from './database-business.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');

const flowOf = (collectAssociatedPersons: boolean) =>
  flowSchema.parse({
    metadata: { specVersion: 1, id: 'kyb-registry', version: 1, name: 'Business registry' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
      { id: 'business', type: 'database_business', collectAssociatedPersons },
      { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
    ],
    transitions: [],
  });

const VALUES = {
  'business-name': 'Utopia Synthetic Widgets Ltd',
  'country-code': 'GB',
  'registration-number': '01234567',
  'address-street-1': '1 Placeholder Row',
  'address-city': 'Utopia Town',
  'address-postal-code': 'UT1 0ZZ',
};

const SANDBOX_OFFICER = { 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' };

let database: TestDatabase;
let db: Db;
/** A sandbox environment (the sandbox register) and a production one (the real registers). */
let sandboxEnvironment: string;
let productionEnvironment: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  sandboxEnvironment = (await createTestTenant(db)).environment.id;
  productionEnvironment = (await createTestTenant(db, { kind: 'production' })).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** A submitted business verification of a pending inquiry, with its entered values. */
async function submitted(
  options: {
    values?: Record<string, unknown> | null;
    config?: VerificationTemplateConfig;
    collectAssociatedPersons?: boolean;
    referenceId?: string;
    production?: boolean;
  } = {},
) {
  const environmentId = options.production === true ? productionEnvironment : sandboxEnvironment;
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: flowOf(options.collectAssociatedPersons ?? false),
    verificationConfig: {
      'database-business': options.config ?? defaultTemplateConfig('database_business'),
    },
    ...(options.referenceId === undefined ? {} : { referenceId: options.referenceId }),
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const id = newId('ver');
  await createVerification(db, environmentId, {
    id,
    inquiryId: inquiry.id,
    type: 'database_business',
  });
  if (options.values !== null) {
    await seedVerificationInputs(db, environmentId, {
      verificationId: id,
      inquiryId: inquiry.id,
      values: options.values ?? VALUES,
    });
  }
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return { inquiryId: inquiry.id, id, environmentId };
}

/** A real register that answers `answer` (or throws it), recording what it was asked. */
function recordingRegister(
  source: BusinessRegistrySource,
  answer: BusinessRegistryLookupResult | Error,
) {
  const asked: unknown[][] = [];
  const register: BusinessRegistryProvider = {
    id: source,
    sandbox: false,
    source,
    lookup: (...args: unknown[]) => {
      asked.push(args);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { register, asked };
}

function setup(
  sandbox?: ProviderBindings['sandbox']['businessRegistry'],
  production?: ProviderBindings['production']['businessRegistry'],
) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  const deps: ProcessVerificationDeps = {
    db,
    storage: createMemoryStorage(),
    keyring: database.keyring,
    vision: createFakeVision().client,
    events,
    clock: { now: () => NOW },
    logger,
    providers: {
      sandbox: sandbox === undefined ? {} : { businessRegistry: sandbox },
      production: production === undefined ? {} : { businessRegistry: production },
    },
  };
  return { deps, logger };
}

const job = ({ id, environmentId }: { id: string; environmentId: string }) => ({
  environmentId,
  verificationId: id,
});

async function checksOf({ id, environmentId }: { id: string; environmentId: string }) {
  const checks = (await getVerification(db, environmentId, id))?.checks ?? [];
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

const FOUND: Extract<BusinessRegistryLookupResult, { outcome: 'found' }> = {
  outcome: 'found',
  authoritative: true,
  personsAvailable: true,
  record: {
    source: 'companies-house',
    recordId: '01234567',
    legalName: 'UTOPIA SYNTHETIC WIDGETS LIMITED',
    otherNames: [],
    status: 'active',
    statusDetail: null,
    registeredAddress: {
      lines: ['1 Placeholder Row'],
      city: 'Utopia Town',
      region: null,
      postalCode: 'UT1 0ZZ',
      country: 'GB',
    },
    jurisdiction: 'england-wales',
    registrationNumber: '01234567',
    persons: [{ name: 'PLACEHOLDER, Ada', birthMonth: '1980-04', role: 'officer', active: true }],
  },
};

describe('processVerification: database_business (C61)', () => {
  it('is built and runnable', () => {
    expect(databaseBusinessJob).toMatchObject({ type: 'database_business', runnable: true });
  });

  it('passes a business the sandbox register echoes, labelled sandbox, and completes the inquiry', async () => {
    const target = await submitted();

    const result = await processVerification(
      job(target),
      setup(createSandboxBusinessRegistryProvider()).deps,
    );

    expect(result).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'completed',
    });
    const checks = await checksOf(target);
    expect(checks.database_business_identity_comparison).toMatchObject({
      status: 'passed',
      requirement: 'required',
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect(checks.database_business_active_business_detection).toMatchObject({ status: 'passed' });
    expect(checks.database_business_service_available_detection).toMatchObject({
      status: 'passed',
    });
    expect(checks.database_business_enabled_country_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_allowlist'],
    });
    expect(checks.database_business_associated_persons_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['not_requested'],
    });
  });

  it.each([
    ['12340000', 'failed', 'database_business_identity_comparison', 'low_confidence_match'],
    [
      '12349999',
      'needs_review',
      'database_business_identity_comparison',
      'registration_number_not_found',
    ],
    ['12348888', 'failed', 'database_business_active_business_detection', 'business_inactive'],
  ] as const)(
    'answers the sandbox ending of %s: %s (%s %s)',
    async (number, status, check, reason) => {
      const target = await submitted({ values: { ...VALUES, 'registration-number': number } });

      const result = await processVerification(
        job(target),
        setup(createSandboxBusinessRegistryProvider()).deps,
      );

      expect(result).toMatchObject({ verificationStatus: status });
      expect((await checksOf(target))[check]).toMatchObject({ reasons: [reason] });
    },
  );

  it('compares associated persons with the register’s officers when the step collects them', async () => {
    const target = await submitted({
      collectAssociatedPersons: true,
      values: { ...VALUES, 'associated-persons': [SANDBOX_OFFICER] },
    });
    const sandbox = createSandboxBusinessRegistryProvider();

    await processVerification(job(target), setup(sandbox).deps);
    const otherTarget = await submitted({
      collectAssociatedPersons: true,
      values: {
        ...VALUES,
        'registration-number': '12347777',
        'associated-persons': [SANDBOX_OFFICER],
      },
    });
    const result = await processVerification(job(otherTarget), setup(sandbox).deps);

    expect((await checksOf(target)).database_business_associated_persons_comparison).toMatchObject({
      status: 'passed',
    });
    // Advisory by default: a person not on the register goes on the checks, not the decision.
    expect(result).toMatchObject({ verificationStatus: 'passed' });
    expect(
      (await checksOf(otherTarget)).database_business_associated_persons_comparison,
    ).toMatchObject({ status: 'failed', reasons: ['associated_person_not_on_register'] });
  });

  it('asks the national registers first, then GLEIF, stopping at the first record found', async () => {
    const target = await submitted({ referenceId: 'customer-kyb-1', production: true });
    const gleif = recordingRegister('gleif', { outcome: 'not_found', authoritative: false });
    const house = recordingRegister('companies-house', FOUND);
    const edgar = recordingRegister('sec-edgar', { outcome: 'unsupported_country' });
    const { deps } = setup(undefined, [gleif.register, house.register, edgar.register]);

    await processVerification(job(target), deps);

    const request: BusinessRegistryRequest = {
      country: 'GB',
      businessName: 'Utopia Synthetic Widgets Ltd',
      registrationNumber: '01234567',
      address: { street1: '1 Placeholder Row', city: 'Utopia Town', postalCode: 'UT1 0ZZ' },
    };
    expect(house.asked).toEqual([[request]]);
    expect(edgar.asked).toEqual([]);
    expect(gleif.asked).toEqual([]);
  });

  // Workflow 5C review K6: officers and persons with significant control are personal data, read
  // only when the step collects associated persons and their check runs.
  it('asks a register for persons only when the step collects them and their check runs', async () => {
    const persons = { ...VALUES, 'associated-persons': [SANDBOX_OFFICER] };
    const collecting = await submitted({
      production: true,
      collectAssociatedPersons: true,
      values: persons,
    });
    const disabled = await submitted({
      production: true,
      collectAssociatedPersons: true,
      values: persons,
      config: {
        checks: {
          ...defaultTemplateConfig('database_business').checks,
          database_business_associated_persons_comparison: { enabled: false, required: false },
        },
      },
    });
    const notCollecting = await submitted({ production: true });
    const house = recordingRegister('companies-house', FOUND);
    const { deps } = setup(undefined, [house.register]);

    for (const target of [collecting, disabled, notCollecting]) {
      await processVerification(job(target), deps);
    }

    expect(
      house.asked.map(([request]) => (request as BusinessRegistryRequest).withPersons),
    ).toEqual([true, undefined, undefined]);
    expect(
      (await checksOf(collecting)).database_business_associated_persons_comparison,
    ).toMatchObject({ status: 'passed' });
  });

  it('goes on to GLEIF when the national register does not hold the business', async () => {
    const target = await submitted({ production: true });
    const gleif = recordingRegister('gleif', {
      ...FOUND,
      authoritative: false,
      personsAvailable: false,
      record: {
        ...FOUND.record,
        source: 'gleif',
        recordId: '5493001KJTIIGC8Y1R12',
        status: 'ISSUED',
        statusDetail: 'ACTIVE',
      },
    });
    const house = recordingRegister('companies-house', {
      outcome: 'not_found',
      authoritative: false,
    });

    await processVerification(job(target), setup(undefined, [gleif.register, house.register]).deps);

    expect(house.asked).toHaveLength(1);
    expect(gleif.asked).toHaveLength(1);
    expect((await checksOf(target)).database_business_identity_comparison).toMatchObject({
      provenance: { provider: { id: 'gleif', sandbox: false } },
    });
  });

  it('seals the record found to the verification, never its persons', async () => {
    const target = await submitted();

    await processVerification(job(target), setup(createSandboxBusinessRegistryProvider()).deps);

    expect(await getBusinessRegistryRecord(db, target.environmentId, target.id)).toMatchObject({
      source: 'sandbox',
      fetchedAt: NOW,
    });
    expect(await openBusinessRegistryRecord(db, target.environmentId, target.id)).toEqual({
      recordId: '01234567',
      legalName: 'Utopia Synthetic Widgets Ltd',
      status: 'active',
      jurisdiction: 'GB',
      registeredAddress: '1 Placeholder Row, Utopia Town, UT1 0ZZ, GB',
    });
    expect(
      JSON.stringify(await openBusinessRegistryRecord(db, target.environmentId, target.id)),
    ).not.toContain('PLACEHOLDER');
  });

  it('writes no record when no register found the business', async () => {
    const target = await submitted({ values: { ...VALUES, 'registration-number': '12349999' } });

    await processVerification(job(target), setup(createSandboxBusinessRegistryProvider()).deps);

    expect(await getBusinessRegistryRecord(db, target.environmentId, target.id)).toBeNull();
  });

  it('answers provider_not_configured without a bound register, which goes to review', async () => {
    const target = await submitted();

    const result = await processVerification(job(target), setup().deps);

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(target)).database_business_service_available_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
  });

  it('retries a register that failed while attempts remain, then records execution_error', async () => {
    const target = await submitted({ production: true });
    const failing = recordingRegister(
      'companies-house',
      new ProviderError('companies-house: the register answered 503', {
        retryable: true,
        code: 'companies_house_unavailable',
      }),
    );
    const { deps, logger } = setup(undefined, [failing.register]);

    await expect(processVerification(job(target), deps)).rejects.toThrow(ProviderError);
    expect((await getVerification(db, target.environmentId, target.id))?.status).toBe('submitted');

    const result = await processVerification(job(target), deps, { lastAttempt: true });
    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(target)).database_business_identity_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
    expect(JSON.stringify(logger.entries)).not.toContain('Utopia');
  });

  it('asks no register when no enabled check reads one, and none without entered values', async () => {
    const config: VerificationTemplateConfig = {
      checks: { database_business_enabled_country_detection: { enabled: true, required: true } },
      'allowed-countries': ['GB'],
    };
    const target = await submitted({ config, production: true });
    const house = recordingRegister('companies-house', FOUND);
    await processVerification(job(target), setup(undefined, [house.register]).deps);

    const emptyTarget = await submitted({ values: null, production: true });
    await processVerification(job(emptyTarget), setup(undefined, [house.register]).deps);

    expect(house.asked).toEqual([]);
    expect((await checksOf(target)).database_business_enabled_country_detection).toMatchObject({
      status: 'passed',
    });
    expect((await checksOf(emptyTarget)).database_business_identity_comparison).toMatchObject({
      reasons: ['input_missing'],
    });
  });

  it('keeps entered values and register persons out of every result', async () => {
    const target = await submitted({
      collectAssociatedPersons: true,
      values: { ...VALUES, 'associated-persons': [SANDBOX_OFFICER] },
    });

    await processVerification(job(target), setup(createSandboxBusinessRegistryProvider()).deps);

    const text = JSON.stringify(await checksOf(target));
    for (const value of ['Utopia', 'Placeholder', 'PLACEHOLDER', '1980-04', 'Testerton']) {
      expect(text).not.toContain(value);
    }
  });
});
