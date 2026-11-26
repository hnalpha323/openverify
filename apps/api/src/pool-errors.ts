/**
 * node-postgres emits `error` on a pool when one of its idle clients loses its connection: a
 * Postgres restart or failover, an administrator's terminate, or the server stopping while the
 * pool closes. The pool has already discarded that client and connects a new one for the next
 * query, but an `error` event nobody listens to throws and stops the process. The listener logs
 * the error class and SQLSTATE only, since the message can quote the server.
 */
import type { Pool } from 'pg';
import type { WorkerLogger } from './jobs/logger.js';

export function logPoolErrors(pool: Pick<Pool, 'on'>, logger: Pick<WorkerLogger, 'error'>): void {
  pool.on('error', (error: Error & { code?: string }) => {
    logger.error({ error: error.name, code: error.code }, 'database connection lost');
  });
}
