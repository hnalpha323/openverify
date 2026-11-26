/**
 * C117.10 (decision 18): the worker reads `CONFIG GET maxmemory-policy` at start and logs an error
 * unless it is `noeviction`; it never refuses to start. Postgres stays the only record, so an evicted
 * job delays work and loses nothing, which is why this is an error line and no more.
 */
import type { WorkerLogger } from '../../jobs/logger.js';

/** The part of a Valkey client the check reads. */
export interface ValkeyConfigReader {
  config(command: 'GET', parameter: string): Promise<unknown>;
}

/** `[name, value]`, as ioredis answers it, or a record of the same. */
function policyOf(answer: unknown): unknown {
  if (Array.isArray(answer)) {
    return answer[1];
  }
  return typeof answer === 'object' && answer !== null
    ? (answer as Record<string, unknown>)['maxmemory-policy']
    : undefined;
}

export async function checkValkeyEvictionPolicy(
  redis: ValkeyConfigReader,
  logger: Pick<WorkerLogger, 'error'>,
): Promise<void> {
  const answer = await redis.config('GET', 'maxmemory-policy');
  const policy = policyOf(answer);
  if (policy !== 'noeviction') {
    logger.error(
      { policy: typeof policy === 'string' ? policy : 'unknown' },
      'Valkey maxmemory-policy is not noeviction: an evicted job delays work until a sweep finds it',
    );
  }
}
