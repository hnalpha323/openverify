// @vitest-environment node
import {
  CHECK_STAGES,
  REPORT_REGISTRY,
  REPORT_STATUSES,
  REPORT_TIERS,
  REPORT_TYPES,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { reportDocsSection } from '../testing/report-docs';
import {
  REPORT_RESULT_MEANS,
  REPORT_STAGE_LABELS,
  REPORT_STATUS_MEANS,
  REPORT_TIER_WORDS,
  reportDocsPage,
  resultMeansLines,
} from './report-type-words';

/** `docs/reports/README.md`: what a status says, and the rules every type shares. */
const OVERVIEW = reportDocsSection('README.md', 'What a report says, and what it does not');

/** Each sentence of `line` without its full stop, lower-cased. */
const sentences = (line: string) =>
  line
    .split(/(?<=\.) /)
    .map((sentence) => sentence.replace(/\.$/, '').toLowerCase())
    .filter((sentence) => sentence !== '');

describe('tiers and stages in words (ADR 0002, C69.1)', () => {
  it.each(REPORT_TIERS)('says the tier %s in words', (tier) => {
    expect(REPORT_TIER_WORDS[tier]).toMatch(/^[A-Z]/);
  });

  it.each(CHECK_STAGES)('labels the stage %s', (stage) => {
    expect(REPORT_STAGE_LABELS[stage]).toMatch(/^[A-Z]/);
  });

  it('says a heuristic carries a confidence, and labels beta as Beta', () => {
    expect(REPORT_TIER_WORDS.H).toMatch(/confidence/);
    expect(REPORT_STAGE_LABELS.beta).toBe('Beta');
  });
});

describe('what a status means (docs/reports/README.md, C69.2, C69.4)', () => {
  it.each(REPORT_STATUSES)('says what %s means, as the overview says it', (status) => {
    const line = REPORT_STATUS_MEANS[status];
    expect(line).not.toBe('');
    for (const sentence of sentences(line)) {
      expect(OVERVIEW.toLowerCase(), sentence).toContain(sentence);
    }
  });

  it('never says an errored report found nothing (C69.4)', () => {
    expect(REPORT_STATUS_MEANS.errored).toBe('Its latest run could not screen something.');
  });
});

describe('what a result means (docs/reports/<type>.md, C86)', () => {
  it.each(REPORT_TYPES)('says what a %s result means in each state, as its page says', (type) => {
    const page = reportDocsSection(reportDocsPage(type), 'What a result means').toLowerCase();
    const means = REPORT_RESULT_MEANS[type];
    const lines =
      REPORT_REGISTRY[type].review === 'matches' ? [means.match, means.noMatch] : [means.ready];
    expect(lines.every((line) => line !== undefined && line !== '')).toBe(true);
    for (const line of [...lines, means.always].filter((each) => each !== undefined)) {
      for (const sentence of sentences(line)) {
        const said = page.includes(sentence) || OVERVIEW.toLowerCase().includes(sentence);
        expect(said, `${type}: ${sentence}`).toBe(true);
      }
    }
  });

  it('says a watchlist hit is a lead, never a decision', () => {
    expect(REPORT_RESULT_MEANS.watchlist.always).toBe(
      'A match is a lead for a reviewer, never a decision: a common name can match many people, and a different person can share a listed name.',
    );
  });

  it('says a PEP miss is not evidence of non-PEP status, and a media miss not of no coverage', () => {
    expect(REPORT_RESULT_MEANS['politically-exposed-person'].noMatch).toMatch(
      /A miss is not evidence that the person is not politically exposed\.$/,
    );
    expect(REPORT_RESULT_MEANS['adverse-media'].noMatch).toMatch(
      /This says no title mention, not no coverage anywhere\.$/,
    );
  });
});

describe('resultMeansLines', () => {
  it('reads a match: the status, the match line, then what every result says', () => {
    expect(resultMeansLines('watchlist', 'ready', true)).toEqual([
      REPORT_STATUS_MEANS.ready,
      REPORT_RESULT_MEANS.watchlist.match,
      REPORT_RESULT_MEANS.watchlist.always,
    ]);
  });

  it('says "no match" only beside ready, never for an errored report (C69.4)', () => {
    expect(resultMeansLines('watchlist', 'ready', false)).toContain(
      REPORT_RESULT_MEANS.watchlist.noMatch,
    );
    expect(resultMeansLines('watchlist', 'errored', false)).toEqual([
      REPORT_STATUS_MEANS.errored,
      REPORT_RESULT_MEANS.watchlist.always,
    ]);
    expect(resultMeansLines('watchlist', 'pending', false)).not.toContain(
      REPORT_RESULT_MEANS.watchlist.noMatch,
    );
  });

  it('reads a type without review by its ready line', () => {
    expect(resultMeansLines('email-address', 'ready', false)).toEqual([
      REPORT_STATUS_MEANS.ready,
      REPORT_RESULT_MEANS['email-address'].ready,
    ]);
  });
});
