// @vitest-environment node
import { PERMISSIONS } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_IDS, USER_IDS, user } from '../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  endUserSessions,
  inviteUser,
  reactivateUser,
  readUserAssignments,
  resendInvitation,
  resetUserMfa,
  setUserStatus,
  startStepUpWebauthn,
  updateUserRoles,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  vi.mocked(revalidatePath).mockReset();
});

afterEach(() => {
  api.restore();
});

const admin = () => meDocument({ permissions: [...PERMISSIONS] });
const viewer = () => meDocument({ permissions: ['users:read', 'roles:read'] });

function form(values: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    for (const item of typeof value === 'string' ? [value] : value) {
      data.append(name, item);
    }
  }
  return data;
}

const INVITATION = {
  email: 'new@example.test',
  'role-ids': [ROLE_IDS.reviewer],
  'expires-at': '2026-10-27T04:35:00.000Z',
};

describe('inviteUser', () => {
  it('invites through the API and refreshes the list', async () => {
    api.reply(200, admin()).reply(201, INVITATION);

    await expect(
      inviteUser(null, form({ email: ' new@example.test ', 'role-ids': [ROLE_IDS.reviewer] })),
    ).resolves.toEqual({
      ok: true,
      data: { email: 'new@example.test', expiresAt: '2026-10-27T04:35:00.000Z' },
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/users/invitations',
      body: { email: 'new@example.test', 'role-ids': [ROLE_IDS.reviewer] },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('asks for an email address and at least one role, without calling the API', async () => {
    api.reply(200, admin());

    await expect(inviteUser(null, form({ email: 'not an email' }))).resolves.toEqual({
      ok: false,
      problem: {
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [
          { pointer: '/email', detail: 'Enter an email address, such as name@example.com.' },
          { pointer: '/role-ids', detail: 'Choose at least one role.' },
        ],
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses without users:write, without calling the API', async () => {
    api.reply(200, viewer());

    await expect(
      inviteUser(null, form({ email: 'new@example.test', 'role-ids': [ROLE_IDS.reviewer] })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.requests).toHaveLength(1);
  });

  it("shows the API's refusal of a role the operator may not grant (403), in its words (Workflow 2D K004)", async () => {
    api.reply(200, admin()).replyProblem(403, 'forbidden', {
      title: 'Forbidden',
      detail: 'You cannot grant permissions you do not hold: pii:view.',
    });

    await expect(
      inviteUser(null, form({ email: 'new@example.test', 'role-ids': [ROLE_IDS.admin] })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        title: 'Forbidden',
        detail: 'You cannot grant permissions you do not hold: pii:view.',
      },
    });
  });

  it('shows a conflict, such as an email already in use (409)', async () => {
    api.reply(200, admin()).replyProblem(409);

    await expect(
      inviteUser(null, form({ email: 'admin@example.test', 'role-ids': [ROLE_IDS.admin] })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title: 'Synthetic Problem', detail: 'Synthetic detail for 409.', status: 409 },
    });
  });

  it('sends a signed-out operator to sign in', async () => {
    api.reply(200, admin()).replyProblem(401);

    await expect(
      redirectTarget(
        inviteUser(null, form({ email: 'new@example.test', 'role-ids': [ROLE_IDS.viewer] })),
      ),
    ).resolves.toBe('/login');
  });
});

describe('resendInvitation (C168.1)', () => {
  it('posts the invited user to the resend route, which revokes the old link, and answers the new expiry', async () => {
    api.reply(200, admin()).reply(201, INVITATION);

    await expect(resendInvitation(null, form({ 'user-id': USER_IDS.invited }))).resolves.toEqual({
      ok: true,
      data: { email: 'new@example.test', expiresAt: '2026-10-27T04:35:00.000Z' },
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/invitations/${USER_IDS.invited}/resend`,
      body: {},
    });
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('refuses a malformed request without calling the API', async () => {
    api.reply(200, admin());

    await expect(
      resendInvitation(null, form({ email: 'new@example.test' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/user-id' }] } });
    expect(api.requests).toHaveLength(1);
  });

  it('says in words that the hourly resend limit was reached (429)', async () => {
    api.reply(200, admin()).replyProblem(429);

    await expect(
      resendInvitation(null, form({ 'user-id': USER_IDS.invited })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title: 'This invitation was resent 5 times in the last hour. Try again later.' },
    });
  });
});

const SANDBOX = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';

describe('updateUserRoles: assignments per environment (C167.2)', () => {
  it("replaces the user's assignments: each role everywhere or in the environment chosen", async () => {
    const assignments = [
      { 'role-id': ROLE_IDS.reviewer, 'environment-ids': [SANDBOX] },
      { 'role-id': ROLE_IDS.viewer, 'environment-ids': null },
    ];
    api.reply(200, admin()).reply(200, {
      data: { type: 'user-role-assignments', id: USER_IDS.reviewer, attributes: { assignments } },
    });

    await expect(
      updateUserRoles(
        null,
        form({
          'user-id': USER_IDS.reviewer,
          'role-ids': [ROLE_IDS.reviewer, ROLE_IDS.viewer],
          [`scope-${ROLE_IDS.reviewer}`]: SANDBOX,
          [`scope-${ROLE_IDS.viewer}`]: 'all',
        }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.last()).toMatchObject({
      method: 'PUT',
      path: `/api/v1/dashboard/users/${USER_IDS.reviewer}/roles`,
      body: { assignments },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('asks where each checked role applies, without calling the API', async () => {
    api.reply(200, admin());

    await expect(
      updateUserRoles(
        null,
        form({ 'user-id': USER_IDS.reviewer, 'role-ids': [ROLE_IDS.reviewer] }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [
          { pointer: `/scope-${ROLE_IDS.reviewer}`, detail: 'Choose where this role applies.' },
        ],
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('asks for at least one role', async () => {
    api.reply(200, admin());

    await expect(
      updateUserRoles(null, form({ 'user-id': USER_IDS.reviewer })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [{ pointer: '/data/attributes/role-ids', detail: 'Choose at least one role.' }],
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a malformed user id', async () => {
    api.reply(200, admin());

    await expect(
      updateUserRoles(
        null,
        form({
          'user-id': '../roles',
          'role-ids': [ROLE_IDS.viewer],
          [`scope-${ROLE_IDS.viewer}`]: 'all',
        }),
      ),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/user-id' }] } });
    expect(api.requests).toHaveLength(1);
  });

  it('says the API’s scope refusal in words (422 role_scope_invalid)', async () => {
    api.reply(200, admin()).replyProblem(422, undefined, { code: 'role_scope_invalid' });

    await expect(
      updateUserRoles(
        null,
        form({
          'user-id': USER_IDS.admin,
          'role-ids': [ROLE_IDS.admin],
          [`scope-${ROLE_IDS.admin}`]: SANDBOX,
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        title:
          'A role with the admin role or an organisation-level permission can only be granted in every environment.',
      },
    });
  });

  it('shows the last-active-admin refusal (409)', async () => {
    api.reply(200, admin()).replyProblem(409);

    await expect(
      updateUserRoles(
        null,
        form({
          'user-id': USER_IDS.admin,
          'role-ids': [ROLE_IDS.viewer],
          [`scope-${ROLE_IDS.viewer}`]: 'all',
        }),
      ),
    ).resolves.toMatchObject({ ok: false, problem: { status: 409 } });
  });
});

describe('setUserStatus', () => {
  it('deactivates a user', async () => {
    api
      .reply(200, admin())
      .reply(200, { data: user({ id: USER_IDS.reviewer, status: 'deactivated' }) });

    await expect(
      setUserStatus(null, form({ 'user-id': USER_IDS.reviewer, status: 'deactivated' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.last()).toMatchObject({
      method: 'PATCH',
      path: `/api/v1/dashboard/users/${USER_IDS.reviewer}`,
      body: { data: { type: 'user', attributes: { status: 'deactivated' } } },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('never reactivates through a status change: that goes through POST /reactivate (AC2)', async () => {
    api.reply(200, admin());

    await expect(
      setUserStatus(null, form({ 'user-id': USER_IDS.deactivated, status: 'active' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/status' }] } });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a status the dashboard cannot set', async () => {
    api.reply(200, admin());

    await expect(
      setUserStatus(null, form({ 'user-id': USER_IDS.reviewer, status: 'invited' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/status' }] } });
    expect(api.requests).toHaveLength(1);
  });

  it('shows the last-active-admin refusal (409)', async () => {
    api.reply(200, admin()).replyProblem(409);

    await expect(
      setUserStatus(null, form({ 'user-id': USER_IDS.admin, status: 'deactivated' })),
    ).resolves.toMatchObject({ ok: false, problem: { status: 409 } });
  });
});

/** A synthetic WebAuthn assertion, as the browser's `startAuthentication` answers. */
const ASSERTION = {
  id: 'Y3JlZGVudGlhbA',
  rawId: 'Y3JlZGVudGlhbA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  clientExtensionResults: {},
};
const KEY_OPTIONS = { challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', allowCredentials: [] };

describe('startStepUpWebauthn (C168.1; K9-11)', () => {
  it('asks the API for the passkey step-up options of the signed-in operator', async () => {
    api.reply(200, admin()).reply(200, { options: KEY_OPTIONS });

    await expect(startStepUpWebauthn()).resolves.toEqual({
      ok: true,
      data: { options: KEY_OPTIONS },
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/sessions/current/step-up/webauthn/options',
      body: {},
    });
  });

  it('needs users:write, and calls nothing without it', async () => {
    api.reply(200, viewer());

    await expect(startStepUpWebauthn()).resolves.toMatchObject({ ok: false });
    expect(api.requests).toHaveLength(1);
  });
});

const STEP_UP = {
  'mfa-verified-at': '2026-10-20T04:40:00.000Z',
  'step-up-expires-at': '2026-10-20T04:50:00.000Z',
};

describe.each([
  ['reactivateUser', reactivateUser, 'reactivate', USER_IDS.deactivated],
  ['resetUserMfa', resetUserMfa, 'reset-mfa', USER_IDS.reviewer],
] as const)('%s (C168.1, C168.3)', (_name, action, route, target) => {
  it(`posts the user to /${route} with an empty body`, async () => {
    api.reply(200, admin()).reply(200, { data: user({ id: target }) });

    await expect(action(null, form({ 'user-id': target }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/users/${target}/${route}`,
      body: {},
    });
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('verifies the code entered first, then acts', async () => {
    api
      .reply(200, admin())
      .reply(200, STEP_UP)
      .reply(200, { data: user({ id: target }) });

    await action(null, form({ 'user-id': target, 'totp-code': ' 123456 ' }));

    expect(api.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/v1/dashboard/me',
      'POST /api/v1/dashboard/sessions/current/step-up',
      `POST /api/v1/dashboard/users/${target}/${route}`,
    ]);
    expect(api.requests[1]?.body).toEqual({ 'totp-code': '123456' });
  });

  it('verifies a passkey assertion first, then acts (K9-11)', async () => {
    api
      .reply(200, admin())
      .reply(200, STEP_UP)
      .reply(200, { data: user({ id: target }) });

    await expect(
      action(null, form({ 'user-id': target, 'step-up-credential': JSON.stringify(ASSERTION) })),
    ).resolves.toEqual({ ok: true, data: undefined });

    expect(api.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/v1/dashboard/me',
      'POST /api/v1/dashboard/sessions/current/step-up',
      `POST /api/v1/dashboard/users/${target}/${route}`,
    ]);
    expect(api.requests[1]?.body).toEqual({ credential: ASSERTION });
  });

  it('says a refused passkey at its field, and does not act (K9-11)', async () => {
    api.reply(200, admin()).replyProblem(401, undefined, { code: 'mfa_code_invalid' });

    await expect(
      action(null, form({ 'user-id': target, 'step-up-credential': JSON.stringify(ASSERTION) })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/step-up-credential',
            detail: 'The security key or passkey was not accepted. Try it again, or enter a code.',
          },
        ],
      },
    });
    expect(api.requests).toHaveLength(2);
  });

  it('refuses something that is not an assertion without calling the API (K9-11)', async () => {
    api.reply(200, admin());

    await expect(
      action(null, form({ 'user-id': target, 'step-up-credential': '{"id":1}' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/step-up-credential' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a code that is not six digits without calling the API', async () => {
    api.reply(200, admin());

    await expect(
      action(null, form({ 'user-id': target, 'totp-code': '12ab' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/totp-code' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('says a refused code at the field, and does not act', async () => {
    api.reply(200, admin()).replyProblem(401, undefined, { code: 'mfa_code_invalid' });

    await expect(
      action(null, form({ 'user-id': target, 'totp-code': '123456' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/totp-code',
            detail: 'That code is not valid. Enter the current code from your authenticator app.',
          },
        ],
      },
    });
    expect(api.requests).toHaveLength(2);
  });

  it.each([
    [
      403,
      'step_up_required',
      'Confirm it is you first: enter a current code from your authenticator app below, then try again. An operator without a second factor of their own cannot do this.',
    ],
    [
      403,
      'user_more_privileged',
      'This user holds permissions you do not hold in an environment they can enter, so you cannot act on them.',
    ],
  ])('says the %i %s refusal in words', async (status, code, title) => {
    api.reply(200, admin()).replyProblem(status, undefined, { code });

    await expect(action(null, form({ 'user-id': target }))).resolves.toMatchObject({
      ok: false,
      problem: { title, code },
    });
  });

  it('refuses a malformed user id without calling the API', async () => {
    api.reply(200, admin());

    await expect(action(null, form({ 'user-id': 'nobody' }))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/user-id' }] },
    });
  });

  it('refuses without users:write, without calling the API', async () => {
    api.reply(200, viewer());

    await expect(action(null, form({ 'user-id': target }))).resolves.toMatchObject({ ok: false });
    expect(api.requests).toHaveLength(1);
  });
});

describe('reactivateUser: the mail it sends', () => {
  it.each([
    [409, 'Only a deactivated user can be reactivated.'],
    [
      502,
      'The new invitation could not be emailed, so the user was not reactivated. Try again later.',
    ],
    [
      503,
      'This installation cannot send email, so no new invitation could be sent and the user was not reactivated.',
    ],
  ])('says the %i refusal in words', async (status, title) => {
    api.reply(200, admin()).replyProblem(status);

    await expect(
      reactivateUser(null, form({ 'user-id': USER_IDS.deactivated })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title },
    });
  });
});

describe('resetUserMfa: never on oneself', () => {
  it('refuses the operator’s own id without calling the API', async () => {
    api.reply(200, admin());

    await expect(
      resetUserMfa(null, form({ 'user-id': 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y46' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You cannot reset your own second factor here. Use the Security page.' },
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('readUserAssignments (K9-22, DS8)', () => {
  const SANDBOX = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';

  it('reads where each role of the user applies today', async () => {
    api.reply(200, viewer()).reply(200, {
      data: {
        type: 'user-role-assignments',
        id: USER_IDS.reviewer,
        attributes: {
          assignments: [
            { 'role-id': ROLE_IDS.reviewer, 'environment-ids': [SANDBOX] },
            { 'role-id': ROLE_IDS.viewer, 'environment-ids': null },
          ],
        },
      },
    });

    await expect(readUserAssignments(USER_IDS.reviewer)).resolves.toEqual({
      ok: true,
      data: [
        { 'role-id': ROLE_IDS.reviewer, 'environment-ids': [SANDBOX] },
        { 'role-id': ROLE_IDS.viewer, 'environment-ids': null },
      ],
    });
    expect(api.last()).toMatchObject({
      method: 'GET',
      path: `/api/v1/dashboard/users/${USER_IDS.reviewer}/roles`,
    });
  });

  it('refuses a malformed user id before calling the API', async () => {
    api.reply(200, viewer());

    const result = await readUserAssignments('not-a-user');

    expect(result.ok).toBe(false);
    expect(api.requests.map(({ path }) => path)).toEqual(['/api/v1/dashboard/me']);
  });
});

describe('endUserSessions (C245.3, Workflow 11B)', () => {
  it('posts the user to /end-sessions with an empty body and refreshes the list', async () => {
    api.reply(200, admin()).reply(200, { 'sessions-ended': 2 });

    await expect(endUserSessions(null, form({ 'user-id': USER_IDS.reviewer }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/users/${USER_IDS.reviewer}/end-sessions`,
      body: {},
    });
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('refuses the operator’s own id without calling the API', async () => {
    api.reply(200, admin());

    await expect(
      endUserSessions(null, form({ 'user-id': 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y46' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        title:
          'You cannot end your own sessions here. Use Account, Sessions to end your other sessions.',
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('says in words when the API refuses a user above the operator', async () => {
    api.reply(200, admin()).reply(403, {
      type: 'https://openverify.dev/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'You can only act on a user whose permissions you hold.',
    });

    await expect(
      endUserSessions(null, form({ 'user-id': USER_IDS.reviewer })),
    ).resolves.toMatchObject({ ok: false });
  });

  it('needs users:write', async () => {
    api.reply(200, viewer());

    await expect(
      endUserSessions(null, form({ 'user-id': USER_IDS.reviewer })),
    ).resolves.toMatchObject({ ok: false });
    expect(api.requests).toHaveLength(1);
  });
});
