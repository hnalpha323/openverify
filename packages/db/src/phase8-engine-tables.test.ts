/**
 * Workflow 8A Stage 1b, checkpoint (E) (plan C117.2, C118, C119.3): the engine tables of migration
 * 0027, read from the migrated database's catalogs.
 *
 * - every table of C117.2, with `scheduled_runs` (C118.3) and `account_actions` (C118.7);
 * - the keys that make a side effect or a delivery exactly once;
 * - the journal, append-only with its two escapes (F12), and its closed vocabulary, so it can never
 *   hold a value;
 * - the wait columns, with the real `xid8` and `pg_snapshot` types C119.3 compares;
 * - the steps table's partial indexes and autovacuum settings;
 * - the four event causes and the fifth member C119.3 reads;
 * - an environment's deletion takes all of it.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

const TABLES = [
  'workflows',
  'workflow_versions',
  'workflow_deployments',
  'workflow_triggers',
  'workflow_trigger_deliveries',
  'workflow_runs',
  'workflow_run_steps',
  'workflow_run_journal',
  'workflow_step_effects',
  'workflow_run_subjects',
  'workflow_run_files',
  'workflow_schedules',
  // Workflow 11B Stage 1b (P): Phase 8's slots are the workflow-step queue's rows (C251.1).
  'queue_slots',
  'workflow_wait_index',
  'workflow_wait_candidates',
  'scheduled_runs',
  'account_actions',
];

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

async function refused(statement: string, params: unknown[], message: string) {
  await expect(query(statement, params), message).rejects.toThrow(message);
}

async function tenant(): Promise<string> {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

async function seedWorkflow(environmentId: string) {
  const id = testId('wfl');
  await query(`insert into workflows (id, environment_id, name) values ($1, $2, 'Review')`, [
    id,
    environmentId,
  ]);
  return id;
}

async function seedVersion(environmentId: string, workflowId: string, versionNumber = 1) {
  const id = testId('wfv');
  await query(
    `insert into workflow_versions (id, environment_id, workflow_id, version_number, schema_version,
       definition)
     values ($1, $2, $3, $4, 1, '{}'::jsonb)`,
    [id, environmentId, workflowId, versionNumber],
  );
  return id;
}

async function seedRun(environmentId: string) {
  const workflowId = await seedWorkflow(environmentId);
  const versionId = await seedVersion(environmentId, workflowId);
  const id = testId('wfr');
  await query(
    `insert into workflow_runs (id, environment_id, workflow_id, workflow_version_id, trigger_type,
       deadline_at, effective_grant)
     values ($1, $2, $3, $4, 'trigger-api', now() + interval '90 days', '{}'::jsonb)`,
    [id, environmentId, workflowId, versionId],
  );
  return { id, workflowId, versionId };
}

async function seedStep(environmentId: string, runId: string, nodeId = 'run_report') {
  const id = testId('wfst');
  await query(
    `insert into workflow_run_steps (id, environment_id, run_id, node_id, node_type)
     values ($1, $2, $3, $4, 'action')`,
    [id, environmentId, runId, nodeId],
  );
  return id;
}

async function appendJournal(environmentId: string, runId: string, kind = 'run_created') {
  await query(
    `insert into workflow_run_journal (environment_id, run_id, kind) values ($1, $2, $3)`,
    [environmentId, runId, kind],
  );
}

/** Runs `statement` in a transaction with the settings; rolled back after an accepted run. */
async function withSettings(settings: readonly string[], statement: string, params: unknown[]) {
  await query('begin');
  try {
    for (const setting of settings) {
      await query(`select set_config($1, 'on', true)`, [setting]);
    }
    await query(statement, params);
  } finally {
    await query('rollback');
  }
}

describe('the engine tables (C117.2)', () => {
  it('exist, each with its environment', async () => {
    for (const table of TABLES) {
      expect(await columnsOf(table), table).toHaveProperty('environment_id');
    }
  });

  it('keep every sealed value in text and every id in plain sight', async () => {
    const runs = await columnsOf('workflow_runs');
    const steps = await columnsOf('workflow_run_steps');
    const effects = await columnsOf('workflow_step_effects');

    expect([
      runs.trigger_snapshot,
      runs.inputs,
      runs.variables,
      runs.outputs,
      steps.input,
      steps.output,
      steps.console,
      effects.result,
    ]).toEqual(Array(8).fill('text'));
  });

  it('name the columns C117.2 lists on a run', async () => {
    expect(Object.keys(await columnsOf('workflow_runs'))).toEqual(
      expect.arrayContaining([
        'workflow_version_id',
        'workflow_deployment_id',
        'rollout_label',
        'status',
        'waiting_on',
        'trigger_type',
        'trigger_delivery_id',
        'schedule_fire',
        'idempotency_key',
        'creator_type',
        'creator_id',
        'root_run_id',
        'parent_run_id',
        'depth',
        'trigger_depth',
        'step_executions',
        'deadline_at',
        'error_type',
        'error_node_id',
        'redacted_at',
        'values_purged_at',
        'subjects_overflow',
      ]),
    );
  });

  it('name the columns C117.2 lists on a step', async () => {
    expect(Object.keys(await columnsOf('workflow_run_steps'))).toEqual(
      expect.arrayContaining([
        'node_id',
        'iteration_path',
        'status',
        'due_at',
        'attempt',
        'claimed_by',
        'claimed_until',
        'enqueued_at',
        'wait_event_names',
        'wait_correlation_key',
        'timeout_at',
        'resolved_by_event_id',
        'join_remaining',
      ]),
    );
  });

  it('refuse an id of the wrong prefix', async () => {
    const environmentId = await tenant();
    await refused(
      `insert into workflows (id, environment_id, name) values ($1, $2, 'Wrong')`,
      [testId('wfv'), environmentId],
      'workflows_id_format',
    );
  });

  it('refuse a run that points at another environment’s version', async () => {
    const first = await tenant();
    const second = await tenant();
    const workflowId = await seedWorkflow(first);
    const versionId = await seedVersion(first, workflowId);
    const otherWorkflow = await seedWorkflow(second);
    await refused(
      `insert into workflow_runs (id, environment_id, workflow_id, workflow_version_id,
         trigger_type, deadline_at, effective_grant)
       values ($1, $2, $3, $4, 'trigger-api', now(), '{}'::jsonb)`,
      [testId('wfr'), second, otherWorkflow, versionId],
      'workflow_runs_version_fk',
    );
  });
});

describe('versions (C116.1)', () => {
  it('hold one draft per workflow', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    await seedVersion(environmentId, workflowId, 1);

    await expect(seedVersion(environmentId, workflowId, 2)).rejects.toThrow(
      'workflow_versions_one_draft_idx',
    );
  });

  it('refuse a published version that does not say what it is and who published it', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    const id = await seedVersion(environmentId, workflowId);
    await refused(
      `update workflow_versions set status = 'published', published_at = now() where id = $1`,
      [id],
      'workflow_versions_published_is_complete',
    );
  });

  it('hold one active rollout per workflow', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    const insert = `insert into workflow_deployments (id, environment_id, workflow_id, versions)
      values ($1, $2, $3, '[]'::jsonb)`;
    await query(insert, [testId('wfd'), environmentId, workflowId]);

    await refused(
      insert,
      [testId('wfd'), environmentId, workflowId],
      'workflow_deployments_one_active_idx',
    );
  });
});

describe('deliveries and run keys (C118.1, C117.2)', () => {
  const insertDelivery = `insert into workflow_trigger_deliveries (id, environment_id, event_id,
      event_name, workflow_id)
    values ($1, $2, $3, 'inquiry.completed', $4)`;

  it('hold one delivery per (event, workflow)', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    const eventId = testId('evt');
    await query(insertDelivery, [testId('wftd'), environmentId, eventId, workflowId]);

    await refused(
      insertDelivery,
      [testId('wftd'), environmentId, eventId, workflowId],
      'workflow_trigger_deliveries_event_workflow_key',
    );
  });

  it('keep a delivery that outlives its event (P27): the event id has no foreign key', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    const id = testId('wftd');

    await query(insertDelivery, [id, environmentId, testId('evt'), workflowId]);

    const rows = await query(`select status from workflow_trigger_deliveries where id = $1`, [id]);
    expect(rows.rows).toEqual([{ status: 'pending' }]);
  });

  it('say why a delivery did not start a run, in a code', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    const id = testId('wftd');
    await query(insertDelivery, [id, environmentId, testId('evt'), workflowId]);

    await refused(
      `update workflow_trigger_deliveries set status = 'refused' where id = $1`,
      [id],
      'workflow_trigger_deliveries_reason_with_status',
    );
    await refused(
      `update workflow_trigger_deliveries set status = 'refused', reason_code = 'Refused: x y'
        where id = $1`,
      [id],
      'workflow_trigger_deliveries_reason_code_format',
    );
  });

  it('start one run per delivery, schedule fire and idempotency key', async () => {
    const environmentId = await tenant();
    const { id, workflowId, versionId } = await seedRun(environmentId);
    const deliveryId = testId('wftd');
    await query(
      `update workflow_runs set trigger_delivery_id = $1, schedule_fire = 'fire',
         idempotency_key = 'key'
       where id = $2`,
      [deliveryId, id],
    );
    const again = (column: string, value: string) =>
      refused(
        `insert into workflow_runs (id, environment_id, workflow_id, workflow_version_id,
           trigger_type, deadline_at, effective_grant, ${column})
         values ($1, $2, $3, $4, 'trigger-api', now(), '{}'::jsonb, $5)`,
        [testId('wfr'), environmentId, workflowId, versionId, value],
        `workflow_runs_${column === 'trigger_delivery_id' ? 'trigger_delivery_key' : column === 'schedule_fire' ? 'schedule_fire_key' : 'workflow_idempotency_key'}`,
      );

    await again('trigger_delivery_id', deliveryId);
    await again('schedule_fire', 'fire');
    await again('idempotency_key', 'key');
  });

  it('hold codes alone in a run’s error columns (C120.2)', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await refused(
      `update workflow_runs set status = 'errored', completed_at = now(),
         error_type = 'the applicant, a person'
       where id = $1`,
      [id],
      'workflow_runs_error_type_format',
    );
  });

  it('let an errored run alone carry an error type', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await refused(
      `update workflow_runs set status = 'errored', completed_at = now() where id = $1`,
      [id],
      'workflow_runs_errored_says_why',
    );
  });

  it('take a run’s skeleton after its parent’s is gone: no foreign key between runs', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);

    await query(`update workflow_runs set parent_run_id = $1, root_run_id = $1 where id = $2`, [
      testId('wfr'),
      id,
    ]);

    const rows = await query(`select depth from workflow_runs where id = $1`, [id]);
    expect(rows.rows).toEqual([{ depth: 0 }]);
  });
});

describe('steps (C117.2, C117.3)', () => {
  it('hold one row per node and iteration path', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await seedStep(environmentId, id);

    await expect(seedStep(environmentId, id)).rejects.toThrow(
      'workflow_run_steps_run_node_iteration_key',
    );
  });

  it('index ready, waiting and running partially, so a finished step leaves them', async () => {
    expect(await indexDefinition('workflow_run_steps_ready_idx')).toContain("'ready'");
    expect(await indexDefinition('workflow_run_steps_running_idx')).toContain("'running'");
    expect(await indexDefinition('workflow_run_steps_waiting_timeout_idx')).toContain("'waiting'");
    expect(await indexDefinition('workflow_run_steps_waiting_due_idx')).toContain("'waiting'");
    expect(await indexDefinition('workflow_run_steps_waiting_key_idx')).toContain("'waiting'");
  });

  it('carry a lower autovacuum scale factor (engine note 2.4)', async () => {
    const result = await query<{ reloptions: string[] }>(
      `select reloptions from pg_class where relname = 'workflow_run_steps'`,
    );

    expect(result.rows[0]?.reloptions).toEqual(
      expect.arrayContaining([
        'autovacuum_vacuum_scale_factor=0.02',
        'autovacuum_analyze_scale_factor=0.02',
      ]),
    );
  });

  it('refuse a running step with no claim (C117.3)', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    const stepId = await seedStep(environmentId, id);
    await refused(
      `update workflow_run_steps set status = 'running' where id = $1`,
      [stepId],
      'workflow_run_steps_claim_with_running',
    );
  });

  it('hold the wait’s snapshot and transaction id in the types C119.3 compares', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    const stepId = await seedStep(environmentId, id);
    await query(
      `update workflow_run_steps
          set status = 'waiting', waiting_snapshot = pg_current_snapshot(),
              waiting_xact = pg_current_xact_id()
        where id = $1`,
      [stepId],
    );

    const result = await query<{ visible: boolean }>(
      `select pg_visible_in_snapshot(waiting_xact, waiting_snapshot) as visible
         from workflow_run_steps where id = $1`,
      [stepId],
    );

    expect(typeof result.rows[0]?.visible).toBe('boolean');
    const columns = await columnsOf('workflow_run_steps');
    expect([columns.waiting_snapshot, columns.waiting_xact]).toEqual(['pg_snapshot', 'xid8']);
  });
});

describe('effects (C117.5)', () => {
  it('hold one row per effect key', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    const stepId = await seedStep(environmentId, id);
    const insert = `insert into workflow_step_effects (id, environment_id, run_id, step_id,
        effect_key, kind)
      values ($1, $2, $3, $4, $5, 'tag_object')`;
    const key = `${id}/run_report/`;
    await query(insert, [testId('wfef'), environmentId, id, stepId, key]);

    await refused(
      insert,
      [testId('wfef'), environmentId, id, stepId, key],
      'workflow_step_effects_effect_key',
    );
  });
});

describe('the journal is append-only (F12)', () => {
  it('refuses an update, whatever the settings', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await appendJournal(environmentId, id);
    const update = `update workflow_run_journal set kind = 'run_resumed' where run_id = $1`;

    await refused(update, [id], 'append-only');
    await expect(
      withSettings(['openverify.retention', 'openverify.environment_deletion'], update, [id]),
    ).rejects.toThrow('append-only');
  });

  it('refuses a delete outside the two escapes', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await appendJournal(environmentId, id);

    await refused(`delete from workflow_run_journal where run_id = $1`, [id], 'append-only');
  });

  it('takes a delete under the C16 pass', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await appendJournal(environmentId, id);

    await expect(
      withSettings(['openverify.retention'], `delete from workflow_run_journal where run_id = $1`, [
        id,
      ]),
    ).resolves.toBeUndefined();
  });

  it('takes a delete under an environment’s deletion', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await appendJournal(environmentId, id);

    await expect(
      withSettings(
        ['openverify.environment_deletion'],
        `delete from workflow_run_journal where run_id = $1`,
        [id],
      ),
    ).resolves.toBeUndefined();
  });

  it('holds a closed vocabulary, so a kind can never be a value', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);

    await expect(appendJournal(environmentId, id, 'the applicant')).rejects.toThrow(
      'workflow_run_journal_kind_valid',
    );
  });
});

describe('the wait index and candidates (C119.3)', () => {
  it('stamps a candidate with its own transaction id', async () => {
    const environmentId = await tenant();
    const eventId = testId('evt');
    await query(
      `insert into workflow_wait_candidates (event_id, environment_id, event_name, subject_ids)
       values ($1, $2, 'inquiry.completed', array['inq_x'])`,
      [eventId, environmentId],
    );

    const result = await query<{ type: string }>(
      `select pg_typeof(xact)::text as type from workflow_wait_candidates where event_id = $1`,
      [eventId],
    );

    expect(result.rows).toEqual([{ type: 'xid8' }]);
  });

  it('records each waited-on (environment, event) of a version once', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    const versionId = await seedVersion(environmentId, workflowId);
    const insert = `insert into workflow_wait_index (environment_id, event_name, workflow_version_id)
      values ($1, 'report/watchlist.matched', $2)`;
    await query(insert, [environmentId, versionId]);

    await refused(insert, [environmentId, versionId], 'workflow_wait_index_pkey');
  });
});

describe('the rest of the engine’s rows', () => {
  it('holds a run file only with its key and name until it is redacted (C118.2, C120.9)', async () => {
    const environmentId = await tenant();
    const { id } = await seedRun(environmentId);
    await refused(
      `insert into workflow_run_files (id, environment_id, run_id, storage_key, mime_type,
         byte_size, sha256)
       values ($1, $2, $3, 'k', 'image/png', 1, $4)`,
      [testId('wfrf'), environmentId, id, randomBytes(32).toString('hex')],
      'workflow_run_files_held_until_redacted',
    );
  });

  it('takes a cron or an interval, never both (C118.4)', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    await refused(
      `insert into workflow_schedules (id, environment_id, workflow_id, cron, every_minutes,
         time_zone, object_type, next_fire_at)
       values ($1, $2, $3, '0 9 * * *', 5, 'UTC', 'inquiry', now())`,
      [testId('wfsc'), environmentId, workflowId],
      'workflow_schedules_cron_or_every',
    );
  });

  it('caps a tick at 1,000 objects (C118.4)', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    await refused(
      `insert into workflow_schedules (id, environment_id, workflow_id, every_minutes, time_zone,
         object_type, next_fire_at, batch_cap)
       values ($1, $2, $3, 5, 'UTC', 'inquiry', now(), 1001)`,
      [testId('wfsc'), environmentId, workflowId],
      'workflow_schedules_batch_cap_range',
    );
  });

  it('holds a scheduled run’s offset (C118.3)', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    await refused(
      `insert into scheduled_runs (id, environment_id, target_workflow_id, base_at, offset_value,
         offset_unit, offset_direction, fire_at)
       values ($1, $2, $3, now(), 1, 'weeks', 'after', now())`,
      [testId('srrun'), environmentId, workflowId],
      'scheduled_runs_offset_unit_valid',
    );
  });

  it('binds an account action to an account type of its own environment (C118.7)', async () => {
    const environmentId = await tenant();
    const workflowId = await seedWorkflow(environmentId);
    await refused(
      `insert into account_actions (id, environment_id, workflow_id, account_type_id, label)
       values ($1, $2, $3, $4, 'Review')`,
      [testId('accac'), environmentId, workflowId, testId('acctp')],
      'account_actions_account_type_fk',
    );
  });
});

describe('an event’s cause (C118.8, C121.3)', () => {
  it('sits on columns, never in the payload', async () => {
    const columns = await columnsOf('events');

    expect(columns).toMatchObject({
      caused_by_run_id: 'text',
      caused_by_principal: 'text',
      caused_by_test_run_id: 'text',
      caused_by_bulk_id: 'text',
      caused_by_principal_held_inquiries_write: 'bool',
    });
  });

  it('refuses a principal that is no user or key', async () => {
    const environmentId = await tenant();
    await refused(
      `insert into events (id, environment_id, name, payload, caused_by_principal)
       values ($1, $2, 'inquiry.created', 'sealed', 'someone')`,
      [testId('evt'), environmentId],
      'events_caused_by_principal_format',
    );
  });
});

describe('an environment’s deletion', () => {
  it('takes every engine row with it', async () => {
    const environmentId = await tenant();
    const { id, workflowId, versionId } = await seedRun(environmentId);
    const stepId = await seedStep(environmentId, id);
    await appendJournal(environmentId, id);
    await query(
      `insert into workflow_triggers (environment_id, kind, event_name, workflow_id,
         workflow_version_id)
       values ($1, 'trigger-event', 'inquiry.completed', $2, $3)`,
      [environmentId, workflowId, versionId],
    );
    await query(
      `insert into workflow_step_effects (id, environment_id, run_id, step_id, effect_key, kind)
       values ($1, $2, $3, $4, 'key', 'tag_object')`,
      [testId('wfef'), environmentId, id, stepId],
    );
    await query(
      `insert into workflow_run_subjects (environment_id, run_id, subject_id, source)
       values ($1, $2, 'inq_x', 'trigger')`,
      [environmentId, id],
    );
    await query(
      `insert into queue_slots (environment_id, queue, last_served_at)
       values ($1, 'workflow-step', now())`,
      [environmentId],
    );

    await query('begin');
    await query(`select set_config('openverify.environment_deletion', 'on', true)`);
    await query(`delete from environments where id = $1`, [environmentId]);
    await query('commit');

    for (const table of TABLES) {
      const rows = await query<{ count: number }>(
        `select count(*)::int as count from ${table} where environment_id = $1`,
        [environmentId],
      );
      expect(rows.rows, table).toEqual([{ count: 0 }]);
    }
  });
});
