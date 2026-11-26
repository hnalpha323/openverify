/**
 * C72.3, C86 (Workflow 6A Stage 3, `api-reports`): the console's report documents: the list with
 * the public filters and one report with its runs and actions in `included`, both masked for an
 * operator without `pii:view` (the viewer role) and unmasked with it (the reviewer role); another
 * environment's report is a 404. Synthetic values only.
 */
import {
  dashboardReportDocumentSchema,
  dashboardReportListDocumentSchema,
} from '@openverify/contracts';
import {
  createTestDatabase,
  seedReport,
  seedReportAction,
  seedReportRun,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  type DashboardHarness,
  type TestOrganization,
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

const QUERY = { 'name-first': 'Perpetua', 'name-last': 'Consolewise' };

async function setUp(role: 'viewer' | 'reviewer') {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization: TestOrganization = await api.organization();
  const operator = await api.operator(organization, { roles: [role] });
  const token = await api.signIn(operator.email);
  const template = await seedReportTemplate(database.db, organization.sandboxId, {
    config: { 'search-lists': ['openverify-sandbox'] },
  });
  const reportId = await seedReport(database.db, organization.sandboxId, {
    ...template,
    status: 'ready',
    query: QUERY,
  });
  const runId = await seedReportRun(database.db, organization.sandboxId, {
    reportId,
    status: 'ready',
  });
  const actionId = await seedReportAction(database.db, organization.sandboxId, {
    reportId,
    actionType: 'pause',
    actorType: 'system',
    actorId: null,
  });
  return { api, token, organization, reportId, runId, actionId };
}

describe('GET /dashboard/reports (C72.3)', () => {
  it('lists the environment’s reports with the public filters, masked without pii:view', async () => {
    const { api, token, reportId } = await setUp('viewer');
    const response = await api.call('GET', '/reports?filter[status]=ready', { token });
    expect(response.statusCode, response.body).toBe(200);
    const document = dashboardReportListDocumentSchema.parse(response.json());
    expect(document.data.map((report) => report.id)).toEqual([reportId]);
    expect(document.data[0]?.attributes.query).toEqual({ 'name-first': null, 'name-last': null });
    const none = await api.call('GET', '/reports?filter[status]=errored', { token });
    expect(dashboardReportListDocumentSchema.parse(none.json()).data).toEqual([]);
  });
});

describe('GET /dashboard/reports/:id (C72.3)', () => {
  it('serves the report with its runs and actions included, unmasked with pii:view', async () => {
    const { api, token, reportId, runId, actionId } = await setUp('reviewer');
    const response = await api.call('GET', `/reports/${reportId}`, { token });
    expect(response.statusCode, response.body).toBe(200);
    const document = dashboardReportDocumentSchema.parse(response.json());
    expect(document.data.attributes.query).toEqual(QUERY);
    expect(document.included?.map((entry) => entry.id).sort()).toEqual([actionId, runId].sort());
  });

  it('answers 404 for a report of another environment', async () => {
    const { api, token } = await setUp('viewer');
    const other = await setUp('viewer');
    const response = await api.call('GET', `/reports/${other.reportId}`, { token });
    expect(response.statusCode).toBe(404);
    expect((await api.call('GET', `/reports/${testId('rep')}`, { token })).statusCode).toBe(404);
  });
});
