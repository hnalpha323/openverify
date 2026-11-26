// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import { SESSION_COOKIE } from '../session-cookie';
import { ForbiddenError } from './errors';
import { getSession, hasPermission, requirePermission, type DashboardSession } from './me';

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

describe('getSession', () => {
  it('reads the user, environment, permissions and MFA state from GET /dashboard/me', async () => {
    api.reply(
      200,
      meDocument({ permissions: ['inquiries:read', 'pii:view'], name: 'Synthetic Operator' }),
    );

    const session = await getSession();

    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/me' });
    expect(session.user).toEqual({
      id: IDS.user,
      email: 'operator@example.test',
      name: 'Synthetic Operator',
    });
    expect(session.environment).toEqual(ENVIRONMENTS.sandbox);
    expect([...session.permissions]).toEqual(['inquiries:read', 'pii:view']);
    expect(session.mfaSatisfied).toBe(true);
  });

  it('lists only the current environment while the API does not name the others', async () => {
    api.reply(200, meDocument({ environment: ENVIRONMENTS.production }));

    expect((await getSession()).environments).toEqual([ENVIRONMENTS.production]);
  });

  it("lists the organization's environments when the API sends them", async () => {
    api.reply(200, meDocument({ environments: [ENVIRONMENTS.sandbox, ENVIRONMENTS.production] }));

    expect((await getSession()).environments).toEqual([
      ENVIRONMENTS.sandbox,
      ENVIRONMENTS.production,
    ]);
  });

  it('keeps a session that has not satisfied required MFA, for the pages that allow it', async () => {
    api.reply(200, meDocument({ mfaSatisfied: false }));

    expect((await getSession()).mfaSatisfied).toBe(false);
  });

  it('sends the operator to sign in when the API no longer accepts the session', async () => {
    api.replyProblem(401);

    await expect(redirectTarget(getSession())).resolves.toBe('/login');
  });

  it('sends the operator to sign in without a session cookie, without calling the API', async () => {
    fakeRequest.cookies.clear();

    await expect(redirectTarget(getSession())).resolves.toBe('/login');
    expect(api.requests).toHaveLength(0);
  });

  it('fails clearly when the API sends no session context', async () => {
    const document = meDocument();
    delete document.meta;
    api.reply(200, document);

    await expect(getSession()).rejects.toThrow('GET /dashboard/me sent no session context');
  });
});

describe('hasPermission', () => {
  const session = {
    permissions: new Set(['inquiries:read', 'inquiries:write']),
  } as unknown as DashboardSession;

  it('is true when the session holds every permission given', () => {
    expect(hasPermission(session, 'inquiries:read')).toBe(true);
    expect(hasPermission(session, 'inquiries:read', 'inquiries:write')).toBe(true);
    expect(hasPermission(session)).toBe(true);
  });

  it('is false when any is missing', () => {
    expect(hasPermission(session, 'inquiries:read', 'inquiries:redact')).toBe(false);
  });
});

describe('requirePermission', () => {
  it('returns the session when it holds the permissions', async () => {
    api.reply(200, meDocument({ permissions: ['users:read'] }));

    await expect(requirePermission('users:read')).resolves.toMatchObject({
      user: { id: IDS.user },
    });
  });

  it('throws ForbiddenError naming what is missing, which pages render as the forbidden panel', async () => {
    api.reply(200, meDocument({ permissions: ['users:read'] }));

    const failure = requirePermission('users:read', 'users:write');

    await expect(failure).rejects.toBeInstanceOf(ForbiddenError);
    await expect(failure).rejects.toMatchObject({ permissions: ['users:write'] });
  });
});
