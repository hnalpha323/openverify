/**
 * Workflow 8A Stage 1b, checkpoint (E): what `foundation-8a` builds in the engine's repositories.
 *
 * - every sealed column listed for the rewrap, and `kek:rewrap` re-wrapping each (C143.5);
 * - `createEvent` writes the event's cause (C121.3), with none by default;
 * - the event retention keeps what a pending delivery still needs (C118.1), and only that;
 * - the webhook filters on `workflow-ids` and `list-ids`, strict subjects included (C143.4);
 * - run ids are redaction subjects (C143.5);
 * - the settings' defaults (C143.7);
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, encryptBytes, setDefaultKeyring } from '../crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { openJson, sealJson, sealValue, type Sealed } from '../sealed.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { createEvent } from './events.js';
import { deleteExpiredEvents, resolveWorkflowSettings } from './index.js';
import { REWRAP_TABLES, rewrapAll } from './key-rotation.js';
import { subjectIdsIn } from './subject-ids.js';
import { createWebhook, listWebhooksForEvent } from './webhooks.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const oldKeyring = createKeyring(oldKek);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: oldKeyring });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

const tenant = async () => (await createTestTenant(database.db)).environment.id;

/** A workflow, a draft and a run, written by SQL: the engine's writes are `api-engine`'s. */
async function seedRun(environmentId: string) {
  const workflowId = testId('wfl');
  const versionId = testId('wfv');
  const runId = testId('wfr');
  await query(`insert into workflows (id, environment_id, name) values ($1, $2, 'Review')`, [
    workflowId,
    environmentId,
  ]);
  await query(
    `insert into workflow_versions (id, environment_id, workflow_id, version_number, schema_version,
       definition)
     values ($1, $2, $3, 1, 1, '{}'::jsonb)`,
    [versionId, environmentId, workflowId],
  );
  await query(
    `insert into workflow_runs (id, environment_id, workflow_id, workflow_version_id, trigger_type,
       deadline_at, effective_grant, trigger_snapshot, inputs, variables, outputs)
     values ($1, $2, $3, $4, 'trigger-api', now(), '{}'::jsonb, $5, $6, $7, $8)`,
    [
      runId,
      environmentId,
      workflowId,
      versionId,
      sealJson('workflow_runs.trigger_snapshot', runId, { canary: 'snapshot' }),
      sealJson('workflow_runs.inputs', runId, { canary: 'inputs' }),
      sealJson('workflow_runs.variables', runId, { canary: 'variables' }),
      sealJson('workflow_runs.outputs', runId, { canary: 'outputs' }),
    ],
  );
  return { workflowId, versionId, runId };
}

const WORKFLOW_COLUMNS = [
  'scheduled_runs.inputs:row',
  'workflow_run_files.filename:row',
  'workflow_run_files.wrapped_dek:file',
  'workflow_run_steps.console:row',
  'workflow_run_steps.input:row',
  'workflow_run_steps.output:row',
  'workflow_runs.inputs:row',
  'workflow_runs.outputs:row',
  'workflow_runs.trigger_snapshot:row',
  'workflow_runs.variables:row',
  'workflow_step_effects.result:row',
];

describe('C143.5: the sealed engine columns', () => {
  it('are listed for the rewrap, under their seal names', () => {
    expect(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}:${c.aad}`)).toEqual(
      expect.arrayContaining(WORKFLOW_COLUMNS),
    );
    expect(REWRAP_TABLES).toEqual(
      expect.arrayContaining([
        'scheduled_runs',
        'workflow_run_files',
        'workflow_run_steps',
        'workflow_runs',
        'workflow_step_effects',
      ]),
    );
    expect(Object.values(SEALED)).toEqual(
      expect.arrayContaining(
        WORKFLOW_COLUMNS.filter((column) => column.endsWith(':row')).map((column) =>
          column.slice(0, -':row'.length),
        ),
      ),
    );
  });

  it('are re-wrapped by kek:rewrap, so the new KEK alone opens them', async () => {
    const environmentId = await tenant();
    const { workflowId, runId } = await seedRun(environmentId);
    const stepId = testId('wfst');
    await query(
      `insert into workflow_run_steps (id, environment_id, run_id, node_id, node_type, input, output,
         console)
       values ($1, $2, $3, 'run_report', 'action', $4, $5, $6)`,
      [
        stepId,
        environmentId,
        runId,
        sealJson('workflow_run_steps.input', stepId, { canary: 'input' }),
        sealJson('workflow_run_steps.output', stepId, { canary: 'output' }),
        sealJson('workflow_run_steps.console', stepId, { canary: 'console' }),
      ],
    );
    const effectId = testId('wfef');
    await query(
      `insert into workflow_step_effects (id, environment_id, run_id, step_id, effect_key, kind,
         result)
       values ($1, $2, $3, $4, 'key', 'tag_object', $5)`,
      [
        effectId,
        environmentId,
        runId,
        stepId,
        sealJson('workflow_step_effects.result', effectId, { canary: 'result' }),
      ],
    );
    const fileId = testId('wfrf');
    await query(
      `insert into workflow_run_files (id, environment_id, run_id, storage_key, wrapped_dek, filename,
         mime_type, byte_size, sha256)
       values ($1, $2, $3, 'key', $4, $5, 'image/png', 1, $6)`,
      [
        fileId,
        environmentId,
        runId,
        encryptBytes(Buffer.from('synthetic'), oldKeyring, { context: fileId }).wrappedDek,
        sealValue('workflow_run_files.filename', fileId, 'synthetic.png'),
        randomBytes(32).toString('hex'),
      ],
    );
    const scheduledId = testId('srrun');
    await query(
      `insert into scheduled_runs (id, environment_id, target_workflow_id, base_at, offset_value,
         offset_unit, offset_direction, fire_at, inputs)
       values ($1, $2, $3, now(), 1, 'days', 'after', now(), $4)`,
      [
        scheduledId,
        environmentId,
        workflowId,
        sealJson('scheduled_runs.inputs', scheduledId, { canary: 'scheduled' }),
      ],
    );

    await rewrapAll(database.db, { keyring: createKeyring(newKek, [oldKek]) });

    const newOnly = createKeyring(newKek);
    const read = async (table: string, column: string, id: string) => {
      const rows = await query<{ value: Sealed }>(
        `select "${column}" as value from "${table}" where id = $1`,
        [id],
      );
      const value = rows.rows[0]?.value;
      return value === undefined ? undefined : openJson(`${table}.${column}`, id, value, newOnly);
    };
    expect(await read('workflow_runs', 'inputs', runId)).toEqual({ canary: 'inputs' });
    expect(await read('workflow_runs', 'trigger_snapshot', runId)).toEqual({ canary: 'snapshot' });
    expect(await read('workflow_runs', 'variables', runId)).toEqual({ canary: 'variables' });
    expect(await read('workflow_runs', 'outputs', runId)).toEqual({ canary: 'outputs' });
    expect(await read('workflow_run_steps', 'input', stepId)).toEqual({ canary: 'input' });
    expect(await read('workflow_run_steps', 'output', stepId)).toEqual({ canary: 'output' });
    expect(await read('workflow_run_steps', 'console', stepId)).toEqual({ canary: 'console' });
    expect(await read('workflow_step_effects', 'result', effectId)).toEqual({ canary: 'result' });
    expect(await read('scheduled_runs', 'inputs', scheduledId)).toEqual({ canary: 'scheduled' });
    setDefaultKeyring(createKeyring(newKek, [oldKek]));
  });
});

describe('C121.3: an event’s cause', () => {
  it('is written beside the payload, never in it', async () => {
    const environmentId = await tenant();
    const runId = testId('wfr');
    const principal = testId('usr');
    const testRunId = testId('wfr');
    const bulkId = testId('cblk');

    const event = await createEvent(database.db, environmentId, {
      id: testId('evt'),
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry', id: testId('inq') } },
      cause: {
        runId,
        principal,
        testRunId,
        bulkId,
        principalHeldInquiriesWrite: true,
      },
    });

    expect(event).toMatchObject({
      causedByRunId: runId,
      causedByPrincipal: principal,
      causedByTestRunId: testRunId,
      causedByBulkId: bulkId,
      causedByPrincipalHeldInquiriesWrite: true,
    });
    expect(JSON.stringify(event.payload)).not.toContain(principal);
  });

  it('is empty for an event nobody caused', async () => {
    const event = await createEvent(database.db, await tenant(), {
      id: testId('evt'),
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry', id: testId('inq') } },
    });

    expect(event).toMatchObject({
      causedByRunId: null,
      causedByPrincipal: null,
      causedByTestRunId: null,
      causedByBulkId: null,
      causedByPrincipalHeldInquiriesWrite: null,
    });
  });
});

describe('C118.1: the event retention', () => {
  async function seedOldEvent(environmentId: string) {
    const id = testId('evt');
    await createEvent(database.db, environmentId, {
      id,
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry', id: testId('inq') } },
    });
    await query(`update events set created_at = now() - interval '400 days' where id = $1`, [id]);
    return id;
  }

  async function seedDelivery(environmentId: string, workflowId: string, eventId: string) {
    const id = testId('wftd');
    await query(
      `insert into workflow_trigger_deliveries (id, environment_id, event_id, event_name,
         workflow_id)
       values ($1, $2, $3, 'inquiry.completed', $4)`,
      [id, environmentId, eventId, workflowId],
    );
    return id;
  }

  const eventExists = async (id: string) =>
    (await query(`select id from events where id = $1`, [id])).rows.length === 1;

  it('keeps an event a pending delivery still needs', async () => {
    const environmentId = await tenant();
    const { workflowId } = await seedRun(environmentId);
    const eventId = await seedOldEvent(environmentId);
    await seedDelivery(environmentId, workflowId, eventId);

    await deleteExpiredEvents(database.db);

    expect(await eventExists(eventId)).toBe(true);
  });

  it('lets an event go once no delivery is pending, and keeps the delivery row (P27)', async () => {
    const environmentId = await tenant();
    const { workflowId } = await seedRun(environmentId);
    const eventId = await seedOldEvent(environmentId);
    const deliveryId = await seedDelivery(environmentId, workflowId, eventId);
    await query(
      `update workflow_trigger_deliveries set status = 'filtered', reason_code = 'criteria_not_met'
        where id = $1`,
      [deliveryId],
    );

    await deleteExpiredEvents(database.db);

    expect(await eventExists(eventId)).toBe(false);
    const delivery = await query(`select id from workflow_trigger_deliveries where id = $1`, [
      deliveryId,
    ]);
    expect(delivery.rows).toHaveLength(1);
  });
});

describe('C143.4: the webhook filters', () => {
  async function seedWebhook(environmentId: string, filters: Record<string, string[]>) {
    return createWebhook(database.db, environmentId, {
      id: testId('wbh'),
      url: 'https://hooks.example.com/openverify',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic',
      filters,
    });
  }

  it('match a run by its workflow', async () => {
    const environmentId = await tenant();
    const wanted = testId('wfl');
    const webhook = await seedWebhook(environmentId, { 'workflow-ids': [wanted] });

    const hit = await listWebhooksForEvent(database.db, environmentId, 'workflow-run.completed', {
      workflowId: wanted,
      strict: true,
    });
    const miss = await listWebhooksForEvent(database.db, environmentId, 'workflow-run.completed', {
      workflowId: testId('wfl'),
      strict: true,
    });

    expect(hit.map((row) => row.id)).toEqual([webhook.id]);
    expect(miss).toEqual([]);
  });

  it('match a list event by its list', async () => {
    const environmentId = await tenant();
    const wanted = testId('lst');
    const webhook = await seedWebhook(environmentId, { 'list-ids': [wanted] });

    const hit = await listWebhooksForEvent(database.db, environmentId, 'list.updated', {
      listId: wanted,
      strict: true,
    });

    expect(hit.map((row) => row.id)).toEqual([webhook.id]);
    expect(
      await listWebhooksForEvent(database.db, environmentId, 'list.updated', {
        listId: testId('lst'),
        strict: true,
      }),
    ).toEqual([]);
  });

  it('fail a strict subject that lacks the attribute a filter names', async () => {
    const environmentId = await tenant();
    await seedWebhook(environmentId, { 'workflow-ids': [testId('wfl')] });

    expect(
      await listWebhooksForEvent(database.db, environmentId, 'transaction.created', {
        strict: true,
      }),
    ).toEqual([]);
  });

  it('leave a loose subject unfiltered by a key it lacks, as before', async () => {
    const environmentId = await tenant();
    const webhook = await seedWebhook(environmentId, { 'workflow-ids': [testId('wfl')] });

    const hit = await listWebhooksForEvent(database.db, environmentId, 'inquiry.completed', {});

    expect(hit.map((row) => row.id)).toEqual([webhook.id]);
  });
});

describe('C143.5: run ids are redaction subjects', () => {
  it('finds a run id in a copy', () => {
    const runId = testId('wfr');

    expect(subjectIdsIn(JSON.stringify({ data: { id: runId } }))).toContain(runId);
  });
});

describe('C143.7: the workflow settings', () => {
  it('apply the defaults for the keys an environment does not set', () => {
    expect(resolveWorkflowSettings({})).toEqual({
      'workflow-run-retention-days': 30,
      'workflow-run-history-retention-days': 365,
      'workflow-in-flight-cap': 50,
      'workflow-http-ports': [],
      'workflow-http-hosts': null,
      'workflow-http-private-cidrs': [],
      'workflow-email-recipients': [],
      'workflow-sms-recipients': [],
      'workflow-sms-countries': null,
      'workflow-link-hosts': [],
      'case-retention-days': null,
    });
  });

  it('keep what an environment set', () => {
    const settings = resolveWorkflowSettings({
      'workflow-run-retention-days': 7,
      'workflow-http-hosts': ['api.example.com'],
    });

    expect(settings['workflow-run-retention-days']).toBe(7);
    expect(settings['workflow-http-hosts']).toEqual(['api.example.com']);
  });
});
