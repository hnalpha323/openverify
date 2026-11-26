// @ts-check
/**
 * C270 (Workflow 11D, matcher-write-11d): the pure helpers of the write-cost steps. The steps
 * themselves need Docker and the data files: they are run, not unit-tested.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  SNAPSHOT_DIRECTORY,
  WRITE_STEPS,
  configurationLabel,
  dumpCommand,
  duringSyncSummary,
  identityPlan,
  identityPublication,
  parseTunes,
  peakMemory,
  restoreCommand,
  snapshotDumpPath,
  syncTakesPlan,
  writeStepOf,
} from './benchmark-write.mjs';

describe('the write steps and their flags (C270)', () => {
  it('reads a write step as its scale and name, and nothing else', () => {
    expect(WRITE_STEPS).toEqual(['snapshot', 'keydf-identity', 'keydf-sync', 'rekey', 'gin-sync']);
    expect(writeStepOf('2m-gin-sync')).toEqual({ scale: '2m', name: 'gin-sync' });
    expect(writeStepOf('100k-rekey')).toEqual({ scale: '100k', name: 'rekey' });
    expect(writeStepOf('100k-snapshot')).toEqual({ scale: '100k', name: 'snapshot' });
    expect(writeStepOf('100k-measure')).toBeNull();
    expect(writeStepOf('3m-rekey')).toBeNull();
    expect(writeStepOf('rekey')).toBeNull();
  });

  it('reads each --tune as a whole number for its tuning (Stage 1a amendment 7)', () => {
    expect(parseTunes(undefined)).toEqual({});
    expect(
      parseTunes(['rekey-batch=2000', 'gin-pending-list-limit=256', 'gin-clean-every=10']),
    ).toEqual({ rekeyBatch: 2000, ginPendingListLimitKb: 256, ginCleanEveryBatches: 10 });
  });

  it('refuses an unknown tuning, a value that is not a whole number, a missing value and a repeat', () => {
    expect(() => parseTunes(['rekey-size=500'])).toThrow(/--tune is one of rekey-batch/);
    expect(() => parseTunes(['rekey-batch=5e2'])).toThrow(/whole number/);
    expect(() => parseTunes(['rekey-batch=-1'])).toThrow(/whole number/);
    expect(() => parseTunes(['rekey-batch'])).toThrow(/<name>=<n>/);
    expect(() => parseTunes(['rekey-batch=500', 'rekey-batch=2000'])).toThrow(/once/);
  });

  it('labels a configuration by its switch and tunings, in a fixed order, or as the status quo', () => {
    expect(configurationLabel({ tunes: {} })).toBe('status-quo');
    expect(configurationLabel({ switch: 'gin-fastupdate-off', tunes: {} })).toBe(
      'gin-fastupdate-off',
    );
    expect(
      configurationLabel({ tunes: { ginCleanEveryBatches: 10, ginPendingListLimitKb: 256 } }),
    ).toBe('gin-pending-list-limit=256+gin-clean-every=10');
    expect(configurationLabel({ switch: 'incremental-key-df', tunes: { rekeyBatch: 5000 } })).toBe(
      'incremental-key-df+rekey-batch=5000',
    );
  });
});

describe('the plans of the resumable steps (C270.1)', () => {
  it('alternates the timed syncs off then on in each take, each followed by an untimed restore with the switch on', () => {
    expect(syncTakesPlan(2)).toEqual([
      { take: 1, state: 'off', kind: 'timed' },
      { take: 1, state: 'on', kind: 'restore' },
      { take: 1, state: 'on', kind: 'timed' },
      { take: 1, state: 'on', kind: 'restore' },
      { take: 2, state: 'off', kind: 'timed' },
      { take: 2, state: 'on', kind: 'restore' },
      { take: 2, state: 'on', kind: 'timed' },
      { take: 2, state: 'on', kind: 'restore' },
    ]);
    expect(() => syncTakesPlan(0)).toThrow(RangeError);
  });

  it('checks the table after every sync of the identity sequence, which changes the variant groups once, then screens it before and after a full rebuild', () => {
    const plan = identityPlan();
    const syncs = plan.filter((item) => item.action === 'sync');

    expect(syncs.map((item) => item.op)).toEqual([1, 2, 3, 4]);
    expect(syncs.map((item) => item.groups)).toEqual(['shipped', 'shipped', 'none', 'none']);
    for (const sync of syncs) {
      expect(plan[plan.indexOf(sync) + 1]).toEqual({ action: 'check', op: sync.op });
    }
    expect(plan.slice(-3)).toEqual([
      { action: 'screen', op: 0, tree: 'incremental' },
      { action: 'rebuild', op: 0 },
      { action: 'screen', op: 0, tree: 'rebuilt' },
    ]);
  });
});

describe('the publications of the identity sequence (C270.1)', () => {
  const table = Array.from({ length: 1000 }, (_, index) => `t${String(index)}`);
  const others = table.map((item) => `${item}-renamed`);
  const added = Array.from({ length: 20 }, (_, index) => `a${String(index)}`);
  const of = (/** @type {number} */ op) => identityPublication({ table, others, added, op });
  const removed = (/** @type {string[]} */ publication) =>
    table.filter((item) => !publication.includes(item) && !publication.includes(`${item}-renamed`));

  it('removes, renames, adds and re-lists by position, each sync removing well under the 10% guard', () => {
    const publications = [1, 2, 3, 4].map(of);

    expect(publications[0]?.filter((item) => item.endsWith('-renamed')).length).toBeGreaterThan(5);
    expect(publications[0]?.filter((item) => item.startsWith('a'))).toEqual(added.slice(0, 10));
    expect(publications[1]?.filter((item) => item.startsWith('a'))).toEqual(added);
    // A re-listing: some entries op 1 removed are back at op 2.
    const relisted = removed(publications[0] ?? []).filter(
      (item) => !removed(publications[1] ?? []).includes(item),
    );
    expect(relisted.length).toBeGreaterThan(0);
    // Op 3 drops a quarter of the added entries.
    expect(publications[2]?.filter((item) => item.startsWith('a')).length).toBe(15);
    // Op 4 takes every rename back.
    expect(publications[3]?.some((item) => item.endsWith('-renamed'))).toBe(false);
    for (let op = 1; op < publications.length; op += 1) {
      const before = new Set(publications[op - 1]);
      const after = new Set(publications[op]);
      const gone = [...before].filter(
        (item) =>
          !after.has(item) &&
          !after.has(`${item}-renamed`) &&
          !after.has(item.replace(/-renamed$/u, '')),
      );
      expect(gone.length / before.size).toBeLessThan(0.05);
    }
  });

  it('keeps every entry of the table in its place otherwise, and refuses an unknown sync', () => {
    const publication = of(1);
    const kept = publication.filter((item) => item.startsWith('t') && !item.endsWith('-renamed'));
    expect(kept).toEqual([...kept].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
    expect(() => of(5)).toThrow(RangeError);
  });
});

describe('what a take records (C270.2, C270.3)', () => {
  it('reads the peak memory of a re-key from its samples, in MiB', () => {
    expect(
      peakMemory([
        { rss: 300 * 2 ** 20, heapUsed: 100 * 2 ** 20 },
        { rss: 512.25 * 2 ** 20, heapUsed: 99 * 2 ** 20 },
        { rss: 400 * 2 ** 20, heapUsed: 2048 * 2 ** 20 },
      ]),
    ).toEqual({ rssMiB: 512.3, heapMiB: 2048 });
    expect(() => peakMemory([])).toThrow(RangeError);
  });

  it('compares the screening p95 during a sync with idle: within twice idle, or not, with the sync’s own time', () => {
    const idle = Array.from({ length: 100 }, (_, index) => index + 1);
    const summary = duringSyncSummary({
      idle,
      during: idle.map((value) => value * 1.5),
      syncSeconds: 312.4,
    });

    expect(summary).toEqual({
      idle: { count: 100, p50: 50, p95: 95 },
      during: { count: 100, p50: 75, p95: 142.5 },
      ratio: 1.5,
      withinTwiceIdle: true,
      syncSeconds: 312.4,
    });
    expect(
      duringSyncSummary({ idle, during: idle.map((value) => value * 3), syncSeconds: 1 })
        .withinTwiceIdle,
    ).toBe(false);
    expect(duringSyncSummary({ idle, during: [], syncSeconds: 1 })).toMatchObject({
      during: { count: 0, p50: null, p95: null },
      ratio: null,
      withinTwiceIdle: null,
    });
  });
});

/**
 * Workflow 11D review (fix-11d; docs/calibration/watchlist-phase11.md finding 1): `CREATE DATABASE …
 * TEMPLATE` ended the benchmark Postgres's backend with exit code 2 after 600-720 MB of the 2.3 GB
 * 2,000,000-name database, six attempts of six, so no 2,000,000-name write step could run. A
 * snapshot is a `pg_dump` file in the container, and each take's database is restored from it.
 */
describe('the snapshots are dumps, and a take restores one (watchlist-phase11 finding 1)', () => {
  it('keeps each snapshot as a custom-format dump file in the container', () => {
    expect(SNAPSHOT_DIRECTORY).toBe('/var/lib/postgresql/openverify-snapshots');
    expect(snapshotDumpPath('snapshot_before_last')).toBe(
      '/var/lib/postgresql/openverify-snapshots/snapshot_before_last.dump',
    );
    expect(() => snapshotDumpPath('../x')).toThrow(/database name/);
  });

  it('dumps without compression and restores in parallel, stopping at the first error', () => {
    expect(dumpCommand({ user: 'test', database: 'evaluation_2m', file: '/s/a.dump' })).toEqual([
      'pg_dump',
      '--username=test',
      '--dbname=evaluation_2m',
      '--format=custom',
      '--compress=0',
      '--file=/s/a.dump',
    ]);
    expect(
      restoreCommand({ user: 'test', database: 'write_rekey', file: '/s/a.dump', jobs: 4 }),
    ).toEqual([
      'pg_restore',
      '--username=test',
      '--dbname=write_rekey',
      '--jobs=4',
      '--exit-on-error',
      '/s/a.dump',
    ]);
  });

  it('copies no database by template any more', async () => {
    const steps = await readFile(new URL('./benchmark-write-steps.mjs', import.meta.url), 'utf8');
    expect(steps).not.toMatch(/\btemplate\s+"/iu);
    expect(steps).toContain('restoreCommand(');
    expect(steps).toContain('dumpCommand(');
  });
});
