/**
 * C121.3 (V04, V21): the auth plugin puts the request's principal into the event cause context. A
 * handler reads it after the body parser, so the store survives the parser's own async context.
 * Public routes, the flow and anything unauthenticated carry no cause.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { currentEventCause } from '../events/cause-context.js';
import type { ApiKeyRecord } from './principal-auth.js';

const TOKEN = 'ov_sbx_SyntheticTestTokenAAAAAAAAAAAAAAAAAAAAAAAAA';

const key = (scopes: readonly string[]): ApiKeyRecord => ({
  id: 'key_01J8ZZZZZZZZZZZZZZZZZZZZZZ',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  scopes,
  expiresAt: null,
  revokedAt: null,
});

type App = ReturnType<typeof buildApp>;
const apps: App[] = [];

function appWith(scopes: readonly string[]) {
  const app = buildApp({
    mode: 'test',
    lookupApiKey: (token) => Promise.resolve(token === TOKEN ? key(scopes) : null),
    resolveUserSession: () =>
      Promise.resolve({
        kind: 'user',
        userId: 'usr_01J8ZZZZZZZZZZZZZZZZZZZZZZ',
        userSessionId: 'uses_1',
        organizationId: 'org_1',
        environmentId: 'env_1',
        environmentKind: 'sandbox',
        permissions: new Set(['inquiries:read']),
        mfaSatisfied: true,
      }),
  });
  apps.push(app);
  const reply = () => ({ cause: currentEventCause() ?? null });
  app.post('/probe', reply);
  app.post('/public-probe', { config: { public: true } }, reply);
  app.post('/flow-probe', { config: { auth: 'session-token' } }, reply);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const post = (app: App, url: string, authorization?: string) =>
  app.inject({
    method: 'POST',
    url,
    headers: authorization === undefined ? {} : { authorization: `Bearer ${authorization}` },
    payload: { synthetic: true },
  });

describe('the request’s event cause (C121.3)', () => {
  it('names an API key and whether it held inquiries:write, past the body parser', async () => {
    const response = await post(appWith(['inquiries:write']), '/probe', TOKEN);

    expect(response.json()).toEqual({
      cause: {
        principal: 'key_01J8ZZZZZZZZZZZZZZZZZZZZZZ',
        principalHeldInquiriesWrite: true,
      },
    });
  });

  it('says a key without it did not hold it', async () => {
    const response = await post(appWith(['inquiries:read']), '/probe', TOKEN);

    expect(response.json()).toEqual({
      cause: {
        principal: 'key_01J8ZZZZZZZZZZZZZZZZZZZZZZ',
        principalHeldInquiriesWrite: false,
      },
    });
  });

  it('names a user, not the session', async () => {
    const response = await post(appWith([]), '/probe', 'ovu_synthetic');

    expect(response.json()).toEqual({
      cause: {
        principal: 'usr_01J8ZZZZZZZZZZZZZZZZZZZZZZ',
        principalHeldInquiriesWrite: false,
      },
    });
  });

  it('is empty on a public route', async () => {
    const response = await post(appWith([]), '/public-probe');

    expect(response.json()).toEqual({ cause: {} });
  });

  it('is empty on a route another hook authenticates: the end user’s flow', async () => {
    const response = await post(appWith([]), '/flow-probe');

    expect(response.json()).toEqual({ cause: {} });
  });

  it('never crosses requests', async () => {
    const app = appWith(['inquiries:write']);

    const [first, second] = await Promise.all([
      post(app, '/probe', TOKEN),
      post(app, '/public-probe'),
    ]);

    expect(first.json()).toMatchObject({ cause: { principalHeldInquiriesWrite: true } });
    expect(second.json()).toEqual({ cause: {} });
  });
});
