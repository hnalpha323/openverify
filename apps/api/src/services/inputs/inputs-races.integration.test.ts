/**
 * C53.6, C40.6 against Postgres 17 row locks (Testcontainers), for the inputs writer (C52.3): it
 * writes in one transaction that locks the inquiry (its `redacted_at` and status re-checked), then
 * the verification (re-checked `initiated`), then upserts `verification_inputs`. Each test holds
 * the competing writer's locks in a transaction of its own connection, as a concurrent request,
 * job or redaction would:
 * - entered values wait for a redaction, then are refused (410) and nothing is stored;
 * - a redaction waits for the writer's transaction, then nulls what it stored;
 * - entered values wait for a submit, or for the inquiry's expiry, then are refused (409);
 * - two bodies at once both commit, one after the other, and the last one stays.
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import {
  createDatabase,
  createEnvironment,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createKeyring,
  createOrganization,
  createVerification,
  getVerificationInputs,
  hashSessionToken,
  lockInquiry,
  lockVerification,
  putEnteredVerificationInputs,
  recordInquirySessionConsent,
  redactInquiryRecords,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  transitionInquiryStatus,
  type Database,
  type Db,
} from '@openverify/db';
import { createIntegrationPool, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowSession } from '../../auth/flow-session.js';
import { ConflictError, RedactedError } from '../../errors.js';
import { ulidIdGenerator } from '../../ports.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../../test-support/fakes.js';
import { createAccountsService } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { requireFlowVerificationUnderLock } from '../flow-preconditions.js';
import { enterVerificationInputs } from './index.js';

const keyring = createKeyring(randomBytes(32));
/** Long enough for a service that takes no lock to finish first. */
const WAIT_MS = 1_500;
const VALUES = {
  'name-first': 'Synthia',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'address-street-1': '123 Main Street',
  'address-country-code': 'US',
};

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let environmentId: string;
let templateId: string;
let versionId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  const clock = fixedClock(new Date());
  const events = createRecordingEventPublisher();
  deps = {
    db,
    keyring,
    storage: createInMemoryFileStorage(),
    events,
    queue: createRecordingQueue(),
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.test',
    flowCorsOrigins: ['https://flow.example.test'],
    accounts: createAccountsService({ events }),
    redaction: createRecordingRedactionService(clock),
    audit: createRecordingAuditLogger(),
    rateLimiter: createAllowAllRateLimiter(clock),
    mailer: createCapturingMailer(),
    ...phase5TestDependencies(clock),
  };
  const organization = await createOrganization(db, { id: newId('org'), name: 'Inputs races' });
  environmentId = (
    await createEnvironment(db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    })
  ).id;
  const attributes = defaultInquiryTemplateAttributes();
  const completion = attributes.flow.steps.findIndex((step) => step.type === 'completion');
  attributes.flow.steps.splice(completion, 0, {
    id: 'database',
    type: 'database',
    fields: ['name_first', 'name_last', 'birthdate', 'address_street_1', 'address_country_code'],
  });
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Inputs races',
    version: {
      id: newId('itmplv'),
      flow: attributes.flow,
      verificationConfig: {
        ...attributes['verification-config'],
        database: defaultTemplateConfig('database'),
      },
    },
  });
  templateId = template.id;
  versionId = template.currentVersion.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

interface Target {
  session: FlowSession;
  verificationId: string;
}

/** A pending inquiry whose session consented, with a database verification. */
async function consentedDatabase(): Promise<Target> {
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'database',
  });
  return { session: { id: session.id, environmentId, inquiryId: inquiry.id }, verificationId };
}

const enter = (target: Target, values: Record<string, string> = VALUES) =>
  enterVerificationInputs(deps, target.session, target.verificationId, values);

const stored = async (target: Target) =>
  getVerificationInputs(db, environmentId, target.verificationId);

/**
 * Runs `held` in a transaction of its own connection (the competing writer, holding its locks)
 * and keeps it open while `service` starts, then commits. Resolves with whether `service` waited
 * for the commit, and its outcome (a value or the error it threw).
 */
async function whileHeld(
  held: (tx: Db) => Promise<void>,
  service: () => Promise<unknown>,
): Promise<{ waited: boolean; outcome: unknown }> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const holding = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await held(tx);
    ready();
    await gate;
  });
  await holding;
  let settled = false;
  const running = service().then(
    (value: unknown) => value,
    (error: unknown) => error,
  );
  void running.then(() => {
    settled = true;
  });
  await Promise.race([running, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  const waited = !settled;
  release();
  await holder;
  return { waited, outcome: await running };
}

describe('C53.6, C40.6: the inputs writer and a redaction', () => {
  it('entered values wait for the redaction, then are refused (410) and nothing is stored', async () => {
    const target = await consentedDatabase();

    const { waited, outcome } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, target.session.inquiryId);
        await tx.execute(
          sql`update inquiries set redacted_at = now() where id = ${target.session.inquiryId}`,
        );
      },
      () => enter(target),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await stored(target)).toBeNull();
  });

  it('a redaction waits for the writer, then nulls the values it stored', async () => {
    const target = await consentedDatabase();

    // The writer's transaction, as the service runs it: the locks, then the upsert.
    const { waited } = await whileHeld(
      async (tx) => {
        await requireFlowVerificationUnderLock(tx, target.session, target.verificationId);
        await putEnteredVerificationInputs(tx, environmentId, {
          verificationId: target.verificationId,
          inquiryId: target.session.inquiryId,
          values: VALUES,
          at: new Date(),
        });
      },
      () => redactInquiryRecords(db, environmentId, target.session.inquiryId),
    );

    expect(waited).toBe(true);
    expect(await stored(target)).toMatchObject({ values: null, fieldNames: Object.keys(VALUES) });
    expect((await stored(target))?.redactedAt).not.toBeNull();
  });
});

describe('C40.6: the inputs writer and the verification moving on', () => {
  it('entered values wait for a submit, then are refused (409) and nothing is stored', async () => {
    const target = await consentedDatabase();

    const { waited, outcome } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, target.session.inquiryId);
        await lockVerification(tx, environmentId, target.verificationId);
        await setVerificationStatus(tx, environmentId, target.verificationId, {
          from: 'initiated',
          to: 'submitted',
        });
      },
      () => enter(target),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect(await stored(target)).toBeNull();
  });

  it("entered values wait for the inquiry's expiry, then are refused (409)", async () => {
    const target = await consentedDatabase();

    const { waited, outcome } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, target.session.inquiryId);
        await transitionInquiryStatus(tx, environmentId, target.session.inquiryId, {
          from: 'pending',
          to: 'expired',
        });
        await setVerificationStatus(tx, environmentId, target.verificationId, {
          from: 'initiated',
          to: 'canceled',
        });
      },
      () => enter(target),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect(await stored(target)).toBeNull();
  });

  it('two bodies at once both commit, one after the other, and the last one stays', async () => {
    const target = await consentedDatabase();
    const other = { ...VALUES, 'name-first': 'Synthea' };

    const outcomes = await Promise.allSettled([enter(target), enter(target, other)]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const values = (await stored(target))?.values;
    expect([VALUES, other]).toContainEqual(values);
  });
});
