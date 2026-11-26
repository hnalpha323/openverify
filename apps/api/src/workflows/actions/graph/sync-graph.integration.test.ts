/**
 * C127.5: Sync Graph on real Postgres, beside the indexer. Steps poll while other connections move
 * the jobs, so a step's read and a job's commit interleave, which PGlite's one connection cannot do.
 * `synced: true` must mean the index had caught up when the step answered: a step never says so while
 * its job is still pending.
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createKeyring,
  openWorkflowStepValues,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processWorkflowStep } from '../../../jobs/workflows/step.js';
import {
  action,
  chain,
  createEngineHarnessOnDatabase,
  start,
  stepOf,
  type EngineHarness,
} from '../../engine/testing.js';
import { SYNC_GRAPH_HANDLER } from './sync-graph.js';

const GRANT = { scopes: ['graph:read'], pii: false } as const;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let harness: EngineHarness;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  setDefaultKeyring(createKeyring(randomBytes(32)));
  await runMigrations(db);
  harness = createEngineHarnessOnDatabase(db, await createTestTenant(db), [SYNC_GRAPH_HANDLER]);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

async function accountWithPendingJob() {
  const { inquiry } = await createTestInquiry(db, harness.environmentId);
  await pool.query(
    `insert into graph_index_jobs (environment_id, inquiry_id, trigger_status, status)
       values ($1, $2, 'completed', 'pending')`,
    [harness.environmentId, inquiry.id],
  );
  return inquiry;
}

const finishJob = (inquiryId: string) =>
  pool.query(
    `update graph_index_jobs set status = 'completed', indexed_at = clock_timestamp()
       where environment_id = $1 and inquiry_id = $2`,
    [harness.environmentId, inquiryId],
  );

const indexedAt = async (inquiryId: string): Promise<Date | null> => {
  const { rows } = await pool.query<{ indexed_at: Date | null }>(
    `select indexed_at from graph_index_jobs where environment_id = $1 and inquiry_id = $2`,
    [harness.environmentId, inquiryId],
  );
  return rows[0]?.indexed_at ?? null;
};

describe('Sync Graph beside the indexer (C127.5)', () => {
  it('never says synced while its job is pending, however the two interleave', async () => {
    const inquiries = await Promise.all(Array.from({ length: 6 }, accountWithPendingJob));
    const runs = await Promise.all(
      inquiries.map((inquiry) =>
        start(
          harness,
          chain([
            action('sync', 'sync_graph', {
              'account-id': inquiry.accountId,
              'timeout-seconds': 10,
            }),
          ]),
          { grant: GRANT },
        ),
      ),
    );
    const jobs = harness.steps.jobs.splice(0);

    await Promise.all([
      ...jobs.map(({ job }) => processWorkflowStep(job, harness.deps)),
      ...inquiries.map(async (inquiry, index) => {
        await new Promise((resolve) => setTimeout(resolve, 100 + index * 700));
        await finishJob(inquiry.id);
      }),
    ]);

    for (const [index, inquiry] of inquiries.entries()) {
      const step = await stepOf(harness, runs[index] ?? '', 'sync');
      expect(openWorkflowStepValues(step).output).toMatchObject({ synced: true });
      const indexed = await indexedAt(inquiry.id);
      expect(indexed).not.toBeNull();
      expect(indexed?.getTime()).toBeLessThanOrEqual(step.completedAt?.getTime() ?? 0);
    }
  });
});
