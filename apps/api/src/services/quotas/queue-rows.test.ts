/**
 * C251.1, C251.2 (Workflow 11B, `quotas`; review H12, review P15): admission over Postgres (PGlite
 * with every migration), asserted by counts and order, never by timing. A flooding environment is held
 * at its cap while a quiet environment's job is admitted in the same sweep tick, before the flooder's
 * held work drains, at the default cap and with the flooder at the install ceiling; a slot that frees
 * admits the flooder's oldest held row. Synthetic ids only.
 */
import { updateEnvironmentSettings, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test-support/fakes.js';
import { sweepQueue } from './admission.js';
import {
  admissionJobOf,
  createQuotaAdmissionDeps,
  isAdmissionRowQueue,
  lostRowsOf,
  queueRowsOf,
  quotaQueuePasses,
} from './queue-rows.js';

let database: TestDatabase;
let db: Db;

const T0 = new Date('2026-11-13T12:00:00.000Z');
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

/** `count` verifications submitted one second apart from T0, in one statement; their ids in order. */
async function submitted(environmentId: string, count: number): Promise<string[]> {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const ids = Array.from({ length: count }, () => testId('ver'));
  await db.execute(sql`
    insert into verifications (id, environment_id, inquiry_id, type, status, submitted_at)
    select v.id, ${environmentId}, ${inquiry.id}, 'government_id'::verification_type,
           'submitted'::verification_status,
           ${T0.toISOString()}::timestamptz + (v.n * interval '1 second')
      from unnest(${sql`array[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[]`}) with ordinality as v(id, n)`);
  return ids;
}

async function admittedIds(environmentId: string): Promise<string[]> {
  const result = await database.db.execute<{ id: string }>(sql`
    select id from verifications where environment_id = ${environmentId} and admitted_at is not null
     order by submitted_at, id`);
  return result.rows.map((row) => row.id);
}

function harness(ceiling: number) {
  const clock = fixedClock(T0);
  const deps = createQuotaAdmissionDeps({ db, clock, logger, limits: { ceiling } });
  const enqueued: { environmentId: string; verificationId: string }[] = [];
  const rows = queueRowsOf('process-verification');
  const tick = () =>
    sweepQueue(deps, rows, (job) => {
      enqueued.push(job);
      return Promise.resolve();
    });
  return { clock, enqueued, tick };
}

describe('the fair sweep over Postgres (review H12)', () => {
  it('holds a flooder at the default cap and admits a quiet environment in the same tick', async () => {
    const flooder = (await createTestTenant(db)).environment.id;
    const quiet = (await createTestTenant(db)).environment.id;
    const flood = await submitted(flooder, 60);
    const [mine] = await submitted(quiet, 1);
    const { enqueued, tick } = harness(50);

    await tick();
    expect(await admittedIds(flooder)).toEqual(flood.slice(0, 50));
    expect(await admittedIds(quiet)).toEqual([mine]);
    // The quiet environment's job is enqueued before the flooder's held ten are.
    expect(enqueued.filter((job) => job.environmentId === quiet)).toEqual([
      { environmentId: quiet, verificationId: mine },
    ]);
    expect(enqueued.filter((job) => job.environmentId === flooder)).toHaveLength(50);

    // At its cap the flooder is held; two of its admitted finish, and its two oldest held follow.
    await tick();
    expect(await admittedIds(flooder)).toHaveLength(50);
    await db.execute(
      sql`update verifications set status = 'passed' where id in (${flood[0]}, ${flood[1]})`,
    );
    await tick();
    expect((await admittedIds(flooder)).slice(-2)).toEqual([flood[50], flood[51]]);
  });

  it('holds a flooder at the install ceiling and still admits a quiet environment', async () => {
    const flooder = (await createTestTenant(db)).environment.id;
    const quiet = (await createTestTenant(db)).environment.id;
    await updateEnvironmentSettings(db, flooder, {
      'queue-in-flight-caps': { 'process-verification': 75 },
    });
    const flood = await submitted(flooder, 80);
    const [mine] = await submitted(quiet, 1);
    const { tick } = harness(75);

    await tick();
    expect(await admittedIds(flooder)).toEqual(flood.slice(0, 75));
    expect(await admittedIds(quiet)).toEqual([mine]);
  });

  it('admits no more than a lowered cap, and a stored value above the ceiling is clamped', async () => {
    const lowered = (await createTestTenant(db)).environment.id;
    const above = (await createTestTenant(db)).environment.id;
    await updateEnvironmentSettings(db, lowered, {
      'queue-in-flight-caps': { 'process-verification': 3 },
    });
    await updateEnvironmentSettings(db, above, {
      'queue-in-flight-caps': { 'process-verification': 900 },
    });
    await submitted(lowered, 5);
    await submitted(above, 12);
    const { tick } = harness(10);

    await tick();
    expect(await admittedIds(lowered)).toHaveLength(3);
    expect(await admittedIds(above)).toHaveLength(10);
  });
});

describe('the queues and their jobs', () => {
  it('builds each queue’s job from its row', () => {
    const row = { environmentId: 'env_x', id: 'x_1', since: T0, extra: 'rep_1' };
    expect(admissionJobOf('process-verification', row)).toEqual({
      environmentId: 'env_x',
      verificationId: 'x_1',
    });
    expect(admissionJobOf('report-run', row)).toEqual({
      environmentId: 'env_x',
      reportId: 'rep_1',
      runId: 'x_1',
    });
    expect(admissionJobOf('connect-redeem', row)).toEqual({
      environmentId: 'env_x',
      shareTokenId: 'x_1',
    });
    expect(admissionJobOf('account-export', row)).toEqual({
      environmentId: 'env_x',
      exportId: 'x_1',
    });
    expect(admissionJobOf('integrity-decode', row)).toEqual({
      environmentId: 'env_x',
      challengeId: 'x_1',
    });
    expect(isAdmissionRowQueue('report-run')).toBe(true);
    expect(isAdmissionRowQueue('list-screen')).toBe(false);
  });

  it('lists lost admitted rows with their jobs', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    const [lost, held] = await submitted(environmentId, 2);
    await db.execute(
      sql`update verifications set admitted_at = ${T0.toISOString()}::timestamptz where id = ${lost}`,
    );
    const rows = await lostRowsOf('process-verification').listLost(db, {
      before: new Date(T0.getTime() + 60_000),
      limit: 500,
    });
    const mine = rows.filter((row) => row.environmentId === environmentId);
    expect(mine).toEqual([
      { environmentId, id: lost, job: { environmentId, verificationId: lost } },
    ]);
    expect(mine.map((row) => row.id)).not.toContain(held);
  });

  it('passes one queue per producer, in order, with lost work only where no sweep recovers it', () => {
    const producer = () => Promise.resolve();
    const passes = quotaQueuePasses({
      verifications: { enqueueProcessVerification: producer },
      reportRuns: { enqueueReportRun: producer },
      connectRedeems: { enqueueConnectRedeem: producer },
      accountExports: { enqueueAccountExport: producer },
      integrityDecodes: { enqueueIntegrityDecode: producer },
    });
    expect(passes.map((pass) => [pass.queue, pass.recover !== null])).toEqual([
      ['process-verification', false],
      ['report-run', false],
      ['connect-redeem', true],
      ['account-export', true],
      ['integrity-decode', true],
    ]);
    expect(quotaQueuePasses({}).map((pass) => pass.queue)).toEqual([]);
    expect(
      quotaQueuePasses({ integrityDecodes: { enqueueIntegrityDecode: producer } }).map(
        (pass) => pass.queue,
      ),
    ).toEqual(['integrity-decode']);
  });
});
