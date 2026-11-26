/**
 * Workflow 7B Stage 1b (G) (C102.1, C102.4, C102.6, C103.1): the frozen routes of the graph family,
 * registered with their contract schemas and scopes (built by `api-graph` in Stage 3, whose own
 * tests cover their answers, `graph-query-routes.test.ts`), and in the OpenAPI document. Each
 * reaches its handler after its authentication, scope and schema. `graph:read` for every `GET`, `graph:write` for every write and
 * for running, re-running and cancelling (P11, F29); viewers never hold `graph:read`; the unmask
 * needs `pii:view` (P17). Nothing a client sends reaches a stored API log read without `pii:view`.
 * Synthetic values.
 */
import { BUILTIN_ROLES } from '@openverify/core';
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
const TEMPLATE = `grqt_${ULID}`;
const VERSION = `grqtv_${ULID}`;
const QUERY = `grphq_${ULID}`;
const NODE = 'gn_AbCdEfGhIjKlMnOpQrStUv';
const ACCOUNT = `acc_${ULID}`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const call = (method: Method, url: string, payload?: unknown, token = api.token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });

/** What the authentication, scope and schema answer, and the stub's 501. */
const HELD_BACK = [400, 401, 403, 501];

const CONFIG = {
  parameters: [{ name: 'email', kind: 'email_address' }],
  start: [{ kind: 'email_address', value: '{{email}}' }],
  'connect-kinds': ['email_address', 'phone_number'],
};

const RUN = body({
  'graph-query-template-id': TEMPLATE,
  'parameter-map': { email: 'synthetic@example.com' },
});

describe('the graph query template routes (C102.1)', () => {
  it.each<[Method, string, unknown]>([
    ['POST', '/graph-query-templates', body({ name: 'Shared email', config: CONFIG })],
    ['GET', '/graph-query-templates', undefined],
    ['GET', '/graph-query-templates?filter[status]=active', undefined],
    ['GET', `/graph-query-templates/${TEMPLATE}`, undefined],
    ['PATCH', `/graph-query-templates/${TEMPLATE}`, body({ name: 'Renamed' })],
    ['DELETE', `/graph-query-templates/${TEMPLATE}`, undefined],
  ])('%s %s reaches its handler', async (method, url, payload) => {
    expect(HELD_BACK).not.toContain((await call(method, url, payload)).statusCode);
  });

  it('takes the name alone on a PATCH: the config is a version’s', async () => {
    expect(
      (await call('PATCH', `/graph-query-templates/${TEMPLATE}`, body({ config: CONFIG })))
        .statusCode,
    ).toBe(400);
  });

  it('checks the config before it reaches the handler (C102.2)', async () => {
    const bad = body({ name: 'Bad', config: { ...CONFIG, 'max-hops': 5 } });
    const sql = body({
      name: 'Bad',
      config: { ...CONFIG, start: [{ kind: 'email_address', value: 'x OR 1=1' }] },
    });

    expect((await call('POST', '/graph-query-templates', bad)).statusCode).toBe(400);
    expect((await call('POST', '/graph-query-templates', sql)).statusCode).toBe(400);
  });
});

describe('the graph query template version routes (C102.1)', () => {
  it.each<[Method, string, unknown]>([
    [
      'POST',
      '/graph-query-template-versions',
      body({ 'graph-query-template-id': TEMPLATE, config: CONFIG }),
    ],
    ['GET', `/graph-query-template-versions/${VERSION}`, undefined],
    ['PATCH', `/graph-query-template-versions/${VERSION}`, body({ config: CONFIG })],
    ['POST', `/graph-query-template-versions/${VERSION}/publish`, undefined],
  ])('%s %s reaches its handler', async (method, url, payload) => {
    expect(HELD_BACK).not.toContain((await call(method, url, payload)).statusCode);
  });
});

describe('the graph query routes (C102.4, C102.6, C103.1)', () => {
  it.each<[Method, string, unknown]>([
    ['POST', '/graph-queries', RUN],
    [
      'POST',
      '/graph-queries',
      {
        data: {
          attributes: {
            'graph-query-template-id': TEMPLATE,
            'variable-map': { email: 'synthetic@example.com' },
            'timeout-in-seconds': 5,
          },
        },
        meta: { 'run-sync': true },
      },
    ],
    ['GET', '/graph-queries', undefined],
    ['GET', `/graph-queries?filter[graph-query-template-id]=${TEMPLATE}`, undefined],
    ['GET', `/graph-queries/${QUERY}`, undefined],
    ['POST', `/graph-queries/${QUERY}/rerun`, undefined],
    ['POST', `/graph-queries/${QUERY}/cancel`, undefined],
    ['GET', `/graph-queries/${QUERY}/nodes/${NODE}/value`, undefined],
    [
      'POST',
      `/graph-queries/${QUERY}/actions`,
      body({ action: 'add-tag', tag: 'synthetic', 'account-ids': [ACCOUNT], preview: true }),
    ],
    ['POST', `/graph-queries/${QUERY}/actions`, body({ action: 'export', all: true })],
  ])('%s %s reaches its handler', async (method, url, payload) => {
    expect(HELD_BACK).not.toContain((await call(method, url, payload)).statusCode);
  });

  it('refuses both parameter maps at once, a timeout over 59 s, and a node id that is a value', async () => {
    const both = body({
      'graph-query-template-id': TEMPLATE,
      'parameter-map': { email: 'synthetic@example.com' },
      'variable-map': { email: 'synthetic@example.com' },
    });
    const slow = body({
      'graph-query-template-id': TEMPLATE,
      'parameter-map': {},
      'timeout-in-seconds': 60,
    });

    expect((await call('POST', '/graph-queries', both)).statusCode).toBe(400);
    expect((await call('POST', '/graph-queries', slow)).statusCode).toBe(400);
    expect(
      (await call('GET', `/graph-queries/${QUERY}/nodes/synthetic@example.com/value`)).statusCode,
    ).toBe(400);
  });

  it('refuses a selection of both kinds, and more than 500 accounts (C103.1)', async () => {
    const both = body({ action: 'export', all: true, 'account-ids': [ACCOUNT] });
    const many = body({
      action: 'export',
      'account-ids': Array.from(
        { length: 501 },
        (_, index) => `acc_01M5CK16P0D13FXHZSS4T${String(index).padStart(3, '0')}`,
      ),
    });

    expect((await call('POST', `/graph-queries/${QUERY}/actions`, both)).statusCode).toBe(400);
    expect((await call('POST', `/graph-queries/${QUERY}/actions`, many)).statusCode).toBe(400);
  });
});

describe('the graph scopes (C102.1, P11, F29)', () => {
  it('reads with graph:read and writes and runs with graph:write', async () => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['graph:read'] });
    const writer = api.newUserToken(api.environmentId, { permissions: ['graph:write'] });

    expect((await call('GET', '/graph-queries', undefined, reader)).statusCode).toBe(200);
    expect((await call('GET', '/graph-query-templates', undefined, reader)).statusCode).toBe(200);
    for (const [method, url, payload] of [
      ['POST', '/graph-queries', RUN],
      ['POST', `/graph-queries/${QUERY}/rerun`, undefined],
      ['POST', `/graph-queries/${QUERY}/cancel`, undefined],
      ['POST', '/graph-query-templates', body({ name: 'Shared email' })],
      ['POST', `/graph-query-template-versions/${VERSION}/publish`, undefined],
    ] as const) {
      expect((await call(method, url, payload, reader)).statusCode, url).toBe(403);
      expect(HELD_BACK, url).not.toContain((await call(method, url, payload, writer)).statusCode);
    }
    expect((await call('GET', '/graph-queries', undefined, writer)).statusCode).toBe(403);
  });

  it('keeps graph results from viewers (NOT_FOR_VIEWERS)', async () => {
    const viewer = api.newUserToken(api.environmentId, {
      permissions: BUILTIN_ROLES.viewer.permissions,
    });
    expect(BUILTIN_ROLES.viewer.permissions).not.toContain('graph:read');

    expect((await call('GET', '/graph-queries', undefined, viewer)).statusCode).toBe(403);
    expect((await call('GET', `/graph-queries/${QUERY}`, undefined, viewer)).statusCode).toBe(403);
  });

  it('needs pii:view to unmask a node (P17), and graph:read for an action (V18)', async () => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['graph:read'] });
    const unmasker = api.newUserToken(api.environmentId, {
      permissions: ['graph:read', 'pii:view'],
    });
    const value = `/graph-queries/${QUERY}/nodes/${NODE}/value`;

    expect((await call('GET', value, undefined, reader)).statusCode).toBe(403);
    expect(HELD_BACK).not.toContain((await call('GET', value, undefined, unmasker)).statusCode);
    const writer = api.newUserToken(api.environmentId, { permissions: ['graph:write'] });
    expect(
      (
        await call(
          'POST',
          `/graph-queries/${QUERY}/actions`,
          body({ action: 'export', all: true }),
          writer,
        )
      ).statusCode,
    ).toBe(403);
  });
});

describe('the graph routes in the OpenAPI document (C102, C103)', () => {
  it('documents every path, the export as text/csv beside JSON', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    }>();

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/graph-queries',
        '/api/v1/graph-queries/{id}',
        '/api/v1/graph-queries/{id}/rerun',
        '/api/v1/graph-queries/{id}/cancel',
        '/api/v1/graph-queries/{id}/nodes/{nodeId}/value',
        '/api/v1/graph-queries/{id}/actions',
        '/api/v1/graph-query-templates',
        '/api/v1/graph-query-templates/{id}',
        '/api/v1/graph-query-template-versions',
        '/api/v1/graph-query-template-versions/{id}',
        '/api/v1/graph-query-template-versions/{id}/publish',
      ]),
    );
    expect(
      document.paths['/api/v1/graph-queries/{id}/actions']?.post?.responses['200'],
    ).toMatchObject({ content: { 'application/json': {}, 'text/csv': {} } });
  });
});

describe('no graph value in a stored API log read without pii:view (C107.5, P07)', () => {
  it('masks the parameter map of a run', async () => {
    await call('POST', '/graph-queries', RUN);
    const reader = api.newUserToken(api.environmentId, { permissions: ['api-logs:read'] });

    const response = await api.app.inject({
      url: '/api/v1/api-logs?page[size]=100',
      headers: bearer(reader),
    });
    const logs = response.json<{ data: { attributes: Record<string, unknown> }[] }>().data;
    const log = logs.find((entry) => entry.attributes.path === '/api/v1/graph-queries');

    expect(log).toBeDefined();
    expect(JSON.stringify(log)).not.toContain('synthetic@example.com');
  });
});
