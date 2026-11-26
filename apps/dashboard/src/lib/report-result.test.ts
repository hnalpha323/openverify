import { REPORT_TYPES_WITH_REVIEW } from '@openverify/contracts';
import { REPORT_COVERAGE_LIMITS, REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  REPORT_COVERAGE_LIMIT_LABELS,
  REPORT_RESULT_LABELS,
  coverageText,
  reportResultOf,
  type ReportResult,
} from './report-result';

const RESULTS: readonly ReportResult[] = [
  'pending',
  'match',
  'no-match',
  'match-not-screened',
  'not-screened',
  'computed',
];

describe('a report result in words (C69.4, C86)', () => {
  it.each(RESULTS)('labels the result %s', (result) => {
    expect(REPORT_RESULT_LABELS[result]).toMatch(/^[A-Z]/);
  });

  it('reads a type with review by its status and has-match', () => {
    expect(reportResultOf('watchlist', 'ready', true)).toBe('match');
    expect(reportResultOf('watchlist', 'ready', false)).toBe('no-match');
    expect(reportResultOf('watchlist', 'pending', false)).toBe('pending');
    expect(reportResultOf('watchlist', 'submitted', false)).toBe('pending');
  });

  it.each(REPORT_TYPES)(
    'reads an errored %s report as not screened, never as no match (C69.4)',
    (type) => {
      const result = reportResultOf(type, 'errored', false);
      expect(result).toBe('not-screened');
      expect(REPORT_RESULT_LABELS[result]).toBe('Not screened');
    },
  );

  it('keeps the matches of a partial run, which is still not fully screened (H01)', () => {
    expect(reportResultOf('watchlist', 'errored', true)).toBe('match-not-screened');
    expect(REPORT_RESULT_LABELS['match-not-screened']).toBe('Match; not fully screened');
  });

  it.each(REPORT_TYPES.filter((type) => !REPORT_TYPES_WITH_REVIEW.includes(type)))(
    'reads a ready %s report as computed: it has no matches to find',
    (type) => {
      expect(reportResultOf(type, 'ready', false)).toBe('computed');
    },
  );
});

describe('coverage in a few words (C78.5)', () => {
  it.each(REPORT_COVERAGE_LIMITS)('labels the limit %s', (limit) => {
    expect(REPORT_COVERAGE_LIMIT_LABELS[limit]).toMatch(/^[A-Z][^_]*$/);
  });

  it('says complete, limited and how, or nothing for a type that compares no names', () => {
    expect(coverageText(null)).toBeNull();
    expect(coverageText({ complete: true, limits: [] })).toBe('Complete');
    expect(coverageText({ complete: false, limits: ['lossy_script', 'truncated'] })).toBe(
      'Limited: lossy script, truncated',
    );
  });
});
