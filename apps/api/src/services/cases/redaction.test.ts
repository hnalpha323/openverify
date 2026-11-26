/**
 * C139 (Workflow 8B Stage 3, `api-cases`): a case's redaction and retention.
 *
 * - `redactCasesInTx`: comment messages and sealed fields nulled, the field keys deleted, tags
 *   cleared, `redacted-at` set, history kept with a `redacted` row, held objects left alone,
 *   `case.redacted` staged, the stored copies of the case and its comments stubbed and forgotten, an
 *   audit entry naming the actor (a system entry naming its cause for a cascade); a case redacted
 *   before is no change, with no second entry or event.
 * - `redactCaseCopiesInTx`: a run's copies into a case's fields or a comment, redacted with their
 *   source.
 * - `runCaseRetention`: cases past `case-retention-days` from their resolution are redacted, never
 *   deleted, and notifications go after 90 days.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  appendCaseHistory,
  caseFieldValueKey,
  createCaseCommentRow,
  createUser,
  createUserNotifications,
  getCaseCommentRow,
  getCaseRow,
  replaceCaseFieldKeys,
  type Db,
} from '@openverify/db';
import { createTestInquiry, seedCase, seedCaseTemplate, testId } from '@openverify/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../../test-support/harness.js';
import { redactCaseCopiesInTx, redactCasesInTx } from './redaction.js';
import { runCaseRetention } from './retention.js';

let api: TestApi;
let db: Db;

beforeAll(async () => {
  api = await createTestApi();
  db = api.database.db;
}, 120_000);

afterAll(async () => {
  await api.close();
});

const KEY = new Uint8Array(32).fill(3);

async function caseWithContent() {
  const template = await seedCaseTemplate(db, api.environmentId);
  const made = await seedCase(db, api.environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
    fields: { note: { type: 'string', value: 'synthetic-canary-field' } },
  });
  await db.execute(sql`update cases set tags = '{alpha}' where id = ${made.id}`);
  const comment = await createCaseCommentRow(db, api.environmentId, {
    id: newId('cscm'),
    caseId: made.id,
    message: 'synthetic-canary-comment',
    commenterType: 'user',
    commenterId: testId('usr'),
    mentions: [],
  });
  await replaceCaseFieldKeys(db, api.environmentId, made.id, [
    {
      fieldKey: 'note',
      valueKey: caseFieldValueKey(KEY, {
        environmentId: api.environmentId,
        caseTemplateId: template.id,
        fieldKey: 'note',
        text: 'synthetic-canary-field',
      }),
    },
  ]);
  await appendCaseHistory(db, api.environmentId, [
    { caseId: made.id, kind: 'created', actorType: 'user', actorId: testId('usr') },
  ]);
  const { inquiry } = await createTestInquiry(db, api.environmentId);
  await db.execute(sql`insert into case_inquiries (environment_id, case_id, inquiry_id,
      attached_by_type, attached_by_id)
    values (${api.environmentId}, ${made.id}, ${inquiry.id}, 'user', ${testId('usr')})`);
  return { made, comment, inquiry };
}

const count = async (query: SQL): Promise<number> => {
  const result = await db.execute<{ n: string }>(query);
  return Number((result as { rows: { n: string }[] }).rows[0]?.n);
};

describe('redactCasesInTx (C139.1)', () => {
  it('nulls fields and messages, deletes keys, clears tags, keeps history and held objects', async () => {
    const { made, comment, inquiry } = await caseWithContent();
    const at = new Date('2026-11-03T12:00:00.000Z');

    const first = await db.transaction((tx) =>
      redactCasesInTx(tx, { events: api.deps.events, clock: api.clock }, {
        environmentId: api.environmentId,
        caseIds: [made.id],
        at,
        actor: { type: 'user', id: testId('usr') },
      }),
    );
    await api.deps.events.dispatch(first.staged);

    expect(first.cases).toEqual([{ id: made.id, redactedAt: at, alreadyRedacted: false }]);
    const row = await getCaseRow(db, api.environmentId, made.id);
    expect(row).toMatchObject({ fields: null, tags: [], redactedAt: at });
    expect((await getCaseCommentRow(db, api.environmentId, comment.id))?.message).toBeNull();
    expect(await count(sql`select count(*) as n from case_field_keys where case_id = ${made.id}`)).toBe(0);
    expect(await count(sql`select count(*) as n from case_inquiries where inquiry_id = ${inquiry.id}`)).toBe(1);
    expect(
      await count(sql`select count(*) as n from case_history where case_id = ${made.id} and kind = 'redacted'`),
    ).toBe(1);
    const events = api.events.named('case.redacted').filter((event) => JSON.stringify(event).includes(made.id));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('synthetic-canary');
    expect(
      await count(
        sql`select count(*) as n from audit_logs where resource_id = ${made.id} and action = 'case.redacted'`,
      ),
    ).toBe(1);

    const again = await db.transaction((tx) =>
      redactCasesInTx(tx, { events: api.deps.events, clock: api.clock }, {
        environmentId: api.environmentId,
        caseIds: [made.id, testId('case')],
        at: new Date(),
        actor: null,
        cause: { 'transaction-id': testId('txn') },
      }),
    );
    expect(again.cases).toEqual([{ id: made.id, redactedAt: at, alreadyRedacted: true }]);
    expect(again.staged).toEqual([]);
  });
});

describe('redactCaseCopiesInTx (C120.9, C139.1)', () => {
  it('redacts the case fields and comments a run copied from a redacted subject', async () => {
    const { made, comment } = await caseWithContent();

    const redacted = await db.transaction((tx) =>
      redactCaseCopiesInTx(tx, {
        environmentId: api.environmentId,
        targetIds: [made.id, comment.id, testId('acc')],
        at: new Date(),
      }),
    );

    expect([...redacted].sort()).toEqual([made.id, comment.id].sort());
    expect((await getCaseRow(db, api.environmentId, made.id))?.fields).toEqual({});
    expect((await getCaseCommentRow(db, api.environmentId, comment.id))?.message).toBeNull();
    expect(await count(sql`select count(*) as n from case_field_keys where case_id = ${made.id}`)).toBe(0);
  });
});

describe('runCaseRetention (C139.3, C134.4)', () => {
  it('redacts resolved cases past case-retention-days and deletes old notifications', async () => {
    const { made } = await caseWithContent();
    const kept = await caseWithContent();
    const now = new Date('2026-11-03T00:00:00.000Z');
    await db.execute(sql`update environments set settings = settings || '{"case-retention-days": 30}'::jsonb
      where id = ${api.environmentId}`);
    await db.execute(sql`update cases set status = 'approved', status_category = 'end',
        resolved_at = '2026-08-01T00:00:00Z' where id = ${made.id}`);
    await db.execute(sql`update cases set status = 'approved', status_category = 'end',
        resolved_at = '2026-10-30T00:00:00Z' where id = ${kept.made.id}`);
    const userId = testId('usr');
    await createUser(db, {
      id: userId,
      organizationId: api.organizationId,
      email: `${userId.toLowerCase()}@example.com`,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
    });
    const [old] = await createUserNotifications(db, api.environmentId, [
      { id: newId('unot'), userId, kind: 'assigned', caseId: kept.made.id },
      { id: newId('unot'), userId, kind: 'mentioned', caseId: kept.made.id },
    ]);
    await db.execute(sql`update user_notifications set created_at = '2026-07-01' where id = ${old?.id ?? ''}`);

    const report = await runCaseRetention(
      { db, storage: api.storage, events: api.deps.events },
      { now, limit: 100 },
    );

    expect(report).toMatchObject({ redactedCases: 1, failedCaseRedactions: 0, deletedUserNotifications: 1 });
    expect((await getCaseRow(db, api.environmentId, made.id))?.redactedAt).not.toBeNull();
    expect((await getCaseRow(db, api.environmentId, kept.made.id))?.redactedAt).toBeNull();
    await db.execute(sql`update environments set settings = settings - 'case-retention-days'
      where id = ${api.environmentId}`);
  });
});
