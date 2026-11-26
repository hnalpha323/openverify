// @vitest-environment node
import { createClient } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, mockApi, type MockApi } from '../../testing/api-mock';
import { API_LOG_METHODS, listApiLogs, parseApiLogListQuery } from './api-logs';

const CALLER = 'key_01J9ZK3M5Q7R8S9T0V1W2X3Y63';
const LOG = 'alog_01J9ZK3M5Q7R8S9T0V1W2X3Y64';
const USER = 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y65';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

describe('parseApiLogListQuery', () => {
  it('reads the method, status, route, key, creation range and cursor', () => {
    const query = parseApiLogListQuery({
      method: 'POST',
      status: '4xx',
      route: '/api/v1/inquiries/:id',
      'api-key-id': CALLER,
      'created-at-start': '2026-10-20T10:00',
      after: LOG,
    });

    expect(query.applied).toEqual({
      method: 'POST',
      status: '4xx',
      route: '/api/v1/inquiries/:id',
      'api-key-id': CALLER,
      'created-at-start': '2026-10-20T10:00:00.000Z',
    });
    expect(query.errors).toEqual({});
    expect(query.after).toBe(LOG);
  });

  it('takes an exact status code too', () => {
    expect(parseApiLogListQuery({ status: '404' }).applied).toEqual({ status: '404' });
  });

  it('applies nothing malformed, and says why', () => {
    const query = parseApiLogListQuery({
      method: 'BREW',
      status: '4x',
      route: 'inquiries',
      'api-key-id': 'key_1',
      after: 'alog_1',
    });

    expect(query.applied).toEqual({});
    expect(query.after).toBeUndefined();
    expect(query.errors).toEqual({
      method: 'Choose a method from the list.',
      status: 'Enter a status code such as 404, or a class such as 4xx.',
      route: 'Enter a route template that starts with /, such as /api/v1/inquiries/:id.',
      'api-key-id': 'Enter an API key ID, such as key_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
    });
  });

  it("reads a user filter, for the requests made with that user's dashboard sessions (C25.9)", () => {
    expect(parseApiLogListQuery({ 'user-id': USER }).applied).toEqual({ 'user-id': USER });
    expect(parseApiLogListQuery({ 'user-id': 'usr_1' })).toMatchObject({
      applied: {},
      errors: { 'user-id': 'Enter a user ID, such as usr_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.' },
    });
  });

  it('offers the methods of the server API', () => {
    expect(API_LOG_METHODS).toEqual(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
  });
});

describe('listApiLogs', () => {
  it('lists one page with the filters', async () => {
    api.reply(200, { data: [], links: { next: null } });
    const client = createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

    await listApiLogs(
      client,
      parseApiLogListQuery({ method: 'GET', status: '5xx', 'api-key-id': CALLER, after: LOG }),
    );

    expect(api.last().path).toBe('/api/v1/api-logs');
    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[method]': 'GET',
      'filter[status]': '5xx',
      'filter[api-key-id]': CALLER,
      'page[size]': '25',
      'page[after]': LOG,
    });
  });
});
