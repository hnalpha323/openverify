/**
 * C81.3, C81.5: adverse-media relevance from article metadata. People, companies and titles are
 * synthetic; "Sandbox Sanctioned Holdings Ltd" is C82.4's sandbox company.
 */
import { ADVERSE_MEDIA_CATEGORIES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  businessMediaName,
  mediaCoverage,
  mediaPersonNames,
  screenMediaArticle,
  storedMediaTitle,
  type MediaArticle,
  type MediaScreeningConfig,
  type MediaSubject,
} from './relevance.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const DAY = 86_400_000;
const CONFIG: MediaScreeningConfig = {
  categories: [...ADVERSE_MEDIA_CATEGORIES],
  maxArticleAgeDays: 90,
  allowedCountries: null,
};
const PERSON: MediaSubject = { kind: 'person', names: ['Avery Quill'] };
const article = (title: string, overrides: Partial<MediaArticle> = {}): MediaArticle => ({
  title,
  seenAt: new Date(NOW.getTime() - 7 * DAY),
  language: 'en',
  sourceCountry: 'GB',
  ...overrides,
});
const screen = (
  title: string,
  overrides: Partial<MediaArticle> = {},
  subject: MediaSubject = PERSON,
  config: Partial<MediaScreeningConfig> = {},
) => screenMediaArticle(subject, article(title, overrides), { ...CONFIG, ...config }, NOW);

describe('screenMediaArticle: a person', () => {
  it('matches the whole name with a category term, scoring 0.5 name, 0.3 category, 0.2 recency', () => {
    // 0.5 × 1 + 0.3 × 1 + 0.2 × (1 − 0.5 × 7 / 90) = 0.9922; the confidence is 0.6 of it.
    expect(screen('Avery Quill named in synthetic fraud case')).toEqual({
      relevant: true,
      categories: ['fraud'],
      matchTypes: ['title_full_name'],
      score: 0.99,
      confidence: 0.6,
    });
  });

  it('matches every token in another order as title_all_tokens, at 0.8 of the name', () => {
    // 0.5 × 0.8 + 0.3 + 0.2 × 0.9611 = 0.8922.
    expect(screen('Quill, Avery faces fraud charges')).toEqual({
      relevant: true,
      categories: ['fraud'],
      matchTypes: ['title_all_tokens'],
      score: 0.89,
      confidence: 0.54,
    });
  });

  it('weighs a category by its weight, taking the highest', () => {
    const bankrupt = screen('Avery Quill files for bankruptcy');
    expect(bankrupt).toEqual(expect.objectContaining({ categories: ['financial_difficulty'] }));
    expect(bankrupt.relevant && bankrupt.score).toBe(0.84);
    const both = screen('Avery Quill bankruptcy hides fraud', {}, PERSON);
    expect(both).toEqual(
      expect.objectContaining({ categories: ['fraud', 'financial_difficulty'], score: 0.99 }),
    );
  });

  it('screens every name of the subject, and folds both renderings', () => {
    const subject: MediaSubject = { kind: 'person', names: ['Avery Quill', 'Jo Müller'] };
    expect(screen('Jo Mueller fined by the regulator', {}, subject)).toEqual(
      expect.objectContaining({ relevant: true, categories: ['regulatory'] }),
    );
    expect(
      screen(
        'Avery Sandbox-Media named in synthetic fraud case',
        {},
        {
          kind: 'person',
          names: ['Avery Sandbox-Media'],
        },
      ),
    ).toEqual(expect.objectContaining({ relevant: true, matchTypes: ['title_full_name'] }));
  });

  it('drops an article whose title lacks the name, or any category term', () => {
    expect(screen('Avery Plume charged in fraud case')).toEqual({
      relevant: false,
      reason: 'name_not_in_title',
    });
    expect(screen('Avery Quill wins the regatta')).toEqual({
      relevant: false,
      reason: 'no_category_term',
    });
  });

  it('drops an article older than max-article-age-days, measured on seen-date', () => {
    const old = { seenAt: new Date(NOW.getTime() - 120 * DAY) };
    expect(screen('Avery Quill charged in fraud case', old)).toEqual({
      relevant: false,
      reason: 'too_old',
    });
    expect(
      screen('Avery Quill charged in fraud case', { seenAt: new Date(NOW.getTime() + DAY) }),
    ).toEqual(expect.objectContaining({ relevant: true, score: 1 }));
  });

  it('keeps an article from an allowed country, or of an unknown one', () => {
    const allowed = { allowedCountries: ['GB'] };
    expect(
      screen('Avery Quill charged in fraud case', { sourceCountry: 'US' }, PERSON, allowed),
    ).toEqual({
      relevant: false,
      reason: 'country_not_allowed',
    });
    expect(
      screen('Avery Quill charged in fraud case', { sourceCountry: null }, PERSON, allowed)
        .relevant,
    ).toBe(true);
  });

  it('drops a title in a language the lexicon does not cover', () => {
    expect(screen('Avery Quill charged in fraud case', { language: 'it' })).toEqual({
      relevant: false,
      reason: 'language_not_covered',
    });
  });

  it('keeps only the template’s categories', () => {
    expect(
      screen('Avery Quill charged in fraud case', {}, PERSON, { categories: ['terrorism'] }),
    ).toEqual({ relevant: false, reason: 'no_category_term' });
  });
});

describe('screenMediaArticle: a business (H13)', () => {
  const sandbox: MediaSubject = {
    kind: 'business',
    term: 'Sandbox Sanctioned Holdings Ltd',
    countryCode: 'GB',
  };
  const acme: MediaSubject = { kind: 'business', term: 'Acme Ltd', countryCode: 'GB' };

  it('matches the phrase without its legal form when it has two distinctive words', () => {
    expect(
      screen('Sandbox Sanctioned Holdings fined by regulator', { sourceCountry: 'US' }, sandbox),
    ).toEqual(expect.objectContaining({ relevant: true, matchTypes: ['title_full_name'] }));
    expect(
      screen('Sandbox Sanctioned Holdings Ltd charged with fraud', { sourceCountry: null }, sandbox)
        .relevant,
    ).toBe(true);
  });

  it('needs the query’s country for a name of one distinctive word: the source or its name', () => {
    expect(screen('Acme fined over fraud', { sourceCountry: 'GB' }, acme).relevant).toBe(true);
    expect(
      screen('Acme fined over fraud in the United Kingdom', { sourceCountry: 'US' }, acme).relevant,
    ).toBe(true);
    expect(
      screen(
        'Acme multada por fraude en Reino Unido',
        { sourceCountry: 'MX', language: 'es' },
        acme,
      ).relevant,
    ).toBe(true);
    expect(screen('Acme fined over fraud', { sourceCountry: 'US' }, acme)).toEqual({
      relevant: false,
      reason: 'business_unconfirmed',
    });
    expect(
      screen(
        'Acme fined over fraud',
        { sourceCountry: 'GB' },
        { kind: 'business', term: 'Acme Ltd' },
      ),
    ).toEqual({ relevant: false, reason: 'business_unconfirmed' });
  });

  it('needs the phrase’s words together and in order', () => {
    expect(screen('Sandbox and Sanctioned Holdings in fraud probe', {}, sandbox)).toEqual({
      relevant: false,
      reason: 'name_not_in_title',
    });
  });
});

describe('businessMediaName', () => {
  it('strips a leading the and the legal forms, and tells distinctive words from generic ones', () => {
    expect(businessMediaName('Sandbox Sanctioned Holdings Ltd')).toEqual({
      tokens: ['sandbox', 'sanctioned', 'holdings'],
      distinctive: ['sandbox', 'sanctioned'],
      status: 'ok',
    });
    expect(businessMediaName('The Acme Widgets Ltd.')).toEqual({
      tokens: ['acme', 'widgets'],
      distinctive: ['acme', 'widgets'],
      status: 'ok',
    });
    expect(businessMediaName('Smith & Jones LLC')).toEqual({
      tokens: ['smith', 'and', 'jones'],
      distinctive: ['smith', 'jones'],
      status: 'ok',
    });
  });

  it('keeps bank and group, which name the business in the news, as generic words', () => {
    expect(businessMediaName('Placeholder Bank AG')).toEqual({
      tokens: ['placeholder', 'bank'],
      distinctive: ['placeholder'],
      status: 'ok',
    });
  });

  it('refuses a name that is one generic word once stripped, or nothing at all', () => {
    expect(businessMediaName('Global Ltd').status).toBe('generic');
    expect(businessMediaName('Holdings').status).toBe('generic');
    expect(businessMediaName('Ltd').status).toBe('empty');
    expect(businessMediaName('&&').status).toBe('empty');
    expect(businessMediaName('Global Trading Ltd').status).toBe('ok');
  });
});

describe('the name readers’ edges', () => {
  it('skips an empty name, glues a legal form written as initials, trims connectors', () => {
    expect(
      screen(
        'Avery Quill charged in fraud case',
        {},
        { kind: 'person', names: ['', 'Avery Quill'] },
      ).relevant,
    ).toBe(true);
    expect(businessMediaName('Acme Widgets G.m.b.H.').tokens).toEqual(['acme', 'widgets']);
    expect(businessMediaName('Acme Widgets and').tokens).toEqual(['acme', 'widgets']);
  });

  it('finds no country name for a code Intl cannot read', () => {
    expect(
      screen(
        'Acme fined over fraud',
        { sourceCountry: 'US' },
        {
          kind: 'business',
          term: 'Acme Ltd',
          countryCode: 'X1',
        },
      ),
    ).toEqual({ relevant: false, reason: 'business_unconfirmed' });
  });
});

describe('mediaPersonNames', () => {
  it('joins the name parts, or takes the term, and appends the additional names once each', () => {
    expect(mediaPersonNames({ 'name-first': 'Avery', 'name-last': 'Quill' })).toEqual([
      'Avery Quill',
    ]);
    expect(
      mediaPersonNames({ 'name-first': ' Avery ', 'name-middle': 'J', 'name-last': 'Quill' }),
    ).toEqual(['Avery J Quill']);
    expect(
      mediaPersonNames({
        term: 'Avery Quill',
        'additional-names': [
          { 'name-first': 'Avery', 'name-last': 'Plume' },
          { term: 'Avery Quill' },
          { term: '   ' },
        ],
      }),
    ).toEqual(['Avery Quill', 'Avery Plume']);
  });
});

describe('storedMediaTitle', () => {
  it('trims and caps a title at 200 characters (decision 8)', () => {
    expect(storedMediaTitle('  Avery Quill charged  ')).toBe('Avery Quill charged');
    expect(storedMediaTitle('x'.repeat(500))).toHaveLength(200);
  });
});

describe('mediaCoverage', () => {
  it('is never complete: titles only, 90 days, four languages, and truncated when cut short', () => {
    expect(mediaCoverage({ truncated: false })).toEqual({
      complete: false,
      limits: ['title_only', 'window_90_days', 'lexicon_languages'],
    });
    expect(mediaCoverage({ truncated: true })).toEqual({
      complete: false,
      limits: ['truncated', 'title_only', 'window_90_days', 'lexicon_languages'],
    });
  });
});
