import {
  REPORT_NOTICES,
  REPORT_QUERY_SOURCES,
  REPORT_UNAVAILABLE_REASONS,
  REPORT_RESOURCE_ORIGINS,
} from '@openverify/contracts';
import {
  REPORT_ACTION_TYPES,
  REPORT_COVERAGE_LIMITS,
  REPORT_ERROR_CODES,
  REPORT_ORIGINS,
  REPORT_PAUSED_REASONS,
  REPORT_RUN_NOTES,
  REPORT_RUN_STATUSES,
  REPORT_RUN_TYPES,
  REPORT_SOURCE_ERROR_CODES,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { reportDocsSection } from '../testing/report-docs';
import {
  COMPLETE_COVERAGE_WORDS,
  NAME_SCREENING_TYPES,
  REPORT_ACTION_TYPE_LABELS,
  REPORT_COVERAGE_LIMIT_WORDS,
  REPORT_ERROR_WORDS,
  REPORT_NOTICE_WORDS,
  REPORT_ORIGIN_LABELS,
  REPORT_PAUSED_REASON_LABELS,
  REPORT_QUERY_SOURCE_LABELS,
  REPORT_RUN_NOTE_WORDS,
  REPORT_RUN_STATUS_LABELS,
  REPORT_RUN_TYPE_LABELS,
  REPORT_UNAVAILABLE_REASON_WORDS,
  reportErrorText,
} from './report-words';

/** A sentence or label: it starts with a capital and holds no code. */
const WORDS = /^[A-Z][^_]*$/;

describe('report errors in words (C69.3, C69.4, C86)', () => {
  it.each(REPORT_ERROR_CODES)('says the error %s in words', (code) => {
    const words = REPORT_ERROR_WORDS[code];
    expect(words.title).toMatch(WORDS);
    expect(words.detail).toMatch(WORDS);
  });

  it('words exactly the contract codes', () => {
    expect(Object.keys(REPORT_ERROR_WORDS)).toEqual([...REPORT_ERROR_CODES]);
  });

  it('never reads an error as "no match": an errored report was not screened (C69.4)', () => {
    for (const code of REPORT_ERROR_CODES) {
      const words = reportErrorText({ code });
      expect(`${words?.title ?? ''} ${words?.detail ?? ''}`.toLowerCase()).not.toContain(
        'no match',
      );
    }
  });

  it.each(REPORT_SOURCE_ERROR_CODES)('names the source a %s error is about', (code) => {
    expect(reportErrorText({ code, source: 'eu-fsf' })?.detail).toContain('eu-fsf');
  });

  it('says an empty selection screened nothing, when list_unavailable names no source', () => {
    expect(reportErrorText({ code: 'list_unavailable' })?.detail).toBe(
      'No list was selected, so nothing was screened.',
    );
  });

  it('says what a stale list means and that it was not screened', () => {
    expect(reportErrorText({ code: 'list_stale', source: 'ofac-sdn' })).toEqual({
      title: 'List out of date',
      detail:
        'ofac-sdn was not checked successfully within its stale limit or the template’s maximum list age, so it was not screened.',
    });
  });

  it.each(['no_such_error', 'constructor', '__proto__'])('knows nothing of %s', (code) => {
    expect(reportErrorText({ code })).toBeUndefined();
  });
});

describe('run notes in words (C73.2, C84.3, C75.8, C86)', () => {
  it.each(REPORT_RUN_NOTES)('says the run note %s in words', (note) => {
    expect(REPORT_RUN_NOTE_WORDS[note]).toMatch(WORDS);
  });

  it('words exactly the contract notes', () => {
    expect(Object.keys(REPORT_RUN_NOTE_WORDS)).toEqual([...REPORT_RUN_NOTES]);
  });

  it('says an inquiry decided before the report finished was not changed (C84.3)', () => {
    expect(REPORT_RUN_NOTE_WORDS.inquiry_already_decided).toBe(
      'The inquiry was decided before this report finished, so the report did not change it.',
    );
  });

  it('says monitoring did not start under the recurring cap (C72.5)', () => {
    expect(REPORT_RUN_NOTE_WORDS.recurring_limit).toMatch(/^Monitoring did not start/);
  });

  it('says an open match this run did not find stays open (C75.8)', () => {
    expect(REPORT_RUN_NOTE_WORDS.match_not_found_in_run).toBe(
      'This run did not find an open match again; it stays open until a person dismisses it.',
    );
  });

  it('says a changed entry and changed risk data in words (C75.8, V06)', () => {
    expect(REPORT_RUN_NOTE_WORDS.evidence_changed).toMatch(/entry changed/);
    expect(REPORT_RUN_NOTE_WORDS.risk_data_changed).toMatch(/risk data changed/);
  });
});

describe('coverage limits in words (C78.5, C81.5)', () => {
  it.each(REPORT_COVERAGE_LIMITS)('says the limit %s in words', (limit) => {
    expect(REPORT_COVERAGE_LIMIT_WORDS[limit]).toMatch(WORDS);
  });

  it('words exactly the contract limits', () => {
    expect(Object.keys(REPORT_COVERAGE_LIMIT_WORDS)).toEqual([...REPORT_COVERAGE_LIMITS]);
  });

  it('says a lossy comparison makes a miss weaker evidence', () => {
    expect(REPORT_COVERAGE_LIMIT_WORDS.lossy_script).toMatch(/weaker evidence/);
  });
});

describe('what complete coverage does not promise (owner decision 6 after 6B)', () => {
  it('says it in the sentence the matcher proposed', () => {
    expect(COMPLETE_COVERAGE_WORDS).toBe(
      'Complete coverage does not promise romanisations outside the variant groups and ICAO’s tables, unknown spellings, or typos beyond the budget.',
    );
  });

  it('says it of the types that compare names: watchlist, business watchlist and PEP', () => {
    expect([...NAME_SCREENING_TYPES]).toEqual([
      'watchlist',
      'business-watchlist',
      'politically-exposed-person',
    ]);
  });

  it('says what the watchlist page says, and the business and PEP pages point to it', () => {
    const watchlist = reportDocsSection('watchlist.md', 'What a result means').toLowerCase();
    expect(watchlist).toContain('what complete coverage does not promise');
    expect(watchlist).toContain("in a romanisation outside the variant groups and icao's tables");
    expect(watchlist).toContain('in a spelling the matcher has never seen');
    expect(watchlist).toContain("with more typos than the preset's budget");
    for (const [page, section] of [
      ['business-watchlist.md', 'How it screens'],
      ['politically-exposed-person.md', 'Query and configuration'],
    ] as const) {
      expect(reportDocsSection(page, section).toLowerCase(), page).toContain(
        'what it does not promise',
      );
    }
  });
});

describe('unavailable fields in words (C69.4)', () => {
  it.each(REPORT_UNAVAILABLE_REASONS)('says the reason %s in words', (reason) => {
    expect(REPORT_UNAVAILABLE_REASON_WORDS[reason]).toMatch(WORDS);
  });

  it('words exactly the contract reasons', () => {
    expect(Object.keys(REPORT_UNAVAILABLE_REASON_WORDS)).toEqual([...REPORT_UNAVAILABLE_REASONS]);
  });

  it('says a list that is not built was not searched, never that nothing was found (H15)', () => {
    expect(REPORT_UNAVAILABLE_REASON_WORDS.list_not_configured).toBe(
      'This list is not built, so it was not searched.',
    );
  });
});

describe('notices in words (C79.2, C80.5, C81.5)', () => {
  it.each(REPORT_NOTICES)('says the notice %s in words', (notice) => {
    expect(REPORT_NOTICE_WORDS[notice]).toMatch(WORDS);
  });

  it('words exactly the contract notices', () => {
    expect(Object.keys(REPORT_NOTICE_WORDS)).toEqual([...REPORT_NOTICES]);
  });

  it('says a PEP miss is not evidence of non-PEP status', () => {
    expect(REPORT_NOTICE_WORDS.pep_coverage_uneven).toMatch(
      /a miss is not evidence that the person is not politically exposed/,
    );
  });
});

describe('history, monitoring and provenance labels (C70.2, C73.2, C74, C84.2)', () => {
  it.each(REPORT_RUN_TYPES)('labels the run type %s', (type) => {
    expect(REPORT_RUN_TYPE_LABELS[type]).toMatch(WORDS);
  });

  it.each(REPORT_RUN_STATUSES)('labels the run status %s', (status) => {
    expect(REPORT_RUN_STATUS_LABELS[status]).toMatch(WORDS);
  });

  it('reads an errored run as not screened, never as no match (C86)', () => {
    expect(REPORT_RUN_STATUS_LABELS.errored).toBe('Errored (not screened)');
  });

  it.each(REPORT_ACTION_TYPES)('labels the action %s', (action) => {
    expect(REPORT_ACTION_TYPE_LABELS[action]).toMatch(WORDS);
  });

  it.each(REPORT_ORIGINS)('labels the origin %s', (origin) => {
    expect(REPORT_ORIGIN_LABELS[origin]).toMatch(WORDS);
  });

  it.each(REPORT_PAUSED_REASONS)('labels the paused reason %s', (reason) => {
    expect(REPORT_PAUSED_REASON_LABELS[reason]).toMatch(WORDS);
  });

  it.each(REPORT_QUERY_SOURCES)('labels the query source %s', (source) => {
    expect(REPORT_QUERY_SOURCE_LABELS[source]).toMatch(WORDS);
  });

  it('labels exactly the contract values, each list in its order', () => {
    expect(Object.keys(REPORT_RUN_TYPE_LABELS)).toEqual([...REPORT_RUN_TYPES]);
    expect(Object.keys(REPORT_RUN_STATUS_LABELS)).toEqual([...REPORT_RUN_STATUSES]);
    expect(Object.keys(REPORT_ACTION_TYPE_LABELS)).toEqual([...REPORT_ACTION_TYPES]);
    // C166.5 (Workflow 9B): the resource's origins, `bulk` included.
    expect(Object.keys(REPORT_ORIGIN_LABELS)).toEqual([...REPORT_RESOURCE_ORIGINS]);
    expect(Object.keys(REPORT_PAUSED_REASON_LABELS)).toEqual([...REPORT_PAUSED_REASONS]);
    expect(Object.keys(REPORT_QUERY_SOURCE_LABELS)).toEqual([...REPORT_QUERY_SOURCES]);
  });
});
