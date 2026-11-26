/**
 * Workflow 9B Stage 1b, checkpoint (X): the exports, bulk report, delivery search and list filter
 * plumbing `foundation-9b` freezes for `api-exports` (C165.3, C165.4, C166, C174.3-C174.5; contracts
 * B16-B22):
 *
 * - `POST`/`GET /exports`, `GET /exports/:id` and its download, under the object type's `:export`
 *   (which no `:read` gives), the create counted by the `exports` policy (10 an hour per environment)
 *   first, each 501 until built, and listed in the OpenAPI document;
 * - `POST /reports/bulk` (multipart, at most 2 MiB, `reports:write`, the `report-bulk` policy, 5 an
 *   hour per environment) and `GET /reports/bulk/:id` (`reports:read`), 501 until built; the CSV never
 *   reaches a stored API log;
 * - `POST /webhook-deliveries/search` (`webhooks:read`), 501 until built;
 * - the list filter hooks: `inquiryListFilters` and `transactionListFilters`, called from the two list
 *   services with the query and the principal's PII visibility, whose stubs refuse every new filter
 *   with 501 (fail closed, B16) and whose conditions the lists apply; the transaction filter values
 *   written beside the field keys (`writeTransactionFilterValuesInTx`);
 * - the C16 pass running the export and bulk CSV retention, with its counts in the report;
 * - masking: an export body's `filter` and the new personal-data filters of a stored query or next
 *   link nulled for a reader without `pii:view`, and both bodies in the shared masked list;
 * - `blind-index:rebuild`: a filterable string field reads `transaction_field_keys`, which the rebuild
 *   already rewrites, so its equality lookup still answers under the new key (no new step).
 *
 * Every value is synthetic.
 */
import {
  PII_MASKED_ATTRIBUTES,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_POLICY_WINDOWS,
  REPORT_BULK_LIMITS,
  newId,
} from '@openverify/contracts';
import { listApiLogs, listTransactions as listTransactionRows } from '@openverify/db';
import * as dbExports from '@openverify/db';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runBlindIndexRebuild } from '../scripts/blind-index-rebuild.js';
import { createMemoryStorage } from './jobs/testing.js';
import type { RateLimiter } from './ports.js';
import { maskPersonalData } from './services/api-logs.js';
import * as exportRetention from './services/exports/retention.js';
import { inquiryListFilters } from './services/list-filters/inquiries.js';
import { writeTransactionFilterValuesInTx } from './services/list-filters/transaction-values.js';
import { transactionListFilters } from './services/list-filters/transactions.js';
import { runRetention } from './services/retention.js';
import { fieldValueKey } from './services/transactions/write-checks.js';
import { fixedClock } from './test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  multipart,
  type TestApi,
} from './test-support/harness.js';

vi.mock('./services/exports/retention.js', { spy: true });
vi.mock('./services/list-filters/inquiries.js', { spy: true });
vi.mock('./services/list-filters/transactions.js', { spy: true });
vi.mock('./services/list-filters/transaction-values.js', { spy: true });

/** Refuses only the keys of `policy`; every other count passes, as Valkey would. */
function refusing(policy: string): RateLimiter {
  return {
    consume: (key, rule) =>
      Promise.resolve({
        allowed: !key.startsWith(`${policy}:`),
        limit: rule.limit,
        remaining: 0,
        resetAt: new Date(0),
        retryAfterSeconds: key.startsWith(`${policy}:`) ? 30 : 0,
      }),
  };
}

/** Lets every count pass and records its key. */
function counting(keys: string[]): RateLimiter {
  return {
    consume: (key, rule) => {
      keys.push(key);
      return Promise.resolve({
        allowed: true,
        limit: rule.limit,
        remaining: rule.limit,
        resetAt: new Date(0),
        retryAfterSeconds: 0,
      });
    },
  };
}

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

const exportBody = (attributes: Record<string, unknown> = {}) => ({
  data: {
    type: 'export',
    attributes: {
      'object-type': 'inquiries',
      format: 'csv',
      filter: { 'filter[status]': 'completed' },
      ...attributes,
    },
  },
});

const postExport = (
  app: TestApi['app'],
  token: string,
  body: Record<string, unknown> = exportBody(),
) => app.inject({ method: 'POST', url: '/api/v1/exports', headers: bearer(token), payload: body });

/** A bulk CSV of synthetic query sources, as multipart. */
const bulkUpload = (csv = 'name-first,name-last\nAvery,Zyxw-synthetic-csv-row\n') =>
  multipart({
    'report-template-id': newId('rptp'),
    file: { bytes: Buffer.from(csv), filename: 'reports.csv', type: 'text/csv' },
  });

const postBulk = async (app: TestApi['app'], token: string, csv?: string) => {
  const form = await bulkUpload(csv);
  return app.inject({
    method: 'POST',
    url: '/api/v1/reports/bulk',
    headers: { ...bearer(token), ...form.headers },
    payload: form.payload,
  });
};

type OpenApiPaths = Record<string, Record<string, { responses?: Record<string, unknown> }>>;
const openApiPaths = async () =>
  (await api.app.inject({ url: '/openapi.json' })).json<{ paths: OpenApiPaths }>().paths;

describe('the export routes, frozen for api-exports (C166.1-C166.4)', () => {
  it("answers 202 to a key holding the object type's :export, once built (api-exports)", async () => {
    const tenant = await api.newTenant();

    const response = await postExport(api.app, tenant.token);

    expect(response.statusCode, response.body).toBe(202);
  });

  it("needs the object type's :export, which neither :read nor another type's :export gives", async () => {
    const tenant = await api.newTenant();
    const reader = await api.newApiKey(tenant.environmentId, { scopes: ['inquiries:read'] });
    const inquiryExporter = await api.newApiKey(tenant.environmentId, {
      scopes: ['inquiries:export'],
    });

    const outcomes = [
      (await postExport(api.app, reader)).statusCode,
      (await postExport(api.app, inquiryExporter, exportBody({ 'object-type': 'accounts' })))
        .statusCode,
      (await postExport(api.app, inquiryExporter)).statusCode,
    ];

    expect(outcomes).toEqual([403, 403, 202]);
  });

  it('reads the contract: a filter or a saved view, never both, and a verification type', async () => {
    const tenant = await api.newTenant();

    const outcomes = [
      await postExport(api.app, tenant.token, exportBody({ 'saved-view-id': newId('svw') })),
      await postExport(
        api.app,
        tenant.token,
        exportBody({ 'object-type': 'verifications', filter: { 'filter[status]': 'passed' } }),
      ),
      await postExport(api.app, tenant.token, exportBody({ format: 'xlsx' })),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([400, 400, 400]);
  });

  it('answers the list, and 404 to the read and the download of an unknown export, once built', async () => {
    const tenant = await api.newTenant();
    const id = newId('exp');

    const outcomes = await Promise.all(
      ['/exports?filter[status]=completed', `/exports/${id}`, `/exports/${id}/download`].map(
        async (url) =>
          (await api.app.inject({ url: `/api/v1${url}`, headers: bearer(tenant.token) }))
            .statusCode,
      ),
    );

    expect(outcomes).toEqual([200, 404, 404]);
  });

  it('lists them in the OpenAPI document with the contract’s answers', async () => {
    const paths = await openApiPaths();

    expect(Object.keys(paths['/api/v1/exports']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['202', '400', '401', '403', '422', '429']),
    );
    expect(Object.keys(paths['/api/v1/exports']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401']),
    );
    expect(Object.keys(paths['/api/v1/exports/{id}']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '404']),
    );
    expect(Object.keys(paths['/api/v1/exports/{id}/download']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '403', '404', '410']),
    );
  });
});

describe('the exports policy (C174.4)', () => {
  it('is 10 an hour per environment, and refuses an export with 429 before anything else', async () => {
    expect((RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>).exports).toBe(10);
    expect((RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>).exports).toBe(3600);
    const limited = await createTestApi({ rateLimiter: refusing('exports') });
    try {
      const response = await postExport(limited.app, limited.token);
      expect(response.statusCode, response.body).toBe(429);
      expect(response.headers['retry-after']).toBe('30');
    } finally {
      await limited.close();
    }
  });

  it('counts the environment, once per export asked for, and not for a refused permission', async () => {
    const keys: string[] = [];
    const counted = await createTestApi({ rateLimiter: counting(keys) });
    try {
      const reader = await counted.newApiKey(counted.environmentId, { scopes: ['inquiries:read'] });
      await postExport(counted.app, reader);
      await postExport(counted.app, counted.token);
      const exports = keys.filter((key) => key.startsWith('exports:'));
      expect(exports).toEqual([`exports:${counted.environmentId}`]);
    } finally {
      await counted.close();
    }
  });
});

describe('the bulk report routes, frozen for api-exports (C166.5)', () => {
  it('answer a key holding reports:write and reports:read once built: an unknown template 422, an unknown job 404', async () => {
    const tenant = await api.newTenant();

    const created = await postBulk(api.app, tenant.token);
    const read = await api.app.inject({
      url: `/api/v1/reports/bulk/${newId('rbulk')}`,
      headers: bearer(tenant.token),
    });

    expect([created.statusCode, read.statusCode]).toEqual([422, 404]);
  });

  it('need reports:write to upload and reports:read to read', async () => {
    const tenant = await api.newTenant();
    const reader = await api.newApiKey(tenant.environmentId, { scopes: ['reports:read'] });
    const other = await api.newApiKey(tenant.environmentId, { scopes: ['inquiries:read'] });

    const outcomes = [
      (await postBulk(api.app, reader)).statusCode,
      (
        await api.app.inject({
          url: `/api/v1/reports/bulk/${newId('rbulk')}`,
          headers: bearer(other),
        })
      ).statusCode,
    ];

    expect(outcomes).toEqual([403, 403]);
  });

  it('refuse a body past 2 MiB with its framing (413), and a body that is not multipart (400)', async () => {
    const tenant = await api.newTenant();
    const big = `name-first\n${'x'.repeat(REPORT_BULK_LIMITS.bytes + 128 * 1024)}\n`;

    const tooBig = await postBulk(api.app, tenant.token, big);
    const json = await api.app.inject({
      method: 'POST',
      url: '/api/v1/reports/bulk',
      headers: bearer(tenant.token),
      payload: { 'report-template-id': newId('rptp') },
    });

    expect([tooBig.statusCode, json.statusCode]).toEqual([413, 400]);
  });

  it('keep the CSV out of the stored API log: part metadata only (C166.5; review P24)', async () => {
    const tenant = await api.newTenant();

    expect((await postBulk(api.app, tenant.token)).statusCode).toBe(422);

    await vi.waitFor(async () => {
      const logs = await listApiLogs(api.database.db, tenant.environmentId);
      const upload = logs.items.find((log) => log.path === '/api/v1/reports/bulk');
      expect(upload).toBeDefined();
      const stored = JSON.stringify(upload?.requestBody);
      expect(stored).toContain('"name":"file"');
      expect(stored).not.toContain('Zyxw-synthetic-csv-row');
      expect(stored).not.toContain('Avery');
    });
  });

  it('are counted by the report-bulk policy, 5 an hour per environment (C174.4, review P35)', async () => {
    expect((RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>)['report-bulk']).toBe(5);
    expect((RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>)['report-bulk']).toBe(
      3600,
    );
    const limited = await createTestApi({ rateLimiter: refusing('report-bulk') });
    const keys: string[] = [];
    const counted = await createTestApi({ rateLimiter: counting(keys) });
    try {
      const refused = await postBulk(limited.app, limited.token);
      expect(refused.statusCode, refused.body).toBe(429);
      await postBulk(counted.app, counted.token);
      expect(keys.filter((key) => key.startsWith('report-bulk:'))).toEqual([
        `report-bulk:${counted.environmentId}`,
      ]);
    } finally {
      await limited.close();
      await counted.close();
    }
  });

  it('are listed in the OpenAPI document', async () => {
    const paths = await openApiPaths();

    expect(Object.keys(paths['/api/v1/reports/bulk']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['202', '400', '401', '403', '413', '415', '422', '429']),
    );
    expect(Object.keys(paths['/api/v1/reports/bulk/{id}']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '401', '403', '404']),
    );
  });
});

describe('POST /webhook-deliveries/search, frozen for api-exports (C165.4)', () => {
  const search = (token: string, query: unknown) =>
    api.app.inject({
      method: 'POST',
      url: '/api/v1/webhook-deliveries/search',
      headers: bearer(token),
      payload: { query },
    });
  const clause = { attribute: 'status', operator: 'eq', value: 'failed' };

  it('answers webhooks:read once built (api-exports), and 403 without it', async () => {
    const tenant = await api.newTenant();
    const reader = await api.newApiKey(tenant.environmentId, { scopes: ['webhooks:read'] });
    const other = await api.newApiKey(tenant.environmentId, { scopes: ['inquiries:read'] });

    expect([
      (await search(reader, clause)).statusCode,
      (await search(other, clause)).statusCode,
    ]).toEqual([200, 403]);
  });

  it('reads the grammar: two levels of operators at most', async () => {
    const tenant = await api.newTenant();

    const deep = await search(tenant.token, { and: [{ or: [{ not: clause }] }] });

    expect(deep.statusCode).toBe(400);
  });

  it('is listed in the OpenAPI document', async () => {
    const paths = await openApiPaths();

    expect(Object.keys(paths['/api/v1/webhook-deliveries/search']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403']),
    );
  });
});

describe('the inquiry list filters fail closed until built (C165.3; B16, B17)', () => {
  const list = (query: string, token = api.token) =>
    api.app.inject({ url: `/api/v1/inquiries?${query}`, headers: bearer(token) });

  it('answer each new filter once built (api-exports), and keep the old list', async () => {
    const outcomes = await Promise.all(
      [
        'filter[list-match]=matched',
        `filter[list-id]=${newId('lst')}`,
        'filter[check]=id_expired&filter[check-status]=failed',
        'filter[next-step-name]=address-step',
        'filter[status]=completed',
      ].map(async (query) => (await list(query)).statusCode),
    );

    expect(outcomes).toEqual([200, 200, 200, 200, 200]);
  });

  it('hand the hook the query and the PII visibility of the principal', async () => {
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['inquiries:read'],
      piiMasked: true,
    });

    await list('filter[status]=completed');
    await list('filter[status]=pending', masked);

    expect(vi.mocked(inquiryListFilters).mock.calls.map(([, input]) => input)).toEqual([
      {
        environmentId: api.environmentId,
        query: expect.objectContaining({ 'filter[status]': 'completed' }) as unknown,
        piiVisible: true,
      },
      {
        environmentId: api.environmentId,
        query: expect.objectContaining({ 'filter[status]': 'pending' }) as unknown,
        piiVisible: false,
      },
    ]);
  });

  it("apply the hook's conditions and repeat its filters in the next link", async () => {
    await createInquiry(api);
    await createInquiry(api);
    vi.mocked(inquiryListFilters)
      .mockResolvedValueOnce({ where: [sql`false`], links: {} })
      .mockResolvedValueOnce({ where: [], links: { 'filter[list-match]': 'matched' } });

    const none = await list('filter[list-match]=matched');
    const paged = await list('filter[list-match]=matched&page[size]=1');

    expect(none.statusCode, none.body).toBe(200);
    expect(none.json<{ data: unknown[] }>().data).toEqual([]);
    expect(paged.statusCode, paged.body).toBe(200);
    expect(paged.json<{ links: { next: string | null } }>().links.next).toContain(
      'filter[list-match]=matched',
    );
  });

  it('list 501 among the inquiry list’s answers in the OpenAPI document', async () => {
    const paths = await openApiPaths();

    expect(Object.keys(paths['/api/v1/inquiries']?.get?.responses ?? {})).not.toContain('501');
  });
});

describe('the transaction list and its filter values (C165.3; B16, B18)', () => {
  const FIELDS = [
    { type: 'integer', key: 'amount', label: 'Amount', config: { filterable: true } },
    {
      type: 'string',
      key: 'channel',
      label: 'Channel',
      config: { searchable: true, filterable: true },
    },
  ];

  /** A published transaction type of `FIELDS` in `target`'s environment. */
  async function publishedType(target: TestApi = api): Promise<string> {
    const created = await target.app.inject({
      method: 'POST',
      url: '/api/v1/transaction-types',
      headers: bearer(target.token),
      payload: {
        data: {
          type: 'transaction-type',
          attributes: { name: `Synthetic ${newId('txntp')}`, 'field-schemas': FIELDS },
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const typeId = created.json<{ data: { id: string } }>().data.id;
    const result = await target.database.db.execute(
      sql`select id from transaction_type_versions where transaction_type_id = ${typeId}`,
    );
    const versionId = (result as unknown as { rows: { id: string }[] }).rows[0]?.id ?? '';
    const published = await target.app.inject({
      method: 'POST',
      url: `/api/v1/transaction-type-versions/${versionId}/publish`,
      headers: bearer(target.token),
    });
    expect(published.statusCode, published.body).toBe(200);
    return typeId;
  }

  async function newTransaction(typeId: string, target: TestApi = api): Promise<string> {
    const response = await target.app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: bearer(target.token),
      payload: {
        data: {
          type: 'transaction',
          attributes: { 'transaction-type-id': typeId, fields: { amount: 42, channel: 'web' } },
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

  it('refuses a field filter on no filterable field with 400, never an unfiltered answer, and keeps the old list', async () => {
    const tenant = await api.newTenant();
    const outcomes = await Promise.all(
      ['filter[fields.amount]=42', 'filter[fields.channel]=web', 'filter[status]=created'].map(
        async (query) =>
          (
            await api.app.inject({
              url: `/api/v1/transactions?${query}`,
              headers: bearer(tenant.token),
            })
          ).statusCode,
      ),
    );

    expect(outcomes).toEqual([400, 400, 200]);
  });

  it('hands the hook the whole query, filter[identifier] included, the PII visibility and the key', async () => {
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['transactions:read'],
      piiMasked: true,
    });

    await api.app.inject({
      url: '/api/v1/transactions?filter[identifier][key]=channel&filter[identifier][value]=web',
      headers: bearer(api.token),
    });
    await api.app.inject({ url: '/api/v1/transactions', headers: bearer(masked) });

    expect(vi.mocked(transactionListFilters).mock.calls.map(([, input]) => input)).toEqual([
      {
        environmentId: api.environmentId,
        query: expect.objectContaining({
          'filter[identifier][key]': 'channel',
          'filter[identifier][value]': 'web',
        }) as unknown,
        piiVisible: true,
        blindIndexKey: api.deps.blindIndexKey,
      },
      {
        environmentId: api.environmentId,
        query: expect.any(Object) as unknown,
        piiVisible: false,
        blindIndexKey: api.deps.blindIndexKey,
      },
    ]);
  });

  it("applies the hook's conditions to the list", async () => {
    await newTransaction(await publishedType());
    vi.mocked(transactionListFilters).mockResolvedValueOnce({ where: [sql`false`], links: {} });

    const response = await api.app.inject({
      url: '/api/v1/transactions?filter[fields.amount]=42',
      headers: bearer(api.token),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it('writes the filter values beside the field keys, all at creation and the changed ones after', async () => {
    const typeId = await publishedType();
    const id = await newTransaction(typeId);
    const changed = await api.app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: bearer(api.token),
      payload: { data: { type: 'transaction', attributes: { fields: { amount: 43 } } } },
    });
    expect(changed.statusCode, changed.body).toBe(200);

    const writes = vi.mocked(writeTransactionFilterValuesInTx).mock.calls.map(([, write]) => write);
    expect(writes).toEqual([
      {
        environmentId: api.environmentId,
        transactionId: id,
        fieldSchemas: expect.arrayContaining([
          expect.objectContaining({ key: 'amount' }),
        ]) as unknown,
        fields: {
          amount: { type: 'integer', value: 42 },
          channel: { type: 'string', value: 'web' },
        },
        changedFieldKeys: null,
      },
      {
        environmentId: api.environmentId,
        transactionId: id,
        fieldSchemas: expect.arrayContaining([
          expect.objectContaining({ key: 'amount' }),
        ]) as unknown,
        fields: {
          amount: { type: 'integer', value: 43 },
          channel: { type: 'string', value: 'web' },
        },
        changedFieldKeys: ['amount'],
      },
    ]);
  });

  it('lists 501 among the transaction list’s answers in the OpenAPI document', async () => {
    const paths = await openApiPaths();

    expect(Object.keys(paths['/api/v1/transactions']?.get?.responses ?? {})).not.toContain('501');
  });

  it('keeps a filterable string field answering after blind-index:rebuild, with no new step', async () => {
    const own = await createTestApi();
    try {
      const id = await newTransaction(await publishedType(own), own);
      const newKey = new Uint8Array(32).fill(7);

      await runBlindIndexRebuild({
        db: own.database.db,
        key: newKey,
        args: { batchSize: 50 },
        out: () => undefined,
      });

      const page = await listTransactionRows(
        own.database.db,
        own.environmentId,
        {
          identifier: {
            fieldKey: 'channel',
            valueKey: fieldValueKey(newKey, own.environmentId, 'channel', 'web'),
          },
        },
        { size: 10 },
      );
      expect(page.items.map((transaction) => transaction.id)).toEqual([id]);
    } finally {
      await own.close();
    }
  });
});

describe('the C16 pass runs the export and bulk CSV retention (C166.1, C166.5, C174.3)', () => {
  it('calls the hook once with the run’s storage, now and batch, and reports its counts', async () => {
    vi.mocked(exportRetention.runExportRetention).mockResolvedValueOnce({
      expiredExports: 3,
      failedExportDeletes: 1,
      deletedReportBulkFiles: 2,
      failedReportBulkFileDeletes: 0,
    });
    const clock = fixedClock();
    const storage = createMemoryStorage();

    const report = await runRetention({
      db: api.database.db,
      redaction: api.redaction,
      storage,
      clock,
      batchSize: 50,
    });

    expect(exportRetention.runExportRetention).toHaveBeenCalledTimes(1);
    expect(exportRetention.runExportRetention).toHaveBeenCalledWith(
      { db: api.database.db, storage },
      { now: clock.now(), limit: 50 },
    );
    expect(report).toMatchObject({
      expiredExports: 3,
      failedExportDeletes: 1,
      deletedReportBulkFiles: 2,
      failedReportBulkFileDeletes: 0,
    });
  });
});

describe('masking of the export and bulk bodies and the new filters (C174.5; B19; review P24)', () => {
  it("nulls an export body's filter, keeping its other members", () => {
    expect(
      maskPersonalData({
        data: {
          type: 'export',
          attributes: {
            'object-type': 'inquiries',
            filter: { 'filter[reference-id]': 'synthetic-reference' },
          },
        },
      }),
    ).toEqual({
      data: { type: 'export', attributes: { 'object-type': 'inquiries', filter: null } },
    });
  });

  it('nulls the step reached and every field filter of a stored query, keeping the keys', () => {
    expect(
      maskPersonalData({
        'filter[next-step-name]': 'Address',
        'filter[fields.amount]': '42',
        'filter[fields.channel]': 'web',
        'filter[status]': 'completed',
      }),
    ).toEqual({
      'filter[next-step-name]': null,
      'filter[fields.amount]': null,
      'filter[fields.channel]': null,
      'filter[status]': 'completed',
    });
  });

  it('drops their values from a stored next link', () => {
    const masked = maskPersonalData({
      links: {
        next: '/api/v1/inquiries?filter[next-step-name]=Address&filter[status]=completed&page[after]=inq_01J00000000000000000000000',
      },
    }) as { links: { next: string } };
    const transactions = maskPersonalData({
      links: { next: '/api/v1/transactions?filter[fields.channel]=web&page[size]=1' },
    }) as { links: { next: string } };

    expect(masked.links.next).toContain('filter[next-step-name]=&');
    expect(masked.links.next).not.toContain('Address');
    expect(masked.links.next).toContain('filter[status]=completed');
    expect(transactions.links.next).toBe(
      '/api/v1/transactions?filter[fields.channel]=&page[size]=1',
    );
  });

  it('holds both bodies in the shared masked list', () => {
    expect(PII_MASKED_ATTRIBUTES).toEqual(expect.arrayContaining(['filter', 'file']));
  });

  it('holds the bulk CSV row cap equal to the table’s (packages/db cannot read contracts)', () => {
    expect((dbExports as Readonly<Record<string, unknown>>).REPORT_BULK_MAX_ROWS).toBe(
      REPORT_BULK_LIMITS.rows,
    );
  });
});
