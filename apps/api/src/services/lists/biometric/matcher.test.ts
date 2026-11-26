/**
 * C99.7 (Workflow 7B): the matcher, on PGlite. Vision is a fake, embeddings are seeded unit vectors
 * at a chosen cosine, and images are random bytes. No face reaches this file.
 */
import {
  archiveList,
  completeListItemBackground,
  completeListItemFace,
  encodeFaceTemplate,
  encryptBytes,
  insertBiometricListItem,
  listItemFaces,
  listItems,
  lists,
  redactBiometricLists,
  sealValue,
  SEALED,
  type BiometricListKind,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  threePoseAnalysis,
  unitVector,
  vectorAtCosine,
} from '../../../jobs/selfie-testing.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  embedFaceAnswer,
  FAKE_PNG,
  noBackgroundMatch,
} from '../../../jobs/testing.js';
import type { BiometricListSelection, SelfieAnalysis } from '../../../ports.js';
import { VisionServiceError, VisionUnavailableError } from '../../../vision/index.js';
import { createBiometricCache } from './cache.js';
import { createBiometricListMatcher, type WorkerBiometricListMatcher } from './matcher.js';
import { seedSelfieSource, type SelfieSource, type SelfieSourceOptions } from './testing.js';
import { BACKGROUND_MIN_INLIERS, BACKGROUND_MIN_INLIER_RATIO, FACE_LIST_THRESHOLD } from './thresholds.js';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const closeTo = (value: number, digits: number) => expect.closeTo(value, digits) as number;
const MODEL = 'sface-2021dec';
const PROBE = unitVector(21);

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
  fake.answers.selfie = analysisWith(PROBE);
  fake.answers.embedFace = embedFaceAnswer({ bbox: [1, 2, 3, 4], score: 0.9, embedding: PROBE });
  fake.answers.compareBackground = noBackgroundMatch;
  return fake;
}

function analysisWith(embedding: readonly number[]): SelfieAnalysis {
  const analysis = threePoseAnalysis();
  const { center } = analysis.poses;
  analysis.poses.center = {
    ...center,
    face: center.face === null ? null : { ...center.face, embedding },
  };
  return analysis;
}

function matcherWith(
  vision = fakeVision().client,
  options: { cache?: ReturnType<typeof createBiometricCache> } = {},
): WorkerBiometricListMatcher {
  return createBiometricListMatcher({
    db,
    clock: { now: () => NOW },
    logger,
    storage,
    keyring,
    vision,
    schedule: () => () => undefined,
    ...options,
  });
}

const probed = (options: SelfieSourceOptions = {}) =>
  seedSelfieSource({ db, keyring, storage }, options);

async function listOf(
  environmentId: string,
  kind: BiometricListKind = 'face',
): Promise<BiometricListSelection> {
  const { id } = await seedList(db, environmentId, { kind });
  return { id, kind, version: 1 };
}

/** A list's item from its own source inquiry, as the job leaves it. */
async function pendingItem(environmentId: string, list: BiometricListSelection): Promise<string> {
  const source = await probed({ environmentId });
  const itemId = testId(list.kind === 'face' ? 'lifc' : 'lisb');
  await insertBiometricListItem(db, environmentId, {
    itemId,
    listId: list.id,
    kind: list.kind,
    sourceInquiryId: source.inquiryId,
    normaliserVersion: 'lists-1',
    creator: null,
  });
  return itemId;
}

async function faceItem(
  environmentId: string,
  list: BiometricListSelection,
  embedding: readonly number[],
  model = MODEL,
): Promise<string> {
  const itemId = await pendingItem(environmentId, list);
  await completeListItemFace(db, environmentId, { itemId, embedding, model });
  return itemId;
}

async function backgroundItem(
  environmentId: string,
  list: BiometricListSelection,
  value = 50,
  options: { withoutObject?: boolean } = {},
): Promise<string> {
  const itemId = await pendingItem(environmentId, list);
  const maskedFileKey = `${environmentId}/masked-${itemId}`;
  const sealed = encryptBytes(FAKE_PNG, keyring, { context: itemId });
  if (options.withoutObject !== true) {
    await storage.put(maskedFileKey, sealed.ciphertext);
  }
  await completeListItemBackground(db, environmentId, {
    itemId,
    layout: Array.from({ length: 144 }, () => value),
    validCells: '1'.repeat(48),
    coverage: 0.9,
    maskedFileKey,
    maskedFileWrappedDek: sealed.wrappedDek,
  });
  return itemId;
}

const selection = async (list: BiometricListSelection) => {
  const [row] = await db.select().from(lists).where(eq(lists.id, list.id));
  return { ...list, version: row?.version ?? list.version };
};

const matching = (
  matcher: WorkerBiometricListMatcher,
  source: SelfieSource,
  selected: readonly BiometricListSelection[],
  lastAttempt?: boolean,
) =>
  matcher.match({
    environmentId: source.environmentId,
    inquiryId: source.inquiryId,
    lists: selected,
    ...(lastAttempt === undefined ? {} : { lastAttempt }),
  });

describe('consent and the selfie (C99.7)', () => {
  it('needs the probed inquiry to have ticked biometric matching', async () => {
    const source = await probed({ consent: [] });
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const vision = fakeVision();
    expect(await matching(matcherWith(vision.client), source, [list])).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'consent_not_given' }],
      compared: [],
    });
    expect(vision.calls).toEqual([]);
  });

  it('reads a redacted inquiry as no consent', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await db.execute(sql`update inquiries set redacted_at = now() where id = ${source.inquiryId}`);
    expect((await matching(matcherWith(), source, [list])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'consent_not_given' },
    ]);
  });

  it('reads an inquiry with no selfie as not applicable, never partial (H16)', async () => {
    const source = await probed({ status: 'requires_retry' });
    const list = await listOf(source.environmentId);
    const vision = fakeVision();
    expect(await matching(matcherWith(vision.client), source, [list])).toEqual({
      matches: [],
      unscreened: [],
      compared: [],
      notApplicable: [{ 'list-id': list.id, reason: 'subject_has_no_value' }],
    });
    expect(vision.calls).toEqual([]);
  });

  it('never probes the selfie of a rejected handoff (C96.3)', async () => {
    const source = await probed({ fromRejectedHandoff: true });
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    expect((await matching(matcherWith(), source, [list])).notApplicable).toEqual([
      { 'list-id': list.id, reason: 'subject_has_no_value' },
    ]);
  });

  it('never reads "no match" when the selfie cannot be read', async () => {
    const source = await probed({ withoutFile: true });
    const list = await listOf(source.environmentId);
    expect((await matching(matcherWith(), source, [list])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'probe_unavailable' },
    ]);
  });

  it('never reads "no match" when vision finds no face', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const vision = fakeVision();
    vision.answers.embedFace = embedFaceAnswer(null);
    expect((await matching(matcherWith(vision.client), source, [list])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'probe_unavailable' },
    ]);
  });

  it('never reads "no match" for an image vision cannot read', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const vision = fakeVision();
    vision.answers.embedFace = new VisionServiceError('/v1/embed/face', 422, null);
    expect((await matching(matcherWith(vision.client), source, [list])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'probe_unavailable' },
    ]);
  });

  it('wipes the decrypted selfie', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const held: Uint8Array[] = [];
    const vision = fakeVision();
    await matching(
      matcherWith({
        ...vision.client,
        embedFace: (input) => {
          held.push(input.image.bytes);
          return vision.client.embedFace(input);
        },
      }),
      source,
      [list],
    );
    expect(held[0]?.every((byte) => byte === 0)).toBe(true);
  });
});

describe('a vision outage (C30.3)', () => {
  it('rejects for the retry while the job has attempts left', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const vision = fakeVision();
    vision.answers.embedFace = new VisionUnavailableError('/v1/embed/face', 'timeout');
    await expect(
      matching(matcherWith(vision.client), source, [list], false),
    ).rejects.toBeInstanceOf(VisionUnavailableError);
  });

  it('records the list as unscreened on the last attempt, and by default', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const vision = fakeVision();
    vision.answers.embedFace = new VisionUnavailableError('/v1/embed/face', 'timeout');
    for (const lastAttempt of [true, undefined]) {
      expect(
        (await matching(matcherWith(vision.client), source, [list], lastAttempt)).unscreened,
      ).toEqual([{ 'list-id': list.id, reason: 'probe_unavailable' }]);
    }
  });
});

describe('faces (C99.7)', () => {
  it('matches at the threshold, states the count and the best score, and is advisory', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const near = await faceItem(
      source.environmentId,
      list,
      vectorAtCosine(PROBE, 3, FACE_LIST_THRESHOLD + 0.1),
    );
    await faceItem(source.environmentId, list, vectorAtCosine(PROBE, 4, FACE_LIST_THRESHOLD - 0.2));
    const current = await selection(list);
    const outcome = await matching(matcherWith(), source, [current]);
    expect(outcome.matches).toEqual([
      {
        listId: list.id,
        listItemId: near,
        listVersion: current.version,
        method: 'face_cosine',
        score: closeTo(FACE_LIST_THRESHOLD + 0.1, 3),
      },
    ]);
    expect(outcome.compared).toEqual([
      { listId: list.id, compared: 2, bestScore: closeTo(FACE_LIST_THRESHOLD + 0.1, 3) },
    ]);
    expect(outcome.unscreened).toEqual([]);
  });

  it('holds a score to the unit interval of the contract', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const { matches } = await matching(matcherWith(), source, [await selection(list)]);
    expect(matches[0]?.score).toBeLessThanOrEqual(1);
    expect(matches[0]?.score).toBeGreaterThan(0.99);
  });

  it('matches a declined source whose template is gone, through its own copy', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const item = await faceItem(source.environmentId, list, PROBE);
    await db.execute(sql`
      update inquiries set status = 'declined'
      where id = (select source_inquiry_id from list_item_faces where item_id = ${item})`);
    const { matches } = await matching(matcherWith(), source, [await selection(list)]);
    expect(matches.map((match) => match.listItemId)).toEqual([item]);
  });

  it('reads an empty list as compared, with no best score', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    expect(await matching(matcherWith(), source, [list])).toEqual({
      matches: [],
      unscreened: [],
      compared: [{ listId: list.id, compared: 0, bestScore: null }],
    });
  });

  it('never reads "no match" past an item another model embedded', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const current = await faceItem(source.environmentId, list, PROBE);
    await faceItem(source.environmentId, list, PROBE, 'sface-older');
    const outcome = await matching(matcherWith(), source, [await selection(list)]);
    expect(outcome.matches.map((match) => match.listItemId)).toEqual([current]);
    expect(outcome.unscreened).toEqual([{ 'list-id': list.id, reason: 'normaliser_outdated' }]);
    expect(outcome.compared).toMatchObject([{ compared: 1 }]);
  });

  it('never reads "no match" past a pending item (C99.8)', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await pendingItem(source.environmentId, list);
    expect((await matching(matcherWith(), source, [await selection(list)])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'list_items_pending' },
    ]);
  });

  it('never reads "no match" for a template that cannot be opened', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const item = await faceItem(source.environmentId, list, PROBE);
    await db
      .update(listItemFaces)
      .set({
        templateSealed: sealValue(
          SEALED.listItemFaceTemplate,
          testId('lifc'),
          encodeFaceTemplate(PROBE),
        ),
      })
      .where(eq(listItemFaces.itemId, item));
    expect((await matching(matcherWith(), source, [await selection(list)])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'probe_unavailable' },
    ]);
  });
});

describe('the lists it was given', () => {
  it('reads an archived list as list_archived and screens the rest', async () => {
    const source = await probed();
    const archived = await listOf(source.environmentId);
    const open = await listOf(source.environmentId);
    await archiveList(db, source.environmentId, archived.id, NOW);
    const outcome = await matching(matcherWith(), source, [archived, open]);
    expect(outcome.unscreened).toEqual([{ 'list-id': archived.id, reason: 'list_archived' }]);
    expect(outcome.compared.map((entry) => entry.listId)).toEqual([open.id]);
  });

  it('never reads a list of another environment', async () => {
    const source = await probed();
    const stranger = await listOf((await createTestTenant(db)).environment.id);
    const vision = fakeVision();
    expect(await matching(matcherWith(vision.client), source, [stranger])).toEqual({
      matches: [],
      unscreened: [{ 'list-id': stranger.id, reason: 'list_archived' }],
      compared: [],
    });
    expect(vision.calls).toEqual([]);
  });

  it('answers nothing for no list', async () => {
    const source = await probed();
    expect(await matching(matcherWith(), source, [])).toEqual({
      matches: [],
      unscreened: [],
      compared: [],
    });
  });
});

describe('backgrounds (C99.7)', () => {
  const confirmed = (candidates: number) => ({
    results: Array.from({ length: candidates }, (_, index) => ({
      index,
      good_matches: 400,
      inliers: index === 0 ? BACKGROUND_MIN_INLIERS : BACKGROUND_MIN_INLIERS - 1,
      inlier_ratio: index === 0 ? BACKGROUND_MIN_INLIER_RATIO + 0.2 : 0.9,
    })),
  });

  it('confirms the nearest layouts by ORB, and only the confirmed match', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    const layout = threePoseAnalysis().poses.center.background?.layout ?? [];
    const near = await backgroundItem(source.environmentId, list, layout[0] ?? 50);
    await backgroundItem(source.environmentId, list, (layout[0] ?? 50) + 80);
    const vision = fakeVision();
    vision.answers.compareBackground = confirmed;
    const current = await selection(list);
    const outcome = await matching(matcherWith(vision.client), source, [current]);
    expect(outcome.matches).toEqual([
      {
        listId: list.id,
        listItemId: near,
        listVersion: current.version,
        method: 'background',
        score: closeTo(BACKGROUND_MIN_INLIER_RATIO + 0.2, 4),
      },
    ]);
    expect(outcome.compared).toEqual([
      { listId: list.id, compared: 2, bestScore: closeTo(0.9, 4) },
    ]);
  });

  it('sends vision the masked images, decrypted, as candidates', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    await backgroundItem(source.environmentId, list);
    const vision = fakeVision();
    await matching(matcherWith(vision.client), source, [await selection(list)]);
    const compare = vision.calls.find((call) => call.endpoint === 'compare-background');
    expect(compare?.images.candidate_0).toEqual({
      mimeType: 'image/png',
      bytes: [...FAKE_PNG],
    });
  });

  it('compares at most five candidates', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    for (let index = 0; index < 7; index += 1) {
      await backgroundItem(source.environmentId, list, index);
    }
    const vision = fakeVision();
    const outcome = await matching(matcherWith(vision.client), source, [await selection(list)]);
    const compare = vision.calls.find((call) => call.endpoint === 'compare-background');
    expect(Object.keys(compare?.images ?? {}).filter((key) => key.startsWith('candidate'))).toHaveLength(5);
    expect(outcome.compared).toMatchObject([{ compared: 5 }]);
  });

  it('is too coarse when the person hides the room, never "no match"', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    const vision = fakeVision();
    const analysis = analysisWith(PROBE);
    const { center } = analysis.poses;
    analysis.poses.center = {
      ...center,
      background: center.background === null ? null : { ...center.background, coverage: 0.1 },
    };
    vision.answers.selfie = analysis;
    expect((await matching(matcherWith(vision.client), source, [list])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'probe_too_coarse' },
    ]);
  });

  it('never reads "no match" without a layout', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    const vision = fakeVision();
    const analysis = analysisWith(PROBE);
    analysis.poses.center = { ...analysis.poses.center, background: null };
    vision.answers.selfie = analysis;
    expect((await matching(matcherWith(vision.client), source, [list])).unscreened).toEqual([
      { 'list-id': list.id, reason: 'probe_unavailable' },
    ]);
  });

  it('never reads "no match" past a masked object it could not read', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    await backgroundItem(source.environmentId, list, 50, { withoutObject: true });
    await backgroundItem(source.environmentId, list, 51);
    const outcome = await matching(matcherWith(), source, [await selection(list)]);
    expect(outcome.unscreened).toEqual([{ 'list-id': list.id, reason: 'probe_unavailable' }]);
    expect(outcome.compared).toMatchObject([{ compared: 1 }]);
  });

  it('never reads "no match" when no candidate could be read', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    await backgroundItem(source.environmentId, list, 50, { withoutObject: true });
    const vision = fakeVision();
    const outcome = await matching(matcherWith(vision.client), source, [await selection(list)]);
    expect(outcome.unscreened).toEqual([{ 'list-id': list.id, reason: 'probe_unavailable' }]);
    expect(vision.calls.map((call) => call.endpoint)).not.toContain('compare-background');
  });

  it('never reads "no match" when the comparison fails for good', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    await backgroundItem(source.environmentId, list);
    const vision = fakeVision();
    vision.answers.compareBackground = new VisionUnavailableError(
      '/v1/compare/background',
      'timeout',
    );
    expect(
      (await matching(matcherWith(vision.client), source, [await selection(list)])).unscreened,
    ).toEqual([{ 'list-id': list.id, reason: 'probe_unavailable' }]);
  });

  it('wipes the masked images it decrypted', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId, 'selfie-background');
    await backgroundItem(source.environmentId, list);
    const held: Uint8Array[] = [];
    const vision = fakeVision();
    await matching(
      matcherWith({
        ...vision.client,
        compareBackground: (input) => {
          held.push(...input.candidates.map(({ bytes }) => bytes));
          return vision.client.compareBackground(input);
        },
      }),
      source,
      [await selection(list)],
    );
    expect(held[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it('takes both probes from one selfie analysis', async () => {
    const source = await probed();
    const faces = await listOf(source.environmentId);
    const rooms = await listOf(source.environmentId, 'selfie-background');
    await faceItem(source.environmentId, faces, PROBE);
    const vision = fakeVision();
    const outcome = await matching(matcherWith(vision.client), source, [faces, rooms]);
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie']);
    expect(outcome.compared.map((entry) => entry.listId)).toEqual([faces.id, rooms.id]);
    expect(outcome.matches).toHaveLength(1);
  });

  it('reads no probe from an analysis without a face', async () => {
    const source = await probed();
    const faces = await listOf(source.environmentId);
    const rooms = await listOf(source.environmentId, 'selfie-background');
    const vision = fakeVision();
    const analysis = analysisWith(PROBE);
    analysis.poses.center = { ...analysis.poses.center, face: null };
    vision.answers.selfie = analysis;
    expect((await matching(matcherWith(vision.client), source, [faces, rooms])).unscreened).toEqual([
      { 'list-id': faces.id, reason: 'probe_unavailable' },
    ]);
  });
});

describe('the decrypted cache (C99.7, P08)', () => {
  it('compares from the cache on the second read of one version', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const matcher = matcherWith();
    const current = await selection(list);
    await matching(matcher, source, [current]);
    await matching(matcher, source, [current]);
    expect(matcher.cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
  });

  it('reads again when an item moves the version', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, vectorAtCosine(PROBE, 5, 0.1));
    const matcher = matcherWith();
    expect((await matching(matcher, source, [list])).matches).toEqual([]);
    const added = await faceItem(source.environmentId, list, PROBE);
    const { matches } = await matching(matcher, source, [list]);
    expect(matches.map((match) => match.listItemId)).toEqual([added]);
    expect(matcher.cache.stats().misses).toBe(2);
  });

  it('wipes a list too large to hold, once it is scored', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const cache = createBiometricCache({
      maxBytes: 10,
      idleMs: 600_000,
      clock: { now: () => NOW },
    });
    const outcome = await matching(matcherWith(undefined, { cache }), source, [list]);
    expect(outcome.matches).toHaveLength(1);
    expect(cache.stats().entries).toBe(0);
  });

  it('evicts a list a match finds archived', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const matcher = matcherWith();
    await matching(matcher, source, [list]);
    await archiveList(db, source.environmentId, list.id, NOW);
    await matching(matcher, source, [list]);
    expect(matcher.cache.stats().entries).toBe(0);
  });

  it('drops a list on the check when the basis is cleared, with no match at all', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const matcher = matcherWith();
    await matching(matcher, source, [list]);
    expect(matcher.cache.stats().entries).toBe(1);
    await redactBiometricLists(db, source.environmentId, NOW);
    await matcher.checkCache();
    expect(matcher.cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('drops a list on the check when an item is redacted', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const matcher = matcherWith();
    await matching(matcher, source, [list]);
    await db.execute(sql`update lists set version = version + 1 where id = ${list.id}`);
    await matcher.checkCache();
    expect(matcher.cache.stats().entries).toBe(0);
  });

  it('drops an idle list on the check', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    let now = NOW.getTime();
    const clock = { now: () => new Date(now) };
    const cache = createBiometricCache({ maxBytes: 1_000_000, idleMs: 600_000, clock });
    const matcher = matcherWith(undefined, { cache });
    await matching(matcher, source, [list]);
    now += 600_000;
    await matcher.checkCache();
    expect(cache.stats().entries).toBe(0);
  });

  it('drops everything when the check cannot read the lists', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const matcher = matcherWith();
    await matching(matcher, source, [list]);
    const broken = createBiometricListMatcher({
      db: { select: () => { throw new Error('the database is away'); } } as unknown as Db,
      clock: { now: () => NOW },
      logger,
      storage,
      keyring,
      vision: fakeVision().client,
      cache: matcher.cache,
      schedule: () => () => undefined,
    });
    await broken.checkCache();
    expect(matcher.cache.stats().entries).toBe(0);
  });

  it('runs the check only while it holds something', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    await faceItem(source.environmentId, list, PROBE);
    const checks: (() => void)[] = [];
    let stopped = 0;
    const matcher = createBiometricListMatcher({
      db,
      clock: { now: () => NOW },
      logger,
      storage,
      keyring,
      vision: fakeVision().client,
      schedule: (check) => {
        checks.push(check);
        return () => {
          stopped += 1;
        };
      },
    });
    expect(checks).toHaveLength(0);
    await matching(matcher, source, [list]);
    await matching(matcher, source, [list]);
    expect(checks).toHaveLength(1);
    await redactBiometricLists(db, source.environmentId, NOW);
    await matcher.checkCache();
    expect(stopped).toBe(1);
  });
});

describe('a redacted item', () => {
  it('is not compared', async () => {
    const source = await probed();
    const list = await listOf(source.environmentId);
    const item = await faceItem(source.environmentId, list, PROBE);
    await db
      .update(listItems)
      .set({ status: 'archived', archivedAt: NOW })
      .where(eq(listItems.id, item));
    expect((await matching(matcherWith(), source, [list])).matches).toEqual([]);
  });
});
