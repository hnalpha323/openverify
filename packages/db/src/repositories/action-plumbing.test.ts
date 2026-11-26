/**
 * Workflow 8A Stage 1b, checkpoint (A): what `foundation-8a` builds in the repositories.
 *
 * - a decision's sealed comment, listed for the rewrap and re-wrapped by `kek:rewrap` (C143.5);
 * - a decision id is a redaction subject (C143.5);
 * - what a list write says it changed, which `stageListUpdated` reads (C127.12, F20): the list, how
 *   many items, and which items a redaction took, for `redactDecisionCommentsInTx` (V25);
 * - archiving a list bumps its version once (outcome 25);
 * - each new type and list column reads back through its repository (C122.1, C128.3).
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { openValue, type Sealed } from '../sealed.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedInquiryDecision,
  seedList,
  seedListItem,
  seedListItemFace,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '../testing.js';
import { createAccountType, updateAccountType } from './accounts.js';
import { REWRAP_TABLES, rewrapAll } from './key-rotation.js';
import { redactBiometricItems, redactBiometricLists } from './list-biometrics.js';
import { archiveListItem, redactExpiredListItems, redactListItems } from './list-items.js';
import { archiveList, createList, getList, updateList } from './lists.js';
import { REDACTION_SUBJECT_ID_PREFIXES } from './subject-ids.js';
import { createTransactionType, updateTransactionType } from './transaction-types.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const at = new Date('2026-11-02T12:00:00.000Z');

async function tenant(): Promise<string> {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

const versionOf = async (id: string) =>
  (await getList(database.db, (await listRow(id)).environment_id, id))?.version;

async function listRow(id: string) {
  const result = await database.client.query<{ environment_id: string }>(
    `select environment_id from lists where id = $1`,
    [id],
  );
  const [row] = result.rows;
  if (row === undefined) {
    throw new Error('no list');
  }
  return row;
}

describe('a decision comment (C128.1, C143.5)', () => {
  it('is listed for the rewrap, under its seal name', () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'inquiry_decisions',
      column: 'comment',
      aad: 'row',
    });
    expect(REWRAP_TABLES).toContain('inquiry_decisions');
    expect(SEALED.inquiryDecisionComment).toBe('inquiry_decisions.comment');
  });

  it('is re-wrapped by kek:rewrap, so the new KEK alone opens it', async () => {
    const oldKek = randomBytes(32);
    const newKek = randomBytes(32);
    setDefaultKeyring(createKeyring(oldKek));
    const environmentId = await tenant();
    const { id } = await seedInquiryDecision(database.db, environmentId, {
      comment: 'synthetic comment',
    });

    await rewrapAll(database.db, { keyring: createKeyring(newKek, [oldKek]) });
    setDefaultKeyring(createKeyring(newKek));

    const stored = await database.client.query<{ comment: Sealed }>(
      `select comment from inquiry_decisions where id = $1`,
      [id],
    );
    const [row] = stored.rows;
    if (row === undefined) {
      throw new Error('no row');
    }
    expect(openValue(SEALED.inquiryDecisionComment, id, row.comment)).toBe('synthetic comment');
  });

  it('makes a decision id a redaction subject', () => {
    expect(REDACTION_SUBJECT_ID_PREFIXES).toContain('idec');
  });
});

describe('what a list write says it changed (C127.12, F20)', () => {
  it('archives a list once, bumping its version', async () => {
    const environmentId = await tenant();
    const { id } = await seedList(database.db, environmentId);

    await archiveList(database.db, environmentId, id, at);
    await archiveList(database.db, environmentId, id, at);

    expect(await versionOf(id)).toBe(2);
  });

  it('says whether an item was archived by this call', async () => {
    const environmentId = await tenant();
    const { id: listId } = await seedList(database.db, environmentId);
    const { id } = await seedListItem(database.db, environmentId, { listId });

    expect(await archiveListItem(database.db, environmentId, id, at)).toMatchObject({
      changed: true,
    });
    expect(await archiveListItem(database.db, environmentId, id, at)).toMatchObject({
      changed: false,
    });
  });

  it('says which lists an item redaction changed, and which items went', async () => {
    const environmentId = await tenant();
    const { id: first } = await seedList(database.db, environmentId);
    const { id: second } = await seedList(database.db, environmentId);
    const a = await seedListItem(database.db, environmentId, { listId: first });
    const b = await seedListItem(database.db, environmentId, { listId: first });
    const c = await seedListItem(database.db, environmentId, { listId: second });

    const result = await redactListItems(database.db, environmentId, [a.id, b.id, c.id], at);

    expect(result.redactedItemIds.toSorted()).toEqual([a.id, b.id, c.id].toSorted());
    expect(result.changedLists.toSorted((x, y) => x.listId.localeCompare(y.listId))).toEqual(
      [
        { listId: first, items: 2 },
        { listId: second, items: 1 },
      ].toSorted((x, y) => x.listId.localeCompare(y.listId)),
    );
  });

  it('says nothing changed when nothing was redacted', async () => {
    const environmentId = await tenant();

    expect(await redactListItems(database.db, environmentId, [], at)).toEqual({
      storageKeys: [],
      changedLists: [],
      redactedItemIds: [],
    });
  });

  it('hands retention what it redacted, in its transaction', async () => {
    const environmentId = await tenant();
    const { id: listId } = await seedList(database.db, environmentId, { itemRetentionDays: 1 });
    const { id } = await seedListItem(database.db, environmentId, {
      listId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const seen: unknown[] = [];

    const count = await redactExpiredListItems(database.db, {
      now: at,
      onRedacted: (tx, redactedIn, redaction) => {
        expect(tx).not.toBe(database.db);
        seen.push({ redactedIn, ...redaction });
        return Promise.resolve();
      },
    });

    expect(count).toBeGreaterThanOrEqual(1);
    expect(seen).toContainEqual({
      redactedIn: environmentId,
      storageKeys: [],
      changedLists: [{ listId, items: 1 }],
      redactedItemIds: [id],
    });
  });

  async function faceItem(environmentId: string, listId: string) {
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const { id } = await seedListItem(database.db, environmentId, {
      listId,
      prefix: 'lifc',
      value: null,
      matchKey: null,
    });
    await seedListItemFace(database.db, environmentId, {
      itemId: id,
      sourceInquiryId: inquiry.id,
    });
    return id;
  }

  it('says the same of a biometric redaction, and only of what it took', async () => {
    const environmentId = await tenant();
    const { id: listId } = await seedList(database.db, environmentId, { kind: 'face' });
    const item = await faceItem(environmentId, listId);

    const first = await redactBiometricItems(database.db, environmentId, [item], { at });
    const second = await redactBiometricItems(database.db, environmentId, [item], { at });

    expect(first).toMatchObject({
      changedLists: [{ listId, items: 1 }],
      redactedItemIds: [item],
    });
    expect(second).toMatchObject({ changedLists: [], redactedItemIds: [] });
  });

  it('says which lists clearing the basis archived, with the items they lost', async () => {
    const environmentId = await tenant();
    const { id: listId } = await seedList(database.db, environmentId, { kind: 'face' });
    const item = await faceItem(environmentId, listId);

    const result = await redactBiometricLists(database.db, environmentId, at);

    expect(result).toMatchObject({
      lists: 1,
      items: 1,
      changedLists: [{ listId, items: 1 }],
      redactedItemIds: [item],
    });
  });
});

describe('the columns each repository reads back', () => {
  const route = { url: 'https://example.com/contest' };

  it('stores a list purpose, `block` by default (C122.1)', async () => {
    const environmentId = await tenant();
    const base = { type: 'email-address', name: 'Blocked' } as const;

    const blocked = await createList(database.db, environmentId, { id: testId('lst'), ...base });
    const allowed = await createList(database.db, environmentId, {
      id: testId('lst'),
      ...base,
      purpose: 'allow',
    });
    const watched = await updateList(database.db, environmentId, blocked.id, { purpose: 'watch' });

    expect(blocked.purpose).toBe('block');
    expect(allowed.purpose).toBe('allow');
    expect(watched?.purpose).toBe('watch');
  });

  it('stores a transaction type adverse statuses and a contest route (C122.1, C128.3)', async () => {
    const environmentId = await tenant();

    const created = await createTransactionType(database.db, environmentId, {
      id: testId('txntp'),
      name: 'Payout',
      adverseStatuses: ['blocked'],
      contestRoute: route,
    });
    const { id } = await seedTransactionType(database.db, environmentId);
    const updated = await updateTransactionType(database.db, environmentId, id, {
      adverseStatuses: [],
      contestRoute: route,
    });
    const cleared = await updateTransactionType(database.db, environmentId, id, {
      contestRoute: null,
    });

    expect(created).toMatchObject({ adverseStatuses: ['blocked'], contestRoute: route });
    expect(updated).toMatchObject({ adverseStatuses: [], contestRoute: route });
    expect(cleared).toMatchObject({ adverseStatuses: [], contestRoute: null });
  });

  it('stores an account type contest route (C128.3)', async () => {
    const environmentId = await tenant();

    const created = await createAccountType(database.db, environmentId, {
      id: testId('acctp'),
      name: 'Business',
      contestRoute: route,
    });
    const cleared = await updateAccountType(database.db, environmentId, created.id, {
      contestRoute: null,
    });

    expect(created.contestRoute).toEqual(route);
    expect(cleared?.contestRoute).toBeNull();
  });
});
