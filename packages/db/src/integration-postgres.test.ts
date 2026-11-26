import { describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_POSTGRES_RETRIES,
  INTEGRATION_POSTGRES_STARTUP_TIMEOUT_MS,
  POSTGRES_TEST_COMMAND,
  POSTGRES_TEST_IMAGE,
  definePostgresContainer,
  ifSet,
  selectOne,
  startWithRetries,
  type StartedIntegrationPostgres,
} from './integration-postgres.js';

/** A fake container: its URI names its attempt; `stop` records it. */
function fakeContainer(attempt: number, stopped: number[]): StartedIntegrationPostgres {
  return {
    getConnectionUri: () =>
      `postgres://test:secret-${String(attempt)}@127.0.0.1:4000${String(attempt)}/test`,
    stop: () => {
      stopped.push(attempt);
      return Promise.resolve();
    },
  };
}

const refused = (port: number) =>
  Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${String(port)}`), {
    code: 'ECONNREFUSED',
  });

/** A clock the fake sleep moves, so the backoff costs no wall time. */
function fakeTime() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

describe('startWithRetries (K7B-13)', () => {
  it('starts a fresh container after a start that throws and one whose port stays refused, then returns the third', async () => {
    const time = fakeTime();
    const stopped: number[] = [];
    const lines: string[] = [];
    const probes: string[] = [];

    const started = await startWithRetries({
      start: (attempt) =>
        attempt === 1
          ? Promise.reject(new Error('Port 33806 not bound after 60000ms'))
          : Promise.resolve(fakeContainer(attempt, stopped)),
      probe: (uri) => {
        probes.push(uri);
        return uri.includes(':40002/') ? Promise.reject(refused(40002)) : Promise.resolve();
      },
      readyTimeoutMs: 60_000,
      log: (line) => lines.push(line),
      ...time,
    });

    expect(started.getConnectionUri()).toContain(':40003/');
    // The second container was polled with backoff until the deadline, then stopped.
    expect(stopped).toEqual([2]);
    expect(probes.filter((uri) => uri.includes(':40002/')).length).toBeGreaterThan(5);
    expect(time.sleeps.slice(0, 4)).toEqual([100, 200, 400, 800]);
    expect(Math.max(...time.sleeps)).toBe(2000);
    expect(time.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(60_000);
    expect(lines).toEqual([
      'integration Postgres: attempt 1 of 3 failed (start: Port 33806 not bound after 60000ms); starting a fresh container',
      'integration Postgres: attempt 2 of 3 failed (no select 1 within 60 s: connect ECONNREFUSED 127.0.0.1:40002); starting a fresh container',
    ]);
  });

  it('returns the first container at once when its first select 1 answers', async () => {
    const time = fakeTime();
    const lines: string[] = [];

    const started = await startWithRetries({
      start: (attempt) => Promise.resolve(fakeContainer(attempt, [])),
      probe: () => Promise.resolve(),
      log: (line) => lines.push(line),
      ...time,
    });

    expect(started.getConnectionUri()).toContain(':40001/');
    expect(time.sleeps).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('waits through refusals that end before the deadline, on the same container', async () => {
    const time = fakeTime();
    let calls = 0;

    const started = await startWithRetries({
      start: (attempt) => Promise.resolve(fakeContainer(attempt, [])),
      probe: () => (++calls < 4 ? Promise.reject(refused(40001)) : Promise.resolve()),
      log: () => undefined,
      ...time,
    });

    expect(started.getConnectionUri()).toContain(':40001/');
    expect(time.sleeps).toEqual([100, 200, 400]);
  });

  it('gives up after two retries with an error naming every attempt, and stops each container it started', async () => {
    const time = fakeTime();
    const stopped: number[] = [];
    const lines: string[] = [];
    const attempts: number[] = [];

    const failing = startWithRetries({
      start: (attempt) => {
        attempts.push(attempt);
        return attempt === 2
          ? Promise.reject(new Error('(HTTP code 500) server error - ports are not available'))
          : Promise.resolve(fakeContainer(attempt, stopped));
      },
      probe: (uri) => Promise.reject(refused(Number(/:(\d+)\//.exec(uri)?.[1]))),
      readyTimeoutMs: 10_000,
      log: (line) => lines.push(line),
      ...time,
    });

    await expect(failing).rejects.toThrow(
      'integration Postgres did not start after 3 attempts: ' +
        'attempt 1: no select 1 within 10 s: connect ECONNREFUSED 127.0.0.1:40001; ' +
        'attempt 2: start: (HTTP code 500) server error - ports are not available; ' +
        'attempt 3: no select 1 within 10 s: connect ECONNREFUSED 127.0.0.1:40003',
    );
    expect(attempts).toEqual([1, 2, 3]);
    expect(stopped).toEqual([1, 3]);
    expect(lines).toHaveLength(2);
    expect(INTEGRATION_POSTGRES_RETRIES).toBe(2);
  });

  it('names the service and its probe in every line and in the error, for a container that is not Postgres (K8-37)', async () => {
    const lines: string[] = [];

    const failing = startWithRetries({
      start: (attempt) => Promise.resolve(fakeContainer(attempt, [])),
      probe: () => Promise.reject(refused(9000)),
      retries: 1,
      readyTimeoutMs: 1_000,
      log: (line) => lines.push(line),
      service: 'integration RustFS',
      probeName: 'ListBuckets',
      ...fakeTime(),
    });

    await expect(failing).rejects.toThrow(
      'integration RustFS did not start after 2 attempts: ' +
        'attempt 1: no ListBuckets within 1 s: connect ECONNREFUSED 127.0.0.1:9000; ' +
        'attempt 2: no ListBuckets within 1 s: connect ECONNREFUSED 127.0.0.1:9000',
    );
    expect(lines).toEqual([
      'integration RustFS: attempt 1 of 2 failed (no ListBuckets within 1 s: connect ECONNREFUSED 127.0.0.1:9000); starting a fresh container',
    ]);
  });

  it('never logs or throws a password from a connection URI', async () => {
    const lines: string[] = [];

    const failing = startWithRetries({
      start: () =>
        Promise.reject(new Error('cannot reach postgres://test:secret-password@127.0.0.1:5/test')),
      probe: () => Promise.resolve(),
      retries: 1,
      log: (line) => lines.push(line),
      ...fakeTime(),
    });

    const error = await failing.catch((caught: unknown) => caught as Error);
    expect(error.message).toContain('postgres://***@127.0.0.1:5/test');
    expect([...lines, error.message].join('\n')).not.toContain('secret-password');
  });

  it('keeps going when stopping a refused container fails, and says so', async () => {
    const lines: string[] = [];
    let attempt = 0;

    const started = await startWithRetries({
      start: () => {
        attempt += 1;
        const current = attempt;
        return Promise.resolve({
          getConnectionUri: () => `postgres://test:test@127.0.0.1:${String(current)}/test`,
          stop: () => Promise.reject(new Error('no such container')),
        });
      },
      probe: (uri) => (uri.includes(':1/') ? Promise.reject(refused(1)) : Promise.resolve()),
      readyTimeoutMs: 1_000,
      log: (line) => lines.push(line),
      ...fakeTime(),
    });

    expect(started.getConnectionUri()).toContain(':2/');
    expect(lines[0]).toBe(
      'integration Postgres: could not stop the container of attempt 1 (no such container)',
    );
  });

  it('reports a thrown value that is not an Error', async () => {
    const failing = startWithRetries({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
      start: () => Promise.reject('docker went away'),
      probe: () => Promise.resolve(),
      retries: 0,
      log: () => undefined,
      ...fakeTime(),
    });

    await expect(failing).rejects.toThrow('attempt 1: start: docker went away');
  });

  it('logs to stderr and sleeps on the wall clock by default', async () => {
    const written: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      let calls = 0;
      const started = await startWithRetries({
        start: (attempt) =>
          attempt === 1
            ? Promise.reject(new Error('Port 1 not bound'))
            : Promise.resolve(fakeContainer(attempt, [])),
        probe: () => (++calls === 1 ? Promise.reject(refused(1)) : Promise.resolve()),
      });

      expect(started.getConnectionUri()).toContain(':40002/');
    } finally {
      stderr.mockRestore();
    }
    expect(written).toEqual([
      'integration Postgres: attempt 1 of 3 failed (start: Port 1 not bound); starting a fresh container\n',
    ]);
  });
});

describe('selectOne (K7B-13)', () => {
  it('rejects with the refusal when nothing listens on the port', async () => {
    await expect(selectOne('postgres://test:test@127.0.0.1:1/test')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });
});

describe('definePostgresContainer (K7B-13, C73.8)', () => {
  /** The container's create options and startup timeout, which Testcontainers keeps protected. */
  const settings = (container: unknown) =>
    container as { createOpts: { Image: string; Cmd?: string[] }; startupTimeoutMs?: number };

  it('defines the pinned image with POSTGRES_TEST_COMMAND and a startup timeout that leaves room for two retries', async () => {
    const container = settings(await definePostgresContainer());

    expect(container.createOpts.Image).toBe(POSTGRES_TEST_IMAGE);
    // C258.1 (Phase 11, Workflow 11C): the tag CLAUDE.md names, with the plan's digest.
    expect(POSTGRES_TEST_IMAGE).toBe(
      'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f',
    );
    expect(container.createOpts.Cmd).toEqual([...POSTGRES_TEST_COMMAND]);
    expect(container.startupTimeoutMs).toBe(INTEGRATION_POSTGRES_STARTUP_TIMEOUT_MS);
    expect(INTEGRATION_POSTGRES_STARTUP_TIMEOUT_MS).toBe(60_000);
  });

  it("keeps the image's own command only when asked, for the log test's control", async () => {
    const container = settings(await definePostgresContainer({ imageCommand: true }));

    expect(container.createOpts.Cmd).toBeUndefined();
  });

  it("applies a caller's own options (labels, reuse) after the command", async () => {
    const container = await definePostgresContainer({
      configure: (defined) => defined.withLabels({ 'org.openverify.test': 'labelled' }).withReuse(),
    });
    const set = container as unknown as {
      createOpts: { Cmd?: string[]; Labels?: Record<string, string> };
      reuse: boolean;
    };

    expect(set.createOpts.Labels).toMatchObject({ 'org.openverify.test': 'labelled' });
    expect(set.reuse).toBe(true);
    expect(set.createOpts.Cmd).toEqual([...POSTGRES_TEST_COMMAND]);
  });
});

describe('ifSet', () => {
  it('passes a value through, typed as possibly unset, for an afterAll after a beforeAll that failed', () => {
    const unset = undefined as unknown as { end(): string };
    const pool = { end: () => 'ended' };

    expect(ifSet(unset)?.end()).toBeUndefined();
    expect(ifSet(pool)?.end()).toBe('ended');
  });
});
