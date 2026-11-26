// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DOCUMENT_CLASSIFICATIONS, documentFieldsSchema } from '@openverify/contracts';
import { MATCH_LEVELS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import {
  CUE_STRENGTHS,
  CUE_STRENGTH_LABELS,
  DATE_FLAG_TEXT,
  DOCUMENT_CLASS_LABELS,
  DOCUMENT_FIELD_LABELS,
  DOCUMENT_PASS_MEANS,
  FABRICATION_CUE_IDS,
  FABRICATION_CUE_TEXT,
  ISSUE_DATE_SOURCE_LABELS,
  LAYOUT_FEATURE_LABELS,
  MATCH_LEVEL_LABELS,
  REFERENCE_SOURCE_LABELS,
  UNKNOWN_REASON_TEXT,
  languageName,
  wordsFor,
} from './document-words';

/**
 * The document evaluators' own source (`packages/checks`, which the console does not depend
 * on): the cues, features, reasons, date sources, flags and reference sources the results carry
 * are read from it, so a value added there without words here fails this test.
 */
const checksSource = (file: string) =>
  readFileSync(
    new URL(`../../../../packages/checks/src/document/${file}`, import.meta.url),
    'utf8',
  );

/** The string literals of the array assigned to `name` (`const NAME = [...]`). */
function arrayOf(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);
}

/** The members of a union of string literals (`type Name = 'a' | 'b';`). */
function unionOf(source: string, name: string): string[] {
  const match = new RegExp(`type ${name} =([^;]*);`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);
}

/** The kebab-case flags a source writes: `flags: ['…']` and `missing('…', …)` calls. */
function flagsOf(source: string): string[] {
  return (
    source
      .split('\n')
      .filter((line) => /flags: \[|\bmissing\(/.test(line))
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      .flatMap((line) => [...line.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)].map((m) => m[1] ?? ''))
  );
}

/** Short words: a capital first, no code, at most 80 characters. */
const WORDS = /^[A-Z][^_]{1,79}$/;

describe('the document words (C60, C66)', () => {
  it.each(DOCUMENT_CLASSIFICATIONS)('names the class %s', (classification) => {
    expect(DOCUMENT_CLASS_LABELS[classification]).toMatch(WORDS);
  });

  it('names the classes apart, and an unknown one as not recognised', () => {
    const labels = DOCUMENT_CLASSIFICATIONS.map((value) => DOCUMENT_CLASS_LABELS[value]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(DOCUMENT_CLASS_LABELS.unknown).toBe('Not recognised');
    expect(DOCUMENT_CLASS_LABELS.utility_bill).toBe('Utility bill');
  });

  it('names every extracted field, in the API order', () => {
    const fields = Object.keys(documentFieldsSchema.shape);
    expect(Object.keys(DOCUMENT_FIELD_LABELS)).toEqual(fields);
    for (const field of fields) {
      expect(wordsFor(DOCUMENT_FIELD_LABELS, field), field).toMatch(WORDS);
    }
  });

  it('knows the fabrication cues the evaluator scores, in its order', () => {
    expect([...FABRICATION_CUE_IDS]).toEqual(
      arrayOf(checksSource('fabrication.ts'), 'FABRICATION_SIGNAL_IDS'),
    );
  });

  it.each(FABRICATION_CUE_IDS)('says the cue %s in words, with what it looks for', (cue) => {
    expect(FABRICATION_CUE_TEXT[cue].words, cue).toMatch(WORDS);
    expect(FABRICATION_CUE_TEXT[cue].explanation, cue).toMatch(/^[A-Z].*\.$/);
  });

  it('says each cue strength in words', () => {
    expect(CUE_STRENGTHS.map((strength) => CUE_STRENGTH_LABELS[strength])).toEqual([
      'Weak',
      'Medium',
      'Strong',
    ]);
  });

  it.each(arrayOf(checksSource('layout.ts'), 'DOCUMENT_LAYOUT_FEATURE_IDS'))(
    'says the layout feature %s in words',
    (feature) => {
      expect(wordsFor(LAYOUT_FEATURE_LABELS, feature), feature).toMatch(WORDS);
    },
  );

  it.each(unionOf(checksSource('classify.ts'), 'DocumentUnknownReason'))(
    'says why a class was not established: %s',
    (reason) => {
      expect(wordsFor(UNKNOWN_REASON_TEXT, reason), reason).toMatch(WORDS);
    },
  );

  it.each(unionOf(checksSource('extract.ts'), 'DocumentIssueDateSource'))(
    'says where the issue date was read: %s',
    (source) => {
      expect(wordsFor(ISSUE_DATE_SOURCE_LABELS, source), source).toMatch(WORDS);
    },
  );

  it.each([
    ...new Set([
      ...flagsOf(checksSource('document-recency-detection.ts')),
      ...flagsOf(checksSource('document-expired-detection.ts')),
    ]),
  ])('says the date flag %s in words', (flag) => {
    expect(wordsFor(DATE_FLAG_TEXT, flag), flag).toMatch(WORDS);
  });

  it('reads the nine date flags the recency and expiry checks write', () => {
    expect(
      new Set([
        ...flagsOf(checksSource('document-recency-detection.ts')),
        ...flagsOf(checksSource('document-expired-detection.ts')),
      ]).size,
    ).toBe(9);
  });

  it.each(unionOf(checksSource('context.ts'), 'DocumentReferenceSource'))(
    'names the reference %s the comparisons read',
    (source) => {
      expect(wordsFor(REFERENCE_SOURCE_LABELS, source), source).toMatch(WORDS);
    },
  );

  it.each(MATCH_LEVELS)('says the match level %s in words', (level) => {
    expect(wordsFor(MATCH_LEVEL_LABELS, level), level).toMatch(WORDS);
  });

  it('names a covered language in English, and keeps a code it cannot name', () => {
    expect(['en', 'es', 'fr', 'de'].map(languageName)).toEqual([
      'English',
      'Spanish',
      'French',
      'German',
    ]);
    expect(languageName('not a code')).toBe('not a code');
  });

  it('reads only own properties', () => {
    expect(wordsFor(DOCUMENT_FIELD_LABELS, 'constructor')).toBeUndefined();
    expect(wordsFor(DATE_FLAG_TEXT, 'toString')).toBeUndefined();
  });

  it('says what a pass means, and what it does not, as docs/checks/document.md does', () => {
    const section = passMeansSection('document.md').replaceAll('`', '').toLowerCase();
    const sentences = sentencesOf(DOCUMENT_PASS_MEANS);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const sentence of sentences) {
      expect(section, sentence).toContain(sentence.toLowerCase());
    }
    expect(DOCUMENT_PASS_MEANS).toMatch(/recent document of an accepted type/);
    expect(DOCUMENT_PASS_MEANS).toMatch(/not mean the document is genuine/);
  });
});
