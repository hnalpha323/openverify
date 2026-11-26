/**
 * C99.7 (Workflow 7B): the `list-item-embed` job and its sweep, on PGlite. Vision is a fake with
 * synthetic embeddings, and the selfie is random bytes behind a JPEG signature.
 */
import {
  decodeFaceTemplate,
  decryptBytes,
  getBiometricItem,
  insertBiometricListItem,
  listItemBackgrounds,
  listItemFaces,
  listItems,
  lists,
  openValue,
  SEALED,
  transitionInquiryStatus,
  updateEnvironmentSettings,
  type BiometricListKind,
  type Db,
  type Keyring,
  type Sealed,
} from '@openverify/db';
import { createTestDatabase, seedList, testId, type TestDatabase } from '@openverify/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { biometricItemRedactor } from '../../services/lists/biometric/index.js';
import { onSettingsChangedInTx } from '../../services/lists/biometric/settings-hook.js';
import {
  acknowledge,
  BASIS,
  seedSelfieSource,
  type SelfieSource,
  type SelfieSourceOptions,
} from '../../services/lists/biometric/testing.js';
import { VisionServiceError, VisionUnavailableError } from '../../vision/index.js';
import type { ListItemEmbedJob } from '../../ports.js';
import { PermanentJobError } from '../errors.js';
import { threePoseAnalysis, unitVector } from '../selfie-testing.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  embedFaceAnswer,
  FAKE_PNG,
} from '../testing.js';
import { createRecordingEventPublisher } from '../../test-support/fakes.js';
import { processListItemEmbed, runListItemEmbedSweep, type ListItemEmbedDeps } from './embed.js';

const listUpdated = vi.hoisted(() => vi.fn());
vi.mock('../../workflows/actions/lists/list-updated.js', () => ({
  stageListUpdated: listUpdated,
}));

const events = createRecordingEventPublisher();
const NOW = new Date('2026-10-31T12:00:00.000Z');
const EMBEDDING = unitVector(11);

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
const storage = createMemoryStorage();
const logger = createCapturingLogger();

beforeAll(async () => {
  database = await createTestDatabase();
  ({ db, keyring } = database);
}, 120_000);

afterAll(async () => {
  await database.close();
});

function fakeVision() {
  const fake = createFakeVision();
  fake.answers.selfie = threePoseAnalysis();
  fake.answers.embedFace = embedFaceAnswer({
    bbox: [1, 2, 3, 4],
    score: 0.9,
    embedding: EMBEDDING,
  });
  return fake;
}

function depsWith(vision = fakeVision().client): ListItemEmbedDeps {
  return { db, clock: { now: () => NOW }, logger, storage, keyring, vision, events };
}

interface Seeded extends SelfieSource {
  listId: string;
  itemId: string;
  job: ListItemEmbedJob;
}

async function pending(
  kind: BiometricListKind = 'face',
  options: SelfieSourceOptions = {},
): Promise<Seeded> {
  const source = await seedSelfieSource({ db, keyring, storage }, options);
  const { environmentId, inquiryId } = source;
  await acknowledge(db, environmentId);
  const { id: listId } = await seedList(db, environmentId, { kind });
  const itemId = testId(kind === 'face' ? 'lifc' : 'lisb');
  await insertBiometricListItem(db, environmentId, {
    itemId,
    listId,
    kind,
    sourceInquiryId: inquiryId,
    normaliserVersion: 'lists-1',
    creator: null,
  });
  return { ...source, listId, itemId, job: { environmentId, itemId } };
}

const itemRow = async (id: string) =>
  (await db.select().from(listItems).where(eq(listItems.id, id)))[0];
const faceRow = async (id: string) =>
  (await db.select().from(listItemFaces).where(eq(listItemFaces.itemId, id)))[0];
const backgroundRow = async (id: string) =>
  (await db.select().from(listItemBackgrounds).where(eq(listItemBackgrounds.itemId, id)))[0];
const listRow = async (id: string) => (await db.select().from(lists).where(eq(lists.id, id)))[0];

async function expectUnavailable(seeded: Seeded, deps: ListItemEmbedDeps): Promise<void> {
  expect(await processListItemEmbed(seeded.job, deps)).toEqual({ status: 'archived' });
  expect(await itemRow(seeded.itemId)).toMatchObject({
    status: 'archived',
    archiveReason: 'source_unavailable',
    archivedAt: NOW,
  });
}

beforeEach(() => {
  listUpdated.mockReset().mockResolvedValue([]);
});

describe('list.updated (C127.12, F20, outcome 25)', () => {
  const updates = () => listUpdated.mock.calls.map((call) => call.slice(2) as unknown[]);

  it('comes when the embed makes a face matchable, and not before', async () => {
    const seeded = await pending();
    expect(listUpdated).not.toHaveBeenCalled();

    await processListItemEmbed(seeded.job, depsWith());

    expect(updates()).toEqual([
      [seeded.job.environmentId, [{ listId: seeded.listId, changeKind: 'items-added', items: 1 }]],
    ]);
  });

  it('comes when a background becomes matchable', async () => {
    const seeded = await pending('selfie-background');

    expect(await processListItemEmbed(seeded.job, depsWith())).toEqual({
      status: 'active',
    });

    expect(updates()).toEqual([
      [seeded.job.environmentId, [{ listId: seeded.listId, changeKind: 'items-added', items: 1 }]],
    ]);
  });

  it('comes when an item is archived for a source that is gone', async () => {
    const seeded = await pending();
    const vision = fakeVision();
    vision.answers.embedFace = embedFaceAnswer(null);

    expect(await processListItemEmbed(seeded.job, depsWith(vision.client))).toEqual({
      status: 'archived',
    });

    expect(updates()).toEqual([
      [
        seeded.job.environmentId,
        [{ listId: seeded.listId, changeKind: 'items-archived', items: 1 }],
      ],
    ]);
  });

  it('stays quiet when the job changes nothing', async () => {
    const seeded = await pending();
    await processListItemEmbed(seeded.job, depsWith());
    listUpdated.mockClear();

    expect(await processListItemEmbed(seeded.job, depsWith())).toEqual({ status: 'skipped' });

    expect(listUpdated).not.toHaveBeenCalled();
  });

  it('dispatches what it staged, after the commit', async () => {
    const seeded = await pending();
    const staged = { eventId: 'evt_synthetic', deliveries: [] };
    listUpdated.mockResolvedValue([staged]);
    const dispatch = vi.spyOn(events, 'dispatch');

    await processListItemEmbed(seeded.job, depsWith());

    expect(dispatch).toHaveBeenCalledWith([staged]);
  });
});

describe('a face item', () => {
  it('embeds the centre selfie and keeps its own sealed copy', async () => {
    const seeded = await pending();
    const vision = fakeVision();
    expect(await processListItemEmbed(seeded.job, depsWith(vision.client))).toEqual({
      status: 'active',
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['embed-face']);
    expect(vision.calls[0]?.images.image?.bytes).toEqual([...seeded.center]);
    const side = await faceRow(seeded.itemId);
    expect(side?.model).toBe('sface-2021dec');
    const opened = openValue(
      SEALED.listItemFaceTemplate,
      seeded.itemId,
      side?.templateSealed as Sealed,
    );
    expect(decodeFaceTemplate(opened).map((value) => value.toFixed(4))).toEqual(
      EMBEDDING.map((value) => value.toFixed(4)),
    );
    expect((await itemRow(seeded.itemId))?.status).toBe('active');
  });

  it('embeds a declined inquiry: Phase 4 deletes its template, the file stays', async () => {
    const seeded = await pending();
    await db.execute(sql`update inquiries set status = 'declined' where id = ${seeded.inquiryId}`);
    expect(await processListItemEmbed(seeded.job, depsWith())).toEqual({ status: 'active' });
  });

  it('wipes the decrypted selfie, whatever vision did', async () => {
    const seeded = await pending();
    const held: Uint8Array[] = [];
    const vision = fakeVision();
    await processListItemEmbed(
      seeded.job,
      depsWith({
        ...vision.client,
        embedFace: (input) => {
          held.push(input.image.bytes);
          return Promise.reject(new VisionUnavailableError('/v1/embed/face', 'network'));
        },
      }),
    ).catch(() => undefined);
    expect(held).toHaveLength(1);
    expect(held[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it('is source_unavailable when the file is gone', async () => {
    const seeded = await pending('face', { withoutFile: true });
    const vision = fakeVision();
    await expectUnavailable(seeded, depsWith(vision.client));
    expect(vision.calls).toEqual([]);
    expect(await listRow(seeded.listId)).toMatchObject({ itemCount: 0 });
  });

  it('is source_unavailable with no selfie left to read', async () => {
    const seeded = await pending('face', { fromRejectedHandoff: true });
    await expectUnavailable(seeded, depsWith());
  });

  it('is source_unavailable when vision finds no face', async () => {
    const seeded = await pending();
    const vision = fakeVision();
    vision.answers.embedFace = embedFaceAnswer(null);
    await expectUnavailable(seeded, depsWith(vision.client));
  });

  it('is source_unavailable when vision cannot read the image', async () => {
    const seeded = await pending();
    const vision = fakeVision();
    vision.answers.embedFace = new VisionServiceError('/v1/embed/face', 422, null);
    await expectUnavailable(seeded, depsWith(vision.client));
  });

  it('is source_unavailable once the consent no longer holds', async () => {
    const seeded = await pending();
    await db.execute(sql`
      update inquiry_sessions set consent = jsonb_set(consent, '{optional_text_keys}', '[]'::jsonb)
      where id = ${seeded.sessionId}`);
    const vision = fakeVision();
    await expectUnavailable(seeded, depsWith(vision.client));
    expect(vision.calls).toEqual([]);
  });

  it('stays pending through a vision outage, for BullMQ and the sweep', async () => {
    const seeded = await pending();
    const vision = fakeVision();
    vision.answers.embedFace = new VisionUnavailableError('/v1/embed/face', 'timeout');
    await expect(processListItemEmbed(seeded.job, depsWith(vision.client))).rejects.toBeInstanceOf(
      VisionUnavailableError,
    );
    expect((await itemRow(seeded.itemId))?.status).toBe('pending');
  });

  it('stays pending on an answer that breaks the contract, and gives up the attempt', async () => {
    const seeded = await pending();
    const vision = fakeVision();
    vision.answers.embedFace = new VisionServiceError('/v1/embed/face', 400, null);
    await expect(processListItemEmbed(seeded.job, depsWith(vision.client))).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    expect((await itemRow(seeded.itemId))?.status).toBe('pending');
  });
});

describe('a background item', () => {
  it('keeps the layout and the masked image, sealed for the item', async () => {
    const seeded = await pending('selfie-background');
    const vision = fakeVision();
    expect(await processListItemEmbed(seeded.job, depsWith(vision.client))).toEqual({
      status: 'active',
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie', 'mask-background']);
    const side = await backgroundRow(seeded.itemId);
    const layout = threePoseAnalysis().poses.center.background;
    expect(side).toMatchObject({ validCells: layout?.valid_cells, coverage: layout?.coverage });
    const ciphertext = await storage.get(side?.maskedFileKey ?? '');
    expect(ciphertext).not.toBeNull();
    expect(
      decryptBytes(
        {
          wrappedDek: side?.maskedFileWrappedDek ?? '',
          ciphertext: ciphertext ?? new Uint8Array(),
        },
        keyring,
        { context: seeded.itemId },
      ),
    ).toEqual(Buffer.from(FAKE_PNG));
  });

  it('is source_unavailable without a layout', async () => {
    const seeded = await pending('selfie-background');
    const vision = fakeVision();
    const analysis = threePoseAnalysis();
    analysis.poses.center = { ...analysis.poses.center, background: null };
    vision.answers.selfie = analysis;
    await expectUnavailable(seeded, depsWith(vision.client));
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie']);
  });

  it('is source_unavailable when the person hides the room', async () => {
    const seeded = await pending('selfie-background');
    const vision = fakeVision();
    const analysis = threePoseAnalysis();
    const { center } = analysis.poses;
    analysis.poses.center = {
      ...center,
      background: center.background === null ? null : { ...center.background, coverage: 0.1 },
    };
    vision.answers.selfie = analysis;
    await expectUnavailable(seeded, depsWith(vision.client));
  });

  it('is source_unavailable when the mask finds no face', async () => {
    const seeded = await pending('selfie-background');
    const vision = fakeVision();
    vision.answers.maskBackground = new VisionServiceError(
      '/v1/mask/background',
      422,
      'no_face_found',
    );
    await expectUnavailable(seeded, depsWith(vision.client));
  });

  it('never keeps the object of an item redacted while vision worked', async () => {
    const seeded = await pending('selfie-background');
    const before = new Set(storage.objects.keys());
    const vision = fakeVision();
    const client = {
      ...vision.client,
      maskBackground: async (input: { image: { bytes: Uint8Array; mimeType: string } }) => {
        await db.transaction((tx) =>
          biometricItemRedactor.redactBySource(tx, {
            environmentId: seeded.environmentId,
            inquiryId: seeded.inquiryId,
            at: NOW,
          }),
        );
        return vision.client.maskBackground(input as never);
      },
    };
    expect(await processListItemEmbed(seeded.job, depsWith(client))).toEqual({ status: 'skipped' });
    expect([...storage.objects.keys()].filter((key) => !before.has(key))).toEqual([]);
    expect(await backgroundRow(seeded.itemId)).toBeUndefined();
  });

  it('writes nothing once the basis was cleared while vision worked', async () => {
    const seeded = await pending('selfie-background');
    const before = new Set(storage.objects.keys());
    const vision = fakeVision();
    const client = {
      ...vision.client,
      maskBackground: async (input: { image: { bytes: Uint8Array; mimeType: string } }) => {
        await updateEnvironmentSettings(db, seeded.environmentId, {
          'biometric-lists-basis': null,
        });
        return vision.client.maskBackground(input as never);
      },
    };
    expect(await processListItemEmbed(seeded.job, depsWith(client))).toEqual({ status: 'skipped' });
    expect([...storage.objects.keys()].filter((key) => !before.has(key))).toEqual([]);
    expect((await itemRow(seeded.itemId))?.status).toBe('pending');
  });
});

describe('what a failed commit leaves', () => {
  it('deletes the object when the commit fails, and stays pending', async () => {
    const seeded = await pending('selfie-background');
    const before = new Set(storage.objects.keys());
    const failing = new Proxy(db, {
      get: (target, member) =>
        member === 'transaction'
          ? () => Promise.reject(new Error('the database is away'))
          : (Reflect.get(target, member) as unknown),
    });
    await expect(processListItemEmbed(seeded.job, { ...depsWith(), db: failing })).rejects.toThrow(
      'the database is away',
    );
    expect([...storage.objects.keys()].filter((key) => !before.has(key))).toEqual([]);
    expect((await itemRow(seeded.itemId))?.status).toBe('pending');
  });

  it('writes nothing for an inquiry redacted while vision worked', async () => {
    const seeded = await pending();
    const vision = fakeVision();
    const client = {
      ...vision.client,
      embedFace: async (input: Parameters<typeof vision.client.embedFace>[0]) => {
        await db.execute(
          sql`update inquiries set redacted_at = now() where id = ${seeded.inquiryId}`,
        );
        return vision.client.embedFace(input);
      },
    };
    expect(await processListItemEmbed(seeded.job, depsWith(client))).toEqual({ status: 'skipped' });
    expect((await faceRow(seeded.itemId))?.templateSealed).toBeNull();
  });
});

describe('what the job leaves alone', () => {
  it('skips an item it cannot find', async () => {
    const seeded = await pending();
    expect(
      await processListItemEmbed(
        { environmentId: seeded.environmentId, itemId: testId('lifc') },
        depsWith(),
      ),
    ).toEqual({ status: 'skipped' });
  });

  it('skips an item that is already active, so a repeated job changes nothing', async () => {
    const seeded = await pending();
    await processListItemEmbed(seeded.job, depsWith());
    const version = (await listRow(seeded.listId))?.version;
    expect(await processListItemEmbed(seeded.job, depsWith())).toEqual({ status: 'skipped' });
    expect((await listRow(seeded.listId))?.version).toBe(version);
  });

  it('skips an item of an archived list, which matches nothing', async () => {
    const seeded = await pending();
    await db
      .update(lists)
      .set({ status: 'archived', archivedAt: NOW })
      .where(eq(lists.id, seeded.listId));
    const vision = fakeVision();
    expect(await processListItemEmbed(seeded.job, depsWith(vision.client))).toEqual({
      status: 'skipped',
    });
    expect(vision.calls).toEqual([]);
  });
});

describe('purging a masked object (C97.4)', () => {
  async function cleared(seeded: Seeded): Promise<void> {
    await db.transaction((tx) =>
      onSettingsChangedInTx(
        tx,
        seeded.environmentId,
        { 'biometric-lists-basis': BASIS },
        { 'biometric-lists-basis': null },
      ),
    );
  }

  it('deletes the object, then its row', async () => {
    const seeded = await pending('selfie-background');
    await processListItemEmbed(seeded.job, depsWith());
    const key = (await backgroundRow(seeded.itemId))?.maskedFileKey ?? '';
    await cleared(seeded);
    expect(await storage.get(key)).not.toBeNull();
    expect(await processListItemEmbed(seeded.job, depsWith())).toEqual({ status: 'purged' });
    expect(await storage.get(key)).toBeNull();
    expect(await backgroundRow(seeded.itemId)).toBeUndefined();
  });

  it('keeps the row when storage fails, so the sweep comes back', async () => {
    const seeded = await pending('selfie-background');
    await processListItemEmbed(seeded.job, depsWith());
    await cleared(seeded);
    const failing = {
      ...storage,
      delete: () => Promise.reject(new Error('storage is down')),
    };
    await expect(
      processListItemEmbed(seeded.job, { ...depsWith(), storage: failing }),
    ).rejects.toThrow('storage is down');
    expect(await backgroundRow(seeded.itemId)).toBeDefined();
  });
});

describe('the sweep (C99.7, C107.1)', () => {
  const sweep = async (environmentId: string, now = NOW) => {
    const jobs: ListItemEmbedJob[] = [];
    await runListItemEmbedSweep({
      db,
      clock: { now: () => now },
      logger,
      events,
      embeds: {
        enqueueListItemEmbed: (job) => {
          jobs.push(job);
          return Promise.resolve();
        },
      },
    });
    return jobs.filter((job) => job.environmentId === environmentId);
  };

  it('enqueues what is pending, so a lost enqueue recovers', async () => {
    const seeded = await pending();
    expect(await sweep(seeded.environmentId)).toEqual([seeded.job]);
    await processListItemEmbed(seeded.job, depsWith());
    expect(await sweep(seeded.environmentId)).toEqual([]);
  });

  it('enqueues a masked object left to purge', async () => {
    const seeded = await pending('selfie-background');
    await processListItemEmbed(seeded.job, depsWith());
    await db.transaction((tx) =>
      onSettingsChangedInTx(
        tx,
        seeded.environmentId,
        { 'biometric-lists-basis': BASIS },
        { 'biometric-lists-basis': null },
      ),
    );
    expect(await sweep(seeded.environmentId)).toEqual([seeded.job]);
  });

  it('stages what it redacted past its window', async () => {
    const { itemId, listId, job } = await pending();
    await processListItemEmbed(job, depsWith());
    await db.execute(sql`update list_items set created_at = '2020-01-01' where id = ${itemId}`);
    listUpdated.mockClear();

    await sweep(job.environmentId);

    expect(listUpdated.mock.calls.flatMap((call) => call[3] as unknown[])).toContainEqual({
      listId,
      changeKind: 'items-redacted',
      items: 1,
    });
  });

  it('redacts an item past its consent window, and then purges its object', async () => {
    const seeded = await pending('selfie-background');
    await processListItemEmbed(seeded.job, depsWith());
    await db.update(lists).set({ itemRetentionDays: 3650 }).where(eq(lists.id, seeded.listId));
    await updateEnvironmentSettings(db, seeded.environmentId, {
      'face-template-retention-days': 30,
    });
    const after = new Date(Date.UTC(2027, 0, 1));
    expect(await sweep(seeded.environmentId, after)).toEqual([seeded.job]);
    expect(await itemRow(seeded.itemId)).toMatchObject({ status: 'archived', redactedAt: after });
    expect(await backgroundRow(seeded.itemId)).toMatchObject({ layout: null });
    expect(await processListItemEmbed(seeded.job, depsWith())).toEqual({ status: 'purged' });
    expect(await getBiometricItem(db, seeded.environmentId, seeded.itemId)).toBeNull();
  });

  it('redacts a face past its window at once: it has no object', async () => {
    const seeded = await pending();
    await processListItemEmbed(seeded.job, depsWith());
    await db.update(lists).set({ itemRetentionDays: 3650 }).where(eq(lists.id, seeded.listId));
    await updateEnvironmentSettings(db, seeded.environmentId, {
      'face-template-retention-days': 30,
    });
    expect(await sweep(seeded.environmentId, new Date(Date.UTC(2027, 0, 1)))).toEqual([]);
    expect(await faceRow(seeded.itemId)).toBeUndefined();
  });

  it('goes on past a failed enqueue, and names no value in its log', async () => {
    const seeded = await pending();
    await runListItemEmbedSweep({
      db,
      clock: { now: () => NOW },
      logger,
      events,
      embeds: { enqueueListItemEmbed: () => Promise.reject(new Error('the queue is down')) },
    });
    expect(JSON.stringify(logger.entries)).not.toContain('the queue is down');
    expect(await sweep(seeded.environmentId)).toEqual([seeded.job]);
  });
});

describe('a transition does not stop the job', () => {
  it('embeds a completed inquiry', async () => {
    const seeded = await pending();
    await transitionInquiryStatus(db, seeded.environmentId, seeded.inquiryId, {
      from: 'pending',
      to: 'completed',
    });
    expect(await processListItemEmbed(seeded.job, depsWith())).toEqual({ status: 'active' });
  });
});
