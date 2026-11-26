// @vitest-environment node
import { PERMISSIONS } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_IDS, customRole } from '../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import { createRole, deleteRole, updateRole } from './actions';

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

function form(values: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    for (const item of typeof value === 'string' ? [value] : value) {
      data.append(name, item);
    }
  }
  return data;
}

describe('createRole', () => {
  it('creates the role, then opens it', async () => {
    api.reply(200, admin()).reply(201, { data: customRole() });

    await expect(
      redirectTarget(
        createRole(
          null,
          form({ name: ' Support ', permissions: ['inquiries:read', 'inquiries:write'] }),
        ),
      ),
    ).resolves.toBe(`/roles/${ROLE_IDS.support}`);
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
    expect(revalidatePath).toHaveBeenCalledWith('/roles');
  });

  it('asks for a name and at least one permission, without calling the API', async () => {
    api.reply(200, admin());

    await expect(createRole(null, form({ name: '  ' }))).resolves.toEqual({
      ok: false,
      problem: {
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [
          { pointer: '/data/attributes/name', detail: 'Enter a name.' },
          { pointer: '/data/attributes/permissions', detail: 'Choose at least one permission.' },
        ],
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a permission that does not exist', async () => {
    api.reply(200, admin());

    await expect(
      createRole(null, form({ name: 'Support', permissions: ['inquiries:destroy'] })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/permissions/0' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses without roles:write, without calling the API', async () => {
    api.reply(200, meDocument({ permissions: ['roles:read'] }));

    await expect(
      createRole(null, form({ name: 'Support', permissions: ['inquiries:read'] })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.requests).toHaveLength(1);
  });

  it('shows a name already taken (409)', async () => {
    api.reply(200, admin()).replyProblem(409);

    await expect(
      createRole(null, form({ name: 'Admin', permissions: ['inquiries:read'] })),
    ).resolves.toMatchObject({ ok: false, problem: { status: 409 } });
  });
});

describe('updateRole', () => {
  it("changes the role's name and permissions, and refreshes its pages", async () => {
    api.reply(200, admin()).reply(200, { data: customRole({ name: 'Front desk' }) });

    await expect(
      updateRole(
        null,
        form({ 'role-id': ROLE_IDS.support, name: 'Front desk', permissions: ['inquiries:read'] }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.last()).toMatchObject({
      method: 'PATCH',
      path: `/api/v1/dashboard/roles/${ROLE_IDS.support}`,
      body: {
        data: { type: 'role', attributes: { name: 'Front desk', permissions: ['inquiries:read'] } },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/roles');
    expect(revalidatePath).toHaveBeenCalledWith(`/roles/${ROLE_IDS.support}`);
  });

  it('asks for a name and a permission', async () => {
    api.reply(200, admin());

    await expect(
      updateRole(null, form({ 'role-id': ROLE_IDS.support, name: '' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [{ pointer: '/data/attributes/name' }, { pointer: '/data/attributes/permissions' }],
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a malformed role id', async () => {
    api.reply(200, admin());

    await expect(
      updateRole(
        null,
        form({ 'role-id': 'admin', name: 'Admin', permissions: ['inquiries:read'] }),
      ),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/role-id' }] } });
  });

  it('shows the refusal to change a built-in role (409)', async () => {
    api.reply(200, admin()).replyProblem(409);

    await expect(
      updateRole(
        null,
        form({ 'role-id': ROLE_IDS.admin, name: 'Admin', permissions: ['inquiries:read'] }),
      ),
    ).resolves.toMatchObject({ ok: false, problem: { status: 409 } });
  });
});

describe('deleteRole', () => {
  it('deletes the role, then opens the list', async () => {
    api.reply(200, admin()).reply(204);

    await expect(
      redirectTarget(deleteRole(null, form({ 'role-id': ROLE_IDS.support }))),
    ).resolves.toBe('/roles');
    expect(api.last()).toMatchObject({
      method: 'DELETE',
      path: `/api/v1/dashboard/roles/${ROLE_IDS.support}`,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/roles');
  });

  it('shows the refusal to delete a role users still hold (409)', async () => {
    api.reply(200, admin()).replyProblem(409);

    await expect(deleteRole(null, form({ 'role-id': ROLE_IDS.support }))).resolves.toMatchObject({
      ok: false,
      problem: { status: 409, detail: 'Synthetic detail for 409.' },
    });
  });

  it('refuses a malformed role id without calling the API', async () => {
    api.reply(200, admin());

    await expect(deleteRole(null, form({ 'role-id': '' }))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/role-id' }] },
    });
    expect(api.requests).toHaveLength(1);
  });
});
