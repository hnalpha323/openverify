/**
 * `pnpm --filter @openverify/api analytics:benchmark --measure` (C163.7,
 * `scripts/analytics-benchmark.ts`): the 5-minute refresh step must find its 48 hours dirty on every
 * run, not only the first on a seed. The `inquiries` table keeps `updated_at` through a trigger
 * (`openverify_set_updated_at`, migration 0001) that replaces an unchanged value with the wall
 * clock, so a second `--measure` on the same seed, writing the value the first one wrote, left the
 * touched rows outside the benchmark's clock window and timed an empty refresh (validation-9c).
 * PGlite, synthetic data only. Vitest runs `src/**` tests, so the script's tests live here.
 */
import { createVerification, replaceVerificationChecks } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCase,
  seedCaseTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANALYTICS_BENCHMARK_TOUCHED_AT,
  touchRefreshWindow,
} from '../scripts/analytics-benchmark.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** A row's `updated_at` in UTC; `table` names the source and `where` its row. */
async function updatedAtIn(table: string, where: ReturnType<typeof sql>): Promise<string> {
  const result = await database.db.execute<{ updated_at: string }>(
    sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
      from ${sql.identifier(table)} where ${where}`,
  );
  const [row] = result.rows;
  if (row === undefined) throw new Error(`no ${table} row`);
  return row.updated_at;
}

const updatedAtOf = (id: string) => updatedAtIn('inquiries', sql`id = ${id}`);

describe('touchRefreshWindow (the benchmark refresh step)', () => {
  it('gives the touched inquiries the benchmark time on every run, a repeated --measure included', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const { inquiry: outside } = await createTestInquiry(database.db, environment.id);
    await database.db.execute(
      sql`update inquiries set created_at = timestamptz '2026-10-30 12:00:00+00' where id = ${inquiry.id}`,
    );
    await database.db.execute(
      sql`update inquiries set created_at = timestamptz '2026-10-20 12:00:00+00' where id = ${outside.id}`,
    );
    const expected = ANALYTICS_BENCHMARK_TOUCHED_AT.toISOString().replace('.000Z', 'Z');
    const untouched = await updatedAtOf(outside.id);

    await touchRefreshWindow(database.db, environment.id);
    expect(await updatedAtOf(inquiry.id)).toBe(expected);

    // The second --measure on the same seed writes the same value again.
    await touchRefreshWindow(database.db, environment.id);
    expect(await updatedAtOf(inquiry.id)).toBe(expected);
    expect(await updatedAtOf(outside.id)).toBe(untouched);
  });

  it('touches a row of every source dirtyDays reads in the window: verifications, checks and cases too (R008)', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const verificationId = 'ver_01JR0080000000000000000001';
    const outsideId = 'ver_01JR0080000000000000000002';
    for (const id of [verificationId, outsideId]) {
      await createVerification(database.db, environment.id, {
        id,
        inquiryId: inquiry.id,
        type: 'government_id',
      });
      await replaceVerificationChecks(database.db, environment.id, id, [
        {
          name: 'id_expiration_detection',
          status: 'passed',
          type: 'fraud',
          requirement: 'required',
        },
      ]);
    }
    const template = await seedCaseTemplate(database.db, environment.id);
    const inWindow = await seedCase(database.db, environment.id, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: 1,
    });
    const outsideCase = await seedCase(database.db, environment.id, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: 2,
    });
    const at = (when: string) => sql.raw(`timestamptz '${when}'`);
    const created = async (table: string, where: ReturnType<typeof sql>, when: string) => {
      await database.db.execute(
        sql`update ${sql.identifier(table)} set created_at = ${at(when)} where ${where}`,
      );
    };
    await created('verifications', sql`id = ${verificationId}`, '2026-10-30 12:00:00+00');
    await created(
      'verification_checks',
      sql`verification_id = ${verificationId}`,
      '2026-10-30 12:00:00+00',
    );
    await created('cases', sql`id = ${inWindow.id}`, '2026-10-30 12:00:00+00');
    await created('verifications', sql`id = ${outsideId}`, '2026-10-20 12:00:00+00');
    await created(
      'verification_checks',
      sql`verification_id = ${outsideId}`,
      '2026-10-20 12:00:00+00',
    );
    await created('cases', sql`id = ${outsideCase.id}`, '2026-10-20 12:00:00+00');
    const sources = [
      ['verifications', sql`id = ${verificationId}`, sql`id = ${outsideId}`],
      [
        'verification_checks',
        sql`verification_id = ${verificationId}`,
        sql`verification_id = ${outsideId}`,
      ],
      ['cases', sql`id = ${inWindow.id}`, sql`id = ${outsideCase.id}`],
    ] as const;
    const untouched = await Promise.all(
      sources.map(([table, , outside]) => updatedAtIn(table, outside)),
    );
    const expected = ANALYTICS_BENCHMARK_TOUCHED_AT.toISOString().replace('.000Z', 'Z');

    // Twice, as a repeated --measure on one seed runs it.
    for (let run = 0; run < 2; run += 1) {
      await touchRefreshWindow(database.db, environment.id);
      for (const [table, inside] of sources) {
        expect(await updatedAtIn(table, inside), table).toBe(expected);
      }
    }
    for (const [index, [table, , outside]] of sources.entries()) {
      expect(await updatedAtIn(table, outside), table).toBe(untouched[index]);
    }
  });
});
