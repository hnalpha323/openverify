/**
 * C97.4, C98.4, C99.7 (Workflow 7B) against Postgres 17 row locks (Testcontainers, started without
 * bind-parameter logging): a face or background item while its source is redacted, while the basis
 * is cleared, and while another request takes the list's last place. Vision works outside any
 * transaction, so each write re-checks under the lock:
 * - the embed job takes the basis under a shared lock of the environment row, then the inquiry;
 * - a redaction holds the inquiry, and a clearing settings update holds the environment row.
 *
 * Whichever commits first wins, and nothing is left behind either way. Each order is held inside
 * its transaction. A pending writer proves it waited, so neither order passes by luck of timing.
 * Synthetic values only: the selfie is random bytes.
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createKeyring,
  getBiometricItem,
  insertBiometricListItem,
  listItemBackgrounds,
  listItems,
  lists,
  redactInquiryRecords,
  runMigrations,
  setDefaultKeyring,
  updateEnvironmentSettings,
  type BiometricListKind,
  type Database,
  type Db,
  type Keyring,
} from '@openverify/db';
import { createIntegrationPool, seedList, testId, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../../auth/pii.js';
import { processListItemEmbed, type ListItemEmbedDeps } from '../../../jobs/lists/embed.js';
import { threePoseAnalysis, unitVector } from '../../../jobs/selfie-testing.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  embedFaceAnswer,
} from '../../../jobs/testing.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
} from '../../../test-support/fakes.js';
import { biometricItemRedactor, biometricListsGate } from './index.js';
import { createBiometricListItem } from './items.js';
import { onSettingsChangedInTx } from './settings-hook.js';
import { acknowledge, BASIS, seedSelfieSource, type SelfieSource } from './testing.js';

/** Long enough for a writer that is not blocked to finish. */
const WAIT_MS = 500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let keyring: Keyring;
const storage = createMemoryStorage();
const logger = createCapturingLogger();

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  keyring = createKeyring(randomBytes(32));
  setDefaultKeyring(keyring);
  await runMigrations(db);
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

function vision() {
  const fake = createFakeVision();
  fake.answers.selfie = threePoseAnalysis();
  fake.answers.embedFace = embedFaceAnswer({
    bbox: [1, 2, 3, 4],
    score: 0.9,
    embedding: unitVector(31),
  });
  return fake.client;
}

function deps(handle: Db = db): ListItemEmbedDeps {
  return {
    events: createRecordingEventPublisher(),
    db: handle,
    clock: { now: () => new Date() },
    logger,
    storage,
    keyring,
    vision: vision(),
  };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A database whose every transaction waits for `release` before it commits. */
function holdingCommits(): { handle: Db; release: () => void; entered: Promise<void> } {
  const released = deferred();
  const entered = deferred();
  const handle = new Proxy(db, {
    get(target, member) {
      if (member === 'transaction') {
        return <T>(work: (tx: Db) => Promise<T>) =>
          target.transaction(async (tx) => {
            const answer = await work(tx);
            entered.resolve();
            await released.promise;
            return answer;
          });
      }
      return Reflect.get(target, member) as unknown;
    },
  });
  return { handle, release: released.resolve, entered: entered.promise };
}

async function settlesWithin(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  const watched = promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.race([watched, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  return settled;
}

interface Pending extends SelfieSource {
  listId: string;
  itemId: string;
}

async function pending(kind: BiometricListKind = 'face'): Promise<Pending> {
  const source = await seedSelfieSource({ db, keyring, storage });
  await acknowledge(db, source.environmentId);
  const { id: listId } = await seedList(db, source.environmentId, { kind });
  const itemId = testId(kind === 'face' ? 'lifc' : 'lisb');
  await insertBiometricListItem(db, source.environmentId, {
    itemId,
    listId,
    kind,
    sourceInquiryId: source.inquiryId,
    normaliserVersion: 'lists-1',
    creator: null,
  });
  return { ...source, listId, itemId };
}

const itemRow = async (id: string) =>
  (await db.select().from(listItems).where(eq(listItems.id, id)))[0];

/** The inquiry redaction's own steps, under the inquiry's lock. */
function redacting(seeded: Pending, hold: Promise<void>, held: () => void) {
  return db.transaction(async (tx) => {
    const at = new Date();
    await redactInquiryRecords(tx, seeded.environmentId, seeded.inquiryId, { at });
    const answer = await biometricItemRedactor.redactBySource(tx, {
      environmentId: seeded.environmentId,
      inquiryId: seeded.inquiryId,
      at,
    });
    held();
    await hold;
    return answer;
  });
}

/** The settings update's own steps, under the environment row's lock. */
function clearing(environmentId: string, hold: Promise<void>, held: () => void) {
  return db.transaction(async (tx) => {
    await updateEnvironmentSettings(tx, environmentId, { 'biometric-lists-basis': null });
    await onSettingsChangedInTx(
      tx,
      environmentId,
      { 'biometric-lists-basis': BASIS },
      { 'biometric-lists-basis': null },
    );
    held();
    await hold;
  });
}

function gate() {
  const opened = deferred();
  const reached = deferred();
  return {
    hold: opened.promise,
    held: reached.promise,
    open: opened.resolve,
    enter: reached.resolve,
  };
}

describe('the embed job and a redaction of its source (C98.4)', () => {
  it('the redaction first: the job waits, then writes nothing', async () => {
    const seeded = await pending();
    const { hold, held, open, enter } = gate();
    const redaction = redacting(seeded, hold, enter);
    await held;
    const job = processListItemEmbed(seeded, deps());
    expect(await settlesWithin(job)).toBe(false);
    open();
    await redaction;
    expect(await job).toEqual({ status: 'skipped' });
    expect(await itemRow(seeded.itemId)).toMatchObject({ status: 'archived' });
    expect(await getBiometricItem(db, seeded.environmentId, seeded.itemId)).toBeNull();
  });

  it('the job first: the redaction waits, then takes what the job wrote', async () => {
    const seeded = await pending();
    const { handle, release, entered } = holdingCommits();
    const job = processListItemEmbed(seeded, deps(handle));
    await entered;
    const redaction = redacting(seeded, Promise.resolve(), () => undefined);
    expect(await settlesWithin(redaction)).toBe(false);
    release();
    expect(await job).toEqual({ status: 'active' });
    await redaction;
    expect((await itemRow(seeded.itemId))?.redactedAt).not.toBeNull();
    expect(await getBiometricItem(db, seeded.environmentId, seeded.itemId)).toBeNull();
  });

  it('the redaction first leaves no masked object behind', async () => {
    const seeded = await pending('selfie-background');
    const before = new Set(storage.objects.keys());
    const { hold, held, open, enter } = gate();
    const redaction = redacting(seeded, hold, enter);
    await held;
    const job = processListItemEmbed(seeded, deps());
    expect(await settlesWithin(job)).toBe(false);
    open();
    await redaction;
    expect(await job).toEqual({ status: 'skipped' });
    expect([...storage.objects.keys()].filter((key) => !before.has(key))).toEqual([]);
  });
});

describe('the embed job and a cleared basis (C97.4)', () => {
  it('the clear first: the job waits on the shared lock, then writes nothing', async () => {
    const seeded = await pending();
    const { hold, held, open, enter } = gate();
    const clear = clearing(seeded.environmentId, hold, enter);
    await held;
    const job = processListItemEmbed(seeded, deps());
    expect(await settlesWithin(job)).toBe(false);
    open();
    await clear;
    expect(await job).toEqual({ status: 'skipped' });
    expect((await itemRow(seeded.itemId))?.redactedAt).not.toBeNull();
  });

  it('the job first: the clear waits, then redacts what the job wrote', async () => {
    const seeded = await pending('selfie-background');
    const { handle, release, entered } = holdingCommits();
    const job = processListItemEmbed(seeded, deps(handle));
    await entered;
    const clear = clearing(seeded.environmentId, Promise.resolve(), () => undefined);
    expect(await settlesWithin(clear)).toBe(false);
    release();
    expect(await job).toEqual({ status: 'active' });
    await clear;
    expect(await itemRow(seeded.itemId)).toMatchObject({ status: 'archived' });
    const [side] = await db
      .select()
      .from(listItemBackgrounds)
      .where(eq(listItemBackgrounds.itemId, seeded.itemId));
    expect(side).toMatchObject({ layout: null, validCells: null, coverage: null });
  });
});

describe('adding an item (C97.4, C97.5)', () => {
  const adding = (handle: Db, source: SelfieSource, listId: string) =>
    createBiometricListItem(
      {
        db: handle,
        audit: createRecordingAuditLogger(),
        biometricListsGate,
        listItemEmbeds: { enqueueListItemEmbed: () => Promise.resolve() },
      },
      {
        ctx: { environmentId: source.environmentId, organizationId: testId('org') },
        actor: { type: 'api-key', id: testId('key') },
        mask: UNMASKED,
      },
      'face',
      { 'list-id': listId, 'inquiry-id': source.inquiryId },
    );

  it('holds two requests for one source to one item', async () => {
    const source = await seedSelfieSource({ db, keyring, storage });
    await acknowledge(db, source.environmentId);
    const { id: listId } = await seedList(db, source.environmentId, { kind: 'face' });
    const answers = await Promise.allSettled([
      adding(db, source, listId),
      adding(db, source, listId),
    ]);
    expect(answers.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(answers.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'list_item_exists' },
    });
    const items = await db.select().from(listItems).where(eq(listItems.listId, listId));
    expect(items).toHaveLength(1);
  });

  it('gives the last place to one of two sources', async () => {
    const first = await seedSelfieSource({ db, keyring, storage });
    await acknowledge(db, first.environmentId);
    const second = await seedSelfieSource(
      { db, keyring, storage },
      { environmentId: first.environmentId },
    );
    const { id: listId } = await seedList(db, first.environmentId, { kind: 'face' });
    await db.update(lists).set({ itemCount: 9_999 }).where(eq(lists.id, listId));
    const answers = await Promise.allSettled([
      adding(db, first, listId),
      adding(db, second, listId),
    ]);
    expect(answers.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(answers.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'list_limit_reached' },
    });
  });

  it('the add first: the clear waits, then redacts the item it wrote', async () => {
    const source = await seedSelfieSource({ db, keyring, storage });
    await acknowledge(db, source.environmentId);
    const { id: listId } = await seedList(db, source.environmentId, { kind: 'face' });
    const { handle, release, entered } = holdingCommits();
    const add = adding(handle, source, listId);
    await entered;
    const clear = clearing(source.environmentId, Promise.resolve(), () => undefined);
    expect(await settlesWithin(clear)).toBe(false);
    release();
    const { data } = await add;
    await clear;
    expect((await itemRow(data.id))?.redactedAt).not.toBeNull();
  });

  it('the clear first: the add waits, then is refused', async () => {
    const source = await seedSelfieSource({ db, keyring, storage });
    await acknowledge(db, source.environmentId);
    const { id: listId } = await seedList(db, source.environmentId, { kind: 'face' });
    const { hold, held, open, enter } = gate();
    const clear = clearing(source.environmentId, hold, enter);
    await held;
    const add = adding(db, source, listId);
    expect(await settlesWithin(add)).toBe(false);
    open();
    await clear;
    await expect(add).rejects.toMatchObject({ code: 'biometric_lists_not_acknowledged' });
  });
});
