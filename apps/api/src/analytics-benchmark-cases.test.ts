/**
 * 10A's carried item (Workflow 11D load-harness; docs/PROGRESS.md "analytics:benchmark's seed holds
 * no cases", phase-10.plan.md:1256): the benchmark's seed writes one case for every 20 inquiries
 * (5%, 50,000 of the 1,000,000), across the template's three status categories, a third of them
 * resolved, on the inquiries' days, so the 5-minute refresh times its case branch. PGlite, the
 * seed's own statement, synthetic rows only.
 */
import {
  createTestDatabase,
  createTestTenant,
  seedCaseTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { createKeyring, sealJson, setDefaultKeyring } from '@openverify/db';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANALYTICS_BENCHMARK_SIZE,
  benchmarkCasesStatement,
} from '../scripts/analytics-benchmark.js';

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
  setDefaultKeyring(undefined);
});

describe('the analytics benchmark seed writes cases (10A carried item)', () => {
  it('states its share: one case for every 20 inquiries', () => {
    expect(ANALYTICS_BENCHMARK_SIZE.inquiriesPerCase).toBe(20);
    expect(ANALYTICS_BENCHMARK_SIZE.inquiries / ANALYTICS_BENCHMARK_SIZE.inquiriesPerCase).toBe(
      50_000,
    );
  });

  it('writes 5% of a batch range as cases, a third in each category, the end ones resolved', async () => {
    const { environment } = await createTestTenant(database.db);
    const template = await seedCaseTemplate(database.db, environment.id);
    await database.db.execute(
      benchmarkCasesStatement({
        environmentId: environment.id,
        caseTemplateId: template.id,
        caseTemplateVersionId: template.versionId,
        from: 1,
        to: 600,
        fieldsSealed: sealJson('cases.fields', 'case_benchmark', {}),
      }),
    );
    const result: unknown = await database.db.execute(sql`
      select status_category, count(*)::int as n, count(resolved_at)::int as resolved,
        count(distinct name)::int as names, min(created_at) >= timestamptz '2025-11-01' as on_days
      from cases where environment_id = ${environment.id} group by 1 order by 1`);
    const rows = (result as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toEqual([
      { status_category: 'end', n: 10, resolved: 10, names: 10, on_days: true },
      { status_category: 'initial', n: 10, resolved: 0, names: 10, on_days: true },
      { status_category: 'intermediate', n: 10, resolved: 0, names: 10, on_days: true },
    ]);
  });

  it('skips what a resumed batch already wrote', async () => {
    const { environment } = await createTestTenant(database.db);
    const template = await seedCaseTemplate(database.db, environment.id);
    const statement = benchmarkCasesStatement({
      environmentId: environment.id,
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      from: 1001,
      to: 1100,
      fieldsSealed: sealJson('cases.fields', 'case_benchmark', {}),
    });
    await database.db.execute(statement);
    await database.db.execute(statement);
    const result: unknown = await database.db.execute(
      sql`select count(*)::int as n from cases where environment_id = ${environment.id}`,
    );
    expect((result as { rows: { n: number }[] }).rows[0]?.n).toBe(5);
  });
});
