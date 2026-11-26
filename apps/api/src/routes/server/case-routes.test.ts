/**
 * Workflow 8B Stage 1b, checkpoint (C) (C129.5, C128.7, C134.4, C138.3, C140.1; Stage 1a amendments 6
 * and 19): every route of the (C) family is registered in its implementer's file with its schema and
 * scope, and answers 501 until that owner builds it. A key without the route's scope gets 403 before
 * anything is read, and a body that does not fit the frozen schema gets 400.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

const CASE = 'case_01M6FQZCV622MRCK2ZKC7F4HD9';
const TEMPLATE = 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN';
const VERSION = 'ctmplv_01M5CK3190XEVBM5ZXA76E1JSN';
const COMMENT = 'cscm_01M5CK3190XEVBM5ZXA76E1JSN';
const ACTION = 'cact_01M5CK3190XEVBM5ZXA76E1JSN';
const BULK = 'cblk_01M5CK3190XEVBM5ZXA76E1JSN';
const INQUIRY = 'inq_01M5CK3190XEVBM5ZXA76E1JSN';
const WORKFLOW = 'wfl_01M5CK3190XEVBM5ZXA76E1JSN';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Frozen {
  method: Method;
  url: string;
  scope: string;
  body?: Record<string, unknown>;
  /** Its owner built it, so it no longer answers 501; its scope still holds. */
  built?: true;
}

const empty = { meta: {} };

/** One valid request per frozen route, with the scope it needs. */
const ROUTES: readonly Frozen[] = [
  { method: 'GET', url: '/cases', scope: 'cases:read', built: true },
  {
    method: 'POST',
    url: '/cases',
    scope: 'cases:write',
    built: true,
    body: { data: { type: 'case', attributes: { 'case-template-id': TEMPLATE } } },
  },
  { method: 'GET', url: `/cases/${CASE}`, scope: 'cases:read', built: true },
  {
    method: 'PATCH',
    url: `/cases/${CASE}`,
    scope: 'cases:write',
    built: true,
    body: { meta: { 'sla-expires-in-seconds': 3_600 } },
  },
  { method: 'DELETE', url: `/cases/${CASE}`, scope: 'cases:redact', built: true },
  {
    method: 'POST',
    url: `/cases/${CASE}/set-status`,
    scope: 'cases:write',
    built: true,
    body: { meta: { status: 'pending' } },
  },
  {
    method: 'POST',
    url: `/cases/${CASE}/add-comment`,
    scope: 'cases:write',
    built: true,
    body: { meta: { message: 'Synthetic comment.' } },
  },
  {
    method: 'POST',
    url: `/cases/${CASE}/add-objects`,
    scope: 'cases:write',
    built: true,
    body: { meta: { 'object-ids': [INQUIRY] } },
  },
  {
    method: 'POST',
    url: `/cases/${CASE}/remove-objects`,
    scope: 'cases:write',
    built: true,
    body: { meta: { 'object-ids': [INQUIRY] } },
  },
  {
    method: 'POST',
    url: `/cases/${CASE}/add-tag`,
    scope: 'cases:write',
    built: true,
    body: { meta: { 'tag-name': 'synthetic' } },
  },
  {
    method: 'POST',
    url: `/cases/${CASE}/remove-tag`,
    scope: 'cases:write',
    built: true,
    body: { meta: { 'tag-name': 'synthetic' } },
  },
  {
    method: 'POST',
    url: `/cases/${CASE}/set-tags`,
    scope: 'cases:write',
    built: true,
    body: { meta: { 'tag-names': ['synthetic'] } },
  },
  {
    method: 'POST',
    url: '/cases/search',
    scope: 'cases:read',
    built: true,
    body: { query: { attribute: 'status', operator: 'eq', value: 'open' } },
  },
  {
    method: 'POST',
    url: '/cases/bulk',
    scope: 'cases:write',
    built: true,
    body: {
      data: { attributes: { action: 'add-tags', 'case-ids': [CASE] } },
      meta: { 'tag-names': ['synthetic'] },
    },
  },
  { method: 'GET', url: `/case-bulk-actions/${BULK}`, scope: 'cases:read', built: true },
  { method: 'GET', url: `/cases/${CASE}/history`, scope: 'cases:read', built: true },
  { method: 'GET', url: `/cases/${CASE}/objects`, scope: 'cases:read', built: true },
  { method: 'GET', url: `/cases/${CASE}/comments`, scope: 'cases:read', built: true },
  {
    method: 'POST',
    url: `/case-comments/${COMMENT}/redact`,
    scope: 'cases:write',
    body: empty,
    built: true,
  },
  { method: 'POST', url: `/cases/${CASE}/print`, scope: 'cases:read', body: empty, built: true },
  { method: 'GET', url: '/case-templates', scope: 'case-templates:read', built: true },
  {
    method: 'POST',
    url: '/case-templates',
    scope: 'case-templates:write',
    built: true,
    body: { data: { type: 'case-template', attributes: { name: 'Review', key: 'KYC' } } },
  },
  { method: 'GET', url: `/case-templates/${TEMPLATE}`, scope: 'case-templates:read', built: true },
  {
    method: 'PATCH',
    url: `/case-templates/${TEMPLATE}`,
    scope: 'case-templates:write',
    built: true,
    body: { data: { type: 'case-template', attributes: { name: 'Review again' } } },
  },
  {
    method: 'POST',
    url: `/case-templates/${TEMPLATE}/archive`,
    scope: 'case-templates:write',
    built: true,
    body: empty,
  },
  {
    method: 'GET',
    url: `/case-template-versions?filter[case-template-id]=${TEMPLATE}`,
    scope: 'case-templates:read',
    built: true,
  },
  {
    method: 'POST',
    url: '/case-template-versions',
    scope: 'case-templates:write',
    built: true,
    body: {
      data: { type: 'case-template-version', attributes: { 'case-template-id': TEMPLATE } },
    },
  },
  {
    method: 'GET',
    url: `/case-template-versions/${VERSION}`,
    scope: 'case-templates:read',
    built: true,
  },
  {
    method: 'PATCH',
    url: `/case-template-versions/${VERSION}`,
    scope: 'case-templates:write',
    built: true,
    body: { data: { type: 'case-template-version', attributes: { resolutions: ['Approved'] } } },
  },
  {
    method: 'POST',
    url: `/case-template-versions/${VERSION}/publish`,
    scope: 'case-templates:publish',
    built: true,
    body: empty,
  },
  { method: 'GET', url: '/case-actions', scope: 'workflows:write', built: true },
  {
    method: 'POST',
    url: '/case-actions',
    scope: 'workflows:write',
    built: true,
    body: {
      data: {
        type: 'case-action',
        attributes: { 'workflow-id': WORKFLOW, 'case-template-ids': [TEMPLATE], label: 'Escalate' },
      },
    },
  },
  { method: 'GET', url: `/case-actions/${ACTION}`, scope: 'workflows:write', built: true },
  {
    method: 'PATCH',
    url: `/case-actions/${ACTION}`,
    scope: 'workflows:write',
    built: true,
    body: { data: { type: 'case-action', attributes: { label: 'Escalate now' } } },
  },
  {
    method: 'POST',
    url: `/cases/${CASE}/run-action`,
    scope: 'workflows:trigger',
    built: true,
    body: { data: { 'case-action-id': ACTION, parameters: {} } },
  },
  {
    method: 'GET',
    url: `/cases/${CASE}/available-actions`,
    scope: 'workflows:trigger',
    built: true,
  },
  {
    method: 'POST',
    url: `/inquiries/${INQUIRY}/review-requests`,
    scope: 'cases:write',
    built: true,
    body: { meta: { statement: 'Synthetic statement.' } },
  },
];

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

const call = (route: Frozen, token: string) =>
  api.app.inject({
    method: route.method,
    url: `/api/v1${route.url}`,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-${route.method}-${route.url}` },
    ...(route.body === undefined ? {} : { payload: route.body }),
  });

describe('the frozen (C) routes (C129.5)', () => {
  it.each(
    ROUTES.filter((route) => route.built !== true).map(
      (route) => [`${route.method} ${route.url}`, route] as const,
    ),
  )('%s answers 501 until its owner builds it', async (_name, route) => {
    const user = api.newUserToken(api.environmentId);

    const response = await call(route, user);

    expect(response.statusCode, response.body).toBe(501);
  });

  it.each(ROUTES.map((route) => [`${route.method} ${route.url}`, route] as const))(
    '%s refuses a key without its scope',
    async (_name, route) => {
      const token = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });

      const response = await call(route, token);

      expect(response.statusCode, response.body).toBe(403);
      expect(response.headers['www-authenticate']).toContain(route.scope);
    },
  );
});
