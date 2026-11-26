import {
  LIST_MATCH_METHODS,
  LIST_MATCH_STATUSES,
  LIST_MATCH_TIERS,
  LIST_NOT_APPLICABLE_REASONS,
  LIST_PROBE_SOURCES,
  LIST_REVIEW_CAUSES,
  LIST_SCREENING_STATUSES,
  LIST_UNSCREENED_REASONS,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  LIST_MATCH_METHOD_WORDS,
  LIST_MATCH_STATUS_WORDS,
  LIST_MATCH_TIER_WORDS,
  LIST_NOT_APPLICABLE_REASON_WORDS,
  LIST_PROBE_SOURCE_WORDS,
  LIST_REVIEW_CAUSE_WORDS,
  LIST_SCREENING_STATUS_WORDS,
  LIST_UNSCREENED_REASON_WORDS,
} from './list-match-words';

describe('list screening in words (C99, C108; H02, H31)', () => {
  it.each(LIST_SCREENING_STATUSES)('says the screening status %s', (status) => {
    expect(LIST_SCREENING_STATUS_WORDS[status]).toMatch(/^[A-Z]/);
  });

  it.each(['pending', 'partial', 'errored'] as const)(
    'never reads a %s screening as "no match"',
    (status) => {
      expect(LIST_SCREENING_STATUS_WORDS[status]).not.toMatch(/no match/i);
    },
  );

  it.each(LIST_UNSCREENED_REASONS)(
    'says why a list was not screened (%s), never "no match"',
    (reason) => {
      expect(LIST_UNSCREENED_REASON_WORDS[reason]).toMatch(/^[a-z]/);
      expect(LIST_UNSCREENED_REASON_WORDS[reason]).not.toMatch(/no match/i);
    },
  );

  it.each(LIST_NOT_APPLICABLE_REASONS)('says %s as "no value to compare"', (reason) => {
    expect(LIST_NOT_APPLICABLE_REASON_WORDS[reason]).toBe('no value to compare');
  });

  it.each(LIST_REVIEW_CAUSES)('says the review cause %s', (cause) => {
    expect(LIST_REVIEW_CAUSE_WORDS[cause]).toMatch(/^[A-Z]/);
  });

  it('says a decided inquiry as C99.6 does', () => {
    expect(LIST_REVIEW_CAUSE_WORDS.inquiry_already_decided).toBe(
      'Decided before the list screening finished',
    );
  });
});

describe('list matches in words (C99.1, C99.3; H15)', () => {
  it.each(LIST_MATCH_METHODS)('says the method %s', (method) => {
    expect(LIST_MATCH_METHOD_WORDS[method]).toMatch(/^[A-Z]/);
  });

  it.each(LIST_MATCH_STATUSES)('says the status %s', (status) => {
    expect(LIST_MATCH_STATUS_WORDS[status]).toMatch(/^[A-Z]/);
  });

  it.each(LIST_MATCH_TIERS)('says the tier %s', (tier) => {
    expect(LIST_MATCH_TIER_WORDS[tier]).toMatch(new RegExp(`^${tier}\\b`));
  });

  it('marks an H-tier match as a heuristic in beta', () => {
    expect(LIST_MATCH_TIER_WORDS.H).toMatch(/beta/);
  });

  it.each(LIST_PROBE_SOURCES)('says where the probe value %s came from', (source) => {
    expect(LIST_PROBE_SOURCE_WORDS[source]).toMatch(/^[A-Z]/);
  });
});
