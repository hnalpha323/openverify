import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { IntervalSet } from '../network/interval-set.js';
import { MmdbSnapshot } from '../network/mmdb.js';
import { loadSnapshot } from '../network/snapshot.js';
import type { TorExitSet } from '../network/tor-exit-list.js';
import { MEASURED_SOURCES, measureScenario, writeMemoryFiles } from './memory-measurement.js';

const directory = mkdtempSync(join(tmpdir(), 'openverify-signals-memory-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const SCALE = 0.001;

describe('the snapshot memory measurement (C92.3), at a tiny scale', () => {
  const files = writeMemoryFiles(directory, SCALE);

  it('writes MMDBs padded to the measured sizes, which open for their roles', () => {
    for (const [name, role, size] of [
      ['country', 'country', MEASURED_SOURCES.mmdbBytes.country],
      ['asn', 'asn', MEASURED_SOURCES.mmdbBytes.asn],
      ['asn-next', 'asn', MEASURED_SOURCES.mmdbBytes.asn],
      ['city', 'city', MEASURED_SOURCES.mmdbBytes.city],
      ['city-next', 'city', MEASURED_SOURCES.mmdbBytes.city],
    ] as const) {
      const bytes = statSync(files.mmdb[name]).size;
      expect(bytes, name).toBeGreaterThanOrEqual(Math.floor(size * SCALE));
      expect(bytes, name).toBeLessThan(size * SCALE * 1.2 + 8192);
      expect(MmdbSnapshot.open(readFileSync(files.mmdb[name]), role).role).toBe(role);
    }
    expect(readFileSync(files.mmdb.asn).equals(readFileSync(files.mmdb['asn-next']))).toBe(false);
  });

  it('writes range and exit snapshots with the measured counts, as stored objects', () => {
    for (const [source, prefixes] of Object.entries(MEASURED_SOURCES.rangePrefixes)) {
      const path = files.ranges[source];
      expect(path, source).toBeDefined();
      const set = loadSnapshot('ranges', readFileSync(path ?? '')) as IntervalSet<unknown>;
      expect(set.size, source).toBe(Math.max(1, Math.round(prefixes * SCALE)));
    }
    const exits = loadSnapshot('tor-exits', readFileSync(files.tor)) as TorExitSet;
    expect(exits.size).toBe(Math.max(1, Math.round(MEASURED_SOURCES.torExits * SCALE)));
  });

  it('reports the steady state and the swap of each scenario', async () => {
    for (const scenario of [
      { city: false, swap: 'asn', load: 'read' },
      { city: true, swap: 'city', load: 'stream' },
    ] as const) {
      const report = await measureScenario(files, scenario);
      expect(report.scenario).toEqual(scenario);
      const expected =
        statSync(files.mmdb.country).size +
        statSync(files.mmdb.asn).size +
        (scenario.city ? statSync(files.mmdb.city).size : 0);
      expect(report.snapshotBytes).toBeGreaterThan(expected);
      for (const value of [
        report.baselineRss,
        report.steadyRss,
        report.bothHeldRss,
        report.afterSwapRss,
        report.peakRss,
      ]) {
        expect(value).toBeGreaterThan(0);
      }
      expect(report.peakRss).toBeGreaterThanOrEqual(report.peakRssBeforeSwap);
      expect(report.peakRss).toBeGreaterThanOrEqual(report.steadyRss);
      expect(report.steadyArrayBuffers).toBeGreaterThan(0);
      expect(report.swapPeakDelta).toBe(report.peakRss - report.steadyRss);
    }
  });
});
