import { idempotencyKeys } from '@openverify/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../errors.js';
import { multipart } from '../test-support/harness.js';
import idempotency, { canonicalJson, type IdempotencyStore } from './idempotency.js';
import { bearer, createPlatformTest, type PlatformTest } from './platform.test-support.js';

let platform: PlatformTest;

beforeAll(async () => {
  platform = await createPlatformTest();
});

afterAll(async () => {
  await platform.close();
});

const IDEMPOTENCY_KEY = 'idempotency-key';
const REPLAYED = 'idempotent-replayed';

interface Probe {
  app: FastifyInstance & { logs: Record<string, unknown>[] };
  executions: () => number;
  /** Lets the slow route answer. */
  release: () => void;
  failNext: () => void;
}

let sequence = 0;

/** The plugin under test and probe routes that count how often they really run. */
function probe(store?: IdempotencyStore): Probe {
  let executions = 0;
  let failing = false;
  let release: () => void = () => undefined;
  const app = platform.app((scope) => {
    void scope.register(idempotency, {
      db: platform.database.db,
      clock: platform.clock,
      ...(store === undefined ? {} : { store }),
    });
    scope.post('/api/v1/things', { config: { scopes: [] } }, async (request, reply) => {
      executions += 1;
      if (failing) {
        failing = false;
        throw new Error('the database went away');
      }
      sequence += 1;
      const id = `thg_${String(sequence)}`;
      return reply
        .code(201)
        .header('location', `/api/v1/things/${id}`)
        .send({ data: { type: 'thing', id, attributes: request.body ?? null } });
    });
    scope.patch('/api/v1/things/:id', { config: { scopes: [] } }, (request) => {
      executions += 1;
      return { data: { type: 'thing', id: (request.params as { id: string }).id } };
    });
    scope.get('/api/v1/things', { config: { scopes: [] } }, () => {
      executions += 1;
      return { data: [] };
    });
    scope.post('/api/v1/conflicts', { config: { scopes: [] } }, () => {
      executions += 1;
      throw new ConflictError('The thing is already done.');
    });
    scope.post('/api/v1/slow', { config: { scopes: [] } }, async () => {
      executions += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { done: true };
    });
    scope.post('/api/v1/no-content', { config: { scopes: [] } }, (_request, reply) => {
      executions += 1;
      return reply.code(204).send();
    });
    void scope.register((uploads, _options, done) => {
      uploads.addContentTypeParser(
        'multipart/form-data',
        { parseAs: 'buffer' },
        (_request, body, parsed) => {
          parsed(null, body);
        },
      );
      uploads.post('/api/v1/uploads', { config: { scopes: [] } }, () => {
        executions += 1;
        return { uploaded: executions };
      });
      done();
    });
    void scope.register((streams, _options, done) => {
      streams.addContentTypeParser('multipart/form-data', (_request, _payload, parsed) => {
        parsed(null);
      });
      streams.post('/api/v1/streams', { config: { scopes: [] } }, () => ({ streamed: true }));
      done();
    });
  });
  return {
    app,
    executions: () => executions,
    release: () => {
      release();
    },
    failNext: () => {
      failing = true;
    },
  };
}

let keyCounter = 0;
const newKey = () => {
  keyCounter += 1;
  return `test-key-${String(keyCounter)}-${String(Date.now())}`;
};

function post(
  app: FastifyInstance,
  key: string | undefined,
  body: unknown = { name: 'Synthetic thing' },
  token = platform.tenants[0].token,
  url = '/api/v1/things',
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { ...bearer(token), ...(key === undefined ? {} : { [IDEMPOTENCY_KEY]: key }) },
    payload: body as Record<string, unknown>,
  });
}

describe('canonicalJson', () => {
  it('orders object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it('treats a missing body as null', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('Idempotency-Key (C12)', () => {
  it('replays the stored response of a completed request without running it again', async () => {
    const { app, executions } = probe();
    const key = newKey();

    const first = await post(app, key);
    const second = await post(app, key);

    expect(first.statusCode).toBe(201);
    expect(first.headers[REPLAYED]).toBeUndefined();
    expect(second.statusCode).toBe(201);
    expect(second.headers[REPLAYED]).toBe('true');
    expect(second.headers['cache-control']).toBe('no-store');
    expect(second.headers.location).toBe(first.headers.location);
    expect(second.headers['content-type']).toBe(first.headers['content-type']);
    expect(second.body).toBe(first.body);
    expect(executions()).toBe(1);
  });

  it('treats a body with its members in another order as the same request', async () => {
    const { app, executions } = probe();
    const key = newKey();

    await post(app, key, { a: 1, b: { c: 2, d: 3 } });
    const retry = await post(app, key, { b: { d: 3, c: 2 }, a: 1 });

    expect(retry.headers[REPLAYED]).toBe('true');
    expect(executions()).toBe(1);
  });

  it('answers 422 idempotency-key-reused when the key comes back with another body', async () => {
    const { app, executions } = probe();
    const key = newKey();

    await post(app, key, { name: 'First' });
    const reused = await post(app, key, { name: 'Second' });

    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({
      type: 'https://openverify.dev/problems/idempotency-key-reused',
      status: 422,
    });
    expect(executions()).toBe(1);
  });

  it('answers 422 when the key comes back for another resource', async () => {
    const { app } = probe();
    const key = newKey();
    const patch = (id: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/things/${id}`,
        headers: { ...bearer(platform.tenants[0].token), [IDEMPOTENCY_KEY]: key },
        payload: { name: 'Same body' },
      });

    expect((await patch('thg_a')).statusCode).toBe(200);
    expect((await patch('thg_a')).headers[REPLAYED]).toBe('true');
    expect((await patch('thg_b')).statusCode).toBe(422);
  });

  it('answers 409 idempotency-key-in-use while the first request is still running', async () => {
    const { app, release, executions } = probe();
    const key = newKey();
    const slow = (body = {}) => post(app, key, body, platform.tenants[0].token, '/api/v1/slow');

    const first = slow();
    await vi.waitFor(() => {
      expect(executions()).toBe(1);
    });
    const concurrent = await slow();
    release();
    const done = await first;
    const retry = await slow();

    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json()).toMatchObject({
      type: 'https://openverify.dev/problems/idempotency-key-in-use',
    });
    expect(done.statusCode).toBe(200);
    expect(retry.headers[REPLAYED]).toBe('true');
    expect(executions()).toBe(1);
  });

  it('stores nothing for a 5xx answer and releases the key, so a retry runs again', async () => {
    const { app, executions, failNext } = probe();
    const key = newKey();
    failNext();

    const failed = await post(app, key);
    const retry = await post(app, key);

    expect(failed.statusCode).toBe(500);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers[REPLAYED]).toBeUndefined();
    expect(executions()).toBe(2);
  });

  it('stores and replays 4xx answers', async () => {
    const { app, executions } = probe();
    const key = newKey();

    const first = await post(app, key, {}, platform.tenants[0].token, '/api/v1/conflicts');
    const retry = await post(app, key, {}, platform.tenants[0].token, '/api/v1/conflicts');

    expect(first.statusCode).toBe(409);
    expect(retry.statusCode).toBe(409);
    expect(retry.headers[REPLAYED]).toBe('true');
    expect(retry.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(retry.body).toBe(first.body);
    expect(executions()).toBe(1);
  });

  it('replays an answer without a body', async () => {
    const { app, executions } = probe();
    const key = newKey();

    await post(app, key, undefined, platform.tenants[0].token, '/api/v1/no-content');
    const retry = await post(app, key, undefined, platform.tenants[0].token, '/api/v1/no-content');

    expect(retry.statusCode).toBe(204);
    expect(retry.headers[REPLAYED]).toBe('true');
    expect(retry.body).toBe('');
    expect(executions()).toBe(1);
  });

  it('keeps keys per principal: another API key with the same key runs anew', async () => {
    const { app, executions } = probe();
    const key = newKey();

    await post(app, key);
    const other = await post(app, key, undefined, platform.secondKey.token);

    expect(other.statusCode).toBe(201);
    expect(other.headers[REPLAYED]).toBeUndefined();
    expect(executions()).toBe(2);
  });

  it('keeps keys per environment: the same user in another environment runs anew', async () => {
    const { app, executions } = probe();
    const key = newKey();
    const [first, second] = platform.tenants;

    await post(app, key, undefined, platform.userToken(first.environmentId));
    const replay = await post(app, key, undefined, platform.userToken(first.environmentId));
    const elsewhere = await post(app, key, undefined, platform.userToken(second.environmentId));

    expect(replay.headers[REPLAYED]).toBe('true');
    expect(elsewhere.headers[REPLAYED]).toBeUndefined();
    expect(executions()).toBe(2);
  });

  it('runs the request again once the stored response is older than 24 hours', async () => {
    const { app, executions } = probe();
    const key = newKey();

    await post(app, key);
    platform.clock.advance(24 * 3_600_000 + 1);
    const later = await post(app, key, { name: 'A day later' });

    expect(later.statusCode).toBe(201);
    expect(later.headers[REPLAYED]).toBeUndefined();
    expect(executions()).toBe(2);
  });

  it('leaves routes in scopes created before the plugin alone', async () => {
    const { app } = probe();

    const response = await app.inject({
      method: 'POST',
      url: '/early',
      headers: { [IDEMPOTENCY_KEY]: newKey() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[REPLAYED]).toBeUndefined();
  });

  it('leaves GET requests and requests without the header alone', async () => {
    const { app, executions } = probe();
    const key = newKey();
    const get = () =>
      app.inject({
        url: '/api/v1/things',
        headers: { ...bearer(platform.tenants[0].token), [IDEMPOTENCY_KEY]: key },
      });

    await get();
    const secondGet = await get();
    await post(app, undefined);
    const secondPost = await post(app, undefined);

    expect(secondGet.headers[REPLAYED]).toBeUndefined();
    expect(secondPost.headers[REPLAYED]).toBeUndefined();
    expect(executions()).toBe(4);
  });

  it.each([
    ['longer than 255 characters', 'k'.repeat(256)],
    ['not printable ASCII', 'naïve-key'],
  ])('answers 400 for a key %s', async (_label, key) => {
    const { app, executions } = probe();

    const response = await post(app, key);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      detail: expect.stringContaining('Idempotency-Key') as unknown,
    });
    expect(executions()).toBe(0);
  });

  it('stores the response body encrypted, with the resource it is about, for 24 hours', async () => {
    const { app } = probe();
    const key = newKey();

    const response = await post(app, key, { marker: 'plaintext-marker-7f3a' });

    const [row] = await platform.database.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key));
    expect(row).toMatchObject({
      environmentId: platform.tenants[0].environmentId,
      principalType: 'api_key',
      principalId: platform.tenants[0].apiKeyId,
      state: 'completed',
      responseStatus: 201,
      responseHeaders: {
        'content-type': 'application/json; charset=utf-8',
        location: response.headers.location,
      },
      resourceId: response.json<{ data: { id: string } }>().data.id,
      expiresAt: new Date(platform.clock.now().getTime() + 24 * 3_600_000),
    });
    expect(row?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('plaintext-marker-7f3a');
  });

  it('keeps no digest of a secret: only the rest of a body tells two requests apart (C125.5)', async () => {
    const { app, executions } = probe();
    const key = newKey();

    await post(app, key, { 'secret-value': 'change-me-synthetic-one' });
    const again = await post(app, key, { 'secret-value': 'change-me-synthetic-two' });

    expect(again.headers[REPLAYED]).toBe('true');
    expect(executions()).toBe(1);
  });

  it('fingerprints multipart bodies by part names, sizes and digests', async () => {
    const { app, executions } = probe();
    const key = newKey();
    const upload = async (bytes: number[]) => {
      const body = await multipart({
        kind: 'front',
        file: { bytes: new Uint8Array(bytes), filename: 'front.jpg', type: 'image/jpeg' },
      });
      return app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers: { ...bearer(platform.tenants[0].token), [IDEMPOTENCY_KEY]: key, ...body.headers },
        payload: body.payload,
      });
    };

    const first = await upload([1, 2, 3]);
    const retry = await upload([1, 2, 3]);
    const changed = await upload([1, 2, 4]);

    expect(first.statusCode).toBe(200);
    expect(retry.headers[REPLAYED]).toBe('true');
    expect(changed.statusCode).toBe(422);
    expect(executions()).toBe(1);
  });

  it('refuses a key on a multipart body the route streams, which cannot be fingerprinted', async () => {
    const { app } = probe();
    const body = await multipart({ kind: 'front' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/streams',
      headers: {
        ...bearer(platform.tenants[0].token),
        [IDEMPOTENCY_KEY]: newKey(),
        ...body.headers,
      },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers 400 for a body nested too deeply to fingerprint, without running the request (2B F034)', async () => {
    const { app, executions } = probe();
    const depth = 100_000;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/conflicts',
      headers: {
        ...bearer(platform.tenants[0].token),
        [IDEMPOTENCY_KEY]: newKey(),
        'content-type': 'application/json',
      },
      payload: `${'['.repeat(depth)}${']'.repeat(depth)}`,
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(executions()).toBe(0);
  });

  it('settles the key with the lease of its own claim (2B F014)', async () => {
    const lease = new Date('2026-10-20T12:02:00.000Z');
    const settled: (Date | undefined)[] = [];
    const store: IdempotencyStore = {
      claim: () => Promise.resolve({ outcome: 'claimed', id: 7, lockedUntil: lease }),
      complete: (_environmentId, _id, _response, lockedUntil) => {
        settled.push(lockedUntil);
        return Promise.resolve(true);
      },
      release: (_environmentId, _id, lockedUntil) => {
        settled.push(lockedUntil);
        return Promise.resolve(true);
      },
    };
    const { app, failNext } = probe(store);

    await post(app, newKey());
    failNext();
    await post(app, newKey());

    expect(settled).toEqual([lease, lease]);
  });

  it('warns, without the key or the body, when its lease ended before the answer was stored (2B F035)', async () => {
    const lease = new Date('2026-10-20T12:02:00.000Z');
    const store: IdempotencyStore = {
      claim: () => Promise.resolve({ outcome: 'claimed', id: 41, lockedUntil: lease }),
      complete: () => Promise.resolve(false),
      release: () => Promise.resolve(false),
    };
    const { app, failNext } = probe(store);
    const key = `lost-lease-${newKey()}`;

    const stored = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      headers: { ...bearer(platform.tenants[0].token), [IDEMPOTENCY_KEY]: key },
      payload: { name: 'Synthetic Lostlease' },
    });
    failNext();
    const failed = await post(app, newKey());

    expect(stored.statusCode).toBe(201);
    expect(failed.statusCode).toBe(500);
    const warnings = app.logs.filter((line) => line.level === 40);
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: expect.stringMatching(/lease ended.*not stored/i) as unknown,
        idempotencyKeyId: 41,
      }),
      expect.objectContaining({
        msg: expect.stringMatching(/lease ended.*not released/i) as unknown,
        idempotencyKeyId: 41,
      }),
    ]);
    expect(JSON.stringify(warnings)).not.toContain(key);
    expect(JSON.stringify(warnings)).not.toContain('Lostlease');
  });

  it('logs nothing when the key is settled under its own lease', async () => {
    const store: IdempotencyStore = {
      claim: () => Promise.resolve({ outcome: 'claimed', id: 42 }),
      complete: () => Promise.resolve(true),
      release: () => Promise.resolve(true),
    };
    const { app, failNext } = probe(store);

    await post(app, newKey());
    failNext();
    await post(app, newKey());

    expect(app.logs.filter((line) => line.level === 40)).toEqual([]);
  });

  it('sends the response even when storing it fails, and logs the failure', async () => {
    const store: IdempotencyStore = {
      claim: () => Promise.resolve({ outcome: 'claimed', id: 1 }),
      complete: () => Promise.reject(new Error('disk full')),
      release: () => Promise.reject(new Error('disk full')),
    };
    const { app, failNext } = probe(store);

    const stored = await post(app, newKey());
    failNext();
    const failed = await post(app, newKey());

    expect(stored.statusCode).toBe(201);
    expect(failed.statusCode).toBe(500);
    expect(app.logs.filter((line) => line.level === 50 && line.msg !== 'request failed')).toEqual([
      expect.objectContaining({ msg: expect.stringMatching(/idempotency/i) as unknown }),
      expect.objectContaining({ msg: expect.stringMatching(/idempotency/i) as unknown }),
    ]);
  });
});
