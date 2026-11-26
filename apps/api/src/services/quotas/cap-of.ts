/**
 * C251.2 (Phase 11, Workflow 11B Stage 2, `quotas`): the cap in force for an environment's queue, read
 * from its settings in the admission's transaction, so a cap lowered meanwhile takes effect at the
 * next admission. The environment's `queue-in-flight-caps` value (or the default), never above the
 * install ceiling (`caps.ts`); an environment that no longer exists admits nothing.
 */
import type { CappedQueue } from '@openverify/contracts';
import { getEnvironment, type Db } from '@openverify/db';
import { effectiveQueueCap, type InstallQueueLimits } from './caps.js';

/** The cap of `queue` in `environmentId`, read in `tx`. */
export type CapOf = (tx: Db, environmentId: string, queue: CappedQueue) => Promise<number>;

/** {@link CapOf} under the install's limits. */
export function createCapOf(install: InstallQueueLimits): CapOf {
  return async (tx, environmentId, queue) => {
    const environment = await getEnvironment(tx, environmentId);
    if (environment === null) {
      return 0;
    }
    return effectiveQueueCap(queue, environment.settings, install);
  };
}
