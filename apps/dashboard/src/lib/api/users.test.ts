// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROLE_IDS,
  USER_IDS,
  allUsers,
  listOf,
  user,
} from '../../components/operators/test-fixtures';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import { inviteUser, listUsers, updateUser, userDirectory } from './users';

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

const next = (after: string) =>
  `/api/v1/dashboard/users?page%5Bafter%5D=${after}&page%5Bsize%5D=100`;

describe('the users API (C15)', () => {
  it('lists one page of users with the session, newest first', async () => {
    api.reply(200, listOf(allUsers()));

    const page = await listUsers();

    expect(page.data.map(({ id }) => id)).toEqual(allUsers().map(({ id }) => id));
    const request = api.last();
    expect(request).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/users' });
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(Object.fromEntries(request.query)).toEqual({ 'page[size]': '25' });
  });

  it('sends the status filter and the cursor', async () => {
    api.reply(200, listOf([]));

    await listUsers({ status: 'invited', after: USER_IDS.reviewer });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[status]': 'invited',
      'page[after]': USER_IDS.reviewer,
      'page[size]': '25',
    });
  });

  it('invites a user by email with roles, and answers when the link expires', async () => {
    api.reply(201, {
      email: 'new@example.test',
      'role-ids': [ROLE_IDS.reviewer],
      'expires-at': '2026-10-27T04:35:00.000Z',
    });

    await expect(
      inviteUser({ email: 'new@example.test', 'role-ids': [ROLE_IDS.reviewer] }),
    ).resolves.toEqual({
      email: 'new@example.test',
      roleIds: [ROLE_IDS.reviewer],
      expiresAt: '2026-10-27T04:35:00.000Z',
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/users/invitations',
      body: { email: 'new@example.test', 'role-ids': [ROLE_IDS.reviewer] },
    });
  });

  it("changes a user's roles or status as a JSON:API document", async () => {
    api.reply(200, { data: user({ id: USER_IDS.reviewer, status: 'deactivated' }) });

    const updated = await updateUser(USER_IDS.reviewer, { status: 'deactivated' });

    expect(updated.attributes.status).toBe('deactivated');
    expect(api.last()).toMatchObject({
      method: 'PATCH',
      path: `/api/v1/dashboard/users/${USER_IDS.reviewer}`,
      body: { data: { type: 'user', attributes: { status: 'deactivated' } } },
    });
  });

  it("raises the API's refusal, such as the last active admin (409)", async () => {
    api.replyProblem(409);

    await expect(updateUser(USER_IDS.admin, { status: 'deactivated' })).rejects.toBeInstanceOf(
      OpenVerifyApiError,
    );
  });

  it('names operators by id across pages, for audit entries', async () => {
    const [admin, reviewer] = allUsers();
    api.reply(200, listOf([admin], next(USER_IDS.admin))).reply(200, listOf([reviewer]));

    const directory = await userDirectory();

    expect(directory.get(USER_IDS.admin)).toEqual({
      name: 'Synthetic Admin',
      email: 'admin@example.test',
    });
    expect(directory.get(USER_IDS.reviewer)?.email).toBe('reviewer@example.test');
    expect(api.requests).toHaveLength(2);
    expect(Object.fromEntries(api.requests[1]?.query ?? [])).toEqual({
      'page[after]': USER_IDS.admin,
      'page[size]': '100',
    });
  });

  it('reads at most five pages of operators', async () => {
    for (let page = 0; page < 5; page += 1) {
      api.reply(200, listOf([user()], next(USER_IDS.admin)));
    }

    const directory = await userDirectory();

    expect(directory.size).toBe(1);
    expect(api.requests).toHaveLength(5);
  });
});
