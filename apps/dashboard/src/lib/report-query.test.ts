import { describe, expect, it } from 'vitest';
import { REPORT_IDS } from '../testing/report-fixtures';
import {
  hasReportFilters,
  parseReportListQuery,
  reportApiFilters,
  reportFilterQuery,
} from './report-query';

describe('parseReportListQuery (C23, C86)', () => {
  it('filters nothing without parameters', () => {
    expect(parseReportListQuery({})).toEqual({
      filters: { types: [], statuses: [], tags: [] },
      selected: { types: [], statuses: [] },
      values: {},
      errors: {},
    });
  });

  it('reads every filter the index offers', () => {
    const query = parseReportListQuery({
      type: ['report/watchlist', 'report/adverse-media,report/email-address'],
      status: ['errored', 'ready'],
      result: 'match',
      template: REPORT_IDS.template,
      tag: 'vip, onboarding',
      'account-id': REPORT_IDS.account,
      'inquiry-id': REPORT_IDS.inquiry,
      after: REPORT_IDS.otherReport,
    });

    expect(query.filters).toEqual({
      types: ['report/watchlist', 'report/adverse-media', 'report/email-address'],
      statuses: ['errored', 'ready'],
      result: 'match',
      templateId: REPORT_IDS.template,
      tags: ['vip', 'onboarding'],
      accountId: REPORT_IDS.account,
      inquiryId: REPORT_IDS.inquiry,
    });
    expect(query.after).toBe(REPORT_IDS.otherReport);
    expect(query.errors).toEqual({});
  });

  it('drops a type, status, result or cursor that no control offers', () => {
    const query = parseReportListQuery({
      type: ['report/unknown', 'verification/selfie'],
      status: 'clear',
      result: 'maybe',
      after: 'inq_01M5CJXJF84MR3PHJHBHKQ4ZC9',
    });

    expect(query.filters).toEqual({ types: [], statuses: [], tags: [] });
    expect(query.after).toBeUndefined();
  });

  it('explains a typed value the API would refuse, keeps the boxes, and lists nothing', () => {
    const query = parseReportListQuery({
      type: 'report/watchlist',
      result: 'no-match',
      template: 'rptp_not-an-id',
      'account-id': 'acc_1',
      'inquiry-id': 'not-an-inquiry',
      tag: 'a\u0000b',
    });

    const { tag, ...typed } = query.errors;
    expect(typed).toEqual({
      template: 'Enter a report template ID: rptp_ followed by 26 letters and digits.',
      'account-id': 'Enter an account ID: acc_ followed by 26 letters and digits.',
      'inquiry-id': 'Enter an inquiry ID: inq_ followed by 26 letters and digits.',
    });
    expect(tag).toMatch(/^Enter tags/);
    expect(query.filters).toEqual({ types: [], statuses: [], tags: [] });
    expect(query.selected).toEqual({
      types: ['report/watchlist'],
      statuses: [],
      result: 'no-match',
    });
    expect(query.values.template).toBe('rptp_not-an-id');
  });
});

describe('reportApiFilters', () => {
  it('sends each filter as the dashboard list takes it, lists joined by commas (OR)', () => {
    expect(
      reportApiFilters({
        types: ['report/watchlist', 'report/email-address'],
        statuses: ['ready'],
        result: 'match',
        templateId: REPORT_IDS.template,
        tags: ['vip', 'onboarding'],
        accountId: REPORT_IDS.account,
        inquiryId: REPORT_IDS.inquiry,
      }),
    ).toEqual({
      'filter[type]': 'report/watchlist,report/email-address',
      'filter[status]': 'ready',
      'filter[has-match]': 'true',
      'filter[report-template-id]': REPORT_IDS.template,
      'filter[tag]': 'vip,onboarding',
      'filter[account-id]': REPORT_IDS.account,
      'filter[inquiry-id]': REPORT_IDS.inquiry,
    });
  });

  it('asks for no match as has-match false, which the API answers with ready reports only (C69.4)', () => {
    expect(
      reportApiFilters({ types: [], statuses: [], tags: [], result: 'no-match' })[
        'filter[has-match]'
      ],
    ).toBe('false');
    expect(reportApiFilters({ types: [], statuses: [], tags: [] })).toEqual({
      'filter[type]': undefined,
      'filter[status]': undefined,
      'filter[has-match]': undefined,
      'filter[report-template-id]': undefined,
      'filter[tag]': undefined,
      'filter[account-id]': undefined,
      'filter[inquiry-id]': undefined,
    });
  });
});

describe('reportFilterQuery and hasReportFilters', () => {
  it('keeps the filters in the page URL, so the next page lists the same reports', () => {
    const filters = {
      types: ['report/watchlist'] as const,
      statuses: ['errored'] as const,
      result: 'match' as const,
      tags: ['vip'],
      accountId: REPORT_IDS.account,
    };

    expect(reportFilterQuery(filters)).toEqual({
      type: ['report/watchlist'],
      status: ['errored'],
      result: 'match',
      template: undefined,
      tag: 'vip',
      'account-id': REPORT_IDS.account,
      'inquiry-id': undefined,
    });
    const params = reportFilterQuery(filters) as Record<string, string | string[] | undefined>;
    expect(parseReportListQuery(params).filters).toEqual(filters);
  });

  it('says whether anything is filtered', () => {
    expect(hasReportFilters({ types: [], statuses: [], tags: [] })).toBe(false);
    expect(hasReportFilters({ types: [], statuses: [], tags: [], result: 'no-match' })).toBe(true);
    expect(hasReportFilters({ types: [], statuses: ['ready'], tags: [] })).toBe(true);
  });
});
