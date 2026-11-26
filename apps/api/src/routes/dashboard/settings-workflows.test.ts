/**
 * C143.7 (Workflow 8A Stage 1b (E)): the workflow settings on the C16 settings route. Each is served
 * with its default, set on the environment and audited as every change is. `workflow-http-private-cidrs`
 * needs `settings:privacy` too. Each list keeps its cap and each window its bounds (400), and what
 * only the egress rules can judge goes through `api-egress`' check.
 */
import { newId } from '@openverify/contracts';
import { createRole, getEnvironment } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

const check = vi.hoisted(() => vi.fn());
vi.mock('../../workflows/actions/https/settings-check.js', () => ({
  workflowEgressSettingsProblem: check,
}));

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

beforeEach(() => {
  check.mockReset().mockReturnValue(null);
});

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  return { api, organization, admin, token };
}

const DEFAULTS = {
  'workflow-run-retention-days': 30,
  'workflow-run-history-retention-days': 365,
  'workflow-in-flight-cap': 50,
  'workflow-http-ports': [],
  'workflow-http-hosts': null,
  'workflow-http-private-cidrs': [],
  'workflow-email-recipients': [],
  'workflow-sms-recipients': [],
  'workflow-sms-countries': null,
  'workflow-link-hosts': [],
  'case-retention-days': null,
};

describe('GET /settings: the workflow settings (C143.7)', () => {
  it('serves their defaults', async () => {
    const { api, organization } = await setup();
    const viewer = await api.operator(organization, { roles: ['viewer'] });

    const token = await api.signIn(viewer.email);

    const body = expectJson(await api.call('GET', '/settings', { token }), 200);

    expect(body).toMatchObject(DEFAULTS);
  });
});

describe('PATCH /settings: the workflow settings (C143.7)', () => {
  const body = {
    'workflow-run-retention-days': 7,
    'workflow-run-history-retention-days': 90,
    'workflow-in-flight-cap': 10,
    'workflow-http-ports': [8443],
    'workflow-http-hosts': ['api.example.com'],
    'workflow-email-recipients': ['alerts@example.com', 'example.org'],
    'workflow-sms-recipients': ['+15005550006'],
    'workflow-sms-countries': ['GB', 'US'],
    'workflow-link-hosts': ['www.example.com'],
    'case-retention-days': 400,
  };

  it('sets them on the environment under settings:write', async () => {
    const { api, organization, token } = await setup();

    const answer = expectJson(await api.call('PATCH', '/settings', { token, payload: body }), 200);

    expect(answer).toMatchObject(body);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual(body);
  });

  it('audits how many recipients, never who (C143.5, P19)', async () => {
    const { api, organization, token } = await setup();

    await api.call('PATCH', '/settings', {
      token,
      payload: {
        'workflow-email-recipients': ['alerts@example.com'],
        'workflow-sms-recipients': ['+15005550006', '+15005550007'],
        'workflow-link-hosts': ['www.example.com'],
      },
    });

    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toEqual({
      'workflow-email-recipients': { count: 1 },
      'workflow-sms-recipients': { count: 2 },
      'workflow-link-hosts': ['www.example.com'],
    });
  });

  it('asks api-egress about what only its rules can judge', async () => {
    const { api, token } = await setup();

    await api.call('PATCH', '/settings', {
      token,
      payload: { 'workflow-http-ports': [8443], 'workflow-http-private-cidrs': ['10.0.0.0/8'] },
    });

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        'workflow-http-ports': [8443],
        'workflow-http-private-cidrs': ['10.0.0.0/8'],
      }),
    );
  });

  it('answers 422 naming the setting api-egress refuses, and changes nothing', async () => {
    check.mockReturnValue({
      setting: 'workflow-http-ports',
      detail: 'Port 25 is a Fetch bad port.',
    });
    const { api, organization, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'workflow-http-ports': [25] },
    });

    expect(response.statusCode).toBe(422);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });

  it('needs settings:privacy for the private CIDRs (C124.3)', async () => {
    const { api, organization } = await setup();
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Settings Writer',
      permissions: ['settings:read', 'settings:write'],
    });
    const writer = await api.operator(organization, { roles: [], roleIds: [role.id] });
    const token = await api.signIn(writer.email);

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'workflow-http-private-cidrs': ['10.0.0.0/8'] },
    });

    expect(response.statusCode).toBe(403);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });

  it.each([
    ['workflow-run-retention-days', 0],
    ['workflow-run-retention-days', 3_651],
    ['workflow-run-history-retention-days', 0],
    ['workflow-in-flight-cap', 0],
    ['workflow-http-ports', [0]],
    ['workflow-http-ports', [70_000]],
    ['workflow-http-hosts', ['https://api.example.com']],
    ['workflow-sms-recipients', ['not a number']],
    ['workflow-sms-countries', ['gb']],
    ['workflow-link-hosts', ['exa mple.com']],
    ['case-retention-days', 0],
  ])('refuses %s %j', async (key, value) => {
    const { api, token } = await setup();

    const response = await api.call('PATCH', '/settings', { token, payload: { [key]: value } });

    expect(response.statusCode).toBe(400);
  });
});
