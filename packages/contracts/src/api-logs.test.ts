import { describe, expect, it } from 'vitest';
import {
  API_LOG_DEFAULT_RETENTION_DAYS,
  API_LOG_MAX_BODY_BYTES,
  apiLogDocumentSchema,
  apiLogListDocumentSchema,
  apiLogResourceSchema,
  buildApiLogResource,
  listApiLogsQuerySchema,
} from './api-logs.js';
import { AT, AT_ISO, IDS } from './test-support.js';

const apiLog = {
  type: 'api-log',
  id: IDS.apiLog,
  attributes: {
    method: 'POST',
    path: '/api/v1/inquiries',
    route: '/api/v1/inquiries',
    status: 201,
    'duration-ms': 42,
    'request-id': '00000000-0000-4000-8000-000000000001',
    'idempotency-key': 'order-test-001',
    'api-key-id': IDS.serverIntegration,
    'user-id': null,
    'ip-address': '203.0.113.7',
    'user-agent': 'openverify-node/0.0.0',
    query: {},
    'request-body': { data: { attributes: { 'inquiry-template-id': IDS.template } } },
    'response-body': { data: { type: 'inquiry', id: IDS.inquiry } },
    'created-at': AT_ISO,
  },
};

describe('api-log resource (C12)', () => {
  it('records the request, its principal and the redacted bodies', () => {
    expect(apiLogResourceSchema.parse(apiLog)).toEqual(apiLog);
    expect(apiLogDocumentSchema.safeParse({ data: apiLog }).success).toBe(true);
    expect(
      apiLogListDocumentSchema.safeParse({ data: [apiLog], links: { next: null } }).success,
    ).toBe(true);
    expect(API_LOG_MAX_BODY_BYTES).toBe(64 * 1024);
    expect(API_LOG_DEFAULT_RETENTION_DAYS).toBe(30);
  });

  it('records requests that matched no route and requests by a user', () => {
    const value = {
      ...apiLog,
      attributes: {
        ...apiLog.attributes,
        method: 'OPTIONS',
        route: null,
        status: 404,
        'api-key-id': null,
        'user-id': IDS.user,
        'idempotency-key': null,
        query: null,
        'request-body': null,
        'response-body': null,
      },
    };
    expect(apiLogResourceSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['a lowercase method', { method: 'post' }],
    ['a status below 100', { status: 99 }],
    ['a negative duration', { 'duration-ms': -1 }],
    ['an API key id of another kind', { 'api-key-id': IDS.user }],
  ])('rejects %s', (_name, change) => {
    const value = { ...apiLog, attributes: { ...apiLog.attributes, ...change } };
    expect(apiLogResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from a record', () => {
    expect(
      buildApiLogResource({
        id: IDS.apiLog,
        method: 'POST',
        path: '/api/v1/inquiries',
        route: '/api/v1/inquiries',
        status: 201,
        durationMs: 42,
        requestId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'order-test-001',
        apiKeyId: IDS.serverIntegration,
        userId: null,
        ipAddress: '203.0.113.7',
        userAgent: 'openverify-node/0.0.0',
        query: {},
        requestBody: { data: { attributes: { 'inquiry-template-id': IDS.template } } },
        responseBody: { data: { type: 'inquiry', id: IDS.inquiry } },
        createdAt: AT,
      }),
    ).toEqual(apiLog);
  });
});

describe('GET /api-logs query (C12)', () => {
  it('filters by method, status code or class, route, API key and time', () => {
    const query = {
      'filter[method]': 'POST,PATCH',
      'filter[status]': '4xx,201',
      'filter[route]': '/api/v1/inquiries/:id',
      'filter[api-key-id]': IDS.serverIntegration,
      'filter[created-at-start]': '2026-10-01T00:00:00Z',
    };
    expect(listApiLogsQuerySchema.parse(query)).toEqual(query);
  });

  it.each([
    ['a status class that does not exist', { 'filter[status]': '6xx' }],
    ['a partial status', { 'filter[status]': '20' }],
    ['a lowercase method', { 'filter[method]': 'get' }],
    ['a user id as API key', { 'filter[api-key-id]': IDS.user }],
  ])('rejects %s', (_name, query) => {
    expect(listApiLogsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('GET /api-logs by user (C25.9, Workflow 2E)', () => {
  it('filters by the users whose dashboard sessions made the requests', () => {
    const query = { 'filter[user-id]': `${IDS.user},${IDS.otherUser}` };
    expect(listApiLogsQuerySchema.parse(query)).toEqual(query);
  });

  it.each([
    ['an API key id as user', IDS.serverIntegration],
    ['a malformed id', 'usr_nope'],
    ['an empty value', ''],
  ])('rejects %s', (_name, value) => {
    expect(listApiLogsQuerySchema.safeParse({ 'filter[user-id]': value }).success).toBe(false);
  });
});
