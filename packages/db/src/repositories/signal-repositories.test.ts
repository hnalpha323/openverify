/**
 * Workflow 7A Stage 3 (`api-signals`; C90.5, C91.1, C91.2, C91.5, C94.2, C94.4, C94.5): the signal
 * and device repositories.
 *
 * - The flow signal bodies: sealed per `(session, sequence)`, a repeat ignored, at most 200 stored
 *   per session and the rest counted in `signal_bodies_dropped`; read back opened, by session then
 *   sequence; the tiers that applied kept once each.
 * - The signals outbox: the sweep's pending rows (oldest first, not enqueued recently), the job's
 *   lock, freeze, skip and failure count.
 * - Devices: found or created by HMAC and key id, one device per session, the parsed device
 *   fields, the SDK's device type, the canonical identifier inputs and the rebuild under a new key.
 *
 * Every value is synthetic; every HMAC comes from a synthetic key.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { blindIndexKeyId, identifierKey } from '../blind-index.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  openSessionSignalBodies,
  seedSessionSignalBody,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  completeSignalComputation,
  countInquirySessions,
  createInquirySession,
  createSignalComputation,
  deviceIdentifierInputs,
  expireInquirySession,
  getDevice,
  getInquiry,
  getInquirySession,
  linkSessionDevice,
  listPendingSignalComputations,
  listSessionDevices,
  listSessionSignalBodies,
  lockPendingSignalComputation,
  markInquirySessionStarted,
  markSignalComputationsEnqueued,
  rebuildDeviceIndexes,
  recordSdkSessionDeviceType,
  recordSessionDeviceFields,
  recordSessionSignalsCollected,
  nextSessionSignalSequence,
  recordSignalComputationFailure,
  skipSignalComputation,
  storeSessionSignalBody,
  type SessionDeviceWrite,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2027-02-01T10:00:00.000Z');
const KEY = new Uint8Array(randomBytes(32));
const OTHER_KEY = new Uint8Array(randomBytes(32));

async function seedSessions(count = 1, kind: 'sandbox' | 'production' = 'sandbox') {
  const { environment } = await createTestTenant(database.db, { kind });
  const env = environment.id;
  const { inquiry } = await createTestInquiry(database.db, env);
  const sessionIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const session = await createInquirySession(database.db, env, {
      id: testId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
      expiresAt: new Date(AT.getTime() + 3_600_000),
    });
    sessionIds.push(session.id);
  }
  return { env, inquiryId: inquiry.id, sessionIds };
}

const body = (
  inquirySessionId: string,
  sequence: number,
  overrides: Partial<Parameters<typeof storeSessionSignalBody>[2]> = {},
) => ({
  inquirySessionId,
  sequence,
  screen: 'start',
  platform: 'web' as const,
  collectorVersion: 1,
  components: { integrity: { webdriver: false } },
  behaviour: { 'paste-count': sequence },
  at: AT,
  ...overrides,
});

async function droppedOf(sessionId: string): Promise<number> {
  const { rows } = await database.client.query<{ dropped: number }>(
    'select signal_bodies_dropped as dropped from inquiry_sessions where id = $1',
    [sessionId],
  );
  return rows[0]?.dropped ?? -1;
}

describe('nextSessionSignalSequence (K7A-7)', () => {
  it('answers 0 for a new session, then one past the highest stored sequence and the counted bodies', async () => {
    const { env, sessionIds } = await seedSessions();
    const [session = ''] = sessionIds;

    await expect(nextSessionSignalSequence(database.db, env, session)).resolves.toBe(0);
    await storeSessionSignalBody(database.db, env, body(session, 9));
    await storeSessionSignalBody(database.db, env, body(session, 4));
    await expect(nextSessionSignalSequence(database.db, env, session)).resolves.toBe(10);
    await database.client.query(
      'update inquiry_sessions set signal_bodies_dropped = 2 where id = $1',
      [session],
    );
    await expect(nextSessionSignalSequence(database.db, env, session)).resolves.toBe(12);
  });
});

describe('storeSessionSignalBody (C94.2, P23, V15)', () => {
  it('seals both members for the row, ignores a repeated sequence and keeps the first body', async () => {
    const { env, sessionIds } = await seedSessions();
    const [session = ''] = sessionIds;
    await expect(storeSessionSignalBody(database.db, env, body(session, 3))).resolves.toBe(
      'stored',
    );
    await expect(
      storeSessionSignalBody(database.db, env, body(session, 3, { behaviour: { other: 1 } })),
    ).resolves.toBe('repeated');
    const { rows } = await database.client.query<{ components: string; behaviour: string }>(
      'select components, behaviour from inquiry_session_signals where inquiry_session_id = $1',
      [session],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.components).not.toContain('webdriver');
    expect(await openSessionSignalBodies(database.db, env, session)).toEqual([
      {
        sequence: 3,
        components: { integrity: { webdriver: false } },
        behaviour: { 'paste-count': 3 },
      },
    ]);
    expect(await droppedOf(session)).toBe(0);
  });

  it('stores null members as null', async () => {
    const { env, sessionIds } = await seedSessions();
    const [session = ''] = sessionIds;
    await storeSessionSignalBody(
      database.db,
      env,
      body(session, 0, { components: null, behaviour: null }),
    );
    expect(await openSessionSignalBodies(database.db, env, session)).toEqual([
      { sequence: 0, components: null, behaviour: null },
    ]);
  });

  it('stores 200 bodies per session and counts the 201st and later ones, never storing them', async () => {
    const { env, sessionIds } = await seedSessions(2);
    const [session = '', other = ''] = sessionIds;
    for (let sequence = 0; sequence < 200; sequence += 1) {
      await seedSessionSignalBody(database.db, env, { inquirySessionId: session, sequence });
    }
    await expect(storeSessionSignalBody(database.db, env, body(session, 200))).resolves.toBe(
      'dropped',
    );
    await expect(storeSessionSignalBody(database.db, env, body(session, 201))).resolves.toBe(
      'dropped',
    );
    // A repeat of a stored sequence is a repeat, not a drop.
    await expect(storeSessionSignalBody(database.db, env, body(session, 5))).resolves.toBe(
      'repeated',
    );
    expect(await droppedOf(session)).toBe(2);
    // The cap is per session.
    await expect(storeSessionSignalBody(database.db, env, body(other, 0))).resolves.toBe('stored');
    const { rows } = await database.client.query<{ count: number }>(
      'select count(*)::int as count from inquiry_session_signals where inquiry_session_id = $1',
      [session],
    );
    expect(rows[0]?.count).toBe(200);
  });

  it('stores nothing for a session of another environment', async () => {
    const { sessionIds } = await seedSessions();
    const other = await seedSessions();
    await expect(
      storeSessionSignalBody(database.db, other.env, body(sessionIds[0] ?? '', 0)),
    ).rejects.toThrow();
  });
});

describe('listSessionSignalBodies (C90.4)', () => {
  it('opens the bodies of the sessions asked for, by session id then sequence', async () => {
    const { env, sessionIds } = await seedSessions(3);
    const [a = '', b = '', c = ''] = [...sessionIds].sort();
    await storeSessionSignalBody(database.db, env, body(b, 2));
    await storeSessionSignalBody(database.db, env, body(a, 1));
    await storeSessionSignalBody(database.db, env, body(b, 0, { platform: 'android' }));
    await storeSessionSignalBody(database.db, env, body(c, 0));
    const bodies = await listSessionSignalBodies(database.db, env, [b, a]);
    expect(bodies.map((row) => [row.inquirySessionId, row.sequence, row.platform])).toEqual([
      [a, 1, 'web'],
      [b, 0, 'android'],
      [b, 2, 'web'],
    ]);
    expect(bodies[0]).toMatchObject({
      screen: 'start',
      collectorVersion: 1,
      components: { integrity: { webdriver: false } },
      behaviour: { 'paste-count': 1 },
    });
    expect(bodies[0]?.createdAt).toBeInstanceOf(Date);
    expect(await listSessionSignalBodies(database.db, env, [])).toEqual([]);
    const elsewhere = await seedSessions();
    expect(await listSessionSignalBodies(database.db, elsewhere.env, [a])).toEqual([]);
  });

  it('reads a member retention or redaction nulled as null', async () => {
    const { env, sessionIds } = await seedSessions();
    const [session = ''] = sessionIds;
    await seedSessionSignalBody(database.db, env, {
      inquirySessionId: session,
      components: null,
      behaviour: { 'paste-count': 1 },
    });
    const [only] = await listSessionSignalBodies(database.db, env, [session]);
    expect(only?.components).toBeNull();
    expect(only?.behaviour).toEqual({ 'paste-count': 1 });
  });
});

describe('recordSessionSignalsCollected (C94.6)', () => {
  it('adds each tier once', async () => {
    const { env, sessionIds } = await seedSessions();
    const [session = ''] = sessionIds;
    await recordSessionSignalsCollected(database.db, env, session, ['session-integrity']);
    await recordSessionSignalsCollected(database.db, env, session, [
      'session-integrity',
      'device-recognition',
    ]);
    await recordSessionSignalsCollected(database.db, env, session, []);
    const stored = await getInquirySession(database.db, env, session);
    expect([...(stored?.signalsCollected ?? [])].sort()).toEqual([
      'device-recognition',
      'session-integrity',
    ]);
  });
});

describe('countInquirySessions (C91.5)', () => {
  it('counts every session of the inquiry, expired and canceled ones too', async () => {
    const { env, inquiryId, sessionIds } = await seedSessions(3);
    await expireInquirySession(database.db, env, sessionIds[0] ?? '', AT);
    expect(await countInquirySessions(database.db, env, inquiryId)).toBe(3);
    const other = await seedSessions();
    expect(await countInquirySessions(database.db, other.env, inquiryId)).toBe(0);
  });
});

describe('the signals outbox (C90.5)', () => {
  async function pendingInquiry(kind: 'completed' | 'failed' | 'expired' = 'completed') {
    const { env, inquiryId } = await seedSessions(0);
    await createSignalComputation(database.db, env, { inquiryId, triggerStatus: kind });
    return { env, inquiryId };
  }

  it('lists pending rows oldest first, leaving out those enqueued since the cut-off', async () => {
    onTestFinished(wallClockStepsBack());
    const clock = createdAtClock(database.db, new Date('2020-01-01T00:00:00.000Z'));
    const first = await pendingInquiry();
    const second = await pendingInquiry('expired');
    const third = await pendingInquiry('failed');
    for (const row of [first, second, third]) {
      await clock.at('inquiry_signal_computations', row.inquiryId, 'inquiry_id');
    }
    const cutoff = new Date('2020-01-01T01:00:00.000Z');
    await markSignalComputationsEnqueued(
      database.db,
      [{ environmentId: second.env, inquiryId: second.inquiryId }],
      new Date('2020-01-01T01:30:00.000Z'),
    );
    await markSignalComputationsEnqueued(
      database.db,
      [{ environmentId: third.env, inquiryId: third.inquiryId }],
      new Date('2020-01-01T00:30:00.000Z'),
    );
    const pending = await listPendingSignalComputations(database.db, {
      enqueuedBefore: cutoff,
      limit: 10,
    });
    const ours = pending.filter((row) =>
      [first.inquiryId, third.inquiryId, second.inquiryId].includes(row.inquiryId),
    );
    expect(ours.map((row) => row.inquiryId)).toEqual([first.inquiryId, third.inquiryId]);
    expect(ours[0]).toMatchObject({
      environmentId: first.env,
      triggerStatus: 'completed',
      attempts: 0,
      enqueuedAt: null,
    });
    expect(ours[1]?.enqueuedAt).toEqual(new Date('2020-01-01T00:30:00.000Z'));
    const limited = await listPendingSignalComputations(database.db, {
      enqueuedBefore: cutoff,
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });

  it('locks a pending row, freezes the inquiry’s signals once, and then reads nothing pending', async () => {
    const { env, inquiryId } = await pendingInquiry();
    const write = {
      signals: [{ name: 'inquiry/session_count', value: 0 }],
      signalDetails: { 'computed-at': AT.toISOString() },
      at: AT,
    };
    const locked = await database.db.transaction(async (tx) => {
      const row = await lockPendingSignalComputation(tx, env, inquiryId);
      const done = await completeSignalComputation(tx, env, inquiryId, write);
      return { row, done };
    });
    expect(locked.row).toMatchObject({ environmentId: env, inquiryId, triggerStatus: 'completed' });
    expect(locked.done).toBe(true);
    const inquiry = await getInquiry(database.db, env, inquiryId);
    expect(inquiry?.signals).toEqual(write.signals);
    expect(inquiry?.signalDetails).toEqual(write.signalDetails);
    await expect(
      completeSignalComputation(database.db, env, inquiryId, { ...write, signals: [] }),
    ).resolves.toBe(false);
    expect((await getInquiry(database.db, env, inquiryId))?.signals).toEqual(write.signals);
    expect(await lockPendingSignalComputation(database.db, env, inquiryId)).toBeNull();
    const { rows } = await database.client.query<{ state: string; computed_at: Date }>(
      'select state, computed_at from inquiry_signal_computations where inquiry_id = $1',
      [inquiryId],
    );
    expect(rows[0]?.state).toBe('computed');
    expect(new Date(rows[0]?.computed_at ?? 0)).toEqual(AT);
  });

  it('skips a row without touching the inquiry, and counts failures by code', async () => {
    const { env, inquiryId } = await pendingInquiry();
    await recordSignalComputationFailure(database.db, env, inquiryId, 'body_unreadable');
    await recordSignalComputationFailure(database.db, env, inquiryId, 'schema_refused');
    const [row] = (
      await listPendingSignalComputations(database.db, {
        enqueuedBefore: new Date('2100-01-01T00:00:00.000Z'),
        limit: 1000,
      })
    ).filter((pending) => pending.inquiryId === inquiryId);
    expect(row?.attempts).toBe(2);
    const { rows: codes } = await database.client.query<{ code: string }>(
      'select last_error_code as code from inquiry_signal_computations where inquiry_id = $1',
      [inquiryId],
    );
    expect(codes[0]?.code).toBe('schema_refused');
    await skipSignalComputation(database.db, env, inquiryId, AT);
    expect(await lockPendingSignalComputation(database.db, env, inquiryId)).toBeNull();
    const { rows } = await database.client.query<{ state: string }>(
      'select state from inquiry_signal_computations where inquiry_id = $1',
      [inquiryId],
    );
    expect(rows[0]?.state).toBe('skipped');
    expect((await getInquiry(database.db, env, inquiryId))?.signals).toBeNull();
    await expect(
      completeSignalComputation(database.db, env, inquiryId, {
        signals: [],
        signalDetails: {},
        at: AT,
      }),
    ).resolves.toBe(false);
  });
});

const WEB_RECOGNITION = {
  screen: {
    'width-bucket': 1920,
    'height-bucket': 1080,
    'color-depth': 24,
    'pixel-ratio-bucket': 1,
  },
  'hardware-concurrency': 8,
  'device-memory': 8,
  'max-touch-points': 0,
  'canvas-digest': 'a'.repeat(64),
  'canvas-noise': false,
  'webgl-vendor': 'Example Vendor',
  'webgl-renderer': 'Example Renderer',
};

describe('deviceIdentifierInputs (C94.4)', () => {
  it('builds the strict text over every stable component and the class text without the canvas', () => {
    const inputs = deviceIdentifierInputs('web', { recognition: WEB_RECOGNITION });
    expect(inputs?.fingerprintRandomised).toBe(false);
    expect(inputs?.androidId).toBeNull();
    expect(inputs?.browserFingerprint).toContain('a'.repeat(64));
    expect(inputs?.deviceClass).not.toContain('a'.repeat(64));
    expect(inputs?.deviceClass).toContain('Example Renderer');
    // Canonical: the key order of the body does not matter.
    const reordered = Object.fromEntries(Object.entries(WEB_RECOGNITION).reverse());
    expect(deviceIdentifierInputs('web', { recognition: reordered })).toEqual(inputs);
    // A different canvas changes the strict text, not the class.
    const other = deviceIdentifierInputs('web', {
      recognition: { ...WEB_RECOGNITION, 'canvas-digest': 'b'.repeat(64) },
    });
    expect(other?.browserFingerprint).not.toBe(inputs?.browserFingerprint);
    expect(other?.deviceClass).toBe(inputs?.deviceClass);
  });

  it('drops the strict text for a randomised canvas and keeps the class', () => {
    const inputs = deviceIdentifierInputs('web', {
      recognition: { ...WEB_RECOGNITION, 'canvas-noise': true },
    });
    expect(inputs).toMatchObject({ browserFingerprint: null, fingerprintRandomised: true });
    expect(inputs?.deviceClass).not.toBeNull();
  });

  it('takes the ANDROID_ID alone on Android, and nothing without a recognition member', () => {
    expect(
      deviceIdentifierInputs('android', { 'android-recognition': { 'android-id': '00ff' } }),
    ).toEqual({
      browserFingerprint: null,
      deviceClass: null,
      androidId: '00ff',
      fingerprintRandomised: false,
    });
    expect(deviceIdentifierInputs('web', { integrity: {} })).toBeNull();
    expect(deviceIdentifierInputs('android', { recognition: WEB_RECOGNITION })).toBeNull();
    expect(deviceIdentifierInputs('web', null)).toBeNull();
  });
});

function webWrite(env: string, sessionId: string, at = AT): SessionDeviceWrite {
  const inputs = deviceIdentifierInputs('web', { recognition: WEB_RECOGNITION });
  return {
    deviceId: testId('dev'),
    inquirySessionId: sessionId,
    platform: 'web',
    collectorVersion: 1,
    browserFingerprint: identifierKey(KEY, {
      environmentId: env,
      kind: 'browser-fingerprint',
      input: inputs?.browserFingerprint ?? '',
    }),
    deviceFingerprint: null,
    deviceClass: identifierKey(KEY, {
      environmentId: env,
      kind: 'device-class',
      input: inputs?.deviceClass ?? '',
    }),
    fingerprintRandomised: false,
    keyId: blindIndexKeyId(KEY),
    at,
  };
}

describe('linkSessionDevice (C91.2)', () => {
  it('creates the device once, links every session with the same HMAC and key id, and moves last-seen', async () => {
    const { env, sessionIds } = await seedSessions(2);
    const [a = '', b = ''] = sessionIds;
    const first = await linkSessionDevice(database.db, env, webWrite(env, a));
    const later = new Date(AT.getTime() + 60_000);
    const second = await linkSessionDevice(database.db, env, webWrite(env, b, later));
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ sessionCount: 2, firstSeenAt: AT, lastSeenAt: later });
    // A session keeps its first device.
    const again = await linkSessionDevice(database.db, env, {
      ...webWrite(env, a),
      browserFingerprint: 'c'.repeat(64),
      deviceClass: 'd'.repeat(64),
    });
    expect(again.id).toBe(first.id);
    expect(
      (await listSessionDevices(database.db, env, [a, b])).map((row) => row.device.id),
    ).toEqual([first.id, first.id]);
    // An earlier time never moves last-seen back.
    await linkSessionDevice(database.db, env, webWrite(env, a, AT));
    expect((await getDevice(database.db, env, first.id))?.lastSeenAt).toEqual(later);
  });

  it('keeps devices apart per environment and per key id', async () => {
    const one = await seedSessions();
    const two = await seedSessions();
    const write = webWrite(one.env, one.sessionIds[0] ?? '');
    const a = await linkSessionDevice(database.db, one.env, write);
    const b = await linkSessionDevice(database.db, two.env, {
      ...write,
      deviceId: testId('dev'),
      inquirySessionId: two.sessionIds[0] ?? '',
    });
    expect(b.id).not.toBe(a.id);
    const three = await seedSessions(2);
    const [x = '', y = ''] = three.sessionIds;
    const first = await linkSessionDevice(database.db, three.env, webWrite(three.env, x));
    const rotated = await linkSessionDevice(database.db, three.env, {
      ...webWrite(three.env, y),
      keyId: blindIndexKeyId(OTHER_KEY),
    });
    expect(rotated.id).not.toBe(first.id);
  });

  it('gives each randomised web session its own device, with the class only', async () => {
    const { env, sessionIds } = await seedSessions(2);
    const [a = '', b = ''] = sessionIds;
    const randomised = (sessionId: string): SessionDeviceWrite => ({
      ...webWrite(env, sessionId),
      deviceId: testId('dev'),
      browserFingerprint: null,
      fingerprintRandomised: true,
    });
    const first = await linkSessionDevice(database.db, env, randomised(a));
    const second = await linkSessionDevice(database.db, env, randomised(b));
    expect(second.id).not.toBe(first.id);
    expect(first).toMatchObject({ browserFingerprint: null, fingerprintRandomised: true });
  });

  it('links Android sessions by the ANDROID_ID HMAC', async () => {
    const { env, sessionIds } = await seedSessions(2);
    const [a = '', b = ''] = sessionIds;
    const write = (sessionId: string): SessionDeviceWrite => ({
      deviceId: testId('dev'),
      inquirySessionId: sessionId,
      platform: 'android',
      collectorVersion: 1,
      browserFingerprint: null,
      deviceFingerprint: identifierKey(KEY, {
        environmentId: env,
        kind: 'android-id',
        input: 'ff',
      }),
      deviceClass: null,
      fingerprintRandomised: false,
      keyId: blindIndexKeyId(KEY),
      at: AT,
    });
    const first = await linkSessionDevice(database.db, env, write(a));
    const second = await linkSessionDevice(database.db, env, write(b));
    expect(second.id).toBe(first.id);
    expect(second.platform).toBe('android');
  });
});

describe('the session’s device fields (C91.1, C94.5)', () => {
  it('writes the parsed fields, and an SDK session’s device type once', async () => {
    const { env, sessionIds } = await seedSessions(2);
    const [web = '', sdk = ''] = sessionIds;
    await recordSessionDeviceFields(database.db, env, web, {
      osName: 'Windows',
      osFullVersion: '10',
      browserName: 'Chrome',
      browserFullVersion: '130.0.0.0',
      deviceType: 'desktop',
      deviceName: null,
      mobileSdkName: null,
      mobileSdkFullVersion: null,
    });
    expect(await getInquirySession(database.db, env, web)).toMatchObject({
      osName: 'Windows',
      browserName: 'Chrome',
      deviceType: 'desktop',
      mobileSdkName: null,
    });
    // Not an SDK session: its device type stays the parsed one.
    await expect(recordSdkSessionDeviceType(database.db, env, web, 'tablet')).resolves.toBe(false);
    await recordSessionDeviceFields(database.db, env, sdk, {
      osName: 'Android',
      osFullVersion: null,
      browserName: null,
      browserFullVersion: null,
      deviceType: null,
      deviceName: null,
      mobileSdkName: 'openverify-android',
      mobileSdkFullVersion: '1.2.0',
    });
    await expect(recordSdkSessionDeviceType(database.db, env, sdk, 'tablet')).resolves.toBe(true);
    await expect(recordSdkSessionDeviceType(database.db, env, sdk, 'smartphone')).resolves.toBe(
      false,
    );
    expect(await getInquirySession(database.db, env, sdk)).toMatchObject({
      deviceType: 'tablet',
      mobileSdkFullVersion: '1.2.0',
    });
  });
});

describe('rebuildDeviceIndexes (C94.4, P09)', () => {
  it('recomputes the HMACs from the retained components under the new key and records its id', async () => {
    const { env, sessionIds } = await seedSessions(2);
    const [a = '', gone = ''] = sessionIds;
    await markInquirySessionStarted(database.db, env, a, { at: AT });
    await storeSessionSignalBody(
      database.db,
      env,
      body(a, 0, { components: { recognition: WEB_RECOGNITION } }),
    );
    const device = await linkSessionDevice(database.db, env, webWrite(env, a));
    // A device whose components are gone keeps its old key id.
    const orphan = await linkSessionDevice(database.db, env, {
      ...webWrite(env, gone),
      deviceId: testId('dev'),
      browserFingerprint: 'e'.repeat(64),
    });
    const result = await rebuildDeviceIndexes(database.db, OTHER_KEY, { batchSize: 1 });
    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    const rebuilt = await getDevice(database.db, env, device.id);
    const inputs = deviceIdentifierInputs('web', { recognition: WEB_RECOGNITION });
    expect(rebuilt).toMatchObject({
      keyId: blindIndexKeyId(OTHER_KEY),
      browserFingerprint: identifierKey(OTHER_KEY, {
        environmentId: env,
        kind: 'browser-fingerprint',
        input: inputs?.browserFingerprint ?? '',
      }),
      deviceClass: identifierKey(OTHER_KEY, {
        environmentId: env,
        kind: 'device-class',
        input: inputs?.deviceClass ?? '',
      }),
    });
    expect((await getDevice(database.db, env, orphan.id))?.keyId).toBe(blindIndexKeyId(KEY));
    // A second pass under the same key changes nothing.
    const again = await rebuildDeviceIndexes(database.db, OTHER_KEY);
    expect(again.updated).toBe(0);
  });

  describe('when the rekeyed device merges into its twin (C127.9, outcome 17)', () => {
    const mark = (actor: string, reason: string) => ({
      trusted_at: AT.toISOString(),
      trusted_by_type: 'user',
      trusted_by_id: actor,
      trust_reason: reason,
    });

    /** A device under `KEY` whose identifier, rekeyed, is what its twin already holds. */
    async function twins() {
      const { env, sessionIds } = await seedSessions(2);
      const [first = '', second = ''] = sessionIds;
      await markInquirySessionStarted(database.db, env, first, { at: AT });
      await storeSessionSignalBody(
        database.db,
        env,
        body(first, 0, { components: { recognition: WEB_RECOGNITION } }),
      );
      const rekeyed = await linkSessionDevice(database.db, env, webWrite(env, first));
      const inputs = deviceIdentifierInputs('web', { recognition: WEB_RECOGNITION });
      const twin = await linkSessionDevice(database.db, env, {
        ...webWrite(env, second),
        deviceId: testId('dev'),
        keyId: blindIndexKeyId(OTHER_KEY),
        browserFingerprint: identifierKey(OTHER_KEY, {
          environmentId: env,
          kind: 'browser-fingerprint',
          input: inputs?.browserFingerprint ?? '',
        }),
      });
      return { env, rekeyed, twin };
    }

    async function trust(id: string, values: ReturnType<typeof mark>) {
      await database.client.query(
        `update devices set trusted_at = $1, trusted_by_type = $2, trusted_by_id = $3,
           trust_reason = $4 where id = $5`,
        [...Object.values(values), id],
      );
    }

    it('keeps a mark only the deleted device held', async () => {
      const { env, rekeyed, twin } = await twins();
      const held = mark(testId('usr'), 'manual_review');
      await trust(rekeyed.id, held);

      await rebuildDeviceIndexes(database.db, OTHER_KEY);

      expect(await getDevice(database.db, env, rekeyed.id)).toBeNull();
      expect(await getDevice(database.db, env, twin.id)).toMatchObject({
        trustedAt: AT,
        trustedByType: 'user',
        trustedById: held.trusted_by_id,
        trustReason: 'manual_review',
      });
    });

    it("keeps the survivor's own mark", async () => {
      const { env, rekeyed, twin } = await twins();
      const own = mark(testId('usr'), 'known_device');
      await trust(rekeyed.id, mark(testId('usr'), 'manual_review'));
      await trust(twin.id, own);

      await rebuildDeviceIndexes(database.db, OTHER_KEY);

      expect(await getDevice(database.db, env, twin.id)).toMatchObject({
        trustedById: own.trusted_by_id,
        trustReason: 'known_device',
      });
    });

    it('marks nothing when neither held one', async () => {
      const { env, twin } = await twins();

      await rebuildDeviceIndexes(database.db, OTHER_KEY);

      expect(await getDevice(database.db, env, twin.id)).toMatchObject({
        trustedAt: null,
        trustedByType: null,
        trustedById: null,
        trustReason: null,
      });
    });
  });
});
