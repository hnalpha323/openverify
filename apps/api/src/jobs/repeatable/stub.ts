/**
 * C54.1: the repeatable job of an owner who has not landed yet. It is scheduled only when the
 * operator turned its feature on, and each run logs that it is not built and fails with a stable
 * code, so nothing is ever reported as refreshed. Each owner replaces its file's stub with the
 * real job.
 */
import type { RepeatableJob, RepeatSchedule } from '../../worker.js';
import { PermanentJobError } from '../errors.js';
import type { RepeatableJobDeps } from './index.js';

/** The `reason` of an unbuilt job's failure. */
export const REPEATABLE_JOB_NOT_BUILT = 'repeatable_job_not_built';

export function unbuiltRepeatableJob(
  name: string,
  repeat: RepeatSchedule,
  deps: RepeatableJobDeps,
): RepeatableJob {
  return {
    name,
    repeat,
    run: () => {
      deps.logger.warn({ queue: name }, 'repeatable job not built yet');
      return Promise.reject(new PermanentJobError(REPEATABLE_JOB_NOT_BUILT));
    },
  };
}
