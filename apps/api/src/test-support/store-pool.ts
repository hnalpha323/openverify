import { Pool } from 'pg';

/**
 * The Postgres pool of an integration test that stops its own Postgres container while the pool is
 * open (`src/http/readiness.integration.test.ts`, C250.1). Its idle clients' errors are dropped:
 * a stopped store ends them, and that is what the test observes, not a crash.
 *
 * A connect or a query that waits on a peer that never answers (a connect the port forwarder
 * accepted as the container stopped, or a socket whose close never arrived) gives up after 2 s,
 * so `pool.end()` in the test's afterAll never waits for ever (Workflow 11F: the hook met its
 * 180 s guard once). The probes /ready runs give up after 1 s on their own (C250.1).
 */
export function storePool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_000,
  });
  pool.on('error', () => undefined);
  return pool;
}
