import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  type ClaimIdempotencyKeyInput,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const fingerprint = (body: string) => createHash('sha256').update(body).digest('hex');

async function setup() {
  const env = (await createTestTenant(database.db)).environment.id;
  const principalId = testId('key');
  const claim = (overrides: Partial<ClaimIdempotencyKeyInput> = {}) =>
    claimIdempotencyKey(database.db, env, {
      principalType: 'api_key',
      principalId,
      key: 'order-1',
      fingerprint: fingerprint('{"a":1}'),
      ...overrides,
    });
  return { env, principalId, claim };
}

describe('idempotency keys (C12)', () => {
  it('claims a new key, then replays the completed response with a sealed body', async () => {
    const { env, claim } = await setup();

    const claimed = await claim();
    if (claimed.outcome !== 'claimed') throw new Error(claimed.outcome);
    const completed = await completeIdempotencyKey(database.db, env, claimed.id, {
      status: 201,
      headers: { 'content-type': 'application/json', location: '/api/v1/inquiries/inq_X' },
      body: '{"data":{"id":"inq_X","attributes":{"fields":{"name-first":"Jane"}}}}',
      resourceId: 'inq_X',
    });
    const replay = await claim();
    const raw = await database.db.execute<{ response_body: string }>(
      sql`select response_body from idempotency_keys where id = ${claimed.id}`,
    );

    expect(completed).toBe(true);
    expect(replay).toEqual({
      outcome: 'replay',
      response: {
        status: 201,
        headers: { 'content-type': 'application/json', location: '/api/v1/inquiries/inq_X' },
        body: '{"data":{"id":"inq_X","attributes":{"fields":{"name-first":"Jane"}}}}',
      },
    });
    expect(raw.rows[0]?.response_body).toMatch(/^ov1\./);
    expect(raw.rows[0]?.response_body).not.toContain('Jane');
  });

  it('answers in_progress while the key is held, and mismatch for another body', async () => {
    const { claim } = await setup();
    await claim();

    expect(await claim()).toEqual({ outcome: 'in_progress' });
    expect(await claim({ fingerprint: fingerprint('{"a":2}') })).toEqual({ outcome: 'mismatch' });
  });

  it('lets a request take over a key whose lease ran out', async () => {
    const { claim } = await setup();
    const now = new Date('2026-10-20T10:00:00.000Z');
    const first = await claim({ now, leaseMs: 1000 });

    const second = await claim({ now: new Date(now.getTime() + 2000) });

    expect(first.outcome).toBe('claimed');
    expect(second).toEqual({
      outcome: 'claimed',
      id: first.outcome === 'claimed' ? first.id : -1,
      lockedUntil: new Date(now.getTime() + 2000 + 120_000),
    });
  });

  it('lets only the current holder settle a key, so a request that outlived its lease cannot undo a takeover (2B F014)', async () => {
    const { env, claim } = await setup();
    const now = new Date('2026-10-20T10:00:00.000Z');
    const first = await claim({ now, leaseMs: 1000 });
    const second = await claim({ now: new Date(now.getTime() + 2000) });
    if (first.outcome !== 'claimed' || second.outcome !== 'claimed') throw new Error('not claimed');
    const response = { status: 201, headers: {}, body: '{"late":true}' };

    expect(second.lockedUntil).not.toEqual(first.lockedUntil);
    expect(
      await releaseIdempotencyKey(database.db, env, first.id, { lockedUntil: first.lockedUntil }),
    ).toBe(false);
    expect(
      await completeIdempotencyKey(database.db, env, first.id, response, {
        lockedUntil: first.lockedUntil,
      }),
    ).toBe(false);
    expect(await claim({ now: new Date(now.getTime() + 3000) })).toEqual({
      outcome: 'in_progress',
    });
    expect(
      await completeIdempotencyKey(database.db, env, second.id, response, {
        lockedUntil: second.lockedUntil,
      }),
    ).toBe(true);
  });

  it('starts over after the 24 h expiry, even with another body', async () => {
    const { env, claim } = await setup();
    const now = new Date('2026-10-20T10:00:00.000Z');
    const first = await claim({ now });
    if (first.outcome !== 'claimed') throw new Error(first.outcome);
    await completeIdempotencyKey(database.db, env, first.id, {
      status: 200,
      headers: {},
      body: null,
    });

    const later = await claim({
      now: new Date(now.getTime() + 25 * 3_600_000),
      fingerprint: fingerprint('{"b":1}'),
    });

    expect(later.outcome).toBe('claimed');
  });

  it('releases a key after a 5xx so the request can be retried', async () => {
    const { env, claim } = await setup();
    const claimed = await claim();
    if (claimed.outcome !== 'claimed') throw new Error(claimed.outcome);

    expect(await releaseIdempotencyKey(database.db, env, claimed.id)).toBe(true);
    expect((await claim()).outcome).toBe('claimed');
    expect(await releaseIdempotencyKey(database.db, testId('env'), claimed.id)).toBe(false);
  });

  it('scopes keys to the environment and principal', async () => {
    const { env, claim } = await setup();
    await claim();
    const other = await setup();

    expect((await claim({ principalId: testId('key') })).outcome).toBe('claimed');
    expect((await claim({ principalType: 'user' })).outcome).toBe('claimed');
    expect((await other.claim()).outcome).toBe('claimed');
    expect(
      await completeIdempotencyKey(database.db, testId('env'), 1, {
        status: 200,
        headers: {},
        body: null,
      }),
    ).toBe(false);
    expect(env).not.toBe(other.env);
  });
});
