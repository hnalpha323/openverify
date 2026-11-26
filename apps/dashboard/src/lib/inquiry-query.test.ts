import { describe, expect, it } from 'vitest';
import {
  hasInquiryFilters,
  inquiryApiFilters,
  inquiryFilterQuery,
  isInquiryId,
  parseInquiryListQuery,
} from './inquiry-query';

const CURSOR = 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';
const ACCOUNT = 'acc_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

describe('parseInquiryListQuery', () => {
  it('reads every filter and the cursor from the page URL', () => {
    expect(
      parseInquiryListQuery({
        status: ['needs_review', 'failed'],
        tag: ' vip , manual review ',
        'account-id': ACCOUNT,
        'reference-id': 'ref-synthetic-001',
        'created-from': '2026-10-01',
        'created-to': '2026-10-20',
        after: CURSOR,
      }),
    ).toEqual({
      filters: {
        statuses: ['needs_review', 'failed'],
        tags: ['vip', 'manual review'],
        accountId: ACCOUNT,
        referenceId: 'ref-synthetic-001',
        createdFrom: '2026-10-01',
        createdTo: '2026-10-20',
      },
      selected: { statuses: ['needs_review', 'failed'] },
      values: {
        tag: ' vip , manual review ',
        'account-id': ACCOUNT,
        'reference-id': 'ref-synthetic-001',
        'created-from': '2026-10-01',
        'created-to': '2026-10-20',
      },
      after: CURSOR,
      errors: {},
    });
  });

  it('reads several statuses from one comma-separated value too', () => {
    expect(parseInquiryListQuery({ status: 'failed,completed' }).filters.statuses).toEqual([
      'failed',
      'completed',
    ]);
  });

  it('starts empty, without errors', () => {
    expect(parseInquiryListQuery({})).toEqual({
      filters: { statuses: [], tags: [] },
      selected: { statuses: [] },
      values: {},
      errors: {},
    });
  });

  it('silently drops unknown statuses and a malformed cursor, which no form produces', () => {
    const query = parseInquiryListQuery({
      status: ['bogus', 'toString', 'failed'],
      after: 'inq_../../me',
    });

    expect(query.filters.statuses).toEqual(['failed']);
    expect(query.after).toBeUndefined();
    expect(query.errors).toEqual({});
  });

  it('treats blank text filters as absent', () => {
    expect(
      parseInquiryListQuery({
        tag: ' ',
        'account-id': '',
        'reference-id': '  ',
        'created-from': '',
      }),
    ).toMatchObject({ filters: { statuses: [], tags: [] }, errors: {} });
  });

  it('explains each value the operator typed that the API would refuse, and keeps it for the form', () => {
    const query = parseInquiryListQuery({
      tag: 'vip,<script>',
      'account-id': 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
      'reference-id': 'x'.repeat(256),
      'created-from': '2026-02-30',
      'created-to': '20/10/2026',
    });

    expect(Object.keys(query.errors).sort()).toEqual([
      'account-id',
      'created-from',
      'created-to',
      'reference-id',
      'tag',
    ]);
    expect(query.errors['account-id']).toMatch(/acc_/);
    expect(query.errors['created-from']).toMatch(/YYYY-MM-DD/);
    expect(query.values['account-id']).toBe('inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z');
    expect(query.filters).toEqual({ statuses: [], tags: [] });
  });

  it('keeps the ticked statuses for the form while a typed value is refused (Workflow 2D F003)', () => {
    const query = parseInquiryListQuery({ status: ['failed'], 'created-from': '2026-02-30' });

    expect(query.filters).toEqual({ statuses: [], tags: [] });
    expect(query.selected).toEqual({ statuses: ['failed'] });
  });

  it('refuses an end date before the start date', () => {
    const query = parseInquiryListQuery({
      'created-from': '2026-10-20',
      'created-to': '2026-10-19',
    });

    expect(query.errors).toEqual({
      'created-to': 'The end date must be on or after the start date.',
    });
  });

  it('accepts a range of one day', () => {
    expect(
      parseInquiryListQuery({ 'created-from': '2026-10-20', 'created-to': '2026-10-20' }).errors,
    ).toEqual({});
  });

  it('ignores repeated text parameters, which no form produces', () => {
    expect(parseInquiryListQuery({ 'account-id': [ACCOUNT, ACCOUNT] }).filters).toEqual({
      statuses: [],
      tags: [],
    });
  });
});

describe('inquiryFilterQuery', () => {
  it('turns the filters back into the page URL query, for links that keep them', () => {
    expect(
      inquiryFilterQuery({
        statuses: ['failed', 'completed'],
        tags: ['vip', 'manual review'],
        accountId: ACCOUNT,
        referenceId: 'ref-1',
        createdFrom: '2026-10-01',
        createdTo: '2026-10-20',
      }),
    ).toEqual({
      status: ['failed', 'completed'],
      tag: 'vip,manual review',
      'account-id': ACCOUNT,
      'reference-id': 'ref-1',
      'created-from': '2026-10-01',
      'created-to': '2026-10-20',
    });
    expect(inquiryFilterQuery({ statuses: [], tags: [] })).toEqual({
      status: [],
      tag: undefined,
      'account-id': undefined,
      'reference-id': undefined,
      'created-from': undefined,
      'created-to': undefined,
    });
  });
});

describe('inquiryApiFilters', () => {
  it('sends the C9 filters: OR lists joined by commas, and a UTC day range with an exclusive end', () => {
    expect(
      inquiryApiFilters({
        statuses: ['failed', 'completed'],
        tags: ['vip', 'manual review'],
        accountId: ACCOUNT,
        referenceId: 'ref,with,commas',
        createdFrom: '2026-10-01',
        createdTo: '2026-10-31',
      }),
    ).toEqual({
      'filter[status]': 'failed,completed',
      'filter[tag]': 'vip,manual review',
      'filter[account-id]': ACCOUNT,
      'filter[reference-id]': 'ref,with,commas',
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'filter[created-at-end]': '2026-11-01T00:00:00.000Z',
    });
  });

  it('leaves out the filters that are not set', () => {
    expect(inquiryApiFilters({ statuses: [], tags: [] })).toEqual({
      'filter[status]': undefined,
      'filter[tag]': undefined,
      'filter[account-id]': undefined,
      'filter[reference-id]': undefined,
      'filter[created-at-start]': undefined,
      'filter[created-at-end]': undefined,
    });
  });
});

describe('isInquiryId', () => {
  it('accepts only a C1 inquiry id', () => {
    expect(isInquiryId(CURSOR)).toBe(true);
    expect(isInquiryId('inq_x')).toBe(false);
    expect(isInquiryId(ACCOUNT)).toBe(false);
  });
});

describe('the C165.3 inquiry filters (Workflow 9C)', () => {
  const LIST = 'lst_01JF0000000000000000000014';

  it('reads the list match, the list, a check with its status and the step, and sends them', () => {
    const query = parseInquiryListQuery({
      'list-match': 'matched',
      'list-id': LIST,
      check: 'id_barcode_detection',
      'check-status': 'failed',
      'next-step-name': 'government_id',
    });

    expect(query.errors).toEqual({});
    expect(query.filters).toMatchObject({
      listMatch: 'matched',
      listId: LIST,
      check: 'id_barcode_detection',
      checkStatus: 'failed',
      nextStepName: 'government_id',
    });
    expect(inquiryApiFilters(query.filters)).toMatchObject({
      'filter[list-match]': 'matched',
      'filter[list-id]': LIST,
      'filter[check]': 'id_barcode_detection',
      'filter[check-status]': 'failed',
      'filter[next-step-name]': 'government_id',
    });
    expect(inquiryFilterQuery(query.filters)).toMatchObject({
      'list-match': 'matched',
      'list-id': LIST,
      check: 'id_barcode_detection',
      'check-status': 'failed',
      'next-step-name': 'government_id',
    });
    expect(hasInquiryFilters(query.filters)).toBe(true);
  });

  it('explains each value the API would refuse, a check never without its status', () => {
    expect(
      parseInquiryListQuery({
        'list-match': 'maybe',
        'list-id': 'lst_1',
        check: 'Barcode!',
        'next-step-name': 'Step One',
      }).errors,
    ).toEqual({
      'list-match': 'Choose a value from the list.',
      'list-id': 'Enter a list ID: lst_ followed by 26 letters and digits.',
      check: 'Enter a check name in lower case, such as id_barcode_detection.',
      'check-status': 'Choose the status of the check too.',
      'next-step-name': 'Enter a step ID as the flow names it, in lower case.',
    });
    expect(parseInquiryListQuery({ 'check-status': 'failed' }).errors).toEqual({
      check: 'Enter the check this status is for.',
    });
    expect(
      parseInquiryListQuery({ check: 'id_barcode_detection', 'check-status': 'lost' }).errors,
    ).toEqual({ 'check-status': 'Choose a value from the list.' });
  });
});
