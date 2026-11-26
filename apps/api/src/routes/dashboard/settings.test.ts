import {
  DASHBOARD_SETTINGS_DEFAULTS,
  dashboardSettingsSchema,
  OTP_SETTINGS_DEFAULTS,
  OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION,
  OTP_SMS_MAX_PER_HOUR,
} from '@openverify/contracts';
import { appendAuditLog, getEnvironment, getOrganization } from '@openverify/db';
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
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup(roles: Parameters<DashboardHarness['operator']>[1] = { roles: ['admin'] }) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, roles);
  const token = await api.signIn(operator.email);
  return { api, organization, operator, token };
}

describe('GET /settings (C15, C16)', () => {
  it('returns the defaults for a new organization and environment', async () => {
    const { api, token } = await setup({ roles: ['viewer'] });

    const body = dashboardSettingsSchema.parse(
      expectJson(await api.call('GET', '/settings', { token }), 200),
    );

    expect(body).toEqual({ ...DASHBOARD_SETTINGS_DEFAULTS, ...OTP_SETTINGS_DEFAULTS });
  });

  it('needs settings:read', async () => {
    const { api, token } = await setup({ roles: ['reviewer'] });

    expect((await api.call('GET', '/settings', { token })).statusCode).toBe(403);
  });
});

describe('PATCH /settings', () => {
  it('sets require-mfa on the organization and retention on the environment, and audits it', async () => {
    const { api, organization, operator, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'require-mfa': true, 'inquiry-retention-days': 365, 'event-retention-days': 30 },
    });

    expect(dashboardSettingsSchema.parse(expectJson(response, 200))).toEqual({
      ...DASHBOARD_SETTINGS_DEFAULTS,
      ...OTP_SETTINGS_DEFAULTS,
      'require-mfa': true,
      'inquiry-retention-days': 365,
      'event-retention-days': 30,
    });
    expect((await getOrganization(database.db, organization.id))?.requireMfa).toBe(true);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({
      'inquiry-retention-days': 365,
      'event-retention-days': 30,
    });
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry).toMatchObject({
      actorId: operator.user.id,
      resourceType: 'environment',
      resourceId: organization.sandboxId,
      metadata: { 'require-mfa': true, 'inquiry-retention-days': 365, 'event-retention-days': 30 },
    });
  });

  it('keeps finished inquiries forever again with a null inquiry retention', async () => {
    const { api, token } = await setup();
    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'inquiry-retention-days': 30 } }),
      200,
    );

    const body = dashboardSettingsSchema.parse(
      expectJson(
        await api.call('PATCH', '/settings', {
          token,
          payload: { 'inquiry-retention-days': null },
        }),
        200,
      ),
    );

    expect(body['inquiry-retention-days']).toBeNull();
  });

  it('validates the body and needs settings:write', async () => {
    const { api, organization, token } = await setup();
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    const viewerToken = await api.signIn(viewer.email);

    for (const payload of [{}, { 'api-log-retention-days': 0 }, { 'unknown-setting': 1 }]) {
      expect((await api.call('PATCH', '/settings', { token, payload })).statusCode).toBe(400);
    }
    expect(
      (
        await api.call('PATCH', '/settings', {
          token: viewerToken,
          payload: { 'require-mfa': true },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('the face template settings (C42.4, C42.6)', () => {
  it('reads the defaults, 365 days and 50,000 templates', async () => {
    const { api, token } = await setup({ roles: ['viewer'] });

    const body = dashboardSettingsSchema.parse(
      expectJson(await api.call('GET', '/settings', { token }), 200),
    );

    expect(body).toMatchObject({
      'face-template-retention-days': 365,
      'face-search-max-templates': 50_000,
    });
  });

  it('sets both on the environment and audits the change', async () => {
    const { api, organization, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'face-template-retention-days': 90, 'face-search-max-templates': 1000 },
    });

    expect(dashboardSettingsSchema.parse(expectJson(response, 200))).toMatchObject({
      'face-template-retention-days': 90,
      'face-search-max-templates': 1000,
    });
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({
      'face-template-retention-days': 90,
      'face-search-max-templates': 1000,
    });
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toEqual({
      'face-template-retention-days': 90,
      'face-search-max-templates': 1000,
    });
  });

  it.each([
    ['face-template-retention-days', 0],
    ['face-template-retention-days', 1096],
    ['face-template-retention-days', 30.5],
    ['face-search-max-templates', 999],
    ['face-search-max-templates', 200_001],
    ['face-template-retention-days', null],
  ])('refuses %s = %s with 400', async (name, value) => {
    const { api, organization, token } = await setup();

    const response = await api.call('PATCH', '/settings', { token, payload: { [name]: value } });

    expect(response.statusCode).toBe(400);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });
});

describe('the OTP SMS settings (C55.7, V08)', () => {
  it('serves the budget, 200 per hour by default, and when it last tripped, never by default', async () => {
    const { api, token } = await setup({ roles: ['viewer'] });

    const body = dashboardSettingsSchema.parse(
      expectJson(await api.call('GET', '/settings', { token }), 200),
    );

    expect(body).toMatchObject(OTP_SETTINGS_DEFAULTS);
  });

  it('sets the budget on the environment and audits it', async () => {
    const { api, organization, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'otp-sms-max-per-hour': 500 },
    });

    expect(dashboardSettingsSchema.parse(expectJson(response, 200))).toMatchObject({
      'otp-sms-max-per-hour': 500,
    });
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({
      'otp-sms-max-per-hour': 500,
    });
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toEqual({ 'otp-sms-max-per-hour': 500 });
  });

  it('refuses a budget above the install ceiling with 422, changing nothing', async () => {
    const { api, organization, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'otp-sms-max-per-hour': OTP_SMS_MAX_PER_HOUR.ceilingDefault + 1 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ location: 'body', pointer: '/otp-sms-max-per-hour' }],
    });
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });

  it('serves the time of the latest budget trip from the audit log', async () => {
    const { api, organization, token } = await setup();
    const entry = await appendAuditLog(database.db, organization.sandboxId, {
      actorType: 'system',
      action: OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION,
      resourceType: 'environment',
      resourceId: organization.sandboxId,
    });

    const body = dashboardSettingsSchema.parse(
      expectJson(await api.call('GET', '/settings', { token }), 200),
    );

    expect(body['otp-sms-budget-tripped-at']).toBe(entry.createdAt.toISOString());
  });
});

describe('the report retention setting (C73.6, P14)', () => {
  it('serves null by default: reports are kept as long as inquiries', async () => {
    const { api, token } = await setup({ roles: ['viewer'] });

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'report-retention-days': null,
    });
  });

  it('sets it on the environment, and null keeps reports again', async () => {
    const { api, organization, token } = await setup();

    const set = expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'report-retention-days': 30 } }),
      200,
    );
    expect(set).toMatchObject({ 'report-retention-days': 30 });
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({
      'report-retention-days': 30,
    });

    const cleared = expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'report-retention-days': null } }),
      200,
    );
    expect(cleared).toMatchObject({ 'report-retention-days': null });
  });

  it.each([0, 3651, 1.5])('refuses %s days', async (days) => {
    const { api, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'report-retention-days': days },
    });

    expect(response.statusCode).toBe(400);
  });
});
