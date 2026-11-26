/**
 * C121.1 (owner decision 12 after Workflow 6B): a run acts as itself, so every check that pins an
 * actor names it, by its `wfr_` id, and never accepts another kind of id under it. Every value is
 * synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAuditLog } from './repositories/audit-logs.js';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = (text: string, params: unknown[]) => database.client.query(text, params);

async function tenant(): Promise<string> {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

async function reportOf(environmentId: string): Promise<string> {
  const template = await seedReportTemplate(database.db, environmentId);
  return seedReport(database.db, environmentId, template);
}

async function transactionOf(environmentId: string): Promise<string> {
  const type = await seedTransactionType(database.db, environmentId);
  const { id } = await seedTransaction(database.db, environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  });
  return id;
}

const insertReportAction = (env: string, report: string, type: string, actor: string | null) =>
  query(
    `insert into report_actions (id, environment_id, report_id, action_type, actor_type, actor_id)
     values ($1, $2, $3, 'pause', $4, $5)`,
    [testId('ract'), env, report, type, actor],
  );

const insertStatus = (env: string, transaction: string, type: string, actor: string | null) =>
  query(
    `insert into transaction_status_history (environment_id, transaction_id, to_status, actor_type,
       actor_id) values ($1, $2, 'approved', $3, $4)`,
    [env, transaction, type, actor],
  );

const insertItem = (env: string, list: string, type: string, actor: string) =>
  query(
    `insert into list_items (id, environment_id, list_id, normaliser_version, status,
       created_by_type, created_by_id) values ($1, $2, $3, 'lists-1', 'active', $4, $5)`,
    [testId('lis'), env, list, type, actor],
  );

describe('the workflow_run actor (C121.1)', () => {
  it('is a value of audit_actor_type, and an audit entry stores it with its id', async () => {
    const environmentId = await tenant();
    const run = testId('wfr');

    const entry = await appendAuditLog(database.db, environmentId, {
      actorType: 'workflow_run',
      actorId: run,
      action: 'inquiry.declined',
    });

    expect(entry).toMatchObject({ actorType: 'workflow_run', actorId: run });
  });

  it('is an actor of a report action, by a wfr_ id only (report_actions_actor_valid)', async () => {
    const environmentId = await tenant();
    const report = await reportOf(environmentId);

    await expect(
      insertReportAction(environmentId, report, 'workflow_run', testId('wfr')),
    ).resolves.toBeDefined();
    for (const actor of [testId('usr'), testId('key'), null]) {
      await expect(
        insertReportAction(environmentId, report, 'workflow_run', actor),
      ).rejects.toThrow('report_actions_actor_valid');
    }
    await expect(insertReportAction(environmentId, report, 'user', testId('wfr'))).rejects.toThrow(
      'report_actions_actor_valid',
    );
  });

  it('is an actor of a status change, by a wfr_ id only (transaction_status_history_actor_valid)', async () => {
    const environmentId = await tenant();
    const transaction = await transactionOf(environmentId);

    await expect(
      insertStatus(environmentId, transaction, 'workflow_run', testId('wfr')),
    ).resolves.toBeDefined();
    for (const actor of [testId('key'), null]) {
      await expect(insertStatus(environmentId, transaction, 'workflow_run', actor)).rejects.toThrow(
        'transaction_status_history_actor_valid',
      );
    }
  });

  it('creates a list item (list_items_created_by_type_valid)', async () => {
    const environmentId = await tenant();
    const { id: list } = await seedList(database.db, environmentId);

    await expect(
      insertItem(environmentId, list, 'workflow-run', testId('wfr')),
    ).resolves.toBeDefined();
    await expect(insertItem(environmentId, list, 'robot', testId('wfr'))).rejects.toThrow(
      'list_items_created_by_type_valid',
    );
  });
});
