/**
 * Workflow 8A Stage 1b (E) (C112.6, C118.7, C120): the frozen routes of the engine family, registered
 * with their contract schemas and scopes, and in the OpenAPI document. Each reaches its handler after
 * its authentication, scope and schema: `501` until its owner builds it, and its owner's own suite
 * covers the answers. Publishing is a scope of its own, run values are not for viewers, and only a
 * holder of `workflow-runs:redact` redacts a run. Synthetic values.
 */
import { BUILTIN_ROLES, type Permission } from '@openverify/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const ULID = '01M5CK16P0D13FXHZSS4TCFBVH';
const WORKFLOW = `wfl_${ULID}`;
const VERSION = `wfv_${ULID}`;
const RUN = `wfr_${ULID}`;
const ACCOUNT = `acc_${ULID}`;
const ACCOUNT_TYPE = `acctp_${ULID}`;
const ACTION = `accac_${ULID}`;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const call = (method: Method, url: string, payload?: unknown, token = api.token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });
const meta = (members: Record<string, unknown>) => ({ meta: members });
const named = (type: string, attributes: Record<string, unknown>) => ({
  data: { type, attributes },
});

/** What the authentication, scope and schema answer. */
const HELD_BACK = [400, 401, 403];

/** The smallest definition the schema takes: a draft has no trigger yet (Stage 1a amendment 29). */
const EMPTY_DEFINITION = {
  'schema-version': 1,
  trigger: null,
  inputs: [],
  variables: [],
  steps: [],
  edges: [],
  outputs: [],
  layout: {},
};

type Route = [Method, string, readonly Permission[], unknown?];

/** Every route, its scope and a body its schema takes. */
const ROUTES: Route[] = [
  ['GET', '/workflows', ['workflows:read']],
  ['POST', '/workflows', ['workflows:write'], named('workflow', { name: 'Review' })],
  ['GET', `/workflows/${WORKFLOW}`, ['workflows:read']],
  ['PATCH', `/workflows/${WORKFLOW}`, ['workflows:write'], named('workflow', { name: 'Renamed' })],
  ['POST', `/workflows/${WORKFLOW}/pause`, ['workflows:write']],
  ['POST', `/workflows/${WORKFLOW}/activate`, ['workflows:write']],
  ['POST', `/workflows/${WORKFLOW}/archive`, ['workflows:write']],
  ['GET', `/workflows/${WORKFLOW}/draft`, ['workflows:read']],
  [
    'PUT',
    `/workflows/${WORKFLOW}/draft`,
    ['workflows:write'],
    named('workflow-version', { definition: EMPTY_DEFINITION, 'lock-version': 1 }),
  ],
  ['POST', `/workflows/${WORKFLOW}/draft/validate`, ['workflows:write']],
  ['POST', `/workflows/${WORKFLOW}/publish`, ['workflows:publish']],
  [
    'POST',
    `/workflows/${WORKFLOW}/rollout`,
    ['workflows:publish'],
    meta({ 'rollout-percentage': 100 }),
  ],
  [
    'POST',
    `/workflows/${WORKFLOW}/restore`,
    ['workflows:publish'],
    meta({ 'version-id': VERSION }),
  ],
  [
    'POST',
    `/workflows/${WORKFLOW}/promote`,
    ['workflows:publish'],
    meta({ 'environment-id': `env_${ULID}` }),
  ],
  ['GET', `/workflow-versions?filter[workflow-id]=${WORKFLOW}`, ['workflows:read']],
  ['GET', `/workflow-versions/${VERSION}`, ['workflows:read']],
  ['GET', `/workflow-versions/${VERSION}/diff?against=${VERSION}`, ['workflows:read']],
  ['POST', `/workflows/${WORKFLOW}/trigger`, ['workflows:trigger'], body({ fields: {} })],
  [
    'POST',
    `/workflows/${WORKFLOW}/manual-runs`,
    ['workflows:trigger'],
    named('workflow-run', { 'object-ids': [`inq_${ULID}`] }),
  ],
  [
    'POST',
    `/workflows/${WORKFLOW}/test-runs`,
    ['workflows:trigger'],
    named('workflow-run', { 'object-id': `inq_${ULID}` }),
  ],
  ['GET', '/workflow-trigger-deliveries', ['workflow-runs:read']],
  ['GET', '/workflow-runs', ['workflow-runs:read']],
  ['GET', `/workflow-runs/${RUN}`, ['workflow-runs:read']],
  ['GET', `/workflow-runs/${RUN}/steps`, ['workflow-runs:read']],
  ['POST', `/workflow-runs/${RUN}/resume`, ['workflow-runs:write']],
  ['POST', `/workflow-runs/${RUN}/rerun`, ['workflow-runs:write']],
  ['POST', `/workflow-runs/${RUN}/cancel`, ['workflow-runs:write']],
  [
    'POST',
    `/workflows/${WORKFLOW}/cancel-runs`,
    ['workflow-runs:write'],
    meta({ 'before-version-id': VERSION }),
  ],
  ['DELETE', `/workflow-runs/${RUN}`, ['workflow-runs:redact']],
  ['GET', '/workflow-actions', ['workflows:read']],
  ['GET', '/workflow-recipes', ['workflows:read']],
  ['POST', '/workflow-recipes/review-first/install', ['workflows:write']],
  ['GET', '/account-actions', ['workflows:write']],
  [
    'POST',
    '/account-actions',
    ['workflows:write'],
    named('account-action', {
      'workflow-id': WORKFLOW,
      'account-type-id': ACCOUNT_TYPE,
      label: 'Review',
    }),
  ],
  ['GET', `/account-actions/${ACTION}`, ['workflows:write']],
  [
    'PATCH',
    `/account-actions/${ACTION}`,
    ['workflows:write'],
    named('account-action', { label: 'Renamed' }),
  ],
  [
    'POST',
    `/accounts/${ACCOUNT}/run-action`,
    ['workflows:trigger', 'accounts:read'],
    { data: { 'account-action-id': ACTION, parameters: {} } },
  ],
  ['GET', `/accounts/${ACCOUNT}/available-actions`, ['workflows:trigger', 'accounts:read']],
];

describe('the frozen routes (C112.6, C118.7, C120)', () => {
  it.each<Route>(ROUTES)('%s %s reaches its handler', async (method, url, _scopes, payload) => {
    // A person, because publish, rollout, restore and promote refuse an API key (C121.2).
    const response = await call(method, url, payload, api.newUserToken(api.environmentId));

    expect(HELD_BACK, response.body).not.toContain(response.statusCode);
  });

  it.each<Route>(ROUTES)('%s %s needs its scope', async (method, url, scopes, payload) => {
    const without = api.newUserToken(api.environmentId, { permissions: ['api-logs:read'] });
    const holding = api.newUserToken(api.environmentId, { permissions: [...scopes] });

    expect((await call(method, url, payload, without)).statusCode).toBe(403);
    expect((await call(method, url, payload, holding)).statusCode).not.toBe(403);
  });

  it.each<Route>(ROUTES)('%s %s needs a principal', async (method, url) => {
    const response = await api.app.inject({ method, url: `/api/v1${url}` });

    expect(response.statusCode).toBe(401);
  });

  it('are all in the OpenAPI document (only plugin-registered routes are)', async () => {
    const response = await api.app.inject({ url: '/openapi.json' });
    const paths = Object.keys(response.json<{ paths: Record<string, unknown> }>().paths);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/workflows',
        '/api/v1/workflows/{id}',
        '/api/v1/workflows/{id}/draft',
        '/api/v1/workflows/{id}/draft/validate',
        '/api/v1/workflows/{id}/publish',
        '/api/v1/workflows/{id}/rollout',
        '/api/v1/workflows/{id}/restore',
        '/api/v1/workflows/{id}/promote',
        '/api/v1/workflows/{id}/trigger',
        '/api/v1/workflows/{id}/manual-runs',
        '/api/v1/workflows/{id}/test-runs',
        '/api/v1/workflows/{id}/cancel-runs',
        '/api/v1/workflow-versions',
        '/api/v1/workflow-versions/{id}',
        '/api/v1/workflow-versions/{id}/diff',
        '/api/v1/workflow-trigger-deliveries',
        '/api/v1/workflow-runs',
        '/api/v1/workflow-runs/{id}',
        '/api/v1/workflow-runs/{id}/steps',
        '/api/v1/workflow-runs/{id}/resume',
        '/api/v1/workflow-runs/{id}/rerun',
        '/api/v1/workflow-runs/{id}/cancel',
        '/api/v1/workflow-actions',
        '/api/v1/workflow-recipes',
        '/api/v1/workflow-recipes/{key}/install',
        '/api/v1/account-actions',
        '/api/v1/account-actions/{id}',
        '/api/v1/accounts/{id}/run-action',
        '/api/v1/accounts/{id}/available-actions',
      ]),
    );
  });
});

describe('the schemas (C112.6, C118.2)', () => {
  it('refuses another prefix on an id', async () => {
    expect((await call('GET', `/workflows/inq_${ULID}`)).statusCode).toBe(400);
    expect((await call('GET', `/workflow-runs/${WORKFLOW}`)).statusCode).toBe(400);
  });

  it('needs filter[workflow-id] on the version list', async () => {
    expect((await call('GET', '/workflow-versions')).statusCode).toBe(400);
  });

  it('refuses meta.params and top-level attributes on the trigger (public)', async () => {
    const url = `/workflows/${WORKFLOW}/trigger`;

    expect((await call('POST', url, { ...body({ fields: {} }), meta: {} })).statusCode).toBe(400);
    expect((await call('POST', url, body({ fields: {}, extra: 1 }))).statusCode).toBe(400);
  });

  it('takes a body past the default 1 MiB on the trigger route alone (C118.2)', async () => {
    const data = 'QUJD'.repeat(400_000);
    const large = body({ fields: { file: { filename: 'large.png', data } } });

    expect(
      (await call('POST', `/workflows/${WORKFLOW}/trigger`, large)).statusCode,
      'the trigger route',
    ).not.toBe(413);
    expect((await call('POST', '/workflows', large)).statusCode).toBe(413);
  });
});

describe('who holds what (C112.5, C121.2)', () => {
  it('keeps runs from viewers (NOT_FOR_VIEWERS)', async () => {
    const viewer = api.newUserToken(api.environmentId, {
      permissions: BUILTIN_ROLES.viewer.permissions,
    });

    expect(BUILTIN_ROLES.viewer.permissions).not.toContain('workflow-runs:read');
    expect((await call('GET', '/workflow-runs', undefined, viewer)).statusCode).toBe(403);
    expect((await call('GET', `/workflows/${WORKFLOW}/draft`, undefined, viewer)).statusCode).toBe(
      404,
    );
  });

  it('lets no developer redact a run', async () => {
    const developer = api.newUserToken(api.environmentId, {
      permissions: BUILTIN_ROLES.developer.permissions,
    });

    expect((await call('DELETE', `/workflow-runs/${RUN}`, undefined, developer)).statusCode).toBe(
      403,
    );
  });
});
