/**
 * K8-24 (Workflow 8D; C132.2, plan items 76 and 105): `case-assignment-drain`. A policy with sources
 * assigns the waiting cases its sources hold (unassigned, open, unredacted), by its sources' priority
 * and then its `sort`, through the policy assignment path (assigner `case-assignment-policy`, its
 * history row, `case.assigned`, the assignee's notification), while an agent has room; a case it
 * cannot place waits. A drain after an agent gained room places the next one. Synthetic values only.
 */
import { createUser } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseAssignmentPolicy,
  seedCaseQueue,
  seedCaseTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecordingEventPublisher } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { runCaseAssignmentDrain } from './cases.js';

let database: TestDatabase;
let environmentId: string;
let organizationId: string;
let numbers = 0;
const NOW = new Date('2026-11-03T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  const tenant = await createTestTenant(database.db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

/** Active users holding `cases:write`, in user-id order. */
async function agents(count: number): Promise<string[]> {
  const { db } = database;
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

async function waiting(
  template: { id: string; versionId: string; key: string },
  options: { caseQueueId?: string; minutesAgo: number },
) {
  numbers += 1;
  const { id } = await seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: numbers,
    caseQueueId: options.caseQueueId ?? null,
  });
  await database.db.execute(
    sql`update cases set created_at = ${new Date(
      NOW.getTime() - options.minutesAgo * 60_000,
    ).toISOString()}::timestamptz where id = ${id}`,
  );
  return id;
}

const assigneesOf = async (ids: readonly string[]) => {
  const { rows } = await database.client.query<{
    id: string;
    assignee_id: string | null;
    assigner_type: string | null;
    assigner_id: string | null;
  }>(`select id, assignee_id, assigner_type, assigner_id from cases where id = any($1)`, [
    [...ids],
  ]);
  return new Map(rows.map((row) => [row.id, row]));
};

describe('case-assignment-drain (K8-24)', () => {
  it('assigns its sources’ waiting cases in its order while an agent has room, and the next once one does', async () => {
    const [first, second] = await agents(2);
    const queued = await seedCaseTemplate(database.db, environmentId, { key: 'DRQ' });
    const sourced = await seedCaseTemplate(database.db, environmentId, { key: 'DRT' });
    const queue = await seedCaseQueue(database.db, environmentId);
    const policy = await seedCaseAssignmentPolicy(database.db, environmentId, {
      distribution: 'round-robin',
      agentIds: [first ?? '', second ?? ''],
      maxCapacity: 1,
      sources: [{ caseQueueId: queue.id }, { caseTemplateId: sourced.id }],
    });
    // The template source's case is the oldest, but the queue comes first among the sources.
    const fromTemplate = await waiting(sourced, { minutesAgo: 30 });
    const older = await waiting(queued, { caseQueueId: queue.id, minutesAgo: 20 });
    const newer = await waiting(queued, { caseQueueId: queue.id, minutesAgo: 10 });
    const events = createRecordingEventPublisher();
    const deps = {
      db: database.db,
      clock: { now: () => NOW },
      logger: createCapturingLogger(),
      events,
    };

    await runCaseAssignmentDrain(deps);

    const placed = await assigneesOf([older, newer, fromTemplate]);
    expect([placed.get(older)?.assignee_id, placed.get(newer)?.assignee_id]).toEqual([
      first,
      second,
    ]);
    expect(placed.get(older)).toMatchObject({
      assigner_type: 'case-assignment-policy',
      assigner_id: policy.id,
    });
    expect(placed.get(fromTemplate)?.assignee_id).toBeNull();
    expect(events.named('case.assigned')).toHaveLength(2);
    const notified = await database.client.query<{ count: number }>(
      `select count(*)::int as count from user_notifications
       where kind = 'assigned' and case_id = any($1)`,
      [[older, newer]],
    );
    expect(notified.rows[0]?.count).toBe(2);
    const history = await database.client.query<{ count: number }>(
      `select count(*)::int as count from case_history where kind = 'assigned' and case_id = $1`,
      [older],
    );
    expect(history.rows[0]?.count).toBe(1);

    await database.db.execute(
      sql`update cases set status = 'approved', status_category = 'end', resolved_at = now()
        where id = ${older}`,
    );
    await runCaseAssignmentDrain(deps);

    expect((await assigneesOf([fromTemplate])).get(fromTemplate)?.assignee_id).toBe(first);
  });
});
