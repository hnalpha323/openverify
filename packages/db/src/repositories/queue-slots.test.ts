/**
 * C251.1 (Workflow 11B, `quotas`; review F12, review H12): the capped queues' admission rows and slots
 * on PGlite, by counts and order: in flight is admitted and unfinished; held is unfinished and not
 * admitted, oldest first; a stamp keeps its first time; a release holds a row again; environments
 * with held rows come never served first, then the longest unserved; lost rows are admitted ones
 * only (KP11-17, KP10-27). Every queue's statements run against the migrated schema. Synthetic ids.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { sealValue } from '../sealed.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReport,
  seedReportRun,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '../testing.js';
import { insertPendingAccountExport } from './account-exports.js';
import { createAccount } from './accounts.js';
import { createInquirySession } from './inquiry-sessions.js';
import {
  ADMISSION_ROW_QUEUES,
  claimHeldQueueRows,
  countQueueInFlight,
  getQueueRowState,
  listHeldQueueEnvironments,
  listLostQueueRows,
  lockQueueSlot,
  markQueueRowsAdmitted,
  releaseQueueRows,
  touchQueueSlot,
} from './queue-slots.js';

let database: TestDatabase;
let db: Db;
let A: string;
let B: string;

const T0 = new Date('2026-11-13T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  A = (await createTestTenant(db)).environment.id;
  B = (await createTestTenant(db)).environment.id;
});

/** A verification of a new inquiry, `submitted` at `submittedAt` unless another status is given. */
async function verification(
  environmentId: string,
  submittedAt: Date,
  status = 'submitted',
): Promise<string> {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const id = testId('ver');
  await db.execute(
    sql`insert into verifications (id, environment_id, inquiry_id, type, status, submitted_at)
        values (${id}, ${environmentId}, ${inquiry.id}, 'government_id'::verification_type,
          ${status}::verification_status, ${submittedAt.toISOString()})`,
  );
  return id;
}

describe('process-verification rows', () => {
  it('counts admitted, unfinished rows and claims held ones oldest first, then by id', async () => {
    const late = await verification(A, at(3));
    const early = await verification(A, at(1));
    const middle = await verification(A, at(2));
    const admitted = await verification(A, at(0));
    await verification(A, at(0), 'passed');
    await verification(B, at(0));
    await markQueueRowsAdmitted(db, 'process-verification', A, [admitted], at(5));

    expect(await countQueueInFlight(db, 'process-verification', A)).toBe(1);
    const held = await db.transaction((tx) => claimHeldQueueRows(tx, 'process-verification', A, 2));
    expect(held.map((row) => row.id)).toEqual([early, middle]);
    expect(held[0]).toEqual({ environmentId: A, id: early, since: at(1), extra: null });
    expect(
      (await claimHeldQueueRows(db, 'process-verification', A, 10)).map((row) => row.id),
    ).toEqual([early, middle, late]);
  });

  it('stamps once, releases a row to held again, and answers each row state', async () => {
    const id = await verification(A, at(0));
    const finished = await verification(A, at(0), 'passed');
    expect(await getQueueRowState(db, 'process-verification', A, id)).toBe('held');

    await markQueueRowsAdmitted(db, 'process-verification', A, [id], at(1));
    await markQueueRowsAdmitted(db, 'process-verification', A, [id], at(9));
    const stamped = await db.execute(sql`select admitted_at from verifications where id = ${id}`);
    expect(new Date(rowsOf<{ admitted_at: string }>(stamped)[0]?.admitted_at ?? 0)).toEqual(at(1));
    expect(await getQueueRowState(db, 'process-verification', A, id)).toBe('admitted');
    // Another environment's call changes nothing (the environment is part of every statement).
    await releaseQueueRows(db, 'process-verification', B, [id]);
    expect(await getQueueRowState(db, 'process-verification', A, id)).toBe('admitted');

    await releaseQueueRows(db, 'process-verification', A, [id]);
    expect(await getQueueRowState(db, 'process-verification', A, id)).toBe('held');
    expect(await getQueueRowState(db, 'process-verification', A, finished)).toBe('finished');
    expect(await getQueueRowState(db, 'process-verification', A, testId('ver'))).toBe('missing');
    expect(await getQueueRowState(db, 'process-verification', B, id)).toBe('missing');
  });

  it('lists environments with held rows never served first, then the longest unserved', async () => {
    const C = (await createTestTenant(db)).environment.id;
    for (const environmentId of [A, B, C]) {
      await verification(environmentId, at(0));
    }
    await touchQueueSlot(db, A, 'process-verification', at(2));
    await touchQueueSlot(db, B, 'process-verification', at(1));
    // Another queue's turn is its own.
    await touchQueueSlot(db, C, 'report-run', at(0));

    const listed = await listHeldQueueEnvironments(db, 'process-verification', 500);
    expect(listed.filter((id) => [A, B, C].includes(id))).toEqual([C, B, A]);
    await touchQueueSlot(db, C, 'process-verification', at(3));
    const again = await listHeldQueueEnvironments(db, 'process-verification', 500);
    expect(again.filter((id) => [A, B, C].includes(id))).toEqual([B, A, C]);

    const slots = await db.execute(
      sql`select queue, last_served_at from queue_slots where environment_id = ${C} order by queue`,
    );
    expect(rowsOf(slots)).toHaveLength(2);
  });

  it('lists as lost only admitted, unfinished rows admitted before the time, oldest first', async () => {
    const old = await verification(A, at(0));
    const recent = await verification(A, at(0));
    const heldRow = await verification(A, at(0));
    const done = await verification(A, at(0), 'passed');
    await markQueueRowsAdmitted(db, 'process-verification', A, [old], at(1));
    await markQueueRowsAdmitted(db, 'process-verification', A, [recent], at(5));
    await markQueueRowsAdmitted(db, 'process-verification', A, [done], at(1));

    const lost = await listLostQueueRows(db, 'process-verification', { before: at(3), limit: 10 });
    const ids = lost.map((row) => row.id);
    expect(ids).toContain(old);
    expect(ids).not.toContain(recent);
    expect(ids).not.toContain(heldRow);
    expect(ids).not.toContain(done);
  });

  it('takes the slot lock in a transaction', async () => {
    await db.transaction(async (tx) => {
      await lockQueueSlot(tx, A, 'process-verification');
      await lockQueueSlot(tx, A, 'process-verification');
    });
  });
});

describe('report-run rows', () => {
  it('holds pending runs of reports not redacted, oldest scheduled first, with the report id', async () => {
    const template = await seedReportTemplate(db, A);
    const reportId = await seedReport(db, A, template);
    const redacted = await seedReport(db, A, { ...template, redactedAt: at(0) });
    const second = await seedReportRun(db, A, { reportId, scheduledFor: at(2) });
    const first = await seedReportRun(db, A, { reportId, scheduledFor: at(1) });
    await seedReportRun(db, A, { reportId: redacted, scheduledFor: at(0) });
    const running = await seedReportRun(db, A, {
      reportId,
      status: 'running',
      scheduledFor: at(0),
    });
    await seedReportRun(db, A, { reportId, status: 'ready', scheduledFor: at(0) });
    await markQueueRowsAdmitted(db, 'report-run', A, [running], at(0));

    expect(await countQueueInFlight(db, 'report-run', A)).toBe(1);
    const held = await claimHeldQueueRows(db, 'report-run', A, 10);
    expect(held).toEqual([
      { environmentId: A, id: first, since: at(1), extra: reportId },
      { environmentId: A, id: second, since: at(2), extra: reportId },
    ]);
  });
});

describe('account-export and integrity-decode rows', () => {
  it('holds pending exports and counts admitted ones', async () => {
    const account = await createAccount(db, A, { id: testId('acc') });
    const other = await createAccount(db, A, { id: testId('acc') });
    const creator = { type: 'user' as const, id: testId('usr') };
    const first = await insertPendingAccountExport(db, A, {
      id: testId('aexp'),
      accountId: account.id,
      creator,
      at: at(1),
    });
    const second = await insertPendingAccountExport(db, A, {
      id: testId('aexp'),
      accountId: other.id,
      creator,
      at: at(2),
    });
    await markQueueRowsAdmitted(db, 'account-export', A, [second.id], at(3));

    expect(await countQueueInFlight(db, 'account-export', A)).toBe(1);
    expect((await claimHeldQueueRows(db, 'account-export', A, 10)).map((row) => row.id)).toEqual([
      first.id,
    ]);
  });

  it('holds challenges whose posted token waits for its decode, never one without a token', async () => {
    const { inquiry } = await createTestInquiry(db, A);
    const session = await createInquirySession(db, A, {
      id: testId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: 'a'.repeat(64),
      expiresAt: at(60),
    });
    const challenge = async (token: boolean, consumedAt: Date | null) => {
      const id = testId('ich');
      await db.execute(
        sql`insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
              request_hash, token, expires_at, consumed_at)
            values (${id}, ${A}, ${inquiry.id}, ${session.id}, ${'A'.repeat(43)},
              ${token ? sealValue(SEALED.integrityChallengeToken, id, 'synthetic-integrity-token') : null},
              now() + interval '10 minutes', ${consumedAt?.toISOString() ?? null})`,
      );
      return id;
    };
    const posted = await challenge(true, at(1));
    await challenge(false, null);
    const lostOne = await challenge(true, at(0));
    await markQueueRowsAdmitted(db, 'integrity-decode', A, [lostOne], at(0));

    expect(await countQueueInFlight(db, 'integrity-decode', A)).toBe(1);
    expect((await claimHeldQueueRows(db, 'integrity-decode', A, 10)).map((row) => row.id)).toEqual([
      posted,
    ]);
    const lost = await listLostQueueRows(db, 'integrity-decode', { before: at(5), limit: 10 });
    expect(lost.map((row) => row.id)).toEqual([lostOne]);
  });
});

describe('every queue', () => {
  it.each(ADMISSION_ROW_QUEUES)('%s: each statement runs on the migrated schema', async (queue) => {
    const id = 'missing_row';
    await db.transaction(async (tx) => {
      await lockQueueSlot(tx, A, queue);
      await touchQueueSlot(tx, A, queue, at(0));
      expect(await countQueueInFlight(tx, queue, A)).toBe(0);
      expect(await claimHeldQueueRows(tx, queue, A, 5)).toEqual([]);
      await markQueueRowsAdmitted(tx, queue, A, [id], at(0));
      await releaseQueueRows(tx, queue, A, [id]);
      await markQueueRowsAdmitted(tx, queue, A, [], at(0));
      await releaseQueueRows(tx, queue, A, []);
      expect(await getQueueRowState(tx, queue, A, id)).toBe('missing');
    });
    expect(await listHeldQueueEnvironments(db, queue, 5)).not.toContain(A);
    const lost = await listLostQueueRows(db, queue, { before: at(0), limit: 5 });
    expect(lost.filter((row) => row.environmentId === A)).toEqual([]);
  });
});
