/**
 * C97.4, C98.4, C99.7 (Workflow 7B): the rows of face and background items, on the migrated schema
 * (PGlite). Embeddings and layouts are seeded numbers; no face is read here.
 */
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { lists, listItemBackgrounds, listItemFaces, listItems, listMatches } from '../schema.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedList,
  seedListMatch,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  archiveUnavailableBiometricItem,
  completeListItemBackground,
  completeListItemFace,
  deleteRedactedBackgroundRow,
  getBiometricItem,
  hasLiveBiometricItem,
  insertBiometricListItem,
  listBiometricItemsBySource,
  listBiometricItemsPastRetention,
  listBiometricListStates,
  listCachedListStates,
  listListFaceTemplates,
  listMaskedObjectsToPurge,
  listPendingBiometricItems,
  nearestListBackgrounds,
  readBiometricListsBasis,
  redactBiometricItems,
  redactBiometricLists,
} from './list-biometrics.js';
import { createInquirySession, recordInquirySessionConsent } from './inquiry-sessions.js';
import { updateEnvironmentSettings } from './organizations.js';
import { decodeFaceTemplate, encodeFaceTemplate } from './selfie-captures.js';

const MATCHING_KEY = 'consent.biometric-matching';
const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-31T12:00:00.000Z');
const EMBEDDING = Array.from({ length: 128 }, (_, index) => (index === 3 ? 1 : 0));
const CELLS = '1'.repeat(48);
const layoutOf = (value: number) => Array.from({ length: 144 }, () => value);

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

async function tenant() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id };
}

interface Pending {
  environmentId: string;
  inquiryId: string;
  listId: string;
  itemId: string;
}

async function pendingItem(
  owner: { environmentId: string; inquiryId: string },
  kind: 'face' | 'selfie-background' = 'face',
  listId?: string,
): Promise<Pending> {
  const { environmentId, inquiryId } = owner;
  const list = listId ?? (await seedList(database.db, environmentId, { kind })).id;
  const itemId = testId(kind === 'face' ? 'lifc' : 'lisb');
  await insertBiometricListItem(database.db, environmentId, {
    itemId,
    listId: list,
    kind,
    sourceInquiryId: inquiryId,
    normaliserVersion: 'lists-1',
    creator: { type: 'api-key', id: testId('key') },
  });
  return { environmentId, inquiryId, listId: list, itemId };
}

async function activeFace(owner: { environmentId: string; inquiryId: string }, listId?: string) {
  const pending = await pendingItem(owner, 'face', listId);
  await completeListItemFace(database.db, pending.environmentId, {
    itemId: pending.itemId,
    embedding: EMBEDDING,
    model: 'sface-synthetic',
  });
  return pending;
}

async function activeBackground(
  owner: { environmentId: string; inquiryId: string },
  value = 10,
  listId?: string,
) {
  const pending = await pendingItem(owner, 'selfie-background', listId);
  await completeListItemBackground(database.db, pending.environmentId, {
    itemId: pending.itemId,
    layout: layoutOf(value),
    validCells: CELLS,
    coverage: 0.75,
    maskedFileKey: `key-${pending.itemId}`,
    maskedFileWrappedDek: 'ov1.wrapped-dek',
  });
  return pending;
}

const listRow = async (id: string) =>
  (await database.db.select().from(lists).where(eq(lists.id, id)))[0];
const itemRow = async (id: string) =>
  (await database.db.select().from(listItems).where(eq(listItems.id, id)))[0];
const faceRow = async (id: string) =>
  (await database.db.select().from(listItemFaces).where(eq(listItemFaces.itemId, id)))[0];
const backgroundRow = async (id: string) =>
  (
    await database.db.select().from(listItemBackgrounds).where(eq(listItemBackgrounds.itemId, id))
  )[0];

describe('a pending item (C99.7)', () => {
  it('holds no value and no key, and names its source', async () => {
    const pending = await pendingItem(await tenant());
    const item = await itemRow(pending.itemId);
    expect(item).toMatchObject({
      status: 'pending',
      valueSealed: null,
      matchKey: null,
      normaliserVersion: 'lists-1',
      createdByType: 'api-key',
    });
    expect(await faceRow(pending.itemId)).toMatchObject({
      templateSealed: null,
      model: null,
      sourceInquiryId: pending.inquiryId,
    });
  });

  it('counts against the list and bumps its version', async () => {
    const pending = await pendingItem(await tenant());
    expect(await listRow(pending.listId)).toMatchObject({ itemCount: 1, version: 2 });
  });

  it('reads back through getBiometricItem without any template', async () => {
    const pending = await pendingItem(await tenant(), 'selfie-background');
    expect(
      await getBiometricItem(database.db, pending.environmentId, pending.itemId),
    ).toMatchObject({
      itemId: pending.itemId,
      listId: pending.listId,
      kind: 'selfie-background',
      listStatus: 'active',
      status: 'pending',
      redactedAt: null,
      sourceInquiryId: pending.inquiryId,
      model: null,
      maskedFileKey: null,
    });
  });

  it('answers null for an item of another environment', async () => {
    const pending = await pendingItem(await tenant());
    const other = await tenant();
    expect(await getBiometricItem(database.db, other.environmentId, pending.itemId)).toBeNull();
  });

  it('tells a live item of the source from an archived one', async () => {
    const owner = await tenant();
    const pending = await pendingItem(owner);
    const live = () =>
      hasLiveBiometricItem(database.db, owner.environmentId, pending.listId, owner.inquiryId);
    expect(await live()).toBe(true);
    await archiveUnavailableBiometricItem(database.db, owner.environmentId, pending.itemId, NOW);
    expect(await live()).toBe(false);
  });

  it('is listed by the sweep, oldest first, only while its list is active', async () => {
    const pending = await pendingItem(await tenant());
    const swept = async () =>
      (await listPendingBiometricItems(database.db, { limit: 500 })).map((row) => row.itemId);
    expect(await swept()).toContain(pending.itemId);
    await database.db
      .update(lists)
      .set({ status: 'archived', archivedAt: NOW })
      .where(eq(lists.id, pending.listId));
    expect(await swept()).not.toContain(pending.itemId);
  });
});

describe('readBiometricListsBasis (C97.4)', () => {
  it('reads the setting, null until it is set and once it is cleared', async () => {
    const owner = await tenant();
    const basis = () =>
      database.db.transaction((tx) => readBiometricListsBasis(tx, owner.environmentId));
    expect(await basis()).toBeNull();
    await updateEnvironmentSettings(database.db, owner.environmentId, {
      'biometric-lists-basis': 'A recorded basis.',
    });
    expect(await basis()).toBe('A recorded basis.');
    await updateEnvironmentSettings(database.db, owner.environmentId, {
      'biometric-lists-basis': null,
    });
    expect(await basis()).toBeNull();
  });

  it('answers null for an environment that does not exist', async () => {
    expect(await readBiometricListsBasis(database.db, testId('env'))).toBeNull();
  });
});

describe('completing an item (C99.7)', () => {
  it('seals the template, activates the item and bumps the version', async () => {
    const pending = await activeFace(await tenant());
    const side = await faceRow(pending.itemId);
    expect(side?.model).toBe('sface-synthetic');
    expect(JSON.stringify(side)).not.toContain(encodeFaceTemplate(EMBEDDING));
    expect((await itemRow(pending.itemId))?.status).toBe('active');
    expect(await listRow(pending.listId)).toMatchObject({ itemCount: 1, version: 3 });
  });

  it('opens the templates of a list for the cache, only of active items', async () => {
    const owner = await tenant();
    const active = await activeFace(owner);
    await pendingItem(owner, 'face', active.listId);
    const rows = await listListFaceTemplates(database.db, owner.environmentId, active.listId);
    expect(rows.map((row) => row.itemId)).toEqual([active.itemId]);
    expect(decodeFaceTemplate(rows[0]?.template ?? '')).toEqual(EMBEDDING);
    expect(rows[0]?.model).toBe('sface-synthetic');
  });

  it('fills a background row with its layout and envelope object', async () => {
    const pending = await activeBackground(await tenant());
    expect(await backgroundRow(pending.itemId)).toMatchObject({
      validCells: CELLS,
      coverage: 0.75,
      maskedFileKey: `key-${pending.itemId}`,
      maskedFileWrappedDek: 'ov1.wrapped-dek',
    });
    expect((await itemRow(pending.itemId))?.status).toBe('active');
  });

  it('answers false and writes nothing for an item no longer pending', async () => {
    const owner = await tenant();
    const pending = await pendingItem(owner);
    await archiveUnavailableBiometricItem(database.db, owner.environmentId, pending.itemId, NOW);
    expect(
      await completeListItemFace(database.db, owner.environmentId, {
        itemId: pending.itemId,
        embedding: EMBEDDING,
        model: 'sface-synthetic',
      }),
    ).toBe(false);
    expect((await faceRow(pending.itemId))?.templateSealed).toBeNull();
  });

  it('answers false for a background item no longer pending', async () => {
    const owner = await tenant();
    const pending = await pendingItem(owner, 'selfie-background');
    await archiveUnavailableBiometricItem(database.db, owner.environmentId, pending.itemId, NOW);
    expect(
      await completeListItemBackground(database.db, owner.environmentId, {
        itemId: pending.itemId,
        layout: layoutOf(1),
        validCells: CELLS,
        coverage: 1,
        maskedFileKey: 'k',
        maskedFileWrappedDek: 'd',
      }),
    ).toBe(false);
    expect((await backgroundRow(pending.itemId))?.layout).toBeNull();
  });
});

describe('source_unavailable (C99.7)', () => {
  it('archives the item, keeps its source and frees its place', async () => {
    const owner = await tenant();
    const pending = await pendingItem(owner);
    expect(
      await archiveUnavailableBiometricItem(database.db, owner.environmentId, pending.itemId, NOW),
    ).toBe(true);
    expect(await itemRow(pending.itemId)).toMatchObject({
      status: 'archived',
      archiveReason: 'source_unavailable',
      archivedAt: NOW,
    });
    expect(await listRow(pending.listId)).toMatchObject({ itemCount: 0, version: 3 });
    expect((await faceRow(pending.itemId))?.sourceInquiryId).toBe(owner.inquiryId);
  });

  it('answers false for an item that is not pending', async () => {
    const owner = await tenant();
    const active = await activeFace(owner);
    expect(
      await archiveUnavailableBiometricItem(database.db, owner.environmentId, active.itemId, NOW),
    ).toBe(false);
  });
});

describe('list states (C99.7)', () => {
  it('counts active and pending items, and reads only the environment', async () => {
    const owner = await tenant();
    const active = await activeFace(owner);
    await pendingItem(owner, 'face', active.listId);
    const other = await tenant();
    const unrelated = await pendingItem(other);
    expect(
      await listBiometricListStates(database.db, owner.environmentId, [
        active.listId,
        unrelated.listId,
      ]),
    ).toEqual([
      {
        id: active.listId,
        kind: 'face',
        status: 'active',
        version: 4,
        active: 1,
        pending: 1,
      },
    ]);
  });

  it('reads an empty list as nothing to compare', async () => {
    const owner = await tenant();
    const { id } = await seedList(database.db, owner.environmentId, { kind: 'face' });
    expect(await listBiometricListStates(database.db, owner.environmentId, [id])).toMatchObject([
      { id, active: 0, pending: 0 },
    ]);
  });

  it('asks nothing for no list', async () => {
    const owner = await tenant();
    expect(await listBiometricListStates(database.db, owner.environmentId, [])).toEqual([]);
  });
});

describe('the states the cache checks (C99.7)', () => {
  it('reads each list by id, across environments', async () => {
    const first = await pendingItem(await tenant());
    const second = await pendingItem(await tenant());
    const states = await listCachedListStates(database.db, [first.listId, second.listId]);
    expect(states).toHaveLength(2);
    expect(states).toContainEqual({ id: first.listId, version: 2, status: 'active' });
  });

  it('asks nothing for no list', async () => {
    expect(await listCachedListStates(database.db, [])).toEqual([]);
  });
});

describe('the exact layout scan (C99.7)', () => {
  it('answers the nearest active items of the one list, nearest first', async () => {
    const owner = await tenant();
    const near = await activeBackground(owner, 11);
    const far = await activeBackground(owner, 40, near.listId);
    const mid = await activeBackground(owner, 20, near.listId);
    await pendingItem(owner, 'selfie-background', near.listId);
    await activeBackground(owner, 10);
    const candidates = await nearestListBackgrounds(database.db, owner.environmentId, {
      listId: near.listId,
      layout: layoutOf(10),
      limit: 2,
    });
    expect(candidates.map((row) => row.itemId)).toEqual([near.itemId, mid.itemId]);
    expect(candidates[0]).toMatchObject({
      maskedFileKey: `key-${near.itemId}`,
      maskedFileWrappedDek: 'ov1.wrapped-dek',
    });
    expect(candidates[0]?.distance).toBeLessThan(candidates[1]?.distance ?? 0);
    expect(far.itemId).not.toBe(mid.itemId);
  });
});

describe('redaction (C98.4)', () => {
  it('lists every item of a source, of both kinds and any status', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    const background = await activeBackground(owner);
    const other = await activeFace(await tenant());
    expect(
      (await listBiometricItemsBySource(database.db, owner.environmentId, owner.inquiryId))
        .map((row) => row.itemId)
        .sort(),
    ).toEqual([face.itemId, background.itemId].sort());
    expect(other.itemId).toBeDefined();
  });

  it('removes the template and the layout, and answers the object to delete', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    const background = await activeBackground(owner);
    const { storageKeys } = await redactBiometricItems(
      database.db,
      owner.environmentId,
      [face.itemId, background.itemId],
      { at: NOW },
    );
    expect(storageKeys).toEqual([`key-${background.itemId}`]);
    expect(await faceRow(face.itemId)).toBeUndefined();
    expect(await backgroundRow(background.itemId)).toMatchObject({
      layout: null,
      validCells: null,
      coverage: null,
      maskedFileKey: `key-${background.itemId}`,
    });
    expect(
      (await listMaskedObjectsToPurge(database.db, { limit: 500 })).map((row) => row.itemId),
    ).toContain(background.itemId);
    expect(await itemRow(face.itemId)).toMatchObject({
      status: 'archived',
      redactedAt: NOW,
      valueSealed: null,
      matchKey: null,
    });
  });

  it('frees the place of a live item, and bumps the version once per list', async () => {
    const owner = await tenant();
    const first = await activeFace(owner);
    const second = await activeFace(owner, first.listId);
    const before = await listRow(first.listId);
    await redactBiometricItems(database.db, owner.environmentId, [first.itemId, second.itemId], {
      at: NOW,
    });
    expect(await listRow(first.listId)).toMatchObject({
      itemCount: 0,
      version: (before?.version ?? 0) + 1,
    });
  });

  it('does not count an archived item twice', async () => {
    const owner = await tenant();
    const live = await activeFace(owner);
    const gone = await pendingItem(owner, 'face', live.listId);
    await archiveUnavailableBiometricItem(database.db, owner.environmentId, gone.itemId, NOW);
    await redactBiometricItems(database.db, owner.environmentId, [gone.itemId], { at: NOW });
    expect((await listRow(live.listId))?.itemCount).toBe(1);
  });

  it('keeps a match of the item, which no longer names it (C99.3)', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    const match = await seedListMatch(database.db, owner.environmentId, {
      listId: face.listId,
      inquiryId: owner.inquiryId,
      listItemId: face.itemId,
    });
    await redactBiometricItems(database.db, owner.environmentId, [face.itemId], { at: NOW });
    const [row] = await database.db.select().from(listMatches).where(eq(listMatches.id, match.id));
    expect(row?.listItemId).toBeNull();
  });

  it('is idempotent', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    await redactBiometricItems(database.db, owner.environmentId, [face.itemId], { at: NOW });
    const version = (await listRow(face.listId))?.version;
    expect(
      await redactBiometricItems(database.db, owner.environmentId, [face.itemId], {
        at: new Date(NOW.getTime() + 1000),
      }),
    ).toEqual({ storageKeys: [], changedLists: [], redactedItemIds: [] });
    expect(await itemRow(face.itemId)).toMatchObject({ redactedAt: NOW });
    expect((await listRow(face.listId))?.version).toBe(version);
  });

  it('asks nothing for no item', async () => {
    const owner = await tenant();
    expect(await redactBiometricItems(database.db, owner.environmentId, [], { at: NOW })).toEqual({
      storageKeys: [],
      changedLists: [],
      redactedItemIds: [],
    });
  });

  it('leaves another environment alone', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    const other = await tenant();
    await redactBiometricItems(database.db, other.environmentId, [face.itemId], { at: NOW });
    expect((await itemRow(face.itemId))?.redactedAt).toBeNull();
    expect(await faceRow(face.itemId)).toBeDefined();
  });

  it('drops the row of a pending background at once: it has no object', async () => {
    const owner = await tenant();
    const pending = await pendingItem(owner, 'selfie-background');
    await redactBiometricItems(database.db, owner.environmentId, [pending.itemId], { at: NOW });
    expect(await backgroundRow(pending.itemId)).toBeUndefined();
  });

  it('deletes the side row once the object is gone', async () => {
    const owner = await tenant();
    const background = await activeBackground(owner);
    await redactBiometricItems(database.db, owner.environmentId, [background.itemId], { at: NOW });
    await deleteRedactedBackgroundRow(database.db, owner.environmentId, background.itemId);
    expect(await backgroundRow(background.itemId)).toBeUndefined();
  });

  it('never deletes the row of a live item', async () => {
    const background = await activeBackground(await tenant());
    await deleteRedactedBackgroundRow(database.db, background.environmentId, background.itemId);
    expect(await backgroundRow(background.itemId)).toBeDefined();
  });
});

describe('clearing the basis (C97.4, P08)', () => {
  it('redacts every item and archives every face and background list', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    const background = await activeBackground(owner);
    const pending = await pendingItem(owner, 'face');
    const strings = await seedList(database.db, owner.environmentId, { kind: 'string' });
    expect(await redactBiometricLists(database.db, owner.environmentId, NOW)).toMatchObject({
      lists: 3,
      items: 3,
    });
    for (const item of [face, background, pending]) {
      expect(await itemRow(item.itemId)).toMatchObject({ status: 'archived', redactedAt: NOW });
      expect(await listRow(item.listId)).toMatchObject({ status: 'archived', archivedAt: NOW });
    }
    expect(await faceRow(face.itemId)).toBeUndefined();
    expect(await backgroundRow(background.itemId)).toMatchObject({
      layout: null,
      maskedFileKey: `key-${background.itemId}`,
    });
    expect((await listRow(strings.id))?.status).toBe('active');
  });

  it('touches no other environment', async () => {
    const owner = await tenant();
    const other = await activeFace(await tenant());
    await redactBiometricLists(database.db, owner.environmentId, NOW);
    expect((await itemRow(other.itemId))?.status).toBe('active');
  });

  it('bumps the version of a list already archived, so a cached copy goes', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    await database.db
      .update(lists)
      .set({ status: 'archived', archivedAt: new Date(NOW.getTime() - DAY_MS) })
      .where(eq(lists.id, face.listId));
    const version = (await listRow(face.listId))?.version ?? 0;
    await redactBiometricLists(database.db, owner.environmentId, NOW);
    expect((await listRow(face.listId))?.version).toBeGreaterThan(version);
    expect((await itemRow(face.itemId))?.redactedAt).toEqual(NOW);
  });
});

describe('retention by the consent window (C99.7, P08)', () => {
  async function consented(
    owner: { environmentId: string; inquiryId: string },
    at: Date,
    keys: { textKeys?: string[]; optionalTextKeys?: string[] } = {
      optionalTextKeys: [MATCHING_KEY],
    },
  ) {
    const session = await createInquirySession(database.db, owner.environmentId, {
      id: testId('iqse'),
      inquiryId: owner.inquiryId,
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(at.getTime() + DAY_MS),
    });
    await recordInquirySessionConsent(database.db, owner.environmentId, session.id, {
      acceptedAt: at,
      textKeys: keys.textKeys ?? [],
      ...(keys.optionalTextKeys === undefined ? {} : { optionalTextKeys: keys.optionalTextKeys }),
      locale: 'en',
      ip: null,
      userAgent: null,
    });
    return session.id;
  }

  const due = async (now: Date) =>
    (await listBiometricItemsPastRetention(database.db, { now, limit: 500 })).map(
      (row) => row.itemId,
    );

  it('finds an item the day the window ends, counted from the consent', async () => {
    const owner = await tenant();
    await updateEnvironmentSettings(database.db, owner.environmentId, {
      'face-template-retention-days': 30,
    });
    const consent = new Date(NOW.getTime() - 29 * DAY_MS);
    await consented(owner, consent);
    const face = await activeFace(owner);
    await database.db
      .update(lists)
      .set({ itemRetentionDays: 3000 })
      .where(eq(lists.id, face.listId));
    expect(await due(NOW)).not.toContain(face.itemId);
    expect(await due(new Date(consent.getTime() + 30 * DAY_MS))).toContain(face.itemId);
  });

  it('reads the window from a required consent key too', async () => {
    const owner = await tenant();
    await updateEnvironmentSettings(database.db, owner.environmentId, {
      'face-template-retention-days': 30,
    });
    await consented(owner, NOW, { textKeys: [MATCHING_KEY] });
    const face = await activeFace(owner);
    await database.db
      .update(lists)
      .set({ itemRetentionDays: 3000 })
      .where(eq(lists.id, face.listId));
    expect(await due(new Date(NOW.getTime() + 29 * DAY_MS))).not.toContain(face.itemId);
  });

  it('applies the environment default of 365 days', async () => {
    const owner = await tenant();
    await consented(owner, NOW);
    const face = await activeBackground(owner);
    await database.db
      .update(lists)
      .set({ itemRetentionDays: 3000 })
      .where(eq(lists.id, face.listId));
    expect(await due(new Date(NOW.getTime() + 364 * DAY_MS))).not.toContain(face.itemId);
    expect(await due(new Date(NOW.getTime() + 365 * DAY_MS))).toContain(face.itemId);
  });

  it('finds an item past its list retention first, whichever ends sooner', async () => {
    const owner = await tenant();
    await consented(owner, NOW);
    const face = await activeFace(owner);
    await database.db.update(lists).set({ itemRetentionDays: 7 }).where(eq(lists.id, face.listId));
    const created = (await itemRow(face.itemId))?.createdAt ?? NOW;
    expect(await due(new Date(created.getTime() + 8 * DAY_MS))).toContain(face.itemId);
  });

  it('treats no consent to matching as past the window: a stored face has no basis', async () => {
    const owner = await tenant();
    await consented(owner, NOW, { textKeys: ['consent.biometric'] });
    const face = await activeFace(owner);
    expect(await due(NOW)).toContain(face.itemId);
  });

  it('leaves out the consent of a rejected handoff session', async () => {
    const owner = await tenant();
    const session = await consented(owner, NOW);
    const desktop = await consented(owner, new Date(NOW.getTime() - 400 * DAY_MS), {
      textKeys: ['consent.biometric'],
    });
    await database.db.execute(sql`
      update inquiry_sessions set device_handoff_method = 'qr',
        handoff_from_session_id = ${desktop},
        handoff_redeemed_at = ${NOW.toISOString()}::timestamptz,
        handoff_rejected_at = ${NOW.toISOString()}::timestamptz
      where id = ${session}`);
    const face = await activeFace(owner);
    expect(await due(NOW)).toContain(face.itemId);
  });

  it('never lists a redacted item', async () => {
    const owner = await tenant();
    const face = await activeFace(owner);
    await redactBiometricItems(database.db, owner.environmentId, [face.itemId], { at: NOW });
    expect(await due(NOW)).not.toContain(face.itemId);
  });
});
