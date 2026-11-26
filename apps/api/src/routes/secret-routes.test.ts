/**
 * Workflow 8A Stage 1b (X) (C125.2, C126.4): the frozen routes of the egress family, registered with
 * their contract schemas and scopes, and in the OpenAPI document. Each reaches its handler after its
 * authentication, scope and schema, and its own suite covers the answers. A sandbox search exists in
 * sandbox environments only. Synthetic values.
 */
import type { ApiScope } from '@openverify/core';
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
const KEY = 'crm_token';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Route = [method: Method, url: string, scope: ApiScope, payload?: unknown];

const call = (method: Method, url: string, payload?: unknown, token = api.token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const named = (attributes: Record<string, unknown>) => ({
  data: { type: 'workflow-secret', attributes },
});
const value = { data: { attributes: { 'secret-value': 'change-me-synthetic-canary' } } };

/** The test's environment exists only once `beforeAll` has run, so a route names it `:env`. */
const VALUE_URL = `/workflow-secrets/${KEY}/values/:env`;
const urlOf = (url: string) => url.replace(':env', api.environmentId);

const ROUTES: Route[] = [
  ['GET', '/workflow-secrets', 'secrets:read'],
  [
    'POST',
    '/workflow-secrets',
    'secrets:write',
    named({ key: KEY, 'allowed-hosts': ['api.example.com'] }),
  ],
  ['GET', `/workflow-secrets/${KEY}`, 'secrets:read'],
  ['PATCH', `/workflow-secrets/${KEY}`, 'secrets:write', named({ description: 'CRM' })],
  ['DELETE', `/workflow-secrets/${KEY}`, 'secrets:write'],
  ['PUT', VALUE_URL, 'secrets:write', value],
  ['POST', `${VALUE_URL}/rotate`, 'secrets:write', value],
  [
    'POST',
    '/sandbox/email-messages/search',
    'sandbox:read',
    { 'email-address': 'person@example.com' },
  ],
  ['POST', '/sandbox/slack-messages/search', 'sandbox:read', { 'secret-id': `wsec_${ULID}` }],
  [
    'POST',
    '/sandbox/workflow-sms-messages/search',
    'sandbox:read',
    { 'phone-number': '+15555550100' },
  ],
];

const label = (route: Route) => `${route[0]} ${route[1]}`;

/** What authentication, a scope and a schema answer; a handler's own 404 is its own suite's. */
const REFUSED_BEFORE_THE_HANDLER = [400, 401, 403];

describe('the frozen routes (C125.2, C126.4)', () => {
  it.each(ROUTES.map((route) => [label(route), route] as const))(
    '%s reaches its handler',
    async (_label, [method, url, , payload]) => {
      const response = await call(method, urlOf(url), payload);

      expect(REFUSED_BEFORE_THE_HANDLER, response.body).not.toContain(response.statusCode);
    },
  );

  it.each(ROUTES.map((route) => [label(route), route] as const))(
    '%s needs its scope',
    async (_label, [method, url, scope, payload]) => {
      const without = await api.newApiKey(api.environmentId, { scopes: ['api-logs:read'] });
      const holding = await api.newApiKey(api.environmentId, { scopes: [scope] });

      expect((await call(method, urlOf(url), payload, without)).statusCode).toBe(403);
      const allowed = await call(method, urlOf(url), payload, holding);

      expect(REFUSED_BEFORE_THE_HANDLER, allowed.body).not.toContain(allowed.statusCode);
    },
  );

  it.each(ROUTES.map((route) => [label(route), route] as const))(
    '%s needs a principal',
    async (_label, [method, url]) => {
      const response = await api.app.inject({ method, url: `/api/v1${urlOf(url)}` });

      expect(response.statusCode).toBe(401);
    },
  );

  it('are all in the OpenAPI document (only plugin-registered routes are)', async () => {
    const response = await api.app.inject({ url: '/openapi.json' });
    const paths = Object.keys(response.json<{ paths: Record<string, unknown> }>().paths);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/workflow-secrets',
        '/api/v1/workflow-secrets/{key}',
        '/api/v1/workflow-secrets/{key}/values/{environmentId}',
        '/api/v1/workflow-secrets/{key}/values/{environmentId}/rotate',
        '/api/v1/sandbox/email-messages/search',
        '/api/v1/sandbox/slack-messages/search',
        '/api/v1/sandbox/workflow-sms-messages/search',
      ]),
    );
  });
});

describe('a secret’s value (C125.2)', () => {
  it('needs its value in the body', async () => {
    expect((await call('PUT', urlOf(VALUE_URL), { data: { attributes: {} } })).statusCode).toBe(
      400,
    );
  });

  it('refuses a control character, which would split a header', async () => {
    const payload = { data: { attributes: { 'secret-value': 'change-me\r\nX-Injected: 1' } } };

    expect((await call('PUT', urlOf(VALUE_URL), payload)).statusCode).toBe(400);
  });

  it('refuses a malformed key in the path', async () => {
    expect((await call('GET', '/workflow-secrets/Not-A-Key')).statusCode).toBe(400);
  });

  it('refuses another kind of id for the environment', async () => {
    const url = `/workflow-secrets/${KEY}/values/key_${ULID}`;

    expect((await call('PUT', url, value)).statusCode).toBe(400);
  });
});

describe('the sandbox searches (C126.4)', () => {
  it.each([
    ['/sandbox/email-messages/search', { 'email-address': 'person@example.com' }],
    ['/sandbox/slack-messages/search', { 'secret-id': `wsec_${ULID}` }],
    ['/sandbox/workflow-sms-messages/search', { 'phone-number': '+15555550100' }],
  ])('%s answers an empty list with nothing recorded', async (url, payload) => {
    const response = await call('POST', url, payload);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ data: [] });
  });

  it.each([
    ['/sandbox/email-messages/search', { 'email-address': 'person@example.com' }],
    ['/sandbox/slack-messages/search', { 'secret-id': `wsec_${ULID}` }],
    ['/sandbox/workflow-sms-messages/search', { 'phone-number': '+15555550100' }],
  ])('%s answers 404 in a production environment', async (url, payload) => {
    const { token } = await api.newTenant({ kind: 'production' });

    expect((await call('POST', url, payload, token)).statusCode).toBe(404);
  });

  it('takes no address in a URL', async () => {
    const response = await call(
      'GET',
      '/sandbox/email-messages/search?email-address=person%40example.com',
    );

    expect(response.statusCode).toBe(404);
  });
});
