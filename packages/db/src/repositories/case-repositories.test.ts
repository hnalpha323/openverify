/**
 * Workflow 8B Stage 3 (`api-cases`; C129-C139): the case repositories.
 *
 * - Case rows: created with their fields sealed, read and locked within their environment, named by
 *   the template's counter, changed with `lock_version` moving by one, listed newest first under the
 *   filters and the reader's template visibility (C129.4), and walked by the recurring trigger and the
 *   retention step.
 * - Templates and versions: one draft, publish supersedes, versions numbered in order.
 * - Comments, the timeline, held objects with their attached state, field keys, notifications and
 *   bulk actions.
 *
 * Every value is synthetic.
 */
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEALED } from '../encrypted-columns.js';
import { InvalidCursorError } from '../errors.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCase,
  seedCaseTemplate,
  testId,
  type TestDatabase,
} from '../testing.js';
import type { Db } from '../client.js';
import {
  appendCaseHistory,
  attachCaseObjects,
  caseFieldValueKey,
  claimCaseBulkActionRow,
  completeCaseBulkActionRow,
  countCaseObjects,
  createCaseBulkActionRow,
  createCaseCommentRow,
  createCaseRow,
  createCaseTemplateRow,
  createCaseTemplateVersionRow,
  createUser,
  createUserNotifications,
  deleteCaseFieldKeys,
  deleteExpiredUserNotifications,
  existingCaseTemplateIds,
  findAttachableObjects,
  getCaseBulkActionRow,
  getCaseCommentRow,
  getCaseRow,
  getCaseRows,
  getCaseTemplateRow,
  getCaseTemplateVersionRow,
  getDraftCaseTemplateVersion,
  getPublishedCaseTemplateVersion,
  getUserNotificationRow,
  heldKindOfId,
  hiddenCaseObjectIds,
  listCaseCommentIds,
  listCaseCommentRows,
  listCaseHeldObjectRows,
  listCaseHistoryRows,
  listCaseRows,
  listCaseTemplateRows,
  listCaseTemplateVersionHeads,
  listCaseTemplateVersionRows,
  listCasesAfter,
  listCasesHolding,
  listCasesPastRetention,
  listHeldInquiryTemplateIds,
  listUnfinishedCaseBulkActions,
  listUserNotificationRows,
  lockCaseRow,
  lockCaseTemplateRow,
  markUserNotificationRead,
  nextCaseNumber,
  publishCaseTemplateVersionRow,
  redactCaseCommentRow,
  redactCaseCommentRows,
  redactCaseCommentsById,
  removeCaseObjects,
  replaceCaseFieldKeys,
  unredactedCaseIds,
  updateCaseRow,
  updateCaseTemplateRow,
  updateCaseTemplateVersionRow,
  type CaseTemplateVersionContent,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const db = (): Db => database.db;

const rawRows = async <Row extends Record<string, unknown>>(query: SQL): Promise<Row[]> => {
  const result = await db().execute<Row>(query);
  return (result as { rows: Row[] }).rows;
};

async function addUser(organizationId: string, id: string): Promise<void> {
  await createUser(db(), {
    id,
    organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
}

async function tenant() {
  const { organization, environment } = await createTestTenant(db());
  return { environmentId: environment.id, organizationId: organization.id };
}

const KEY = new Uint8Array(32).fill(7);

const CONTENT: CaseTemplateVersionContent = {
  fieldSchemas: [],
  statuses: [
    { key: 'open', label: 'Open', category: 'initial' },
    { key: 'approved', label: 'Approved', category: 'end' },
  ],
  resolutions: ['Approved'],
  transitions: null,
  defaultQueueId: null,
  assignmentPolicyId: null,
  slaPolicyId: null,
  slaStartsOn: 'created',
  heldObjectTypes: ['inquiry', 'account'],
  attachmentPolicy: null,
  notifyOnCreate: [],
  layoutModules: null,
};

/** A template with a published first version, made by the repositories. */
async function template(environmentId: string, key: string) {
  const id = testId('ctmpl');
  await createCaseTemplateRow(db(), environmentId, {
    id,
    name: 'Synthetic review',
    key,
    visibleToRoles: [],
  });
  const version = await createCaseTemplateVersionRow(db(), environmentId, {
    id: testId('ctmplv'),
    caseTemplateId: id,
    content: CONTENT,
  });
  await publishCaseTemplateVersionRow(db(), environmentId, version.id, new Date());
  return { id, versionId: version.id, key };
}

async function newCase(
  environmentId: string,
  t: { id: string; versionId: string; key: string },
  number: number,
  fields: Record<string, unknown> = {},
) {
  return createCaseRow(db(), environmentId, {
    id: testId('case'),
    caseTemplateId: t.id,
    caseTemplateVersionId: t.versionId,
    name: `${t.key}-${String(number)}`,
    status: 'open',
    statusCategory: 'initial',
    caseQueueId: null,
    creatorType: 'user',
    creatorId: testId('usr'),
    tags: ['synthetic'],
    fields,
  });
}

describe('case rows (C129.2, C131)', () => {
  it('seal the fields, read within the environment, and lock', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();
    const t = await template(environmentId, 'CR');
    const fields = { note: { type: 'string', value: 'synthetic-canary-fields' } };
    const made = await newCase(environmentId, t, 1, fields);

    expect(made.fields).toEqual(fields);
    const raw = await rawRows<{ fields: string }>(
      sql`select fields from cases where id = ${made.id}`,
    );
    expect(raw[0]?.fields).not.toContain('synthetic-canary-fields');
    expect((await getCaseRow(db(), environmentId, made.id))?.fields).toEqual(fields);
    expect(await getCaseRow(db(), other.environmentId, made.id)).toBeNull();
    const locked = await db().transaction((tx) => lockCaseRow(tx, environmentId, made.id));
    expect(locked?.name).toBe('CR-1');
    expect(
      await db().transaction((tx) => lockCaseRow(tx, environmentId, testId('case'))),
    ).toBeNull();
  });

  it('number each template’s cases from 1, one template apart from another', async () => {
    const { environmentId } = await tenant();
    const a = await template(environmentId, 'NA');
    const b = await template(environmentId, 'NB');

    const numbers = [
      await nextCaseNumber(db(), environmentId, a.id),
      await nextCaseNumber(db(), environmentId, a.id),
      await nextCaseNumber(db(), environmentId, b.id),
      await nextCaseNumber(db(), environmentId, a.id),
    ];

    expect(numbers).toEqual([1, 2, 1, 3]);
  });

  it('change a case, moving lock-version by one, and seal new fields', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'UP');
    const made = await newCase(environmentId, t, 1);
    const at = new Date('2026-11-03T10:00:00.000Z');

    const changed = await updateCaseRow(db(), environmentId, made.id, {
      status: 'approved',
      statusCategory: 'end',
      resolution: 'Approved',
      resolverType: 'user',
      resolverId: made.creatorId,
      resolvedAt: at,
      tags: ['a', 'b'],
      fields: { note: { type: 'string', value: 'changed' } },
      sla: {
        state: 'running',
        epoch: 1,
        consumedMs: 0,
        segmentStartedAt: at,
        expiresAt: new Date(at.getTime() + 60_000),
        expiredAt: null,
        metAt: null,
        targetMs: 60_000,
        policyId: null,
        policyRevision: null,
        calendarId: null,
        onReopen: 'continue',
      },
    });

    expect(changed).toMatchObject({
      status: 'approved',
      resolution: 'Approved',
      lockVersion: made.lockVersion + 1,
      tags: ['a', 'b'],
      fields: { note: { type: 'string', value: 'changed' } },
      slaState: 'running',
      slaTargetMs: 60_000,
    });
    const redacted = await updateCaseRow(db(), environmentId, made.id, {
      fields: null,
      redactedAt: at,
    });
    expect(redacted?.fields).toBeNull();
    expect(redacted?.lockVersion).toBe(made.lockVersion + 2);
    expect(await updateCaseRow(db(), environmentId, testId('case'), { tags: [] })).toBeNull();
  });

  it('list newest first under the filters, paging by id', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'LS');
    const first = await newCase(environmentId, t, 1);
    const second = await newCase(environmentId, t, 2);
    const third = await newCase(environmentId, t, 3);
    for (const [index, id] of [first.id, second.id, third.id].entries()) {
      await db().execute(
        sql`update cases set created_at = ${new Date(Date.UTC(2026, 0, 1 + index)).toISOString()}
          where id = ${id}`,
      );
    }
    await updateCaseRow(db(), environmentId, second.id, {
      status: 'approved',
      statusCategory: 'end',
      resolvedAt: new Date(),
    });
    const reader = { kind: 'system' } as const;

    const page = await listCaseRows(db(), environmentId, reader, {}, { size: 2 });
    expect(page.items.map(({ id }) => id)).toEqual([third.id, second.id]);
    const next = await listCaseRows(
      db(),
      environmentId,
      reader,
      {},
      { size: 2, after: page.next ?? '' },
    );
    expect(next.items.map(({ id }) => id)).toEqual([first.id]);
    expect(next.next).toBeNull();
    const ended = await listCaseRows(
      db(),
      environmentId,
      reader,
      { statusCategories: ['end'] },
      {},
    );
    expect(ended.items.map(({ id }) => id)).toEqual([second.id]);
    expect((await listCaseRows(db(), environmentId, reader, { statuses: [] }, {})).items).toEqual(
      [],
    );
    await expect(
      listCaseRows(db(), environmentId, reader, {}, { after: testId('case') }),
    ).rejects.toThrow(InvalidCursorError);
  });

  it('filter by what a case holds: an inquiry, an account and its reference id', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'HF');
    const holding = await newCase(environmentId, t, 1);
    await newCase(environmentId, t, 2);
    const { inquiry } = await createTestInquiry(db(), environmentId, {
      referenceId: 'ref-synthetic-1',
    });
    const found = await findAttachableObjects(db(), environmentId, [inquiry.id, inquiry.accountId]);
    await attachCaseObjects(
      db(),
      environmentId,
      found.map((object) => ({
        caseId: holding.id,
        ...object,
        attachedByType: 'user' as const,
        attachedById: holding.creatorId,
      })),
    );
    await db().execute(
      sql`update accounts set reference_id = 'acct-synthetic-1' where id = ${inquiry.accountId}`,
    );
    const reader = { kind: 'system' } as const;
    const ids = async (filters: Parameters<typeof listCaseRows>[3]) =>
      (await listCaseRows(db(), environmentId, reader, filters, {})).items.map(({ id }) => id);

    expect(await ids({ inquiryIds: [inquiry.id] })).toEqual([holding.id]);
    expect(await ids({ accountIds: [inquiry.accountId] })).toEqual([holding.id]);
    expect(await ids({ referenceId: 'acct-synthetic-1' })).toEqual([holding.id]);
    expect(await ids({ reportIds: [testId('rep')] })).toEqual([]);
  });

  it('hide a restricted template’s cases from a user without a listed role and a key without it (C129.4)', async () => {
    const { environmentId, organizationId } = await tenant();
    const open = await template(environmentId, 'VO');
    const restricted = await template(environmentId, 'VR');
    const roleId = testId('role');
    await db().execute(sql`insert into roles (id, organization_id, name, permissions)
      values (${roleId}, ${organizationId}, 'Synthetic restricted', '{}'::text[])`);
    await updateCaseTemplateRow(db(), environmentId, restricted.id, { visibleToRoles: [roleId] });
    const seen = await newCase(environmentId, open, 1);
    const hidden = await newCase(environmentId, restricted, 1);
    const comment = await createCaseCommentRow(db(), environmentId, {
      id: testId('cscm'),
      caseId: hidden.id,
      message: 'synthetic',
      commenterType: 'user',
      commenterId: hidden.creatorId,
      mentions: [],
    });
    const userId = testId('usr');
    await addUser(organizationId, userId);
    const user = { kind: 'user', userId } as const;
    const keyId = testId('key');
    const key = { kind: 'api-key', apiKeyId: keyId } as const;
    const ids = async (reader: Parameters<typeof listCaseRows>[2]) =>
      (await listCaseRows(db(), environmentId, reader, {}, {})).items.map(({ id }) => id).sort();

    expect(await ids(user)).toEqual([seen.id]);
    expect(await ids(key)).toEqual([seen.id]);
    expect(
      [
        ...(await hiddenCaseObjectIds(db(), environmentId, user, [
          seen.id,
          hidden.id,
          comment.id,
          testId('case'),
        ])),
      ].sort(),
    ).toEqual([hidden.id, comment.id].sort());
    expect(
      (await getCaseRows(db(), environmentId, user, [hidden.id, seen.id])).map(({ id }) => id),
    ).toEqual([seen.id]);

    await db().execute(
      sql`insert into user_roles (organization_id, user_id, role_id)
      values (${organizationId}, ${userId}, ${roleId})`,
    );
    expect(await ids(user)).toEqual([seen.id, hidden.id].sort());
    expect(await ids({ kind: 'system' })).toEqual([seen.id, hidden.id].sort());
    expect((await hiddenCaseObjectIds(db(), environmentId, user, [hidden.id])).size).toBe(0);
    expect(
      (await hiddenCaseObjectIds(db(), environmentId, { kind: 'system' }, [hidden.id])).size,
    ).toBe(0);
  });

  it('walk unredacted cases oldest id first for the recurring trigger (C118.4)', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'RC');
    const made = [await newCase(environmentId, t, 1), await newCase(environmentId, t, 2)];
    const ids = made.map(({ id }) => id).sort();
    await updateCaseRow(db(), environmentId, ids[0] ?? '', {
      fields: null,
      redactedAt: new Date(),
    });

    expect(await listCasesAfter(db(), environmentId, { cursor: null, limit: 10 })).toEqual([
      ids[1],
    ]);
    expect(await listCasesAfter(db(), environmentId, { cursor: ids[1] ?? '', limit: 10 })).toEqual(
      [],
    );
  });

  it('find resolved cases past their environment’s case-retention-days, and none without it (C139.3)', async () => {
    const { environmentId } = await tenant();
    const kept = await tenant();
    await db()
      .execute(sql`update environments set settings = settings || '{"case-retention-days": 30}'::jsonb
      where id = ${environmentId}`);
    const t = await template(environmentId, 'RT');
    const k = await template(kept.environmentId, 'RT');
    const now = new Date('2026-11-03T00:00:00.000Z');
    const old = new Date('2026-09-01T00:00:00.000Z');
    const due = await newCase(environmentId, t, 1);
    const recent = await newCase(environmentId, t, 2);
    const unset = await newCase(kept.environmentId, k, 1);
    for (const [id, env, at] of [
      [due.id, environmentId, old],
      [recent.id, environmentId, now],
      [unset.id, kept.environmentId, old],
    ] as const) {
      await updateCaseRow(db(), env, id, {
        status: 'approved',
        statusCategory: 'end',
        resolvedAt: at,
      });
    }

    const found = await listCasesPastRetention(db(), now, 100);

    expect(
      found.filter(({ environmentId: env }) => env === environmentId || env === kept.environmentId),
    ).toEqual([{ id: due.id, environmentId }]);
  });
});

describe('templates and versions (C130)', () => {
  it('keep one draft, number versions in order, and supersede on publish', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'TV');
    expect((await getCaseTemplateRow(db(), environmentId, t.id))?.key).toBe('TV');
    const draft = await createCaseTemplateVersionRow(db(), environmentId, {
      id: testId('ctmplv'),
      caseTemplateId: t.id,
      content: { ...CONTENT, resolutions: ['Approved', 'Declined'] },
    });
    expect(draft).toMatchObject({
      version: 2,
      status: 'draft',
      resolutions: ['Approved', 'Declined'],
    });
    expect((await getDraftCaseTemplateVersion(db(), environmentId, t.id))?.id).toBe(draft.id);

    const edited = await updateCaseTemplateVersionRow(db(), environmentId, draft.id, {
      notifyOnCreate: [],
      transitions: { open: ['approved'] },
    });
    expect(edited?.transitions).toEqual({ open: ['approved'] });
    const heads = await listCaseTemplateVersionHeads(db(), environmentId, [t.id]);
    expect(heads.get(t.id)?.published?.id).toBe(t.versionId);
    expect(heads.get(t.id)?.draft?.id).toBe(draft.id);

    const { published, superseded } = await db().transaction(async (tx) => {
      await lockCaseTemplateRow(tx, environmentId, t.id);
      return publishCaseTemplateVersionRow(tx, environmentId, draft.id, new Date());
    });
    expect(published.status).toBe('published');
    expect(superseded?.id).toBe(t.versionId);
    expect((await getCaseTemplateVersionRow(db(), environmentId, t.versionId))?.status).toBe(
      'superseded',
    );
    expect((await getPublishedCaseTemplateVersion(db(), environmentId, t.id))?.id).toBe(draft.id);
    expect(await getDraftCaseTemplateVersion(db(), environmentId, t.id)).toBeNull();
    expect(
      await updateCaseTemplateVersionRow(db(), environmentId, draft.id, { resolutions: [] }),
    ).toBeNull();
    await expect(
      publishCaseTemplateVersionRow(db(), environmentId, draft.id, new Date()),
    ).rejects.toThrow('not a draft');
  });

  it('list templates and versions newest first, and archive a template', async () => {
    const { environmentId } = await tenant();
    const a = await template(environmentId, 'LA');
    const b = await template(environmentId, 'LB');
    await db().execute(sql`update case_templates set created_at = '2026-01-01' where id = ${a.id}`);
    await db().execute(sql`update case_templates set created_at = '2026-01-02' where id = ${b.id}`);
    const archived = await updateCaseTemplateRow(db(), environmentId, a.id, {
      status: 'archived',
      archivedAt: new Date(),
      name: 'Synthetic archived',
    });
    expect(archived?.status).toBe('archived');

    expect(
      (await listCaseTemplateRows(db(), environmentId, {}, {})).items.map(({ id }) => id),
    ).toEqual([b.id, a.id]);
    expect(
      (await listCaseTemplateRows(db(), environmentId, { statuses: ['archived'] }, {})).items.map(
        ({ id }) => id,
      ),
    ).toEqual([a.id]);
    expect((await listCaseTemplateRows(db(), environmentId, { keys: [] }, {})).items).toEqual([]);
    expect(
      (
        await listCaseTemplateVersionRows(db(), environmentId, { caseTemplateIds: [b.id] }, {})
      ).items.map(({ id }) => id),
    ).toEqual([b.versionId]);
    expect(
      (await listCaseTemplateVersionRows(db(), environmentId, { caseTemplateIds: [] }, {})).items,
    ).toEqual([]);
    expect([
      ...(await existingCaseTemplateIds(db(), environmentId, [a.id, testId('ctmpl')])),
    ]).toEqual([a.id]);
    expect((await existingCaseTemplateIds(db(), environmentId, [])).size).toBe(0);
  });
});

describe('comments (C134)', () => {
  it('seal the message, list newest first and redact one or a case’s', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'CM');
    const made = await newCase(environmentId, t, 1);
    const first = await createCaseCommentRow(db(), environmentId, {
      id: testId('cscm'),
      caseId: made.id,
      message: 'synthetic-canary-comment',
      commenterType: 'user',
      commenterId: made.creatorId,
      mentions: [made.creatorId],
    });
    const second = await createCaseCommentRow(db(), environmentId, {
      id: testId('cscm'),
      caseId: made.id,
      message: 'second synthetic comment',
      commenterType: 'api-key',
      commenterId: testId('key'),
      mentions: [],
    });
    await db().execute(
      sql`update case_comments set created_at = '2026-01-01' where id = ${first.id}`,
    );
    await db().execute(
      sql`update case_comments set created_at = '2026-01-02' where id = ${second.id}`,
    );
    const raw = await rawRows<{ message: string }>(
      sql`select message from case_comments where id = ${first.id}`,
    );
    expect(raw[0]?.message).not.toContain('canary');
    expect((await getCaseCommentRow(db(), environmentId, first.id))?.message).toBe(
      'synthetic-canary-comment',
    );

    const page = await listCaseCommentRows(db(), environmentId, made.id, {});
    expect(page.items.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(await listCaseCommentIds(db(), environmentId, [made.id])).toEqual(
      [first.id, second.id].sort(),
    );

    const at = new Date();
    expect((await redactCaseCommentRow(db(), environmentId, first.id, at))?.message).toBeNull();
    expect(await redactCaseCommentRow(db(), environmentId, first.id, at)).toBeNull();
    expect(await redactCaseCommentsById(db(), environmentId, [first.id, second.id], at)).toEqual([
      second.id,
    ]);
    expect(await redactCaseCommentRows(db(), environmentId, [made.id], at)).toBe(0);
    expect(await redactCaseCommentRows(db(), environmentId, [], at)).toBe(0);
    expect(await listCaseCommentIds(db(), environmentId, [])).toEqual([]);
    expect(await redactCaseCommentsById(db(), environmentId, [], at)).toEqual([]);
  });
});

describe('the timeline (C131.4)', () => {
  it('appends rows and pages them newest first by their number', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'HS');
    const made = await newCase(environmentId, t, 1);
    const rows = await appendCaseHistory(db(), environmentId, [
      { caseId: made.id, kind: 'created', actorType: 'user', actorId: made.creatorId },
      {
        caseId: made.id,
        kind: 'tags-changed',
        actorType: 'system',
        actorId: null,
        to: { added: ['a'] },
      },
      {
        caseId: made.id,
        kind: 'comment-added',
        actorType: 'user',
        actorId: made.creatorId,
        requestId: 'req-1',
      },
    ]);
    const numbers = rows.map(({ id }) => id).sort((a, b) => b - a);

    const page = await listCaseHistoryRows(db(), environmentId, made.id, { size: 2 });
    expect(page.items.map(({ id }) => id)).toEqual(numbers.slice(0, 2));
    const next = await listCaseHistoryRows(db(), environmentId, made.id, {
      size: 2,
      after: Number(page.next),
    });
    expect(next.items.map(({ id }) => id)).toEqual(numbers.slice(2));
    expect(next.next).toBeNull();
    expect(await appendCaseHistory(db(), environmentId, [])).toEqual([]);
    await expect(
      listCaseHistoryRows(db(), environmentId, made.id, { after: 999_999_999 }),
    ).rejects.toThrow(InvalidCursorError);
  });
});

describe('held objects (C136)', () => {
  it('find each kind by its prefix with a PII-free state, and attach each once', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'HO');
    const made = await newCase(environmentId, t, 1);
    const { inquiry, template: inquiryTemplate } = await createTestInquiry(db(), environmentId);

    expect(heldKindOfId(inquiry.id)).toBe('inquiry');
    expect(heldKindOfId('sar_01M6FQZCV622MRCK2ZKC7F4HD9')).toBeNull();
    const found = await findAttachableObjects(db(), environmentId, [
      inquiry.id,
      inquiry.accountId,
      testId('txn'),
    ]);
    expect(found.map(({ objectType }) => objectType).sort()).toEqual(['account', 'inquiry']);
    expect(found.find(({ objectType }) => objectType === 'inquiry')?.attachedState).toMatchObject({
      status: 'created',
      'inquiry-template-id': inquiryTemplate.id,
      'verification-ids': [],
    });
    const rows = found.map((object) => ({
      caseId: made.id,
      ...object,
      attachedByType: 'user' as const,
      attachedById: made.creatorId,
    }));

    expect(await attachCaseObjects(db(), environmentId, rows)).toHaveLength(2);
    expect(await attachCaseObjects(db(), environmentId, rows)).toEqual([]);
    expect(await countCaseObjects(db(), environmentId, made.id)).toBe(2);
    expect(await listCasesHolding(db(), environmentId, [inquiry.id])).toEqual([made.id]);
    expect(await listCasesHolding(db(), environmentId, [])).toEqual([]);
    expect((await listHeldInquiryTemplateIds(db(), environmentId, [made.id])).get(made.id)).toEqual(
      [inquiryTemplate.id],
    );
    expect((await listHeldInquiryTemplateIds(db(), environmentId, [])).size).toBe(0);

    const page = await listCaseHeldObjectRows(db(), environmentId, made.id, { size: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.next).toBe(`${made.id}:${page.items[0]?.objectId ?? ''}`);
    const rest = await listCaseHeldObjectRows(db(), environmentId, made.id, {
      afterObjectId: page.items[0]?.objectId,
    });
    expect(rest.items).toHaveLength(1);
    expect(rest.next).toBeNull();
    const accounts = await listCaseHeldObjectRows(db(), environmentId, made.id, {
      objectTypes: ['account'],
    });
    expect(accounts.items.map(({ objectId }) => objectId)).toEqual([inquiry.accountId]);
    expect(
      (await listCaseHeldObjectRows(db(), environmentId, made.id, { objectTypes: [] })).items,
    ).toEqual([]);
    await expect(
      listCaseHeldObjectRows(db(), environmentId, made.id, { afterObjectId: testId('inq') }),
    ).rejects.toThrow(InvalidCursorError);

    const removed = await removeCaseObjects(db(), environmentId, made.id, [
      inquiry.id,
      testId('acc'),
    ]);
    expect(removed).toEqual([{ objectType: 'inquiry', objectId: inquiry.id }]);
    expect(await removeCaseObjects(db(), environmentId, made.id, [])).toEqual([]);
    expect(await countCaseObjects(db(), environmentId, made.id)).toBe(1);
    expect(await unredactedCaseIds(db(), environmentId, [made.id, testId('case')])).toEqual([
      made.id,
    ]);
    expect(await unredactedCaseIds(db(), environmentId, [])).toEqual([]);
  });

  it('find a document verification as a document (H31)', async () => {
    const { environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(db(), environmentId);
    const id = testId('ver');
    await db().execute(sql`insert into verifications (id, environment_id, inquiry_id, type, status)
      values (${id}, ${environmentId}, ${inquiry.id}, 'document', 'passed')`);

    const [found] = await findAttachableObjects(db(), environmentId, [id]);

    expect(found).toMatchObject({
      objectType: 'document',
      attachedState: { type: 'document', status: 'passed' },
    });
  });
});

describe('field keys (C136.4)', () => {
  it('key a value per template and field, and replace and delete a case’s keys', async () => {
    const { environmentId } = await tenant();
    const t = await template(environmentId, 'FK');
    const made = await newCase(environmentId, t, 1);
    const key = (caseTemplateId: string, fieldKey: string) =>
      caseFieldValueKey(KEY, { environmentId, caseTemplateId, fieldKey, text: 'same' });

    expect(key(t.id, 'a')).toMatch(/^[0-9a-f]{64}$/);
    expect(key(t.id, 'a')).not.toBe(key(t.id, 'b'));
    expect(key(t.id, 'a')).not.toBe(key(testId('ctmpl'), 'a'));
    await replaceCaseFieldKeys(db(), environmentId, made.id, [
      { fieldKey: 'a', valueKey: key(t.id, 'a') },
    ]);
    await replaceCaseFieldKeys(db(), environmentId, made.id, [
      { fieldKey: 'b', valueKey: key(t.id, 'b') },
    ]);
    const count = async () =>
      (
        await rawRows<{ n: string }>(
          sql`select count(*) as n from case_field_keys where case_id = ${made.id}`,
        )
      )[0]?.n;
    expect(Number(await count())).toBe(1);
    await deleteCaseFieldKeys(db(), environmentId, [made.id]);
    await deleteCaseFieldKeys(db(), environmentId, []);
    expect(Number(await count())).toBe(0);
  });
});

describe('notifications (C134.4)', () => {
  it('list a user’s own, unread first-class, mark read once, and expire after their window', async () => {
    const { environmentId, organizationId } = await tenant();
    const t = await seedCaseTemplate(db(), environmentId);
    const made = await seedCase(db(), environmentId, {
      caseTemplateId: t.id,
      caseTemplateVersionId: t.versionId,
      key: t.key,
      number: 1,
    });
    const userId = testId('usr');
    await addUser(organizationId, userId);
    const [assigned, mentioned] = await createUserNotifications(db(), environmentId, [
      { id: testId('unot'), userId, kind: 'assigned', caseId: made.id },
      { id: testId('unot'), userId, kind: 'mentioned', caseId: made.id },
    ]);
    await db().execute(
      sql`update user_notifications set created_at = '2026-01-01' where id = ${assigned?.id ?? ''}`,
    );
    await db().execute(
      sql`update user_notifications set created_at = '2026-10-01' where id = ${mentioned?.id ?? ''}`,
    );
    expect(await createUserNotifications(db(), environmentId, [])).toEqual([]);

    const all = await listUserNotificationRows(db(), environmentId, userId, {}, {});
    expect(all.items.map(({ id }) => id)).toEqual([mentioned?.id, assigned?.id]);
    expect(
      (await listUserNotificationRows(db(), environmentId, testId('usr'), {}, {})).items,
    ).toEqual([]);
    const at = new Date('2026-10-02T00:00:00.000Z');
    const read = await markUserNotificationRead(
      db(),
      environmentId,
      userId,
      mentioned?.id ?? '',
      at,
    );
    expect(read?.readAt).toEqual(at);
    const again = await markUserNotificationRead(
      db(),
      environmentId,
      userId,
      mentioned?.id ?? '',
      new Date(),
    );
    expect(again?.readAt).toEqual(at);
    expect(
      await getUserNotificationRow(db(), environmentId, testId('usr'), mentioned?.id ?? ''),
    ).toBeNull();
    const unread = await listUserNotificationRows(
      db(),
      environmentId,
      userId,
      { unread: true },
      {},
    );
    expect(unread.items.map(({ id }) => id)).toEqual([assigned?.id]);

    expect(
      await deleteExpiredUserNotifications(db(), new Date('2026-06-01T00:00:00.000Z'), 10),
    ).toBe(1);
    expect(
      await deleteExpiredUserNotifications(db(), new Date('2026-06-01T00:00:00.000Z'), 10),
    ).toBe(0);
  });
});

describe('bulk actions (C137.4)', () => {
  it('seal the request, claim once, and keep only the outcomes when done', async () => {
    const { environmentId } = await tenant();
    const id = testId('cblk');
    const creatorId = testId('usr');
    const caseId = testId('case');
    const made = await createCaseBulkActionRow(db(), environmentId, {
      id,
      action: 'add-tags',
      creatorType: 'user',
      creatorId,
      request: { 'case-ids': [caseId], meta: { 'tag-names': ['synthetic-canary-tag'] } },
      requestedCount: 1,
    });
    expect(made).toMatchObject({ status: 'pending', request: { 'case-ids': [caseId] } });
    const raw = await rawRows<{ request: string }>(
      sql`select request from case_bulk_actions where id = ${id}`,
    );
    expect(raw[0]?.request).not.toContain('canary');
    expect(await listUnfinishedCaseBulkActions(db(), new Date(Date.now() + 60_000), 10)).toEqual(
      expect.arrayContaining([{ id, environmentId }]),
    );

    const claimed = await db().transaction((tx) => claimCaseBulkActionRow(tx, environmentId, id));
    expect(claimed?.status).toBe('running');
    const done = await completeCaseBulkActionRow(
      db(),
      environmentId,
      id,
      [{ caseId, outcome: 'refused', code: 'case_redacted' }],
      new Date(),
    );
    expect(done).toMatchObject({
      status: 'completed',
      request: null,
      refusedCount: 1,
      outcomes: [{ caseId, outcome: 'refused', code: 'case_redacted' }],
    });
    expect((await getCaseBulkActionRow(db(), environmentId, id))?.status).toBe('completed');
    expect(
      await db().transaction((tx) => claimCaseBulkActionRow(tx, environmentId, id)),
    ).toBeNull();
    expect(await getCaseBulkActionRow(db(), environmentId, testId('cblk'))).toBeNull();
  });
});

it('the sealed case columns use their seal names', () => {
  expect(SEALED.caseFields).toBe('cases.fields');
});
