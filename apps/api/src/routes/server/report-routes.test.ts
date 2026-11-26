/**
 * C72.1, C72.2 (Workflow 6A Stage 1b): the report, report template and report template version
 * routes are registered under `/api/v1` with their frozen schemas and scopes. Each answers 403
 * without its scope, 400 for a body, query or id its schema refuses, and 501 until `api-reports`
 * builds its handler; `api-reports` replaces the 501 expectations with the behaviour as it builds
 * each one. Synthetic values only.
 */
import { testId } from '@openverify/db/testing';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 60_000);

afterAll(async () => {
  await api.close();
});

const REPORT = testId('rep');
const TEMPLATE = testId('rptp');
const VERSION = testId('rptpv');

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Each route, the scope it needs, and a body its schema takes. */
const ROUTES: readonly [Method, string, string, unknown?][] = [
  [
    'POST',
    '/reports',
    'reports:write',
    {
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': TEMPLATE,
          query: { 'name-first': 'Synthetic', 'name-last': 'Person' },
        },
      },
    },
  ],
  ['GET', '/reports', 'reports:read'],
  ['GET', `/reports/${REPORT}`, 'reports:read'],
  ['DELETE', `/reports/${REPORT}`, 'reports:redact'],
  ['POST', `/reports/${REPORT}/add-tag`, 'reports:write', { meta: { 'tag-name': 'synthetic' } }],
  ['POST', `/reports/${REPORT}/remove-tag`, 'reports:write', { meta: { 'tag-name': 'synthetic' } }],
  [
    'POST',
    `/reports/${REPORT}/set-tags`,
    'reports:write',
    { meta: { 'tag-names': ['synthetic'] } },
  ],
  [
    'POST',
    `/reports/${REPORT}/dismiss`,
    'reports:review',
    { data: { attributes: { reason: 'A synthetic false positive' } } },
  ],
  [
    'POST',
    `/reports/${REPORT}/review`,
    'reports:review',
    { data: { attributes: { 'review-type': 'all_records', 'review-status': 'indeterminate' } } },
  ],
  ['POST', `/reports/${REPORT}/pause`, 'reports:write', {}],
  ['POST', `/reports/${REPORT}/resume`, 'reports:write', {}],
  ['POST', `/reports/${REPORT}/run`, 'reports:write', {}],
  ['GET', `/reports/${REPORT}/history`, 'reports:read'],
  [
    'POST',
    '/report-templates',
    'report-templates:write',
    { data: { attributes: { 'report-type': 'email-address', name: 'Synthetic emails' } } },
  ],
  ['GET', '/report-templates', 'report-templates:read'],
  ['GET', `/report-templates/${TEMPLATE}`, 'report-templates:read'],
  [
    'PATCH',
    `/report-templates/${TEMPLATE}`,
    'report-templates:write',
    { data: { attributes: { name: 'Renamed' } } },
  ],
  [
    'POST',
    '/report-template-versions',
    'report-templates:write',
    { data: { attributes: { 'report-template-id': TEMPLATE, config: {} } } },
  ],
  ['GET', '/report-template-versions', 'report-templates:read'],
  ['GET', `/report-template-versions/${VERSION}`, 'report-templates:read'],
  [
    'PATCH',
    `/report-template-versions/${VERSION}`,
    'report-templates:write',
    { data: { attributes: { config: {} } } },
  ],
  ['POST', `/report-template-versions/${VERSION}/publish`, 'report-templates:publish', {}],
];

async function call(method: Method, url: string, scopes: readonly string[], payload?: unknown) {
  const token = await api.newApiKey(api.environmentId, { scopes });
  const options: InjectOptions = { method, url: `/api/v1${url}`, headers: bearer(token) };
  return api.app.inject(
    payload === undefined ? options : { ...options, payload: payload as object },
  );
}

describe('the frozen report routes (C72.1)', () => {
  it.each(ROUTES)('%s %s needs %s', async (method, url, scope, payload) => {
    const response = await call(method, url, ['inquiries:read'], payload);

    expect(response.statusCode, response.body).toBe(403);
  });

  // Built by api-reports: the template and version routes (C71) and every report route.
  it.each(ROUTES.filter(([, url]) => url.startsWith('/reports')))(
    '%s %s answers from its handler',
    async (method, url, scope, payload) => {
      const response = await call(method, url, [scope], payload);

      expect(response.statusCode, response.body).not.toBe(501);
      expect([200, 201, 404, 409, 422]).toContain(response.statusCode);
    },
  );

  it.each([
    ['GET', '/reports/rep_not-an-id', 'reports:read', undefined],
    ['GET', '/reports?filter[status]=screened', 'reports:read', undefined],
    [
      'POST',
      '/reports',
      'reports:write',
      // The deprecated `reference-id` is refused (H22).
      {
        data: {
          type: 'report/watchlist',
          attributes: {
            'report-template-id': TEMPLATE,
            query: { term: 'Synthetic' },
            'reference-id': 'synthetic-1',
          },
        },
      },
    ],
    [
      'POST',
      `/reports/${REPORT}/dismiss`,
      'reports:review',
      { data: { attributes: { reason: '' } } },
    ],
    ['POST', `/report-template-versions/${VERSION}/publish`, 'report-templates:publish', { x: 1 }],
  ] as const)(
    '%s %s refuses what its schema does not take',
    async (method, url, scope, payload) => {
      const response = await call(method, url, [scope], payload);

      expect(response.statusCode, response.body).toBe(400);
    },
  );
});
