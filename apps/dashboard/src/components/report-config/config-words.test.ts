// @vitest-environment node
/**
 * C71.2, C79-C82, C86: a report template's configuration in words. The keys come from core's
 * `REPORT_CONFIG_DEFAULTS` of every type first, so a key added there without words here fails
 * this test; the publish problems come from the contracts' problem codes.
 */
import {
  REPORT_PROBLEM_STATUSES,
  resolveReportTemplateConfig,
  type ReportProblemCode,
} from '@openverify/contracts';
import { REPORT_CONFIG_DEFAULTS, REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { WATCHLIST_CONFIG } from '../../testing/report-config-fixtures';
import {
  CONFIG_KEY_WORDS,
  PUBLISH_PROBLEM_CODES,
  configPointerLabel,
  configRecord,
  describeConfigValue,
  explicitConfig,
  publishProblemInWords,
  resolvedConfigRows,
} from './config-words';

const resolvedWatchlist = resolveReportTemplateConfig('watchlist', WATCHLIST_CONFIG);

describe('the configuration keys in words (C71.2)', () => {
  it('words every key of every type, with what it does', () => {
    const keys = new Set(REPORT_TYPES.flatMap((type) => Object.keys(REPORT_CONFIG_DEFAULTS[type])));
    expect(Object.keys(CONFIG_KEY_WORDS).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const words = CONFIG_KEY_WORDS[key as keyof typeof CONFIG_KEY_WORDS];
      expect(words.label.length).toBeGreaterThan(0);
      expect(words.meaning.length).toBeGreaterThan(0);
    }
    expect(CONFIG_KEY_WORDS['max-list-age-hours'].meaning).toContain('list_stale');
  });
});

describe('describeConfigValue', () => {
  it.each([
    ['recurrence-interval-days', null, 'Runs once'],
    ['recurrence-interval-days', 30, 'Every 30 days'],
    ['pause-on-match', false, 'No'],
    ['screen-weak-aliases', true, 'Yes'],
    ['search-lists', ['ofac-sdn', 'openverify-sandbox'], 'ofac-sdn, openverify-sandbox'],
    ['search-lists', [], 'None'],
    ['max-list-age-hours', 48, '48 hours'],
    ['resume-delay-minutes', 30, '30 minutes'],
    ['max-article-age-days', 90, '90 days'],
    ['name-matching', { preset: 'exact' }, 'Exact: a list name equal to a subject name, no score'],
    ['name-matching', { preset: 'strict' }, 'Strict, minimum score 0.85'],
    ['name-matching', { preset: 'tolerant' }, 'Tolerant, minimum score 0.8'],
    [
      'name-matching',
      { preset: 'custom', 'min-score': 0.9, 'allow-nicknames': true, 'typo-budget': 'low' },
      'Custom, minimum score 0.9; nicknames allowed; typo budget low',
    ],
    ['birthdate-matching', 'year_plus_minus_one', 'Year ± 1'],
    ['birthdate-filter', 'strict', 'Strict: a disagreeing candidate is dropped'],
    ['country-fields', ['birthplace', 'citizenship'], 'Birthplace, citizenship'],
    ['entity-kinds', ['entity', 'vessel'], 'Entity, vessel'],
    ['categories', ['financial_crime', 'money_laundering'], 'Financial crime, money laundering'],
    ['pep-classes', [1, 2], 'Classes 1, 2'],
    ['default-country', null, 'None'],
    ['allowed-countries', null, 'Any country'],
    ['allowed-countries', ['GB', 'FR'], 'GB, FR'],
  ] as const)('words %s %j as %s', (key, value, words) => {
    expect(describeConfigValue(key, value)).toBe(words);
  });

  it('shows a value it has no words for as its JSON', () => {
    expect(describeConfigValue('unknown-key', { a: 1 })).toBe('{"a":1}');
  });
});

describe('explicitConfig (what the editor starts from)', () => {
  it('leaves out the keys at their default and keeps the pinned lists and the rest', () => {
    expect(explicitConfig('watchlist', resolvedWatchlist)).toEqual({
      'recurrence-interval-days': 30,
      'search-lists': ['openverify-sandbox'],
    });
  });

  it('keeps a key that differs from its default, compared by value', () => {
    expect(
      explicitConfig('watchlist', {
        ...resolvedWatchlist,
        'name-matching': { preset: 'strict' },
        'country-fields': ['citizenship', 'nationality', 'residency', 'birthplace'],
      }),
    ).toEqual({
      'recurrence-interval-days': 30,
      'search-lists': ['openverify-sandbox'],
      'name-matching': { preset: 'strict' },
      'country-fields': ['citizenship', 'nationality', 'residency', 'birthplace'],
    });
  });

  it('is empty for a type without lists left at its defaults', () => {
    expect(explicitConfig('phone-number', resolveReportTemplateConfig('phone-number', {}))).toEqual(
      {},
    );
  });
});

describe('resolvedConfigRows (the resolved configuration beside the editor)', () => {
  it('lists every resolved key in words, with whether it is the default and the default’s basis', () => {
    const rows = resolvedConfigRows('watchlist', resolvedWatchlist);

    expect(rows.map((row) => row.key)).toEqual(Object.keys(REPORT_CONFIG_DEFAULTS.watchlist));
    const recurrence = rows.find((row) => row.key === 'recurrence-interval-days');
    expect(recurrence).toMatchObject({
      label: 'Recurrence',
      value: 'Every 30 days',
      isDefault: false,
      defaultValue: 'Runs once',
    });
    const lists = rows.find((row) => row.key === 'search-lists');
    expect(lists).toMatchObject({ value: 'openverify-sandbox', defaultValue: null });
    const age = rows.find((row) => row.key === 'max-list-age-hours');
    expect(age).toMatchObject({ value: '48 hours', isDefault: true, basis: 'provisional' });
    expect(age?.source).toContain('C71.2');
  });
});

describe('configPointerLabel (an API pointer inside the configuration, in words)', () => {
  it.each([
    ['/max-list-age-hours', 'Maximum list age'],
    ['/name-matching/min-score', 'Name matching: minimum score'],
    ['/name-matching/preset', 'Name matching: preset'],
    ['/search-lists/1', 'Lists searched, item 2 (openverify-sandbox)'],
    ['/search-lists/4', 'Lists searched, item 5'],
    ['/search-lists', 'Lists searched'],
    ['/categories/0', 'Categories, item 1'],
    ['/', 'The configuration'],
    ['/surprise', 'surprise'],
  ])('labels %s as %s', (pointer, label) => {
    expect(configPointerLabel(pointer, ['ofac-sdn', 'openverify-sandbox'])).toBe(label);
  });
});

describe('publishProblemInWords (C71.2, C72.4)', () => {
  const problem = (
    status: number,
    code: string | null,
    errors: { pointer: string; detail: string }[] = [],
  ) => ({
    status,
    code,
    title: 'Unprocessable Content',
    detail: 'Synthetic detail.',
    requestId: 'req-synthetic-0001',
    errors,
  });

  it('covers every publish code the API answers', () => {
    expect([...PUBLISH_PROBLEM_CODES].sort()).toEqual(
      (Object.keys(REPORT_PROBLEM_STATUSES) as ReportProblemCode[])
        .filter((code) => code.startsWith('watchlist_source'))
        .sort(),
    );
  });

  it('says an empty list would screen nothing, so it is never published', () => {
    const words = publishProblemInWords(
      problem(422, 'watchlist_sources_empty', [
        {
          pointer: '/data/attributes/config/search-lists',
          detail: 'must select at least one enabled source',
        },
      ]),
      [],
    );

    expect(words.title).toBe('The draft selects no list');
    expect(words.detail).toMatch(/screen nothing/);
    expect(words.detail).toMatch(/no match/);
    expect(words.errors).toEqual([
      {
        pointer: '/data/attributes/config/search-lists',
        detail: 'Lists searched: must select at least one enabled source',
      },
    ]);
    expect(words.requestId).toBe('req-synthetic-0001');
    expect(words.status).toBe(422);
  });

  it('names each source the manifest does not know, by its place and id', () => {
    const words = publishProblemInWords(
      problem(422, 'watchlist_source_unknown', [
        {
          pointer: '/data/attributes/config/search-lists/1',
          detail: 'is not a source of the manifest',
        },
      ]),
      ['ofac-sdn', 'synthetic-unknown'],
    );

    expect(words.title).toBe('The draft selects a source the manifest does not know');
    expect(words.errors).toEqual([
      {
        pointer: '/data/attributes/config/search-lists/1',
        detail: 'Lists searched, item 2 (synthetic-unknown): is not a source of the manifest',
      },
    ]);
  });

  it('says a sandbox-only list is never screened in production', () => {
    const words = publishProblemInWords(
      problem(422, 'watchlist_source_not_allowed', [
        { pointer: '/data/attributes/config/search-lists/0', detail: 'is a sandbox-only list' },
      ]),
      ['openverify-sandbox'],
    );

    expect(words.title).toBe('The draft selects a source it may not screen here');
    expect(words.detail).toMatch(/sandbox-only list is never screened in a production environment/);
    expect(words.errors?.[0]?.detail).toBe(
      'Lists searched, item 1 (openverify-sandbox): is a sandbox-only list',
    );
  });

  it('says a list age below a source’s refresh interval would turn its reports stale', () => {
    const words = publishProblemInWords(
      problem(422, null, [
        {
          pointer: '/data/attributes/config/max-list-age-hours',
          detail: 'must be at least the refresh interval of wikidata-pep (168 h)',
        },
      ]),
      ['wikidata-pep'],
    );

    expect(words.title).toBe(
      'The maximum list age is shorter than a selected source’s refresh interval',
    );
    expect(words.detail).toMatch(/list_stale/);
    expect(words.errors?.[0]?.detail).toBe(
      'Maximum list age: must be at least the refresh interval of wikidata-pep (168 h)',
    );
  });

  it('says a version that is no longer a draft cannot be published', () => {
    const words = publishProblemInWords(problem(409, null), []);

    expect(words.title).toBe('This version is no longer a draft');
    expect(words.detail).toMatch(/Reload the page/);
  });

  it('keeps any other problem as the API worded it', () => {
    const words = publishProblemInWords(problem(500, null), []);

    expect(words).toMatchObject({ title: 'Unprocessable Content', detail: 'Synthetic detail.' });
  });
});

describe('configRecord', () => {
  it('reads a served configuration as a record, and anything else as empty', () => {
    expect(configRecord({ 'search-lists': ['ofac-sdn'] })).toEqual({
      'search-lists': ['ofac-sdn'],
    });
    expect(configRecord(null)).toEqual({});
    expect(configRecord(['ofac-sdn'])).toEqual({});
  });
});
