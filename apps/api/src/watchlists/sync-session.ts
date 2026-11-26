/**
 * C76.2 step 1 (P07): the sync's dedicated connection. The session-level advisory lock of a
 * source belongs to one connection, so every later transaction of the sync runs on it and holds
 * the lock until the sync ends (advisory locks are re-entrant within a session).
 */
import { createDatabase, type Db } from '@openverify/db';
import { Pool } from 'pg';
import type { SyncSession } from '../sync/runner.js';

/** A dedicated database connection, held for the whole sync: the sync runner's (C92.2). */
export type WatchlistSession = SyncSession;

/** One connection shared by every step (PGlite, or a caller that holds its own client). */
export function sharedWatchlistSession(db: Db): () => Promise<WatchlistSession> {
  return () => Promise.resolve({ db, release: () => Promise.resolve() });
}

/**
 * A pool's connection per sync. Drizzle runs a transaction on the client it was given unless that
 * client is a pool, so every transaction of the sync stays on this connection.
 */
export function poolWatchlistSessions(pool: Pool): () => Promise<WatchlistSession> {
  return async () => {
    const client = await pool.connect();
    return {
      db: createDatabase(client as unknown as Pool),
      release: () => {
        client.release();
        return Promise.resolve();
      },
    };
  };
}

/**
 * The session opener for `db`: a connection of its pool per sync when it runs over a `pg` pool
 * (the worker, the CLIs), else the one connection it is (PGlite in tests).
 */
export function watchlistSessionsOf(db: Db): () => Promise<WatchlistSession> {
  const client = (db as { $client?: unknown }).$client;
  return client instanceof Pool ? poolWatchlistSessions(client) : sharedWatchlistSession(db);
}
