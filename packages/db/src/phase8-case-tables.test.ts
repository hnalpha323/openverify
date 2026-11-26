/**
 * Workflow 8B Stage 1b, checkpoint (C) (plan C129-C137, C140.1, C134.4): the case tables of migration
 * 0028, read from the migrated database's catalogs.
 *
 * - templates and their versions: one draft and one published per template, and a name counter;
 * - cases pinned to a version of their own environment, with names unique per environment, sealed
 *   fields, whole actor pairs and their step key (C117.5);
 * - one join table per held kind (C136.1), whose composite keys refuse another environment's object,
 *   and which hold an object once;
 * - comments with a sealed message until redacted; the history, append-only with its two escapes
 *   (F12) and a closed vocabulary of kinds, so it can never hold a value;
 * - case actions and their templates, notifications, the searchable-field keys and bulk actions;
 * - an API key's `case_template_ids` (C129.4) and the format of `events.caused_by_bulk_id`;
 * - an environment's deletion takes all of it.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
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

const TABLES = [
  'case_templates',
  'case_template_versions',
  'case_name_counters',
  'cases',
  'case_inquiries',
  'case_accounts',
  'case_reports',
  'case_report_runs',
  'case_transactions',
  'case_verifications',
  'case_graph_queries',
  'case_comments',
  'case_history',
  'case_actions',
  'case_action_templates',
  'user_notifications',
  'case_field_keys',
  'case_bulk_actions',
  'case_notification_emails',
];

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = await query<{ column_name: string; udt_name: string }>(
    `select column_name, udt_name from information_schema.columns where table_name = $1`,
    [table],
  );
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.udt_name]));
}

async function refused(statement: string, params: unknown[], message: string) {
  await expect(query(statement, params), message).rejects.toThrow(message);
}

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

async function tenant(): Promise<string> {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

const STATUSES = JSON.stringify([
  { key: 'open', label: 'Open', category: 'initial' },
  { key: 'approved', label: 'Approved', category: 'end' },
]);

async function seedTemplate(environmentId: string, key = `K${testId('ctmpl').slice(-6)}`) {
  const id = testId('ctmpl');
  await query(
    `insert into case_templates (id, environment_id, name, key) values ($1, $2, 'Review', $3)`,
    [id, environmentId, key],
  );
  return { id, key };
}

async function seedVersion(
  environmentId: string,
  templateId: string,
  input: { version?: number; status?: string } = {},
) {
  const id = testId('ctmplv');
  const status = input.status ?? 'published';
  await query(
    `insert into case_template_versions (id, environment_id, case_template_id, version, status,
       statuses, published_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      id,
      environmentId,
      templateId,
      input.version ?? 1,
      status,
      STATUSES,
      status === 'draft' ? null : new Date().toISOString(),
    ],
  );
  return id;
}

let cases = 0;

async function seedCase(
  environmentId: string,
  input: { templateId?: string; versionId?: string; name?: string; id?: string } = {},
) {
  const template =
    input.templateId === undefined ? await seedTemplate(environmentId) : { id: input.templateId };
  const versionId = input.versionId ?? (await seedVersion(environmentId, template.id));
  const id = input.id ?? testId('case');
  await query(
    `insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
       status, status_category, creator_type, creator_id, fields)
     values ($1, $2, $3, $4, $5, 'open', 'initial', 'user', $6, 'sealed-canary')`,
    [
      id,
      environmentId,
      template.id,
      versionId,
      input.name ?? `KYC-${String((cases += 1))}`,
      testId('usr'),
    ],
  );
  return { id, templateId: template.id, versionId };
}

describe('the case tables (C129-C137)', () => {
  it('exist, each with its environment', async () => {
    for (const table of TABLES) {
      expect(await columnsOf(table), table).toHaveProperty('environment_id');
    }
  });

  it('hold a case’s public attributes, its sealed fields and its step', async () => {
    expect(await columnsOf('cases')).toEqual({
      id: 'text',
      environment_id: 'text',
      case_template_id: 'text',
      case_template_version_id: 'text',
      name: 'text',
      status: 'text',
      status_category: 'text',
      resolution: 'text',
      case_queue_id: 'text',
      creator_type: 'text',
      creator_id: 'text',
      assignee_id: 'text',
      assigner_type: 'text',
      assigner_id: 'text',
      assigned_at: 'timestamptz',
      resolver_type: 'text',
      resolver_id: 'text',
      resolved_at: 'timestamptz',
      updater_type: 'text',
      updater_id: 'text',
      tags: '_text',
      fields: 'text',
      lock_version: 'int4',
      redacted_at: 'timestamptz',
      workflow_run_step_id: 'text',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
      // Checkpoint (Q) (C133.4): the SLA, as `phase8-case-queue-tables.test.ts` reads it.
      sla_state: 'text',
      sla_epoch: 'int4',
      sla_consumed_ms: 'int8',
      sla_segment_started_at: 'timestamptz',
      sla_expires_at: 'timestamptz',
      sla_expired_at: 'timestamptz',
      sla_met_at: 'timestamptz',
      sla_target_ms: 'int8',
      sla_policy_id: 'text',
      sla_policy_revision: 'int4',
      sla_case_calendar_id: 'text',
      sla_on_reopen: 'text',
    });
  });
});

describe('templates and versions (C130)', () => {
  it('hold a key once per environment, and another environment may hold it too', async () => {
    const first = await tenant();
    const second = await tenant();
    await seedTemplate(first, 'KYC');

    await expect(seedTemplate(first, 'KYC')).rejects.toThrow(
      'case_templates_environment_id_key_key',
    );
    await expect(seedTemplate(second, 'KYC')).resolves.toMatchObject({ key: 'KYC' });
  });

  it('refuse a key outside C130.1’s pattern', async () => {
    await expect(seedTemplate(await tenant(), 'kyc')).rejects.toThrow('case_templates_key_format');
  });

  it('keep one draft and one published version per template', async () => {
    const environmentId = await tenant();
    const { id } = await seedTemplate(environmentId);
    await seedVersion(environmentId, id, { version: 1 });
    await seedVersion(environmentId, id, { version: 2, status: 'draft' });

    await expect(seedVersion(environmentId, id, { version: 3 })).rejects.toThrow(
      'case_template_versions_one_published_key',
    );
    await expect(seedVersion(environmentId, id, { version: 3, status: 'draft' })).rejects.toThrow(
      'case_template_versions_one_draft_key',
    );
  });

  it('are published exactly when they are no longer drafts', async () => {
    const environmentId = await tenant();
    const { id } = await seedTemplate(environmentId);

    await refused(
      `insert into case_template_versions (id, environment_id, case_template_id, version, status,
         statuses)
       values ($1, $2, $3, 1, 'published', $4::jsonb)`,
      [testId('ctmplv'), environmentId, id, STATUSES],
      'case_template_versions_published_at',
    );
  });

  it('count a template’s cases from one row', async () => {
    const environmentId = await tenant();
    const { id } = await seedTemplate(environmentId);
    const next = `insert into case_name_counters (environment_id, case_template_id, last_value)
       values ($1, $2, 1)
       on conflict (environment_id, case_template_id)
       do update set last_value = case_name_counters.last_value + 1
       returning last_value`;

    await query(next, [environmentId, id]);
    const second = await query<{ last_value: string }>(next, [environmentId, id]);

    expect(Number(second.rows[0]?.last_value)).toBe(2);
  });
});

describe('cases (C129.2, C131)', () => {
  it('take a name once per environment', async () => {
    const environmentId = await tenant();
    await seedCase(environmentId, { name: 'KYC-1' });

    await expect(seedCase(environmentId, { name: 'KYC-1' })).rejects.toThrow(
      'cases_environment_id_name_key',
    );
    await expect(seedCase(await tenant(), { name: 'KYC-1' })).resolves.toBeDefined();
  });

  it('pin a version of their own environment', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    const template = await seedTemplate(other);
    const versionId = await seedVersion(other, template.id);

    await expect(seedCase(environmentId, { templateId: template.id, versionId })).rejects.toThrow(
      'cases_template_fk',
    );
  });

  it('keep their fields until redacted', async () => {
    const environmentId = await tenant();
    const { id } = await seedCase(environmentId);

    await refused(
      `update cases set fields = null where id = $1`,
      [id],
      'cases_fields_until_redacted',
    );
    await expect(
      query(`update cases set fields = null, redacted_at = now() where id = $1`, [id]),
    ).resolves.toBeDefined();
  });

  it('refuse half an actor, or an id of another type', async () => {
    const environmentId = await tenant();
    const { id } = await seedCase(environmentId);

    await refused(
      `update cases set assigner_type = 'user' where id = $1`,
      [id],
      'cases_assigner_is_whole',
    );
    await refused(
      `update cases set resolver_type = 'workflow-run', resolver_id = $2 where id = $1`,
      [id, testId('usr')],
      'cases_resolver_id_format',
    );
    await refused(
      `update cases set assigner_type = 'case-assignment-policy', assigner_id = $2 where id = $1`,
      [id, testId('usr')],
      'cases_assigner_id_format',
    );
  });

  it('are resolved exactly while in an end status', async () => {
    const environmentId = await tenant();
    const { id } = await seedCase(environmentId);

    await refused(
      `update cases set status = 'approved', status_category = 'end' where id = $1`,
      [id],
      'cases_resolved_in_end',
    );
    await expect(
      query(
        `update cases set status = 'approved', status_category = 'end', resolved_at = now()
         where id = $1`,
        [id],
      ),
    ).resolves.toBeDefined();
  });

  it('carry the step of the run that created one, once (C117.5)', async () => {
    const environmentId = await tenant();
    const step = testId('wfst');
    const { id } = await seedCase(environmentId);
    await query(`update cases set workflow_run_step_id = $2 where id = $1`, [id, step]);
    const second = await seedCase(environmentId);

    await refused(
      `update cases set workflow_run_step_id = $2 where id = $1`,
      [second.id, step],
      'cases_workflow_run_step_key',
    );
  });
});

describe('held objects (C136.1, C136.3)', () => {
  it('hold an inquiry once, as attached, by who attached it', async () => {
    const environmentId = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const { id } = await seedCase(environmentId);
    const attach = `insert into case_inquiries (environment_id, case_id, inquiry_id,
        attached_by_type, attached_by_id, attached_state)
      values ($1, $2, $3, 'user', $4, '{"status":"created"}'::jsonb)`;
    await query(attach, [environmentId, id, inquiry.id, testId('usr')]);

    await refused(attach, [environmentId, id, inquiry.id, testId('usr')], 'case_inquiries_pkey');
  });

  it('refuse another environment’s object', async () => {
    const environmentId = await tenant();
    const { inquiry } = await createTestInquiry(database.db, await tenant());
    const { id } = await seedCase(environmentId);

    await refused(
      `insert into case_inquiries (environment_id, case_id, inquiry_id, attached_by_type,
         attached_by_id)
       values ($1, $2, $3, 'user', $4)`,
      [environmentId, id, inquiry.id, testId('usr')],
      'case_inquiries_inquiry_fk',
    );
  });

  it('read a document as a verification it holds', async () => {
    const columns = await columnsOf('case_verifications');

    expect(columns).toMatchObject({ verification_id: 'text', held_as: 'text' });
  });
});

describe('comments (C134)', () => {
  it('keep a sealed message until redacted, with whole commenters and at most 50 mentions', async () => {
    const environmentId = await tenant();
    const { id: caseId } = await seedCase(environmentId);
    const id = testId('cscm');
    await query(
      `insert into case_comments (id, environment_id, case_id, message, commenter_type,
         commenter_id, mentions)
       values ($1, $2, $3, 'sealed-canary', 'user', $4, $5)`,
      [id, environmentId, caseId, testId('usr'), [testId('usr')]],
    );

    await refused(
      `update case_comments set message = null where id = $1`,
      [id],
      'case_comments_message_until_redacted',
    );
    await refused(
      `update case_comments set mentions = $2 where id = $1`,
      [id, Array.from({ length: 51 }, () => testId('usr'))],
      'case_comments_mentions_count',
    );
  });
});

describe('the history is append-only (C131.4, F12)', () => {
  async function seedHistory(environmentId: string) {
    const { id } = await seedCase(environmentId);
    await query(
      `insert into case_history (environment_id, case_id, kind, actor_type, actor_id, "to")
       values ($1, $2, 'created', 'user', $3, '{"status":"open"}'::jsonb)`,
      [environmentId, id, testId('usr')],
    );
    return id;
  }

  it('refuses an update, whatever the settings', async () => {
    const id = await seedHistory(await tenant());
    const update = `update case_history set kind = 'redacted' where case_id = $1`;

    await refused(update, [id], 'append-only');
    await expect(
      withSettings(['openverify.retention', 'openverify.environment_deletion'], update, [id]),
    ).rejects.toThrow('append-only');
  });

  it('refuses a delete outside the two escapes, and takes one under them', async () => {
    const id = await seedHistory(await tenant());
    const remove = `delete from case_history where case_id = $1`;

    await refused(remove, [id], 'append-only');
    await expect(withSettings(['openverify.retention'], remove, [id])).resolves.toBeUndefined();
    await expect(
      withSettings(['openverify.environment_deletion'], remove, [id]),
    ).resolves.toBeUndefined();
  });

  it('holds a closed vocabulary of kinds and whole actors', async () => {
    const environmentId = await tenant();
    const { id } = await seedCase(environmentId);
    const insert = `insert into case_history (environment_id, case_id, kind, actor_type, actor_id)
       values ($1, $2, $3, $4, $5)`;

    await refused(
      insert,
      [environmentId, id, 'a value', 'user', testId('usr')],
      'case_history_kind_valid',
    );
    await refused(
      insert,
      [environmentId, id, 'assigned', 'system', testId('usr')],
      'case_history_actor_valid',
    );
    await expect(
      query(insert, [environmentId, id, 'assigned', 'case-assignment-policy', testId('cap')]),
    ).resolves.toBeDefined();
  });
});

describe('case actions, notifications, field keys and bulk actions', () => {
  it('bind an action to the templates it is offered on', async () => {
    const environmentId = await tenant();
    const workflowId = testId('wfl');
    await query(`insert into workflows (id, environment_id, name) values ($1, $2, 'Escalate')`, [
      workflowId,
      environmentId,
    ]);
    const { id: templateId } = await seedTemplate(environmentId);
    const id = testId('cact');
    await query(
      `insert into case_actions (id, environment_id, workflow_id, label)
       values ($1, $2, $3, 'Escalate')`,
      [id, environmentId, workflowId],
    );
    const bind = `insert into case_action_templates (environment_id, case_action_id,
        case_template_id) values ($1, $2, $3)`;
    await query(bind, [environmentId, id, templateId]);

    await refused(bind, [environmentId, id, templateId], 'case_action_templates_pkey');
  });

  it('notify a user of a kind, about a case, and nothing else', async () => {
    // C169.7 (Workflow 9B Stage 1b (W)): a webhook failure names its webhook, and both subjects are
    // read as `subject_type` and `subject_id`.
    expect(await columnsOf('user_notifications')).toEqual({
      id: 'text',
      environment_id: 'text',
      user_id: 'text',
      kind: 'text',
      case_id: 'text',
      webhook_id: 'text',
      subject_type: 'text',
      subject_id: 'text',
      read_at: 'timestamptz',
      created_at: 'timestamptz',
    });
  });

  it('key a searchable field by a 64-hex digest', async () => {
    const environmentId = await tenant();
    const { id } = await seedCase(environmentId);

    await refused(
      `insert into case_field_keys (environment_id, case_id, field_key, value_key)
       values ($1, $2, 'tax_id', 'not-a-digest')`,
      [environmentId, id],
      'case_field_keys_value_key_hex',
    );
  });

  it('keep a bulk action’s request sealed and its outcomes as codes', async () => {
    const columns = await columnsOf('case_bulk_actions');

    expect(columns).toMatchObject({ request: 'text', outcomes: 'jsonb', creator_id: 'text' });
  });
});

describe('beside the case tables (C129.4, C121.3)', () => {
  it('give an API key an optional list of case templates', async () => {
    expect(await columnsOf('api_keys')).toHaveProperty('case_template_ids', '_text');
  });

  it('format an event’s bulk cause as a bulk action’s id', async () => {
    const result = await query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conname = 'events_caused_by_bulk_id_format'`,
    );

    expect(result.rows[0]?.definition).toContain('cblk_');
  });

  it('go with their environment', async () => {
    const environmentId = await tenant();
    const { id } = await seedCase(environmentId);
    await query(
      `insert into case_history (environment_id, case_id, kind, actor_type, actor_id)
       values ($1, $2, 'created', 'user', $3)`,
      [environmentId, id, testId('usr')],
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
