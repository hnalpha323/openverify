/**
 * C101.3, C101.5, C101.6, C102.4, C107.1, C107.2 (Workflow 7B Stage 1b (G)): the `graph-index` and
 * `graph-query` queues. A job's id is its object's id; it carries ids only, and is removed when it
 * completes or fails, because the row is the record and a kept job id would make every later add a
 * no-op. A query run is one attempt: the sweep is its retry. Built from a connection, a producer
 * opens its queue only on first use.
 */
import { newId } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { GraphIndexJob, GraphQueryJob } from '../ports.js';
import {
  GRAPH_BACKFILL_INTERVAL_MS,
  GRAPH_BACKFILL_QUEUE,
  GRAPH_COMPONENTS_PATTERN,
  GRAPH_COMPONENTS_QUEUE,
  GRAPH_INDEX_JOB,
  GRAPH_INDEX_JOB_OPTIONS,
  GRAPH_INDEX_QUEUE,
  GRAPH_INDEX_SWEEP_QUEUE,
  GRAPH_QUERY_JOB,
  GRAPH_QUERY_JOB_OPTIONS,
  GRAPH_QUERY_QUEUE,
  GRAPH_QUERY_SWEEP_QUEUE,
  GRAPH_SWEEP_INTERVAL_MS,
  createGraphIndexQueue,
  createGraphQueryQueue,
} from './graph-queues.js';
import { createRecordingQueue } from './testing.js';

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

const environmentId = newId('env');

describe('the graph queues (C107.1, C107.2)', () => {
  it('has the names and periods of the plan', () => {
    expect([GRAPH_INDEX_QUEUE, GRAPH_QUERY_QUEUE]).toEqual(['graph-index', 'graph-query']);
    expect([
      GRAPH_INDEX_SWEEP_QUEUE,
      GRAPH_QUERY_SWEEP_QUEUE,
      GRAPH_BACKFILL_QUEUE,
      GRAPH_COMPONENTS_QUEUE,
    ]).toEqual(['graph-index-sweep', 'graph-query-sweep', 'graph-backfill', 'graph-components']);
    expect(GRAPH_SWEEP_INTERVAL_MS).toBe(15_000);
    expect(GRAPH_BACKFILL_INTERVAL_MS).toBe(60_000);
    expect(GRAPH_COMPONENTS_PATTERN).toBe('0 3 * * *');
    expect(GRAPH_INDEX_JOB_OPTIONS).toMatchObject({ removeOnComplete: true, removeOnFail: true });
    expect(GRAPH_QUERY_JOB_OPTIONS).toEqual({
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('keys an index job by its inquiry, and carries ids only', async () => {
    const recording = createRecordingQueue<GraphIndexJob>();
    const inquiryId = newId('inq');

    await createGraphIndexQueue({ queue: recording }).enqueueGraphIndex({
      environmentId,
      inquiryId,
    });

    expect(recording.jobs).toEqual([
      {
        name: GRAPH_INDEX_JOB,
        data: { environmentId, inquiryId },
        options: expect.objectContaining({ jobId: inquiryId, attempts: 5 }) as unknown,
      },
    ]);
  });

  it('keys a query run by its query, one attempt', async () => {
    const recording = createRecordingQueue<GraphQueryJob>();
    const graphQueryId = newId('grphq');

    await createGraphQueryQueue({ queue: recording }).enqueueGraphQuery({
      environmentId,
      graphQueryId,
    });

    expect(recording.jobs).toEqual([
      {
        name: GRAPH_QUERY_JOB,
        data: { environmentId, graphQueryId },
        options: { ...GRAPH_QUERY_JOB_OPTIONS, jobId: graphQueryId },
      },
    ]);
  });

  it('refuses an id of another kind, before any queue opens', async () => {
    const index = createGraphIndexQueue({ connection: { url: 'redis://127.0.0.1:1' } });
    const queries = createGraphQueryQueue({ connection: { url: 'redis://127.0.0.1:1' } });

    await expect(
      index.enqueueGraphIndex({ environmentId, inquiryId: newId('acc') }),
    ).rejects.toThrow(TypeError);
    await expect(
      queries.enqueueGraphQuery({ environmentId, graphQueryId: newId('grqt') }),
    ).rejects.toThrow(TypeError);
    expect(bull.created).toEqual([]);
    await index.close();
    await queries.close();
  });

  it('opens its BullMQ queue on first use', async () => {
    const queries = createGraphQueryQueue({ connection: { url: 'redis://127.0.0.1:1' } });
    await queries.enqueueGraphQuery({ environmentId, graphQueryId: newId('grphq') });
    expect(bull.created).toEqual(['graph-query']);
    await queries.close();
  });
});
