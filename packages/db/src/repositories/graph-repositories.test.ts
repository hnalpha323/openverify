/**
 * Workflow 7B Stage 3 (`api-graph`): the graph repositories on PGlite. The attribute rows (C101.1:
 * one per account, value and source; the capped holder count of F24; the moves of C101.3 and
 * C101.4; the deletes of a redaction), the index outbox's sweep and end states (C101.3), the
 * per-kind state (C101.5), components (C101.6), templates and versions as C71 (C102.1), and the
 * queries with their stored results, cancel, rerun and the scrub of a redacted account (C102.4,
 * C102.7). Every value key is random hex; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { createAccount } from './accounts.js';
import {
  advanceGraphBackfill,
  completeGraphIndexStates,
  deleteGraphAttributesOfSource,
  deleteGraphComponent,
  filterGraphAccounts,
  listGraphAttributesPage,
  listGraphBackfillAccounts,
  listGraphBackfillInquiries,
  listGraphEnvironmentIds,
  listGraphValueSources,
  setGraphQueryStart,
  cancelGraphQuery,
  createGraphIndexJob,
  createGraphQuery,
  createGraphQueryTemplate,
  createGraphQueryTemplateVersion,
  deleteAccountGraphAttributes,
  deleteInquiryGraphAttributes,
  endGraphIndexJob,
  getGraphComponent,
  getGraphIndexJob,
  getGraphQuery,
  getGraphQueryTemplate,
  getGraphQueryTemplateVersion,
  listAccountGraphAttributes,
  listCurrentGraphQueryTemplateVersions,
  listGraphAttributesKeyedOtherwise,
  listGraphIndexStates,
  listGraphQueries,
  listGraphQueryTemplates,
  listGraphValueHolders,
  listGraphValueHoldersOf,
  listIncompleteGraphIndexStates,
  listPendingGraphIndexJobs,
  listSubmittedGraphQueries,
  lockGraphQuery,
  lockGraphQueryTemplate,
  markGraphIndexJobsEnqueued,
  markGraphKindsIncomplete,
  markGraphQueriesEnqueued,
  moveAccountGraphAttributes,
  moveInquiryGraphAttributes,
  openGraphQueryParamsOf,
  publishGraphQueryTemplateVersion,
  recordGraphIndexJobAttempt,
  replaceAccountGraphAttributes,
  replaceGraphComponents,
  resubmitGraphQuery,
  scrubAccountFromGraphQueries,
  storeGraphQueryResult,
  updateGraphQueryTemplate,
  updateGraphQueryTemplateVersionDraft,
  upsertGraphAttributes,
  type NewGraphAttribute,
} from './index.js';
import { redactInquiryRecords } from './redaction.js';

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const KEY_ID = 'AbCdEfGh_-1';
const hex = () => randomBytes(32).toString('hex');
const AT = new Date('2026-11-01T10:00:00.000Z');
const LATER = new Date('2026-11-01T11:00:00.000Z');

async function environment() {
  return (await createTestTenant(database.db)).environment.id;
}

async function account(environmentId: string, input: { status?: 'archived' } = {}) {
  const created = await createAccount(database.db, environmentId, { id: testId('acc') });
  if (input.status === 'archived') {
    await database.db.execute(
      sql`update accounts set status = 'archived' where id = ${created.id}`,
    );
  }
  return created.id;
}

const own = (accountId: string, kind: number, valueKey: string): NewGraphAttribute => ({
  kind,
  valueKey,
  keyId: KEY_ID,
  accountId,
  sourceType: 'account',
  sourceId: accountId,
  inquiryId: null,
});

const fromInquiry = (
  accountId: string,
  inquiryId: string,
  kind: number,
  valueKey: string,
): NewGraphAttribute => ({
  kind,
  valueKey,
  keyId: KEY_ID,
  accountId,
  sourceType: 'inquiry',
  sourceId: inquiryId,
  inquiryId,
});

async function attributeRows(environmentId: string) {
  return (
    (await database.db.execute(sql`
      select kind, value_key, account_id, source_type, source_id, inquiry_id, first_seen_at,
        last_seen_at
      from graph_attributes where environment_id = ${environmentId}
      order by kind, value_key, account_id, source_type, source_id`)) as unknown as {
      rows: Record<string, unknown>[];
    }
  ).rows;
}

describe('graph attribute rows (C101.1, C101.3)', () => {
  it('writes one row per account, value and source, and moves last-seen on a repeat', async () => {
    const env = await environment();
    const a = await account(env);
    const value = hex();

    expect(
      await upsertGraphAttributes(database.db, env, [own(a, 4, value), own(a, 4, value)], AT),
    ).toBe(1);
    expect(await upsertGraphAttributes(database.db, env, [own(a, 4, value)], LATER)).toBe(0);

    const [row] = await attributeRows(env);
    expect(row).toMatchObject({ kind: 4, value_key: value, account_id: a, source_type: 'account' });
    expect(new Date(String(row?.first_seen_at))).toEqual(AT);
    expect(new Date(String(row?.last_seen_at))).toEqual(LATER);
  });

  it('replaces an account’s own rows and keeps what came from its inquiries', async () => {
    const env = await environment();
    const { inquiry } = await createTestInquiry(database.db, env);
    const a = inquiry.accountId;
    const [kept, dropped, added, fromIt] = [hex(), hex(), hex(), hex()];
    await upsertGraphAttributes(
      database.db,
      env,
      [own(a, 4, kept), own(a, 5, dropped), fromInquiry(a, inquiry.id, 6, fromIt)],
      AT,
    );

    expect(
      await replaceAccountGraphAttributes(
        database.db,
        env,
        a,
        [own(a, 4, kept), own(a, 8, added)],
        LATER,
      ),
    ).toBe(1);

    expect((await attributeRows(env)).map((row) => row.value_key).sort()).toEqual(
      [kept, added, fromIt].sort(),
    );
  });

  it('reads one hop: the accounts’ rows of the given kinds only, in this environment', async () => {
    const env = await environment();
    const [a, b] = [await account(env), await account(env)];
    const [email, phone, ip] = [hex(), hex(), hex()];
    await upsertGraphAttributes(
      database.db,
      env,
      [own(a, 4, email), own(a, 5, phone), own(b, 14, ip)],
      AT,
    );

    const rows = await listAccountGraphAttributes(database.db, env, {
      accountIds: [a, b],
      kinds: [4, 14],
    });
    expect(rows.map((row) => row.valueKey).sort()).toEqual([email, ip].sort());
    expect(
      await listAccountGraphAttributes(database.db, await environment(), {
        accountIds: [a],
        kinds: [4],
      }),
    ).toEqual([]);
    expect(
      await listAccountGraphAttributes(database.db, env, { accountIds: [], kinds: [4] }),
    ).toEqual([]);
  });

  it('counts a value’s holders up to cap + 1, each account once (F24)', async () => {
    const env = await environment();
    const value = hex();
    const holders: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = await account(env);
      holders.push(id);
      await upsertGraphAttributes(database.db, env, [own(id, 4, value)], AT);
    }
    const { inquiry } = await createTestInquiry(database.db, env);
    await upsertGraphAttributes(
      database.db,
      env,
      [fromInquiry(holders[0] ?? '', inquiry.id, 4, value)],
      AT,
    );

    const capped = await listGraphValueHolders(database.db, env, {
      kind: 4,
      valueKey: value,
      cap: 2,
    });
    expect(capped).toHaveLength(3);
    const all = await listGraphValueHolders(database.db, env, {
      kind: 4,
      valueKey: value,
      cap: 10,
    });
    expect([...all].sort()).toEqual([...holders].sort());

    const batch = await listGraphValueHoldersOf(database.db, env, {
      values: [
        { kind: 4, valueKey: value },
        { kind: 5, valueKey: hex() },
      ],
      cap: 2,
    });
    expect(batch).toEqual([{ kind: 4, valueKey: value, accountIds: expect.any(Array) as unknown }]);
    expect(batch[0]?.accountIds).toHaveLength(3);
  });

  it('moves an inquiry’s rows with it, and a consolidation’s rows to the survivor, one per value and source', async () => {
    const env = await environment();
    const { inquiry } = await createTestInquiry(database.db, env);
    const [from, to, absorbed] = [inquiry.accountId, await account(env), await account(env)];
    const [value, shared] = [hex(), hex()];
    await upsertGraphAttributes(
      database.db,
      env,
      [fromInquiry(from, inquiry.id, 4, value), own(absorbed, 5, shared), own(to, 5, shared)],
      AT,
    );

    expect(
      await moveInquiryGraphAttributes(database.db, env, {
        inquiryIds: [inquiry.id],
        accountId: to,
      }),
    ).toBe(1);
    expect(
      await moveAccountGraphAttributes(database.db, env, { targetId: to, sourceIds: [absorbed] }),
    ).toBe(1);

    const rows = await attributeRows(env);
    expect(rows.map((row) => row.account_id)).toEqual([to, to, to]);
    expect(
      rows
        .filter((row) => row.value_key === shared)
        .map((row) => row.source_id)
        .sort(),
    ).toEqual([absorbed, to].sort());
  });

  it('deletes an inquiry’s rows, and every row of an account', async () => {
    const env = await environment();
    const { inquiry } = await createTestInquiry(database.db, env);
    const a = inquiry.accountId;
    await upsertGraphAttributes(
      database.db,
      env,
      [fromInquiry(a, inquiry.id, 4, hex()), own(a, 5, hex())],
      AT,
    );

    expect(await deleteInquiryGraphAttributes(database.db, env, inquiry.id)).toBe(1);
    expect((await attributeRows(env)).map((row) => row.source_type)).toEqual(['account']);
    expect(await deleteAccountGraphAttributes(database.db, env, a)).toBe(1);
    expect(await attributeRows(env)).toEqual([]);
  });

  it('pages the rows made under another key id (blind-index:rebuild)', async () => {
    const env = await environment();
    const a = await account(env);
    await upsertGraphAttributes(
      database.db,
      env,
      [own(a, 4, hex()), { ...own(a, 5, hex()), keyId: 'ZZZZZZZZZZZ' }],
      AT,
    );

    const rows = await listGraphAttributesKeyedOtherwise(database.db, {
      keyId: KEY_ID,
      limit: 1000,
    });
    expect(rows.filter((row) => row.environmentId === env).map((row) => row.kind)).toEqual([5]);
  });
});

describe('the graph index outbox (C101.3)', () => {
  it('sweeps pending rows not enqueued lately, oldest first, saying which inquiry is redacted', async () => {
    const env = await environment();
    const { inquiry: first } = await createTestInquiry(database.db, env);
    const { inquiry: second } = await createTestInquiry(database.db, env);
    await createGraphIndexJob(database.db, env, {
      inquiryId: first.id,
      triggerStatus: 'completed',
    });
    await createGraphIndexJob(database.db, env, { inquiryId: second.id, triggerStatus: 'failed' });
    await redactInquiryRecords(database.db, env, second.id);
    const now = new Date(Date.now() + 60_000);

    const pending = (
      await listPendingGraphIndexJobs(database.db, { olderThan: now, limit: 1000 })
    ).filter((job) => job.environmentId === env);
    expect(pending).toEqual([
      { environmentId: env, inquiryId: first.id, inquiryRedacted: false },
      { environmentId: env, inquiryId: second.id, inquiryRedacted: true },
    ]);

    await markGraphIndexJobsEnqueued(
      database.db,
      [{ environmentId: env, inquiryId: first.id }],
      now,
    );
    const later = (
      await listPendingGraphIndexJobs(database.db, {
        olderThan: new Date(now.getTime() - 1),
        limit: 1000,
      })
    ).filter((job) => job.environmentId === env);
    expect(later.map((job) => job.inquiryId)).toEqual([second.id]);
  });

  it('counts attempts and ends a pending row once, with a code', async () => {
    const env = await environment();
    const { inquiry } = await createTestInquiry(database.db, env);
    await createGraphIndexJob(database.db, env, {
      inquiryId: inquiry.id,
      triggerStatus: 'expired',
    });

    expect(await recordGraphIndexJobAttempt(database.db, env, inquiry.id)).toBe(1);
    expect(await recordGraphIndexJobAttempt(database.db, env, inquiry.id)).toBe(2);
    expect(
      await endGraphIndexJob(database.db, env, inquiry.id, {
        status: 'skipped',
        code: 'graph_indexing_off',
        at: AT,
      }),
    ).toBe(true);
    expect(
      await endGraphIndexJob(database.db, env, inquiry.id, { status: 'completed', at: LATER }),
    ).toBe(false);
    expect(await getGraphIndexJob(database.db, env, inquiry.id)).toMatchObject({
      status: 'skipped',
      lastErrorCode: 'graph_indexing_off',
      attempts: 2,
      indexedAt: AT,
    });
  });
});

describe('the per-kind index state (C101.5)', () => {
  it('marks kinds incomplete from a time, lists them, and advances a backfill to complete', async () => {
    const env = await environment();
    await markGraphKindsIncomplete(database.db, env, [4, 13], AT);
    await advanceGraphBackfill(database.db, env, 4, {
      cursor: { after: 'acc_x' },
      complete: false,
      at: AT,
    });

    const incomplete = (await listIncompleteGraphIndexStates(database.db, { limit: 1000 })).filter(
      (row) => row.environmentId === env,
    );
    expect(incomplete.map(({ kind, backfillCursor }) => ({ kind, backfillCursor }))).toEqual([
      { kind: 4, backfillCursor: { after: 'acc_x' } },
      { kind: 13, backfillCursor: null },
    ]);

    await advanceGraphBackfill(database.db, env, 4, { cursor: null, complete: true, at: LATER });
    await markGraphKindsIncomplete(database.db, env, [13], LATER);
    const states = await listGraphIndexStates(database.db, env);
    expect(
      states.map(({ kind, complete, completedAt, indexedSince }) => ({
        kind,
        complete,
        completedAt,
        indexedSince,
      })),
    ).toEqual([
      { kind: 4, complete: true, completedAt: LATER, indexedSince: AT },
      { kind: 13, complete: false, completedAt: null, indexedSince: LATER },
    ]);
  });
});

describe('graph components (C101.6)', () => {
  it('replaces the environment’s components with one run’s, and reads an account’s', async () => {
    const env = await environment();
    const [a, b, c] = [await account(env), await account(env), await account(env)];
    await replaceGraphComponents(
      database.db,
      env,
      [{ accountId: c, componentId: 'old', size: 1 }],
      AT,
    );

    expect(
      await replaceGraphComponents(
        database.db,
        env,
        [
          { accountId: a, componentId: 'c1', size: 2 },
          { accountId: b, componentId: 'c1', size: 2 },
        ],
        LATER,
      ),
    ).toBe(2);

    expect(await getGraphComponent(database.db, env, a)).toMatchObject({
      componentId: 'c1',
      size: 2,
      computedAt: LATER,
    });
    expect(await getGraphComponent(database.db, env, c)).toBeNull();
  });
});

const CONFIG = {
  parameters: [{ name: 'email', kind: 'email_address' }],
  start: [{ kind: 'email_address', value: '{{email}}' }],
  'connect-kinds': ['email_address'],
};

describe('graph query templates and versions (C102.1, as C71)', () => {
  it('creates a template with its draft, publishes under the lock and supersedes', async () => {
    const env = await environment();
    const template = await createGraphQueryTemplate(database.db, env, {
      id: testId('grqt'),
      name: 'Shared email',
      version: { id: testId('grqtv'), config: CONFIG },
    });
    const [first] = [
      ...(await listCurrentGraphQueryTemplateVersions(database.db, env, [template.id])).values(),
    ];
    expect(first?.latest).toMatchObject({ version: 1, status: 'draft' });
    expect(first?.published).toBeNull();

    const draftId = first?.latest.id ?? '';
    expect(
      await updateGraphQueryTemplateVersionDraft(database.db, env, draftId, {
        ...CONFIG,
        'max-hops': 2,
      }),
    ).toMatchObject({ config: { 'max-hops': 2 } });
    expect(await publishGraphQueryTemplateVersion(database.db, env, draftId, AT)).toMatchObject({
      status: 'published',
      publishedAt: AT,
    });
    expect(await publishGraphQueryTemplateVersion(database.db, env, draftId, AT)).toBeNull();
    expect(
      await updateGraphQueryTemplateVersionDraft(database.db, env, draftId, CONFIG),
    ).toBeNull();

    const second = await createGraphQueryTemplateVersion(database.db, env, {
      id: testId('grqtv'),
      graphQueryTemplateId: template.id,
      config: CONFIG,
    });
    expect(second.version).toBe(2);
    await publishGraphQueryTemplateVersion(database.db, env, second.id, LATER);
    expect(await getGraphQueryTemplateVersion(database.db, env, draftId)).toMatchObject({
      status: 'superseded',
    });
    const current = (
      await listCurrentGraphQueryTemplateVersions(database.db, env, [template.id])
    ).get(template.id);
    expect(current?.published?.id).toBe(second.id);
    expect(current?.latest.id).toBe(second.id);
  });

  it('renames and archives, locks, and lists newest first with a status filter', async () => {
    const env = await environment();
    const clock = createdAtClock(database.db);
    onTestFinished(wallClockStepsBack());
    const ids: string[] = [];
    for (const name of ['One', 'Two', 'Three']) {
      const created = await createGraphQueryTemplate(database.db, env, {
        id: testId('grqt'),
        name,
        version: { id: testId('grqtv'), config: CONFIG },
      });
      await clock.at('graph_query_templates', created.id);
      ids.push(created.id);
    }
    expect(
      await updateGraphQueryTemplate(database.db, env, ids[0] ?? '', {
        status: 'archived',
        name: 'Old',
      }),
    ).toMatchObject({ status: 'archived', name: 'Old' });
    expect(await lockGraphQueryTemplate(database.db, env, ids[1] ?? '')).toMatchObject({
      id: ids[1],
    });
    expect(await getGraphQueryTemplate(database.db, await environment(), ids[1] ?? '')).toBeNull();

    const page = await listGraphQueryTemplates(database.db, env, {}, { size: 2 });
    expect(page.items.map(({ id }) => id)).toEqual([ids[2], ids[1]]);
    const rest = await listGraphQueryTemplates(database.db, env, {}, { after: page.next ?? '' });
    expect(rest.items.map(({ id }) => id)).toEqual([ids[0]]);
    const active = await listGraphQueryTemplates(database.db, env, { statuses: ['active'] }, {});
    expect(active.items.map(({ id }) => id)).toEqual([ids[2], ids[1]]);
  });
});

async function publishedTemplate(env: string) {
  const template = await createGraphQueryTemplate(database.db, env, {
    id: testId('grqt'),
    name: 'Shared email',
    version: { id: testId('grqtv'), config: CONFIG },
  });
  const versions = await listCurrentGraphQueryTemplateVersions(database.db, env, [template.id]);
  const version = versions.get(template.id)?.latest;
  await publishGraphQueryTemplateVersion(database.db, env, version?.id ?? '', AT);
  return { templateId: template.id, versionId: version?.id ?? '' };
}

async function submitted(env: string, input: { templateId: string; versionId: string }) {
  return createGraphQuery(database.db, env, {
    id: testId('grphq'),
    graphQueryTemplateId: input.templateId,
    graphQueryTemplateVersionId: input.versionId,
    params: { email: 'synthetic@example.com' },
    timeoutSeconds: 30,
    runSync: false,
  });
}

describe('graph queries and their stored results (C102.4)', () => {
  it('seals the params, stores one result on a submitted query, and lists newest first', async () => {
    const env = await environment();
    const template = await publishedTemplate(env);
    const clock = createdAtClock(database.db);
    onTestFinished(wallClockStepsBack());
    const query = await submitted(env, template);
    await clock.at('graph_queries', query.id);
    const other = await submitted(env, template);
    await clock.at('graph_queries', other.id);

    const stored = (await database.db.execute(
      sql`select params from graph_queries where id = ${query.id}`,
    )) as unknown as { rows: { params: string }[] };
    expect(stored.rows[0]?.params).not.toContain('synthetic');
    expect(openGraphQueryParamsOf(query)).toEqual({ email: 'synthetic@example.com' });

    const a = await account(env);
    const result = await storeGraphQueryResult(database.db, env, query.id, {
      status: 'completed',
      nodes: [{ type: 'account', value: a }],
      links: [],
      nodeMap: {},
      accountIds: [a],
      kindsNotIndexed: [13],
      skippedHubValues: 2,
      nodeLimitReached: true,
      at: LATER,
    });
    expect(result).toMatchObject({
      status: 'completed',
      completedAt: LATER,
      accountIds: [a],
      kindsNotIndexed: [13],
      skippedHubValues: 2,
      nodeLimitReached: true,
    });
    expect(
      await storeGraphQueryResult(database.db, env, query.id, {
        status: 'timed_out',
        nodes: [],
        links: [],
        nodeMap: {},
        accountIds: [],
        kindsNotIndexed: [],
        skippedHubValues: 0,
        nodeLimitReached: false,
        at: LATER,
      }),
    ).toBeNull();

    const page = await listGraphQueries(database.db, env, {}, {});
    expect(page.items.map(({ id }) => id)).toEqual([other.id, query.id]);
    const completed = await listGraphQueries(database.db, env, { statuses: ['completed'] }, {});
    expect(completed.items.map(({ id }) => id)).toEqual([query.id]);
    expect(await getGraphQuery(database.db, await environment(), query.id)).toBeNull();
  });

  it('stores an errored run with its code and time', async () => {
    const env = await environment();
    const query = await submitted(env, await publishedTemplate(env));

    expect(
      await storeGraphQueryResult(database.db, env, query.id, {
        status: 'errored',
        nodes: [],
        links: [],
        nodeMap: {},
        accountIds: [],
        kindsNotIndexed: [],
        skippedHubValues: 0,
        nodeLimitReached: false,
        lastErrorCode: 'graph_query_failed',
        at: AT,
      }),
    ).toMatchObject({ status: 'errored', erroredAt: AT, lastErrorCode: 'graph_query_failed' });
  });

  it('cancels a submitted query only, and a rerun empties the result back to submitted', async () => {
    const env = await environment();
    const template = await publishedTemplate(env);
    const query = await submitted(env, template);

    expect(await lockGraphQuery(database.db, env, query.id)).toMatchObject({ id: query.id });
    expect(await cancelGraphQuery(database.db, env, query.id, AT)).toMatchObject({
      status: 'cancelled',
    });
    expect(await cancelGraphQuery(database.db, env, query.id, AT)).toBeNull();

    const rerun = await resubmitGraphQuery(database.db, env, query.id, LATER);
    expect(rerun).toMatchObject({
      status: 'submitted',
      nodes: [],
      accountIds: [],
      completedAt: null,
      enqueuedAt: null,
    });
  });

  it('sweeps submitted queries not enqueued lately', async () => {
    const env = await environment();
    const query = await submitted(env, await publishedTemplate(env));
    const now = new Date(Date.now() + 60_000);

    const due = (
      await listSubmittedGraphQueries(database.db, { olderThan: now, limit: 1000 })
    ).filter((row) => row.environmentId === env);
    expect(due).toEqual([{ environmentId: env, graphQueryId: query.id }]);
    await markGraphQueriesEnqueued(database.db, due, now);
    expect(
      (
        await listSubmittedGraphQueries(database.db, {
          olderThan: new Date(now.getTime() - 1),
          limit: 1000,
        })
      ).filter((row) => row.environmentId === env),
    ).toEqual([]);
  });

  it('scrubs a redacted account, its links and the values only it held from every stored result', async () => {
    const env = await environment();
    const template = await publishedTemplate(env);
    const [a, b] = [await account(env), await account(env)];
    const query = await submitted(env, template);
    const [shared, onlyB] = ['gn_AAAAAAAAAAAAAAAAAAAAAA', 'gn_BBBBBBBBBBBBBBBBBBBBBB'];
    await storeGraphQueryResult(database.db, env, query.id, {
      status: 'completed',
      nodes: [
        { type: 'account', value: a },
        { type: 'account', value: b },
        { type: 'email_address', value: shared },
        { type: 'phone_number', value: onlyB },
      ],
      links: [
        { from: a, to: shared, kind: 'email_address' },
        { from: b, to: shared, kind: 'email_address' },
        { from: b, to: onlyB, kind: 'phone_number' },
      ],
      nodeMap: {
        [shared]: { kind: 4, valueKey: hex() },
        [onlyB]: { kind: 5, valueKey: hex() },
      },
      accountIds: [a, b],
      kindsNotIndexed: [],
      skippedHubValues: 0,
      nodeLimitReached: false,
      at: AT,
    });
    const untouched = await submitted(env, template);

    expect(await scrubAccountFromGraphQueries(database.db, env, b)).toEqual([query.id]);

    const after = await getGraphQuery(database.db, env, query.id);
    expect(after?.accountIds).toEqual([a]);
    expect(after?.nodes).toEqual([
      { type: 'account', value: a },
      { type: 'email_address', value: shared },
    ]);
    expect(after?.links).toEqual([{ from: a, to: shared, kind: 'email_address' }]);
    expect(Object.keys(after?.nodeMap ?? {})).toEqual([shared]);
    expect(JSON.stringify(after)).not.toContain(b);
    expect((await getGraphQuery(database.db, env, untouched.id))?.accountIds).toEqual([]);
  });
});

describe('the reads the indexer, the backfill, the engine and the unmask add (C101-C103)', () => {
  it('walks an environment’s accounts and ended inquiries by id, the redacted and absorbed left out', async () => {
    const env = await environment();
    const [a, b] = [await account(env), await account(env)];
    const { inquiry: open } = await createTestInquiry(database.db, env);
    const { inquiry: ended } = await createTestInquiry(database.db, env);
    await database.db.execute(sql`update inquiries set status = 'failed' where id = ${ended.id}`);
    await database.db.execute(sql`update accounts set redacted_at = now() where id = ${b}`);

    const accounts = await listGraphBackfillAccounts(database.db, env, { after: null, limit: 100 });
    expect(accounts).toContain(a);
    expect(accounts).not.toContain(b);
    expect(accounts).toEqual([...accounts].sort());
    const after = await listGraphBackfillAccounts(database.db, env, {
      after: accounts[0] ?? null,
      limit: 100,
    });
    expect(after).toEqual(accounts.slice(1));
    expect(await listGraphBackfillInquiries(database.db, env, { after: null, limit: 100 })).toEqual(
      [ended.id],
    );
    expect(open.status).toBe('created');
    expect(await listGraphEnvironmentIds(database.db)).toContain(env);
  });

  it('completes every incomplete kind of an environment at once', async () => {
    const env = await environment();
    await markGraphKindsIncomplete(database.db, env, [4, 5], AT);

    await completeGraphIndexStates(database.db, env, LATER);

    expect((await listGraphIndexStates(database.db, env)).map(({ complete }) => complete)).toEqual([
      true,
      true,
    ]);
  });

  it('pages the rows of some kinds in key order, and deletes one source’s rows and a component', async () => {
    const env = await environment();
    const [a, b] = [await account(env), await account(env)];
    const shared = hex();
    await upsertGraphAttributes(
      database.db,
      env,
      [own(a, 4, shared), own(b, 4, shared), own(a, 14, hex())],
      AT,
    );
    await replaceGraphComponents(
      database.db,
      env,
      [{ accountId: a, componentId: 'c1', size: 2 }],
      AT,
    );

    const first = await listGraphAttributesPage(database.db, env, {
      kinds: [4],
      after: null,
      limit: 1,
    });
    const rest = await listGraphAttributesPage(database.db, env, {
      kinds: [4],
      after: first[0] ?? null,
      limit: 10,
    });
    expect([...first, ...rest].map(({ accountId }) => accountId).sort()).toEqual([a, b].sort());
    expect(
      await listGraphAttributesPage(database.db, env, { kinds: [], after: null, limit: 1 }),
    ).toEqual([]);

    expect(
      await deleteGraphAttributesOfSource(database.db, env, {
        accountId: a,
        sourceType: 'account',
        sourceId: a,
      }),
    ).toBe(2);
    expect(await deleteGraphComponent(database.db, env, a)).toBe(1);
    expect(await getGraphComponent(database.db, env, a)).toBeNull();
  });

  it('keeps the accounts a template’s filters allow, and finds a value’s sources among a result', async () => {
    const env = await environment();
    const tagged = await createAccount(database.db, env, { id: testId('acc'), tags: ['Ring'] });
    const plain = await account(env);
    const archived = await account(env, { status: 'archived' });
    const all = [tagged.id, plain, archived];

    expect((await filterGraphAccounts(database.db, env, all, {})).sort()).toEqual([...all].sort());
    expect(await filterGraphAccounts(database.db, env, all, { tags: ['ring'] })).toEqual([
      tagged.id,
    ]);
    expect(await filterGraphAccounts(database.db, env, all, { statuses: ['archived'] })).toEqual([
      archived,
    ]);
    expect(
      await filterGraphAccounts(database.db, env, all, {
        accountTypeIds: [tagged.accountTypeId],
        createdAtStart: new Date(Date.now() - 3_600_000),
        createdAtEnd: new Date(Date.now() + 3_600_000),
      }),
    ).toHaveLength(3);
    expect(await filterGraphAccounts(database.db, env, [], {})).toEqual([]);

    const value = hex();
    await upsertGraphAttributes(database.db, env, [own(plain, 4, value)], AT);
    expect(
      (
        await listGraphValueSources(database.db, env, {
          kind: 4,
          valueKey: value,
          accountIds: [plain],
        })
      ).map(({ sourceId }) => sourceId),
    ).toEqual([plain]);
    expect(
      await listGraphValueSources(database.db, env, { kind: 4, valueKey: value, accountIds: [] }),
    ).toEqual([]);
  });

  it('writes a submitted query’s bound start into its node map', async () => {
    const env = await environment();
    const query = await submitted(env, await publishedTemplate(env));

    expect(
      await setGraphQueryStart(database.db, env, query.id, { gn_x: { start: true } }),
    ).toMatchObject({ nodeMap: { gn_x: { start: true } } });
    await cancelGraphQuery(database.db, env, query.id, AT);
    expect(await setGraphQueryStart(database.db, env, query.id, {})).toBeNull();
  });
});
