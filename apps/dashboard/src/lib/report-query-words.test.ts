import { REPORT_QUERY_FIELDS } from '@openverify/contracts';
import { REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { queryFieldLabel } from './report-query-words';

const MEMBERS = REPORT_TYPES.flatMap((type) =>
  REPORT_QUERY_FIELDS[type].map((field) => [type, field] as const),
);

describe('report queries in words (C72.1, C79-C82)', () => {
  it.each(MEMBERS)('labels the %s query member %s', (type, field) => {
    expect(queryFieldLabel(type, field)).toMatch(/^[A-Z][^_]*$/);
  });

  it.each(REPORT_TYPES)('gives each %s query member its own label', (type) => {
    const labels = REPORT_QUERY_FIELDS[type].map((field) => queryFieldLabel(type, field));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('calls a business term the company name and a person term the full name', () => {
    expect(queryFieldLabel('business-watchlist', 'term')).toBe('Company name');
    expect(queryFieldLabel('business-adverse-media', 'term')).toBe('Company name');
    expect(queryFieldLabel('watchlist', 'term')).toBe('Full name');
    expect(queryFieldLabel('politically-exposed-person', 'term')).toBe('Full name');
  });

  it.each([
    ['watchlist', 'not-a-member'],
    ['email-address', 'name-first'],
    ['watchlist', '__proto__'],
  ] as const)('has no label for %s %s', (type, field) => {
    expect(queryFieldLabel(type, field)).toBeUndefined();
  });
});
