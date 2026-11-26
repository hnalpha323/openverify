/**
 * Workflow 9A Stage 1b, checkpoint (H): the theme plumbing `foundation-9a` freezes for `api-themes`
 * (Workflow 9B; C160, C174.4; review F04, V15):
 *
 * - the theme set routes (with the asset upload and the operators' asset content) and the flow's
 *   asset route, listed in the OpenAPI document and built by `api-themes` in Workflow 9B (their
 *   behaviour is tested in `routes/server/theme-sets.test.ts` and `theme-assets.test.ts`; here only
 *   that none answers 501 any more);
 * - the `theme-assets` policy, applied to the upload before anything else;
 * - a non-null theme set refused wherever one is named (a version at publish through
 *   `themeSetPublishProblems`, an inquiry at creation), since none can exist before 9B;
 * - `promoteThemeReferenceInTx`, which `api-templates`' promote calls.
 *
 * Every value is synthetic.
 */
import {
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_POLICY_WINDOWS,
  defaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnprocessableContentError } from './errors.js';
import type { RateLimiter } from './ports.js';
import { createInquiryTestApi, type InquiryTestApi } from './services/inquiries.test-support.js';
import { publishHookProblems } from './services/publish/index.js';
import { promoteThemeReferenceInTx } from './services/themes/promote.js';
import * as themePublish from './services/themes/publish.js';
import { bearer, createTemplate, openFlowSession } from './test-support/harness.js';

vi.mock('./services/themes/publish.js', { spy: true });

const SET = 'theset_01M5CK16P0D13FXHZSS4TCFBVH';
const ASSET = 'tsa_01M5CK16P0D13FXHZSS4TCFBVH';

/** Refuses only the keys of `policy`; every other count passes, as Valkey would. */
function refusing(policy: string): RateLimiter {
  return {
    consume: (key, rule) =>
      Promise.resolve({
        allowed: !key.startsWith(`${policy}:`),
        limit: rule.limit,
        remaining: 0,
        resetAt: new Date(0),
        retryAfterSeconds: key.startsWith(`${policy}:`) ? 30 : 0,
      }),
  };
}

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

const multipart = (boundary: string) =>
  `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo\r\n` +
  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\n` +
  `Content-Type: image/png\r\n\r\nsynthetic\r\n--${boundary}--\r\n`;

describe('the theme set routes, frozen for api-themes (C160.1, C160.5, C160.6)', () => {
  // Built by api-themes (Workflow 9B): an unknown id is 404, a list 200 and a new set 201.
  const frozen = [
    ['GET', '/theme-sets', undefined, 200],
    ['POST', '/theme-sets', { data: { type: 'theme-set', attributes: { name: 'Brand' } } }, 201],
    ['GET', `/theme-sets/${SET}`, undefined, 404],
    [
      'PATCH',
      `/theme-sets/${SET}`,
      { data: { type: 'theme-set', attributes: { name: 'B' } } },
      404,
    ],
    ['DELETE', `/theme-sets/${SET}`, undefined, 404],
    ['GET', `/theme-sets/${SET}/revisions`, undefined, 404],
    ['POST', `/theme-sets/${SET}/restore`, { meta: { revision: 1 } }, 404],
    ['GET', `/theme-sets/assets/${ASSET}/content`, undefined, 404],
  ] as const;

  it.each(frozen)('%s %s is built by api-themes', async (method, url, payload, status) => {
    const response = await api.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: bearer(api.token),
      ...(payload === undefined ? {} : { payload }),
    });
    expect(response.statusCode, response.body).toBe(status);
  });

  it('takes an asset upload as multipart, typed by its bytes (415 for these)', async () => {
    const boundary = 'synthetic-boundary';
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/theme-sets/assets',
      headers: {
        ...bearer(api.token),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart(boundary),
    });
    expect(response.statusCode, response.body).toBe(415);
  });

  it('answers the flow’s asset read with a session (404 for an unknown one), 401 without', async () => {
    const { sessionToken } = await openFlowSession(api);
    const url = `/api/v1/flow/theme-assets/${ASSET}`;

    const withSession = await api.app.inject({ url, headers: bearer(sessionToken) });
    const without = await api.app.inject({ url });

    expect([withSession.statusCode, without.statusCode]).toEqual([404, 401]);
  });

  it('lists them in the OpenAPI document', async () => {
    const { paths } = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();

    expect(Object.keys(paths['/api/v1/theme-sets'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(paths['/api/v1/theme-sets/{id}'] ?? {}).sort()).toEqual([
      'delete',
      'get',
      'patch',
    ]);
    for (const path of [
      '/api/v1/theme-sets/{id}/revisions',
      '/api/v1/theme-sets/{id}/restore',
      '/api/v1/theme-sets/assets',
      '/api/v1/theme-sets/assets/{id}/content',
      '/api/v1/flow/theme-assets/{id}',
    ]) {
      expect(paths, path).toHaveProperty([path]);
    }
  });
});

describe('the theme-assets policy (C174.4)', () => {
  it('is 30 an hour per environment, and refuses an upload with 429 before anything else', async () => {
    const policy = 'theme-assets';
    expect((RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>)[policy]).toBe(30);
    expect((RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>)[policy]).toBe(3600);
    const limited = await createInquiryTestApi({ rateLimiter: refusing(policy) });
    try {
      const boundary = 'synthetic-boundary';
      const response = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/theme-sets/assets',
        headers: {
          ...bearer(limited.token),
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipart(boundary),
      });

      expect(response.statusCode, response.body).toBe(429);
      expect(response.headers['retry-after']).toBe('30');
    } finally {
      await limited.close();
    }
  });
});

describe('a theme set named before 9B builds them (C160.7)', () => {
  it('is refused on an inquiry, and nothing is created', async () => {
    const templateId = await createTemplate(api);

    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: bearer(api.token),
      payload: { data: { attributes: { 'inquiry-template-id': templateId, 'theme-set-id': SET } } },
    });

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ pointer: '/data/attributes/theme-set-id' }],
    });
  });

  it('is refused at publish through themeSetPublishProblems, beside the publish hooks', async () => {
    const flow: Flow = defaultInquiryTemplateAttributes().flow;
    const context = {
      deps: api.deps,
      db: api.database.db,
      environment: { id: api.environmentId, kind: 'sandbox' as const },
      flow,
      config: {},
    };

    await expect(publishHookProblems({ ...context, themeSetId: null })).resolves.toEqual([]);
    const refused = await publishHookProblems({ ...context, themeSetId: SET }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(UnprocessableContentError);
    expect((refused as UnprocessableContentError).errors).toEqual([
      expect.objectContaining({ pointer: '/data/attributes/theme-set-id' }),
    ]);
    expect(themePublish.themeSetPublishProblems).toHaveBeenCalledWith(api.database.db, {
      environmentId: api.environmentId,
      themeSetId: SET,
    });
  });

  it('is promoted as none, and an unknown one is unresolved', async () => {
    const reference = {
      sourceEnvironmentId: api.environmentId,
      targetEnvironmentId: api.environmentId,
      actor: { type: 'user' as const, id: 'usr_01M5CK16P0D13FXHZSS4TCFBVH' },
      mayWriteThemeSets: true,
    };

    await expect(
      promoteThemeReferenceInTx(api.database.db, { ...reference, themeSetId: null }),
    ).resolves.toEqual({ themeSetId: null, copied: false });
    await expect(
      promoteThemeReferenceInTx(api.database.db, { ...reference, themeSetId: SET }),
    ).rejects.toMatchObject({ code: 'promote_unresolved' });
  });
});
