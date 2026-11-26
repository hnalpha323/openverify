/**
 * Workflow 7B Stage 1b, checkpoint (T) (plan C104, C105): the transaction tables of migration 0024,
 * read from the migrated database's catalogs.
 *
 * - `transaction_types` and `transaction_type_versions` (C104.1, as C71: one published version);
 * - `transactions` with its sealed `fields`, tags and list indexes (C105.4);
 * - `transaction_status_history` and `transaction_labels`, append-only with the C73 trigger pattern:
 *   an UPDATE is refused except the transaction redaction that nulls the free text, a DELETE except
 *   an environment's deletion;
 * - `transaction_objects` and `transaction_relations`, with composite foreign keys;
 * - `transaction_field_keys` (64 hex, F10) and `transaction_files` (C105.4, P22).
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
  'transaction_types',
  'transaction_type_versions',
  'transactions',
  'transaction_status_history',
  'transaction_labels',
  'transaction_objects',
  'transaction_relations',
  'transaction_field_keys',
  'transaction_files',
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

/** A foreign key's referencing and referenced columns, in order. */
async function foreignKeyOf(name: string) {
  const result = await query<{ columns: string[]; parents: string[] }>(
    `select array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                   order by k.ord) as columns,
            array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
                   order by k.ord) as parents
       from pg_constraint c where c.conname = $1`,
    [name],
  );
  return result.rows;
}

async function refused(statement: string, params: unknown[], constraint: string) {
  await expect(query(statement, params), constraint).rejects.toThrow(constraint);
}

async function seedType(environmentId: string) {
  const type = testId('txntp');
  const version = testId('txntpv');
  await query(
    `insert into transaction_types (id, environment_id, name) values ($1, $2, 'Payout')`,
    [type, environmentId],
  );
  await query(
    `insert into transaction_type_versions (id, environment_id, transaction_type_id, version,
       status, statuses, published_at)
     values ($1, $2, $3, 1, 'published', array['created', 'approved'], now())`,
    [version, environmentId, type],
  );
  return { type, version };
}

async function seedTransaction(environmentId: string) {
  const { type, version } = await seedType(environmentId);
  const id = testId('txn');
  await query(
    `insert into transactions (id, environment_id, transaction_type_id,
       transaction_type_version_id, status, fields)
     values ($1, $2, $3, $4, 'created', 'sealed')`,
    [id, environmentId, type, version],
  );
  return { id, type, version };
}

async function tenant(): Promise<string> {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

/** Runs `statement` in a transaction with the settings; rolled back after an accepted run. */
async function inTransaction(
  settings: Readonly<Record<string, string>>,
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
    return (error as Error).message.includes('is append-only')
      ? 'refused by the trigger'
      : `failed: ${(error as Error).message}`;
  }
}

describe('the transaction tables (C104.1, C105.4)', () => {
  it('creates every table of the (T) checkpoint', async () => {
    for (const table of TABLES) {
      expect(Object.keys(await columnsOf(table)).length, table).toBeGreaterThan(1);
    }
  });

  it('keeps a version’s content as JSON and its statuses as text', async () => {
    expect(await columnsOf('transaction_type_versions')).toMatchObject({
      version: 'int4',
      field_schemas: 'jsonb',
      statuses: '_text',
      relation_schemas: 'jsonb',
      allow_card_like_strings: 'bool',
    });
  });

  it('seals the fields, keeps the reference plaintext, and holds both redaction times', async () => {
    expect(await columnsOf('transactions')).toMatchObject({
      reference_id: 'text',
      status: 'text',
      fields: 'text',
      tags: '_text',
      redacted_at: 'timestamptz',
      biometrics_redacted_at: 'timestamptz',
    });
  });

  it('keeps a field key as text, never bytea (F10)', async () => {
    expect(await columnsOf('transaction_field_keys')).toEqual({
      environment_id: 'text',
      transaction_id: 'text',
      field_key: 'text',
      value_key: 'text',
    });
  });

  it('gives a file its own envelope: the filename sealed, the wrapped DEK on the row', async () => {
    expect(await columnsOf('transaction_files')).toMatchObject({
      field_key: 'text',
      filename: 'text',
      mime_type: 'text',
      byte_size: 'int4',
      sha256: 'text',
      storage_key: 'text',
      wrapped_dek: 'text',
      deleted_at: 'timestamptz',
    });
  });

  it('serves the two list orders of C105.4 from their indexes, newest first with ties broken', async () => {
    expect(await indexDefinition('transactions_environment_id_created_at_id_idx')).toContain(
      '(environment_id, created_at DESC, id DESC)',
    );
    expect(
      await indexDefinition('transactions_environment_id_type_status_created_at_id_idx'),
    ).toContain('(environment_id, transaction_type_id, status, created_at DESC, id DESC)');
    expect(await indexDefinition('transactions_environment_id_reference_id_idx')).toContain(
      '(environment_id, reference_id, created_at DESC, id DESC)',
    );
  });

  it('indexes the tags with GIN, ignoring case, as accounts do', async () => {
    const definition = await indexDefinition('transactions_lower_tags_idx');
    expect(definition).toContain('USING gin');
    expect(definition).toContain('openverify_lower_tags(tags)');
  });

  it('indexes the objects and the field keys by what they are found with (C105.2, C105.7)', async () => {
    expect(await indexDefinition('transaction_objects_environment_id_object_id_idx')).toContain(
      '(environment_id, object_id, created_at DESC, transaction_id DESC)',
    );
    expect(await indexDefinition('transaction_field_keys_lookup_idx')).toContain(
      '(environment_id, field_key, value_key, transaction_id)',
    );
  });

  it('binds every foreign key to the environment (C105.4)', async () => {
    for (const [name, column, parent] of [
      ['transactions_type_fk', 'transaction_type_id', 'id'],
      ['transactions_version_fk', 'transaction_type_version_id', 'id'],
      ['transaction_objects_inquiry_fk', 'inquiry_id', 'id'],
      ['transaction_objects_report_fk', 'report_id', 'id'],
      ['transaction_objects_verification_fk', 'verification_id', 'id'],
      ['transaction_objects_account_fk', 'account_id', 'id'],
      ['transaction_relations_account_fk', 'account_id', 'id'],
      ['transaction_relations_transaction_fk', 'related_transaction_id', 'id'],
      ['transaction_files_transaction_fk', 'transaction_id', 'id'],
      ['transaction_field_keys_transaction_fk', 'transaction_id', 'id'],
    ] as const) {
      expect(await foreignKeyOf(name), name).toEqual([
        { columns: ['environment_id', column], parents: ['environment_id', parent] },
      ]);
    }
  });
});

describe('the constraints', () => {
  it('holds a type to its status, a name to its length and an id to its prefix', async () => {
    const env = await tenant();
    const insert = `insert into transaction_types (id, environment_id, name, status)
      values ($1, $2, $3, $4)`;

    await refused(
      insert,
      [testId('txntp'), env, 'Payout', 'deleted'],
      'transaction_types_status_valid',
    );
    await refused(insert, [testId('txntp'), env, '', 'active'], 'transaction_types_name_length');
    await refused(insert, [testId('txn'), env, 'Payout', 'active'], 'transaction_types_id_format');
  });

  it('allows one published version per type, and dates it (C104.1)', async () => {
    const env = await tenant();
    const { type } = await seedType(env);
    const insert = `insert into transaction_type_versions (id, environment_id,
      transaction_type_id, version, status, statuses, published_at) values
      ($1, $2, $3, $4, $5, array['created'], $6)`;

    await refused(
      insert,
      [testId('txntpv'), env, type, 2, 'published', new Date().toISOString()],
      'transaction_type_versions_one_published_key',
    );
    await refused(
      insert,
      [testId('txntpv'), env, type, 1, 'draft', null],
      'transaction_type_versions_transaction_type_id_version_key',
    );
    await refused(
      insert,
      [testId('txntpv'), env, type, 2, 'superseded', null],
      'transaction_type_versions_published_at',
    );
  });

  it('keeps `created` first among the statuses, at most fifty (C104.5)', async () => {
    const env = await tenant();
    const { type } = await seedType(env);
    const insert = `insert into transaction_type_versions (id, environment_id,
      transaction_type_id, version, statuses) values ($1, $2, $3, 2, $4)`;

    await refused(
      insert,
      [testId('txntpv'), env, type, ['approved', 'created']],
      'transaction_type_versions_created_first',
    );
    await refused(
      insert,
      [testId('txntpv'), env, type, []],
      'transaction_type_versions_created_first',
    );
    await refused(
      insert,
      [testId('txntpv'), env, type, ['created', ...Array.from({ length: 50 }, () => 'x')]],
      'transaction_type_versions_statuses_count',
    );
  });

  it('refuses a status outside the pattern, and an empty reference', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);

    await refused(
      `update transactions set status = 'Not Lower' where id = $1`,
      [id],
      'transactions_status_format',
    );
    await refused(
      `update transactions set reference_id = '' where id = $1`,
      [id],
      'transactions_reference_id_length',
    );
  });

  it('refuses tags the C9 backstop refuses', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);

    await refused(
      `update transactions set tags = array['Same', 'same'] where id = $1`,
      [id],
      'transactions_tags_valid',
    );
  });

  it('refuses an unredacted transaction without sealed fields', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);

    await refused(
      `update transactions set fields = null where id = $1`,
      [id],
      'transactions_fields_until_redacted',
    );
    await query(`update transactions set fields = null, redacted_at = now() where id = $1`, [id]);
  });

  it('refuses a transaction of a type in another environment', async () => {
    const env = await tenant();
    const other = await tenant();
    const { type, version } = await seedType(other);

    await refused(
      `insert into transactions (id, environment_id, transaction_type_id,
         transaction_type_version_id, status, fields) values ($1, $2, $3, $4, 'created', 'sealed')`,
      [testId('txn'), env, type, version],
      'transactions_type_fk',
    );
  });

  it('attaches one object per row, once, and refuses one of another environment', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);
    const { inquiry } = await createTestInquiry(database.db, env);
    const other = await createTestInquiry(database.db, await tenant());
    const attach = `insert into transaction_objects (environment_id, transaction_id, inquiry_id,
      account_id) values ($1, $2, $3, $4)`;

    await query(attach, [env, id, inquiry.id, null]);
    const stored = await query<{ object_id: string }>(
      `select object_id from transaction_objects where transaction_id = $1`,
      [id],
    );
    expect(stored.rows).toEqual([{ object_id: inquiry.id }]);

    await refused(attach, [env, id, inquiry.id, null], 'transaction_objects_pkey');
    // No target at all: the generated column is null, which its NOT NULL refuses first.
    await refused(attach, [env, id, null, null], 'object_id');
    await refused(
      attach,
      [env, id, inquiry.id, inquiry.accountId],
      'transaction_objects_one_target',
    );
    await refused(attach, [env, id, other.inquiry.id, null], 'transaction_objects_inquiry_fk');
  });

  it('keeps a relation once per schema key and target, idempotent (C105.2)', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);
    const related = await seedTransaction(env);
    const relate = `insert into transaction_relations (environment_id, transaction_id,
      relation_schema_key, related_transaction_id, account_id) values ($1, $2, $3, $4, $5)`;

    await query(relate, [env, id, 'parent', related.id, null]);
    await refused(relate, [env, id, 'parent', related.id, null], 'transaction_relations_pkey');
    await query(relate, [env, id, 'other', related.id, null]);
    await refused(relate, [env, id, 'x', null, null], 'target_id');
    await refused(
      relate,
      [env, id, 'Not A Key', related.id, null],
      'transaction_relations_key_format',
    );
    const account = (await createTestInquiry(database.db, env)).inquiry.accountId;
    await refused(relate, [env, id, 'x', related.id, account], 'transaction_relations_one_target');
    const stored = await query<{ target_id: string }>(
      `select distinct target_id from transaction_relations where transaction_id = $1`,
      [id],
    );
    expect(stored.rows).toEqual([{ target_id: related.id }]);
  });

  it('holds a field key to 64 hex', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);
    const insert = `insert into transaction_field_keys (environment_id, transaction_id, field_key,
      value_key) values ($1, $2, 'iban', $3)`;

    await query(insert, [env, id, digest()]);
    await refused(insert, [env, id, 'not-hex'], 'transaction_field_keys_value_key_hex');
  });

  it('holds one live file per field; a deleted one makes way for the next', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);
    const insert = `insert into transaction_files (id, environment_id, transaction_id, field_key,
      filename, mime_type, byte_size, sha256, storage_key, wrapped_dek)
      values ($1, $2, $3, 'statement', 'sealed', 'application/pdf', 10, $4, $5, 'ov1.key.dek')`;
    const first = testId('txnf');

    await query(insert, [first, env, id, digest(), `transactions/${first}`]);
    const second = testId('txnf');
    await refused(
      insert,
      [second, env, id, digest(), `transactions/${second}`],
      'transaction_files_one_live_per_field_key',
    );
    // K7B-5: a replaced row, redacted and not yet deleted, frees its field.
    await query(`update transaction_files set redacted_at = now() where id = $1`, [first]);
    await query(insert, [second, env, id, digest(), `transactions/${second}`]);
    await refused(
      insert,
      [testId('txnf'), env, id, digest(), `transactions/${second}`],
      'transaction_files_storage_key_key',
    );
  });

  it('refuses a live file without its filename, and a digest that is not hex', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);
    const file = testId('txnf');
    await query(
      `insert into transaction_files (id, environment_id, transaction_id, field_key, filename,
         mime_type, byte_size, sha256, storage_key, wrapped_dek)
       values ($1, $2, $3, 'statement', 'sealed', 'application/pdf', 10, $4, $5, 'ov1.key.dek')`,
      [file, env, id, digest(), `transactions/${file}`],
    );

    await refused(
      `update transaction_files set filename = null where id = $1`,
      [file],
      'transaction_files_filename_until_redacted',
    );
    await refused(
      `update transaction_files set sha256 = 'x' where id = $1`,
      [file],
      'transaction_files_sha256_hex',
    );
  });
});

describe('C105.4: the status history and the labels are append-only, but for the redaction', () => {
  async function withHistory() {
    const env = await tenant();
    const { id } = await seedTransaction(env);
    const history = await query<{ id: string }>(
      `insert into transaction_status_history (environment_id, transaction_id, from_status,
         to_status, actor_type, actor_id) values ($1, $2, 'created', 'approved', 'api_key', $3)
       returning id`,
      [env, id, testId('key')],
    );
    const label = testId('txnl');
    await query(
      `insert into transaction_labels (id, environment_id, transaction_id, label, model_version,
         score) values ($1, $2, $3, 'fraud', 'model-1', 0.5)`,
      [label, env, id],
    );
    return { env, id, historyId: history.rows[0]?.id, label };
  }

  const redaction = { 'openverify.transaction_redaction': 'on' };
  const deletion = { 'openverify.environment_deletion': 'on' };

  it('refuses an update of any column without the flag', async () => {
    const { historyId, label } = await withHistory();

    expect(
      await inTransaction(
        {},
        `update transaction_status_history set to_status = 'declined' where id = $1`,
        [historyId],
      ),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction({}, `update transaction_labels set label = 'other' where id = $1`, [
        label,
      ]),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction(
        {},
        `update transaction_labels set label = null, model_version = null, redacted_at = now()
          where id = $1`,
        [label],
      ),
    ).toBe('refused by the trigger');
  });

  it('lets a redaction null the free text and stamp the row, and nothing else', async () => {
    const { historyId, label } = await withHistory();

    expect(
      await inTransaction(
        redaction,
        `update transaction_status_history
            set from_status = null, to_status = null, redacted_at = now() where id = $1`,
        [historyId],
      ),
    ).toBe('accepted');
    expect(
      await inTransaction(
        redaction,
        `update transaction_labels set label = null, model_version = null, redacted_at = now()
          where id = $1`,
        [label],
      ),
    ).toBe('accepted');
  });

  it('refuses a flagged update that keeps a value or touches another column', async () => {
    const { historyId, label } = await withHistory();

    expect(
      await inTransaction(
        redaction,
        `update transaction_labels set model_version = null, redacted_at = now() where id = $1`,
        [label],
      ),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction(
        redaction,
        `update transaction_labels set label = null, model_version = null, redacted_at = now(),
           score = 0.9 where id = $1`,
        [label],
      ),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction(
        redaction,
        `update transaction_status_history
            set from_status = null, to_status = null, redacted_at = now(), actor_id = null,
                actor_type = 'system' where id = $1`,
        [historyId],
      ),
    ).toBe('refused by the trigger');
    expect(
      await inTransaction(
        redaction,
        `update transaction_labels set label = null, model_version = null where id = $1`,
        [label],
      ),
    ).toBe('refused by the trigger');
  });

  it('refuses a delete, a cascade from the transaction too, except an environment’s deletion', async () => {
    const { id, env, historyId, label } = await withHistory();

    expect(await inTransaction({}, `delete from transaction_labels where id = $1`, [label])).toBe(
      'refused by the trigger',
    );
    expect(
      await inTransaction({}, `delete from transaction_status_history where id = $1`, [historyId]),
    ).toBe('refused by the trigger');
    expect(await inTransaction({}, `delete from transactions where id = $1`, [id])).toBe(
      'refused by the trigger',
    );
    expect(await inTransaction(deletion, `delete from environments where id = $1`, [env])).toBe(
      'accepted',
    );
    const left = await query<{ count: number }>(
      `select count(*)::int as count from transaction_labels where environment_id = $1`,
      [env],
    );
    expect(left.rows).toEqual([{ count: 0 }]);
  });

  it('refuses a redacted row that still names no redaction time', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);

    await refused(
      `insert into transaction_status_history (environment_id, transaction_id, to_status,
         actor_type) values ($1, $2, null, 'system')`,
      [env, id],
      'transaction_status_history_status_until_redacted',
    );
    await refused(
      `insert into transaction_labels (id, environment_id, transaction_id, label)
         values ($1, $2, $3, null)`,
      [testId('txnl'), env, id],
      'transaction_labels_label_until_redacted',
    );
  });

  it('holds the actor to its kind, as a report action does', async () => {
    const env = await tenant();
    const { id } = await seedTransaction(env);

    await refused(
      `insert into transaction_status_history (environment_id, transaction_id, to_status,
         actor_type, actor_id) values ($1, $2, 'approved', 'user', 'not-an-id')`,
      [env, id],
      'transaction_status_history_actor_valid',
    );
  });
});
