/**
 * K8-24 (Workflow 8D; C132.2, C132.3) on Postgres 17 row locks: two `case-assignment-drain` passes at
 * once over one policy's queue of eight waiting cases and three agents of capacity one. The case row
 * is taken `FOR UPDATE SKIP LOCKED` and the policy's row is locked before the agents' open counts are
 * read, so no case goes to two agents (one `assigned` history row each) and no agent passes its
 * capacity: exactly three cases are placed, one an agent. Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createKeyring,
  createUser,
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
import { createRecordingEventPublisher } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { runCaseAssignmentDrain } from './cases.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let organizationId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

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

describe('two drains at once (K8-24)', () => {
  it('place no case twice and pass no agent’s capacity', async () => {
    const people = await agents(3);
    const template = await seedCaseTemplate(db, environmentId, { key: 'DRAIN' });
    const queue = await seedCaseQueue(db, environmentId);
    await seedCaseAssignmentPolicy(db, environmentId, {
      distribution: 'fewest-open',
      agentIds: people,
      maxCapacity: 1,
      sources: [{ caseQueueId: queue.id }],
    });
    const waiting: string[] = [];
    for (let number = 1; number <= 8; number += 1) {
      waiting.push(
        (
          await seedCase(db, environmentId, {
            caseTemplateId: template.id,
            caseTemplateVersionId: template.versionId,
            key: template.key,
            number,
            caseQueueId: queue.id,
          })
        ).id,
      );
    }
    const deps = () => ({
      db,
      clock: { now: () => new Date() },
      logger: createCapturingLogger(),
      events: createRecordingEventPublisher(),
    });

    await Promise.all([runCaseAssignmentDrain(deps()), runCaseAssignmentDrain(deps())]);

    const { rows } = await pool.query<{ assignee_id: string; count: number }>(
      `select assignee_id, count(*)::int as count from cases
       where id = any($1) and assignee_id is not null group by assignee_id order by assignee_id`,
      [waiting],
    );
    expect(rows).toEqual(people.map((assignee_id) => ({ assignee_id, count: 1 })));
    const history = await pool.query<{ case_id: string; count: number }>(
      `select case_id, count(*)::int as count from case_history
       where kind = 'assigned' and case_id = any($1) group by case_id`,
      [waiting],
    );
    expect(history.rows).toHaveLength(3);
    expect(history.rows.every(({ count }) => count === 1)).toBe(true);
  });
});
