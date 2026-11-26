import { PERMISSIONS } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customRole, listOf, user } from '../../components/operators/test-fixtures';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ROLE_IDS,
  SETTINGS_IDS,
  grantableDocument,
  grantableScope,
} from '../../testing/routes/settings';
import RolePage from './[id]/page';
import NewRolePage from './new/page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('./actions', () => ({ createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  api = routeApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const ENVIRONMENT_LIST = [ENVIRONMENTS.sandbox, ENVIRONMENTS.production];
/** The editor holds pii:view in the sandbox only. */
const GRANTABLE = grantableDocument(PERMISSIONS, [
  grantableScope(SETTINGS_IDS.sandbox),
  grantableScope(
    SETTINGS_IDS.production,
    PERMISSIONS.filter((permission) => permission !== 'pii:view'),
  ),
  grantableScope(null),
]);

describe('the role editor pages (C167.4)', () => {
  it('offers on a new role only what the API would grant, saying where the editor lacks a permission', async () => {
    api.me({ permissions: [...PERMISSIONS], environments: ENVIRONMENT_LIST });
    api.on('GET', '/dashboard/roles/grantable', 200, GRANTABLE);

    render(<ToastProvider>{await NewRolePage()}</ToastProvider>);

    expect(screen.getByRole('checkbox', { name: /^View personal data/u })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: /^View personal data/u }),
    ).toHaveAccessibleDescription(
      expect.stringContaining('You do not hold it in Production, so you cannot grant it.'),
    );
  });

  it('counts the users who hold a role being edited, for the removal confirmation', async () => {
    const role = customRole({ permissions: ['inquiries:read'] });
    api.me({ permissions: [...PERMISSIONS], environments: ENVIRONMENT_LIST });
    api.on('GET', `/dashboard/roles/${role.id}`, 200, { data: role });
    api.on('GET', '/dashboard/roles/grantable', 200, GRANTABLE);
    api.on(
      'GET',
      '/dashboard/users',
      200,
      listOf([
        user({ roleIds: [role.id] }),
        user({ id: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y74', roleIds: [ROLE_IDS.admin] }),
      ]),
    );

    render(
      <ToastProvider>{await RolePage({ params: Promise.resolve({ id: role.id }) })}</ToastProvider>,
    );

    expect(screen.getByRole('checkbox', { name: 'View inquiries' })).toBeChecked();
    expect(api.requests.some((request) => request.path === '/dashboard/users')).toBe(true);
  });
});
