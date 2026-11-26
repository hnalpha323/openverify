/**
 * C54.1: an owner's repeatable job before it lands never reports a refresh: each run logs that it
 * is not built and fails with a stable code, a permanent failure carrying no data.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { describeJobError } from '../error-description.js';
import { PermanentJobError } from '../errors.js';
import { createCapturingLogger } from '../testing.js';
import { REPEATABLE_JOB_NOT_BUILT, unbuiltRepeatableJob } from './stub.js';

describe('unbuiltRepeatableJob', () => {
  it('keeps its name and schedule, and each run fails as not built', async () => {
    const logger = createCapturingLogger();
    const job = unbuiltRepeatableJob(
      'synthetic-refresh',
      { pattern: '0 3 * * *' },
      {
        db: {} as Db,
        clock: { now: () => new Date('2026-10-23T00:00:00Z') },
        logger,
      },
    );

    expect({ name: job.name, repeat: job.repeat }).toEqual({
      name: 'synthetic-refresh',
      repeat: { pattern: '0 3 * * *' },
    });
    const error = await job.run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PermanentJobError);
    expect((error as PermanentJobError).reason).toBe(REPEATABLE_JOB_NOT_BUILT);
    expect(describeJobError(error)).toBe('The job cannot succeed (repeatable_job_not_built)');
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        object: { queue: 'synthetic-refresh' },
        message: 'repeatable job not built yet',
      },
    ]);
  });
});
