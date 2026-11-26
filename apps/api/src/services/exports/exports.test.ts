/**
 * C166.1-C166.4, C166.6 (Workflow 9B, `api-exports`; decision 43; contracts B19): exports through
 * their routes and the `export` job.
 *
 * - `POST /exports` (202) reads the list's filter (or a saved view's) by the list's own schema, needs
 *   `pii:view` for personal data, and audits the filter's keys only; the job writes the documented
 *   columns through the neutralising writer, masks every `pii` column without personal data (a JSON
 *   column keeps its keys), writes "redacted" for redacted content, seals the file for 24 hours and
 *   records `cut-at`, the count and the size.
 * - Only the creating principal lists, reads and downloads an export (another gets 404); every read
 *   checks the type's `:export` again and a download `pii:view` again; the download is audited.
 * - Past the byte or row cap the export fails with `export_too_large`, never truncated.
 * - Lists: a list with an importer only, its header the importer's columns; pending items left out.
 * - A key's attribute blocklist drops its columns (C169.3); the sweep expires files after 24 hours
 *   (410) and enqueues a pending export again.
 *
 * Every value is synthetic.
 */
import { importColumns, readCsv, writeCsv } from '@openverify/checks';
import { EXPORT_CSV_COLUMNS, newId } from '@openverify/contracts';
import { IMPORTER_LIST_KINDS, PERMISSIONS, type Permission } from '@openverify/core';
import { createSavedViewRow, createUser, getExportRow, updateInquiry } from '@openverify/db';
import { seedList, seedListItem } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExportQueue, createReportBulkQueue } from '../../jobs/export-queues.js';
import { processExport, type ExportJobDeps } from '../../jobs/exports/export.js';
import { runExportSweep } from '../../jobs/exports/sweep.js';
import { createCapturingLogger, createRecordingQueue } from '../../jobs/testing.js';
import type { ExportJob, ReportBulkJob } from '../../ports.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';

const exportJobs = createRecordingQueue<ExportJob>();
const bulkJobs = createRecordingQueue<ReportBulkJob>();
let api: TestApi;
let userId: string;
let admin: string;
let masked: string;
let other: string;

const ALL = PERMISSIONS as readonly Permission[];
const without = (...dropped: Permission[]) => ALL.filter((each) => !dropped.includes(each));

beforeAll(async () => {
  api = await createTestApi({ exports: createExportQueue({ queue: exportJobs }) });
  userId = (
    await createUser(api.database.db, {
      id: newId('usr'),
      organizationId: api.organizationId,
      email: `exporter-${newId('usr').slice(-6).toLowerCase()}@example.com`,
      passwordHash: '$argon2id$fake$synthetic',
    })
  ).id;
  admin = api.newUserToken(api.environmentId, { userId, permissions: ALL });
  masked = api.newUserToken(api.environmentId, { userId, permissions: without('pii:view') });
  other = api.newUserToken(api.environmentId, { permissions: ALL });
}, 120_000);

afterAll(async () => {
  await api.close();
});

const jobDeps = (overrides: Partial<ExportJobDeps> = {}): ExportJobDeps => ({
  db: api.database.db,
  storage: api.storage,
  keyring: api.database.keyring,
  blindIndexKey: api.deps.blindIndexKey,
  events: api.events,
  clock: api.clock,
  logger: createCapturingLogger(),
  ...overrides,
});

interface ExportResource {
  id: string;
  attributes: Record<string, unknown>;
}

async function post(attributes: Record<string, unknown>, token = admin) {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/exports',
    headers: bearer(token),
    payload: { data: { type: 'export', attributes: { format: 'csv', ...attributes } } },
  });
}

async function exported(attributes: Record<string, unknown>, token = admin) {
  const response = await post(attributes, token);
  expect(response.statusCode, response.body).toBe(202);
  const resource = response.json<{ data: ExportResource }>().data;
  await processExport({ environmentId: api.environmentId, exportId: resource.id }, jobDeps());
  return resource.id;
}

const read = (id: string, token = admin) =>
  api.app.inject({ url: `/api/v1/exports/${id}`, headers: bearer(token) });
const download = (id: string, token = admin) =>
  api.app.inject({ url: `/api/v1/exports/${id}/download`, headers: bearer(token) });

/** The CSV records, unquoted: our own synthetic cells hold no comma, quote or line break. */
function records(body: string): string[][] {
  return body
    .split('\r\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(1, -1).split('","'));
}

async function csvOf(id: string, token = admin): Promise<Record<string, string>[]> {
  const response = await download(id, token);
  expect(response.statusCode, response.body).toBe(200);
  const reading = readCsv(Buffer.from(response.body), {
    maxRows: 1000,
    maxRecordCharacters: 100_000,
  });
  expect(reading.refused).toBe(false);
  return reading.rows.map((row) => ({ ...row.cells }));
}

describe('an inquiry export (C166.1, C166.3, C166.6)', () => {
  let first: string;
  let redacted: string;

  beforeAll(async () => {
    first = await createInquiry(api, { referenceId: 'synthetic-ref-1' });
    redacted = await createInquiry(api, { referenceId: 'synthetic-ref-2' });
    await updateInquiry(api.database.db, api.environmentId, first, {
      fields: { 'name-first': 'Avery' },
    });
    await api.database.db.execute(
      sql`update inquiries set redacted_at = now() where id = ${redacted}`,
    );
  });

  it('cuts the documented columns with personal data, recording the cut, the count and the size', async () => {
    const id = await exported({
      'object-type': 'inquiries',
      filter: { 'filter[reference-id]': 'synthetic-ref-1' },
      'include-personal-data': true,
    });

    const resource = (await read(id)).json<{ data: ExportResource }>().data;
    const response = await download(id);
    const [row] = await csvOf(id);

    expect(resource.attributes).toMatchObject({
      status: 'completed',
      'row-count': 1,
      'include-personal-data': true,
      'filter-keys': ['filter[reference-id]'],
    });
    expect(resource.attributes['cut-at']).not.toBeNull();
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(records(response.body)[0]).toEqual(
      EXPORT_CSV_COLUMNS.inquiries?.map(({ name }) => name),
    );
    expect(row).toMatchObject({ id: first, 'reference-id': 'synthetic-ref-1' });
    expect(JSON.parse(row?.fields ?? '{}')).toEqual({ 'name-first': 'Avery' });
    expect(resource.attributes['byte-size']).toBe(Buffer.byteLength(response.body));
  });

  it('masks every personal column without personal data, keeping the keys of a JSON column', async () => {
    const id = await exported(
      { 'object-type': 'inquiries', filter: { 'filter[status]': 'created' } },
      masked,
    );

    const rows = await csvOf(id, masked);
    const row = rows.find((each) => each.id === first);

    expect(row?.['reference-id']).toBe('');
    expect(JSON.parse(row?.fields ?? '{}')).toEqual({ 'name-first': null });
    expect(rows.find((each) => each.id === redacted)?.['reference-id']).toBe('redacted');
  });

  it('refuses personal data without pii:view (403) and checks it again at the download', async () => {
    const refused = await post(
      { 'object-type': 'inquiries', 'include-personal-data': true },
      masked,
    );
    const id = await exported({ 'object-type': 'inquiries', 'include-personal-data': true });

    expect(refused.statusCode).toBe(403);
    expect((await download(id, masked)).statusCode).toBe(403);
  });

  it("serves an export to its creator alone, and checks the type's permission on each read", async () => {
    const id = await exported({ 'object-type': 'inquiries' });
    const lost = api.newUserToken(api.environmentId, {
      userId,
      permissions: without('inquiries:export'),
    });
    const listed = await api.app.inject({ url: '/api/v1/exports', headers: bearer(other) });

    expect([(await read(id, other)).statusCode, (await download(id, other)).statusCode]).toEqual([
      404, 404,
    ]);
    expect(listed.json<{ data: ExportResource[] }>().data.map((each) => each.id)).not.toContain(id);
    expect((await read(id, lost)).statusCode).toBe(403);
    const own = await api.app.inject({
      url: '/api/v1/exports?filter[object-type]=inquiries',
      headers: bearer(admin),
    });
    expect(own.json<{ data: ExportResource[] }>().data.map((each) => each.id)).toContain(id);
  });

  it('audits each export and download with the filter keys, never a value', async () => {
    const id = await exported({
      'object-type': 'inquiries',
      filter: { 'filter[reference-id]': 'synthetic-ref-audit' },
    });
    await download(id);

    const entries = api.audit.entries.filter((entry) => entry.resourceId === id);
    expect(entries.map((entry) => entry.action)).toEqual(['export.created', 'export.downloaded']);
    expect(entries[0]?.metadata).toMatchObject({ 'filter-keys': ['filter[reference-id]'] });
    expect(JSON.stringify(entries)).not.toContain('synthetic-ref-audit');
  });

  it('refuses a filter its list does not take (400) and the step reached without PII visibility (403)', async () => {
    const unknown = await post({
      'object-type': 'inquiries',
      filter: { 'filter[colour]': 'blue' },
    });
    const step = await post(
      { 'object-type': 'inquiries', filter: { 'filter[next-step-name]': 'address-step' } },
      masked,
    );

    expect([unknown.statusCode, step.statusCode]).toEqual([400, 403]);
  });

  it('fails past its byte cap with export_too_large, never truncated', async () => {
    const response = await post({ 'object-type': 'inquiries' });
    const id = response.json<{ data: ExportResource }>().data.id;

    await processExport(
      { environmentId: api.environmentId, exportId: id },
      jobDeps({ exportByteLimit: 300 }),
    );

    const resource = (await read(id)).json<{ data: ExportResource }>().data;
    expect(resource.attributes).toMatchObject({
      status: 'failed',
      'error-code': 'export_too_large',
    });
    expect((await download(id)).statusCode).toBe(404);
  });
});

describe('the other types (C166.1, C166.3)', () => {
  it('cuts the items of a list with an importer under the importer’s header, leaving pending items out', async () => {
    const list = await seedList(api.database.db, api.environmentId, { kind: 'string' });
    await seedListItem(api.database.db, api.environmentId, {
      listId: list.id,
      value: { value: '=synthetic-formula' },
    });
    await seedListItem(api.database.db, api.environmentId, {
      listId: list.id,
      value: { value: 'synthetic-pending' },
      status: 'pending',
    });

    const id = await exported({
      'object-type': 'lists',
      filter: { 'filter[list-id]': list.id },
      'include-personal-data': true,
    });
    const body = (await download(id)).body;

    expect(body).toBe(writeCsv(['value'], [['=synthetic-formula']]));
  });

  it('refuses a face list, whose items are templates (422)', async () => {
    const list = await seedList(api.database.db, api.environmentId, { kind: 'face' });

    const response = await post({ 'object-type': 'lists', filter: { 'filter[list-id]': list.id } });

    expect(response.statusCode).toBe(422);
  });

  it('refuses a face list with export_list_kind_refused at the list filter (K9-29)', async () => {
    const list = await seedList(api.database.db, api.environmentId, { kind: 'face' });

    const response = await post({ 'object-type': 'lists', filter: { 'filter[list-id]': list.id } });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'export_list_kind_refused',
      errors: [{ pointer: '/data/attributes/filter/filter[list-id]' }],
    });
  });

  it.each(IMPORTER_LIST_KINDS.map((kind) => [kind]))(
    'writes a %s list under exactly its importer’s columns, so the file imports again (K9-29)',
    async (kind) => {
      const list = await seedList(api.database.db, api.environmentId, { kind });

      const id = await exported({
        'object-type': 'lists',
        filter: { 'filter[list-id]': list.id },
      });

      expect(records((await download(id)).body)[0]).toEqual([...importColumns(kind)]);
    },
  );

  it('cuts verifications of a type with their checks', async () => {
    const inquiryId = await createInquiry(api);
    const verification = await seedVerification(api, api.environmentId, inquiryId, {
      checks: [{ name: 'id_expired', status: 'failed' }],
    });

    const id = await exported({
      'object-type': 'verifications',
      filter: { 'filter[type]': 'government-id', 'filter[inquiry-id]': inquiryId },
    });
    const [row] = await csvOf(id);

    expect(row).toMatchObject({
      id: verification.id,
      type: 'government-id',
      'inquiry-id': inquiryId,
      checks: 'id_expired:failed',
    });
  });

  it('cuts accounts, reports and transactions under their documented headers', async () => {
    for (const objectType of ['accounts', 'reports', 'transactions'] as const) {
      const id = await exported({ 'object-type': objectType });
      const response = await download(id);
      expect(records(response.body)[0]).toEqual(
        EXPORT_CSV_COLUMNS[objectType]?.map(({ name }) => name),
      );
    }
  });
});

describe('saved views, keys and the sweep (C166.1, C169.3, C174.3)', () => {
  it('reads a saved view’s filters, refusing one of another list (422) or not visible (404)', async () => {
    const view = await createSavedViewRow(api.database.db, api.environmentId, {
      id: newId('svw'),
      ownerId: userId,
      list: 'inquiries',
      name: 'Created',
      filters: { 'filter[status]': 'created' },
      columns: [],
      sort: null,
      shared: false,
      at: api.clock.now(),
    });

    const id = await exported({ 'object-type': 'inquiries', 'saved-view-id': view.id });
    const resource = (await read(id)).json<{ data: ExportResource }>().data;
    const mismatch = await post({ 'object-type': 'accounts', 'saved-view-id': view.id });
    const hidden = await post({ 'object-type': 'inquiries', 'saved-view-id': view.id }, other);

    expect(resource.attributes).toMatchObject({
      'saved-view-id': view.id,
      'filter-keys': ['filter[status]'],
    });
    expect([mismatch.statusCode, hidden.statusCode]).toEqual([422, 404]);
  });

  it("drops the columns a key's attribute blocklist names", async () => {
    const key = await api.newApiKey(api.environmentId);
    await api.database.db
      .execute(sql`update api_keys set attribute_blocklist = '{reference-id,fields}'
      where environment_id = ${api.environmentId} and attribute_blocklist = '{}'
        and created_at = (select max(created_at) from api_keys where environment_id = ${api.environmentId})`);

    const id = await exported({ 'object-type': 'inquiries' }, key);
    const header = records((await download(id, key)).body)[0];

    expect(header).not.toContain('reference-id');
    expect(header).not.toContain('fields');
    expect(header).toContain('status');
    expect((await read(id, admin)).statusCode).toBe(404);
  });

  it('expires a file after its 24 hours (410) and enqueues a pending export again', async () => {
    const id = await exported({ 'object-type': 'accounts' });
    const pending = (await post({ 'object-type': 'accounts' })).json<{ data: ExportResource }>()
      .data.id;
    const stored = (await getExportRow(api.database.db, api.environmentId, id))?.storageKey ?? '';
    api.clock.advance(25 * 60 * 60 * 1000);
    const requeue = createRecordingQueue<ExportJob>();

    const result = await runExportSweep({
      db: api.database.db,
      storage: api.storage,
      clock: api.clock,
      logger: createCapturingLogger(),
      exports: createExportQueue({ queue: requeue }),
      reportBulk: createReportBulkQueue({ queue: bulkJobs }),
    });

    expect(result.expiredExports).toBeGreaterThanOrEqual(1);
    expect((await read(id)).json<{ data: ExportResource }>().data.attributes.status).toBe(
      'expired',
    );
    expect((await download(id)).statusCode).toBe(410);
    expect(await api.storage.get(stored)).toBeNull();
    expect(requeue.jobs.map((job) => job.data.exportId)).toContain(pending);
  });
});
