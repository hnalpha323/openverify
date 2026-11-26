/**
 * C100.1, C100.2, C100.5, C107.3, C107.5: the importer routes: both upload forms, the object sealed
 * for its row, the refusals, the request and file levels of idempotency, the `importers` policy
 * (10 an hour per environment), the reads, and no value in a stored API log. Every value is
 * synthetic. The job's own behaviour is in `jobs/importers/process.test.ts`.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  IMPORTER_LIST_KINDS,
  IMPORT_LIMITS,
  LIST_KIND_REGISTRY,
  importerDocumentSchema,
  type ListKind,
} from '@openverify/contracts';
import {
  completeImporter,
  decryptBytes,
  getImporter,
  listApiLogs,
  recordImportErrors,
  type ApiLog,
  type ImporterOutcome,
} from '@openverify/db';
import { seedList, testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ListImportJob, RateLimiter } from '../../ports.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { createDenyRateLimiter } from '../../test-support/fakes.js';
import { bearer, multipart, type TestTenant } from '../../test-support/harness.js';

const queued: ListImportJob[] = [];
const enqueue = vi.fn((job: ListImportJob) => {
  queued.push(job);
  return Promise.resolve();
});

let api: InquiryTestApi;
let tenant: TestTenant;

beforeAll(async () => {
  api = await createInquiryTestApi({ listImports: { enqueueListImport: enqueue } });
  tenant = await api.newTenant();
});

afterAll(async () => {
  await api.close();
});

const CSV = 'value\nfirst\nsecond\n';
const base64 = (text: string | Uint8Array) => Buffer.from(text).toString('base64');
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

const path = (kind: ListKind) => `/api/v1/importer/list-item/${LIST_KIND_REGISTRY[kind].plural}`;

const newList = async (kind: ListKind = 'string', environmentId = tenant.environmentId) =>
  (await seedList(api.database.db, environmentId, { kind })).id;

/** A file no other test holds, so the 24-hour window finds nothing by accident. */
const uniqueCsv = () => `value\n${testId('lis')}\n`;

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });

const post = (
  listId: string,
  options: {
    kind?: ListKind;
    file?: string;
    attributes?: Record<string, unknown>;
    headers?: Record<string, string>;
    token?: string;
  } = {},
) =>
  api.app.inject({
    method: 'POST',
    url: path(options.kind ?? 'string'),
    headers: { ...bearer(options.token ?? tenant.token), ...options.headers },
    payload: body({
      'list-id': listId,
      file: base64(options.file ?? uniqueCsv()),
      ...options.attributes,
    }),
  });

const postForm = async (
  fields: Parameters<typeof multipart>[0],
  options: { kind?: ListKind; headers?: Record<string, string> } = {},
) => {
  const form = await multipart(fields);
  return api.app.inject({
    method: 'POST',
    url: path(options.kind ?? 'string'),
    headers: { ...bearer(tenant.token), ...form.headers, ...options.headers },
    payload: form.payload,
  });
};

const file = (text: string | Uint8Array, filename = 'synthetic.csv') => ({
  bytes: typeof text === 'string' ? new TextEncoder().encode(text) : text,
  filename,
  type: 'text/csv',
});

interface ImporterJson {
  data: {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
    relationships: { list: { data: { id: string; type: string } } };
  };
}

const dataOf = (response: { json: () => unknown }) => (response.json() as ImporterJson).data;

const rowOf = (id: string) => getImporter(api.database.db, tenant.environmentId, id);

async function countImporters(listId: string): Promise<number> {
  const rows = await api.database.db.execute<{ count: number }>(
    sql`select count(*)::int as count from importers where list_id = ${listId}`,
  );
  return rows.rows[0]?.count ?? -1;
}

describe('POST /importer/list-item/<plural> as JSON (C100.1)', () => {
  it('answers a pending importer, seals the object for its row and enqueues the job', async () => {
    const listId = await newList();
    const text = uniqueCsv();

    const response = await post(listId, { file: text });

    expect(response.statusCode).toBe(201);
    const data = dataOf(response);
    expect(() => importerDocumentSchema.parse(response.json())).not.toThrow();
    expect(data.type).toBe('importer/list-item/string');
    expect(data.attributes).toMatchObject({
      status: 'pending',
      mode: 'all-or-nothing',
      encoding: 'utf-8',
      'file-sha256': sha256(text),
      'row-count': 0,
      'successful-count': 0,
      'completed-at': null,
    });
    expect(data.relationships.list.data).toEqual({ type: 'list/string', id: listId });

    const row = await rowOf(data.id);
    expect(row).toMatchObject({ fileBytes: text.length, attempts: 0 });
    const key = row?.storageKey ?? '';
    const ciphertext = await api.storage.get(key);
    expect(Buffer.from(ciphertext ?? []).toString()).not.toContain('value');
    const opened = decryptBytes(
      { wrappedDek: row?.wrappedDek ?? '', ciphertext: ciphertext ?? new Uint8Array() },
      api.database.keyring,
      { context: data.id },
    );
    expect(Buffer.from(opened).toString()).toBe(text);

    expect(queued).toContainEqual({ environmentId: tenant.environmentId, importerId: data.id });
    expect(row?.enqueuedAt).not.toBeNull();
  });

  it.each([...IMPORTER_LIST_KINDS])('takes a %s list', async (kind) => {
    const listId = (
      await seedList(api.database.db, tenant.environmentId, {
        kind,
        ...(kind === 'field' ? { fieldKey: 'synthetic-field' } : {}),
      })
    ).id;

    const response = await post(listId, { kind });

    expect(response.statusCode).toBe(201);
    expect(dataOf(response).type).toBe(`importer/list-item/${kind}`);
  });

  it('takes a mode, and reads an encoding label by its WHATWG name', async () => {
    const response = await post(await newList(), {
      attributes: { mode: 'skip-invalid', encoding: 'latin1' },
    });

    expect(dataOf(response).attributes).toMatchObject({
      mode: 'skip-invalid',
      encoding: 'windows-1252',
    });
  });

  it('records the enqueue before the job exists, so the job never meets that write’s row lock', async () => {
    // The job takes its row with SKIP LOCKED: a write to the row after the job was added could
    // make the job skip its own import until the sweep's next window (found by lists.spec.ts).
    let recorded: Date | null | undefined;
    enqueue.mockImplementationOnce(async (job: ListImportJob) => {
      recorded = (await getImporter(api.database.db, job.environmentId, job.importerId))
        ?.enqueuedAt;
      queued.push(job);
    });

    expect((await post(await newList())).statusCode).toBe(201);

    expect(recorded).toBeInstanceOf(Date);
  });

  it('answers 201 when the enqueue is lost, and leaves the row for the sweep', async () => {
    enqueue.mockRejectedValueOnce(new Error('unreachable'));

    const response = await post(await newList());

    expect(response.statusCode).toBe(201);
    expect((await rowOf(dataOf(response).id))?.enqueuedAt).toBeNull();
  });

  it('accepts a file of exactly 20 MB', async () => {
    const response = await post(await newList(), { file: 'a'.repeat(IMPORT_LIMITS.fileBytes) });

    expect(response.statusCode).toBe(201);
  });

  it('answers 413 past 20 MB, storing nothing', async () => {
    const listId = await newList();
    const big = 'a'.repeat(IMPORT_LIMITS.fileBytes + 1);
    const objects = api.storage.keys().length;

    const response = await post(listId, { file: big });

    expect(response.statusCode).toBe(413);
    expect(await countImporters(listId)).toBe(0);
    expect(api.storage.keys().length).toBe(objects);
  });

  it('refuses a body the schema refuses', async () => {
    const response = await post(await newList(), { attributes: { file: 'not base64!' } });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /importer/list-item/<plural> as multipart (C100.1)', () => {
  it('answers as JSON does, from the same parts', async () => {
    const listId = await newList();
    const text = uniqueCsv();

    const response = await postForm({
      'data[attributes][list-id]': listId,
      'data[attributes][file]': file(text),
      'data[attributes][mode]': 'skip-invalid',
      'data[attributes][encoding]': 'utf-8',
    });

    expect(response.statusCode).toBe(201);
    expect(dataOf(response).attributes).toMatchObject({
      mode: 'skip-invalid',
      encoding: 'utf-8',
      'file-sha256': sha256(text),
    });
  });

  it('keeps every byte: a file part is not read as text', async () => {
    const listId = await newList();
    const bytes = Uint8Array.from([0x76, 0x0a, 0xe9, 0x0a]);

    const response = await postForm({
      'data[attributes][list-id]': listId,
      'data[attributes][file]': file(bytes),
    });

    expect(dataOf(response).attributes['file-sha256']).toBe(sha256(bytes));
  });

  it('answers 413 past 20 MB', async () => {
    const response = await postForm({
      'data[attributes][list-id]': await newList(),
      'data[attributes][file]': file(new Uint8Array(IMPORT_LIMITS.fileBytes + 1)),
    });

    expect(response.statusCode).toBe(413);
  });

  it('refuses a form with no file part', async () => {
    const response = await postForm({ 'data[attributes][list-id]': await newList() });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a form with no list id', async () => {
    const response = await postForm({ 'data[attributes][file]': file(CSV) });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a file sent as a text field, which would hide its bytes', async () => {
    const response = await postForm({
      'data[attributes][list-id]': await newList(),
      'data[attributes][file]': CSV,
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a part it does not know', async () => {
    const response = await postForm({
      'data[attributes][list-id]': await newList(),
      'data[attributes][file]': file(CSV),
      'data[attributes][other]': 'x',
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a repeated part', async () => {
    const listId = await newList();
    const boundary = 'synthetic-boundary';
    const part = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

    const response = await api.app.inject({
      method: 'POST',
      url: path('string'),
      headers: {
        ...bearer(tenant.token),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload:
        part('data[attributes][list-id]', listId) +
        part('data[attributes][list-id]', listId) +
        `--${boundary}--\r\n`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a body that is not a form', async () => {
    const response = await api.app.inject({
      method: 'POST',
      url: path('string'),
      headers: {
        ...bearer(tenant.token),
        'content-type': 'multipart/form-data; boundary=synthetic-boundary',
      },
      payload: 'no parts here',
    });

    expect(response.statusCode).toBe(400);
  });

  it('checks a form’s mode and list id as the JSON schema does', async () => {
    const response = await postForm({
      'data[attributes][list-id]': await newList(),
      'data[attributes][file]': file(CSV),
      'data[attributes][mode]': 'nonsense',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('what the route refuses (C100.1, C100.2)', () => {
  it('answers 404 for a list that does not exist', async () => {
    const response = await post(testId('lst'));

    expect(response.statusCode).toBe(404);
  });

  it('answers 404 for another environment’s list', async () => {
    const other = await api.newTenant();
    const response = await post(await newList('string', other.environmentId));

    expect(response.statusCode).toBe(404);
  });

  it('answers 422 list_kind_mismatch for another kind of list', async () => {
    const response = await post(await newList('country'));

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'list_kind_mismatch' });
  });

  it('answers 409 list_archived for an archived list', async () => {
    const listId = (await seedList(api.database.db, tenant.environmentId, { status: 'archived' }))
      .id;

    const response = await post(listId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'list_archived' });
  });

  it.each([
    // The contract's pattern lets these two past: both are UTF-16 labels.
    ['csunicode'],
    ['iso-10646-ucs-2'],
    ['shift_jis'],
    ['gbk'],
    ['nonsense'],
  ])('answers 422 for the encoding %s', async (encoding) => {
    const listId = await newList();

    const response = await post(listId, { attributes: { encoding } });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'invalid_value',
      errors: [{ pointer: '/data/attributes/encoding' }],
    });
    expect(await countImporters(listId)).toBe(0);
  });

  it('leaves no object when the insert fails', async () => {
    const listId = await newList();
    const objects = api.storage.keys().length;
    const audit = vi.spyOn(api.audit, 'record').mockRejectedValueOnce(new Error('unreachable'));

    const response = await post(listId);

    expect(response.statusCode).toBe(500);
    expect(await countImporters(listId)).toBe(0);
    expect(api.storage.keys().length).toBe(objects);
    audit.mockRestore();
  });

  it('answers 500 and stores no row when the object cannot be stored', async () => {
    const listId = await newList();
    const put = vi.spyOn(api.storage, 'put').mockRejectedValueOnce(new Error('unreachable'));

    const response = await post(listId);

    expect(response.statusCode).toBe(500);
    expect(await countImporters(listId)).toBe(0);
    put.mockRestore();
  });

  it('needs importers:write beside lists:write', async () => {
    const listId = await newList();

    for (const permissions of [['lists:write'], ['importers:write']] as const) {
      const token = api.newUserToken(tenant.environmentId, { permissions });
      expect((await post(listId, { token })).statusCode).toBe(403);
    }
    const both = api.newUserToken(tenant.environmentId, {
      permissions: ['importers:write', 'lists:write'],
    });
    expect((await post(listId, { token: both })).statusCode).toBe(201);
  });
});

describe('idempotency at the request and the file (C100.5)', () => {
  it('a repeated Idempotency-Key replays the answer and stores one import', async () => {
    const listId = await newList();
    const text = uniqueCsv();
    const headers = { 'idempotency-key': randomUUID() };

    const first = await post(listId, { file: text, headers });
    const second = await post(listId, { file: text, headers });

    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(dataOf(second).id).toBe(dataOf(first).id);
    expect(await countImporters(listId)).toBe(1);
  });

  it('fingerprints a multipart body, whatever its boundary', async () => {
    const listId = await newList();
    const text = uniqueCsv();
    const headers = { 'idempotency-key': randomUUID() };
    const fields = {
      'data[attributes][list-id]': listId,
      'data[attributes][file]': file(text),
    };

    const first = await postForm(fields, { headers });
    const second = await postForm(fields, { headers });

    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(dataOf(second).id).toBe(dataOf(first).id);
  });

  it('the same list, mode and file within 24 hours answers the existing importer', async () => {
    const listId = await newList();
    const text = uniqueCsv();
    const objects = api.storage.keys().length;

    const first = await post(listId, { file: text });
    enqueue.mockClear();
    const second = await post(listId, { file: text });

    expect(second.statusCode).toBe(201);
    expect(dataOf(second).id).toBe(dataOf(first).id);
    expect(await countImporters(listId)).toBe(1);
    expect(api.storage.keys().length).toBe(objects + 1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('answers it through a multipart upload too', async () => {
    const listId = await newList();
    const text = uniqueCsv();

    const first = await post(listId, { file: text });
    const second = await postForm({
      'data[attributes][list-id]': listId,
      'data[attributes][file]': file(text),
    });

    expect(dataOf(second).id).toBe(dataOf(first).id);
  });

  it.each([
    ['another mode', { mode: 'skip-invalid' }],
    // A file refused as invalid UTF-8 must be able to come back under its real encoding.
    ['another encoding', { encoding: 'windows-1252' }],
  ])('%s is another import', async (_name, attributes) => {
    const listId = await newList();
    const text = uniqueCsv();

    await post(listId, { file: text });
    await post(listId, { file: text, attributes });

    expect(await countImporters(listId)).toBe(2);
  });

  it('another list is another import', async () => {
    const text = uniqueCsv();

    const first = await post(await newList(), { file: text });
    const second = await post(await newList(), { file: text });

    expect(dataOf(second).id).not.toBe(dataOf(first).id);
  });

  it('past 24 hours the same file is a new import', async () => {
    const listId = await newList();
    const text = uniqueCsv();
    const first = await post(listId, { file: text });

    api.clock.advance(IMPORT_LIMITS.fileIdempotencyHours * 3_600_000 + 1);
    const second = await post(listId, { file: text });

    expect(dataOf(second).id).not.toBe(dataOf(first).id);
  });
});

describe('the importers policy (C100.2, C107.3)', () => {
  it('takes one from the environment’s hourly allowance per new import', async () => {
    api.rateLimiter.calls.length = 0;

    await post(await newList());

    expect(api.rateLimiter.calls).toContainEqual({
      key: `importers:${tenant.environmentId}`,
      policy: { name: 'importers', limit: 10, windowSeconds: 3600 },
    });
  });

  it('counts a repeat of a file as nothing, since it starts nothing', async () => {
    const listId = await newList();
    const text = uniqueCsv();
    await post(listId, { file: text });
    api.rateLimiter.calls.length = 0;

    await post(listId, { file: text });

    expect(api.rateLimiter.calls.filter(({ policy }) => policy.name === 'importers')).toEqual([]);
  });

  describe('beyond the limit', () => {
    const deny = createDenyRateLimiter(120);
    let limited: InquiryTestApi;
    let limitedTenant: TestTenant;

    beforeAll(async () => {
      const allow = (await createInquiryTestApi()).rateLimiter;
      limited = await createInquiryTestApi({
        rateLimiter: {
          consume: (key, policy) =>
            policy.name === 'importers' ? deny.consume(key, policy) : allow.consume(key, policy),
        } satisfies RateLimiter,
      });
      limitedTenant = await limited.newTenant();
    });

    afterAll(async () => {
      await limited.close();
    });

    it('answers 429 with Retry-After, storing nothing', async () => {
      const listId = (await seedList(limited.database.db, limitedTenant.environmentId)).id;

      const response = await limited.app.inject({
        method: 'POST',
        url: path('string'),
        headers: bearer(limitedTenant.token),
        payload: body({ 'list-id': listId, file: base64(uniqueCsv()) }),
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('120');
      expect(limited.storage.keys().length).toBe(0);
    });
  });

  it('fails open when the limiter is down, as C12 does', async () => {
    const consume = vi.spyOn(api.rateLimiter, 'consume').mockImplementation((key, policy) =>
      policy.name === 'importers'
        ? Promise.reject(new Error('unreachable'))
        : Promise.resolve({
            allowed: true,
            limit: policy.limit,
            remaining: 1,
            resetAt: new Date(),
            retryAfterSeconds: 0,
          }),
    );

    const response = await post(await newList());

    expect(response.statusCode).toBe(201);
    consume.mockRestore();
  });
});

describe('the audit entry (C100.4)', () => {
  it('carries ids and counts, never a value', async () => {
    const listId = await newList();
    const text = 'value\nsentinel-person@example.com\n';

    const response = await post(listId, { file: text });

    const entry = api.audit.entries.find(
      ({ action, resourceId }) =>
        action === 'importer.created' && resourceId === dataOf(response).id,
    );
    expect(entry).toMatchObject({
      resourceType: 'importer',
      metadata: {
        'list-id': listId,
        'importer-type': 'importer/list-item/string',
        mode: 'all-or-nothing',
        encoding: 'utf-8',
        'file-bytes': text.length,
      },
    });
    expect(JSON.stringify(entry)).not.toContain('sentinel-person');
  });
});

describe('the reads (C100.1)', () => {
  const OUTCOME: ImporterOutcome = {
    status: 'errored',
    rowCount: 3,
    successfulCount: 0,
    duplicateCount: 0,
    alreadyPresentCount: 0,
    errorCount: 2,
    at: new Date('2026-10-21T00:00:00.000Z'),
  };

  it('GET /importers/:id answers the resource, with its counts once it ended', async () => {
    const listId = await newList('email-address');
    const created = dataOf(await post(listId, { kind: 'email-address' }));
    await completeImporter(api.database.db, tenant.environmentId, created.id, OUTCOME);

    const response = await api.app.inject({
      url: `/api/v1/importers/${created.id}`,
      headers: bearer(tenant.token),
    });

    expect(response.statusCode).toBe(200);
    expect(dataOf(response).type).toBe('importer/list-item/email-address');
    expect(dataOf(response).attributes).toMatchObject({
      status: 'errored',
      'row-count': 3,
      'error-count': 2,
      'completed-at': OUTCOME.at.toISOString(),
    });
  });

  it('answers 404 for another environment’s importer', async () => {
    const other = await api.newTenant();
    const created = dataOf(await post(await newList()));

    for (const url of [
      `/api/v1/importers/${created.id}`,
      `/api/v1/importers/${created.id}/errors`,
    ]) {
      const response = await api.app.inject({ url, headers: bearer(other.token) });
      expect(response.statusCode).toBe(404);
    }
  });

  it('GET /importers lists newest first, filters and pages', async () => {
    const listId = await newList();
    const first = dataOf(await post(listId));
    const second = dataOf(await post(listId));
    await completeImporter(api.database.db, tenant.environmentId, first.id, {
      ...OUTCOME,
      status: 'ready',
      errorCount: 0,
    });

    const all = await api.app.inject({
      url: `/api/v1/importers?filter[list-id]=${listId}&page[size]=1`,
      headers: bearer(tenant.token),
    });
    expect(all.statusCode).toBe(200);
    const page = all.json<{ data: { id: string }[]; links: { next: string | null } }>();
    expect(page.data).toHaveLength(1);
    expect(page.links.next).toContain('page[after]=');
    expect(page.links.next).toContain('filter[list-id]=');

    const pending = await api.app.inject({
      url: `/api/v1/importers?filter[list-id]=${listId}&filter[status]=pending`,
      headers: bearer(tenant.token),
    });
    expect(pending.json<{ data: { id: string }[] }>().data.map(({ id }) => id)).toEqual([
      second.id,
    ]);
  });

  it('answers 400 for a cursor of another list of importers', async () => {
    const response = await api.app.inject({
      url: `/api/v1/importers?page[after]=${testId('mprt')}`,
      headers: bearer(tenant.token),
    });

    expect(response.statusCode).toBe(400);
  });

  it('GET /importers/:id/errors serves codes and rows, whole-file errors first, by cursor', async () => {
    const created = dataOf(await post(await newList()));
    await recordImportErrors(api.database.db, tenant.environmentId, created.id, [
      { row: null, column: 'value', code: 'missing_column' },
      { row: 2, column: 'value', code: 'invalid_value' },
      { row: 5, column: null, code: 'field_count_mismatch' },
      { row: 9, column: 'value', code: 'out_of_range' },
    ]);
    const url = `/api/v1/importers/${created.id}/errors`;

    const first = await api.app.inject({
      url: `${url}?page[size]=2`,
      headers: bearer(tenant.token),
    });
    expect(first.statusCode).toBe(200);
    const page = first.json<{ data: unknown[]; links: { next: string | null } }>();
    expect(page.data).toEqual([
      { row: null, column: 'value', code: 'missing_column' },
      { row: 2, column: 'value', code: 'invalid_value' },
      { row: 5, column: null, code: 'field_count_mismatch' },
    ]);
    expect(page.links.next).toBe(`${url}?page[after]=5&page[size]=2`);

    const rest = await api.app.inject({
      url: page.links.next ?? '',
      headers: bearer(tenant.token),
    });
    expect(rest.json()).toEqual({
      data: [{ row: 9, column: 'value', code: 'out_of_range' }],
      links: { next: null },
    });
  });

  it('needs importers:read', async () => {
    const token = api.newUserToken(tenant.environmentId, { permissions: ['lists:read'] });

    const response = await api.app.inject({ url: '/api/v1/importers', headers: bearer(token) });

    expect(response.statusCode).toBe(403);
  });
});

describe('the stored API logs (C100.1, C107.5, F23)', () => {
  const SECRET = 'sentinel-person@example.com';

  async function logOf(requestId: string): Promise<ApiLog> {
    let found: ApiLog | undefined;
    await vi.waitFor(async () => {
      const { items } = await listApiLogs(api.database.db, tenant.environmentId, { size: 100 });
      found = items.find((item) => item.requestId === requestId);
      expect(found).toBeDefined();
    });
    if (found === undefined) {
      throw new Error('no log entry');
    }
    return found;
  }

  it('keeps a JSON file’s length and SHA-256 only', async () => {
    const text = `value\n${SECRET}\n`;
    const listId = await newList();

    const response = await post(listId, { file: text });

    const log = await logOf(String(response.headers['x-request-id']));
    expect(log.requestBody).toMatchObject({
      data: { attributes: { file: { length: text.length, sha256: sha256(text) } } },
    });
    expect(JSON.stringify(log)).not.toContain(base64(text));
  });

  it('keeps a multipart body’s part metadata, with no byte of the file', async () => {
    const listId = await newList();

    const response = await postForm({
      'data[attributes][list-id]': listId,
      'data[attributes][file]': file(`value\n${SECRET}\n`),
    });

    const log = await logOf(String(response.headers['x-request-id']));
    expect(JSON.stringify(log.requestBody)).not.toContain('sentinel-person');
    expect(JSON.stringify(log.responseBody)).not.toContain('sentinel-person');
  });

  it('a problem names no value', async () => {
    const response = await post(testId('lst'), { file: `value\n${SECRET}\n` });

    expect(response.body).not.toContain('sentinel-person');
  });
});
