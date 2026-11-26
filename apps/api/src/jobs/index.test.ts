import { describe, expect, it } from 'vitest';
import type { ProcessVerificationJob } from '../ports.js';
import {
  PROCESS_VERIFICATION_JOB,
  PROCESS_VERIFICATION_JOB_OPTIONS,
  PROCESS_VERIFICATION_QUEUE,
  createVerificationQueue,
} from './index.js';
import { createRecordingQueue } from './testing.js';

const job: ProcessVerificationJob = {
  environmentId: 'env_01M5CJXHG0000000000000000A',
  verificationId: 'ver_01M5CK16P0D13FXHZSS4TCFBVH',
};

describe('createVerificationQueue', () => {
  it('uses the "process-verification" queue', () => {
    expect(PROCESS_VERIFICATION_QUEUE).toBe('process-verification');
    expect(PROCESS_VERIFICATION_JOB).toBe('process-verification');
  });

  it('enqueues one job per verification, using the verification id as the job id', async () => {
    const queue = createRecordingQueue<ProcessVerificationJob>();
    await createVerificationQueue({ queue }).enqueueProcessVerification(job);
    expect(queue.jobs).toEqual([
      {
        name: 'process-verification',
        data: job,
        options: { ...PROCESS_VERIFICATION_JOB_OPTIONS, jobId: job.verificationId },
      },
    ]);
  });

  it('retries vision outages with exponential backoff and jitter, and keeps job history', () => {
    expect(PROCESS_VERIFICATION_JOB_OPTIONS).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800 },
    });
  });

  it('enqueues only the ids, never other data', async () => {
    const queue = createRecordingQueue<ProcessVerificationJob>();
    await createVerificationQueue({ queue }).enqueueProcessVerification({
      ...job,
      extra: 'ignored',
    } as ProcessVerificationJob);
    expect(queue.jobs[0]?.data).toEqual(job);
  });

  it.each([
    ['a malformed verification id', { ...job, verificationId: 'ver_nope' }],
    ['an id of another kind', { ...job, verificationId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH' }],
    ['a malformed environment id', { ...job, environmentId: 'env:1' }],
  ])('refuses %s', async (_label, invalid) => {
    const queue = createRecordingQueue<ProcessVerificationJob>();
    await expect(
      createVerificationQueue({ queue }).enqueueProcessVerification(invalid),
    ).rejects.toThrow(TypeError);
    expect(queue.jobs).toEqual([]);
  });

  it('propagates queue failures to the caller', async () => {
    const queue = createRecordingQueue<ProcessVerificationJob>();
    queue.fail = new Error('connection is closed');
    await expect(
      createVerificationQueue({ queue }).enqueueProcessVerification(job),
    ).rejects.toThrow('connection is closed');
  });

  it('closes its queue', async () => {
    const queue = createRecordingQueue<ProcessVerificationJob>();
    await createVerificationQueue({ queue }).close();
    expect(queue.closed).toBe(true);
  });
});
