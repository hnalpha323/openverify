/**
 * C97.4, C98.4 (Workflow 7B; F16, P08): the gate, the redactor and the settings hook, on PGlite.
 * Templates are seeded numbers.
 */
import {
  completeListItemBackground,
  completeListItemFace,
  getBiometricItem,
  insertBiometricListItem,
  lists,
  type Db,
  type EnvironmentSettings,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedList,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitVector } from '../../../jobs/selfie-testing.js';
import { biometricItemRedactor, biometricListsGate } from './index.js';
import { onSettingsChangedInTx } from './settings-hook.js';
import { acknowledge, BASIS } from './testing.js';

const NOW = new Date('2026-10-31T12:00:00.000Z');

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  ({ db } = database);
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function source() {
  const { environment } = await createTestTenant(db);
  const { inquiry } = await createTestInquiry(db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id };
}

async function face(owner: { environmentId: string; inquiryId: string }) {
  const { id: listId } = await seedList(db, owner.environmentId, { kind: 'face' });
  const itemId = testId('lifc');
  await insertBiometricListItem(db, owner.environmentId, {
    itemId,
    listId,
    kind: 'face',
    sourceInquiryId: owner.inquiryId,
    normaliserVersion: 'lists-1',
    creator: null,
  });
  await completeListItemFace(db, owner.environmentId, {
    itemId,
    embedding: unitVector(7),
    model: 'sface-synthetic',
  });
  return { itemId, listId };
}

async function background(owner: { environmentId: string; inquiryId: string }) {
  const { id: listId } = await seedList(db, owner.environmentId, { kind: 'selfie-background' });
  const itemId = testId('lisb');
  await insertBiometricListItem(db, owner.environmentId, {
    itemId,
    listId,
    kind: 'selfie-background',
    sourceInquiryId: owner.inquiryId,
    normaliserVersion: 'lists-1',
    creator: null,
  });
  await completeListItemBackground(db, owner.environmentId, {
    itemId,
    layout: Array.from({ length: 144 }, () => 1),
    validCells: '1'.repeat(48),
    coverage: 1,
    maskedFileKey: `key-${itemId}`,
    maskedFileWrappedDek: 'ov1.wrapped',
  });
  return { itemId, listId };
}

const listRow = async (id: string) => (await db.select().from(lists).where(eq(lists.id, id)))[0];

describe('BiometricListsGate (C97.4)', () => {
  it('says no until a basis is recorded, and only for that environment', async () => {
    const owner = await source();
    const other = await source();
    expect(await biometricListsGate.isAcknowledged(db, owner.environmentId)).toBe(false);
    await acknowledge(db, owner.environmentId);
    expect(await biometricListsGate.isAcknowledged(db, owner.environmentId)).toBe(true);
    expect(await biometricListsGate.isAcknowledged(db, other.environmentId)).toBe(false);
  });
});

describe('BiometricItemRedactor (C98.4, C99.7)', () => {
  it('redacts the items of the source and answers the objects to delete', async () => {
    const owner = await source();
    const faceItem = await face(owner);
    const backgroundItem = await background(owner);
    const stranger = await face({
      environmentId: owner.environmentId,
      inquiryId: (await createTestInquiry(db, owner.environmentId)).inquiry.id,
    });
    expect(
      await db.transaction((tx) => biometricItemRedactor.redactBySource(tx, { ...owner, at: NOW })),
    ).toMatchObject({ storageKeys: [`key-${backgroundItem.itemId}`] });
    expect(await getBiometricItem(db, owner.environmentId, faceItem.itemId)).toBeNull();
    // The object's key stays on the row, with no layout, until the job has deleted it.
    expect(await getBiometricItem(db, owner.environmentId, backgroundItem.itemId)).toMatchObject({
      redactedAt: NOW,
      maskedFileKey: `key-${backgroundItem.itemId}`,
    });
    expect(await getBiometricItem(db, owner.environmentId, stranger.itemId)).toMatchObject({
      status: 'active',
    });
  });

  it('answers nothing for an inquiry that was the source of no item', async () => {
    const owner = await source();
    expect(
      await db.transaction((tx) => biometricItemRedactor.redactBySource(tx, { ...owner, at: NOW })),
    ).toEqual({ storageKeys: [], changedLists: [], redactedItemIds: [] });
  });
});

describe('onSettingsChangedInTx (C97.4, P08)', () => {
  const change = (
    environmentId: string,
    before: EnvironmentSettings,
    after: EnvironmentSettings,
  ) => db.transaction((tx) => onSettingsChangedInTx(tx, environmentId, before, after));

  it('redacts every biometric list when the basis is cleared', async () => {
    const owner = await source();
    const faceItem = await face(owner);
    const backgroundItem = await background(owner);
    await change(
      owner.environmentId,
      { 'biometric-lists-basis': BASIS },
      { 'biometric-lists-basis': null },
    );
    expect(await listRow(faceItem.listId)).toMatchObject({ status: 'archived' });
    expect(await listRow(backgroundItem.listId)).toMatchObject({ status: 'archived' });
    expect(await getBiometricItem(db, owner.environmentId, faceItem.itemId)).toBeNull();
  });

  it('reads a removed member as cleared too', async () => {
    const owner = await source();
    const faceItem = await face(owner);
    await change(owner.environmentId, { 'biometric-lists-basis': BASIS }, {});
    expect(await listRow(faceItem.listId)).toMatchObject({ status: 'archived' });
  });

  it.each([
    ['a first basis', {}, { 'biometric-lists-basis': BASIS }],
    ['a changed basis', { 'biometric-lists-basis': BASIS }, { 'biometric-lists-basis': 'Other.' }],
    ['an unrelated setting', { 'report-retention-days': 7 }, { 'report-retention-days': 8 }],
    ['a clear of nothing', {}, { 'biometric-lists-basis': null }],
  ] as const)('leaves the lists alone for %s', async (_case, before, after) => {
    const owner = await source();
    const faceItem = await face(owner);
    await change(owner.environmentId, before, after);
    expect(await listRow(faceItem.listId)).toMatchObject({ status: 'active' });
    expect(await getBiometricItem(db, owner.environmentId, faceItem.itemId)).toMatchObject({
      status: 'active',
    });
  });
});
