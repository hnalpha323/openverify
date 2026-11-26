// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import { switchEnvironment } from './environment';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const form = (id: string) => {
  const data = new FormData();
  data.set('environment-id', id);
  return data;
};

const developer = () =>
  meDocument({
    permissions: ['inquiries:read', 'environments:production'],
    environments: [ENVIRONMENTS.sandbox, ENVIRONMENTS.production],
  });

describe('switchEnvironment', () => {
  it('switches the session through the API, then opens the console in the new environment', async () => {
    api
      .replyTo('GET /dashboard/me', 200, developer())
      .replyTo('PUT /dashboard/sessions/current/environment', 200, {
        environment: ENVIRONMENTS.production,
      });

    await expect(
      redirectTarget(switchEnvironment(null, form(ENVIRONMENTS.production.id))),
    ).resolves.toBe('/');

    expect(api.last()).toMatchObject({
      method: 'PUT',
      path: '/api/v1/dashboard/sessions/current/environment',
      body: { 'environment-id': ENVIRONMENTS.production.id },
    });
  });

  it('refuses production without environments:production, without calling the API', async () => {
    api.reply(
      200,
      meDocument({
        permissions: ['inquiries:read'],
        environments: [ENVIRONMENTS.sandbox, ENVIRONMENTS.production],
      }),
    );

    await expect(switchEnvironment(null, form(ENVIRONMENTS.production.id))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a malformed environment id', async () => {
    api.reply(200, developer());

    await expect(switchEnvironment(null, form('production'))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'Check the values you entered', errors: [{ pointer: '/environment-id' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it("shows the API's refusal in its own words (Workflow 2D K004)", async () => {
    api
      .replyTo('GET /dashboard/me', 200, developer())
      .replyProblemTo('PUT /dashboard/sessions/current/environment', 403, 'forbidden', {
        title: 'Forbidden',
        detail: 'The user is missing the required permission: environments:production.',
      });

    await expect(switchEnvironment(null, form(ENVIRONMENTS.production.id))).resolves.toMatchObject({
      ok: false,
      problem: {
        title: 'Forbidden',
        detail: 'The user is missing the required permission: environments:production.',
      },
    });
  });

  it('says in words that the account holds no role in that environment, never which roles exist (C167.2; K9-9)', async () => {
    api
      .replyTo('GET /dashboard/me', 200, developer())
      .replyProblemTo('PUT /dashboard/sessions/current/environment', 403, 'forbidden', {
        code: 'no_environment_role',
        title: 'Forbidden',
        detail: 'You hold no role in this environment.',
      });

    const result = await switchEnvironment(null, form(ENVIRONMENTS.production.id));

    expect(result).toMatchObject({ ok: false, problem: { code: 'no_environment_role' } });
    const problem = result.ok ? undefined : result.problem;
    expect(problem?.title).toBe(
      'Your account holds no role in that environment. Ask an administrator of your organization to give you a role there.',
    );
    expect(problem?.detail).toBeUndefined();
  });
});
