/**
 * Migration 0027 (Workflow 8A), upgrading a database at 0026 with an actor of each kind in it, on
 * PGlite. The migrator runs a batch in one transaction, and Postgres refuses a label `ALTER TYPE
 * ... ADD VALUE` added in that transaction ("unsafe use of new value") unless the type was created
 * in it too, so this upgrade is the only path that proves the new checks: a fresh database passes
 * whatever they say. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  createTestTenant,
  PGLITE_EXTENSIONS,
  seedReport,
  seedReportAction,
  seedReportTemplate,
  testId,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
let client: PGlite;
let environmentId: string;
let reportId: string;
let userActionId: string;
const db = () => drizzle({ client, schema });

beforeAll(async () => {
  setDefaultKeyring(keyring);
  client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await runMigrations(db(), { upTo: '0026_transaction_relations_page_index' });
  const { environment } = await createTestTenant(db());
  environmentId = environment.id;
  reportId = await seedReport(db(), environmentId, await seedReportTemplate(db(), environmentId));
  userActionId = await seedReportAction(db(), environmentId, {
    reportId,
    actionType: 'pause',
    actorType: 'user',
    actorId: testId('usr'),
  });
  await runMigrations(db());
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await client.close();
});

describe('migration 0027: the workflow_run actor', () => {
  it('applies on top of 0026 in one batch, keeping the rows', async () => {
    const applied = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    const actions = await client.query<{ id: string }>('select id from report_actions');

    expect(applied.rows[0]?.count).toBe(migrationTags().length);
    expect(actions.rows.map((row) => row.id)).toEqual([userActionId]);
  });

  it('holds the new label on the enum', async () => {
    const labels = await client.query<{ enumlabel: string }>(
      `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'audit_actor_type' order by e.enumsortorder`,
    );

    expect(labels.rows.map((row) => row.enumlabel)).toEqual([
      'user',
      'api_key',
      'system',
      'workflow_run',
    ]);
  });

  it('accepts a run as an actor after the upgrade, and only with a wfr_ id', async () => {
    const insert = (actor: string) =>
      client.query(
        `insert into report_actions (id, environment_id, report_id, action_type, actor_type,
           actor_id) values ($1, $2, $3, 'pause', 'workflow_run', $4)`,
        [testId('ract'), environmentId, reportId, actor],
      );

    await expect(insert(testId('wfr'))).resolves.toBeDefined();
    await expect(insert(testId('usr'))).rejects.toThrow('report_actions_actor_valid');
  });
});
