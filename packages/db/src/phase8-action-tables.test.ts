/**
 * Workflow 8A Stage 1b, checkpoint (A) (plan C117.5, C122.1, C127.7, C127.9, C127.12, C128): the
 * action and decision columns of migration 0027, read from the migrated database's catalogs.
 *
 * - `inquiry_decisions`, an accountability record with a polymorphic subject and a sealed comment;
 * - `transaction_children`, the objects a run created, which a transaction's redaction reaches;
 * - the device trust mark, whole or not at all;
 * - the type columns of an adverse status and a contest route, and a list's purpose;
 * - a transaction's reviewer, of a closed set of actors;
 * - `report_origin`'s `workflow`, and a custom-list `list_update` run, once per report and version;
 * - `list_rescreen_requests`, the outbox of `list-rescreen`;
 * - the `workflow_run_step_id` key of everything a run creates (C117.5).
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestTenant,
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

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = await query<{ column_name: string; udt_name: string }>(
    `select column_name, udt_name from information_schema.columns where table_name = $1`,
    [table],
  );
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.udt_name]));
}

async function indexDefinition(index: string): Promise<string> {
  const result = await query<{ indexdef: string }>(
    `select indexdef from pg_indexes where indexname = $1`,
    [index],
  );
  return result.rows[0]?.indexdef ?? '';
}

async function tenant(): Promise<string> {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

async function seedList(environmentId: string, kind = 'email-address'): Promise<string> {
  const id = testId('lst');
  await query(`insert into lists (id, environment_id, type, name) values ($1, $2, $3, 'Blocked')`, [
    id,
    environmentId,
    kind,
  ]);
  return id;
}

describe('inquiry_decisions', () => {
  const decision = (environmentId: string, overrides: Record<string, unknown> = {}) => {
    const row = {
      id: testId('idec'),
      kind: 'decline',
      subject_type: 'inquiry',
      subject_id: testId('inq'),
      actor_type: 'user',
      actor_id: testId('usr'),
      ...overrides,
    };
    const names = Object.keys(row);
    return query(
      `insert into inquiry_decisions (environment_id, ${names.join(', ')})
       values ($1, ${names.map((_, index) => `$${String(index + 2)}`).join(', ')})`,
      [environmentId, ...Object.values(row)],
    );
  };

  it('holds the record of C128.1, the comment sealed', async () => {
    const columns = await columnsOf('inquiry_decisions');

    expect(columns).toMatchObject({
      id: 'text',
      environment_id: 'text',
      kind: 'text',
      subject_type: 'text',
      subject_id: 'text',
      actor_type: 'text',
      actor_id: 'text',
      run: 'jsonb',
      solely_automated: 'bool',
      human_step: 'jsonb',
      evidence: 'jsonb',
      pending_evidence: 'jsonb',
      decision_basis: 'text',
      contest_route: 'jsonb',
      biometric_basis: 'text',
      comment: 'text',
      needs_review: 'bool',
      human_review_pending: 'bool',
      error_code: 'text',
      test_run_id: 'text',
    });
  });

  it('takes each subject by its own prefix', async () => {
    const environmentId = await tenant();

    await expect(decision(environmentId)).resolves.toBeDefined();
    await expect(
      decision(environmentId, { subject_type: 'list-item', subject_id: testId('liea') }),
    ).resolves.toBeDefined();
    await expect(
      decision(environmentId, { subject_type: 'transaction', subject_id: testId('txn') }),
    ).resolves.toBeDefined();
    await expect(
      decision(environmentId, { subject_type: 'account', subject_id: testId('acc') }),
    ).resolves.toBeDefined();
    await expect(
      decision(environmentId, { subject_type: 'account', subject_id: testId('inq') }),
    ).rejects.toThrow('inquiry_decisions_subject_id_format');
  });

  it('never takes the system as an actor, and pins each id to its actor', async () => {
    const environmentId = await tenant();

    await expect(
      decision(environmentId, { actor_type: 'workflow-run', actor_id: testId('wfr') }),
    ).resolves.toBeDefined();
    await expect(
      decision(environmentId, { actor_type: 'system', actor_id: testId('usr') }),
    ).rejects.toThrow('inquiry_decisions_actor_type_valid');
    await expect(
      decision(environmentId, { actor_type: 'workflow-run', actor_id: testId('usr') }),
    ).rejects.toThrow('inquiry_decisions_actor_id_format');
  });

  it('refuses a person on the path of a solely automated decision (C128.2)', async () => {
    const environmentId = await tenant();

    await expect(
      decision(environmentId, { solely_automated: true, human_step: '{"kind":"case-resolution"}' }),
    ).rejects.toThrow('inquiry_decisions_human_step_is_not_automated');
  });

  it('holds human review pending on a reopen row, one at a time per subject (C128.6)', async () => {
    const environmentId = await tenant();
    const subject = testId('inq');
    const reopen = { kind: 'reopen', subject_id: subject, human_review_pending: true };

    await expect(
      decision(environmentId, { subject_id: subject, human_review_pending: true }),
    ).rejects.toThrow('inquiry_decisions_pending_is_reopen');
    await expect(decision(environmentId, reopen)).resolves.toBeDefined();
    await expect(decision(environmentId, reopen)).rejects.toThrow(
      'inquiry_decisions_one_review_pending_idx',
    );
  });

  it('is read by subject, newest first', async () => {
    expect(await indexDefinition('inquiry_decisions_subject_created_at_idx')).toContain(
      '(environment_id, subject_id, created_at DESC, id DESC)',
    );
    expect(await indexDefinition('inquiry_decisions_needs_review_idx')).toContain('needs_review');
  });

  it('goes with its environment', async () => {
    const { environment } = await createTestTenant(database.db);
    await decision(environment.id);

    await query(`delete from environments where id = $1`, [environment.id]);

    const left = await query<{ id: string }>(
      `select id from inquiry_decisions where environment_id = $1`,
      [environment.id],
    );
    expect(left.rows).toEqual([]);
  });
});

describe('transaction_children', () => {
  async function transaction(environmentId: string): Promise<string> {
    const type = await seedTransactionType(database.db, environmentId);
    const { id } = await seedTransaction(database.db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    return id;
  }

  const child = (
    environmentId: string,
    transactionId: string,
    type: string,
    id: string,
    run: string = testId('wfr'),
  ) =>
    query(
      `insert into transaction_children (environment_id, transaction_id, child_type, child_id,
         workflow_run_id) values ($1, $2, $3, $4, $5)`,
      [environmentId, transactionId, type, id, run],
    );

  it('takes the four kinds a run creates, each by its own prefix', async () => {
    const environmentId = await tenant();
    const transactionId = await transaction(environmentId);

    await expect(
      child(environmentId, transactionId, 'inquiry', testId('inq')),
    ).resolves.toBeDefined();
    await expect(
      child(environmentId, transactionId, 'verification', testId('ver')),
    ).resolves.toBeDefined();
    await expect(
      child(environmentId, transactionId, 'report', testId('rep')),
    ).resolves.toBeDefined();
    await expect(child(environmentId, transactionId, 'inquiry', testId('rep'))).rejects.toThrow(
      'transaction_children_child_id_format',
    );
    await expect(child(environmentId, transactionId, 'account', testId('acc'))).rejects.toThrow(
      'transaction_children_child_type_valid',
    );
  });

  it('holds a child once, and needs its run', async () => {
    const environmentId = await tenant();
    const transactionId = await transaction(environmentId);
    const inquiryId = testId('inq');

    await child(environmentId, transactionId, 'inquiry', inquiryId);

    await expect(child(environmentId, transactionId, 'inquiry', inquiryId)).rejects.toThrow(
      'transaction_children_pkey',
    );
    await expect(
      child(environmentId, transactionId, 'inquiry', testId('inq'), testId('usr')),
    ).rejects.toThrow('transaction_children_workflow_run_id_format');
  });

  it('names no transaction of another environment', async () => {
    const environmentId = await tenant();
    const transactionId = await transaction(environmentId);
    const other = await tenant();

    await expect(child(other, transactionId, 'inquiry', testId('inq'))).rejects.toThrow(
      'transaction_children_transaction_fk',
    );
  });

  it('is found from the child, so a cascade reads both ways', async () => {
    expect(await indexDefinition('transaction_children_child_idx')).toContain(
      '(environment_id, child_id)',
    );
  });
});

describe('the device trust mark (C127.9)', () => {
  const device = (environmentId: string, overrides: Record<string, unknown> = {}) => {
    const row = {
      id: testId('dev'),
      platform: 'android',
      device_fingerprint: randomBytes(32).toString('hex'),
      collector_version: 1,
      key_id: 'AAAAAAAAAAA',
      first_seen_at: new Date(0).toISOString(),
      last_seen_at: new Date(0).toISOString(),
      ...overrides,
    };
    const names = Object.keys(row);
    return query(
      `insert into devices (environment_id, ${names.join(', ')})
       values ($1, ${names.map((_, index) => `$${String(index + 2)}`).join(', ')})`,
      [environmentId, ...Object.values(row)],
    );
  };
  const trust = {
    trusted_at: new Date(0).toISOString(),
    trusted_by_type: 'workflow-run',
    trusted_by_id: testId('wfr'),
    trust_reason: 'manual_review',
  };

  it('has the three members of the mark', async () => {
    expect(await columnsOf('devices')).toMatchObject({
      trusted_at: 'timestamptz',
      trusted_by_type: 'text',
      trusted_by_id: 'text',
      trust_reason: 'text',
    });
  });

  it('is whole or not at all', async () => {
    const environmentId = await tenant();

    await expect(device(environmentId, trust)).resolves.toBeDefined();
    await expect(device(environmentId, { ...trust, trust_reason: null })).rejects.toThrow(
      'devices_trust_is_whole',
    );
  });

  it('takes a code as its reason, never text, and a closed set of actors', async () => {
    const environmentId = await tenant();

    await expect(device(environmentId, { ...trust, trust_reason: 'Known to me' })).rejects.toThrow(
      'devices_trust_reason_format',
    );
    await expect(
      device(environmentId, { ...trust, trusted_by_type: 'system', trusted_by_id: testId('usr') }),
    ).rejects.toThrow('devices_trusted_by_type_valid');
    await expect(device(environmentId, { ...trust, trusted_by_id: testId('usr') })).rejects.toThrow(
      'devices_trusted_by_id_format',
    );
  });
});

describe('the columns of adverse steps (C122.1, C128.3)', () => {
  it('gives a transaction type its adverse statuses, `declined` by default', async () => {
    const environmentId = await tenant();
    const { id } = await seedTransactionType(database.db, environmentId);

    const stored = await query<{ adverse_statuses: string[]; contest_route: unknown }>(
      `select adverse_statuses, contest_route from transaction_types where id = $1`,
      [id],
    );

    expect(stored.rows[0]).toEqual({ adverse_statuses: ['declined'], contest_route: null });
  });

  it('holds a contest route as an object on both types', async () => {
    const environmentId = await tenant();
    const { id } = await seedTransactionType(database.db, environmentId);

    await expect(
      query(`update transaction_types set contest_route = '"call us"'::jsonb where id = $1`, [id]),
    ).rejects.toThrow('transaction_types_contest_route_object');
    expect(await columnsOf('account_types')).toMatchObject({ contest_route: 'jsonb' });
    await expect(
      query(
        `insert into account_types (id, environment_id, name, contest_route)
         values ($1, $2, 'Business', '[]'::jsonb)`,
        [testId('acctp'), environmentId],
      ),
    ).rejects.toThrow('account_types_contest_route_object');
  });

  it('gives a list its purpose, `block` by default, of a closed set (C122.1)', async () => {
    const environmentId = await tenant();
    const id = await seedList(environmentId);

    const stored = await query<{ purpose: string }>(`select purpose from lists where id = $1`, [
      id,
    ]);

    expect(stored.rows[0]?.purpose).toBe('block');
    await expect(
      query(`update lists set purpose = 'allow' where id = $1`, [id]),
    ).resolves.toBeDefined();
    await expect(query(`update lists set purpose = 'report' where id = $1`, [id])).rejects.toThrow(
      'lists_purpose_valid',
    );
  });

  it('gives a transaction its reviewer, whole, of a closed set (C127.7)', async () => {
    const environmentId = await tenant();
    const type = await seedTransactionType(database.db, environmentId);
    const { id } = await seedTransaction(database.db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    const set = (reviewerType: string | null, reviewerId: string | null) =>
      query(`update transactions set reviewer_type = $1, reviewer_id = $2 where id = $3`, [
        reviewerType,
        reviewerId,
        id,
      ]);

    await expect(set('workflow-run', testId('wfr'))).resolves.toBeDefined();
    await expect(set('user', testId('usr'))).resolves.toBeDefined();
    await expect(set('user', null)).rejects.toThrow('transactions_reviewer_is_whole');
    await expect(set('system', testId('usr'))).rejects.toThrow('transactions_reviewer_type_valid');
    await expect(set('api-key', testId('usr'))).rejects.toThrow('transactions_reviewer_id_format');
  });
});

describe('reports', () => {
  it('takes `workflow` as an origin (C127.2)', async () => {
    const labels = await query<{ enumlabel: string }>(
      `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'report_origin' order by e.enumsortorder`,
    );

    expect(labels.rows.map((row) => row.enumlabel)).toEqual([
      'inquiry_completion',
      'api',
      'dashboard',
      'workflow',
      // C166.5 (Workflow 9B Stage 1b (X); contracts B34): added after it, by 0031.
      'bulk',
    ]);
  });

  async function reportOf(environmentId: string): Promise<string> {
    const { templateId, versionId } = await seedReportTemplate(database.db, environmentId);
    return seedReport(database.db, environmentId, { templateId, versionId });
  }

  const run = (environmentId: string, reportId: string, values: Record<string, unknown>) => {
    const row = { id: testId('rpr'), run_type: 'list_update', ...values };
    const names = Object.keys(row);
    return query(
      `insert into report_runs (environment_id, report_id, ${names.join(', ')})
       values ($1, $2, ${names.map((_, index) => `$${String(index + 3)}`).join(', ')})`,
      [environmentId, reportId, ...Object.values(row)],
    );
  };

  it('lets a `list_update` run name a list and its version (C127.12)', async () => {
    const environmentId = await tenant();
    const reportId = await reportOf(environmentId);
    const listId = await seedList(environmentId);

    await expect(
      run(environmentId, reportId, { trigger_list_id: listId, trigger_list_version: 2 }),
    ).resolves.toBeDefined();
  });

  it('still lets a watchlist `list_update` run keep its sync', async () => {
    const environmentId = await tenant();
    const reportId = await reportOf(environmentId);

    await expect(run(environmentId, reportId, { trigger_sync_id: 7 })).resolves.toBeDefined();
  });

  it('refuses a `list_update` run that names neither, both, or half of a list', async () => {
    const environmentId = await tenant();
    const reportId = await reportOf(environmentId);
    const listId = await seedList(environmentId);
    const check = 'report_runs_trigger_sync_with_list_update';

    await expect(run(environmentId, reportId, {})).rejects.toThrow(check);
    await expect(
      run(environmentId, reportId, {
        trigger_sync_id: 8,
        trigger_list_id: listId,
        trigger_list_version: 3,
      }),
    ).rejects.toThrow(check);
    await expect(run(environmentId, reportId, { trigger_list_id: listId })).rejects.toThrow(check);
    await expect(run(environmentId, reportId, { trigger_list_version: 3 })).rejects.toThrow(check);
  });

  it('refuses a list or a sync on any other run', async () => {
    const environmentId = await tenant();
    const reportId = await reportOf(environmentId);
    const listId = await seedList(environmentId);

    await expect(
      run(environmentId, reportId, {
        run_type: 'manual',
        trigger_list_id: listId,
        trigger_list_version: 3,
      }),
    ).rejects.toThrow('report_runs_trigger_sync_with_list_update');
  });

  it('makes one run per report and list version', async () => {
    const environmentId = await tenant();
    const reportId = await reportOf(environmentId);
    const other = await reportOf(environmentId);
    const listId = await seedList(environmentId);
    const cause = { trigger_list_id: listId, trigger_list_version: 4 };

    await run(environmentId, reportId, cause);

    await expect(run(environmentId, reportId, cause)).rejects.toThrow(
      'report_runs_report_id_trigger_list_key',
    );
    await expect(run(environmentId, other, cause)).resolves.toBeDefined();
    await expect(
      run(environmentId, reportId, { ...cause, trigger_list_version: 5 }),
    ).resolves.toBeDefined();
  });

  it('names no list of another environment', async () => {
    const environmentId = await tenant();
    const reportId = await reportOf(environmentId);
    const listId = await seedList(await tenant());

    await expect(
      run(environmentId, reportId, { trigger_list_id: listId, trigger_list_version: 1 }),
    ).rejects.toThrow('report_runs_trigger_list_fk');
  });
});

describe('list_rescreen_requests (C127.12)', () => {
  const request = (environmentId: string, listId: string, version = 2) =>
    query(
      `insert into list_rescreen_requests (environment_id, list_id, list_version)
       values ($1, $2, $3)`,
      [environmentId, listId, version],
    );

  it('holds one request per list version, so a retry repeats nothing', async () => {
    const environmentId = await tenant();
    const listId = await seedList(environmentId);

    await request(environmentId, listId);

    await expect(request(environmentId, listId)).rejects.toThrow('list_rescreen_requests_pkey');
    await expect(request(environmentId, listId, 3)).resolves.toBeDefined();
  });

  it('names a list of its environment', async () => {
    const environmentId = await tenant();
    const listId = await seedList(await tenant());

    await expect(request(environmentId, listId)).rejects.toThrow('list_rescreen_requests_list_fk');
  });

  it('is an outbox: the sweep reads what is unprocessed', async () => {
    expect(await columnsOf('list_rescreen_requests')).toMatchObject({
      enqueued_at: 'timestamptz',
      processed_at: 'timestamptz',
    });
    expect(await indexDefinition('list_rescreen_requests_unprocessed_idx')).toContain(
      'WHERE (processed_at IS NULL)',
    );
  });
});

describe('what a run creates carries its step (C117.5)', () => {
  const TABLES = [
    'accounts',
    'graph_queries',
    'inquiries',
    'list_items',
    'reports',
    'scheduled_runs',
    'transactions',
    'verifications',
    'workflow_runs',
  ];

  it.each(TABLES)('%s has the key of a repeated attempt', async (table) => {
    expect(await columnsOf(table)).toMatchObject({ workflow_run_step_id: 'text' });
    const key = await indexDefinition(`${table}_workflow_run_step_key`);
    expect(key).toContain('UNIQUE');
    expect(key).toContain('(environment_id, workflow_run_step_id)');
    expect(key).toContain('workflow_run_step_id IS NOT NULL');
  });
});
