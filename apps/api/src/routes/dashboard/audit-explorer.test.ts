/**
 * C168.6 (Phase 9, Workflow 9B; review P23; contracts B28): the audit explorer's filters on
 * `GET /dashboard/audit-logs`, beside the action, actor and resource filters:
 *
 * - `filter[action-prefix]`, `filter[from]` (included) and `filter[to]` (excluded), with
 *   `audit-logs:read` alone;
 * - `filter[ip]`, one exact address matched through `audit_log_ip_index` (an HMAC, never the
 *   address), which needs `pii:view` too (403 without), and answers 503 when the process has no
 *   blind-index key, never an unfiltered list;
 * - the next page's link keeping every filter.
 *
 * Every address is from the documentation ranges; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId, userAuditLogListDocumentSchema } from '@openverify/contracts';
import { appendAuditLog, createRole, setUserRoles, useAuditIpIndexKey } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];
const KEY = new Uint8Array(randomBytes(32));

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  useAuditIpIndexKey(null);
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  useAuditIpIndexKey(KEY);
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization({ production: true });
  const admin = await api.operator(organization, { roles: ['admin'] });
  return { api, organization, token: await api.signIn(admin.email) };
}

async function auditorToken(api: DashboardHarness, organization: TestOrganization) {
  const role = await createRole(database.db, organization.id, {
    id: newId('role'),
    name: `Synthetic auditor ${newId('role')}`,
    permissions: ['audit-logs:read'],
  });
  const auditor = await api.operator(organization, { roles: [] });
  await setUserRoles(database.db, organization.id, auditor.user.id, [role.id]);
  return api.signIn(auditor.email);
}

const seed = (environmentId: string, action: string, ip: string | null) =>
  appendAuditLog(database.db, environmentId, {
    actorType: 'system',
    action,
    resourceType: 'inquiry',
    resourceId: newId('inq'),
    ip,
  });

const list = async (api: DashboardHarness, token: string, query: string) =>
  userAuditLogListDocumentSchema.parse(
    expectJson(await api.call('GET', `/audit-logs?${query}`, { token }), 200),
  );

describe('GET /audit-logs: the explorer filters (C168.6)', () => {
  it('filters by action prefix and by from and to, with audit-logs:read alone', async () => {
    const { api, organization } = await setup();
    const token = await auditorToken(api, organization);
    const created = await seed(organization.sandboxId, 'inquiry.created', null);
    const redacted = await seed(organization.sandboxId, 'inquiry.redacted', null);
    await seed(organization.sandboxId, 'report.created', null);

    const byPrefix = await list(api, token, 'filter[action-prefix]=inquiry.');
    const from = created.createdAt.toISOString();
    const to = new Date(created.createdAt.getTime() + 1).toISOString();
    const window = await list(
      api,
      token,
      `filter[action-prefix]=inquiry.&filter[from]=${from}&filter[to]=${to}`,
    );

    expect(byPrefix.data.map((entry) => entry.id).sort()).toEqual(
      [created.publicId, redacted.publicId].sort(),
    );
    expect(window.data.map((entry) => entry.id)).toContain(created.publicId);
    expect(window.data.every((entry) => entry.attributes.action.startsWith('inquiry.'))).toBe(true);
  });

  it('matches one exact address through the index with pii:view, in this environment only', async () => {
    const { api, organization, token } = await setup();
    const match = await seed(organization.sandboxId, 'inquiry.viewed', '192.0.2.50');
    await seed(organization.sandboxId, 'inquiry.viewed', '192.0.2.51');
    await seed(organization.productionId ?? '', 'inquiry.viewed', '192.0.2.50');

    const found = await list(api, token, 'filter[ip]=192.0.2.50');

    expect(found.data.map((entry) => entry.id)).toEqual([match.publicId]);
    expect(found.data[0]?.attributes['ip-address']).toBe('192.0.2.50');
  });

  it('refuses filter[ip] without pii:view (403), and answers 503 without the index key', async () => {
    const { api, organization, token } = await setup();
    const auditor = await auditorToken(api, organization);

    const refused = await api.call('GET', '/audit-logs?filter[ip]=192.0.2.50', { token: auditor });
    useAuditIpIndexKey(null);
    const unkeyed = await api.call('GET', '/audit-logs?filter[ip]=192.0.2.50', { token });

    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json<{ detail: string }>().detail).toContain('pii:view');
    expect(unkeyed.statusCode, unkeyed.body).toBe(503);
  });

  it('keeps every filter in the next page’s link', async () => {
    const { api, organization, token } = await setup();
    await seed(organization.sandboxId, 'inquiry.viewed', '192.0.2.60');
    await seed(organization.sandboxId, 'inquiry.viewed', '192.0.2.60');

    const page = await list(
      api,
      token,
      'filter[ip]=192.0.2.60&filter[action-prefix]=inquiry.&filter[from]=2020-01-01T00:00:00Z&page[size]=1',
    );

    const next = new URL(page.links.next ?? 'http://invalid.example/', 'http://local.example');
    expect(next.searchParams.get('filter[ip]')).toBe('192.0.2.60');
    expect(next.searchParams.get('filter[action-prefix]')).toBe('inquiry.');
    expect(next.searchParams.get('filter[from]')).toBe('2020-01-01T00:00:00Z');
  });
});
