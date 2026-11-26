// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import { TRANSACTIONS_PAGE_SIZE, listTransactions } from './transactions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('listTransactions (C104; C165.3 field filters, Workflow 9C)', () => {
  it('sends each field filter as filter[fields.<key>], beside the others', async () => {
    api.reply(200, { data: [], links: { next: null } });

    await listTransactions({
      status: 'approved',
      fields: { amount_band: 'high', channel: 'web' },
    });

    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/transactions' });
    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[status]': 'approved',
      'filter[fields.amount_band]': 'high',
      'filter[fields.channel]': 'web',
      'page[size]': String(TRANSACTIONS_PAGE_SIZE),
    });
  });

  it('sends no field filter when none is chosen', async () => {
    api.reply(200, { data: [], links: { next: null } });

    await listTransactions({}, 'txn_01JB0000000000000000000001');

    expect(Object.fromEntries(api.last().query)).toEqual({
      'page[after]': 'txn_01JB0000000000000000000001',
      'page[size]': String(TRANSACTIONS_PAGE_SIZE),
    });
  });
});
