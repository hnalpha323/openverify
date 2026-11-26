/**
 * C251.1 (Workflow 11B, `quotas`; rule 6: every lock and race has its Testcontainers test), against a
 * real Postgres 17 with concurrent connections: producers racing for an environment's last slots
 * admit exactly its cap, and two fair sweeps racing over one queue admit exactly the room left, each
 * row once. Counts only, never timing. Synthetic ids.
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createKeyring,
  runMigrations,
  setDefaultKeyring,
  updateEnvironmentSettings,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkerLogger } from '../../jobs/logger.js';
import { sweepQueue } from './admission.js';
import { admitOnProduce } from './admit.js';
import { createQuotaAdmissionDeps, queueRowsOf } from './queue-rows.js';

const keyring = createKeyring(randomBytes(32));
const T0 = new Date('2026-11-13T12:00:00.000Z');
const clock = { now: () => T0 };

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/** An environment whose `process-verification` cap is `cap`, with `count` held verifications. */
async function heldEnvironment(cap: number, count: number) {
  const environmentId = (await createTestTenant(db)).environment.id;
  await updateEnvironmentSettings(db, environmentId, {
    'queue-in-flight-caps': { 'process-verification': cap },
  });
  const { inquiry } = await createTestInquiry(db, environmentId);
  const ids = Array.from({ length: count }, () => testId('ver'));
  for (const id of ids) {
    await db.execute(sql`
      insert into verifications (id, environment_id, inquiry_id, type, status, submitted_at)
      values (${id}, ${environmentId}, ${inquiry.id}, 'government_id'::verification_type,
        'submitted'::verification_status, ${T0.toISOString()})`);
  }
  return { environmentId, ids };
}

async function admittedCount(environmentId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from verifications
         where environment_id = ${environmentId} and admitted_at is not null`,
  );
  return result.rows[0]?.n ?? -1;
}

describe('admission races on Postgres (C251.1)', () => {
  it('admits exactly the cap when producers race for the last slots', async () => {
    const { environmentId, ids } = await heldEnvironment(5, 20);

    const answers = await Promise.all(
      ids.map((id) =>
        admitOnProduce({ db, clock }, { queue: 'process-verification', environmentId, id }),
      ),
    );

    expect(answers.filter(Boolean)).toHaveLength(5);
    expect(await admittedCount(environmentId)).toBe(5);
  });

  it('admits exactly the room left, each row once, when two sweeps race', async () => {
    const { environmentId } = await heldEnvironment(10, 30);
    const deps = createQuotaAdmissionDeps({
      db,
      clock,
      logger: createWorkerLogger({ level: 'silent' }),
      limits: { ceiling: 50 },
    });
    const enqueued: string[] = [];
    const enqueue = (job: { verificationId: string }) => {
      enqueued.push(job.verificationId);
      return Promise.resolve();
    };
    const rows = queueRowsOf('process-verification');

    await Promise.all([sweepQueue(deps, rows, enqueue), sweepQueue(deps, rows, enqueue)]);

    expect(await admittedCount(environmentId)).toBe(10);
    const mine = await db.execute<{ id: string }>(
      sql`select id from verifications
           where environment_id = ${environmentId} and admitted_at is not null`,
    );
    const admitted = new Set(mine.rows.map((row) => row.id));
    const enqueuedHere = enqueued.filter((id) => admitted.has(id));
    expect(enqueuedHere).toHaveLength(10);
    expect(new Set(enqueuedHere).size).toBe(10);
  });
});
