/**
 * Phase 7 (C106; Phase 6 outcome 5): `report_type` is text with two CHECK constraints over
 * `REPORT_TYPES`, so the `ip-address` and `custom-list` types each need a migration that recreates
 * both. A template and a report of a new type are accepted; an unknown type is still refused.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function insertTemplateAndReport(type: string) {
  const { environment } = await createTestTenant(database.db);
  const env = environment.id;
  const template = testId('rptp');
  const version = testId('rptpv');
  const run = (text: string, params: unknown[]) => database.client.query(text, params);
  await run(
    `insert into report_templates (id, environment_id, name, report_type) values ($1, $2, $3, $4)`,
    [template, env, `Synthetic ${type}`, type],
  );
  await run(
    `insert into report_template_versions (id, environment_id, report_template_id, version,
       config, status, published_at) values ($1, $2, $3, 1, '{}', 'published', now())`,
    [version, env, template],
  );
  await run(
    `insert into reports (id, environment_id, report_type, report_template_id,
       report_template_version_id, origin) values ($1, $2, $3, $4, $5, 'api')`,
    [testId('rep'), env, type, template, version],
  );
}

describe('report_type after Phase 7 (C106)', () => {
  it('accepts a template and a report of the ip-address type', async () => {
    await expect(insertTemplateAndReport('ip-address')).resolves.toBeUndefined();
  });

  it('accepts a template and a report of the custom-list type (C106.2)', async () => {
    await expect(insertTemplateAndReport('custom-list')).resolves.toBeUndefined();
  });

  it('still refuses a type outside REPORT_TYPES, at the template', async () => {
    await expect(insertTemplateAndReport('not-a-report-type')).rejects.toThrow(
      /report_templates_report_type_valid/,
    );
  });
});
