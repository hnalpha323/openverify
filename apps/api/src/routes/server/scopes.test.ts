import { API_SCOPES, type ApiScope } from '@openverify/contracts';
import type { HTTPMethods } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const ID = {
  template: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
  inquiry: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
  verification: 'ver_01M5CK16P0D13FXHZSS4TCFBVH',
  webhook: 'wbh_01M5CJXJF8RTHTZ2WC4QENGB0C',
  event: 'evt_01M5CK4VW0MRQ4HKKTBDT6PXEM',
};

/** Contract C2: every server API route and the scope it requires. */
const ROUTES: [HTTPMethods, string, ApiScope][] = [
  ['POST', '/api/v1/inquiry-templates', 'inquiry-templates:write'],
  ['GET', `/api/v1/inquiry-templates/${ID.template}`, 'inquiry-templates:read'],
  ['GET', '/api/v1/inquiry-templates', 'inquiry-templates:read'],
  ['POST', '/api/v1/inquiries', 'inquiries:write'],
  ['GET', `/api/v1/inquiries/${ID.inquiry}`, 'inquiries:read'],
  ['GET', '/api/v1/inquiries', 'inquiries:read'],
  ['POST', `/api/v1/inquiries/${ID.inquiry}/resume`, 'inquiries:write'],
  ['GET', `/api/v1/verifications/${ID.verification}`, 'verifications:read'],
  ['POST', '/api/v1/webhooks', 'webhooks:write'],
  ['GET', '/api/v1/webhooks', 'webhooks:read'],
  ['GET', `/api/v1/webhooks/${ID.webhook}`, 'webhooks:read'],
  ['PATCH', `/api/v1/webhooks/${ID.webhook}`, 'webhooks:write'],
  ['GET', `/api/v1/events/${ID.event}`, 'events:read'],
];

describe('server API scopes (C2)', () => {
  it.each(ROUTES)('%s %s requires an API key', async (method, url) => {
    const response = await api.app.inject({ method, url });

    expect(response.statusCode).toBe(401);
  });

  it.each(ROUTES)('%s %s requires the %s scope', async (method, url, scope) => {
    const token = await api.newApiKey(api.environmentId, {
      scopes: API_SCOPES.filter((candidate) => candidate !== scope),
    });

    const response = await api.app.inject({ method, url, headers: bearer(token) });

    expect(response.statusCode).toBe(403);
    expect(response.headers['www-authenticate']).toContain(`scope="${scope}"`);
  });

  it.each(ROUTES)(
    '%s %s passes authorization with only the %s scope',
    async (method, url, scope) => {
      const token = await api.newApiKey(api.environmentId, { scopes: [scope] });

      const response = await api.app.inject({ method, url, headers: bearer(token) });

      expect([401, 403]).not.toContain(response.statusCode);
    },
  );

  it('refuses revoked and expired keys', async () => {
    const revoked = await api.newApiKey(api.environmentId, { revoked: true });
    const expired = await api.newApiKey(api.environmentId, {
      expiresAt: new Date(api.clock.now().getTime() - 1000),
    });

    for (const token of [revoked, expired]) {
      const response = await api.app.inject({
        url: '/api/v1/inquiries',
        headers: bearer(token),
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('records when a key was used', async () => {
    const token = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });

    await api.app.inject({ url: '/api/v1/inquiries', headers: bearer(token) });

    const { rows } = await api.database.client.query<{ last_used_at: Date | null }>(
      'select last_used_at from api_keys where environment_id = $1 and last_used_at is not null',
      [api.environmentId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('documents every route in OpenAPI under the API key scheme', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { tags?: string[]; security?: unknown }>>;
    }>();

    for (const [method, url] of ROUTES) {
      const path = url.replace(/(itmpl|inq|ver|wbh|evt)_[0-9A-Z]{26}/, '{id}');
      const operation = document.paths[path]?.[method.toLowerCase()];
      expect(operation, `${method} ${path}`).toBeDefined();
      expect(operation?.security, `${method} ${path}`).toBeUndefined();
      expect(operation?.tags?.length, `${method} ${path}`).toBe(1);
    }
  });
});
