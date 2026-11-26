/**
 * Migration 0029 (Workflow 8D), upgrading a database at 0028 on PGlite. The migrator runs a batch in
 * one transaction, so this upgrade is what proves each change: a fresh database passes whatever a
 * check says. The rows seeded before it are the ones each check reads, and none violates it. Every
 * value is synthetic.
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
  seedTransaction,
  seedTransactionType,
  testId,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
let client: PGlite;
let environmentId: string;
let reportId: string;
let transactionId: string;
const db = () => drizzle({ client, schema });

beforeAll(async () => {
  setDefaultKeyring(keyring);
  client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await runMigrations(db(), { upTo: '0028_phase8b' });
  const { environment } = await createTestTenant(db());
  environmentId = environment.id;
  const template = await seedReportTemplate(db(), environmentId);
  reportId = await seedReport(db(), environmentId, {
    templateId: template.templateId,
    versionId: template.versionId,
  });
  // One row of each actor the two checks read, each with its id, before the upgrade.
  for (const [actorType, actorId] of [
    ['user', testId('usr')],
    ['api_key', testId('key')],
    ['system', null],
    ['workflow_run', testId('wfr')],
  ] as const) {
    await seedReportAction(db(), environmentId, { reportId, actorType, actorId });
  }
  const type = await seedTransactionType(db(), environmentId);
  ({ id: transactionId } = await seedTransaction(db(), environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  }));
  for (const [actorType, actorId] of [
    ['user', testId('usr')],
    ['api_key', testId('key')],
    ['system', null],
    ['workflow_run', testId('wfr')],
  ] as const) {
    await client.query(
      `insert into transaction_status_history (environment_id, transaction_id, from_status,
         to_status, actor_type, actor_id)
       values ($1, $2, 'created', 'approved', $3, $4)`,
      [environmentId, transactionId, actorType, actorId],
    );
  }
  await runMigrations(db());
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await client.close();
});

describe('migration 0029: applies on top of 0028 (Workflow 8D)', () => {
  it('applies in one batch, keeping the rows', async () => {
    const applied = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    const actions = await client.query<{ count: number }>(
      'select count(*)::int as count from report_actions',
    );
    const history = await client.query<{ count: number }>(
      'select count(*)::int as count from transaction_status_history',
    );

    // Workflow 9A adds 0030 after it (C150.7, C152.2).
    expect(migrationTags()).toContain('0029_phase8d');
    expect(applied.rows[0]?.count).toBe(migrationTags().length);
    expect(actions.rows[0]?.count).toBe(4);
    expect(history.rows[0]?.count).toBe(4);
  });
});

describe('migration 0029: a user or key actor names its id (K8-14, Stage 1a amendment 16)', () => {
  const reportAction = (actorType: string, actorId: string | null) =>
    client.query(
      `insert into report_actions (id, environment_id, report_id, action_type, actor_type,
         actor_id)
       values ($1, $2, $3, 'dismiss', $4, $5)`,
      [testId('ract'), environmentId, reportId, actorType, actorId],
    );
  const statusChange = (actorType: string, actorId: string | null) =>
    client.query(
      `insert into transaction_status_history (environment_id, transaction_id, from_status,
         to_status, actor_type, actor_id)
       values ($1, $2, 'approved', 'declined', $3, $4)`,
      [environmentId, transactionId, actorType, actorId],
    );

  it('refuses a report action by a user or an API key with no id', async () => {
    await expect(reportAction('user', null)).rejects.toThrow('report_actions_actor_valid');
    await expect(reportAction('api_key', null)).rejects.toThrow('report_actions_actor_valid');
  });

  it('refuses a status change by a user or an API key with no id', async () => {
    await expect(statusChange('user', null)).rejects.toThrow(
      'transaction_status_history_actor_valid',
    );
    await expect(statusChange('api_key', null)).rejects.toThrow(
      'transaction_status_history_actor_valid',
    );
  });

  it('still takes every actor with its id, and the system with none', async () => {
    for (const [type, id] of [
      ['user', testId('usr')],
      ['api_key', testId('key')],
      ['system', null],
      ['workflow_run', testId('wfr')],
    ] as const) {
      await expect(reportAction(type, id)).resolves.toBeDefined();
      await expect(statusChange(type, id)).resolves.toBeDefined();
    }
  });

  it('still refuses an id of the wrong kind and a system actor with an id', async () => {
    await expect(reportAction('user', testId('key'))).rejects.toThrow('report_actions_actor_valid');
    await expect(statusChange('system', testId('usr'))).rejects.toThrow(
      'transaction_status_history_actor_valid',
    );
  });
});
