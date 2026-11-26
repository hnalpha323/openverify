/**
 * C81.3, C81.5: the authored adverse-media lexicon. Titles here are synthetic and name fictional
 * people only.
 */
import { ADVERSE_MEDIA_CATEGORIES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  ADVERSE_MEDIA_LEXICON,
  MEDIA_CATEGORY_WEIGHTS,
  MEDIA_LEXICON_LANGUAGES,
  MEDIA_QUERY_TERMS,
  mediaCategoriesOfTitle,
  mediaQueryTerms,
} from './lexicon.js';

const ALL = [...ADVERSE_MEDIA_CATEGORIES];

describe('ADVERSE_MEDIA_LEXICON', () => {
  it('covers every category of core in English, Spanish, French and German', () => {
    expect(Object.keys(ADVERSE_MEDIA_LEXICON).sort()).toEqual([...ADVERSE_MEDIA_CATEGORIES].sort());
    for (const category of ADVERSE_MEDIA_CATEGORIES) {
      expect(Object.keys(ADVERSE_MEDIA_LEXICON[category]).sort(), category).toEqual(
        [...MEDIA_LEXICON_LANGUAGES].sort(),
      );
      for (const language of MEDIA_LEXICON_LANGUAGES) {
        const terms = ADVERSE_MEDIA_LEXICON[category][language];
        expect(terms.length, `${category} ${language}`).toBeGreaterThanOrEqual(3);
        expect(new Set(terms).size, `${category} ${language}`).toBe(terms.length);
      }
    }
  });

  it('writes terms as words only, a trailing * on single words alone', () => {
    for (const category of ADVERSE_MEDIA_CATEGORIES) {
      for (const language of MEDIA_LEXICON_LANGUAGES) {
        for (const term of ADVERSE_MEDIA_LEXICON[category][language]) {
          // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
          expect(term, `${category} ${language}`).toMatch(/^\p{L}+(?:[ '’-]\p{L}+)*\*?$/u);
          if (term.endsWith('*')) {
            expect(term, `${category} ${language}`).not.toMatch(/[ '’-]/u);
          }
        }
      }
    }
  });
});

describe('MEDIA_QUERY_TERMS and mediaQueryTerms', () => {
  it('gives each category one to three English words safe inside a GDELT OR group', () => {
    for (const category of ADVERSE_MEDIA_CATEGORIES) {
      const terms = MEDIA_QUERY_TERMS[category];
      expect(terms.length, category).toBeGreaterThanOrEqual(1);
      expect(terms.length, category).toBeLessThanOrEqual(3);
      for (const term of terms) {
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        expect(term, category).toMatch(/^[a-z]{4,}(?: [a-z]{4,})*$/u);
      }
    }
  });

  it('lists the chosen categories’ terms in category order, each once', () => {
    expect(mediaQueryTerms(['fraud', 'corruption'])).toEqual([
      ...MEDIA_QUERY_TERMS.fraud,
      ...MEDIA_QUERY_TERMS.corruption,
    ]);
    const every = mediaQueryTerms(ALL);
    expect(new Set(every).size).toBe(every.length);
    expect(mediaQueryTerms([])).toEqual([]);
  });
});

describe('MEDIA_CATEGORY_WEIGHTS', () => {
  it('weighs every category, provisionally, with a source', () => {
    for (const category of ADVERSE_MEDIA_CATEGORIES) {
      const weight = MEDIA_CATEGORY_WEIGHTS[category];
      expect(weight.value, category).toBeGreaterThan(0);
      expect(weight.value, category).toBeLessThanOrEqual(1);
      expect(weight.basis, category).toBe('provisional');
      expect(weight.source.length, category).toBeGreaterThan(10);
    }
  });

  it('weighs the AML predicate offences fully, and financial difficulty least', () => {
    for (const category of ['fraud', 'corruption', 'money_laundering', 'terrorism'] as const) {
      expect(MEDIA_CATEGORY_WEIGHTS[category].value, category).toBe(1);
    }
    const lowest = Math.min(...ALL.map((category) => MEDIA_CATEGORY_WEIGHTS[category].value));
    expect(MEDIA_CATEGORY_WEIGHTS.financial_difficulty.value).toBe(lowest);
  });
});

describe('mediaCategoriesOfTitle', () => {
  it.each([
    ['Avery Quill charged in fraud case', 'en', ['fraud']],
    ['AVERY QUILL ACCUSED OF BRIBERY', 'en', ['corruption']],
    ['Avery Quill acusado de blanqueo de capitales', 'es', ['money_laundering']],
    ['Corrupcion: Avery Quill detenido', 'es', ['corruption']],
    ['Enquête pour blanchiment d’argent visant Avery Quill', 'fr', ['money_laundering']],
    ['Geldwäscheverdacht gegen Avery Quill', 'de', ['money_laundering']],
    ['Betrugsprozess gegen Avery Quill', 'de', ['fraud']],
    ['Avery Quill files for bankruptcy', 'en', ['financial_difficulty']],
  ] as const)('reads %j (%s) as %j', (title, language, categories) => {
    expect(mediaCategoriesOfTitle(title, language, ALL)).toEqual(categories);
  });

  it('matches a German compound by its stem, and never a word that merely begins alike', () => {
    expect(mediaCategoriesOfTitle('Die Kosten betrugen fünf Millionen', 'de', ALL)).toEqual([]);
  });

  it('reads a title in its own language’s terms only', () => {
    expect(mediaCategoriesOfTitle('Avery Quill, heroine of the flood rescue', 'en', ALL)).toEqual(
      [],
    );
    expect(mediaCategoriesOfTitle('Avery Quill charged in fraud case', 'it', ALL)).toEqual([]);
    expect(mediaCategoriesOfTitle('Avery Quill charged in fraud case', null, ALL)).toEqual([
      'fraud',
    ]);
  });

  it('needs a phrase’s words together, in order', () => {
    expect(mediaCategoriesOfTitle('Insider says trading halted at Quill Ltd', 'en', ALL)).toEqual(
      [],
    );
    expect(mediaCategoriesOfTitle('Quill Ltd faces insider trading probe', 'en', ALL)).toEqual([
      'financial_crime',
    ]);
  });

  it('keeps only the template’s categories, in their order', () => {
    const title = 'Avery Quill charged with fraud and bribery';
    expect(mediaCategoriesOfTitle(title, 'en', ['corruption', 'fraud'])).toEqual([
      'corruption',
      'fraud',
    ]);
    expect(mediaCategoriesOfTitle(title, 'en', ['terrorism'])).toEqual([]);
  });

  it('reads at most the first 1,000 characters of a title', () => {
    const title = `${'Avery Quill '.repeat(100)}fraud`;
    expect(mediaCategoriesOfTitle(title, 'en', ALL)).toEqual([]);
  });
});
