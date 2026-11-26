/**
 * C84.1 (F07; Workflow 6A Stage 3, `api-reports`): the `report-config` publish rule of an inquiry
 * template version: each `on-completion` entry names a report template of the environment that is
 * active and has a published version; any other entry is a 422 `report_template_not_published` at
 * its pointer. Synthetic values only.
 */
import {
  createTestDatabase,
  createTestTenant,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportConfigPublishProblems } from './report-config.js';

let database: TestDatabase;
let environmentId: string;
let otherEnvironmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  otherEnvironmentId = (await createTestTenant(database.db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

const problems = (ids: string[]) =>
  reportConfigPublishProblems({
    db: database.db,
    environment: { id: environmentId, kind: 'sandbox' },
    reportConfig: {
      'on-completion': ids.map((id) => ({ 'report-template-id': id, 'query-source': 'inquiry' })),
      'on-report-match': 'none',
    },
  });

describe('the report-config publish rule (C84.1)', () => {
  it('accepts active templates with a published version, and an empty list', async () => {
    const watchlist = await seedReportTemplate(database.db, environmentId, {
      config: { 'search-lists': ['openverify-sandbox'] },
    });
    const email = await seedReportTemplate(database.db, environmentId, {
      reportType: 'email-address',
    });
    expect(await problems([watchlist.templateId, email.templateId])).toEqual([]);
    expect(await problems([])).toEqual([]);
  });

  it('refuses an unknown, archived, unpublished or other-environment template, each at its pointer', async () => {
    const active = await seedReportTemplate(database.db, environmentId, { reportType: 'email-address' });
    const archived = await seedReportTemplate(database.db, environmentId, {
      reportType: 'email-address',
      status: 'archived',
    });
    const unpublished = await seedReportTemplate(database.db, environmentId, {
      reportType: 'email-address',
    });
    await database.db.execute(
      sql`update report_template_versions set status = 'draft', published_at = null
           where id = ${unpublished.versionId}`,
    );
    const foreign = await seedReportTemplate(database.db, otherEnvironmentId, {
      reportType: 'email-address',
    });
    const found = await problems([
      active.templateId,
      testId('rptp'),
      archived.templateId,
      unpublished.templateId,
      foreign.templateId,
    ]);
    expect(found.map((problem) => [problem.code, problem.pointer])).toEqual([
      ['report_template_not_published', '/data/attributes/report-config/on-completion/1'],
      ['report_template_not_published', '/data/attributes/report-config/on-completion/2'],
      ['report_template_not_published', '/data/attributes/report-config/on-completion/3'],
      ['report_template_not_published', '/data/attributes/report-config/on-completion/4'],
    ]);
    expect(found.every((problem) => problem.detail.length > 0)).toBe(true);
  });
});
