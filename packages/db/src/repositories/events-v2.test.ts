/** Events API filters (C12), simulated events (C14) and the pre-v2 object id backfill. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvalidCursorError } from '../errors.js';
import { encrypt } from '../crypto.js';
import { hashSessionToken } from '../tokens.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  backfillEventObjectIds,
  createEvent,
  createInquirySession,
  createSelfieCapture,
  createVerification,
  getEvent,
  listEvents,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const tenant = async () => (await createTestTenant(database.db)).environment.id;
const payload = (type: string, id: string) => ({ data: { type, id, attributes: {} } });

// Lists are ordered by `created_at`, which PGlite's now() takes from the wall clock to the
// millisecond: two writes can share a millisecond or, under load, go back in time. So every
// event a test orders is stamped from this clock instead, a second after the one before.
let stamp = Date.parse('2026-10-01T00:00:00.000Z');
async function stamped(written: Awaited<ReturnType<typeof createEvent>>) {
  const createdAt = new Date((stamp += 1_000));
  await database.db.execute(
    sql`update events set created_at = ${createdAt.toISOString()}::timestamptz where id = ${written.id}`,
  );
  return { ...written, createdAt };
}

describe('events (C12, C14)', () => {
  it('record the object of the payload and whether the event was simulated', async () => {
    const env = await tenant();
    const inquiryId = testId('inq');

    const real = await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'inquiry.created',
      payload: payload('inquiry', inquiryId),
    });
    const simulated = await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'inquiry.approved',
      payload: payload('inquiry', inquiryId),
      simulated: true,
    });
    const shapeless = await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'inquiry.created',
      payload: {},
    });

    expect(real).toMatchObject({
      objectId: inquiryId,
      objectType: 'inquiry',
      simulated: false,
      redactedAt: null,
    });
    expect(simulated.simulated).toBe(true);
    expect(shapeless).toMatchObject({ objectId: null, objectType: null });
    expect(await getEvent(database.db, env, real.id)).toEqual(real);
  });

  it('filter by name, object id, time and simulated (default false)', async () => {
    const env = await tenant();
    const a = testId('inq');
    const created = await stamped(
      await createEvent(database.db, env, {
        id: testId('evt'),
        name: 'inquiry.created',
        payload: payload('inquiry', a),
      }),
    );
    const approved = await stamped(
      await createEvent(database.db, env, {
        id: testId('evt'),
        name: 'inquiry.approved',
        payload: payload('inquiry', a),
      }),
    );
    const other = await stamped(
      await createEvent(database.db, env, {
        id: testId('evt'),
        name: 'account.created',
        payload: payload('account', testId('acc')),
      }),
    );
    const simulated = await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'inquiry.created',
      payload: payload('inquiry', a),
      simulated: true,
    });
    const ids = async (options: Parameters<typeof listEvents>[2]) =>
      (await listEvents(database.db, env, options)).items.map((event) => event.id);

    expect(await ids({})).toEqual([other.id, approved.id, created.id]);
    expect(await ids({ name: ['inquiry.created', 'inquiry.approved'] })).toEqual([
      approved.id,
      created.id,
    ]);
    expect(await ids({ name: 'account.created' })).toEqual([other.id]);
    expect(await ids({ objectId: a })).toEqual([approved.id, created.id]);
    expect(await ids({ simulated: true })).toEqual([simulated.id]);
    expect(await ids({ createdAtStart: new Date(Date.now() + 60_000) })).toEqual([]);
    expect(await ids({ createdAtEnd: new Date(Date.now() + 60_000), size: 1 })).toEqual([other.id]);
    expect(await ids({ name: [] })).toEqual([]);
    await expect(listEvents(database.db, env, { after: testId('evt') })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it('backfill the object of events written before schema v2, in batches', async () => {
    const env = await tenant();
    const inquiryId = testId('inq');
    const legacy = testId('evt');
    const empty = testId('evt');
    for (const [id, body] of [
      [legacy, payload('inquiry', inquiryId)],
      [empty, {}],
    ] as const) {
      await database.db.execute(
        sql`insert into events (id, environment_id, name, payload)
            values (${id}, ${env}, 'inquiry.created',
                    ${encrypt(JSON.stringify(body), database.keyring, { context: 'events.payload' })})`,
      );
    }

    let after: string | null = null;
    let updated = 0;
    do {
      const batch: Awaited<ReturnType<typeof backfillEventObjectIds>> =
        await backfillEventObjectIds(database.db, { after, limit: 1 });
      updated += batch.updated;
      after = batch.next;
    } while (after !== null);

    expect(updated).toBe(1);
    expect(await getEvent(database.db, env, legacy)).toMatchObject({
      objectId: inquiryId,
      objectType: 'inquiry',
    });
    expect(await getEvent(database.db, env, empty)).toMatchObject({ objectId: null });
  });
});

describe('events by inquiry (C25.7, Workflow 2E)', () => {
  const writeEvent = async (env: string, name: string, type: string, id: string) =>
    stamped(
      await createEvent(database.db, env, { id: testId('evt'), name, payload: payload(type, id) }),
    );

  /** An inquiry with two verifications and a session, and an event about each of them. */
  async function inquiryWithTimeline(env: string) {
    const { inquiry } = await createTestInquiry(database.db, env);
    const verifications = [];
    for (const type of ['government_id', 'selfie'] as const) {
      verifications.push(
        await createVerification(database.db, env, {
          id: testId('ver'),
          inquiryId: inquiry.id,
          type,
        }),
      );
    }
    const session = await createInquirySession(database.db, env, {
      id: testId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(`ovs_${'S'.repeat(43)}${testId('iqse')}`),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const event = (name: string, type: string, id: string) => writeEvent(env, name, type, id);
    const created = await event('inquiry.created', 'inquiry', inquiry.id);
    const started = await event('inquiry-session.started', 'inquiry-session', session.id);
    const governmentId = await event(
      'verification.created',
      'verification',
      verifications[0]?.id ?? '',
    );
    const selfie = await event('verification.passed', 'verification', verifications[1]?.id ?? '');
    const completed = await event('inquiry.completed', 'inquiry', inquiry.id);
    return { inquiry, events: [completed, selfie, governmentId, started, created] };
  }

  it('lists the events of the inquiry, its verifications and its sessions, newest first', async () => {
    const env = await tenant();
    const own = await inquiryWithTimeline(env);
    const other = await inquiryWithTimeline(env);
    await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'account.created',
      payload: payload('account', testId('acc')),
    });
    const ids = async (options: Parameters<typeof listEvents>[2]) =>
      (await listEvents(database.db, env, options)).items.map((event) => event.id);

    expect(await ids({ inquiryId: own.inquiry.id })).toEqual(own.events.map(({ id }) => id));
    expect(await ids({ inquiryId: [own.inquiry.id, other.inquiry.id] })).toEqual(
      [...other.events, ...own.events].map(({ id }) => id),
    );
    expect(await ids({ inquiryId: testId('inq') })).toEqual([]);
    expect(await ids({ inquiryId: [] })).toEqual([]);
  });

  it('keeps the timeline newest first when the wall clock runs backwards as it is written', async () => {
    const env = await tenant();
    // PGlite's now() reads Date.now(), to the millisecond, and under load the wall clock can
    // step back between two writes (it did in the 2026-10-24 validation). Here every read is a
    // millisecond earlier than the last.
    const wallClock = Date.now;
    let reading = wallClock();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (reading -= 1));
    const { inquiry, events } = await inquiryWithTimeline(env).finally(() => {
      clock.mockRestore();
    });

    expect(
      (await listEvents(database.db, env, { inquiryId: inquiry.id })).items.map(({ id }) => id),
    ).toEqual(events.map(({ id }) => id));
  });

  it('combines with the other filters and the cursor', async () => {
    const env = await tenant();
    const { inquiry, events } = await inquiryWithTimeline(env);
    await inquiryWithTimeline(env);
    const [completed, selfie, governmentId, started, created] = events.map(({ id }) => id);

    expect(
      (
        await listEvents(database.db, env, {
          inquiryId: inquiry.id,
          name: ['verification.created', 'verification.passed'],
        })
      ).items.map(({ id }) => id),
    ).toEqual([selfie, governmentId]);
    expect(
      (
        await listEvents(database.db, env, { inquiryId: inquiry.id, objectId: inquiry.id })
      ).items.map(({ id }) => id),
    ).toEqual([completed, created]);
    const first = await listEvents(database.db, env, { inquiryId: inquiry.id, size: 2 });
    expect(first.items.map(({ id }) => id)).toEqual([completed, selfie]);
    const second = await listEvents(database.db, env, {
      inquiryId: inquiry.id,
      size: 2,
      after: first.next ?? undefined,
    });
    expect(second.items.map(({ id }) => id)).toEqual([governmentId, started]);
    expect(
      (await listEvents(database.db, env, { inquiryId: inquiry.id, simulated: true })).items,
    ).toEqual([]);
  });

  it("includes the events of the inquiry's selfie captures (C40.1)", async () => {
    const env = await tenant();
    const { inquiry, events } = await inquiryWithTimeline(env);
    const other = await inquiryWithTimeline(env);
    const capture = async (inquiryId: string) => {
      const verification = await createVerification(database.db, env, {
        id: testId('ver'),
        inquiryId,
        type: 'selfie',
      });
      return createSelfieCapture(database.db, env, {
        id: testId('self'),
        verificationId: verification.id,
        inquiryId,
        method: 'camera',
        liveness: 'active',
        prompts: ['center', 'left', 'right'],
        nonceSha256: new Uint8Array(32),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 180_000),
      });
    };
    const own = await capture(inquiry.id);
    const foreign = await capture(other.inquiry.id);
    const selfieEvent = (name: string, id: string) => writeEvent(env, name, 'selfie', id);
    const created = await selfieEvent('selfie.created', own.id);
    await selfieEvent('selfie.created', foreign.id);
    const processed = await selfieEvent('selfie.processed', own.id);

    expect(
      (await listEvents(database.db, env, { inquiryId: inquiry.id })).items.map(({ id }) => id),
    ).toEqual([processed.id, created.id, ...events.map(({ id }) => id)]);
  });

  it('stays inside the environment: another environment sees none of them', async () => {
    const env = await tenant();
    const otherEnv = await tenant();
    const { inquiry } = await inquiryWithTimeline(env);
    await inquiryWithTimeline(otherEnv);

    expect((await listEvents(database.db, otherEnv, { inquiryId: inquiry.id })).items).toEqual([]);
  });
});
