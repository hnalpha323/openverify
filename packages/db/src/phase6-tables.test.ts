/**
 * C73 (Workflow 6A Stage 1b, F16): the Phase 6 tables, read from the migrated database's
 * catalogs. Every report table is environment-scoped, with composite foreign keys to the
 * `(environment_id, id)` of its parents, as `selfie_captures` has (C73.2); the watchlist tables
 * are install-wide and have no environment (C73.3). Then the migration's other parts: `pg_trgm`,
 * the enums, the indexes the plan names, the inquiry template's `report_config` (C84.1) and the
 * `report_actions` trigger, which refuses every UPDATE but the KEK rewrap and the redaction of
 * `details`, and every DELETE but an environment's deletion (C73.2, P02, F03). Values are
 * synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** C73.2: each environment-scoped Phase 6 table, its primary key and its parents. */
const REPORT_TABLES: Record<string, { key: string[]; parents: [string[], string][] }> = {
  report_templates: { key: ['id'], parents: [] },
  report_template_versions: {
    key: ['id'],
    parents: [[['environment_id', 'report_template_id'], 'report_templates']],
  },
  reports: {
    key: ['id'],
    parents: [
      [['environment_id', 'report_template_id'], 'report_templates'],
      [['environment_id', 'report_template_version_id'], 'report_template_versions'],
      [['environment_id', 'inquiry_id'], 'inquiries'],
      [['environment_id', 'account_id'], 'accounts'],
    ],
  },
  report_accounts: {
    key: ['environment_id', 'report_id', 'account_id'],
    parents: [
      [['environment_id', 'report_id'], 'reports'],
      [['environment_id', 'account_id'], 'accounts'],
    ],
  },
  report_runs: { key: ['id'], parents: [[['environment_id', 'report_id'], 'reports']] },
  report_actions: { key: ['id'], parents: [[['environment_id', 'report_id'], 'reports']] },
  report_matches: {
    key: ['id'],
    parents: [
      [['environment_id', 'report_id'], 'reports'],
      [['environment_id', 'first_run_id'], 'report_runs'],
      [['environment_id', 'last_run_id'], 'report_runs'],
      [['environment_id', 'lapsed_from'], 'report_matches'],
    ],
  },
};

/** C73.3: the install-wide watchlist tables and their primary keys. */
const WATCHLIST_TABLES: Record<string, string[]> = {
  watchlist_sources: ['id'],
  watchlist_syncs: ['id'],
  watchlist_entries: ['source_id', 'entry_id'],
  watchlist_names: ['source_id', 'entry_id', 'ordinal'],
  watchlist_identifiers: ['source_id', 'entry_id', 'ordinal'],
  watchlist_crypto_addresses: ['source_id', 'entry_id', 'ordinal'],
  watchlist_key_df: ['source_id', 'key'],
};

interface Constraint {
  type: 'p' | 'u' | 'f' | 'c';
  columns: string[];
  foreignTable: string | null;
  foreignColumns: string[];
  onDelete: string;
}

async function constraintsOf(table: string): Promise<Constraint[]> {
  const result = await database.client.query<{
    type: Constraint['type'];
    columns: string[] | null;
    foreign_table: string | null;
    foreign_columns: string[] | null;
    on_delete: string;
  }>(
    `select c.contype as type,
            (select array_agg(a.attname order by k.ordinality) from unnest(c.conkey)
               with ordinality as k(attnum, ordinality)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
            f.relname as foreign_table,
            (select array_agg(a.attname order by k.ordinality) from unnest(c.confkey)
               with ordinality as k(attnum, ordinality)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
              as foreign_columns,
            c.confdeltype as on_delete
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       left join pg_class f on f.oid = c.confrelid
      where t.relname = $1`,
    [table],
  );
  return result.rows.map((row) => ({
    type: row.type,
    columns: row.columns ?? [],
    foreignTable: row.foreign_table,
    foreignColumns: row.foreign_columns ?? [],
    onDelete: row.on_delete,
  }));
}

async function columnsOf(table: string): Promise<string[]> {
  const result = await database.client.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = $1`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function indexDefinition(name: string): Promise<string | null> {
  const result = await database.client.query<{ indexdef: string }>(
    `select indexdef from pg_indexes where indexname = $1`,
    [name],
  );
  return result.rows[0]?.indexdef ?? null;
}

describe('C73.1: the migration', () => {
  it('creates pg_trgm itself, and trigram similarity works', async () => {
    const extensions = await database.client.query<{ extname: string }>(
      `select extname from pg_extension order by extname`,
    );
    const similar = await database.client.query<{ similar: boolean }>(
      `select similarity('mueller', 'muller') > 0.3 as similar`,
    );

    expect(extensions.rows.map((row) => row.extname)).toContain('pg_trgm');
    expect(similar.rows[0]?.similar).toBe(true);
  });

  it.each([
    ['report_status', ['pending', 'submitted', 'ready', 'errored']],
    ['report_run_type', ['initial', 'scheduled', 'manual', 'list_update']],
    ['report_action_type', ['dismiss', 'review', 'pause', 'resume', 'run', 'redact']],
    ['report_match_status', ['open', 'dismissed', 'delisted']],
    ['report_review_status', ['pending', 'indeterminate', 'true_positive', 'false_positive']],
    ['report_risk_level', ['material', 'immaterial']],
    // C166.5 (Workflow 9B Stage 1b (X); contracts B34): `bulk`, a report a bulk job created.
    ['report_origin', ['inquiry_completion', 'api', 'dashboard', 'workflow', 'bulk']],
  ])('creates the enum %s', async (name, values) => {
    const result = await database.client.query<{ value: string }>(
      `select e.enumlabel as value from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = $1 order by e.enumsortorder`,
      [name],
    );

    expect(result.rows.map((row) => row.value)).toEqual(values);
  });

  it('gives inquiry template versions a report_config, an empty object by default (C84.1)', async () => {
    const result = await database.client.query<{
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>(
      `select is_nullable, column_default, data_type from information_schema.columns
        where table_name = 'inquiry_template_versions' and column_name = 'report_config'`,
    );

    expect(result.rows).toEqual([
      { is_nullable: 'NO', column_default: "'{}'::jsonb", data_type: 'jsonb' },
    ]);
  });
});

describe('C73.2: every report table is environment-scoped, with composite keys to its parents', () => {
  it.each(Object.entries(REPORT_TABLES))('%s', async (table, { key, parents }) => {
    const constraints = await constraintsOf(table);
    const foreign = constraints
      .filter((constraint) => constraint.type === 'f')
      .map((constraint) => ({
        columns: constraint.columns,
        table: constraint.foreignTable,
        foreignColumns: constraint.foreignColumns,
      }));

    expect(constraints.length, `${table} exists`).toBeGreaterThan(0);
    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([key]);
    expect(
      constraints.find((c) => c.type === 'f' && c.columns.join() === 'environment_id'),
    ).toEqual({
      type: 'f',
      columns: ['environment_id'],
      foreignTable: 'environments',
      foreignColumns: ['id'],
      onDelete: 'c',
    });
    for (const [columns, parent] of parents) {
      expect(foreign).toContainEqual({
        columns,
        table: parent,
        foreignColumns: ['environment_id', 'id'],
      });
    }
    if (key.join() === 'id') {
      expect(constraints.filter((c) => c.type === 'u').map((c) => c.columns)).toContainEqual([
        'environment_id',
        'id',
      ]);
    }
  });
});

describe('C73.3: the watchlist tables are install-wide', () => {
  it.each(Object.entries(WATCHLIST_TABLES))('%s', async (table, key) => {
    const constraints = await constraintsOf(table);

    expect(constraints.length, `${table} exists`).toBeGreaterThan(0);
    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([key]);
    expect(await columnsOf(table)).not.toContain('environment_id');
  });

  it('keeps the columns the sync, the re-screen and the keys version need (V04, V05)', async () => {
    expect(await columnsOf('watchlist_sources')).toEqual(
      expect.arrayContaining([
        'enabled',
        'sandbox_only',
        'keys_version',
        'last_sync_id',
        'last_published_at',
        'last_sha256',
        'last_applied_at',
        'last_checked_at',
        'last_origin',
        'last_error_code',
      ]),
    );
    expect(await columnsOf('watchlist_syncs')).toEqual(
      expect.arrayContaining([
        'outcome',
        'actor',
        'origin',
        'override',
        'keys_version',
        'rescreen_state',
        'rescreen_enqueued_at',
      ]),
    );
    expect(await columnsOf('watchlist_entries')).toEqual(
      expect.arrayContaining([
        'content_hash',
        'risk_data_hash',
        'first_seen_sync_id',
        'last_seen_sync_id',
        'changed_sync_id',
        'removed_at',
      ]),
    );
  });
});

describe('C73.2, C73.3: the indexes the plan names', () => {
  it.each([
    ['reports_environment_id_created_at_id_idx', ['(environment_id, created_at DESC', 'id DESC']],
    [
      'reports_due_idx',
      ['(next_run_at)', 'next_run_at IS NOT NULL', 'paused_at IS NULL', 'redacted_at IS NULL'],
    ],
    ['reports_recurring_idx', ['(environment_id, report_type)', 'next_run_at IS NOT NULL']],
    ['reports_environment_id_inquiry_id_idx', ['(environment_id, inquiry_id)']],
    ['reports_environment_id_account_id_idx', ['(environment_id, account_id)']],
    ['reports_lower_tags_idx', ['USING gin', 'openverify_lower_tags(tags)']],
    ['report_runs_report_id_trigger_sync_id_key', ['UNIQUE', 'trigger_sync_id IS NOT NULL']],
    ['report_runs_claimable_idx', ['(scheduled_for)']],
    [
      'report_matches_report_id_entry_index_evidence_hash_idx',
      ['(report_id, entry_index, evidence_hash)'],
    ],
    ['report_matches_one_live_per_entry_key', ['UNIQUE', '(report_id, entry_index)', 'open']],
    ['watchlist_names_keys_idx', ['USING gin (keys)']],
    ['watchlist_names_normalised_trgm_idx', ['USING gin (normalised gin_trgm_ops)']],
    ['watchlist_identifiers_kind_value_normalised_idx', ['(kind, value_normalised)']],
    ['watchlist_crypto_addresses_canonical_idx', ['(canonical)']],
    ['watchlist_entries_source_id_changed_sync_id_idx', ['(source_id, changed_sync_id)']],
    // Workflow 6D review (rescreen-6d): a changed-entry page is an index range in "C" order.
    [
      'watchlist_entries_changed_page_idx',
      ['(source_id, changed_sync_id, entry_id COLLATE "C")', 'WHERE (removed_at IS NULL)'],
    ],
  ])('%s', async (name, fragments) => {
    const definition = await indexDefinition(name);

    expect(definition, name).not.toBeNull();
    for (const fragment of fragments) {
      expect(definition).toContain(fragment);
    }
    if (!fragments.includes('UNIQUE')) {
      expect(definition).not.toContain('UNIQUE');
    }
  });
});

// The report_actions trigger (C73.2) --------------------------------------------------------

/** A report with one action, written with SQL; returns the ids. */
async function reportWithAction() {
  const { environment } = await createTestTenant(database.db);
  const env = environment.id;
  const template = testId('rptp');
  const version = testId('rptpv');
  const report = testId('rep');
  const action = testId('ract');
  const run = (text: string, params: unknown[]) => database.client.query(text, params);
  await run(
    `insert into report_templates (id, environment_id, name, report_type) values ($1, $2, $3, $4)`,
    [template, env, 'Synthetic watchlist', 'watchlist'],
  );
  await run(
    `insert into report_template_versions (id, environment_id, report_template_id, version,
       config, status, published_at) values ($1, $2, $3, 1, '{}', 'published', now())`,
    [version, env, template],
  );
  await run(
    `insert into reports (id, environment_id, report_type, report_template_id,
       report_template_version_id, origin) values ($1, $2, 'watchlist', $3, $4, 'api')`,
    [report, env, template, version],
  );
  await run(
    `insert into report_actions (id, environment_id, report_id, action_type, actor_type,
       actor_id, details) values ($1, $2, $3, 'dismiss', 'api_key', $4, 'sealed-synthetic')`,
    [action, env, report, testId('key')],
  );
  return { env, report, action };
}

/** Runs `statement` in a transaction with the given transaction-local settings. */
async function inTransaction(
  settings: Record<string, string>,
  statement: string,
  params: unknown[],
): Promise<string> {
  try {
    await database.client.transaction(async (tx) => {
      for (const [name, value] of Object.entries(settings)) {
        await tx.query(`select set_config($1, $2, true)`, [name, value]);
      }
      await tx.query(statement, params);
    });
    return 'accepted';
  } catch (error) {
    return (error as Error).message.includes('report_actions is append-only')
      ? 'refused by the trigger'
      : `failed: ${(error as Error).message}`;
  }
}

describe('C73.2: report_actions is append-only, but for the rewrap and the redaction', () => {
  it('refuses an update of any column without a flag', async () => {
    const { action } = await reportWithAction();

    expect(
      await inTransaction({}, `update report_actions set details = 'other' where id = $1`, [
        action,
      ]),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction({}, `update report_actions set details = null where id = $1`, [action]),
    ).toBe('refused by the trigger');
  });

  it('lets a KEK rewrap give details a new ciphertext, and nothing else', async () => {
    const { action } = await reportWithAction();
    const rewrap = { 'openverify.kek_rewrap': 'on' };

    expect(
      await inTransaction(rewrap, `update report_actions set details = 'rewrapped' where id = $1`, [
        action,
      ]),
    ).toBe('accepted');
    expect(
      await inTransaction(
        rewrap,
        `update report_actions set action_type = 'review', details = 'again' where id = $1`,
        [action],
      ),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction(rewrap, `update report_actions set details = null where id = $1`, [
        action,
      ]),
    ).toBe('refused by the trigger');
  });

  it('lets a report redaction null details, and nothing else', async () => {
    const { action } = await reportWithAction();
    const redaction = { 'openverify.report_redaction': 'on' };

    expect(
      await inTransaction(redaction, `update report_actions set details = 'x' where id = $1`, [
        action,
      ]),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction(redaction, `update report_actions set actor_id = $2 where id = $1`, [
        action,
        testId('usr'),
      ]),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction(redaction, `update report_actions set details = null where id = $1`, [
        action,
      ]),
    ).toBe('accepted');
    const row = await database.client.query<{ details: string | null }>(
      `select details from report_actions where id = $1`,
      [action],
    );
    expect(row.rows).toEqual([{ details: null }]);
  });

  it('refuses a DELETE, but for the deletion of the environment', async () => {
    const { env, action } = await reportWithAction();

    expect(await inTransaction({}, `delete from report_actions where id = $1`, [action])).toBe(
      'refused by the trigger',
    );
    expect(await inTransaction({}, `delete from environments where id = $1`, [env])).toBe(
      'refused by the trigger',
    );
    expect(
      await inTransaction(
        { 'openverify.environment_deletion': 'on' },
        `delete from environments where id = $1`,
        [env],
      ),
    ).toBe('accepted');
  });
});
