/**
 * C138 (Workflow 8B Stage 3, `api-case-files`; decision 69, P19, P26): case exports and print through
 * their routes and jobs.
 *
 * - `POST /case-exports` (202) selects the creator's visible cases by a filter or a search (a search on
 *   a field needs `pii:view`, as does `include-personal-data`), at most 10,000 (422
 *   `export_too_large`), under `case-exports` (C12: 429 past it, through when unanswered); its audit
 *   entry records the selection's shape and never a value.
 * - The job writes the CSV through the neutralising writer in `CASE_EXPORT_CSV_COLUMNS` order (the
 *   fields only with personal data, "redacted" for a redacted case), or the JSON bundle; seals the
 *   file for 24 hours; fires `case.exported` per case with a history row.
 * - Only the creator lists, reads and downloads it (another gets 404); a download re-checks
 *   `pii:view` for personal data and is audited; after 24 hours the sweep deletes the file and the
 *   export reads `expired` (410 on download).
 * - `POST /cases/:id/print` writes its audit entry and history row and fires `case.print-initiated`.
 *
 * Every value is synthetic.
 */
import {
  CASE_EXPORT_CSV_COLUMNS,
  caseExportBundleSchema,
  eventAttributesSchema,
} from '@openverify/contracts';
import { createTestInquiry, seedCaseTemplate } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCaseExportQueue } from '../../../jobs/case-file-queues.js';
import { processCaseExport } from '../../../jobs/cases/index.js';
import { runCaseExportSweep } from '../../../jobs/cases/export-sweep.js';
import {
  createCapturingLogger,
  createFakeVision,
  createRecordingQueue,
} from '../../../jobs/testing.js';
import type { CaseExportJob, RateLimiter } from '../../../ports.js';
import { createAllowAllRateLimiter } from '../../../test-support/fakes.js';
import { bearer, createTestApi, type TestApi } from '../../../test-support/harness.js';

const exportJobs = createRecordingQueue<CaseExportJob>();
const allow = createAllowAllRateLimiter();
let limiter: RateLimiter = allow;

let api: TestApi;
let token: string;
const USER = 'usr_01M6FQZCV622MRCK2ZKC7F4HD9';

beforeAll(async () => {
  api = await createTestApi({
    caseExports: createCaseExportQueue({ queue: exportJobs }),
    rateLimiter: { consume: (key, policy) => limiter.consume(key, policy) },
  });
  token = api.newUserToken(api.environmentId, { userId: USER });
}, 120_000);

afterAll(async () => {
  await api.close();
});

let calls = 0;
const request = (method: 'GET' | 'POST', url: string, payload?: unknown, as = token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `exports-${String((calls += 1))}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const codeOf = (response: { body: string }) =>
  (JSON.parse(response.body) as { code?: string }).code;

interface ExportResource {
  id: string;
  attributes: Record<string, unknown>;
}
const resourceOf = (response: { body: string }) =>
  (JSON.parse(response.body) as { data: ExportResource }).data;

let keys = 0;
async function template(fieldSchemas: unknown[] = []) {
  keys += 1;
  const made = await request('POST', '/case-templates', {
    data: {
      attributes: {
        name: 'Synthetic export',
        key: `EX${String(keys)}`,
        'field-schemas': fieldSchemas,
      },
    },
  });
  expect(made.statusCode, made.body).toBe(201);
  const data = (
    JSON.parse(made.body) as {
      data: { id: string; relationships: { 'draft-version': { data: { id: string } } } };
    }
  ).data;
  const published = await request(
    'POST',
    `/case-template-versions/${data.relationships['draft-version'].data.id}/publish`,
    { meta: {} },
  );
  expect(published.statusCode, published.body).toBe(200);
  return data.id;
}

async function newCase(
  templateId: string,
  attributes: Record<string, unknown> = {},
  meta?: unknown,
) {
  const made = await request('POST', '/cases', {
    data: { attributes: { 'case-template-id': templateId, ...attributes } },
    ...(meta === undefined ? {} : { meta }),
  });
  expect(made.statusCode, made.body).toBe(201);
  return (JSON.parse(made.body) as { data: { id: string } }).data.id;
}

const createExport = (attributes: Record<string, unknown>, as = token) =>
  request('POST', '/case-exports', { data: { type: 'case-export', attributes } }, as);

function jobDeps(overrides: Record<string, unknown> = {}) {
  return {
    db: api.database.db,
    storage: api.storage,
    keyring: api.deps.keyring,
    vision: createFakeVision().client,
    events: api.deps.events,
    clock: api.clock,
    logger: createCapturingLogger(),
    ...overrides,
  };
}

const run = (id: string, overrides: Record<string, unknown> = {}) =>
  processCaseExport({ environmentId: api.environmentId, caseExportId: id }, jobDeps(overrides));

const FIELDS = [{ key: 'note', label: 'Note', type: 'string' }];

/** RFC 4180 records of the writer's CSV: every cell quoted, `""` inside, CRLF between records. */
function records(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let index = 0;
  while (index < csv.length) {
    let cell = '';
    index += 1; // the opening quote
    for (;;) {
      const next = csv.indexOf('"', index);
      if (csv[next + 1] === '"') {
        cell += `${csv.slice(index, next)}"`;
        index = next + 2;
        continue;
      }
      cell += csv.slice(index, next);
      index = next + 1;
      break;
    }
    row.push(cell);
    if (csv[index] === ',') {
      index += 1;
    } else {
      rows.push(row);
      row = [];
      index += 2; // CRLF
    }
  }
  return rows;
}

describe('a CSV export (C138.1, C138.2)', () => {
  it('writes the visible cases in its columns, neutralised, and fires case.exported per case', async () => {
    const templateId = await template(FIELDS);
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const first = await newCase(
      templateId,
      { tags: ['-synthetic'], fields: { note: '=HYPERLINK("https://example.com")' } },
      { 'object-ids': [inquiry.id] },
    );
    const second = await newCase(templateId);
    const queued = exportJobs.jobs.length;
    const before = api.events.named('case.exported').length;

    const created = await createExport({
      format: 'csv',
      'include-personal-data': true,
      filter: { 'case-template-id': [templateId] },
    });
    const pending = resourceOf(created);
    await run(pending.id);
    const read = await request('GET', `/case-exports/${pending.id}`);
    const download = await request('GET', `/case-exports/${pending.id}/download`);

    expect(created.statusCode, created.body).toBe(202);
    expect(pending.attributes).toMatchObject({
      status: 'pending',
      format: 'csv',
      'case-count': null,
    });
    expect(exportJobs.jobs.slice(queued).map(({ data }) => data.caseExportId)).toEqual([
      pending.id,
    ]);
    const done = resourceOf(read).attributes;
    expect(done).toMatchObject({ status: 'completed', 'case-count': 2, 'error-code': null });
    expect(
      new Date(String(done['expires-at'])).getTime() -
        new Date(String(done['completed-at'])).getTime(),
    ).toBe(24 * 60 * 60 * 1000);
    expect(download.statusCode, download.body).toBe(200);
    expect(download.headers).toMatchObject({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="case-export-${pending.id}.csv"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    });
    const [header, ...rows] = records(download.body);
    expect(header).toEqual([...CASE_EXPORT_CSV_COLUMNS, 'fields']);
    expect(rows.map((row) => row[0])).toEqual([second, first]);
    const firstRow = rows[1] ?? [];
    const cell = (column: string) => firstRow[header?.indexOf(column) ?? -1];
    // A cell that opens with a formula character is neutralised; a JSON cell opens with `{`.
    expect(cell('tags')).toBe("'-synthetic");
    expect(cell('inquiry-ids')).toBe(inquiry.id);
    expect(cell('status')).toBe('open');
    expect(JSON.parse(cell('fields') ?? '')).toEqual({
      note: { type: 'string', value: '=HYPERLINK("https://example.com")' },
    });
    const exported = api.events.named('case.exported').slice(before);
    expect(exported).toHaveLength(2);
    for (const event of exported) {
      expect(
        eventAttributesSchema.safeParse({
          name: 'case.exported',
          payload: event.payload,
          'created-at': new Date().toISOString(),
        }).success,
      ).toBe(true);
      expect(JSON.stringify(event)).toContain(pending.id);
      expect(JSON.stringify(event)).not.toContain('HYPERLINK');
    }
    const history = await api.database.client.query<{ to: unknown }>(
      `select "to" from case_history where case_id = $1 and kind = 'exported'`,
      [first],
    );
    expect(history.rows).toEqual([{ to: { 'case-export-id': pending.id } }]);
    expect(api.audit.withAction('case-export.created').at(-1)?.metadata).toEqual({
      format: 'csv',
      'include-personal-data': true,
      shape: { kind: 'filter', members: ['case-template-id'] },
    });
    expect(api.audit.withAction('case-export.downloaded').at(-1)?.metadata).toEqual({
      format: 'csv',
      'include-personal-data': true,
      'case-count': 2,
    });
    const stored = await api.database.client.query<{ request: string | null }>(
      'select request from case_exports where id = $1',
      [pending.id],
    );
    expect(stored.rows).toEqual([{ request: null }]);
  });

  it('leaves the fields out without personal data, and reads a redacted case as redacted', async () => {
    const templateId = await template(FIELDS);
    const redacted = await newCase(templateId, { fields: { note: 'synthetic-canary' } });
    const plain = await createExport({
      format: 'csv',
      filter: { 'case-template-id': [templateId] },
    });
    const personal = await createExport({
      format: 'csv',
      'include-personal-data': true,
      filter: { 'case-template-id': [templateId] },
    });
    await api.database.db.execute(
      sql`update cases set redacted_at = now(), fields = null where id = ${redacted}`,
    );

    await run(resourceOf(plain).id);
    await run(resourceOf(personal).id);
    const withoutFields = await request('GET', `/case-exports/${resourceOf(plain).id}/download`);
    const withFields = await request('GET', `/case-exports/${resourceOf(personal).id}/download`);

    expect(records(withoutFields.body)[0]).toEqual([...CASE_EXPORT_CSV_COLUMNS]);
    expect(withoutFields.body).not.toContain('synthetic-canary');
    const [header, row] = records(withFields.body);
    expect(row?.[header?.indexOf('fields') ?? -1]).toBe('redacted');
  });
});

describe('a JSON export (C138.2)', () => {
  it('writes each case with its timeline, comments and held objects, masked without personal data', async () => {
    const templateId = await template(FIELDS);
    const caseId = await newCase(templateId, { fields: { note: 'synthetic-canary' } });
    const comment = await request('POST', `/cases/${caseId}/add-comment`, {
      meta: { message: 'synthetic-comment-canary' },
    });
    expect(comment.statusCode, comment.body).toBe(200);

    const created = await createExport({
      format: 'json',
      filter: { 'case-template-id': [templateId] },
    });
    await run(resourceOf(created).id);
    const download = await request('GET', `/case-exports/${resourceOf(created).id}/download`);

    expect(download.headers['content-type']).toBe('application/json');
    const bundle = caseExportBundleSchema.parse(JSON.parse(download.body));
    expect(bundle.meta).toMatchObject({
      'case-export-id': resourceOf(created).id,
      'include-personal-data': false,
      'case-count': 1,
    });
    expect(bundle.data[0]?.case.id).toBe(caseId);
    expect(bundle.data[0]?.history.length).toBeGreaterThan(0);
    expect(bundle.data[0]?.comments).toHaveLength(1);
    expect(download.body).not.toContain('synthetic-canary');
    expect(download.body).not.toContain('synthetic-comment-canary');
  });
});

describe('an export a crashed worker left running (K8-28, Workflow 8D)', () => {
  it('completes when its job runs again', async () => {
    const templateId = await template();
    await newCase(templateId);
    const created = await createExport({
      format: 'csv',
      filter: { 'case-template-id': [templateId] },
    });
    const id = resourceOf(created).id;
    // Claimed by a worker that stopped longer ago than the claim's lease.
    await api.database.client.query(
      `update case_exports set status = 'running', updated_at = $2 where id = $1`,
      [id, new Date(api.clock.now().getTime() - 20 * 60_000)],
    );

    await run(id);

    expect(resourceOf(await request('GET', `/case-exports/${id}`)).attributes).toMatchObject({
      status: 'completed',
      'case-count': 1,
    });
  });
});

describe('a bounded export (Workflow 8C review R006)', () => {
  /** A case with `comments` comments of 2,000 characters each. */
  async function heavyCase(templateId: string, comments: number) {
    const caseId = await newCase(templateId);
    for (let index = 0; index < comments; index += 1) {
      const added = await request('POST', `/cases/${caseId}/add-comment`, {
        meta: { message: `synthetic-long-comment-${String(index)}-`.padEnd(2_000, 'x') },
      });
      expect(added.statusCode, added.body).toBe(200);
    }
    return caseId;
  }

  it.each(['json', 'csv'] as const)(
    'fails a %s export past its byte limit with export_too_large, writing no file and no event',
    async (format) => {
      const templateId = await template(FIELDS);
      await heavyCase(templateId, 3);
      for (let index = 0; index < 3; index += 1) {
        await newCase(templateId, { fields: { note: 'synthetic-'.padEnd(200, 'n') } });
      }
      const created = await createExport({
        format,
        'include-personal-data': true,
        filter: { 'case-template-id': [templateId] },
      });
      expect(created.statusCode, created.body).toBe(202);
      const id = resourceOf(created).id;
      const puts: string[] = [];
      const storage = {
        ...api.storage,
        put: (key: string, bytes: Uint8Array) => {
          puts.push(key);
          return api.storage.put(key, bytes);
        },
        get: (key: string) => api.storage.get(key),
        delete: (key: string) => api.storage.delete(key),
      };
      const exported = api.events.named('case.exported').length;

      await run(id, { storage, exportByteLimit: 1_024 });

      expect(resourceOf(await request('GET', `/case-exports/${id}`)).attributes).toMatchObject({
        status: 'failed',
        'error-code': 'export_too_large',
        'case-count': null,
      });
      expect(puts).toEqual([]);
      expect(api.events.named('case.exported')).toHaveLength(exported);
    },
  );

  it('writes a JSON export that fits its limit whole, one entry a case', async () => {
    const templateId = await template();
    await heavyCase(templateId, 2);
    await newCase(templateId);
    const created = await createExport({
      format: 'json',
      filter: { 'case-template-id': [templateId] },
    });
    const id = resourceOf(created).id;

    await run(id, { exportByteLimit: 1_048_576 });
    const download = await request('GET', `/case-exports/${id}/download`);

    expect(download.statusCode, download.body).toBe(200);
    const bundle = caseExportBundleSchema.parse(JSON.parse(download.body));
    expect(bundle.data.map(({ comments }) => comments.length).sort()).toEqual([0, 2]);
    expect(bundle.meta['case-count']).toBe(2);
  });
});

describe('who may read an export (P26) and what it may select (C138.1, P25)', () => {
  it('serves the creator alone, and re-checks pii:view at download', async () => {
    const templateId = await template();
    await newCase(templateId);
    const created = await createExport({
      format: 'csv',
      'include-personal-data': true,
      filter: { 'case-template-id': [templateId] },
    });
    const id = resourceOf(created).id;
    await run(id);
    const other = api.newUserToken(api.environmentId);
    const lessened = api.newUserToken(api.environmentId, {
      userId: USER,
      permissions: ['cases:export', 'cases:read'],
    });

    const otherRead = await request('GET', `/case-exports/${id}`, undefined, other);
    const otherDownload = await request('GET', `/case-exports/${id}/download`, undefined, other);
    const otherList = await request('GET', '/case-exports', undefined, other);
    const mine = await request('GET', '/case-exports?filter[status]=completed');
    const noPii = await request('GET', `/case-exports/${id}/download`, undefined, lessened);

    expect(otherRead.statusCode).toBe(404);
    expect(otherDownload.statusCode).toBe(404);
    expect((JSON.parse(otherList.body) as { data: unknown[] }).data).toEqual([]);
    expect(
      (JSON.parse(mine.body) as { data: { id: string }[] }).data.map((each) => each.id),
    ).toContain(id);
    expect(noPii.statusCode).toBe(403);
  });

  it('needs pii:view for personal data and a field search, and records a search by its shape', async () => {
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['cases:export', 'cases:read'],
      piiMasked: true,
    });
    const templateId = await template([
      { key: 'note', label: 'Note', type: 'string', config: { searchable: true } },
    ]);
    await newCase(templateId, { fields: { note: 'synthetic-value' } });

    const personal = await createExport({ format: 'csv', 'include-personal-data': true }, masked);
    const byField = await createExport(
      {
        format: 'csv',
        search: { query: { attribute: 'fields.note', operator: 'eq', value: 'synthetic-value' } },
      },
      masked,
    );
    const byStatus = await createExport({
      format: 'json',
      search: {
        query: {
          and: [
            { attribute: 'case_template_id', operator: 'eq', value: templateId },
            { attribute: 'fields.note', operator: 'eq', value: 'synthetic-value' },
          ],
        },
        sort: { attribute: 'created_at', direction: 'asc' },
      },
    });

    expect(personal.statusCode).toBe(403);
    expect(byField.statusCode).toBe(403);
    expect(byStatus.statusCode, byStatus.body).toBe(202);
    const entry = api.audit.withAction('case-export.created').at(-1);
    expect(entry?.metadata).toEqual({
      format: 'json',
      'include-personal-data': false,
      shape: {
        kind: 'search',
        leaves: [
          { attribute: 'case_template_id', operator: 'eq' },
          { attribute: 'fields.note', operator: 'eq' },
        ],
        sort: 'created_at',
      },
    });
    expect(JSON.stringify(entry)).not.toContain('synthetic-value');
    await run(resourceOf(byStatus).id);
    expect(
      resourceOf(await request('GET', `/case-exports/${resourceOf(byStatus).id}`)).attributes[
        'case-count'
      ],
    ).toBe(1);
  });

  it('refuses more than 10,000 cases, and follows C12 for case-exports', async () => {
    const big = await seedCaseTemplate(api.database.db, api.environmentId);
    await api.database.db.execute(sql`
      insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
        status, status_category, creator_type, creator_id, fields, redacted_at)
      select 'case_01' || lpad(n::text, 24, '0'), ${api.environmentId}, ${big.id}, ${big.versionId},
        ${big.key} || '-' || n, 'open', 'initial', 'user', ${USER}, null, now()
      from generate_series(1, 10001) as n`);

    const tooLarge = await createExport({
      format: 'csv',
      filter: { 'case-template-id': [big.id] },
    });
    limiter = {
      consume: (_key, policy) =>
        Promise.resolve({
          allowed: false,
          limit: policy.limit,
          remaining: 0,
          resetAt: new Date(),
          retryAfterSeconds: 7,
        }),
    };
    const limited = await createExport({ format: 'csv' });
    limiter = { consume: () => Promise.reject(new Error('synthetic limiter outage')) };
    const unanswered = await createExport({ format: 'csv', filter: { status: ['open'] } });
    limiter = allow;

    expect([tooLarge.statusCode, codeOf(tooLarge)]).toEqual([422, 'export_too_large']);
    expect([limited.statusCode, limited.headers['retry-after']]).toEqual([429, '7']);
    expect(unanswered.statusCode).toBe(422);
    expect(codeOf(unanswered)).toBe('export_too_large');
    expect(allow.calls.some(({ policy }) => policy.name === 'case-exports')).toBe(true);
    await api.database.db.execute(sql`delete from cases where case_template_id = ${big.id}`);
  });
});

describe('expiry (C138.1, C143.1; decision 69)', () => {
  it('deletes the file after 24 hours and reads expired, keeping its count', async () => {
    const templateId = await template();
    await newCase(templateId);
    const created = await createExport({
      format: 'csv',
      filter: { 'case-template-id': [templateId] },
    });
    const id = resourceOf(created).id;
    await run(id);
    const key = await api.database.client.query<{ storage_key: string }>(
      'select storage_key from case_exports where id = $1',
      [id],
    );

    api.clock.advance(24 * 60 * 60 * 1000);
    await runCaseExportSweep({
      db: api.database.db,
      storage: api.storage,
      clock: api.clock,
      logger: createCapturingLogger(),
    });
    const read = resourceOf(await request('GET', `/case-exports/${id}`)).attributes;
    const download = await request('GET', `/case-exports/${id}/download`);

    expect(await api.storage.get(key.rows[0]?.storage_key ?? '')).toBeNull();
    expect(read).toMatchObject({ status: 'expired', 'case-count': 1, 'byte-size': null });
    expect(download.statusCode).toBe(410);
  });
});

describe('print (C138.3)', () => {
  it('records the print with an audit entry, a history row and case.print-initiated', async () => {
    const templateId = await template();
    const caseId = await newCase(templateId);
    const before = api.events.named('case.print-initiated').length;

    const printed = await request('POST', `/cases/${caseId}/print`, { meta: {} });
    const unknown = await request('POST', '/cases/case_01M6FQZCV622MRCK2ZKC7F4HD9/print', {
      meta: {},
    });

    expect(printed.statusCode, printed.body).toBe(200);
    expect((JSON.parse(printed.body) as { data: { id: string } }).data.id).toBe(caseId);
    expect(api.events.named('case.print-initiated').slice(before)).toHaveLength(1);
    expect(api.audit.withAction('case.print-initiated').at(-1)).toMatchObject({
      resourceId: caseId,
      metadata: {},
    });
    const history = await api.database.client.query<{ kind: string }>(
      `select kind from case_history where case_id = $1 and kind = 'print-initiated'`,
      [caseId],
    );
    expect(history.rows).toHaveLength(1);
    expect(unknown.statusCode).toBe(404);
  });
});
