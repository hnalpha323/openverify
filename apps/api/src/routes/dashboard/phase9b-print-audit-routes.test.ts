/**
 * C173.3 (Workflow 9B, `api-cases-reports`; K12, decision 59, review P36; contracts B39):
 * `POST /dashboard/print-audits` takes `{ object-id }` (an inquiry, a report or a verification) and
 * writes the audit entry before the browser's print dialog opens. It records use of the print button,
 * not every print.
 *
 * - The object is one of the session's environment that the user may read (`inquiries:read`,
 *   `reports:read`, `verifications:read`); an unknown, foreign or unreadable object is 404 and writes
 *   nothing.
 * - The entry is `<object>.print-initiated` on the object, by the user, with empty metadata (the
 *   object is the entry's resource; nothing else is named), and the answer names it (`aud_`), the
 *   object and the time the entry was stored.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createVerification } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  seedReport,
  seedReportTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

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

/** An organisation whose sandbox holds an inquiry, a report and a verification. */
async function seeded() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const environmentId = organization.sandboxId;
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  const template = await seedReportTemplate(database.db, environmentId, {
    config: { 'search-lists': ['openverify-sandbox'] },
  });
  const reportId = await seedReport(database.db, environmentId, { ...template, status: 'ready' });
  const verification = await createVerification(database.db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  return {
    api,
    organization,
    environmentId,
    objects: { inq: inquiry.id, rep: reportId, ver: verification.id },
  };
}

async function signedIn(
  api: DashboardHarness,
  organization: Awaited<ReturnType<DashboardHarness['organization']>>,
  options: { roles?: ('viewer' | 'admin')[]; roleIds?: string[] } = { roles: ['viewer'] },
) {
  const operator = await api.operator(organization, options);
  return { operator, token: await api.signIn(operator.email) };
}

const print = (api: DashboardHarness, token: string | undefined, objectId: string) =>
  api.call('POST', '/print-audits', {
    ...(token === undefined ? {} : { token }),
    payload: { 'object-id': objectId },
  });

describe('POST /dashboard/print-audits (C173.3)', () => {
  it('writes the entry for an inquiry, a report and a verification the user reads, and names it', async () => {
    const { api, organization, environmentId, objects } = await seeded();
    const { operator, token } = await signedIn(api, organization);

    for (const [kind, id] of [
      ['inquiry', objects.inq],
      ['report', objects.rep],
      ['verification', objects.ver],
    ] as const) {
      const response = await print(api, token, id);

      expect(response.statusCode, response.body).toBe(201);
      const document = JSON.parse(response.body) as {
        data: { type: string; id: string; attributes: Record<string, unknown> };
      };
      const entries = await api.audit(environmentId, `${kind}.print-initiated`);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        publicId: document.data.id,
        actorType: 'user',
        actorId: operator.user.id,
        resourceType: kind,
        resourceId: id,
        metadata: {},
      });
      expect(document.data).toEqual({
        type: 'print-audit',
        id: entries[0]?.publicId,
        attributes: { 'object-id': id, 'recorded-at': entries[0]?.createdAt.toISOString() },
      });
    }
  });

  it('answers 404 for an unknown object, another organisation’s and one the user may not read, writing nothing', async () => {
    const { api, organization, environmentId, objects } = await seeded();
    const other = await seeded();
    const roleId = newId('role');
    await database.db.execute(sql`insert into roles (id, organization_id, name, permissions)
      values (${roleId}, ${organization.id}, 'Synthetic inquiries only', '{inquiries:read}'::text[])`);
    const { token } = await signedIn(api, organization, { roles: [], roleIds: [roleId] });

    const outcomes = [
      await print(api, token, newId('inq')),
      await print(api, token, other.objects.inq),
      await print(api, token, objects.rep),
      await print(api, token, objects.ver),
      await print(api, token, objects.inq),
      await print(api, undefined, objects.inq),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 201, 401]);
    expect(
      (await api.audit(environmentId)).filter(({ action }) => action.endsWith('.print-initiated')),
    ).toHaveLength(1);
  });

  it('reads the contract: one object id of a kind with a print view', async () => {
    const { api, organization } = await seeded();
    const { token } = await signedIn(api, organization);

    const outcomes = [
      await api.call('POST', '/print-audits', { token, payload: { 'object-id': newId('case') } }),
      await api.call('POST', '/print-audits', { token, payload: {} }),
      await api.call('POST', '/print-audits', {
        token,
        payload: { 'object-id': newId('inq'), at: '2026-11-06T10:00:00Z' },
      }),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([400, 400, 400]);
  });

  it('is listed in the OpenAPI document', async () => {
    const { api } = await seeded();
    const { paths } = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    }>();

    expect(Object.keys(paths['/api/v1/dashboard/print-audits']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '404']),
    );
  });
});
