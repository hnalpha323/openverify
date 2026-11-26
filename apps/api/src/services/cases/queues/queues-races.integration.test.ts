/**
 * C132.3, C133.6, C146.2 (Workflow 8B Stage 3, `api-queues-sla`) on Postgres 17 row locks:
 * - Round-robin under concurrent entries: six cases entering one queue at once, each in its own
 *   transaction holding its case, are serialised by the queue row's lock, so its three members take
 *   two each and the cursor ends where the sixth assignment left it.
 * - Fewest-open under concurrent entries: four cases at once go two to each of two idle members.
 * - The SLA sweep once per epoch under two sweepers: forty due deadlines swept by two passes at once
 *   fire `case.sla-expired` once each, with one history row each.
 * - Opposite lock orders (Workflow 8C review K8-35): a members change locks the queue, then its cases;
 *   an entry locks a case, then its queue. Run together they deadlock, and Postgres aborts the one
 *   that waited first; the route's transaction is retried, so it answers, never a 500.
 * Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createKeyring,
  createUser,
  lockCaseRow,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  seedCase,
  seedCaseAssignmentPolicy,
  seedCaseQueue,
  seedCaseTemplate,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../../auth/pii.js';
import { runCaseSlaSweep } from '../../../jobs/repeatable/cases.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../../test-support/fakes.js';
import type { ApiDependencies } from '../../context.js';
import { assignOnEntry } from '../assignment/on-entry.js';
import type { CaseActing } from '../service.js';
import { setCaseQueueMembers } from './service.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-11-03T12:00:00.000Z');

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let organizationId: string;
let template: { id: string; versionId: string; key: string };
let numbers = 0;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
  template = await seedCaseTemplate(db, environmentId, { key: 'RACE' });
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/** Active users holding `cases:write`, in user-id order. */
async function agents(count: number): Promise<string[]> {
  const roleId = testId('role');
  await db.execute(sql`insert into roles (id, organization_id, name, permissions)
    values (${roleId}, ${organizationId}, ${`Synthetic ${roleId}`}, '{cases:write}'::text[])`);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = testId('usr');
    await createUser(db, {
      id,
      organizationId,
      email: `${id.toLowerCase()}@example.com`,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
    });
    await db.execute(sql`insert into user_roles (organization_id, user_id, role_id)
      values (${organizationId}, ${id}, ${roleId})`);
    ids.push(id);
  }
  return ids.sort();
}

async function queuedCases(caseQueueId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    numbers += 1;
    ids.push(
      (
        await seedCase(db, environmentId, {
          caseTemplateId: template.id,
          caseTemplateVersionId: template.versionId,
          key: template.key,
          number: numbers,
          caseQueueId,
        })
      ).id,
    );
  }
  return ids;
}

/** Every case enters at once, each in its own transaction holding its case first, as `api-cases` does. */
const enterAtOnce = (caseQueueId: string, caseIds: readonly string[]) =>
  Promise.all(
    caseIds.map((caseId) =>
      db.transaction(async (tx) => {
        await lockCaseRow(tx, environmentId, caseId);
        return assignOnEntry(tx, {
          environmentId,
          caseId,
          caseTemplateVersionId: template.versionId,
          caseQueueId,
          at: NOW,
        });
      }),
    ),
  );

const counts = (ids: readonly (string | null)[]) => {
  const tally = new Map<string | null, number>();
  for (const id of ids) {
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  return tally;
};

describe('policies under concurrent entries (C132.3)', () => {
  it('round-robin gives each member two of six, the queue lock serialising the cursor', async () => {
    const members = await agents(3);
    const policy = await seedCaseAssignmentPolicy(db, environmentId, {
      distribution: 'round-robin',
    });
    const queue = await seedCaseQueue(db, environmentId, {
      caseAssignmentPolicyId: policy.id,
      members: members.map((userId) => ({ userId })),
    });
    const cases = await queuedCases(queue.id, 6);

    const assigned = await enterAtOnce(queue.id, cases);

    expect([...counts(assigned).entries()].sort()).toEqual(members.map((id) => [id, 2] as const));
    const cursor = await db.execute(sql`select round_robin_cursor from case_queues
      where id = ${queue.id}`);
    expect((cursor as unknown as { rows: { round_robin_cursor: string }[] }).rows[0]).toEqual({
      round_robin_cursor: members[2],
    });
  });

  it('fewest-open gives each of two idle members two of four', async () => {
    const members = await agents(2);
    const policy = await seedCaseAssignmentPolicy(db, environmentId, {
      distribution: 'fewest-open',
    });
    const queue = await seedCaseQueue(db, environmentId, {
      caseAssignmentPolicyId: policy.id,
      members: members.map((userId) => ({ userId })),
    });
    const cases = await queuedCases(queue.id, 4);

    const assigned = await enterAtOnce(queue.id, cases);

    expect([...counts(assigned).entries()].sort()).toEqual(members.map((id) => [id, 2] as const));
  });
});

describe('the SLA sweep under two sweepers (C133.6, decision 60)', () => {
  it('fires each due deadline once', async () => {
    const queue = await seedCaseQueue(db, environmentId);
    const cases = await queuedCases(queue.id, 40);
    await db.execute(sql`update cases set sla_state = 'running', sla_epoch = 1,
      sla_target_ms = 60000, sla_segment_started_at = ${new Date(NOW.getTime() - 120_000).toISOString()}::timestamptz,
      sla_expires_at = ${new Date(NOW.getTime() - 60_000).toISOString()}::timestamptz
      where case_queue_id = ${queue.id}`);
    const publishers = [createRecordingEventPublisher(), createRecordingEventPublisher()];
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

    await Promise.all(
      publishers.map((events) =>
        runCaseSlaSweep({ db, clock: { now: () => NOW }, logger, events }),
      ),
    );

    const fired = publishers.flatMap((events) =>
      events
        .named('case.sla-expired')
        .map((event) => (event.payload as { data: { id: string } }).data.id),
    );
    expect(fired.sort()).toEqual([...cases].sort());
    const history = await db.execute(sql`select count(*)::int as count from case_history
      where kind = 'sla-expired' and case_id in (select id from cases where case_queue_id = ${queue.id})`);
    expect((history as unknown as { rows: { count: number }[] }).rows[0]?.count).toBe(40);
  });
});

describe('opposite lock orders on a queue and its case (K8-35)', () => {
  /** Polls until a backend waits for a row lock, so the second order is taken only then. */
  async function untilSomeoneWaits(): Promise<void> {
    for (let tries = 0; tries < 200; tries += 1) {
      const waiting = await pool.query<{ count: number }>(
        `select count(*)::int as count from pg_locks where not granted and locktype = 'transactionid'`,
      );
      if ((waiting.rows[0]?.count ?? 0) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('no transaction ever waited for a lock');
  }

  it('answers a members change that deadlocked with an entry, as if they had queued', async () => {
    const [leaving, staying] = await agents(2);
    if (leaving === undefined || staying === undefined) {
      throw new Error('two agents were made');
    }
    const queue = await seedCaseQueue(db, environmentId, {
      members: [{ userId: leaving }, { userId: staying }],
    });
    numbers += 1;
    const held = await seedCase(db, environmentId, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: numbers,
      caseQueueId: queue.id,
      assigneeId: leaving,
    });
    const clock = fixedClock(NOW);
    const deps = {
      db,
      clock,
      events: createRecordingEventPublisher(),
      audit: createRecordingAuditLogger(),
    } as unknown as ApiDependencies;
    const acting = {
      ctx: { environmentId, organizationId, requestId: 'req_synthetic' },
      actor: { type: 'user', id: staying },
      mask: UNMASKED,
      principal: null,
      environmentKind: 'sandbox',
    } as unknown as CaseActing;

    let caseHeld: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      caseHeld = resolve;
    });
    // The entry's order: the case, then (once the members change waits for the case) the queue.
    const entry = db.transaction(async (tx) => {
      // integration-11b (rule 6): Postgres aborts the backend whose deadlock check fires first. The
      // members change starts waiting first, so its one-second check fires first on an idle machine,
      // but at load 13 the entry's check once fired first and the entry was the victim. A longer
      // check on the entry's side alone makes the members change the victim every time, which is
      // the case this test is about (the route answers its deadlock as if it had queued).
      await tx.execute(sql`set local deadlock_timeout = '30s'`);
      await lockCaseRow(tx, environmentId, held.id);
      caseHeld();
      await untilSomeoneWaits();
      await tx.execute(sql`select id from case_queues where id = ${queue.id} for update`);
    });
    await holding;
    // The route's order: the queue, then its cases assigned to the member who leaves.
    const members = setCaseQueueMembers(deps, acting, queue.id, {
      data: { type: 'case-queue', attributes: { members: [{ 'user-id': staying }] } },
    });

    await expect(entry).resolves.toBeUndefined();
    await expect(members).resolves.toMatchObject({ data: { id: queue.id } });
    const after = await db.execute(sql`select assignee_id from cases where id = ${held.id}`);
    expect(
      (after as unknown as { rows: { assignee_id: string | null }[] }).rows[0]?.assignee_id,
    ).not.toBe(leaving);
  });
});
