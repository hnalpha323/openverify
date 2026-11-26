/**
 * Workflow 9B Stage 1b, checkpoint (X): what `foundation-9b` builds in the database for exports, saved
 * views, bulk report jobs and the transaction filters (C165, C166, C174.5), frozen for `api-exports`:
 *
 * - `exports` (`exp_`): a principal's asynchronous CSV, its filter sealed for the row until it
 *   finished (the filter's values are personal data; only its keys stay, `filter_keys`), its file an
 *   envelope object kept 24 hours, with the case export's invariants (C138.1) held by CHECKs;
 * - `saved_views` (`svw_`): a user's view of a list, deleted with its owner; its filters are stored in
 *   plaintext because a view never holds a personal-data filter (C165.2);
 * - `report_bulk_jobs` (`rbulk_`) with one `report_bulk_job_rows` row per CSV row, each created (its
 *   report named) or failed (its code), never skipped (C166.6); the uploaded CSV an envelope object;
 * - `report_origin` gains `bulk` (contracts B34), equal to core's `REPORT_ORIGINS`;
 * - `transaction_filter_values`: the plaintext projection of a transaction's `filterable` choices,
 *   boolean, number and date fields (C165.3), deleted with the transaction and by its redaction (but
 *   for the fields it keeps);
 * - the export's request and file and the bulk CSV listed for the KEK rewrap and re-wrapped by it.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { EXPORT_LIMITS, REPORT_ORIGINS } from '@openverify/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, decryptBytes, encryptBytes, setDefaultKeyring } from './crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from './encrypted-columns.js';
import { REWRAP_TABLES, rewrapAll } from './repositories/key-rotation.js';
import { redactTransactionRecords } from './repositories/transaction-redaction.js';
import { openJson, sealJson, type Sealed } from './sealed.js';
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

/** The error's message, or `accepted`. */
const refused = async (text: string, params: unknown[] = []) =>
  query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

/** The row-bound AAD name of the export's request, read without naming the member at compile time. */
const exportRequestAad = (): string | undefined =>
  (SEALED as Readonly<Record<string, string>>).exportRequest;

/** A user of a new organisation, by SQL, with the environment of that organisation. */
async function tenantWithUser() {
  const { organization, environment } = await createTestTenant(database.db);
  const userId = testId('usr');
  await query(
    `insert into users (id, organization_id, email, password_hash)
     values ($1, $2, $3, '$argon2id$v=19$m=65536,t=3,p=4$synthetic')`,
    [userId, organization.id, `${userId.toLowerCase()}@example.test`],
  );
  return { organizationId: organization.id, environmentId: environment.id, userId };
}

describe('exports (C166.1, C166.6; decision 43)', () => {
  /** Inserts an export with `columns` set to `values` beside the required ones. */
  const insertExport = (environmentId: string, columns: Record<string, unknown> = {}) => {
    const id = testId('exp');
    const row: Record<string, unknown> = {
      id,
      environment_id: environmentId,
      creator_type: 'user',
      creator_id: testId('usr'),
      object_type: 'inquiries',
      format: 'csv',
      request: sealJson('exports.request', id, { 'filter[status]': 'completed' }),
      filter_keys: ['filter[status]'],
      ...columns,
    };
    const names = Object.keys(row);
    return {
      id,
      outcome: refused(
        `insert into exports (${names.join(', ')})
         values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
        Object.values(row),
      ),
    };
  };

  it('holds a pending export of a user or a key, with its sealed request and its filter keys', async () => {
    const { environmentId } = await tenantWithUser();

    const byUser = insertExport(environmentId);
    const byKey = insertExport(environmentId, {
      creator_type: 'api-key',
      creator_id: testId('key'),
    });
    expect([await byUser.outcome, await byKey.outcome]).toEqual(['accepted', 'accepted']);

    const { rows } = await query<{
      status: string;
      include_personal_data: boolean;
      saved_view_id: string | null;
      filter_keys: string[];
      row_count: number | null;
    }>(
      `select status, include_personal_data, saved_view_id, filter_keys, row_count
         from exports where id = $1`,
      [byUser.id],
    );
    expect(rows).toEqual([
      {
        status: 'pending',
        include_personal_data: false,
        saved_view_id: null,
        filter_keys: ['filter[status]'],
        row_count: null,
      },
    ]);
  });

  it('holds each vocabulary, the creator and the saved view to their forms', async () => {
    const { environmentId } = await tenantWithUser();

    const outcomes = await Promise.all(
      [
        { object_type: 'cases' },
        { format: 'json' },
        { status: 'queued', request: null },
        { creator_type: 'workflow-run', creator_id: testId('wfr') },
        { creator_type: 'user', creator_id: testId('key') },
        { saved_view_id: testId('rbulk') },
        { filter_keys: Array.from({ length: 101 }, (_, index) => `filter[k${String(index)}]`) },
      ].map((columns) => insertExport(environmentId, columns).outcome),
    );

    expect(outcomes[0]).toContain('exports_object_type_valid');
    expect(outcomes[1]).toContain('exports_format_valid');
    expect(outcomes[2]).toContain('exports_status_valid');
    expect(outcomes[3]).toContain('exports_creator_type_valid');
    expect(outcomes[4]).toContain('exports_creator_id_format');
    expect(outcomes[5]).toContain('exports_saved_view_id_format');
    expect(outcomes[6]).toContain('exports_filter_keys_size');
  });

  it('holds a finished export to its count, its times, its file and its code, as C138.1 does', async () => {
    const { environmentId } = await tenantWithUser();
    const id = testId('exp');
    const { wrappedDek } = encryptBytes(new Uint8Array([1, 2, 3]), oldKeyring, { context: id });
    const done = {
      status: 'completed',
      request: null,
      row_count: 2,
      byte_size: 3,
      storage_key: `synthetic/${id}`,
      wrapped_dek: wrappedDek,
      cut_at: new Date('2026-11-01T10:00:00Z'),
      completed_at: new Date('2026-11-01T10:00:01Z'),
      expires_at: new Date('2026-11-02T10:00:01Z'),
    };

    const outcomes = await Promise.all([
      insertExport(environmentId, { ...done, id }).outcome,
      insertExport(environmentId, { ...done, storage_key: null, wrapped_dek: null }).outcome,
      insertExport(environmentId, { ...done, expires_at: null }).outcome,
      insertExport(environmentId, { ...done, row_count: EXPORT_LIMITS.rows + 1 }).outcome,
      insertExport(environmentId, { status: 'failed', request: null }).outcome,
      insertExport(environmentId, {
        status: 'failed',
        request: null,
        error_code: 'export_too_large',
      }).outcome,
      insertExport(environmentId, { status: 'failed', error_code: 'export_too_large' }).outcome,
      insertExport(environmentId, { error_code: 'export_too_large' }).outcome,
      insertExport(environmentId, {
        ...done,
        status: 'expired',
        storage_key: null,
        wrapped_dek: null,
      }).outcome,
    ]);

    expect(outcomes[0]).toBe('accepted');
    expect(outcomes[1]).toContain('exports_file_while_completed');
    expect(outcomes[2]).toContain('exports_finished_with_times');
    expect(outcomes[3]).toContain('exports_counts');
    expect(outcomes[4]).toContain('exports_error_when_failed');
    expect(outcomes[5]).toBe('accepted');
    // The request (the filter's values) goes when the export finishes (P19, as case exports).
    expect(outcomes[6]).toContain('exports_request_until_finished');
    expect(outcomes[7]).toContain('exports_error_when_failed');
    // An expired export keeps its count and times, never its file or its size.
    expect(outcomes[8]).toContain('exports_size_while_completed');
  });

  it('lists the request and the file for the rewrap, and kek:rewrap re-wraps both', async () => {
    expect(exportRequestAad()).toBe('exports.request');
    expect(ENCRYPTED_COLUMNS).toContainEqual({ table: 'exports', column: 'request', aad: 'row' });
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'exports',
      column: 'wrapped_dek',
      aad: 'file',
    });
    expect(REWRAP_TABLES).toContain('exports');
    const { environmentId } = await tenantWithUser();
    const id = testId('exp');
    const plaintext = new Uint8Array([7, 7, 7]);
    const request = { 'filter[reference-id]': 'synthetic-reference' };
    const pending = insertExport(environmentId, {
      id,
      request: sealJson('exports.request', id, request),
    });
    expect(await pending.outcome).toBe('accepted');
    const fileId = testId('exp');
    const fileSealed = encryptBytes(plaintext, oldKeyring, { context: fileId });
    const completed = insertExport(environmentId, {
      id: fileId,
      status: 'completed',
      request: null,
      row_count: 1,
      byte_size: 3,
      storage_key: `synthetic/${fileId}`,
      wrapped_dek: fileSealed.wrappedDek,
      cut_at: new Date(),
      completed_at: new Date(),
      expires_at: new Date(Date.now() + 86_400_000),
    });
    expect(await completed.outcome).toBe('accepted');

    const rotated = createKeyring(newKek, [oldKek]);
    await rewrapAll(database.db, { keyring: rotated });

    const { rows } = await query<{
      id: string;
      request: Sealed | null;
      wrapped_dek: string | null;
    }>('select id, request, wrapped_dek from exports where id = any($1) order by id', [
      [id, fileId],
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const fresh = createKeyring(newKek);
    setDefaultKeyring(fresh);
    try {
      expect(openJson('exports.request', id, byId.get(id)?.request ?? ('' as Sealed))).toEqual(
        request,
      );
    } finally {
      setDefaultKeyring(oldKeyring);
    }
    const rewrapped = byId.get(fileId)?.wrapped_dek ?? '';
    expect(rewrapped.split('.')[1]).toBe(fresh.currentKeyId);
    expect(
      decryptBytes({ wrappedDek: rewrapped, ciphertext: fileSealed.ciphertext }, fresh, {
        context: fileId,
      }),
    ).toEqual(Buffer.from(plaintext));
  });
});

describe('saved views (C165.1, C165.2; decision 44)', () => {
  const insertView = (environmentId: string, ownerId: string, columns: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id: testId('svw'),
      environment_id: environmentId,
      owner_id: ownerId,
      list: 'inquiries',
      name: 'Completed this week',
      filters: JSON.stringify({ 'filter[status]': 'completed' }),
      ...columns,
    };
    const names = Object.keys(row);
    return refused(
      `insert into saved_views (${names.join(', ')})
       values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
      Object.values(row),
    );
  };

  it("holds a user's view of a list, private unless shared, with no columns or sort by default", async () => {
    const { environmentId, userId } = await tenantWithUser();
    const id = testId('svw');

    expect(await insertView(environmentId, userId, { id })).toBe('accepted');
    const { rows } = await query(
      'select list, name, filters, columns, sort, shared from saved_views where id = $1',
      [id],
    );
    expect(rows).toEqual([
      {
        list: 'inquiries',
        name: 'Completed this week',
        filters: { 'filter[status]': 'completed' },
        columns: [],
        sort: null,
        shared: false,
      },
    ]);
  });

  it('holds the list, the name, the filters, the columns and the sort to their forms', async () => {
    const { environmentId, userId } = await tenantWithUser();

    const outcomes = await Promise.all(
      [
        { list: 'files' },
        { name: '' },
        { name: 'x'.repeat(101) },
        { filters: JSON.stringify(['filter[status]']) },
        { columns: Array.from({ length: 51 }, (_, index) => `column-${String(index)}`) },
        { sort: 'x'.repeat(66) },
      ].map((columns) => insertView(environmentId, userId, columns)),
    );

    expect(outcomes[0]).toContain('saved_views_list_valid');
    expect(outcomes[1]).toContain('saved_views_name_length');
    expect(outcomes[2]).toContain('saved_views_name_length');
    expect(outcomes[3]).toContain('saved_views_filters_object');
    expect(outcomes[4]).toContain('saved_views_columns_size');
    expect(outcomes[5]).toContain('saved_views_sort_length');
  });

  it('goes with its owner', async () => {
    const { environmentId, userId } = await tenantWithUser();
    expect(await insertView(environmentId, userId, {})).toBe('accepted');

    await query('delete from users where id = $1', [userId]);

    const { rows } = await query<{ count: number }>(
      'select count(*)::int as count from saved_views where owner_id = $1',
      [userId],
    );
    expect(rows).toEqual([{ count: 0 }]);
  });
});

describe('bulk report jobs and their rows (C166.5, C166.6)', () => {
  async function job(environmentId: string, columns: Record<string, unknown> = {}) {
    const { templateId } = await seedReportTemplate(database.db, environmentId);
    const id = testId('rbulk');
    const { wrappedDek } = encryptBytes(new Uint8Array([9]), oldKeyring, { context: id });
    const row: Record<string, unknown> = {
      id,
      environment_id: environmentId,
      creator_type: 'api-key',
      creator_id: testId('key'),
      report_template_id: templateId,
      storage_key: `synthetic/${id}`,
      wrapped_dek: wrappedDek,
      ...columns,
    };
    const names = Object.keys(row);
    const outcome = await refused(
      `insert into report_bulk_jobs (${names.join(', ')})
       values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
      Object.values(row),
    );
    return { id, templateId, outcome };
  }

  const insertRow = (environmentId: string, jobId: string, columns: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      environment_id: environmentId,
      job_id: jobId,
      row_number: 1,
      outcome: 'failed',
      error_code: 'query_invalid',
      ...columns,
    };
    const names = Object.keys(row);
    return refused(
      `insert into report_bulk_job_rows (${names.join(', ')})
       values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
      Object.values(row),
    );
  };

  it("holds a pending job of a template of its environment, with its CSV's envelope", async () => {
    const { environmentId } = await tenantWithUser();
    const pending = await job(environmentId);
    expect(pending.outcome).toBe('accepted');

    const other = await tenantWithUser();
    const foreign = await job(other.environmentId);
    const crossed = await refused(
      `insert into report_bulk_jobs (id, environment_id, creator_type, creator_id, report_template_id)
       values ($1, $2, 'user', $3, $4)`,
      [testId('rbulk'), environmentId, testId('usr'), foreign.templateId],
    );
    expect(crossed).toContain('report_bulk_jobs_report_template_fk');

    const outcomes = await Promise.all([
      job(environmentId, { status: 'queued' }),
      job(environmentId, { status: 'completed' }),
      job(environmentId, { storage_key: null }),
      job(environmentId, { creator_type: 'workflow-run', creator_id: testId('wfr') }),
      job(environmentId, { error_code: 'csv_header_invalid' }),
    ]);
    expect(outcomes[0].outcome).toContain('report_bulk_jobs_status_valid');
    expect(outcomes[1].outcome).toContain('report_bulk_jobs_ended_with_time');
    expect(outcomes[2].outcome).toContain('report_bulk_jobs_file_whole');
    expect(outcomes[3].outcome).toContain('report_bulk_jobs_creator_type_valid');
    expect(outcomes[4].outcome).toContain('report_bulk_jobs_error_when_failed');
  });

  it('records each row once, created with its report or failed with its code, never skipped', async () => {
    const { environmentId } = await tenantWithUser();
    const { id } = await job(environmentId);
    const reportId = testId('rep');

    expect(await insertRow(environmentId, id, {})).toBe('accepted');
    expect(
      await insertRow(environmentId, id, {
        row_number: 2,
        outcome: 'created',
        error_code: null,
        report_id: reportId,
      }),
    ).toBe('accepted');

    const outcomes = await Promise.all([
      insertRow(environmentId, id, {}),
      insertRow(environmentId, id, { row_number: 0 }),
      insertRow(environmentId, id, { row_number: 1001 }),
      insertRow(environmentId, id, { row_number: 3, outcome: 'skipped', error_code: null }),
      insertRow(environmentId, id, { row_number: 4, outcome: 'created', error_code: null }),
      insertRow(environmentId, id, { row_number: 5, error_code: null }),
      insertRow(environmentId, id, { row_number: 6, report_id: reportId }),
      insertRow(environmentId, id, { row_number: 7, error_code: 'Not A Code' }),
    ]);
    expect(outcomes[0]).toContain('report_bulk_job_rows_pkey');
    expect(outcomes[1]).toContain('report_bulk_job_rows_row_number_range');
    expect(outcomes[2]).toContain('report_bulk_job_rows_row_number_range');
    expect(outcomes[3]).toContain('report_bulk_job_rows_outcome_valid');
    expect(outcomes[4]).toContain('report_bulk_job_rows_created_names_report');
    expect(outcomes[5]).toContain('report_bulk_job_rows_failed_has_code');
    expect(outcomes[6]).toContain('report_bulk_job_rows_created_names_report');
    expect(outcomes[7]).toContain('report_bulk_job_rows_error_code_format');

    await query('delete from report_bulk_jobs where id = $1', [id]);
    const { rows } = await query<{ count: number }>(
      'select count(*)::int as count from report_bulk_job_rows where job_id = $1',
      [id],
    );
    expect(rows).toEqual([{ count: 0 }]);
  });

  it('lists the CSV for the rewrap, and kek:rewrap re-wraps it', async () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'report_bulk_jobs',
      column: 'wrapped_dek',
      aad: 'file',
    });
    expect(REWRAP_TABLES).toContain('report_bulk_jobs');
    const { environmentId } = await tenantWithUser();
    const { id, outcome } = await job(environmentId);
    expect(outcome).toBe('accepted');

    await rewrapAll(database.db, { keyring: createKeyring(newKek, [oldKek]) });

    const { rows } = await query<{ wrapped_dek: string }>(
      'select wrapped_dek from report_bulk_jobs where id = $1',
      [id],
    );
    expect(rows[0]?.wrapped_dek.split('.')[1]).toBe(createKeyring(newKek).currentKeyId);
  });

  it("names a report a bulk job created by the origin bulk, core's REPORT_ORIGINS included (B34)", async () => {
    expect(REPORT_ORIGINS).toContain('bulk');
    const { environmentId } = await tenantWithUser();
    const { templateId, versionId } = await seedReportTemplate(database.db, environmentId);
    const reportId = await seedReport(database.db, environmentId, { templateId, versionId });

    expect(await refused(`update reports set origin = 'bulk' where id = $1`, [reportId])).toBe(
      'accepted',
    );
  });
});

describe('the transaction filter projection (C165.3, contracts B18)', () => {
  async function transaction() {
    const { environmentId } = await tenantWithUser();
    const type = await seedTransactionType(database.db, environmentId);
    const { id } = await seedTransaction(database.db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    return { environmentId, transactionId: id };
  }

  const insertValue = (environmentId: string, transactionId: string, key: string, value: string) =>
    refused(
      `insert into transaction_filter_values (environment_id, transaction_id, field_key, value)
       values ($1, $2, $3, $4)`,
      [environmentId, transactionId, key, value],
    );

  it("holds one plaintext value per transaction, field and value, of the transaction's environment", async () => {
    const { environmentId, transactionId } = await transaction();
    const other = await transaction();

    const outcomes = [
      await insertValue(environmentId, transactionId, 'channel', 'web'),
      await insertValue(environmentId, transactionId, 'channel', 'phone'),
      await insertValue(environmentId, transactionId, 'channel', 'web'),
      await insertValue(environmentId, transactionId, 'Not A Key', 'web'),
      await insertValue(environmentId, transactionId, 'amount', ''),
      await insertValue(environmentId, transactionId, 'amount', 'x'.repeat(1025)),
      await insertValue(environmentId, other.transactionId, 'channel', 'web'),
    ];

    expect(outcomes.slice(0, 2)).toEqual(['accepted', 'accepted']);
    expect(outcomes[2]).toContain('transaction_filter_values_pkey');
    expect(outcomes[3]).toContain('transaction_filter_values_field_key_format');
    expect(outcomes[4]).toContain('transaction_filter_values_value_length');
    expect(outcomes[5]).toContain('transaction_filter_values_value_length');
    expect(outcomes[6]).toContain('transaction_filter_values_transaction_fk');
  });

  it('is read by field and value through its own index', async () => {
    const { rows } = await query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'transaction_filter_values_lookup_idx'`,
    );
    expect(rows[0]?.indexdef).toContain('(environment_id, field_key, value, transaction_id)');
  });

  it("is deleted by the transaction's redaction, but for the fields it keeps", async () => {
    const { environmentId, transactionId } = await transaction();
    for (const [key, value] of [
      ['channel', 'web'],
      ['amount', '42'],
      ['kept', 'true'],
    ] as const) {
      expect(await insertValue(environmentId, transactionId, key, value)).toBe('accepted');
    }

    await redactTransactionRecords(database.db, environmentId, transactionId, {
      keepFieldKeys: ['kept'],
    });

    const { rows } = await query(
      'select field_key, value from transaction_filter_values where transaction_id = $1',
      [transactionId],
    );
    expect(rows).toEqual([{ field_key: 'kept', value: 'true' }]);
  });
});
