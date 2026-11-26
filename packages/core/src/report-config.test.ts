import { describe, expect, it } from 'vitest';
import {
  ADVERSE_MEDIA_CATEGORIES,
  REPORT_CONFIG_BOUNDS,
  REPORT_CONFIG_DEFAULTS,
  reportConfigDefaultValues,
} from './report-config.js';
import { REPORT_REGISTRY, REPORT_TYPES, type ReportType } from './report-registry.js';

const SANCTIONS_TYPES: readonly ReportType[] = [
  'watchlist',
  'business-watchlist',
  'crypto-address-watchlist',
];

describe('REPORT_CONFIG_BOUNDS (C71.2, C81.5, C82.1)', () => {
  it('fixes the ranges of the numeric keys', () => {
    expect(REPORT_CONFIG_BOUNDS).toEqual({
      'recurrence-interval-days': { min: 1, max: 365 },
      'resume-delay-minutes': { min: 0, max: 1440 },
      'max-list-age-hours': { min: 1, max: 720 },
      'max-article-age-days': { min: 1, max: 90 },
      'min-domain-age-days': { min: 1, max: 3650 },
      'young-domain-days': { min: 1, max: 3650 },
    });
  });
});

describe('REPORT_CONFIG_DEFAULTS (C71.2, C79-C82)', () => {
  it('has a table per type, each default provisional with a source', () => {
    expect(Object.keys(REPORT_CONFIG_DEFAULTS)).toEqual([...REPORT_TYPES]);
    for (const type of REPORT_TYPES) {
      for (const [key, entry] of Object.entries(REPORT_CONFIG_DEFAULTS[type])) {
        expect(entry.basis, `${type} ${key}`).toBe('provisional');
        expect(entry.source.length, `${type} ${key}`).toBeGreaterThan(0);
      }
      expect(Object.isFrozen(REPORT_CONFIG_DEFAULTS[type])).toBe(true);
    }
  });

  it('gives every type a one-off schedule, and recurrable types the monitoring keys', () => {
    for (const type of REPORT_TYPES) {
      const values = reportConfigDefaultValues(type);
      expect(values['recurrence-interval-days'], type).toBeNull();
      if (REPORT_REGISTRY[type].recurrable) {
        expect(values['pause-on-match'], type).toBe(false);
        expect(values['resume-delay-minutes'], type).toBe(30);
      } else {
        expect(values, type).not.toHaveProperty('pause-on-match');
        expect(values, type).not.toHaveProperty('resume-delay-minutes');
      }
    }
  });

  it('resolves the source lists at creation, and lets sanctions lists age 48 h and PEP 192 h (H02, F02)', () => {
    for (const type of REPORT_TYPES) {
      const values = reportConfigDefaultValues(type);
      const listed = REPORT_REGISTRY[type].sourceKind !== null;
      expect(Object.hasOwn(values, 'search-lists'), type).toBe(listed);
      expect(Object.hasOwn(values, 'max-list-age-hours'), type).toBe(listed);
      if (listed) {
        expect(values['search-lists'], type).toBeNull();
      }
    }
    for (const type of SANCTIONS_TYPES) {
      expect(reportConfigDefaultValues(type)['max-list-age-hours']).toBe(48);
    }
    expect(reportConfigDefaultValues('politically-exposed-person')['max-list-age-hours']).toBe(192);
  });

  it('screens persons tolerantly and businesses and PEPs strictly, weak aliases off (C79, C80.5, H10, H11)', () => {
    expect(reportConfigDefaultValues('watchlist')).toMatchObject({
      'name-matching': { preset: 'tolerant' },
      'birthdate-matching': 'year_plus_minus_one',
      'birthdate-filter': 'penalty',
      'country-fields': ['birthplace', 'citizenship', 'nationality', 'residency'],
      'country-filter': 'penalty',
      'screen-weak-aliases': false,
    });
    expect(reportConfigDefaultValues('business-watchlist')).toMatchObject({
      'name-matching': { preset: 'strict' },
      'country-fields': ['registration', 'address'],
      'country-filter': 'penalty',
      'screen-weak-aliases': false,
      'entity-kinds': ['entity'],
    });
    expect(reportConfigDefaultValues('politically-exposed-person')).toMatchObject({
      'name-matching': { preset: 'strict' },
      'pep-classes': [1, 2],
      'include-relatives': false,
      'include-unknown-class': false,
      'default-country': null,
      'birthdate-matching': 'year_plus_minus_one',
      'birthdate-filter': 'penalty',
      'keep-without-birthdate': true,
    });
  });

  it('screens media over every category for 90 days, and ages email domains at 30 and 365 days', () => {
    for (const type of ['adverse-media', 'business-adverse-media'] as const) {
      expect(reportConfigDefaultValues(type)).toMatchObject({
        categories: [...ADVERSE_MEDIA_CATEGORIES],
        'max-article-age-days': 90,
        'allowed-countries': null,
      });
    }
    expect(reportConfigDefaultValues('email-address')).toMatchObject({
      'min-domain-age-days': 30,
      'young-domain-days': 365,
    });
    expect(reportConfigDefaultValues('address-lookup')).toMatchObject({ 'send-addressee': false });
    expect(Object.keys(reportConfigDefaultValues('phone-number'))).toEqual([
      'recurrence-interval-days',
    ]);
  });
});
