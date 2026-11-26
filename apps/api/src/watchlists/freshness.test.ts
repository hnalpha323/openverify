/**
 * C69.4, C76.3 (H02, F02, V03), C78.3 (V04): when a run may screen a selected source. Freshness
 * counts from the last successful check: a quiet publisher stays fresh while checks succeed, and
 * failed checks turn it stale; a sandbox-only list is never stale; a source keyed by another
 * version errors; a sandbox list never serves production. Synthetic states only.
 */
import type { WatchlistSourceState } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { isWatchlistSourceStale, watchlistSourceAvailability } from './freshness.js';
import { manifestSource, type WatchlistManifestSource } from './manifest.js';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-26T09:00:00.000Z');
const KEYS = 'names-1;identifiers-1;crypto-1;groups-' + 'a'.repeat(64);

function sourceOf(id: string): WatchlistManifestSource {
  const source = manifestSource(id);
  if (source === undefined) {
    throw new Error(`no source ${id}`);
  }
  return source;
}

const state = (overrides: Partial<WatchlistSourceState> = {}): WatchlistSourceState => ({
  id: 'ofac-sdn',
  enabled: true,
  sandboxOnly: false,
  keysVersion: KEYS,
  lastSyncId: 1,
  lastPublishedAt: new Date('2026-10-23T20:00:00.000Z'),
  lastSha256: 'b'.repeat(64),
  lastAppliedAt: new Date('2026-10-23T21:00:00.000Z'),
  lastCheckedAt: new Date(NOW.getTime() - 5 * HOUR),
  lastOrigin: 'publisher',
  lastErrorCode: null,
  ...overrides,
});

const availability = (overrides: Partial<Parameters<typeof watchlistSourceAvailability>[0]> = {}) =>
  watchlistSourceAvailability({
    source: sourceOf('ofac-sdn'),
    state: state(),
    environmentKind: 'production',
    keysVersion: KEYS,
    maxListAgeHours: 48,
    now: NOW,
    ...overrides,
  });

describe('watchlistSourceAvailability (C69.4, C76.3)', () => {
  it('screens a source checked within its limits, though its publisher has been quiet for days', () => {
    // OFAC published on Friday evening; daily checks over the weekend answered `unchanged`.
    expect(availability()).toEqual({ screenable: true });
  });

  it('turns stale once checks have failed for longer than the smaller of the two limits', () => {
    const lastCheckedAt = new Date(NOW.getTime() - 49 * HOUR);

    expect(availability({ state: state({ lastCheckedAt }) })).toEqual({
      screenable: false,
      code: 'list_stale',
    });
    expect(
      availability({
        state: state({ lastCheckedAt: new Date(NOW.getTime() - 25 * HOUR) }),
        maxListAgeHours: 24,
      }),
    ).toEqual({ screenable: false, code: 'list_stale' });
    expect(availability({ state: state({ lastCheckedAt }), maxListAgeHours: 720 })).toEqual({
      screenable: false,
      code: 'list_stale',
    });
  });

  it('calls a source never synced, without a row, disabled or unknown unavailable', () => {
    const unavailable = { screenable: false, code: 'list_unavailable' };
    expect(
      availability({
        state: state({ lastAppliedAt: null, lastCheckedAt: null, keysVersion: null }),
      }),
    ).toEqual(unavailable);
    expect(availability({ state: undefined })).toEqual(unavailable);
    expect(availability({ state: state({ enabled: false }) })).toEqual(unavailable);
    expect(availability({ source: undefined })).toEqual(unavailable);
  });

  it('errors a source keyed by another version, or any source without the matcher data (V04)', () => {
    const matcher = { screenable: false, code: 'matcher_data_unavailable' };
    expect(availability({ keysVersion: KEYS.replace('a', 'c') })).toEqual(matcher);
    expect(availability({ keysVersion: null })).toEqual(matcher);
  });

  it('never calls a sandbox list stale, but never screens it for production (V03, P13)', () => {
    const sandbox = sourceOf('openverify-sandbox');
    const imported = state({
      id: 'openverify-sandbox',
      sandboxOnly: true,
      lastCheckedAt: new Date(NOW.getTime() - 72 * HOUR),
    });

    expect(availability({ source: sandbox, state: imported, environmentKind: 'sandbox' })).toEqual({
      screenable: true,
    });
    expect(
      availability({
        source: sandbox,
        state: { ...imported, lastCheckedAt: new Date(NOW.getTime() - 9 * 24 * HOUR) },
        environmentKind: 'sandbox',
        maxListAgeHours: 192,
      }),
    ).toEqual({ screenable: true });
    expect(
      availability({ source: sandbox, state: imported, environmentKind: 'production' }),
    ).toEqual({
      screenable: false,
      code: 'list_unavailable',
    });
    expect(
      availability({
        source: sandbox,
        state: { ...imported, lastAppliedAt: null, lastCheckedAt: null },
        environmentKind: 'sandbox',
      }),
    ).toEqual({ screenable: false, code: 'list_unavailable' });
  });
});

describe('isWatchlistSourceStale (the sources page)', () => {
  it('is stale past the source’s own limit, never for a sandbox list or a source never checked', () => {
    expect(isWatchlistSourceStale(sourceOf('ofac-sdn'), state(), NOW)).toBe(false);
    expect(
      isWatchlistSourceStale(
        sourceOf('ofac-sdn'),
        state({ lastCheckedAt: new Date(NOW.getTime() - 49 * HOUR) }),
        NOW,
      ),
    ).toBe(true);
    expect(isWatchlistSourceStale(sourceOf('ofac-sdn'), state({ lastCheckedAt: null }), NOW)).toBe(
      false,
    );
    expect(isWatchlistSourceStale(sourceOf('ofac-sdn'), undefined, NOW)).toBe(false);
    expect(
      isWatchlistSourceStale(
        sourceOf('openverify-sandbox'),
        state({ lastCheckedAt: new Date(NOW.getTime() - 1000 * HOUR) }),
        NOW,
      ),
    ).toBe(false);
  });
});
