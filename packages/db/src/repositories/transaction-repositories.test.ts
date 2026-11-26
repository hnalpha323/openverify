/**
 * Workflow 7B Stage 3 (`api-transactions`; C104.1, C105): the transaction repositories built over
 * the Stage 1b tables: types and versions as C71 keeps a template, transactions with sealed fields,
 * the append-only history and labels, objects and relations, the searchable field keys and the
 * files. Order is asserted only on what the code orders by (C1's `created_at DESC, id DESC`), on
 * rows stamped by `createdAtClock`. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { InvalidCursorError } from '../errors.js';
import {
  createdAtClock,
  seedReport,
  seedReportTemplate,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { createAccount } from './accounts.js';
import { createFile } from './files.js';
import { createFaceTemplate, createSelfieBackground } from './selfie-captures.js';
import { createVerification } from './verifications.js';
import {
  addTransactionLabel,
  addTransactionObjects,
  addTransactionRelation,
  appendTransactionStatus,
  archiveTransactionType,
  createTransaction,
  createTransactionFile,
  createTransactionType,
  createTransactionTypeVersion,
  getTransaction,
  getTransactionFile,
  getTransactionType,
  getTransactionTypeVersion,
  latestTransactionLabels,
  latestTransactionsOfObjects,
  listCurrentTransactionTypeVersions,
  listTransactionFiles,
  listTransactionLabels,
  listTransactionObjects,
  listTransactionRelations,
  listTransactionRelationsPage,
  listTransactionStatusHistory,
  listTransactionTypes,
  listTransactions,
  listTransactionsForRebuild,
  listTransactionFieldKeys,
  listTransactionRelatedObjects,
  listTransactionFilterLinks,
  listAccountTransactions,
  listTransactionBiometricScope,
  redactTransactionBiometricRows,
  lockTransaction,
  publishTransactionTypeVersion,
  redactTransactionRecords,
  removeTransactionObjects,
  removeTransactionRelation,
  renameTransactionType,
  replaceTransactionFieldKeys,
  updateTransaction,
  updateTransactionTypeVersionDraft,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const db = () => database.db;
const STATUSES = ['created', 'approved', 'declined', 'needs review'];
const FIELD = { type: 'string', key: 'iban', label: 'IBAN' };

async function environment() {
  const { environment: env } = await createTestTenant(db());
  return env.id;
}

async function publishedType(environmentId: string, fieldSchemas: unknown[] = [FIELD]) {
  const type = await createTransactionType(db(), environmentId, {
    id: testId('txntp'),
    name: 'Synthetic payout',
  });
  const version = await createTransactionTypeVersion(db(), environmentId, {
    id: testId('txntpv'),
    transactionTypeId: type.id,
    version: 1,
    fieldSchemas,
    statuses: STATUSES,
    relationSchemas: [],
    allowCardLikeStrings: false,
  });
  const published = await publishTransactionTypeVersion(
    db(),
    environmentId,
    version.id,
    new Date(),
  );
  return { type, version: published?.published ?? version };
}

async function transaction(
  environmentId: string,
  typeId: string,
  versionId: string,
  input: { referenceId?: string | null; status?: string; tags?: string[] } = {},
) {
  return createTransaction(db(), environmentId, {
    id: testId('txn'),
    transactionTypeId: typeId,
    transactionTypeVersionId: versionId,
    referenceId: input.referenceId ?? null,
    status: input.status ?? 'created',
    fields: { iban: { type: 'string', value: 'synthetic-iban' } },
    tags: input.tags ?? [],
  });
}

describe('transaction types (C104.1)', () => {
  it('creates, reads, renames and archives a type, archive twice changing nothing', async () => {
    const environmentId = await environment();
    const created = await createTransactionType(db(), environmentId, {
      id: testId('txntp'),
      name: 'Synthetic payout',
    });

    expect(created.status).toBe('active');
    expect(await getTransactionType(db(), environmentId, created.id)).toMatchObject({
      name: 'Synthetic payout',
    });
    expect(await getTransactionType(db(), await environment(), created.id)).toBeNull();
    expect(
      (await renameTransactionType(db(), environmentId, created.id, 'Synthetic refund'))?.name,
    ).toBe('Synthetic refund');
    const archived = await archiveTransactionType(db(), environmentId, created.id);
    expect(archived?.status).toBe('archived');
    expect((await archiveTransactionType(db(), environmentId, created.id))?.status).toBe(
      'archived',
    );
    expect(await renameTransactionType(db(), environmentId, testId('txntp'), 'x')).toBeNull();
  });

  it('lists newest first by created_at then id, filtered by status', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await environment();
    const clock = createdAtClock(db());
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const type = await createTransactionType(db(), environmentId, {
        id: testId('txntp'),
        name: `Synthetic ${String(index)}`,
      });
      await clock.at('transaction_types', type.id);
      ids.push(type.id);
    }
    await archiveTransactionType(db(), environmentId, ids[0] ?? '');

    const first = await listTransactionTypes(db(), environmentId, {}, { size: 2 });
    expect(first.items.map((type) => type.id)).toEqual([ids[2], ids[1]]);
    const second = await listTransactionTypes(
      db(),
      environmentId,
      {},
      { size: 2, after: first.next ?? '' },
    );
    expect(second.items.map((type) => type.id)).toEqual([ids[0]]);
    expect(second.next).toBeNull();
    const archived = await listTransactionTypes(
      db(),
      environmentId,
      { statuses: ['archived'] },
      {},
    );
    expect(archived.items.map((type) => type.id)).toEqual([ids[0]]);
  });
});

describe('transaction type versions (C104.1, as C71)', () => {
  it('changes a draft only, and publishes it superseding the published version', async () => {
    const environmentId = await environment();
    const { type, version: first } = await publishedType(environmentId);
    expect(first.status).toBe('published');
    expect(first.publishedAt).toBeInstanceOf(Date);

    expect(
      await updateTransactionTypeVersionDraft(db(), environmentId, first.id, {
        statuses: STATUSES,
      }),
    ).toBeNull();
    const draft = await createTransactionTypeVersion(db(), environmentId, {
      id: testId('txntpv'),
      transactionTypeId: type.id,
      version: 2,
      fieldSchemas: [FIELD],
      statuses: STATUSES,
      relationSchemas: [],
      allowCardLikeStrings: false,
    });
    expect(draft.status).toBe('draft');
    const updated = await updateTransactionTypeVersionDraft(db(), environmentId, draft.id, {
      fieldSchemas: [],
      allowCardLikeStrings: true,
    });
    expect(updated).toMatchObject({ fieldSchemas: [], allowCardLikeStrings: true });

    const at = new Date('2026-11-01T10:00:00.000Z');
    const published = await publishTransactionTypeVersion(db(), environmentId, draft.id, at);
    expect(published?.published).toMatchObject({ id: draft.id, status: 'published' });
    expect(published?.published.publishedAt?.toISOString()).toBe(at.toISOString());
    expect(published?.superseded).toMatchObject({ id: first.id, status: 'superseded' });
    expect(await publishTransactionTypeVersion(db(), environmentId, draft.id, at)).toBeNull();
    expect(await getTransactionTypeVersion(db(), environmentId, first.id)).toMatchObject({
      status: 'superseded',
    });
  });

  it('reads the latest and the published version of each type', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const draft = await createTransactionTypeVersion(db(), environmentId, {
      id: testId('txntpv'),
      transactionTypeId: type.id,
      version: 2,
      fieldSchemas: [],
      statuses: STATUSES,
      relationSchemas: [],
      allowCardLikeStrings: false,
    });
    const bare = await createTransactionType(db(), environmentId, {
      id: testId('txntp'),
      name: 'Bare',
    });

    const current = await listCurrentTransactionTypeVersions(db(), environmentId, [
      type.id,
      bare.id,
    ]);

    expect(current.get(type.id)?.latest?.id).toBe(draft.id);
    expect(current.get(type.id)?.published?.id).toBe(version.id);
    expect(current.get(bare.id)).toEqual({ latest: null, published: null });
  });
});

describe('transactions (C105.1, C105.2)', () => {
  it('writes the fields sealed and reads them back, in this environment only', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id, {
      referenceId: 'synthetic-reference',
      tags: ['Synthetic'],
    });

    expect(created.fields).toEqual({ iban: { type: 'string', value: 'synthetic-iban' } });
    const raw = await db().execute(sql`select fields from transactions where id = ${created.id}`);
    expect(JSON.stringify(raw)).not.toContain('synthetic-iban');
    expect(await getTransaction(db(), environmentId, created.id)).toMatchObject({
      referenceId: 'synthetic-reference',
      tags: ['Synthetic'],
      status: 'created',
    });
    expect(await getTransaction(db(), await environment(), created.id)).toBeNull();
    expect(await lockTransaction(db(), environmentId, created.id)).toMatchObject({
      id: created.id,
    });
  });

  it('changes the fields, the status, the reference and the tags', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);

    const updated = await updateTransaction(db(), environmentId, created.id, {
      fields: { iban: { type: 'string', value: 'synthetic-other' } },
      status: 'approved',
      referenceId: 'synthetic-reference',
      tags: ['a', 'b'],
    });

    expect(updated).toMatchObject({
      status: 'approved',
      referenceId: 'synthetic-reference',
      tags: ['a', 'b'],
      fields: { iban: { type: 'string', value: 'synthetic-other' } },
    });
    expect(await updateTransaction(db(), environmentId, testId('txn'), { status: 'x' })).toBeNull();
  });

  it('lists newest first with every filter, the identifier through the field keys', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const other = await publishedType(environmentId);
    const clock = createdAtClock(db());
    const a = await transaction(environmentId, type.id, version.id, { referenceId: 'ref-a' });
    await clock.at('transactions', a.id);
    const b = await transaction(environmentId, type.id, version.id, { status: 'approved' });
    await clock.at('transactions', b.id);
    const c = await transaction(environmentId, other.type.id, other.version.id, {
      referenceId: 'ref-a',
    });
    const cAt = await clock.at('transactions', c.id);
    await replaceTransactionFieldKeys(
      db(),
      environmentId,
      b.id,
      ['iban'],
      [{ fieldKey: 'iban', valueKey: 'a'.repeat(64) }],
    );

    const ids = async (filters: Parameters<typeof listTransactions>[2]) =>
      (await listTransactions(db(), environmentId, filters, {})).items.map((row) => row.id);

    expect(await ids({})).toEqual([c.id, b.id, a.id]);
    expect(await ids({ referenceId: 'ref-a' })).toEqual([c.id, a.id]);
    expect(await ids({ transactionTypeIds: [type.id] })).toEqual([b.id, a.id]);
    expect(await ids({ statuses: ['approved'] })).toEqual([b.id]);
    expect(await ids({ transactionTypeIds: [] })).toEqual([]);
    expect(await ids({ identifier: { fieldKey: 'iban', valueKey: 'a'.repeat(64) } })).toEqual([
      b.id,
    ]);
    expect(await ids({ identifier: { fieldKey: 'iban', valueKey: 'b'.repeat(64) } })).toEqual([]);
    expect(await ids({ createdAtStart: cAt })).toEqual([c.id]);
    expect(await ids({ createdAtEnd: cAt })).toEqual([b.id, a.id]);
  });

  it('replaces only the named fields’ keys', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);
    await replaceTransactionFieldKeys(
      db(),
      environmentId,
      created.id,
      ['iban', 'other'],
      [
        { fieldKey: 'iban', valueKey: 'a'.repeat(64) },
        { fieldKey: 'other', valueKey: 'b'.repeat(64) },
      ],
    );
    await replaceTransactionFieldKeys(
      db(),
      environmentId,
      created.id,
      ['iban'],
      [{ fieldKey: 'iban', valueKey: 'c'.repeat(64) }],
    );

    expect(await listTransactionFieldKeys(db(), environmentId, created.id)).toEqual([
      { fieldKey: 'iban', valueKey: 'c'.repeat(64) },
      { fieldKey: 'other', valueKey: 'b'.repeat(64) },
    ]);
  });

  it('pages the unredacted transactions with their pinned field schemas for the rebuild', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId, [
      { ...FIELD, config: { searchable: true } },
    ]);
    const kept = await transaction(environmentId, type.id, version.id);
    const gone = await transaction(environmentId, type.id, version.id);
    await redactTransactionRecords(db(), environmentId, gone.id, {});

    const rows = [];
    let afterId: string | null = null;
    for (;;) {
      const page = await listTransactionsForRebuild(db(), { afterId, limit: 1 });
      rows.push(...page);
      if (page.length < 1) {
        break;
      }
      afterId = page.at(-1)?.id ?? null;
    }
    const mine = rows.filter((row) => row.environmentId === environmentId);

    expect(mine.map((row) => row.id)).toEqual([kept.id]);
    expect(mine[0]).toMatchObject({
      fields: { iban: { type: 'string', value: 'synthetic-iban' } },
      fieldSchemas: [{ ...FIELD, config: { searchable: true } }],
    });
  });
});

describe('the history and the labels (C105.2, C105.4)', () => {
  it('appends status moves and lists them newest first', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);
    const clock = createdAtClock(db());
    const first = await appendTransactionStatus(db(), environmentId, {
      transactionId: created.id,
      fromStatus: null,
      toStatus: 'created',
      actorType: 'system',
      actorId: null,
    });
    await clock.at('transaction_status_history', first.id);
    const second = await appendTransactionStatus(db(), environmentId, {
      transactionId: created.id,
      fromStatus: 'created',
      toStatus: 'approved',
      actorType: 'api_key',
      actorId: testId('key'),
    });
    await clock.at('transaction_status_history', second.id);

    const history = await listTransactionStatusHistory(db(), environmentId, created.id);
    expect(history.items.map((row) => row.toStatus)).toEqual(['approved', 'created']);
  });

  it('serves the latest unredacted label of each transaction', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);
    const bare = await transaction(environmentId, type.id, version.id);
    const clock = createdAtClock(db());
    const older = await addTransactionLabel(db(), environmentId, {
      id: testId('txnl'),
      transactionId: created.id,
      label: 'legit',
      modelVersion: null,
      score: null,
    });
    await clock.at('transaction_labels', older.id);
    const newer = await addTransactionLabel(db(), environmentId, {
      id: testId('txnl'),
      transactionId: created.id,
      label: 'fraud',
      modelVersion: 'synthetic-model',
      score: 0.9,
    });
    await clock.at('transaction_labels', newer.id);

    const latest = await latestTransactionLabels(db(), environmentId, [created.id, bare.id]);
    expect(latest.get(created.id)?.id).toBe(newer.id);
    expect(latest.has(bare.id)).toBe(false);
    expect(
      (await listTransactionLabels(db(), environmentId, created.id)).items.map((row) => row.id),
    ).toEqual([newer.id, older.id]);

    await redactTransactionRecords(db(), environmentId, created.id, {});
    expect((await latestTransactionLabels(db(), environmentId, [created.id])).size).toBe(0);
    expect((await listTransactionLabels(db(), environmentId, created.id)).items).toEqual([]);
  });
});

describe('objects and relations (C105.2, C105.7)', () => {
  it('attaches and detaches objects idempotently, and reads the latest transaction of each', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const { inquiry } = await createTestInquiry(db(), environmentId);
    const lone = await createTestInquiry(db(), environmentId);
    const first = await transaction(environmentId, type.id, version.id);
    const second = await transaction(environmentId, type.id, version.id);

    expect(await addTransactionObjects(db(), environmentId, first.id, [inquiry.id])).toEqual([
      inquiry.id,
    ]);
    await db().execute(
      sql`update transaction_objects set created_at = now() - interval '1 hour'
          where transaction_id = ${first.id}`,
    );
    expect(await addTransactionObjects(db(), environmentId, first.id, [inquiry.id])).toEqual([]);
    await addTransactionObjects(db(), environmentId, second.id, [inquiry.id]);

    const latest = await latestTransactionsOfObjects(db(), environmentId, [
      inquiry.id,
      lone.inquiry.id,
    ]);
    expect(latest.get(inquiry.id)).toBe(second.id);
    expect(latest.has(lone.inquiry.id)).toBe(false);
    expect(
      (await listTransactionObjects(db(), environmentId, [first.id]))
        .get(first.id)
        ?.map((row) => row.objectId),
    ).toEqual([inquiry.id]);

    expect(await removeTransactionObjects(db(), environmentId, second.id, [inquiry.id])).toEqual([
      inquiry.id,
    ]);
    expect(await removeTransactionObjects(db(), environmentId, second.id, [inquiry.id])).toEqual(
      [],
    );
    expect(
      (await latestTransactionsOfObjects(db(), environmentId, [inquiry.id])).get(inquiry.id),
    ).toBe(first.id);
  });

  it('refuses an object of another environment through its key', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);
    const elsewhere = await createTestInquiry(db(), await environment());

    await expect(
      addTransactionObjects(db(), environmentId, created.id, [elsewhere.inquiry.id]),
    ).rejects.toThrow();
  });

  it('attaches an account by its id', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);
    const account = await createAccount(db(), environmentId, { id: testId('acc') });

    expect(await addTransactionObjects(db(), environmentId, created.id, [account.id])).toEqual([
      account.id,
    ]);
  });

  it('adds and removes relations to accounts and transactions, idempotently', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);
    const target = await transaction(environmentId, type.id, version.id);
    const account = await createAccount(db(), environmentId, { id: testId('acc') });
    const toAccount = {
      transactionId: created.id,
      relationSchemaKey: 'payer',
      targetId: account.id,
    };
    const toTransaction = {
      transactionId: created.id,
      relationSchemaKey: 'refund-of',
      targetId: target.id,
    };

    expect(await addTransactionRelation(db(), environmentId, toAccount)).toBe(true);
    expect(await addTransactionRelation(db(), environmentId, toAccount)).toBe(false);
    expect(await addTransactionRelation(db(), environmentId, toTransaction)).toBe(true);
    const relations = await listTransactionRelations(db(), environmentId, created.id);
    expect(relations.map((row) => [row.relationSchemaKey, row.targetId]).sort()).toEqual(
      [
        ['payer', account.id],
        ['refund-of', target.id],
      ].sort(),
    );
    expect(await removeTransactionRelation(db(), environmentId, toAccount)).toBe(true);
    expect(await removeTransactionRelation(db(), environmentId, toAccount)).toBe(false);
  });
});

describe('a transaction’s relations, a page at a time (K7C-2, C108)', () => {
  /** A transaction with `count` relations under `payer`, each to an account of its own. */
  async function related(count: number) {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const { id: transactionId } = await transaction(environmentId, type.id, version.id);
    const targets: string[] = [];
    for (let index = 0; index < count; index += 1) {
      targets.push(await relate(environmentId, transactionId));
    }
    return { environmentId, transactionId, targets };
  }

  async function relate(environmentId: string, transactionId: string, key = 'payer') {
    const { id } = await createAccount(db(), environmentId, { id: testId('acc') });
    await addTransactionRelation(db(), environmentId, {
      transactionId,
      relationSchemaKey: key,
      targetId: id,
    });
    return id;
  }

  const stamp = (transactionId: string, targetId: string, at: string) =>
    db().execute(
      sql`update transaction_relations set created_at = ${at}::timestamptz
           where transaction_id = ${transactionId} and target_id = ${targetId}`,
    );

  it('serves the newest first, ties falling to the key and the target, and walks every row once', async () => {
    const { environmentId, transactionId, targets } = await related(3);
    const [oldest, tiedA, tiedB] = targets as [string, string, string];
    const tied = await relate(environmentId, transactionId, 'refund-of');
    await stamp(transactionId, oldest, '2026-10-01T00:00:00.000000Z');
    await stamp(transactionId, tiedA, '2026-10-02T00:00:00.000000Z');
    await stamp(transactionId, tiedB, '2026-10-02T00:00:00.000000Z');
    await stamp(transactionId, tied, '2026-10-02T00:00:00.000000Z');
    const seen: [string, string][] = [];
    let after: string | undefined;
    do {
      const page = await listTransactionRelationsPage(db(), environmentId, transactionId, {
        size: 1,
        ...(after === undefined ? {} : { after }),
      });
      expect(page.items).toHaveLength(1);
      seen.push(
        ...page.items.map((row): [string, string] => [row.relationSchemaKey, row.targetId]),
      );
      after = page.next ?? undefined;
    } while (after !== undefined);

    const descending = [tiedA, tiedB].sort().reverse();
    expect(seen).toEqual([
      ['refund-of', tied],
      ['payer', descending[0]],
      ['payer', descending[1]],
      ['payer', oldest],
    ]);
  });

  it('tells apart two rows a microsecond apart, which a JavaScript date cannot', async () => {
    const { environmentId, transactionId, targets } = await related(2);
    const [older, newer] = targets as [string, string];
    await stamp(transactionId, older, '2026-10-02T00:00:00.123455Z');
    await stamp(transactionId, newer, '2026-10-02T00:00:00.123456Z');

    const first = await listTransactionRelationsPage(db(), environmentId, transactionId, {
      size: 1,
    });
    const second = await listTransactionRelationsPage(db(), environmentId, transactionId, {
      size: 1,
      after: first.next ?? '',
    });

    expect(first.items.map((row) => row.targetId)).toEqual([newer]);
    expect(second.items.map((row) => row.targetId)).toEqual([older]);
    expect(second.next).toBeNull();
  });

  it('keeps its place when a relation is added between two pages', async () => {
    const { environmentId, transactionId, targets } = await related(3);
    const [oldest, middle, newest] = targets as [string, string, string];
    await stamp(transactionId, oldest, '2026-10-01T00:00:00.000000Z');
    await stamp(transactionId, middle, '2026-10-02T00:00:00.000000Z');
    await stamp(transactionId, newest, '2026-10-03T00:00:00.000000Z');
    const first = await listTransactionRelationsPage(db(), environmentId, transactionId, {
      size: 2,
    });

    await relate(environmentId, transactionId);
    const second = await listTransactionRelationsPage(db(), environmentId, transactionId, {
      size: 2,
      after: first.next ?? '',
    });

    expect(first.items.map((row) => row.targetId)).toEqual([newest, middle]);
    expect(second.items.map((row) => row.targetId)).toEqual([oldest]);
  });

  it('keeps its place when the row its cursor came from is removed: a relation can be', async () => {
    const { environmentId, transactionId, targets } = await related(2);
    const [older, newer] = targets as [string, string];
    await stamp(transactionId, older, '2026-10-01T00:00:00.000000Z');
    await stamp(transactionId, newer, '2026-10-02T00:00:00.000000Z');
    const first = await listTransactionRelationsPage(db(), environmentId, transactionId, {
      size: 1,
    });

    await removeTransactionRelation(db(), environmentId, {
      transactionId,
      relationSchemaKey: 'payer',
      targetId: newer,
    });
    const second = await listTransactionRelationsPage(db(), environmentId, transactionId, {
      size: 1,
      after: first.next ?? '',
    });

    expect(second.items.map((row) => row.targetId)).toEqual([older]);
  });

  it('reads one transaction of one environment, whatever the cursor came from', async () => {
    const one = await related(1);
    const two = await related(2);
    await stamp(one.transactionId, one.targets[0] ?? '', '2026-10-05T00:00:00.000000Z');
    const page = await listTransactionRelationsPage(db(), two.environmentId, two.transactionId, {
      size: 1,
    });

    expect(
      (await listTransactionRelationsPage(db(), two.environmentId, one.transactionId)).items,
    ).toEqual([]);
    expect(
      (
        await listTransactionRelationsPage(db(), one.environmentId, one.transactionId, {
          after: page.next ?? '',
        })
      ).items.map((row) => row.targetId),
    ).toEqual(one.targets);
  });

  it('refuses a cursor that is no position', async () => {
    const { environmentId, transactionId } = await related(1);

    await expect(
      listTransactionRelationsPage(db(), environmentId, transactionId, { after: 'nowhere' }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe('files (C105.2, C105.4)', () => {
  it('writes a field’s file, marking the last one deleted, and reads the live ones', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const created = await transaction(environmentId, type.id, version.id);
    const input = (id: string) => ({
      id,
      transactionId: created.id,
      fieldKey: 'statement',
      filename: 'synthetic-statement.pdf',
      mimeType: 'application/pdf',
      byteSize: 12,
      sha256: 'a'.repeat(64),
      storageKey: `transactions/${environmentId}/${id}`,
      wrappedDek: 'ov1.test.synthetic',
    });
    const first = await createTransactionFile(db(), environmentId, input(testId('txnf')));
    const second = await createTransactionFile(db(), environmentId, input(testId('txnf')));

    expect(second.filename).toBe('synthetic-statement.pdf');
    // K7B-5: `deleted_at` means the object is gone; the replaced row is redacted until then.
    const replaced = await getTransactionFile(db(), environmentId, created.id, first.id);
    expect(replaced?.deletedAt).toBeNull();
    expect(replaced?.redactedAt).toBeInstanceOf(Date);
    expect(replaced?.filename).toBeNull();
    expect(await getTransactionFile(db(), environmentId, testId('txn'), second.id)).toBeNull();
    expect(
      (await listTransactionFiles(db(), environmentId, created.id)).map((file) => file.id),
    ).toEqual([second.id]);
    const raw = await db().execute(
      sql`select filename from transaction_files where id = ${second.id}`,
    );
    expect(JSON.stringify(raw)).not.toContain('synthetic-statement');
  });
});

describe('the reads of the resource, the filters and the account include (C105.1, C107.4, C107.6)', () => {
  it('reads each object with its subtype, and the filter links of each transaction', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const { inquiry, template } = await createTestInquiry(db(), environmentId);
    const account = await createAccount(db(), environmentId, { id: testId('acc') });
    const verification = await createVerification(db(), environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    const reportTemplate = await seedReportTemplate(db(), environmentId, {
      reportType: 'watchlist',
    });
    const report = await seedReport(db(), environmentId, {
      ...reportTemplate,
      reportType: 'watchlist',
    });
    const created = await transaction(environmentId, type.id, version.id);
    const related = await transaction(environmentId, type.id, version.id);
    const bare = await transaction(environmentId, type.id, version.id);
    await addTransactionObjects(db(), environmentId, created.id, [
      inquiry.id,
      verification.id,
      report,
      account.id,
    ]);
    await addTransactionRelation(db(), environmentId, {
      transactionId: related.id,
      relationSchemaKey: 'payer',
      targetId: account.id,
    });

    const objects = await listTransactionRelatedObjects(db(), environmentId, [created.id, bare.id]);
    expect(
      [...(objects.get(created.id) ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      [
        { id: account.id, kind: 'account', subtype: null },
        { id: inquiry.id, kind: 'inquiry', subtype: null },
        { id: report, kind: 'report', subtype: 'watchlist' },
        { id: verification.id, kind: 'verification', subtype: 'selfie' },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(objects.get(bare.id) ?? []).toEqual([]);

    const links = await listTransactionFilterLinks(db(), environmentId, [
      created.id,
      related.id,
      bare.id,
    ]);
    expect(links.get(created.id)).toEqual({
      inquiryTemplateIds: [template.id],
      accountTypeIds: [account.accountTypeId],
    });
    expect(links.get(related.id)).toEqual({
      inquiryTemplateIds: [],
      accountTypeIds: [account.accountTypeId],
    });
    expect(links.get(bare.id)).toEqual({ inquiryTemplateIds: [], accountTypeIds: [] });
  });

  it('reads an account’s transactions newest first, attached or related, at most the limit', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const account = await createAccount(db(), environmentId, { id: testId('acc') });
    const clock = createdAtClock(db());
    const attached = await transaction(environmentId, type.id, version.id);
    await clock.at('transactions', attached.id);
    const related = await transaction(environmentId, type.id, version.id);
    await clock.at('transactions', related.id);
    const both = await transaction(environmentId, type.id, version.id);
    await clock.at('transactions', both.id);
    await transaction(environmentId, type.id, version.id);
    await addTransactionObjects(db(), environmentId, attached.id, [account.id]);
    await addTransactionObjects(db(), environmentId, both.id, [account.id]);
    const relation = { relationSchemaKey: 'payer', targetId: account.id };
    await addTransactionRelation(db(), environmentId, { ...relation, transactionId: related.id });
    await addTransactionRelation(db(), environmentId, { ...relation, transactionId: both.id });

    expect(await listAccountTransactions(db(), environmentId, account.id, 50)).toEqual([
      both.id,
      related.id,
      attached.id,
    ]);
    expect(await listAccountTransactions(db(), environmentId, account.id, 2)).toEqual([
      both.id,
      related.id,
    ]);
  });
});

describe('the biometric rows of a transaction (C105.6)', () => {
  it('reaches the attached and named objects, deletes their biometric rows once, and keeps the rest', async () => {
    const environmentId = await environment();
    const { type, version } = await publishedType(environmentId);
    const attachedInquiry = await createTestInquiry(db(), environmentId);
    const namedInquiry = await createTestInquiry(db(), environmentId);
    const untouched = await createTestInquiry(db(), environmentId);
    const selfie = await createVerification(db(), environmentId, {
      id: testId('ver'),
      inquiryId: attachedInquiry.inquiry.id,
      type: 'selfie',
    });
    const named = await createVerification(db(), environmentId, {
      id: testId('ver'),
      inquiryId: namedInquiry.inquiry.id,
      type: 'government_id',
    });
    const other = await createVerification(db(), environmentId, {
      id: testId('ver'),
      inquiryId: untouched.inquiry.id,
      type: 'selfie',
    });
    const file = (verificationId: string, kind: 'selfie-center' | 'portrait' | 'front') =>
      createFile(db(), environmentId, {
        id: testId('file'),
        verificationId,
        kind,
        storageKey: `files/${testId('file')}`,
        mimeType: 'image/png',
        byteSize: 4,
        sha256: 'a'.repeat(64),
        wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
      });
    const selfieFile = await file(selfie.id, 'selfie-center');
    const portrait = await file(named.id, 'portrait');
    const front = await file(named.id, 'front');
    const otherFile = await file(other.id, 'selfie-center');
    const template = (verificationId: string, inquiryId: string) =>
      createFaceTemplate(db(), environmentId, {
        id: testId('ftpl'),
        verificationId,
        inquiryId,
        model: 'synthetic-model',
        embedding: [0.1, 0.2],
      });
    const kept = await template(other.id, untouched.inquiry.id);
    const gone = await template(selfie.id, attachedInquiry.inquiry.id);
    await createSelfieBackground(db(), environmentId, {
      id: testId('sbg'),
      verificationId: selfie.id,
      inquiryId: attachedInquiry.inquiry.id,
      faceTemplateId: gone.id,
      layout: Array.from({ length: 144 }, () => 0),
      validCells: '1'.repeat(48),
      coverage: 1,
    });
    const created = await transaction(environmentId, type.id, version.id);
    await addTransactionObjects(db(), environmentId, created.id, [attachedInquiry.inquiry.id]);

    const scope = await listTransactionBiometricScope(db(), environmentId, created.id, [named.id]);
    expect([...scope.inquiryIds].sort()).toEqual(
      [attachedInquiry.inquiry.id, namedInquiry.inquiry.id].sort(),
    );
    expect([...scope.verificationIds].sort()).toEqual([named.id, selfie.id].sort());

    const at = new Date('2026-11-01T12:00:00.000Z');
    const redacted = await db().transaction((tx) =>
      redactTransactionBiometricRows(tx, environmentId, created.id, { ...scope, at }),
    );
    expect(redacted).toMatchObject({ faceTemplates: 1, selfieBackgrounds: 1 });
    expect(redacted?.files.map((row) => row.id).sort()).toEqual(
      [portrait.id, selfieFile.id].sort(),
    );
    expect(redacted?.biometricsRedactedAt.toISOString()).toBe(at.toISOString());
    const rows = await db().execute(sql`select id from face_templates where id = ${kept.id}`);
    expect((rows as unknown as { rows: unknown[] }).rows).toHaveLength(1);
    expect(front.id).not.toBe(otherFile.id);

    const again = await db().transaction((tx) =>
      redactTransactionBiometricRows(tx, environmentId, created.id, {
        ...scope,
        at: new Date('2026-11-02T12:00:00.000Z'),
      }),
    );
    expect(again).toMatchObject({ faceTemplates: 0, selfieBackgrounds: 0 });
    expect(again?.biometricsRedactedAt.toISOString()).toBe(at.toISOString());
    expect(
      await db().transaction((tx) =>
        redactTransactionBiometricRows(tx, environmentId, testId('txn'), { ...scope, at }),
      ),
    ).toBeNull();
  });
});
