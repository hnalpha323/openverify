/**
 * C251.1 (Workflow 11B, `quotas`; review F12): the producer's admission over PGlite with every
 * migration. A produced row within its environment's cap is stamped and its job enqueued; at the cap it
 * stays held (no stamp, no job) for the fair sweep; an admitted row's job may go again under its own
 * id; a row the admission cannot see is enqueued as before. Counts, never timing. Synthetic ids.
 */
import { updateEnvironmentSettings, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test-support/fakes.js';
import { admitOnProduce } from './admit.js';

let database: TestDatabase;
let db: Db;

const T0 = new Date('2026-11-13T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function submitted(environmentId: string): Promise<string> {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const id = testId('ver');
  await db.execute(sql`
    insert into verifications (id, environment_id, inquiry_id, type, status, submitted_at)
    values (${id}, ${environmentId}, ${inquiry.id}, 'government_id'::verification_type,
      'submitted'::verification_status, ${T0.toISOString()})`);
  return id;
}

async function admittedAt(id: string): Promise<string | null> {
  const result = await database.db.execute<{ admitted: string | null }>(
    sql`select to_char(admitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as admitted
          from verifications where id = ${id}`,
  );
  return result.rows[0]?.admitted ?? null;
}

const produced = (environmentId: string, id: string) => ({
  queue: 'process-verification' as const,
  environmentId,
  id,
});

describe('admitOnProduce (C251.1)', () => {
  it('admits within the cap and holds at it, with no stamp on the held row', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    await updateEnvironmentSettings(db, environmentId, {
      'queue-in-flight-caps': { 'process-verification': 2 },
    });
    const clock = fixedClock(T0);
    const ids = [
      await submitted(environmentId),
      await submitted(environmentId),
      await submitted(environmentId),
    ];

    const answers: boolean[] = [];
    for (const id of ids) {
      answers.push(await admitOnProduce({ db, clock }, produced(environmentId, id)));
    }

    expect(answers).toEqual([true, true, false]);
    expect(await admittedAt(ids[0] ?? '')).toBe(T0.toISOString());
    expect(await admittedAt(ids[1] ?? '')).toBe(T0.toISOString());
    expect(await admittedAt(ids[2] ?? '')).toBeNull();
  });

  it('lets an admitted row’s job go again, keeping its first stamp, even at the cap', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    await updateEnvironmentSettings(db, environmentId, {
      'queue-in-flight-caps': { 'process-verification': 1 },
    });
    const clock = fixedClock(T0);
    const id = await submitted(environmentId);
    expect(await admitOnProduce({ db, clock }, produced(environmentId, id))).toBe(true);
    clock.advance(60_000);

    expect(await admitOnProduce({ db, clock }, produced(environmentId, id))).toBe(true);
    expect(await admittedAt(id)).toBe(T0.toISOString());
  });

  it('counts each environment and queue on its own', async () => {
    const full = (await createTestTenant(db)).environment.id;
    const other = (await createTestTenant(db)).environment.id;
    await updateEnvironmentSettings(db, full, {
      'queue-in-flight-caps': { 'process-verification': 1 },
    });
    const clock = fixedClock(T0);
    expect(await admitOnProduce({ db, clock }, produced(full, await submitted(full)))).toBe(true);
    expect(await admitOnProduce({ db, clock }, produced(full, await submitted(full)))).toBe(false);

    expect(await admitOnProduce({ db, clock }, produced(other, await submitted(other)))).toBe(true);
  });

  it('enqueues as before a row it cannot see or that has finished', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    await updateEnvironmentSettings(db, environmentId, {
      'queue-in-flight-caps': { 'process-verification': 1 },
    });
    const clock = fixedClock(T0);
    await admitOnProduce({ db, clock }, produced(environmentId, await submitted(environmentId)));
    const finished = await submitted(environmentId);
    await db.execute(sql`update verifications set status = 'passed' where id = ${finished}`);

    expect(await admitOnProduce({ db, clock }, produced(environmentId, testId('ver')))).toBe(true);
    expect(await admitOnProduce({ db, clock }, produced(environmentId, finished))).toBe(true);
    expect(await admittedAt(finished)).toBeNull();
  });
});
