/**
 * Workflow 7B Stage 1b (T) (C104.1, C105.2): the frozen routes of the transactions family, registered
 * with their contract schemas and scopes (built by `api-transactions` in Stage 3, whose own tests
 * cover their answers), and in the OpenAPI document. Until built each answers 501, after its
 * authentication, scope and schema. Nothing a client sends reaches a stored API log read without
 * `pii:view`. Synthetic values.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, multipart } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const ULID = '01M5CK16P0D13FXHZSS4TCFBVH';
const TYPE = `txntp_${ULID}`;
const VERSION = `txntpv_${ULID}`;
const TRANSACTION = `txn_${ULID}`;
const FILE = `txnf_${ULID}`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

const call = (method: Method, url: string, payload?: unknown, token = api.token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });
const meta = (members: Record<string, unknown>) => ({ meta: members });

const FIELD_SCHEMA = { type: 'string', key: 'iban', label: 'IBAN' };
const FILE_PART = { filename: 'statement.pdf', bytes: Buffer.from('synthetic-bytes') };

describe('the transaction type routes (C104.1)', () => {
  it('takes the name alone on a PATCH: the rest is a version’s', async () => {
    const response = await call(
      'PATCH',
      `/transaction-types/${TYPE}`,
      body({ 'field-schemas': [] }),
    );
    expect(response.statusCode).toBe(400);
  });

  it('checks a field schema before it reaches the handler (C104.2)', async () => {
    const good = body({ name: 'Payout', 'field-schemas': [FIELD_SCHEMA] });
    const bad = body({ name: 'Payout', 'field-schemas': [{ ...FIELD_SCHEMA, type: 'nope' }] });

    expect((await call('POST', '/transaction-types', good)).statusCode).toBe(201);
    expect((await call('POST', '/transaction-types', bad)).statusCode).toBe(400);
  });

  it('answers 400, never 500, for a field schema nested far past the caps (C104.2)', async () => {
    let nested: Record<string, unknown> = FIELD_SCHEMA;
    for (let level = 0; level < 1_200; level += 1) {
      nested = {
        type: 'hash',
        key: `h${String(level)}`,
        label: 'Nested',
        config: { 'item-schemas': [nested] },
      };
    }
    const deep = body({ name: 'Payout', 'field-schemas': [nested] });

    expect((await call('POST', '/transaction-types', deep)).statusCode).toBe(400);
    expect(
      (
        await call('POST', '/transaction-type-versions', {
          data: { attributes: { 'transaction-type-id': TYPE, 'field-schemas': [nested] } },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('reads with transactions:read and writes with transaction-types:write', async () => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });
    const writer = api.newUserToken(api.environmentId, {
      permissions: ['transaction-types:write'],
    });

    expect((await call('GET', '/transaction-types', undefined, reader)).statusCode).toBe(200);
    expect(
      (await call('POST', '/transaction-types', body({ name: 'Payout' }), reader)).statusCode,
    ).toBe(403);
    expect((await call('GET', '/transaction-types', undefined, writer)).statusCode).toBe(403);
    expect(
      (await call('POST', '/transaction-types', body({ name: 'Payout' }), writer)).statusCode,
    ).toBe(201);
  });
});

describe('the transaction type version routes (C104.1)', () => {
  it('refuses an empty PATCH', async () => {
    expect(
      (await call('PATCH', `/transaction-type-versions/${VERSION}`, body({}))).statusCode,
    ).toBe(400);
  });

  it('needs transaction-types:write to publish', async () => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });
    expect(
      (await call('POST', `/transaction-type-versions/${VERSION}/publish`, undefined, reader))
        .statusCode,
    ).toBe(403);
  });
});

describe('the transaction routes (C105.2)', () => {
  it('takes one half of filter[identifier] nowhere (C105.2)', async () => {
    expect((await call('GET', '/transactions?filter[identifier][key]=iban')).statusCode).toBe(400);
  });

  it('refuses a transaction id of the wrong prefix, and a bad field key', async () => {
    expect((await call('GET', `/transactions/inq_${ULID}`)).statusCode).toBe(400);
    expect(
      (await call('PUT', `/transactions/${TRANSACTION}/files/Not%20A%20Key`, undefined)).statusCode,
    ).toBe(400);
  });

  it('refuses objects of a kind add-objects does not take, and more than 100', async () => {
    const url = `/transactions/${TRANSACTION}/add-objects`;
    expect((await call('POST', url, meta({ 'object-ids': [`acc_${ULID}`] }))).statusCode).toBe(400);
    const many = Array.from(
      { length: 101 },
      (_, index) => `inq_${ULID.slice(0, -2)}${String(index % 10)}A`,
    );
    expect((await call('POST', url, meta({ 'object-ids': many }))).statusCode).toBe(400);
  });

  it('needs transactions:redact to redact, and inquiries:redact too for biometrics (C105.6)', async () => {
    const write = api.newUserToken(api.environmentId, { permissions: ['transactions:write'] });
    const redact = api.newUserToken(api.environmentId, { permissions: ['transactions:redact'] });
    const both = api.newUserToken(api.environmentId, {
      permissions: ['transactions:redact', 'inquiries:redact'],
    });
    const biometrics = `/transactions/${TRANSACTION}/redact-biometrics`;

    expect(
      (await call('DELETE', `/transactions/${TRANSACTION}`, undefined, write)).statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/transactions/${TRANSACTION}`, undefined, redact)).statusCode,
    ).toBe(404);
    expect((await call('POST', biometrics, undefined, redact)).statusCode).toBe(403);
    expect((await call('POST', biometrics, undefined, both)).statusCode).toBe(404);
  });

  it('needs a principal', async () => {
    expect((await api.app.inject({ url: '/api/v1/transactions' })).statusCode).toBe(401);
  });
});

describe('the file routes (C105.2, P12, P22)', () => {
  const content = `/transactions/${TRANSACTION}/files/${FILE}/content`;
  const upload = `/transactions/${TRANSACTION}/files/statement`;

  it('serves content with transactions:read and pii:view, never cached', async () => {
    const both = api.newUserToken(api.environmentId, {
      permissions: ['transactions:read', 'pii:view'],
    });
    const response = await call('GET', content, undefined, both);

    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('refuses a user without pii:view first, and lets an unmasked API key through (C15)', async () => {
    const masked = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });
    const refused = await call('GET', content, undefined, masked);

    expect(refused.statusCode).toBe(403);
    expect(refused.headers['cache-control']).toBe('private, no-store');
    expect((await call('GET', content)).statusCode).toBe(404);
  });

  it('takes a multipart body, and answers 404 for a transaction that does not exist', async () => {
    const form = await multipart({ file: FILE_PART });

    const response = await api.app.inject({
      method: 'PUT',
      url: `/api/v1${upload}`,
      headers: { ...bearer(api.token), ...form.headers },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(404);
  });

  it('needs transactions:write to upload', async () => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });
    const form = await multipart({ file: FILE_PART });

    const response = await api.app.inject({
      method: 'PUT',
      url: `/api/v1${upload}`,
      headers: { ...bearer(reader), ...form.headers },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(403);
  });

  it('takes no file in a JSON body: a create keeps the default body limit (P22)', async () => {
    const response = await call(
      'POST',
      '/transactions',
      body({ 'transaction-type-id': TYPE, fields: { statement: 'x'.repeat(1_100_000) } }),
    );

    expect(response.statusCode).toBe(413);
  });

  it('passes an Idempotency-Key by: the plugin covers POST and PATCH, and a PUT replaces', async () => {
    const form = await multipart({ file: FILE_PART });

    const response = await api.app.inject({
      method: 'PUT',
      url: `/api/v1${upload}`,
      headers: { ...bearer(api.token), ...form.headers, 'idempotency-key': 'synthetic-key-1' },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('the stored API logs (C107.5, P07)', () => {
  /** The newest log of the path, as a user without `pii:view` reads it. */
  async function logRead(path: string) {
    const reader = api.newUserToken(api.environmentId, { permissions: ['api-logs:read'] });
    const response = await api.app.inject({
      url: '/api/v1/api-logs?page[size]=100',
      headers: bearer(reader),
    });
    const logs = response.json<{ data: { attributes: Record<string, unknown> }[] }>().data;
    return logs.find((log) => log.attributes.path === path)?.attributes;
  }

  it('holds no field value of a create, read without pii:view', async () => {
    await call(
      'POST',
      '/transactions',
      body({ 'transaction-type-id': TYPE, fields: { iban: 'synthetic-iban-value' } }),
    );

    const log = await logRead('/api/v1/transactions');

    expect(log).toBeDefined();
    expect(JSON.stringify(log)).not.toContain('synthetic-iban-value');
  });

  it('holds no searched value of a list, read without pii:view (C105.2)', async () => {
    await call(
      'GET',
      '/transactions?filter[identifier][key]=iban&filter[identifier][value]=synthetic-search',
    );

    const log = await logRead('/api/v1/transactions');

    expect(log).toBeDefined();
    expect(JSON.stringify(log)).not.toContain('synthetic-search');
  });

  it('keeps nothing of an uploaded file', async () => {
    const path = `/api/v1/transactions/${TRANSACTION}/files/statement`;
    const form = await multipart({ file: FILE_PART });
    await api.app.inject({
      method: 'PUT',
      url: path,
      headers: { ...bearer(api.token), ...form.headers },
      payload: form.payload,
    });

    const log = await logRead(path);

    expect(log).toBeDefined();
    expect(log?.['request-body'] ?? null).toBeNull();
    expect(JSON.stringify(log)).not.toContain('synthetic-bytes');
    expect(JSON.stringify(log)).not.toContain('statement.pdf');
  });
});

describe('the OpenAPI document (C104.1, C105.2)', () => {
  interface OpenApi {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  }

  it('lists every frozen path', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<OpenApi>();

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/transaction-types',
        '/api/v1/transaction-types/{id}',
        '/api/v1/transaction-type-versions',
        '/api/v1/transaction-type-versions/{id}',
        '/api/v1/transaction-type-versions/{id}/publish',
        '/api/v1/transactions',
        '/api/v1/transactions/{id}',
        '/api/v1/transactions/{id}/files/{fileId}/content',
        '/api/v1/transactions/{id}/files/{fieldKey}',
        '/api/v1/transactions/{id}/redact-biometrics',
        '/api/v1/transactions/{id}/add-objects',
        '/api/v1/transactions/{id}/remove-objects',
        '/api/v1/transactions/{id}/add-relation',
        '/api/v1/transactions/{id}/remove-relation',
        '/api/v1/transactions/{id}/add-tag',
        '/api/v1/transactions/{id}/remove-tag',
        '/api/v1/transactions/{id}/set-tags',
        '/api/v1/transactions/{id}/label',
      ]),
    );
  });

  it('marks redact-biometrics x-private (C105.6)', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<OpenApi>();
    const operation = document.paths['/api/v1/transactions/{id}/redact-biometrics']?.post;

    expect(operation?.['x-private']).toBe(true);
  });

  it('documents the upload as multipart and the content as bytes', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<OpenApi>();
    const upload = document.paths['/api/v1/transactions/{id}/files/{fieldKey}']?.put;
    const content = document.paths['/api/v1/transactions/{id}/files/{fileId}/content']?.get;

    expect(JSON.stringify(upload?.requestBody)).toContain('multipart/form-data');
    // OpenAPI 3.1 states bytes by the media type alone, with no `format`.
    expect(content?.responses).toMatchObject({
      200: { content: { 'application/octet-stream': {} } },
    });
  });
});
