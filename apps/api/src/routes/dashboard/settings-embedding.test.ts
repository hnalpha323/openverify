/**
 * C158.1, C158.4, C174.6 (Workflow 9A Stage 1b (F)): the embedding settings on the C16 settings
 * route. Each is served with its default, set on the environment and audited as every change is;
 * each origin is held to the grammar of `@openverify/contracts/origin-pattern` for the
 * environment's kind (422 `embed_origin_invalid` naming each refused position, never its value),
 * and a production wildcard needs `meta.acknowledge-wildcards` (422 `embed_wildcard_unacknowledged`,
 * V17). Every origin is a reserved name.
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup(production = false) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization({ production });
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  if (production) {
    const moved = await api.call('PUT', '/sessions/current/environment', {
      token,
      payload: { 'environment-id': organization.productionId },
    });
    expect(moved.statusCode, moved.body).toBe(200);
  }
  return { api, organization, token };
}

const patch = (api: DashboardHarness, token: string, payload: unknown) =>
  api.call('PATCH', '/settings', { token, payload });

describe('GET /settings: the embedding settings (C158.1, C158.4)', () => {
  it('serves no embed origin and the install-wide redirect rule by default', async () => {
    const { api, token } = await setup();

    const body = expectJson(await api.call('GET', '/settings', { token }), 200);

    expect(body).toMatchObject({
      'allowed-embed-origins': [],
      'allowed-redirect-origins': null,
    });
  });
});

describe('PATCH /settings: the embedding settings (C158.1, C158.4, V17)', () => {
  it('stores and serves the origins, and audits the change', async () => {
    const { api, organization, token } = await setup();

    const body = expectJson(
      await patch(api, token, {
        'allowed-embed-origins': ['https://shop.example.com', 'http://localhost:5173'],
        'allowed-redirect-origins': ['https://*.example.org'],
      }),
      200,
    );

    expect(body).toMatchObject({
      'allowed-embed-origins': ['https://shop.example.com', 'http://localhost:5173'],
      'allowed-redirect-origins': ['https://*.example.org'],
    });
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toMatchObject({
      'allowed-embed-origins': ['https://shop.example.com', 'http://localhost:5173'],
    });
    expectJson(await patch(api, token, { 'allowed-redirect-origins': null }), 200);
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'allowed-redirect-origins': null,
    });
  });

  it('refuses an origin outside the grammar, naming each position and never the value', async () => {
    const { api, token } = await setup();

    const response = await patch(api, token, {
      'allowed-embed-origins': ['https://shop.example.com', 'https://*.vercel.app'],
      'allowed-redirect-origins': ['https://shop.example.com/path'],
    });

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'embed_origin_invalid',
      errors: [
        { location: 'body', pointer: '/allowed-embed-origins/1' },
        { location: 'body', pointer: '/allowed-redirect-origins/0' },
      ],
    });
    expect(response.body).not.toMatch(/vercel|\/path/);
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'allowed-embed-origins': [],
    });
  });

  it('refuses localhost in production, and a production wildcard without its acknowledgement', async () => {
    const { api, token } = await setup(true);

    const localhost = await patch(api, token, {
      'allowed-embed-origins': ['http://localhost:5173'],
    });
    const wildcard = await patch(api, token, {
      'allowed-embed-origins': ['https://*.example.com'],
    });
    const acknowledged = await patch(api, token, {
      'allowed-embed-origins': ['https://*.example.com'],
      meta: { 'acknowledge-wildcards': true },
    });

    expect(localhost.json()).toMatchObject({
      code: 'embed_origin_invalid',
      errors: [{ pointer: '/allowed-embed-origins/0' }],
    });
    expect(wildcard.statusCode).toBe(422);
    expect(wildcard.json()).toMatchObject({
      code: 'embed_wildcard_unacknowledged',
      errors: [{ pointer: '/allowed-embed-origins/0' }],
    });
    expect(expectJson(acknowledged, 200)).toMatchObject({
      'allowed-embed-origins': ['https://*.example.com'],
    });
  });
});

describe('the default theme set (C160.7, C174.6)', () => {
  it('is none by default, and no set can be named before theme sets are built (9B)', async () => {
    const { api, token } = await setup();

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'default-theme-set-id': null,
    });
    const named = await patch(api, token, {
      'default-theme-set-id': 'theset_01M5CK16P0D13FXHZSS4TCFBVH',
    });
    expect(named.statusCode, named.body).toBe(422);
    expect(named.json()).toMatchObject({ errors: [{ pointer: '/default-theme-set-id' }] });
    expect(
      expectJson(await patch(api, token, { 'default-theme-set-id': null }), 200),
    ).toMatchObject({ 'default-theme-set-id': null });
  });
});
