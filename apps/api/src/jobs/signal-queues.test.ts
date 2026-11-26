/**
 * C90.5, C107.1, C107.2 (Workflow 7A Stage 1b (S)): the `inquiry-signals` queue. A job's id is its
 * inquiry id; it carries ids only, and is removed when it completes or fails, because the outbox
 * row is the record and a kept job id would make every later add a no-op. Built from a
 * connection, the producer opens its queue only on first use.
 */
import { describe, expect, it, vi } from 'vitest';
import type { InquirySignalsJob } from '../ports.js';
import { createRecordingQueue } from './testing.js';
import {
  INQUIRY_SIGNALS_JOB,
  INQUIRY_SIGNALS_JOB_OPTIONS,
  INQUIRY_SIGNALS_QUEUE,
  INQUIRY_SIGNALS_SWEEP_INTERVAL_MS,
  INQUIRY_SIGNALS_SWEEP_QUEUE,
  createInquirySignalsQueue,
} from './signal-queues.js';

const bull = vi.hoisted(() => ({ created: [] as string[] }));
vi.mock('./queue.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./queue.js')>();
  return {
    ...original,
    createBullQueue: (name: string) => {
      bull.created.push(name);
      return { add: () => Promise.resolve(), close: () => Promise.resolve() };
    },
  };
});

const job: InquirySignalsJob = {
  environmentId: 'env_01M5CJXHG0000000000000000A',
  inquiryId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH',
};

describe('the inquiry-signals names and sweep period (C107.1, C107.2)', () => {
  it('are their own, and the sweep runs every 15 seconds', () => {
    expect([INQUIRY_SIGNALS_QUEUE, INQUIRY_SIGNALS_JOB]).toEqual([
      'inquiry-signals',
      'inquiry-signals',
    ]);
    expect([INQUIRY_SIGNALS_SWEEP_QUEUE, INQUIRY_SIGNALS_SWEEP_INTERVAL_MS]).toEqual([
      'inquiry-signals-sweep',
      15_000,
    ]);
  });
});

describe('createInquirySignalsQueue (C90.5)', () => {
  it('removes finished jobs, and retries five times with backoff and jitter', () => {
    expect(INQUIRY_SIGNALS_JOB_OPTIONS).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('enqueues one job per inquiry under the inquiry id, with the ids only', async () => {
    const queue = createRecordingQueue<InquirySignalsJob>();
    await createInquirySignalsQueue({ queue }).enqueueInquirySignals({
      ...job,
      signals: 'never enqueued',
    } as InquirySignalsJob);

    expect(queue.jobs).toEqual([
      {
        name: 'inquiry-signals',
        data: job,
        options: { ...INQUIRY_SIGNALS_JOB_OPTIONS, jobId: job.inquiryId },
      },
    ]);
  });

  it.each([
    ['a malformed environment id', { ...job, environmentId: 'env:1' }],
    ['an inquiry id of another kind', { ...job, inquiryId: 'rep_01M5CK16P0D13FXHZSS4TCFBVH' }],
  ])('refuses %s', async (_label, bad) => {
    const queue = createRecordingQueue<InquirySignalsJob>();

    await expect(createInquirySignalsQueue({ queue }).enqueueInquirySignals(bad)).rejects.toThrow(
      TypeError,
    );
    expect(queue.jobs).toEqual([]);
  });

  it('propagates a queue failure to the caller and closes its queue', async () => {
    const queue = createRecordingQueue<InquirySignalsJob>();
    queue.fail = new Error('connection is closed');
    const producer = createInquirySignalsQueue({ queue });

    await expect(producer.enqueueInquirySignals(job)).rejects.toThrow('connection is closed');
    await producer.close();
    expect(queue.closed).toBe(true);
  });

  it('opens its BullMQ queue only on the first enqueue', async () => {
    bull.created.length = 0;
    const producer = createInquirySignalsQueue({ connection: { url: 'redis://127.0.0.1:1' } });
    expect(bull.created).toEqual([]);

    await producer.enqueueInquirySignals(job);
    await producer.enqueueInquirySignals(job);

    expect(bull.created).toEqual(['inquiry-signals']);
    await producer.close();
  });
});
