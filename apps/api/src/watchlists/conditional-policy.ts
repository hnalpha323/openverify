/**
 * C254.2 (Phase 11, Workflow 11B, ingestion-11b; hardening H3, connect K9; decision 39; Phase 6
 * decision 10 after 6B): what one check of a watchlist source sends. Pure; `conditional.ts` reads
 * the source row and records what the check found.
 *
 * - A source that opts in (`conditional: true` in `watchlists/sources.json`) sends `If-None-Match`
 *   with the strong `ETag` and `If-Modified-Since` with the `Last-Modified` its last full download
 *   carried, so its publisher can answer 304 and nothing is downloaded (`validated-by: http-304`).
 * - A full download and SHA-256 comparison (`validated-by: sha256`) runs whenever the source opts
 *   out, has never been fully checked, keeps no validator, or was last fully checked
 *   `watchlist-full-check-hours` ago or more (or at a time ahead of the clock), whatever the 304s
 *   said, so a publisher whose validator fails to move cannot keep a changed list "fresh" past that
 *   window.
 *
 * Honesty (C254.3): a 304 is the publisher's statement that its representation is unchanged; the
 * platform's own proof remains the periodic digest comparison. Watchlist sources are install-wide
 * rows, so the window applied is the shortest any environment set (ours: no environment's own
 * window is outlived), else the default of 24 hours.
 */
import { WATCHLIST_FULL_CHECK_HOURS } from '@openverify/contracts';

/** The publisher's validators of the last full download. */
export interface ListValidators {
  etag: string | null;
  lastModified: string | null;
}

/** What a check is planned from: the manifest's opt-in and the source row's last checks. */
export interface ConditionalBasis {
  conditional: boolean;
  lastSha256: string | null;
  lastFullCheckAt: Date | null;
  validators: ListValidators;
}

/** Why a check downloads in full. */
export type FullCheckReason =
  'not-conditional' | 'never-checked' | 'full-check-due' | 'no-validator';

export type ConditionalPlan =
  | { kind: 'full'; reason: FullCheckReason }
  | { kind: 'conditional'; headers: Readonly<Record<string, string>> };

/** The default of `watchlist-full-check-hours`. */
export const DEFAULT_FULL_CHECK_HOURS = WATCHLIST_FULL_CHECK_HOURS.default;

const HOUR_MS = 3_600_000;
/** RFC 9110's strong entity tag: a quoted string of visible characters, no `W/`. */
const STRONG_ETAG = /^"[\x21\x23-\x7e]*"$/;
/** Ours: the longest validator kept (a publisher's tags are far shorter). */
const MAX_VALIDATOR_LENGTH = 256;
/** RFC 9110's preferred HTTP date, as publishers send `Last-Modified`. */
const HTTP_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** C254.2: the check `basis` plans at `now` (see the module). */
export function planConditionalCheck(
  basis: ConditionalBasis,
  now: Date,
  fullCheckHours: number,
): ConditionalPlan {
  if (!basis.conditional) {
    return { kind: 'full', reason: 'not-conditional' };
  }
  if (basis.lastSha256 === null || basis.lastFullCheckAt === null) {
    return { kind: 'full', reason: 'never-checked' };
  }
  const age = now.getTime() - basis.lastFullCheckAt.getTime();
  if (!(age >= 0 && age < fullCheckHours * HOUR_MS)) {
    return { kind: 'full', reason: 'full-check-due' };
  }
  const headers: Record<string, string> = {};
  if (basis.validators.etag !== null) {
    headers['if-none-match'] = basis.validators.etag;
  }
  if (basis.validators.lastModified !== null) {
    headers['if-modified-since'] = basis.validators.lastModified;
  }
  return Object.keys(headers).length === 0
    ? { kind: 'full', reason: 'no-validator' }
    : { kind: 'conditional', headers };
}

/** The validators a full download's answer carried worth sending again: strong and readable only. */
export function listValidatorsOf(headers: Readonly<Record<string, string>>): ListValidators {
  const etag = headers.etag;
  const lastModified = headers['last-modified'];
  return {
    etag:
      etag !== undefined && etag.length <= MAX_VALIDATOR_LENGTH && STRONG_ETAG.test(etag)
        ? etag
        : null,
    lastModified:
      lastModified !== undefined &&
      HTTP_DATE.test(lastModified) &&
      !Number.isNaN(Date.parse(lastModified))
        ? lastModified
        : null,
  };
}

/** The install's window: the shortest valid `watchlist-full-check-hours`, else the default. */
export function installFullCheckHours(values: readonly (number | null | undefined)[]): number {
  const valid = values.filter(
    (value): value is number =>
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= WATCHLIST_FULL_CHECK_HOURS.min &&
      value <= WATCHLIST_FULL_CHECK_HOURS.max,
  );
  return valid.length === 0 ? DEFAULT_FULL_CHECK_HOURS : Math.min(...valid);
}
