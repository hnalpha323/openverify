/**
 * C101.3, C101.5, C101.6 (Workflow 7B, `api-graph`): the `graph-index` job and its sweep, the
 * `graph-backfill` tick, `graph:reindex` and the nightly `graph-components`, on PGlite.
 *
 * - The job opens what the inquiry holds (its fields, a government ID's C31.8 index and name, a
 *   confirmed OTP destination, its sessions' device HMACs under the current key) and writes the
 *   rows to the inquiry's account; a rejected handoff's verification is left out (C96.3); an
 *   inquiry redacted after its row was written, or `graph-indexing` off, ends the row `skipped`
 *   and writes nothing (owner decision 5 after Workflow 6C); failures count to `errored`.
 * - The sweep enqueues what is pending and ends a redacted inquiry's row `skipped`.
 * - The backfill indexes what predates an incomplete kind and marks it complete (H10).
 * - Components join accounts through strong kinds only, never a weak one.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { emptyExtractedFields } from '@openverify/core';
import {
  blindIndexKeyId,
  createAccount,
  createGovernmentIdExtraction,
  createGraphIndexJob,
  createVerification,
  getGraphComponent,
  getGraphIndexJob,
  identifierKey,
  listGraphIndexStates,
  markGraphKindsIncomplete,
  redactInquiryRecords,
  setVerificationStatus,
  updateEnvironmentSettings,
  type Db,
  type EnvironmentSettings,
  type Inquiry,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedDevice,
  seedGraphAttribute,
  seedOtpChallenge,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { newId } from '@openverify/contracts';
import { createInquirySession, hashSessionToken } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGraphReindex } from '../../services/graph/reindex.js';
import { createRecordingGraphIndexQueue, fixedClock } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { runGraphBackfill } from './backfill.js';
import { runGraphComponents } from './components.js';
import { GRAPH_INDEX_MAX_ATTEMPTS, processGraphIndex, type GraphIndexDeps } from './index-job.js';
import { runGraphIndexSweep } from './index-sweep.js';

let database: TestDatabase;
let db: Db;
const key = new Uint8Array(randomBytes(32));
const keyId = blindIndexKeyId(key);
const clock = fixedClock(new Date('2026-11-01T12:00:00.000Z'));

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const deps = (overrides: Partial<GraphIndexDeps> = {}): GraphIndexDeps => ({
  db,
  clock,
  logger: createCapturingLogger(),
  keyring: database.keyring,
  blindIndexKey: key,
  ...overrides,
});

interface Row extends Record<string, unknown> {
  kind: number;
  value_key: string;
  key_id: string;
  account_id: string;
  source_type: string;
  source_id: string;
}

async function rowsOf(environmentId: string): Promise<Row[]> {
  const result = await db.execute<Row>(sql`
      select kind, value_key, key_id, account_id, source_type, source_id
      from graph_attributes where environment_id = ${environmentId}
      order by kind, value_key, source_type, source_id`);
  return (result as { rows: Row[] }).rows;
}

async function environment(settings: EnvironmentSettings = {}): Promise<string> {
  const id = (await createTestTenant(db)).environment.id;
  await updateEnvironmentSettings(db, id, settings);
  return id;
}

async function completed(
  environmentId: string,
  fields: Record<string, unknown> = {},
): Promise<Inquiry> {
  const { inquiry } = await createTestInquiry(db, environmentId, { fields });
  await db.execute(sql`update inquiries set status = 'completed' where id = ${inquiry.id}`);
  await createGraphIndexJob(db, environmentId, {
    inquiryId: inquiry.id,
    triggerStatus: 'completed',
  });
  return { ...inquiry, status: 'completed' };
}

async function verification(
  environmentId: string,
  inquiryId: string,
  type: 'government_id' | 'email_address',
  status: 'passed' | 'failed',
) {
  const id = testId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, id, { to: status });
  return id;
}

async function governmentId(environmentId: string, inquiryId: string, index: string) {
  const id = await verification(environmentId, inquiryId, 'government_id', 'failed');
  await createGovernmentIdExtraction(db, environmentId, {
    verificationId: id,
    fields: {
      ...emptyExtractedFields(),
      'name-first': 'Ada',
      'name-last': 'Example',
      birthdate: '1990-01-02',
      'identification-number': 'X1234567',
    },
    fieldSources: {},
    identificationNumberIndex: index,
    frontPhash: null,
    idClassGroup: 'passport',
  });
  return id;
}

async function confirmedEmail(environmentId: string, inquiryId: string, email: string) {
  const id = await verification(environmentId, inquiryId, 'email_address', 'passed');
  await seedOtpChallenge(db, environmentId, {
    verificationId: id,
    inquiryId,
    channel: 'email',
    destination: email,
    status: 'confirmed',
    confirmedAt: clock.now(),
  });
  return id;
}

async function session(environmentId: string, inquiryId: string) {
  return createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId,
    tokenHash: hashSessionToken(`ovs_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(clock.now().getTime() + 3_600_000),
  });
}

const job = (inquiry: Inquiry) => ({
  environmentId: inquiry.environmentId,
  inquiryId: inquiry.id,
});

describe('the graph-index job (C101.3)', () => {
  it('writes what the inquiry holds to its account, keyed under the shared labels', async () => {
    const env = await environment();
    const inquiry = await completed(env, { email_address: 'typed@example.com' });
    const index = randomBytes(32).toString('hex');
    const idVerification = await governmentId(env, inquiry.id, index);
    const emailVerification = await confirmedEmail(env, inquiry.id, 'confirmed@example.com');
    const android = await session(env, inquiry.id);
    const device = await seedDevice(db, env, {
      platform: 'android',
      keyId,
      sessionIds: [android.id],
    });
    const web = await session(env, inquiry.id);
    await seedDevice(db, env, { platform: 'web', keyId, sessionIds: [web.id] });

    expect(await processGraphIndex(job(inquiry), deps())).toEqual({ status: 'indexed' });

    const rows = await rowsOf(env);
    expect(rows.every((row) => row.account_id === inquiry.accountId && row.key_id === keyId)).toBe(
      true,
    );
    const of = (kind: number) => rows.filter((row) => row.kind === kind);
    expect(of(1)).toEqual([
      expect.objectContaining({
        value_key: index,
        source_type: 'verification',
        source_id: idVerification,
      }),
    ]);
    expect(of(4)).toEqual([
      expect.objectContaining({
        value_key: identifierKey(key, {
          environmentId: env,
          kind: 'identifier-email',
          input: 'confirmed@example.com',
        }),
        source_id: emailVerification,
      }),
    ]);
    expect(of(6)).toEqual([
      expect.objectContaining({ source_type: 'inquiry', source_id: inquiry.id }),
    ]);
    // A name keys in both orders (`last|first`, `first|last`), as the list keys do.
    expect(of(9)).toHaveLength(2);
    expect(of(11)).toEqual([
      expect.objectContaining({
        value_key: identifierKey(key, {
          environmentId: env,
          kind: 'identifier-device-fingerprint',
          input: device.deviceFingerprint ?? '',
        }),
        source_type: 'inquiry-session',
        source_id: android.id,
      }),
    ]);
    // The web device class and browser fingerprint are weak: off by default.
    expect(of(12)).toEqual([]);
    expect(of(13)).toEqual([]);
    expect(await getGraphIndexJob(db, env, inquiry.id)).toMatchObject({
      status: 'completed',
      indexedAt: clock.now(),
      attempts: 1,
    });
  });

  it('writes the weak kinds with graph-weak-kinds on, and never a device made under another key', async () => {
    const env = await environment({ 'graph-weak-kinds': true });
    const inquiry = await completed(env);
    const current = await session(env, inquiry.id);
    await seedDevice(db, env, { platform: 'web', keyId, sessionIds: [current.id] });
    const rotated = await session(env, inquiry.id);
    await seedDevice(db, env, {
      platform: 'android',
      keyId: 'ZZZZZZZZZZZ',
      sessionIds: [rotated.id],
    });

    await processGraphIndex(job(inquiry), deps());

    expect((await rowsOf(env)).map((row) => row.kind).sort((a, b) => a - b)).toEqual([12, 13]);
  });

  it('leaves out a verification from a rejected handoff (C96.3)', async () => {
    const env = await environment();
    const inquiry = await completed(env);
    const rejected = await confirmedEmail(env, inquiry.id, 'stranger@example.com');
    await db.execute(
      sql`update verifications set from_rejected_handoff = true where id = ${rejected}`,
    );

    await processGraphIndex(job(inquiry), deps());

    expect(await rowsOf(env)).toEqual([]);
  });

  it('ends the row skipped, writing nothing, for an inquiry redacted after its row was written', async () => {
    const env = await environment();
    const inquiry = await completed(env, { email_address: 'typed@example.com' });
    await redactInquiryRecords(db, env, inquiry.id);

    expect(await processGraphIndex(job(inquiry), deps())).toEqual({ status: 'skipped' });

    expect(await rowsOf(env)).toEqual([]);
    expect(await getGraphIndexJob(db, env, inquiry.id)).toMatchObject({
      status: 'skipped',
      lastErrorCode: 'inquiry_redacted',
    });
  });

  it('ends the row skipped with graph-indexing off, and does nothing for a row already ended', async () => {
    const env = await environment({ 'graph-indexing': false });
    const inquiry = await completed(env, { email_address: 'typed@example.com' });

    expect(await processGraphIndex(job(inquiry), deps())).toEqual({ status: 'skipped' });
    expect(await getGraphIndexJob(db, env, inquiry.id)).toMatchObject({
      status: 'skipped',
      lastErrorCode: 'graph_indexing_off',
    });
    expect(await processGraphIndex(job(inquiry), deps())).toEqual({ status: 'skipped' });
    expect(await rowsOf(env)).toEqual([]);
  });

  it('rethrows a failure for a retry, and ends the row errored on the last attempt', async () => {
    const env = await environment();
    const inquiry = await completed(env, { email_address: 'typed@example.com' });
    await db.execute(
      sql`update graph_index_jobs set attempts = ${GRAPH_INDEX_MAX_ATTEMPTS - 2} where inquiry_id = ${inquiry.id}`,
    );
    const broken = deps({ blindIndexKey: new Uint8Array(3) });

    await expect(processGraphIndex(job(inquiry), broken)).rejects.toThrow();
    expect((await getGraphIndexJob(db, env, inquiry.id))?.status).toBe('pending');
    await expect(processGraphIndex(job(inquiry), broken)).rejects.toThrow();
    expect(await getGraphIndexJob(db, env, inquiry.id)).toMatchObject({
      status: 'errored',
      lastErrorCode: 'graph_index_failed',
    });
  });
});

describe('the graph-index-sweep (C101.3)', () => {
  it('enqueues the pending rows once a window, and ends a redacted inquiry’s row skipped', async () => {
    const env = await environment();
    const pending = await completed(env);
    const redacted = await completed(env);
    await redactInquiryRecords(db, env, redacted.id);
    const index = createRecordingGraphIndexQueue();
    const sweep = () => runGraphIndexSweep({ db, clock, logger: createCapturingLogger(), index });

    await sweep();
    await sweep();

    expect(index.jobs.filter((queued) => queued.environmentId === env)).toEqual([job(pending)]);
    expect(await getGraphIndexJob(db, env, redacted.id)).toMatchObject({
      status: 'skipped',
      lastErrorCode: 'inquiry_redacted',
    });
  });
});

describe('the graph-backfill and graph:reindex (C101.5, H10)', () => {
  it('indexes what predates an incomplete kind, then marks it complete', async () => {
    const env = await environment();
    const account = await createAccount(db, env, {
      id: testId('acc'),
      referenceId: 'ref-backfill',
    });
    const inquiry = await completed(env, { email_address: 'old@example.com' });
    await markGraphKindsIncomplete(db, env, [4, 6, 8], clock.now());

    for (let tick = 0; tick < 10; tick += 1) {
      await runGraphBackfill({
        db,
        clock,
        logger: createCapturingLogger(),
        keyring: database.keyring,
        blindIndexKey: key,
        batchSize: 1,
      });
    }

    const rows = await rowsOf(env);
    expect(rows.find((row) => row.kind === 8)?.account_id).toBe(account.id);
    expect(rows.find((row) => row.kind === 6)?.source_id).toBe(inquiry.id);
    expect(
      (await listGraphIndexStates(db, env)).map(({ kind, complete }) => ({ kind, complete })),
    ).toEqual([
      { kind: 4, complete: true },
      { kind: 6, complete: true },
      { kind: 8, complete: true },
    ]);
  });

  it('graph:reindex indexes one environment on demand and reports counts only', async () => {
    const env = await environment();
    await createAccount(db, env, { id: testId('acc'), referenceId: 'ref-reindex' });
    await completed(env, { email_address: 'reindex@example.com' });
    await markGraphKindsIncomplete(db, env, [8], clock.now());

    const result = await runGraphReindex(
      { db, blindIndexKey: key },
      { environmentId: env, batchSize: 1 },
    );

    expect(result).toEqual({ environments: 1, accounts: 2, inquiries: 1, rows: 2 });
    expect((await listGraphIndexStates(db, env)).every((state) => state.complete)).toBe(true);
  });
});

describe('graph-components (C101.6)', () => {
  it('joins accounts through strong kinds only, with singletons, for environments that opted in', async () => {
    const env = await environment({ 'graph-components': true });
    const accounts = await Promise.all(
      [0, 1, 2, 3].map(() => createAccount(db, env, { id: testId('acc') })),
    );
    const [a, b, c, d] = accounts.map(({ id }) => id) as [string, string, string, string];
    const strong = randomBytes(32).toString('hex');
    const weak = randomBytes(32).toString('hex');
    await seedGraphAttribute(db, env, { accountId: a, kind: 4, valueKey: strong });
    await seedGraphAttribute(db, env, { accountId: b, kind: 4, valueKey: strong });
    await seedGraphAttribute(db, env, { accountId: b, kind: 14, valueKey: weak });
    await seedGraphAttribute(db, env, { accountId: c, kind: 14, valueKey: weak });
    const off = await environment();
    const elsewhere = await createAccount(db, off, { id: testId('acc') });

    await runGraphComponents({ db, clock, logger: createCapturingLogger() });

    const [ofA, ofB, ofC, ofD] = await Promise.all(
      [a, b, c, d].map((id) => getGraphComponent(db, env, id)),
    );
    expect(ofA).toMatchObject({ size: 2, computedAt: clock.now() });
    expect(ofB?.componentId).toBe(ofA?.componentId);
    expect(ofC).toMatchObject({ size: 1 });
    expect(ofC?.componentId).not.toBe(ofA?.componentId);
    expect(ofD).toMatchObject({ size: 1 });
    expect(await getGraphComponent(db, off, elsewhere.id)).toBeNull();
  });
});
