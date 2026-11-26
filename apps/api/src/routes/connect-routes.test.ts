/**
 * Workflow 11A Stage 1b (C) (`foundation-11a`): the Connect server routes, frozen with their contract
 * schemas and registered as plugins (so they are in `/openapi.json`), each answering 501 until
 * `api-connect` (connections, share tokens, peek) and `api-redeem` (redeem) build them, behind the
 * install switch: while `OPENVERIFY_CONNECT_ENABLED` is false (`deps.connect` absent or off) every
 * one answers the one generic 404 of C232.8, byte for byte (C231.10).
 *
 * Also wired here: 422 `share_policy_invalid` with the issues' JSON pointers when every failing body
 * issue lies under `/data/attributes/share-policy` (Stage 1a amendment 27), and the rate policies
 * `connect-redeem` and `connect-peek`, each keyed by principal and environment (amendment 5, V11),
 * `connect-peek` failing closed (503 `connect_peek_unavailable`, C233.5).
 */
import { readFileSync } from 'node:fs';
import { CONNECT_NOT_FOUND_PROBLEM } from '@openverify/contracts';
import type { RateLimiter } from '../ports.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAllowAllRateLimiter } from '../test-support/fakes.js';
import { bearer, createTestApi, type TestApi } from '../test-support/harness.js';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../contracts/fixtures/api/connect/${name}`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;

const POLICY = fixture('share-policy.json');
const CXN = 'cxn_01M5CN0000000000000011A100';
const CNST = 'cnst_01M5CN0000000000000011A200';
const DESTINATION_ORG = 'org_01M5CN0000000000000011A300';

const createConnection = {
  data: { attributes: { 'destination-organization-id': DESTINATION_ORG, 'share-policy': POLICY } },
};

/** Every Connect server route with a body its schema accepts. */
const ROUTES: { method: 'GET' | 'POST'; url: string; payload?: unknown }[] = [
  { method: 'POST', url: '/api/v1/connect/connections', payload: createConnection },
  { method: 'GET', url: '/api/v1/connect/connections' },
  { method: 'GET', url: `/api/v1/connect/connections/${CXN}` },
  { method: 'POST', url: `/api/v1/connect/connections/${CXN}/deactivate`, payload: {} },
  { method: 'POST', url: `/api/v1/connect/connections/${CXN}/reactivate`, payload: {} },
  {
    method: 'POST',
    url: `/api/v1/connect/connections/${CXN}/share-policy`,
    payload: { data: { attributes: { 'share-policy': POLICY } } },
  },
  {
    method: 'POST',
    url: '/api/v1/connect/share-tokens',
    payload: {
      data: {
        attributes: {
          'connection-id': CXN,
          'source-id': 'inq_01M5CN0000000000000011A400',
          'consent-record-id': 'cnsr_01M5CN0000000000000011A500',
        },
      },
    },
  },
  { method: 'GET', url: '/api/v1/connect/share-tokens' },
  { method: 'GET', url: `/api/v1/connect/share-tokens/${CNST}` },
  { method: 'GET', url: `/api/v1/connect/share-tokens/${CNST}?peek-source-data=true` },
  { method: 'POST', url: `/api/v1/connect/share-tokens/${CNST}/expire`, payload: {} },
  {
    method: 'POST',
    url: `/api/v1/connect/share-tokens/${CNST}/redeem`,
    payload: fixture('redeem-clone-inquiry.json'),
  },
];

const REDEEM = ROUTES.find((route) => route.url.endsWith('/redeem')) ?? { method: 'POST', url: '' };

/** A fresh Idempotency-Key per call, so no answer is a replay of another test's (C12). */
let callCount = 0;

const call = (api: TestApi, route: (typeof ROUTES)[number], token = api.token) =>
  api.app.inject({
    method: route.method,
    url: route.url,
    headers: {
      ...bearer(token),
      'idempotency-key': `synthetic-${String((callCount += 1))}`,
    },
    ...(route.payload === undefined ? {} : { payload: route.payload as Record<string, unknown> }),
  });

/** The problem without the per-request members. */
const genericOf = (body: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

describe('while Connect is off (OPENVERIFY_CONNECT_ENABLED unset, C231.10)', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await createTestApi();
  });
  afterAll(async () => {
    await api.close();
  });

  it.each(ROUTES)('answers $method $url with the one generic 404', async (route) => {
    const response = await call(api, route);
    expect(response.statusCode).toBe(404);
    expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });

  it('builds every refusal from one function: the bodies differ only by instance and request id', async () => {
    const bodies = await Promise.all(
      ROUTES.map(async (route) => genericOf((await call(api, route)).body)),
    );
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
  });

  it('leaves the routes in the OpenAPI document either way', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();
    expect(Object.keys(document.paths['/api/v1/connect/connections'] ?? {}).sort()).toEqual([
      'get',
      'post',
    ]);
    for (const path of [
      '/api/v1/connect/connections/{id}',
      '/api/v1/connect/connections/{id}/deactivate',
      '/api/v1/connect/connections/{id}/reactivate',
      '/api/v1/connect/connections/{id}/share-policy',
      '/api/v1/connect/share-tokens',
      '/api/v1/connect/share-tokens/{id}',
      '/api/v1/connect/share-tokens/{id}/expire',
      '/api/v1/connect/share-tokens/{id}/redeem',
    ]) {
      expect(document.paths[path], path).toBeDefined();
    }
  });
});

describe('while Connect is on: frozen at 501 until their owners build them', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await createTestApi({ connect: { enabled: true } });
  });
  afterAll(async () => {
    await api.close();
  });

  // Workflow 11A api-connect checkpoints 1 and 2 and api-redeem checkpoint 1: every route is built
  // (the redeem route answers an unknown token with the one 404).
  it.each(ROUTES)(
    'answers $method $url from its service, never 501, once api-connect built it',
    async (route) => {
      const response = await call(api, route);
      expect(response.statusCode, response.body).not.toBe(501);
    },
  );

  it('answers a policy that breaks a rule with 422 share_policy_invalid and its pointers (amendment 27)', async () => {
    const policy = { ...POLICY, biometric: false };
    const response = await call(api, {
      method: 'POST',
      url: '/api/v1/connect/connections',
      payload: {
        data: {
          attributes: { 'destination-organization-id': DESTINATION_ORG, 'share-policy': policy },
        },
      },
    });
    expect(response.statusCode).toBe(422);
    const problem = response.json<{
      code: string;
      errors: { location: string; pointer: string }[];
    }>();
    expect(problem.code).toBe('share_policy_invalid');
    expect(problem.errors.length).toBeGreaterThan(0);
    for (const error of problem.errors) {
      expect(error.location).toBe('body');
      expect(error.pointer.startsWith('/data/attributes/share-policy')).toBe(true);
    }
  });

  it('escapes a slash inside a peek path as ~1 in the pointer', async () => {
    const policy = { ...POLICY, peek: { 'verification/document.status': 'full' } };
    const response = await call(api, {
      method: 'POST',
      url: `/api/v1/connect/connections/${CXN}/share-policy`,
      payload: { data: { attributes: { 'share-policy': policy } } },
    });
    expect(response.statusCode).toBe(422);
    const pointers = response
      .json<{ errors: { pointer: string }[] }>()
      .errors.map((e) => e.pointer);
    expect(pointers).toContain('/data/attributes/share-policy/peek/verification~1document.status');
  });

  it('keeps any other body error a 400', async () => {
    const response = await call(api, {
      method: 'POST',
      url: '/api/v1/connect/connections',
      payload: { data: { attributes: { 'share-policy': { ...POLICY, biometric: false } } } },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('the connect-redeem and connect-peek policies (C240.3, amendment 5)', () => {
  it('counts a redemption under connect-redeem, keyed by the key and its environment', async () => {
    const api = await createTestApi({ connect: { enabled: true } });
    try {
      const before = api.rateLimiter.calls.length;
      await call(api, REDEEM);
      const redeem = api.rateLimiter.calls
        .slice(before)
        .filter((entry) => (entry.policy.name as string) === 'connect-redeem');
      expect(redeem).toHaveLength(1);
      expect(redeem[0]?.key).toMatch(
        new RegExp(`^key_[0-9A-HJKMNP-TV-Z]{26}:${api.environmentId}$`),
      );
      expect(redeem[0]?.policy).toMatchObject({ limit: 60, windowSeconds: 60 });
    } finally {
      await api.close();
    }
  });

  it('counts a peek under connect-peek, and a plain retrieve under neither', async () => {
    const api = await createTestApi({ connect: { enabled: true } });
    try {
      const before = api.rateLimiter.calls.length;
      await call(api, { method: 'GET', url: `/api/v1/connect/share-tokens/${CNST}` });
      await call(api, {
        method: 'GET',
        url: `/api/v1/connect/share-tokens/${CNST}?peek-source-data=true`,
      });
      const names = api.rateLimiter.calls.slice(before).map((entry) => entry.policy.name as string);
      expect(names.filter((name) => name === 'connect-peek')).toHaveLength(1);
      expect(names.filter((name) => name === 'connect-redeem')).toHaveLength(0);
    } finally {
      await api.close();
    }
  });

  it('refuses a peek with 503 connect_peek_unavailable when the limiter cannot answer (fails closed)', async () => {
    const allow = createAllowAllRateLimiter();
    const failingPeek: RateLimiter = {
      consume: (key, policy) =>
        (policy.name as string) === 'connect-peek'
          ? Promise.reject(new Error('synthetic limiter outage'))
          : allow.consume(key, policy),
    };
    const api = await createTestApi({
      connect: { enabled: true },
      rateLimiter: failingPeek,
    });
    try {
      const peek = await call(api, {
        method: 'GET',
        url: `/api/v1/connect/share-tokens/${CNST}?peek-source-data=true`,
      });
      expect(peek.statusCode).toBe(503);
      expect(peek.json<{ code: string }>().code).toBe('connect_peek_unavailable');
      expect(peek.body).not.toContain('synthetic limiter outage');
    } finally {
      await api.close();
    }
  });
});

describe('the documented problems once every Connect route is built (integration-11a)', () => {
  it('documents no 501 on any Connect route, the share-consent exits or the inquiry create', () => {
    const document = JSON.parse(
      readFileSync(new URL('../../../../docs/api/openapi.json', import.meta.url), 'utf8'),
    ) as { paths: Record<string, Record<string, { responses?: Record<string, unknown> }>> };
    const documented = Object.entries(document.paths)
      .filter(
        ([path]) =>
          path.startsWith('/api/v1/connect/') ||
          path.startsWith('/api/v1/flow/share-consents/') ||
          path.startsWith('/api/v1/dashboard/connect/') ||
          path === '/api/v1/inquiries',
      )
      .flatMap(([path, operations]) =>
        Object.entries(operations)
          .filter(([, operation]) => operation.responses?.['501'] !== undefined)
          .map(([method]) => `${method.toUpperCase()} ${path}`),
      );
    expect(documented).toEqual([]);
  });
});
