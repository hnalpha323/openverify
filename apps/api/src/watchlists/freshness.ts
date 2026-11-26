/**
 * C69.4, C76.3 (H02, F02, V03), C78.3: whether a run may screen a selected source, and whether the
 * sources page calls it stale. Freshness counts from the last successful check, never from the
 * publisher's last change; a sandbox-only list is never stale. Owner: `api-watchlists`; the report
 * run framework (`api-reports`) may read it.
 */
import type { EnvironmentKind, WatchlistSourceState } from '@openverify/db';
import type { WatchlistManifestSource } from './manifest.js';

/** What a run does with a selected source (C69.4): screen it, or error with the code. */
export type WatchlistSourceAvailability =
  | { readonly screenable: true }
  | {
      readonly screenable: false;
      readonly code: 'list_unavailable' | 'list_stale' | 'matcher_data_unavailable';
    };

export interface SourceAvailabilityInput {
  source: WatchlistManifestSource | undefined;
  state: WatchlistSourceState | undefined;
  environmentKind: EnvironmentKind;
  /** This process's `keysVersion()`, or `null` without the matcher data. */
  keysVersion: string | null;
  /** The template's `max-list-age-hours`, or `null`. */
  maxListAgeHours: number | null;
  now: Date;
}

const HOUR_MS = 3_600_000;

/**
 * C69.4: what a run does with one selected source. Unavailable: unknown, without a row, disabled,
 * never synced or imported, or sandbox-only in production (P13). Matcher data unavailable: keyed
 * by another `keysVersion()`, or no matcher data in this process (V04). Stale: no successful
 * check within the smaller of the source's `stale_after_hours` and the template's
 * `max-list-age-hours` (C76.3); a sandbox-only list is never stale (V03).
 */
export function watchlistSourceAvailability(
  input: SourceAvailabilityInput,
): WatchlistSourceAvailability {
  const { source, state } = input;
  const unavailable = { screenable: false, code: 'list_unavailable' } as const;
  if (
    source === undefined ||
    state === undefined ||
    !state.enabled ||
    state.lastAppliedAt === null ||
    state.lastCheckedAt === null ||
    ((state.sandboxOnly || source.sandbox_only) && input.environmentKind !== 'sandbox')
  ) {
    return unavailable;
  }
  if (input.keysVersion === null || state.keysVersion !== input.keysVersion) {
    return { screenable: false, code: 'matcher_data_unavailable' };
  }
  if (source.sandbox_only) {
    return { screenable: true };
  }
  const limits = [source.stale_after_hours, input.maxListAgeHours].filter(
    (hours): hours is number => hours !== null,
  );
  const limitMs = Math.min(...limits) * HOUR_MS;
  return input.now.getTime() - state.lastCheckedAt.getTime() > limitMs
    ? { screenable: false, code: 'list_stale' }
    : { screenable: true };
}

/**
 * C76.3: the sources page's staleness: a source checked once whose last successful check is older
 * than its own `stale_after_hours`. A sandbox list is never stale; one never checked is not stale
 * but unavailable, which the page shows from its other fields.
 */
export function isWatchlistSourceStale(
  source: WatchlistManifestSource,
  state: WatchlistSourceState | undefined,
  now: Date,
): boolean {
  const checked = state?.lastCheckedAt ?? null;
  return (
    !source.sandbox_only &&
    source.stale_after_hours !== null &&
    checked !== null &&
    now.getTime() - checked.getTime() > source.stale_after_hours * HOUR_MS
  );
}
