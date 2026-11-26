/**
 * C254.2 (Workflow 11B, ingestion-11b; decision 39): what one check of a source sends. A source that
 * opts in (`conditional: true`) sends `If-None-Match` with the strong `ETag` and `If-Modified-Since`
 * with the `Last-Modified` its last full download carried, so a publisher can answer 304 and nothing
 * is downloaded. A full download and SHA-256 comparison still runs whenever the source opts out, has
 * never been fully checked, keeps no validator, or was last fully checked `watchlist-full-check-hours`
 * ago or more, whatever the 304s said: a publisher whose validator fails to move cannot keep a
 * changed list "fresh" past that window (the honesty risk of decision 10 after 6B). A weak `ETag`
 * (`W/`) or an unreadable date is never sent. Time comes from the caller's clock.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FULL_CHECK_HOURS,
  installFullCheckHours,
  listValidatorsOf,
  planConditionalCheck,
  type ConditionalBasis,
} from './conditional-policy.js';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const HOUR = 3_600_000;
const ETAG = '"synthetic-etag-1"';
const LAST_MODIFIED = 'Fri, 13 Nov 2026 09:00:00 GMT';

const basis = (patch: Partial<ConditionalBasis> = {}): ConditionalBasis => ({
  conditional: true,
  lastSha256: 'a'.repeat(64),
  lastFullCheckAt: new Date(NOW.getTime() - 2 * HOUR),
  validators: { etag: ETAG, lastModified: LAST_MODIFIED },
  ...patch,
});

describe('planConditionalCheck (C254.2)', () => {
  it('sends both validators of the last full download', () => {
    expect(planConditionalCheck(basis(), NOW, 24)).toEqual({
      kind: 'conditional',
      headers: { 'if-none-match': ETAG, 'if-modified-since': LAST_MODIFIED },
    });
  });

  it('sends the one validator it holds', () => {
    expect(
      planConditionalCheck(
        basis({ validators: { etag: null, lastModified: LAST_MODIFIED } }),
        NOW,
        24,
      ),
    ).toEqual({ kind: 'conditional', headers: { 'if-modified-since': LAST_MODIFIED } });
    expect(
      planConditionalCheck(basis({ validators: { etag: ETAG, lastModified: null } }), NOW, 24),
    ).toEqual({ kind: 'conditional', headers: { 'if-none-match': ETAG } });
  });

  it.each([
    ['a source that opts out', basis({ conditional: false }), 'not-conditional'],
    ['a source never applied', basis({ lastSha256: null }), 'never-checked'],
    ['a source never fully checked', basis({ lastFullCheckAt: null }), 'never-checked'],
    [
      'a source without a validator',
      basis({ validators: { etag: null, lastModified: null } }),
      'no-validator',
    ],
    [
      'a full check exactly the window ago',
      basis({ lastFullCheckAt: new Date(NOW.getTime() - 24 * HOUR) }),
      'full-check-due',
    ],
    [
      'a full check past the window',
      basis({ lastFullCheckAt: new Date(NOW.getTime() - 30 * HOUR) }),
      'full-check-due',
    ],
    [
      'a full check dated in the future (a clock moved back)',
      basis({ lastFullCheckAt: new Date(NOW.getTime() + HOUR) }),
      'full-check-due',
    ],
  ])('downloads in full for %s', (_label, input, reason) => {
    expect(planConditionalCheck(input, NOW, 24)).toEqual({ kind: 'full', reason });
  });

  it('honours a shorter window', () => {
    const recent = basis({ lastFullCheckAt: new Date(NOW.getTime() - HOUR) });
    expect(planConditionalCheck(recent, NOW, 2).kind).toBe('conditional');
    expect(planConditionalCheck(recent, NOW, 1)).toEqual({
      kind: 'full',
      reason: 'full-check-due',
    });
  });
});

describe('listValidatorsOf (C254.2)', () => {
  it('keeps a strong ETag and an HTTP date', () => {
    expect(listValidatorsOf({ etag: ETAG, 'last-modified': LAST_MODIFIED })).toEqual({
      etag: ETAG,
      lastModified: LAST_MODIFIED,
    });
  });

  it.each<[Record<string, string>, string]>([
    [{ etag: 'W/"synthetic-weak"' }, 'a weak ETag'],
    [{ etag: 'synthetic-unquoted' }, 'an unquoted ETag'],
    [{ etag: `"${'x'.repeat(300)}"` }, 'an ETag past 256 characters'],
    [{ 'last-modified': 'yesterday' }, 'an unreadable date'],
    [{}, 'no header'],
  ])('keeps no validator for %j (%s)', (headers) => {
    expect(listValidatorsOf(headers)).toEqual({ etag: null, lastModified: null });
  });
});

describe('installFullCheckHours (C254.2)', () => {
  it('is the shortest window any environment set, else the default', () => {
    expect(DEFAULT_FULL_CHECK_HOURS).toBe(24);
    expect(installFullCheckHours([])).toBe(24);
    expect(installFullCheckHours([undefined, null])).toBe(24);
    expect(installFullCheckHours([48, 6, undefined, 168])).toBe(6);
  });

  it('ignores a value outside 1 to 168', () => {
    expect(installFullCheckHours([0, -3, 200, Number.NaN, 2.5])).toBe(24);
  });
});
