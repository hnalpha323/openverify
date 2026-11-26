/**
 * C92.2, C107.1 (Workflow 7A Stage 1b (N)): the network repeatable job. `network-refresh` runs every
 * 15 minutes only with `OPENVERIFY_NETWORK_REFRESH=true`, never in CI, and runs its owner's
 * function (`jobs/repeatable/network.ts`, `api-network`) with the worker's deps and settings.
 * Workflow 7B (G): the graph's sweeps, backfill tick and nightly components, with the worker's keys.
 */
import { randomBytes } from 'node:crypto';
import { createKeyring, type Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import { NO_NETWORK_SETTINGS } from '../../config.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createRecordingInquirySignalsQueue,
  createRefusingOutboundHttp,
  createRecordingEventPublisher,
} from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import {
  NETWORK_REFRESH_INTERVAL_MS,
  NETWORK_REFRESH_QUEUE,
  phase7RepeatableJobs,
  type RepeatableJobDeps,
} from './index.js';

const refresh = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ due: 2, applied: 1, unchanged: 1, refused: 0, failed: 0 })),
);
vi.mock('./network.js', () => ({ runNetworkRefresh: refresh }));
const sweep = vi.hoisted(() => vi.fn(() => Promise.resolve({ enqueued: 3 })));
vi.mock('../signals/sweep.js', () => ({ runInquirySignalsSweep: sweep }));
const listScreenSweep = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../lists/sweep.js', () => ({ runListScreenSweep: listScreenSweep }));
const listImportSweep = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../importers/sweep.js', () => ({ runListImportSweep: listImportSweep }));
const listItemEmbedSweep = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../lists/embed.js', () => ({ runListItemEmbedSweep: listItemEmbedSweep }));
const graphIndexSweep = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../graph/index-sweep.js', () => ({ runGraphIndexSweep: graphIndexSweep }));
const graphQuerySweep = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../graph/query-sweep.js', () => ({ runGraphQuerySweep: graphQuerySweep }));
const graphBackfill = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../graph/backfill.js', () => ({ runGraphBackfill: graphBackfill }));
const graphComponents = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../graph/components.js', () => ({ runGraphComponents: graphComponents }));

function deps(): RepeatableJobDeps {
  return {
    db: {} as Db,
    clock: { now: () => new Date('2026-10-30T00:00:00Z') },
    logger: createCapturingLogger(),
    outboundHttp: createRefusingOutboundHttp(),
  };
}

describe('phase7RepeatableJobs (C92.2, C107.1)', () => {
  it('names network-refresh and its 15-minute period', () => {
    expect([NETWORK_REFRESH_QUEUE, NETWORK_REFRESH_INTERVAL_MS]).toEqual([
      'network-refresh',
      900_000,
    ]);
  });

  it('schedules nothing without the network settings, or with the refresh off', () => {
    const storage = createInMemoryFileStorage();

    expect(phase7RepeatableJobs(deps(), undefined)).toEqual([]);
    expect(phase7RepeatableJobs(deps(), { storage, network: NO_NETWORK_SETTINGS })).toEqual([]);
  });

  it('refreshes every 15 minutes when told to, with the worker’s deps', async () => {
    const storage = createInMemoryFileStorage();
    const network = { ...NO_NETWORK_SETTINGS, refresh: true };
    const base = deps();

    const jobs = phase7RepeatableJobs(base, { storage, network });

    expect(jobs.map(({ name, repeat }) => ({ name, repeat }))).toEqual([
      { name: 'network-refresh', repeat: { every: 900_000 } },
    ]);
    await expect(jobs[0]?.run()).resolves.toEqual({
      due: 2,
      applied: 1,
      unchanged: 1,
      refused: 0,
      failed: 0,
    });
    expect(refresh).toHaveBeenCalledWith({
      db: base.db,
      clock: base.clock,
      logger: base.logger,
      outboundHttp: base.outboundHttp,
      storage,
      network,
    });
  });
});

describe('phase7RepeatableJobs: the inquiry-signals-sweep (C90.5, C107.1)', () => {
  it('sweeps every 15 seconds whenever the worker has the signals producer, with the worker’s deps', async () => {
    const signals = createRecordingInquirySignalsQueue();
    const base = deps();

    const jobs = phase7RepeatableJobs(base, undefined, { signals });

    expect(jobs.map(({ name, repeat }) => ({ name, repeat }))).toEqual([
      { name: 'inquiry-signals-sweep', repeat: { every: 15_000 } },
    ]);
    await expect(jobs[0]?.run()).resolves.toEqual({ enqueued: 3 });
    expect(sweep).toHaveBeenCalledWith({
      db: base.db,
      clock: base.clock,
      logger: base.logger,
      signals,
    });
  });

  it('comes before the network refresh, and is absent without the producer', () => {
    const storage = createInMemoryFileStorage();
    const network = { ...NO_NETWORK_SETTINGS, refresh: true };
    const signals = createRecordingInquirySignalsQueue();

    expect(
      phase7RepeatableJobs(deps(), { storage, network }, { signals }).map((job) => job.name),
    ).toEqual(['inquiry-signals-sweep', 'network-refresh']);
    expect(phase7RepeatableJobs(deps(), { storage, network }).map((job) => job.name)).toEqual([
      'network-refresh',
    ]);
  });
});

describe('phase7RepeatableJobs: the list sweeps (C99.4, C99.7, C100.2, C107.1)', () => {
  const lists = {
    screens: { enqueueListScreen: () => Promise.resolve() },
    imports: { enqueueListImport: () => Promise.resolve() },
    embeds: { enqueueListItemEmbed: () => Promise.resolve() },
    events: createRecordingEventPublisher(),
  };

  it('sweeps every 15 seconds whenever the worker has the list producers, with its deps', async () => {
    const base = deps();

    const jobs = phase7RepeatableJobs(base, undefined, undefined, lists);

    expect(jobs.map(({ name, repeat }) => ({ name, repeat }))).toEqual([
      { name: 'list-screen-sweep', repeat: { every: 15_000 } },
      { name: 'list-import-sweep', repeat: { every: 15_000 } },
      { name: 'list-item-embed-sweep', repeat: { every: 15_000 } },
    ]);
    await Promise.all(jobs.map((job) => job.run()));
    const shared = { db: base.db, clock: base.clock, logger: base.logger };
    expect(listScreenSweep).toHaveBeenCalledWith({ ...shared, screens: lists.screens });
    expect(listImportSweep).toHaveBeenCalledWith({ ...shared, imports: lists.imports });
    expect(listItemEmbedSweep).toHaveBeenCalledWith({
      ...shared,
      embeds: lists.embeds,
      events: lists.events,
    });
  });

  it('schedules none without them', () => {
    expect(phase7RepeatableJobs(deps(), undefined, undefined, undefined)).toEqual([]);
  });
});

describe('phase7RepeatableJobs: the graph jobs (C101.3, C101.5, C101.6, C102.4, C107.1)', () => {
  const graph = {
    index: { enqueueGraphIndex: () => Promise.resolve() },
    queries: { enqueueGraphQuery: () => Promise.resolve() },
    keyring: createKeyring(randomBytes(32)),
    blindIndexKey: new Uint8Array(32).fill(4),
  };

  it('schedules the two sweeps, the backfill tick and the nightly components, with their deps', async () => {
    const base = deps();

    const jobs = phase7RepeatableJobs(base, undefined, undefined, undefined, graph);

    expect(jobs.map(({ name, repeat }) => ({ name, repeat }))).toEqual([
      { name: 'graph-index-sweep', repeat: { every: 15_000 } },
      { name: 'graph-query-sweep', repeat: { every: 15_000 } },
      { name: 'graph-backfill', repeat: { every: 60_000 } },
      { name: 'graph-components', repeat: { pattern: '0 3 * * *' } },
    ]);
    await Promise.all(jobs.map((job) => job.run()));
    const shared = { db: base.db, clock: base.clock, logger: base.logger };
    expect(graphIndexSweep).toHaveBeenCalledWith({ ...shared, index: graph.index });
    expect(graphQuerySweep).toHaveBeenCalledWith({ ...shared, queries: graph.queries });
    expect(graphBackfill).toHaveBeenCalledWith({
      ...shared,
      keyring: graph.keyring,
      blindIndexKey: graph.blindIndexKey,
    });
    expect(graphComponents).toHaveBeenCalledWith(shared);
  });

  it('comes after the list sweeps and before the network refresh, and is absent without them', () => {
    const storage = createInMemoryFileStorage();
    const network = { ...NO_NETWORK_SETTINGS, refresh: true };
    const lists = {
      screens: { enqueueListScreen: () => Promise.resolve() },
      imports: { enqueueListImport: () => Promise.resolve() },
      embeds: { enqueueListItemEmbed: () => Promise.resolve() },
      events: createRecordingEventPublisher(),
    };

    expect(
      phase7RepeatableJobs(deps(), { storage, network }, undefined, lists, graph).map(
        (job) => job.name,
      ),
    ).toEqual([
      'list-screen-sweep',
      'list-import-sweep',
      'list-item-embed-sweep',
      'graph-index-sweep',
      'graph-query-sweep',
      'graph-backfill',
      'graph-components',
      'network-refresh',
    ]);
    expect(phase7RepeatableJobs(deps(), undefined, undefined, undefined, undefined)).toEqual([]);
  });
});
