/**
 * C60.5: the document's language (the covered language with the most distinct lexicon entries)
 * and writing system, recorded on the type result.
 */
import { DOCUMENT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { MIN_DOCUMENT_LANGUAGE_HITS, detectDocumentLanguage } from './language.js';
import { DOCUMENT_LANGUAGES } from './lexicons/index.js';
import { documentLines } from './lines.js';
import {
  CLASS_SAMPLES,
  OTHER_SCRIPT_SAMPLE,
  PASSPORT_SAMPLE,
  UNCOVERED_LANGUAGE_SAMPLE,
} from './samples.js';
import { photoAnalysis, photoPage, type LineSpec } from './testing.js';

const read = (specs: readonly LineSpec[]) =>
  detectDocumentLanguage(documentLines(photoAnalysis(photoPage(specs))));

describe('detectDocumentLanguage', () => {
  it('needs at least two distinct entries of one language', () => {
    expect(MIN_DOCUMENT_LANGUAGE_HITS).toBe(2);
  });

  describe.each(DOCUMENT_LANGUAGES)('%s samples', (language) => {
    it.each(DOCUMENT_TYPES)('reads the %s sample as its language, in Latin script', (cls) => {
      const reading = read(CLASS_SAMPLES[language][cls]);
      expect(reading.language).toBe(language);
      expect(reading.script).toBe('latin');
    });
  });

  it('reads no covered language in a Dutch bill', () => {
    const reading = read(UNCOVERED_LANGUAGE_SAMPLE);
    expect(reading.language).toBeNull();
    expect(reading.script).toBe('latin');
  });

  it('reads the Cyrillic script of a Russian bill', () => {
    expect(read(OTHER_SCRIPT_SAMPLE).script).toBe('cyrillic');
  });

  it('gives a tie to the first covered language, so a bilingual page stays covered', () => {
    expect(read(['Passport / Passeport', 'Nationality / Nationalité']).language).toBe('en');
    expect(read(PASSPORT_SAMPLE).language).not.toBeNull();
  });

  it('counts distinct entries, not repeats', () => {
    const once = read(['the account', 'the']);
    const repeated = read(['the the the the', 'the']);
    expect(once.hits.en).toBe(1);
    expect(repeated.hits.en).toBe(1);
    expect(repeated.language).toBeNull();
  });

  it('never reads a language from the language-neutral cues', () => {
    const reading = read(['kWh 1204', 'm³ 18', 'IBAN', 'BIC']);
    expect(reading.language).toBeNull();
    expect(Object.values(reading.hits).every((hits) => hits === 0)).toBe(true);
  });

  it('reads no script without a letter', () => {
    expect(read(['48.20', '2026']).script).toBeNull();
    expect(detectDocumentLanguage([]).language).toBeNull();
  });
});
