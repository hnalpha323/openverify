// @vitest-environment node
import type { Permission } from '@openverify/core';
import { createClient } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, mockApi, type MockApi } from '../../testing/api-mock';
import { apiKeyAttributesFromForm, apiKeyState, grantableScopes, listApiKeys } from './api-keys';

const CURSOR = 'key_01J9ZK3M5Q7R8S9T0V1W2X3Y63';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

describe('grantableScopes', () => {
  it("offers the API scopes the operator holds, in the catalog's order", () => {
    const held = new Set<Permission>(['webhooks:write', 'pii:view', 'inquiries:read']);

    expect(grantableScopes(held)).toEqual(['inquiries:read', 'webhooks:write']);
  });
});

describe('apiKeyAttributesFromForm', () => {
  it('reads the name, scopes, allowed ranges and version', () => {
    const data = new FormData();
    data.set('name', ' CI deploys ');
    data.append('scopes', 'inquiries:read');
    data.append('scopes', 'webhooks:read');
    data.set('allowed-ips', '203.0.113.0/24\n2001:db8::/32');
    data.set('api-version', '2026-10-01');

    expect(apiKeyAttributesFromForm(data)).toEqual({
      name: 'CI deploys',
      scopes: ['inquiries:read', 'webhooks:read'],
      'allowed-ips': ['203.0.113.0/24', '2001:db8::/32'],
      'api-version': '2026-10-01',
    });
  });

  it('leaves the version out when none is chosen', () => {
    const data = new FormData();
    data.set('name', 'Key');

    expect(apiKeyAttributesFromForm(data)).toEqual({ name: 'Key', scopes: [], 'allowed-ips': [] });
  });
});

describe('apiKeyState', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');

  it('is active without an expiry', () => {
    expect(apiKeyState(null, now)).toBe('active');
  });

  it('is expiring before its expiry, and expired from then on', () => {
    expect(apiKeyState('2026-10-20T12:00:01.000Z', now)).toBe('expiring');
    expect(apiKeyState('2026-10-20T12:00:00.000Z', now)).toBe('expired');
    expect(apiKeyState('2026-10-19T12:00:00.000Z', now)).toBe('expired');
  });
});

describe('listApiKeys', () => {
  it('lists one page of keys after the cursor', async () => {
    api.reply(200, { data: [], links: { next: null } });
    const client = createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

    await listApiKeys(client, CURSOR);

    expect(api.last().path).toBe('/api/v1/api-keys');
    expect(Object.fromEntries(api.last().query)).toEqual({
      'page[size]': '25',
      'page[after]': CURSOR,
    });
  });

  it('starts at the first page without a cursor', async () => {
    api.reply(200, { data: [], links: { next: null } });
    const client = createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

    await listApiKeys(client, undefined);

    expect(Object.fromEntries(api.last().query)).toEqual({ 'page[size]': '25' });
  });
});
