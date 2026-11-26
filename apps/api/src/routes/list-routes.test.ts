/**
 * Workflow 7B Stage 1b (L) (C97.1, C99.3, C99.4, C100.1): the frozen routes of the lists family,
 * registered with their contract schemas and scopes (built by `api-lists` and `api-importers` in
 * Stage 3, whose own tests cover their answers; the importers' are in
 * `routes/server/importers.test.ts`), and in the OpenAPI document. Until built each answers 501,
 * after its authentication, scope and schema. Synthetic values.
 */
import { IMPORTER_LIST_KINDS, LIST_KINDS, LIST_KIND_REGISTRY } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const ULID = '01M5CK16P0D13FXHZSS4TCFBVH';
const LIST = `lst_${ULID}`;

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });

describe('the list routes (C97.1)', () => {
  it('checks the kind body before it reaches the handler', async () => {
    expect((await call('POST', '/list/fields', body({ name: 'Synthetic' }))).statusCode).toBe(400);
  });

  it('PATCH /lists/:id takes the four members', async () => {
    expect((await call('PATCH', `/lists/${LIST}`, body({ version: 2 }))).statusCode).toBe(400);
  });

  it('POST /lists/match needs lists:read and pii:view (P11)', async () => {
    const payload = body({ probes: [{ kind: 'string', value: 'synthetic' }] });
    const match = (token: string) =>
      api.app.inject({
        method: 'POST',
        url: '/api/v1/lists/match',
        headers: bearer(token),
        payload,
      });
    const both = api.newUserToken(api.environmentId, { permissions: ['lists:read', 'pii:view'] });
    const masked = api.newUserToken(api.environmentId, { permissions: ['lists:read'] });

    expect((await match(both)).statusCode).not.toBe(403);
    // An API key sees PII unless it was minted masked (C15), so it passes without a `pii:view` scope.
    expect((await match(api.token)).statusCode).not.toBe(403);
    expect((await match(masked)).statusCode).toBe(403);
  });

  it('needs its scope and a principal', async () => {
    const viewer = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });
    expect(
      (await api.app.inject({ url: '/api/v1/lists', headers: bearer(viewer) })).statusCode,
    ).toBe(403);
    expect((await api.app.inject({ url: '/api/v1/lists' })).statusCode).toBe(401);
  });

  it('refuses an id of the wrong prefix', async () => {
    expect((await call('GET', `/lists/inq_${ULID}`)).statusCode).toBe(400);
  });
});

describe('the importer routes (C100.1)', () => {
  it('has no route for faces or backgrounds (decision 27)', async () => {
    const response = await call(
      'POST',
      '/importer/list-item/faces',
      body({ 'list-id': LIST, file: 'dmFsdWUK' }),
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('the OpenAPI document (C97, C99, C100)', () => {
  it('lists every frozen path', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>();
    const paths = Object.keys(document.paths);

    for (const kind of LIST_KINDS) {
      expect(paths).toContain(`/api/v1/list/${LIST_KIND_REGISTRY[kind].plural}`);
      expect(paths).toContain(`/api/v1/list-item/${LIST_KIND_REGISTRY[kind].plural}/{id}`);
    }
    for (const kind of IMPORTER_LIST_KINDS) {
      expect(paths).toContain(`/api/v1/importer/list-item/${LIST_KIND_REGISTRY[kind].plural}`);
    }
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/lists',
        '/api/v1/lists/{id}',
        '/api/v1/lists/match',
        '/api/v1/list-items',
        '/api/v1/list-matches',
        '/api/v1/list-matches/{id}',
        '/api/v1/list-matches/{id}/dismiss',
        '/api/v1/importers',
        '/api/v1/importers/{id}',
        '/api/v1/importers/{id}/errors',
      ]),
    );
  });
});
