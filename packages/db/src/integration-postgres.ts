/**
 * K7B-13 (after Workflow 7B): the one way an integration test starts its Testcontainers Postgres.
 * Under `pnpm test:integration`'s churn on Docker Desktop (WSL2), one file a run failed at its
 * container's start: a mapped port that refused the first connection right after `start()`
 * returned, or a port Testcontainers never saw bound within its 120 s. Each failing file passed
 * alone. So a start is not done until a real `select 1` answers through the mapped port, polled
 * with backoff; a container whose start throws, or whose port stays refused, is stopped and a fresh
 * one started, at most {@link INTEGRATION_POSTGRES_RETRIES} times, each retry said on stderr.
 *
 * Testcontainers is loaded on the first start, so the unit tests that import `testing` do not load
 * it.
 */
import type { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * C73.8 (P18): the command a Testcontainers Postgres starts with, as compose's does, so the server
 * never logs bind parameters, whatever statement logging a test turns on: candidate retrieval binds
 * the subject's names (C78.3), and the earlier phases bind other personal values. Every container
 * of the repository uses it (owner decision 15 after Workflow 6B, K6A-5), since every one starts
 * through {@link startIntegrationPostgres} (K7B-13); `testing.test.ts` holds every file to that,
 * the log test's control excepted. `@openverify/db/testing` re-exports it.
 */
export const POSTGRES_TEST_COMMAND: readonly string[] = Object.freeze([
  'postgres',
  '-c',
  'log_parameter_max_length=0',
  '-c',
  'log_parameter_max_length_on_error=0',
]);

/** The pinned Postgres image of every integration test (CLAUDE.md). */
export const POSTGRES_TEST_IMAGE =
  'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f';

/** Fresh containers after the first: a start that fails three times is not load. */
export const INTEGRATION_POSTGRES_RETRIES = 2;

/**
 * Testcontainers' wait for each start (its default is 120 s). A healthy start takes seconds even
 * under the suite's load; a port not bound in a minute is the stuck forward a fresh container
 * fixes, and a retry must still fit the 180 s hook guard.
 */
export const INTEGRATION_POSTGRES_STARTUP_TIMEOUT_MS = 60_000;

/** How long a started container's mapped port may refuse `select 1` before it is replaced. */
export const INTEGRATION_POSTGRES_READY_TIMEOUT_MS = 60_000;

const FIRST_DELAY_MS = 100;
const MAX_DELAY_MS = 2_000;
const PROBE_CONNECT_TIMEOUT_MS = 5_000;

/** What the retry loop needs of a started container. */
export interface StartedIntegrationPostgres {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

export interface StartWithRetriesOptions<Started extends StartedIntegrationPostgres> {
  /** Starts one container; `attempt` counts from 1. */
  start: (attempt: number) => Promise<Started>;
  /** One `select 1` through the container's mapped port; rejects when it cannot. */
  probe: (connectionUri: string) => Promise<void>;
  /** {@link INTEGRATION_POSTGRES_RETRIES} by default. */
  retries?: number | undefined;
  /** {@link INTEGRATION_POSTGRES_READY_TIMEOUT_MS} by default. */
  readyTimeoutMs?: number | undefined;
  /** stderr by default. */
  log?: ((line: string) => void) | undefined;
  /**
   * What each line and the error name, `integration Postgres` by default: K8-37 (Workflow 8D
   * review) starts RustFS through this loop as well (`apps/api/src/test-support/integration-rustfs.ts`).
   */
  service?: string | undefined;
  /** What the probe does, as the lines name it: `select 1` by default. */
  probeName?: string | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
}

/** An error's first line, with any URL's credentials masked: never a password in a log. */
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (text.split('\n')[0] ?? '').replace(/(\w+:\/\/)[^@/\s]*@/g, '$1***@');
}

/**
 * Starts a container and returns it once `select 1` answers through its mapped port, starting a
 * fresh one when a start throws or the port stays refused past `readyTimeoutMs`.
 * @throws {Error} naming every attempt's reason, when none answered.
 */
export async function startWithRetries<Started extends StartedIntegrationPostgres>(
  options: StartWithRetriesOptions<Started>,
): Promise<Started> {
  const attempts = (options.retries ?? INTEGRATION_POSTGRES_RETRIES) + 1;
  const readyTimeoutMs = options.readyTimeoutMs ?? INTEGRATION_POSTGRES_READY_TIMEOUT_MS;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const service = options.service ?? 'integration Postgres';
  const probeName = options.probeName ?? 'select 1';

  /** `undefined` once the probe answers, else the last refusal's reason at the deadline. */
  const waitUntilReady = async (uri: string): Promise<string | undefined> => {
    const deadline = now() + readyTimeoutMs;
    for (let delay = FIRST_DELAY_MS; ; delay = Math.min(delay * 2, MAX_DELAY_MS)) {
      try {
        await options.probe(uri);
        return undefined;
      } catch (error) {
        if (now() + delay > deadline) {
          return reasonOf(error);
        }
      }
      await sleep(delay);
    }
  };

  const failures: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let failure: string;
    try {
      const started = await options.start(attempt);
      const refused = await waitUntilReady(started.getConnectionUri());
      if (refused === undefined) {
        return started;
      }
      failure = `no ${probeName} within ${String(readyTimeoutMs / 1000)} s: ${refused}`;
      await started.stop().catch((error: unknown) => {
        log(
          `${service}: could not stop the container of attempt ${String(attempt)} (${reasonOf(error)})`,
        );
      });
    } catch (error) {
      failure = `start: ${reasonOf(error)}`;
    }
    failures.push(`attempt ${String(attempt)}: ${failure}`);
    if (attempt < attempts) {
      log(
        `${service}: attempt ${String(attempt)} of ${String(attempts)} failed (${failure}); starting a fresh container`,
      );
    }
  }
  throw new Error(
    `${service} did not start after ${String(attempts)} attempts: ${failures.join('; ')}`,
  );
}

/** One `select 1` on a new connection, which is closed again. */
export async function selectOne(connectionUri: string): Promise<void> {
  const client = new Client({
    connectionString: connectionUri,
    connectionTimeoutMillis: PROBE_CONNECT_TIMEOUT_MS,
  });
  // A connection lost after the query is not this probe's to report.
  client.on('error', () => undefined);
  await client.connect();
  try {
    await client.query('select 1');
  } finally {
    await client.end();
  }
}

export interface IntegrationPostgresOptions {
  /** {@link POSTGRES_TEST_IMAGE} by default. */
  image?: string | undefined;
  /**
   * Starts with the image's own command instead of `POSTGRES_TEST_COMMAND`, so the server logs bind
   * parameters: only the log test's control (`postgres-logging.integration.test.ts`) asks for it.
   */
  imageCommand?: boolean | undefined;
  /** A caller's own options (labels, reuse, environment), applied to each attempt's container. */
  configure?: ((container: PostgreSqlContainer) => PostgreSqlContainer) | undefined;
}

/** The container one attempt starts: the pinned image, `POSTGRES_TEST_COMMAND`, the wait. */
export async function definePostgresContainer(
  options: IntegrationPostgresOptions = {},
): Promise<PostgreSqlContainer> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = new PostgreSqlContainer(
    options.image ?? POSTGRES_TEST_IMAGE,
  ).withStartupTimeout(INTEGRATION_POSTGRES_STARTUP_TIMEOUT_MS);
  const commanded =
    options.imageCommand === true ? container : container.withCommand([...POSTGRES_TEST_COMMAND]);
  return options.configure === undefined ? commanded : options.configure(commanded);
}

/**
 * A Testcontainers Postgres for an integration test, started without bind-parameter logging
 * (C73.8) and answering `select 1` through its mapped port (K7B-13).
 */
export async function startIntegrationPostgres(
  options: IntegrationPostgresOptions = {},
): Promise<StartedPostgreSqlContainer> {
  return startWithRetries({
    start: async () => (await definePostgresContainer(options)).start(),
    probe: selectOne,
  });
}

/**
 * `value`, typed as possibly unset: an `afterAll` closes what its `beforeAll` may never have made
 * (`await ifSet(pool)?.end()`), so a failed start is reported once, not hidden behind a TypeError.
 */
export const ifSet = <T>(value: T): T | undefined => value;
