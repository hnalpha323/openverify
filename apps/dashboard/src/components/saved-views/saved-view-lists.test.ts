import { SAVED_VIEW_LISTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { filtersOfParams, paramsOfFilters, savedViewListPath } from './saved-view-lists';

describe('a list page’s URL and a view’s filters (C165.1, C165.5)', () => {
  it('reads the inquiry page’s parameters as the API’s filters, days as UTC instants', () => {
    expect(
      filtersOfParams('inquiries', {
        status: ['failed', 'needs_review'],
        tag: 'vip,priority',
        'created-from': '2026-10-01',
        'created-to': '2026-10-02',
        'list-match': 'matched',
        after: 'inq_01JF0000000000000000000001',
      }),
    ).toEqual({
      filters: {
        'filter[status]': 'failed,needs_review',
        'filter[tag]': 'vip,priority',
        'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
        'filter[created-at-end]': '2026-10-03T00:00:00.000Z',
        'filter[list-match]': 'matched',
      },
      notKept: [],
    });
  });

  it('names a parameter a view cannot keep, never dropping it silently', () => {
    expect(filtersOfParams('reports', { result: 'match', type: 'watchlist' })).toEqual({
      filters: { 'filter[type]': 'watchlist' },
      notKept: ['result'],
    });
    expect(filtersOfParams('inquiries', { 'created-from': 'yesterday' }).notKept).toEqual([
      'created-from',
    ]);
  });

  it('maps a view’s filters back to the page’s own parameters', () => {
    expect(
      paramsOfFilters('inquiries', {
        'filter[status]': 'failed,needs_review',
        'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
        'filter[created-at-end]': '2026-10-03T00:00:00.000Z',
      }),
    ).toEqual({
      params: {
        status: ['failed', 'needs_review'],
        'created-from': '2026-10-01',
        'created-to': '2026-10-02',
      },
      dropped: [],
    });
    expect(paramsOfFilters('cases', { 'filter[case-queue-id]': 'cqueue_1' }).params).toEqual({
      queue: 'cqueue_1',
    });
  });

  it('lists the filters the page cannot show, so the view is not applied wider', () => {
    expect(
      paramsOfFilters('accounts', {
        'filter[status]': 'active',
        'filter[unknown]': 'x',
        'filter[created-at-start]': '2026-10-01T12:00:00.000Z',
      }),
    ).toEqual({
      params: { status: ['active'] },
      dropped: ['filter[unknown]', 'filter[created-at-start]'],
    });
  });

  it('keeps a transaction’s field filters both ways', () => {
    expect(
      filtersOfParams('transactions', { 'field.amount_band': 'high', from: '2026-10-01' }),
    ).toEqual({
      filters: {
        'filter[fields.amount_band]': 'high',
        'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      },
      notKept: [],
    });
    expect(
      paramsOfFilters('transactions', { 'filter[fields.amount_band]': 'high' }).params,
    ).toEqual({ 'field.amount_band': 'high' });
  });

  it('knows every list’s page but a webhook’s', () => {
    expect(SAVED_VIEW_LISTS.map(savedViewListPath)).toEqual([
      '/inquiries',
      '/accounts',
      '/reports',
      '/cases',
      '/transactions',
      '/api-logs',
      undefined,
      '/events',
      '/audit-logs',
    ]);
  });
});
