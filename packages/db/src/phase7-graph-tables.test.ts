/**
 * Workflow 7B Stage 1b, checkpoint (G) (plan C101, C102): the graph tables of migration 0024, read
 * from the migrated database's catalogs.
 *
 * - `graph_attributes` (C101.1): one row per account, value and source; the frozen kind code, a
 *   64-hex value key (F10), the key id; no degree table (F24);
 * - `graph_index_jobs` (C101.3), the outbox of an inquiry's first move out of `pending`;
 * - `graph_index_state` (C101.5, H10) and `graph_components` (C101.6);
 * - `graph_query_templates` and `graph_query_template_versions` (C102.1, as C71);
 * - `graph_queries` (C102.4) with its sealed `params` and a result of ids only (P17).
 *
 * Every value is synthetic; every digest is random hex.
 */
import { randomBytes } from 'node:crypto';
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

const digest = () => randomBytes(32).toString('hex');
const KEY_ID = 'AbCdEfGh_-1';

const TABLES = [
  'graph_attributes',
  'graph_index_jobs',
  'graph_index_state',
  'graph_components',
  'graph_query_templates',
  'graph_query_template_versions',
  'graph_queries',
];

const UPDATED_AT_TABLES = [
  'graph_index_jobs',
  'graph_index_state',
  'graph_query_templates',
  'graph_query_template_versions',
  'graph_queries',
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

/** A constraint's columns, in order (a primary or foreign key). */
async function constraintColumns(name: string) {
  const result = await query<{ columns: string[]; parents: string[] | null }>(
    `select array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                   order by k.ord) as columns,
            case when c.confkey is null then null else
            array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
                   order by k.ord) end as parents
       from pg_constraint c where c.conname = $1`,
    [name],
  );
  return result.rows;
}

async function refused(statement: string, params: unknown[], constraint: string) {
  await expect(query(statement, params), constraint).rejects.toThrow(constraint);
}

async function tenant() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiry: inquiry.id, accountId: inquiry.accountId };
}

const insertAttribute = (values: {
  environmentId: string;
  accountId: string;
  kind?: number;
  valueKey?: string;
  keyId?: string;
  sourceType?: string;
  sourceId?: string;
  inquiryId?: string | null;
}) =>
  query(
    `insert into graph_attributes (environment_id, kind, value_key, key_id, account_id,
       source_type, source_id, inquiry_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      values.environmentId,
      values.kind ?? 4,
      values.valueKey ?? digest(),
      values.keyId ?? KEY_ID,
      values.accountId,
      values.sourceType ?? 'account',
      values.sourceId ?? values.accountId,
      values.inquiryId ?? null,
    ],
  );

async function seedTemplate(environmentId: string, status = 'published') {
  const template = testId('grqt');
  const version = testId('grqtv');
  await query(
    `insert into graph_query_templates (id, environment_id, name) values ($1, $2, 'Shared email')`,
    [template, environmentId],
  );
  await query(
    `insert into graph_query_template_versions (id, environment_id, graph_query_template_id,
       version, status, config, published_at)
     values ($1, $2, $3, 1, $4, '{}'::jsonb, case when $4 = 'draft' then null else now() end)`,
    [version, environmentId, template, status],
  );
  return { template, version };
}

async function seedQuery(environmentId: string) {
  const { template, version } = await seedTemplate(environmentId);
  const id = testId('grphq');
  await query(
    `insert into graph_queries (id, environment_id, graph_query_template_id,
       graph_query_template_version_id, params)
     values ($1, $2, $3, $4, 'sealed')`,
    [id, environmentId, template, version],
  );
  return { id, template, version };
}

describe('the graph tables (C101, C102)', () => {
  it('creates every table of the (G) checkpoint', async () => {
    const result = await query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_name = any($1)`,
      [TABLES],
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([...TABLES].sort());
  });

  it('keeps a kind as a smallint code and a value key and key id as text, never bytea (F10)', async () => {
    expect(await columnsOf('graph_attributes')).toEqual({
      environment_id: 'text',
      kind: 'int2',
      value_key: 'text',
      key_id: 'text',
      account_id: 'text',
      source_type: 'text',
      source_id: 'text',
      inquiry_id: 'text',
      first_seen_at: 'timestamptz',
      last_seen_at: 'timestamptz',
    });
  });

  it('keys one row per account, value and source; the plan’s value index is the key’s prefix (C101.1)', async () => {
    expect(await constraintColumns('graph_attributes_pkey')).toEqual([
      {
        columns: ['environment_id', 'kind', 'value_key', 'account_id', 'source_type', 'source_id'],
        parents: null,
      },
    ]);
    expect(await indexDefinition('graph_attributes_environment_id_account_id_kind_idx')).toContain(
      '(environment_id, account_id, kind, value_key)',
    );
    expect(await indexDefinition('graph_attributes_environment_id_inquiry_id_idx')).toContain(
      'WHERE (inquiry_id IS NOT NULL)',
    );
  });

  it('has no degree table (F24)', async () => {
    const result = await query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_name like 'graph%degree%'`,
    );
    expect(result.rows).toEqual([]);
  });

  it('seals a query’s params and keeps its result as ids in JSON (P17)', async () => {
    const columns = await columnsOf('graph_queries');
    expect(columns).toMatchObject({
      params: 'text',
      nodes: 'jsonb',
      links: 'jsonb',
      node_map: 'jsonb',
      account_ids: '_text',
      kinds_not_indexed: '_int2',
    });
    expect(await indexDefinition('graph_queries_account_ids_idx')).toContain('USING gin');
    expect(await indexDefinition('graph_queries_environment_id_created_at_id_idx')).toContain(
      '(environment_id, created_at DESC, id DESC)',
    );
    expect(await indexDefinition('graph_queries_submitted_idx')).toContain(
      "WHERE (status = 'submitted'::text)",
    );
    expect(await indexDefinition('graph_queries_unredacted_created_at_idx')).toContain(
      'WHERE (redacted_at IS NULL)',
    );
  });

  it('binds every foreign key to the environment', async () => {
    for (const [name, columns] of [
      ['graph_attributes_account_fk', ['environment_id', 'account_id']],
      ['graph_attributes_inquiry_fk', ['environment_id', 'inquiry_id']],
      ['graph_index_jobs_inquiry_fk', ['environment_id', 'inquiry_id']],
      ['graph_components_account_fk', ['environment_id', 'account_id']],
      ['graph_query_template_versions_template_fk', ['environment_id', 'graph_query_template_id']],
      ['graph_queries_template_fk', ['environment_id', 'graph_query_template_id']],
      ['graph_queries_template_version_fk', ['environment_id', 'graph_query_template_version_id']],
    ] as const) {
      const [constraint] = await constraintColumns(name);
      expect(constraint?.columns, name).toEqual(columns);
      expect(constraint?.parents, name).toEqual(['environment_id', 'id']);
    }
  });

  it('bumps updated_at by trigger on every table that has it', async () => {
    const result = await query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname = any($1)`,
      [UPDATED_AT_TABLES.map((table) => `${table}_set_updated_at`)],
    );
    expect(result.rows.map((row) => row.tgname).sort()).toEqual(
      UPDATED_AT_TABLES.map((table) => `${table}_set_updated_at`).sort(),
    );
  });
});

describe('graph_attributes constraints (C101.1)', () => {
  it('accepts a row of each source, and an inquiry’s rows name the inquiry', async () => {
    const seeded = await tenant();
    const sessionId = testId('iqse');
    const verificationId = testId('ver');

    await insertAttribute(seeded);
    await insertAttribute({
      ...seeded,
      sourceType: 'inquiry',
      sourceId: seeded.inquiry,
      inquiryId: seeded.inquiry,
    });
    await insertAttribute({
      ...seeded,
      kind: 14,
      sourceType: 'inquiry-session',
      sourceId: sessionId,
      inquiryId: seeded.inquiry,
    });
    await insertAttribute({
      ...seeded,
      kind: 1,
      sourceType: 'verification',
      sourceId: verificationId,
      inquiryId: seeded.inquiry,
    });

    const count = await query<{ count: number }>(
      `select count(*)::int as count from graph_attributes where environment_id = $1`,
      [seeded.environmentId],
    );
    expect(count.rows).toEqual([{ count: 4 }]);
  });

  it('refuses an unknown kind, a key that is not hex, and a key id of another form', async () => {
    const seeded = await tenant();
    await expect(insertAttribute({ ...seeded, kind: 19 })).rejects.toThrow(
      'graph_attributes_kind_valid',
    );
    await expect(insertAttribute({ ...seeded, kind: 0 })).rejects.toThrow(
      'graph_attributes_kind_valid',
    );
    await expect(insertAttribute({ ...seeded, valueKey: 'A'.repeat(64) })).rejects.toThrow(
      'graph_attributes_value_key_format',
    );
    await expect(insertAttribute({ ...seeded, keyId: 'short' })).rejects.toThrow(
      'graph_attributes_key_id_format',
    );
  });

  it('holds a source id to its type, and an inquiry to every source but the account', async () => {
    const seeded = await tenant();
    // An unknown type fails both its own check and the source id's, whichever runs first.
    await expect(
      insertAttribute({
        ...seeded,
        sourceType: 'case',
        sourceId: seeded.inquiry,
        inquiryId: seeded.inquiry,
      }),
    ).rejects.toThrow(/graph_attributes_source_(id_format|type_valid)/);
    const definition = await query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname = 'graph_attributes_source_type_valid'`,
    );
    expect(definition.rows[0]?.definition).toMatch(
      /'account'.*'inquiry'.*'inquiry-session'.*'verification'/,
    );
    await expect(
      insertAttribute({
        ...seeded,
        sourceType: 'inquiry-session',
        sourceId: seeded.inquiry,
        inquiryId: seeded.inquiry,
      }),
    ).rejects.toThrow('graph_attributes_source_id_format');
    await expect(
      insertAttribute({ ...seeded, sourceType: 'account', inquiryId: seeded.inquiry }),
    ).rejects.toThrow('graph_attributes_inquiry_of_source');
    await expect(
      insertAttribute({
        ...seeded,
        sourceType: 'verification',
        sourceId: testId('ver'),
        inquiryId: null,
      }),
    ).rejects.toThrow('graph_attributes_inquiry_of_source');
    const other = await createTestInquiry(database.db, seeded.environmentId);
    await expect(
      insertAttribute({
        ...seeded,
        sourceType: 'inquiry',
        sourceId: other.inquiry.id,
        inquiryId: seeded.inquiry,
      }),
    ).rejects.toThrow('graph_attributes_inquiry_source_id');
  });

  it('keeps one row per account, value and source', async () => {
    const seeded = await tenant();
    const valueKey = digest();
    await insertAttribute({ ...seeded, valueKey });
    await expect(insertAttribute({ ...seeded, valueKey })).rejects.toThrow('graph_attributes_pkey');
  });

  it('refuses an account of another environment', async () => {
    const seeded = await tenant();
    const other = await tenant();
    await expect(
      insertAttribute({ ...seeded, accountId: other.accountId, sourceId: other.accountId }),
    ).rejects.toThrow('graph_attributes_account_fk');
  });

  it('goes with its inquiry: deleting the inquiry deletes its rows and its index job', async () => {
    const seeded = await tenant();
    await insertAttribute({
      ...seeded,
      sourceType: 'inquiry',
      sourceId: seeded.inquiry,
      inquiryId: seeded.inquiry,
    });
    await insertAttribute(seeded);
    await query(
      `insert into graph_index_jobs (environment_id, inquiry_id, trigger_status)
       values ($1, $2, 'completed')`,
      [seeded.environmentId, seeded.inquiry],
    );

    await query(`delete from inquiries where id = $1`, [seeded.inquiry]);

    const left = await query<{ attributes: number; jobs: number }>(
      `select (select count(*)::int from graph_attributes where environment_id = $1) as attributes,
              (select count(*)::int from graph_index_jobs where environment_id = $1) as jobs`,
      [seeded.environmentId],
    );
    expect(left.rows).toEqual([{ attributes: 1, jobs: 0 }]);
  });
});

describe('graph_index_jobs, graph_index_state and graph_components (C101.3, C101.5, C101.6)', () => {
  it('writes one pending job per inquiry, and holds its trigger, status and end time', async () => {
    const seeded = await tenant();
    const insert = `insert into graph_index_jobs (environment_id, inquiry_id, trigger_status,
      status, indexed_at) values ($1, $2, $3, $4, $5)`;
    await refused(
      insert,
      [seeded.environmentId, seeded.inquiry, 'pending', 'pending', null],
      'graph_index_jobs_trigger_valid',
    );
    await refused(
      insert,
      [seeded.environmentId, seeded.inquiry, 'completed', 'running', new Date()],
      'graph_index_jobs_status_valid',
    );
    await refused(
      insert,
      [seeded.environmentId, seeded.inquiry, 'completed', 'completed', null],
      'graph_index_jobs_ended_has_time',
    );
    await refused(
      insert,
      [seeded.environmentId, seeded.inquiry, 'completed', 'pending', new Date()],
      'graph_index_jobs_ended_has_time',
    );
    await query(insert, [seeded.environmentId, seeded.inquiry, 'expired', 'pending', null]);
    await refused(
      insert,
      [seeded.environmentId, seeded.inquiry, 'completed', 'pending', null],
      'graph_index_jobs_pkey',
    );
    expect(await indexDefinition('graph_index_jobs_pending_idx')).toContain(
      "WHERE (status = 'pending'::text)",
    );
  });

  it('keeps one state per environment and kind, complete exactly when it says when', async () => {
    const { environmentId } = await tenant();
    const insert = `insert into graph_index_state (environment_id, kind, complete, completed_at)
      values ($1, $2, $3, $4)`;
    await refused(insert, [environmentId, 19, false, null], 'graph_index_state_kind_valid');
    await refused(insert, [environmentId, 4, true, null], 'graph_index_state_completed_at');
    await refused(insert, [environmentId, 4, false, new Date()], 'graph_index_state_completed_at');
    await query(insert, [environmentId, 4, false, null]);
    await refused(insert, [environmentId, 4, true, new Date()], 'graph_index_state_pkey');
  });

  it('starts a new environment with no state row: every kind complete since it began (C101.5)', async () => {
    const { environmentId } = await tenant();
    const rows = await query(`select kind from graph_index_state where environment_id = $1`, [
      environmentId,
    ]);
    expect(rows.rows).toEqual([]);
  });

  it('keeps one component per account, of at least one account', async () => {
    const seeded = await tenant();
    const insert = `insert into graph_components (environment_id, account_id, component_id, size,
      computed_at) values ($1, $2, $3, $4, now())`;
    await refused(
      insert,
      [seeded.environmentId, seeded.accountId, 'c1', 0],
      'graph_components_size_positive',
    );
    await refused(
      insert,
      [seeded.environmentId, seeded.accountId, '', 1],
      'graph_components_component_id_length',
    );
    await query(insert, [seeded.environmentId, seeded.accountId, 'c1', 1]);
    await refused(
      insert,
      [seeded.environmentId, seeded.accountId, 'c2', 2],
      'graph_components_pkey',
    );
  });
});

describe('the template and query constraints (C102.1, C102.4)', () => {
  it('holds a template to its status, name and id prefix', async () => {
    const { environmentId } = await tenant();
    const insert = `insert into graph_query_templates (id, environment_id, name, status)
      values ($1, $2, $3, $4)`;
    await refused(
      insert,
      [testId('txn'), environmentId, 'Name', 'active'],
      'graph_query_templates_id_format',
    );
    await refused(
      insert,
      [testId('grqt'), environmentId, '', 'active'],
      'graph_query_templates_name_length',
    );
    await refused(
      insert,
      [testId('grqt'), environmentId, 'Name', 'draft'],
      'graph_query_templates_status_valid',
    );
  });

  it('allows one published version per template, and dates it (C102.1, as C71)', async () => {
    const { environmentId } = await tenant();
    const { template } = await seedTemplate(environmentId);
    const insert = `insert into graph_query_template_versions (id, environment_id,
      graph_query_template_id, version, status, published_at) values ($1, $2, $3, $4, $5, $6)`;
    await refused(
      insert,
      [testId('grqtv'), environmentId, template, 2, 'published', new Date()],
      'graph_query_template_versions_one_published_key',
    );
    await refused(
      insert,
      [testId('grqtv'), environmentId, template, 2, 'draft', new Date()],
      'graph_query_template_versions_published_at',
    );
    await refused(
      insert,
      [testId('grqtv'), environmentId, template, 1, 'draft', null],
      'graph_query_template_versions_template_id_version_key',
    );
    await refused(
      insert,
      [testId('grqtv'), environmentId, template, 0, 'draft', null],
      'graph_query_template_versions_version_positive',
    );
    await query(insert, [testId('grqtv'), environmentId, template, 2, 'draft', null]);
  });

  it('says when a query completed or errored, and keeps its timeout within 59 seconds', async () => {
    const { environmentId } = await tenant();
    const { id } = await seedQuery(environmentId);
    await refused(
      `update graph_queries set status = 'completed' where id = $1`,
      [id],
      'graph_queries_completed_at',
    );
    await refused(
      `update graph_queries set status = 'errored' where id = $1`,
      [id],
      'graph_queries_errored_at',
    );
    await refused(
      `update graph_queries set timeout_seconds = 60 where id = $1`,
      [id],
      'graph_queries_timeout_range',
    );
    await refused(
      `update graph_queries set status = 'running' where id = $1`,
      [id],
      'graph_queries_status_valid',
    );
    await query(
      `update graph_queries set status = 'completed', completed_at = now(),
         nodes = '[{"type":"account","value":"acc_x"}]', account_ids = array['acc_x']
       where id = $1`,
      [id],
    );
  });

  it('keeps params until redacted, and a redacted result holds nothing (C102.7)', async () => {
    const { environmentId } = await tenant();
    const { id } = await seedQuery(environmentId);
    await refused(
      `update graph_queries set params = null where id = $1`,
      [id],
      'graph_queries_params_until_redacted',
    );
    await query(
      `update graph_queries set nodes = '[{"type":"account","value":"acc_x"}]',
         account_ids = array['acc_x'], node_map = '{"gn_x":{}}' where id = $1`,
      [id],
    );
    await refused(
      `update graph_queries set params = null, redacted_at = now() where id = $1`,
      [id],
      'graph_queries_redacted_empty',
    );
    await query(
      `update graph_queries set params = null, nodes = '[]', links = '[]', node_map = '{}',
         account_ids = '{}', redacted_at = now() where id = $1`,
      [id],
    );
  });

  it('lists only known kinds as not indexed', async () => {
    const { environmentId } = await tenant();
    const { id } = await seedQuery(environmentId);
    await refused(
      `update graph_queries set kinds_not_indexed = array[19]::smallint[] where id = $1`,
      [id],
      'graph_queries_kinds_not_indexed_valid',
    );
    await query(
      `update graph_queries set kinds_not_indexed = array[13, 14]::smallint[] where id = $1`,
      [id],
    );
  });

  it('refuses a query of a template version in another environment', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();
    const { template, version } = await seedTemplate(other.environmentId);
    await refused(
      `insert into graph_queries (id, environment_id, graph_query_template_id,
         graph_query_template_version_id, params) values ($1, $2, $3, $4, 'sealed')`,
      [testId('grphq'), environmentId, template, version],
      'graph_queries_template',
    );
  });
});
