import { isId } from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditLogger } from '../ports.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  type TestApi,
} from './harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

describe('createTestApi', () => {
  it('wires an in-memory fake for every Phase 2 port', () => {
    expect(api.deps.accounts).toBe(api.accounts);
    expect(api.deps.redaction).toBe(api.redaction);
    expect(api.deps.audit).toBe(api.audit);
    expect(api.deps.rateLimiter).toBe(api.rateLimiter);
    expect(api.deps.mailer).toBe(api.mailer);
    expect(api.deps.resolveUserSession).toBe(api.userSessions.resolve);
  });

  it('knows the organization of its default tenant', () => {
    expect(isId('org', api.organizationId)).toBe(true);
  });

  it('takes overrides computed from the default dependencies', async () => {
    const audit: AuditLogger = { record: () => Promise.resolve() };
    let seenDb: unknown;
    const custom = await createTestApi((defaults) => {
      seenDb = defaults.db;
      return { audit };
    });

    expect(custom.deps.audit).toBe(audit);
    expect(seenDb).toBe(custom.database.db);
    await custom.close();
  });

  it('creates production tenants with ov_prod_ keys', async () => {
    const tenant = await api.newTenant({ kind: 'production' });

    expect(tenant.environmentKind).toBe('production');
    expect(tenant.token.startsWith('ov_prod_')).toBe(true);
    const response = await api.app.inject({
      url: '/api/v1/inquiries',
      headers: bearer(tenant.token),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('user principals on the server API (C12)', () => {
  it('authenticate a user session with the chosen permissions in its environment', async () => {
    const admin = api.newUserToken(api.environmentId);
    const templateId = await createTemplate(api, admin);
    const inquiryId = await createInquiry(api, { token: admin, templateId });

    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });
    const response = await api.app.inject({
      url: `/api/v1/inquiries/${inquiryId}`,
      headers: bearer(reader),
    });

    expect(expectStatus(response, 200).data.id).toBe(inquiryId);
  });

  it('answer a missing permission with 403 forbidden', async () => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(reader),
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/forbidden',
    );
  });

  it('answer 401 mfa-required while MFA is not satisfied', async () => {
    const token = api.newUserToken(api.environmentId, { mfaSatisfied: false });

    const response = await api.app.inject({ url: '/api/v1/inquiries', headers: bearer(token) });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/mfa-required',
    );
  });

  it("never see another environment's resources (404)", async () => {
    const inquiryId = await createInquiry(api);
    const other = await api.newTenant();
    const outsider = api.newUserToken(other.environmentId);

    const response = await api.app.inject({
      url: `/api/v1/inquiries/${inquiryId}`,
      headers: bearer(outsider),
    });

    expect(response.statusCode).toBe(404);
  });

  it('resolve to the environment kind of their tenant', async () => {
    const production = await api.newTenant({ kind: 'production' });
    const token = api.newUserToken(production.environmentId, { userId: 'usr_fixed' });

    const principal = await api.userSessions.resolve(token, {} as FastifyRequest);

    expect(principal).toMatchObject({
      kind: 'user',
      userId: 'usr_fixed',
      organizationId: production.organizationId,
      environmentId: production.environmentId,
      environmentKind: 'production',
    });
  });

  it('cannot be issued for an environment the harness did not create', () => {
    expect(() => api.newUserToken('env_01M5CJXHG0000000000000000Z')).toThrow(/unknown environment/);
  });

  it('are refused once revoked', async () => {
    const token = api.newUserToken(api.environmentId);
    api.userSessions.revoke(token);

    const response = await api.app.inject({ url: '/api/v1/inquiries', headers: bearer(token) });

    expect(response.statusCode).toBe(401);
  });
});
