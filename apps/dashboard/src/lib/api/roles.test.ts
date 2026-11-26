// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROLE_IDS,
  allRoles,
  builtinRole,
  customRole,
  listOf,
} from '../../components/operators/test-fixtures';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import { createRole, deleteRole, getRole, listAllRoles, listRoles, updateRole } from './roles';

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
  `/api/v1/dashboard/roles?page%5Bafter%5D=${after}&page%5Bsize%5D=100`;

describe('the roles API (C15)', () => {
  it('lists one page of roles', async () => {
    api.reply(200, listOf(allRoles()));

    const page = await listRoles({ after: ROLE_IDS.support });

    expect(page.data).toHaveLength(5);
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/roles' });
    expect(Object.fromEntries(api.last().query)).toEqual({
      'page[after]': ROLE_IDS.support,
      'page[size]': '50',
    });
  });

  it('reads every role, page by page', async () => {
    api
      .reply(200, listOf([customRole()], next(ROLE_IDS.support)))
      .reply(200, listOf([builtinRole('admin')]));

    const roles = await listAllRoles();

    expect(roles.map(({ id }) => id)).toEqual([ROLE_IDS.support, ROLE_IDS.admin]);
    expect(Object.fromEntries(api.requests[0]?.query ?? [])).toEqual({ 'page[size]': '100' });
    expect(Object.fromEntries(api.requests[1]?.query ?? [])).toEqual({
      'page[after]': ROLE_IDS.support,
      'page[size]': '100',
    });
  });

  it('stops after twenty pages', async () => {
    for (let page = 0; page < 20; page += 1) {
      api.reply(200, listOf([customRole()], next(ROLE_IDS.support)));
    }

    await expect(listAllRoles()).resolves.toHaveLength(20);
    expect(api.requests).toHaveLength(20);
  });

  it('reads one role with GET /dashboard/roles/:id (C25.2)', async () => {
    api.replyTo(`GET /dashboard/roles/${ROLE_IDS.reviewer}`, 200, {
      data: builtinRole('reviewer'),
    });

    await expect(getRole(ROLE_IDS.reviewer)).resolves.toEqual(builtinRole('reviewer'));
  });

  it("raises the API's 404 for a role the organization does not have (C25.2)", async () => {
    const unknown = 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y6Z';
    api.replyProblemTo(`GET /dashboard/roles/${unknown}`, 404);

    await expect(getRole(unknown)).rejects.toMatchObject({ status: 404 });
  });

  it('creates a custom role', async () => {
    api.reply(201, { data: customRole() });

    const role = await createRole({
      name: 'Support',
      permissions: ['inquiries:read', 'inquiries:write'],
    });

    expect(role.id).toBe(ROLE_IDS.support);
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/roles',
      body: {
        data: {
          type: 'role',
          attributes: { name: 'Support', permissions: ['inquiries:read', 'inquiries:write'] },
        },
      },
    });
  });

  it('changes a custom role', async () => {
    api.reply(200, { data: customRole({ name: 'Front desk' }) });

    const role = await updateRole(ROLE_IDS.support, { name: 'Front desk' });

    expect(role.attributes.name).toBe('Front desk');
    expect(api.last()).toMatchObject({
      method: 'PATCH',
      path: `/api/v1/dashboard/roles/${ROLE_IDS.support}`,
      body: { data: { type: 'role', attributes: { name: 'Front desk' } } },
    });
  });

  it('deletes a custom role (204)', async () => {
    api.reply(204);

    await expect(deleteRole(ROLE_IDS.support)).resolves.toBeUndefined();
    expect(api.last()).toMatchObject({
      method: 'DELETE',
      path: `/api/v1/dashboard/roles/${ROLE_IDS.support}`,
    });
  });

  it('raises the refusal to delete a role in use (409)', async () => {
    api.replyProblem(409);

    await expect(deleteRole(ROLE_IDS.support)).rejects.toBeInstanceOf(OpenVerifyApiError);
  });
});
