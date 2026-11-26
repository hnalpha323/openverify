/**
 * Workflow 7B Stage 1b, checkpoint (L) (plan C97, C98, C99, C100): the list tables of migration
 * 0024, read from the migrated database's catalogs.
 *
 * - `lists`, `list_items` with the partial dedup key, `list_item_keys` and the four side tables,
 *   with the operator classes C98.1 asks a migration test to assert: SP-GiST `inet_ops` on the
 *   ranges and GiST `box_ops` on the boxes;
 * - `list_matches` and `list_screenings` (C99.3, C99.4);
 * - `importers`, `list_import_rows` and `list_import_errors` (C100);
 * - `inquiry_template_versions.list_config` (C99.5).
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

const TABLES = [
  'lists',
  'list_items',
  'list_item_keys',
  'list_item_ip_ranges',
  'list_item_geo',
  'list_item_faces',
  'list_item_backgrounds',
  'list_matches',
  'list_screenings',
  'importers',
  'list_import_rows',
  'list_import_errors',
];

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = await query<{ column_name: string; udt_name: string }>(
    `select column_name, udt_name from information_schema.columns where table_name = $1`,
    [table],
  );
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.udt_name]));
}

/** The access method and operator class of an index's first column. */
async function operatorClassOf(index: string) {
  const result = await query<{ access: string; opclass: string }>(
    `select am.amname as access, o.opcname as opclass
       from pg_class i
       join pg_am am on am.oid = i.relam
       join pg_index x on x.indexrelid = i.oid
       join pg_opclass o on o.oid = x.indclass[0]
      where i.relname = $1`,
    [index],
  );
  return result.rows;
}

async function indexDefinition(index: string): Promise<string> {
  const result = await query<{ indexdef: string }>(
    `select indexdef from pg_indexes where indexname = $1`,
    [index],
  );
  return result.rows[0]?.indexdef ?? '';
}

async function refused(statement: string, params: unknown[], constraint: string) {
  await expect(query(statement, params), constraint).rejects.toThrow(constraint);
}

async function seedList(environmentId: string, type = 'string'): Promise<string> {
  const id = testId('lst');
  await query(
    `insert into lists (id, environment_id, type, name) values ($1, $2, $3, 'Synthetic')`,
    [id, environmentId, type],
  );
  return id;
}

const insertItem = `insert into list_items (id, environment_id, list_id, value, match_key,
  normaliser_version, status) values ($1, $2, $3, 'sealed', $4, 'lists-1', 'active')`;

describe('the list tables (C98.1)', () => {
  it('creates every table of the (L) checkpoint', async () => {
    for (const table of TABLES) {
      expect(Object.keys(await columnsOf(table)).length, table).toBeGreaterThan(1);
    }
  });

  it('gives a list its type, version and kind-specific members', async () => {
    expect(await columnsOf('lists')).toMatchObject({
      type: 'text',
      version: 'int4',
      item_count: 'int4',
      item_retention_days: 'int4',
      screen_at_completion: 'bool',
      field_key: 'text',
      case_sensitive: 'bool',
      default_region: 'text',
      use_for_compromised_ids: 'bool',
      allow_fuzzy_name_first: 'bool',
    });
  });

  it('keeps a value sealed and a key as text, never bytea (F10)', async () => {
    expect(await columnsOf('list_items')).toMatchObject({
      value: 'text',
      match_key: 'text',
      normaliser_version: 'text',
      key_id: 'text',
      country_code: 'text',
      archive_reason: 'text',
      created_by_type: 'text',
      created_by_id: 'text',
    });
  });

  it('indexes the ranges with SP-GiST inet_ops, never a GiST class on cidr (C98.1)', async () => {
    expect(await operatorClassOf('list_item_ip_ranges_range_idx')).toEqual([
      { access: 'spgist', opclass: 'inet_ops' },
    ]);
    expect(await columnsOf('list_item_ip_ranges')).toMatchObject({ range: 'cidr' });
  });

  it('indexes the boxes with GiST box_ops (C98.1)', async () => {
    expect(await operatorClassOf('list_item_geo_bbox_idx')).toEqual([
      { access: 'gist', opclass: 'box_ops' },
    ]);
    expect(await columnsOf('list_item_geo')).toMatchObject({ bbox: 'box', part: 'int2' });
  });

  it('keeps a background layout as a 144-dimension vector, with no ANN index (C99.7)', async () => {
    const result = await query<{ format_type: string }>(
      `select format_type(a.atttypid, a.atttypmod)
         from pg_attribute a join pg_class c on c.oid = a.attrelid
        where c.relname = 'list_item_backgrounds' and a.attname = 'layout'`,
    );
    expect(result.rows).toEqual([{ format_type: 'vector(144)' }]);
    const indexes = await query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'list_item_backgrounds'`,
    );
    expect(indexes.rows.filter(({ indexdef }) => /hnsw|ivfflat/.test(indexdef))).toEqual([]);
  });

  it('dedups per list, active rows only, and lets a redacted or archived row go (C98.1)', async () => {
    const definition = await indexDefinition('list_items_active_match_key_key');
    expect(definition).toContain('environment_id, list_id, match_key');
    expect(definition).toContain('archived_at IS NULL');
    expect(definition).toContain('redacted_at IS NULL');

    const { environment } = await createTestTenant(database.db);
    const list = await seedList(environment.id);
    const key = digest();
    await query(insertItem, [testId('lis'), environment.id, list, key]);
    await refused(
      insertItem,
      [testId('lis'), environment.id, list, key],
      'list_items_active_match_key_key',
    );
    await query(
      `update list_items set status = 'archived', archived_at = now() where match_key = $1`,
      [key],
    );
    await query(insertItem, [testId('lis'), environment.id, list, key]);
  });

  it('indexes the extra keys with the environment first (C99.2)', async () => {
    expect(await indexDefinition('list_item_keys_environment_id_key_kind_match_key_idx')).toContain(
      'environment_id, key_kind, match_key',
    );
  });

  it('refuses an item id of no item prefix, a key that is not hex, and an unknown key kind', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(environment.id);
    await refused(
      insertItem,
      [testId('lst'), environment.id, list, digest()],
      'list_items_id_format',
    );
    await refused(
      insertItem,
      [testId('lis'), environment.id, list, 'not-hex'],
      'list_items_match_key_hex',
    );
    const item = testId('lin');
    await query(insertItem, [item, environment.id, list, digest()]);
    await refused(
      `insert into list_item_keys (environment_id, item_id, key_kind, match_key)
         values ($1, $2, 'identifier-unknown', $3)`,
      [environment.id, item, digest()],
      'list_item_keys_key_kind_valid',
    );
  });

  it('holds the kind-specific members to their kind', async () => {
    const { environment } = await createTestTenant(database.db);
    const insert = `insert into lists (id, environment_id, type, name, field_key, default_region,
      use_for_compromised_ids, allow_fuzzy_name_first, case_sensitive, item_retention_days)
      values ($1, $2, $3, 'Synthetic', $4, $5, $6, $7, $8, $9)`;
    const row = (type: string, member: Record<string, unknown>) => [
      testId('lst'),
      environment.id,
      type,
      member.fieldKey ?? null,
      member.region ?? null,
      member.compromised ?? false,
      member.fuzzy ?? false,
      member.caseSensitive ?? false,
      member.retention ?? null,
    ];
    await refused(insert, row('field', {}), 'lists_field_key_fits_type');
    await refused(insert, row('string', { fieldKey: 'a' }), 'lists_field_key_fits_type');
    await refused(insert, row('string', { region: 'ZZ' }), 'lists_default_region_fits_type');
    await refused(insert, row('name', { compromised: true }), 'lists_compromised_fits_type');
    await refused(insert, row('string', { fuzzy: true }), 'lists_fuzzy_fits_type');
    await refused(insert, row('name', { caseSensitive: true }), 'lists_case_sensitive_fits_type');
    // C97.2 (P08): a biometric list always has its retention.
    await refused(insert, row('face', {}), 'lists_biometric_retention');
    await refused(insert, row('selfie-background', {}), 'lists_biometric_retention');
    await query(insert, row('face', { retention: 30 }));
    await refused(insert, row('unknown', {}), 'lists_type_valid');
  });

  it('ties archive and redaction to the status (C97.2, C98.4)', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(environment.id);
    const item = testId('lis');
    await query(insertItem, [item, environment.id, list, digest()]);
    await refused(
      `update list_items set status = 'archived' where id = $1`,
      [item],
      'list_items_archived_at_fits_status',
    );
    await refused(
      `update list_items set redacted_at = now(), value = null, match_key = null where id = $1`,
      [item],
      'list_items_redacted_is_archived',
    );
    await refused(
      `update list_items set status = 'archived', archived_at = now(), redacted_at = now()
        where id = $1`,
      [item],
      'list_items_redacted_holds_nothing',
    );
    await query(
      `update list_items set status = 'archived', archived_at = now(), redacted_at = now(),
         value = null, match_key = null where id = $1`,
      [item],
    );
  });
});

describe('list matches and screenings (C99.3, C99.4)', () => {
  it('seals the value and the reason, and keeps one match per inquiry, item and source', async () => {
    expect(await columnsOf('list_matches')).toMatchObject({
      matched_value: 'text',
      reason: 'text',
      confidence: 'float8',
      score: 'float8',
      distance_meters: 'int4',
      approximate: 'bool',
      list_version: 'int4',
    });
    const definition = await indexDefinition('list_matches_inquiry_item_source_key');
    expect(definition).toContain('environment_id, inquiry_id, list_item_id, source');
  });

  it('refuses an unknown method, source or tier, and a dismissal without its time', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const list = await seedList(environment.id);
    const insert = `insert into list_matches (id, environment_id, list_id, inquiry_id, source,
      method, tier, list_version, status, dismissed_at)
      values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)`;
    const row = (source: string, method: string, tier: string, status: string, at: Date | null) => [
      testId('lmt'),
      environment.id,
      list,
      inquiry.id,
      source,
      method,
      tier,
      status,
      at,
    ];
    await refused(insert, row('nowhere', 'exact', 'R', 'open', null), 'list_matches_source_valid');
    await refused(insert, row('request', 'guess', 'R', 'open', null), 'list_matches_method_valid');
    await refused(insert, row('request', 'exact', 'A', 'open', null), 'list_matches_tier_valid');
    await refused(
      insert,
      row('request', 'exact', 'R', 'dismissed', null),
      'list_matches_dismissed_at_fits_status',
    );
    await query(insert, row('request', 'exact', 'R', 'open', null));
  });

  it('keys a screening by inquiry, and says when it ended (C99.4)', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const insert = `insert into list_screenings (environment_id, inquiry_id, trigger_status, status,
      match_count, screened_at) values ($1, $2, $3, $4, $5, $6)`;
    await refused(
      insert,
      [environment.id, inquiry.id, 'approved', 'pending', null, null],
      'list_screenings_trigger_valid',
    );
    await refused(
      insert,
      [environment.id, inquiry.id, 'completed', 'completed', null, new Date()],
      'list_screenings_completed_has_count',
    );
    await refused(
      insert,
      [environment.id, inquiry.id, 'completed', 'partial', null, null],
      'list_screenings_ended_has_time',
    );
    await query(insert, [environment.id, inquiry.id, 'completed', 'pending', null, null]);
    const stored = await query(
      `select status, match_count, unscreened, not_applicable, review_cause, attempts
         from list_screenings where inquiry_id = $1`,
      [inquiry.id],
    );
    expect(stored.rows).toEqual([
      {
        status: 'pending',
        match_count: null,
        unscreened: [],
        not_applicable: [],
        review_cause: null,
        attempts: 0,
      },
    ]);
    await refused(
      insert,
      [environment.id, inquiry.id, 'completed', 'pending', null, null],
      'list_screenings_pkey',
    );
  });
});

describe('importers (C100)', () => {
  const insertImporter = `insert into importers (id, environment_id, list_id, file_sha256,
    storage_key, wrapped_dek, file_bytes) values ($1, $2, $3, $4, $5, $6, 10)`;

  it('keeps the storage key and wrapped DEK on the importer itself (C100.2)', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(environment.id);
    const id = testId('mprt');
    await query(insertImporter, [id, environment.id, list, digest(), 'imports/a', 'dek']);
    const stored = await query(
      `select status, mode, encoding, row_count, successful_count, duplicate_count,
              already_present_count, error_count, completed_at, object_deleted_at
         from importers where id = $1`,
      [id],
    );
    expect(stored.rows).toEqual([
      {
        status: 'pending',
        mode: 'all-or-nothing',
        encoding: 'utf-8',
        row_count: 0,
        successful_count: 0,
        duplicate_count: 0,
        already_present_count: 0,
        error_count: 0,
        completed_at: null,
        object_deleted_at: null,
      },
    ]);
    await refused(
      insertImporter,
      [testId('mprt'), environment.id, list, digest(), 'imports/b', null],
      'importers_object_complete',
    );
    await refused(
      `update importers set status = 'ready' where id = $1`,
      [id],
      'importers_completed_at_fits_status',
    );
  });

  it('finds an import by list, mode and SHA-256 (C100.5)', async () => {
    expect(await indexDefinition('importers_file_idempotency_idx')).toContain(
      'environment_id, list_id, mode, file_sha256',
    );
  });

  it('stages one sealed row per line and takes errors of the whole file (C100.2, C100.4)', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(environment.id);
    const id = testId('mprt');
    await query(insertImporter, [id, environment.id, list, digest(), 'imports/c', 'dek']);
    const row = `insert into list_import_rows (environment_id, importer_id, row, value, match_key)
      values ($1, $2, $3, 'sealed', $4)`;
    await query(row, [environment.id, id, 1, digest()]);
    await refused(row, [environment.id, id, 1, digest()], 'list_import_rows_importer_row_key');
    const error = `insert into list_import_errors (environment_id, importer_id, row, "column", code)
      values ($1, $2, $3, $4, $5)`;
    await query(error, [environment.id, id, null, null, 'invalid_encoding']);
    await query(error, [environment.id, id, 2, 'value', 'invalid_value']);
    await refused(
      error,
      [environment.id, id, 3, 'value', 'made_up'],
      'list_import_errors_code_valid',
    );
    await refused(
      error,
      [environment.id, id, 3, 'NOT A HEADER', 'invalid_value'],
      'list_import_errors_column_format',
    );
  });
});

describe('the template version member (C99.5)', () => {
  it('stores list-config with the default {}', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const result = await query(
      `select v.list_config from inquiry_template_versions v
         join inquiries i on i.inquiry_template_version_id = v.id where i.id = $1`,
      [inquiry.id],
    );
    expect(result.rows).toEqual([{ list_config: {} }]);
  });
});
