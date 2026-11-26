import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROLE_IDS,
  allRoles,
  builtinRole,
  customRole,
  listOf,
} from '../../components/operators/test-fixtures';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { grantableDocument } from '../../testing/routes/settings';
import { expectNotFound } from '../../testing/next-errors';
import RoleError from './[id]/error';
import RolePage, { metadata as roleMetadata } from './[id]/page';
import RolesError from './error';
import Loading from './loading';
import NewRolePage, { metadata as newRoleMetadata } from './new/page';
import RolesPage, { metadata } from './page';

vi.mock('./actions', () => ({ createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn() }));
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const ALL = [...PERMISSIONS];

function signedIn(permissions: readonly Permission[]): MockApi {
  return api.reply(200, meDocument({ permissions }));
}

describe('roles page', () => {
  async function renderList(searchParams: Record<string, string | string[] | undefined> = {}) {
    render(await RolesPage({ searchParams: Promise.resolve(searchParams) }));
  }

  it("lists the organization's roles, built-in and custom, each linked to its page", async () => {
    signedIn(ALL).reply(200, listOf(allRoles()));

    await renderList();

    expect(screen.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Roles' });
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    const support = within(table).getByRole('link', { name: 'Support' });
    expect(support).toHaveAttribute('href', `/roles/${ROLE_IDS.support}`);
    const supportRow = within(support.closest('tr') ?? table);
    expect(supportRow.getByText('Custom')).toBeVisible();
    expect(supportRow.getByText(`2 of ${String(PERMISSIONS.length)}`)).toBeVisible();
    const adminRow = within(
      within(table).getByRole('link', { name: 'Admin' }).closest('tr') ?? table,
    );
    expect(adminRow.getByText('Built-in')).toBeVisible();
    expect(
      adminRow.getByText(`${String(PERMISSIONS.length)} of ${String(PERMISSIONS.length)}`),
    ).toBeVisible();
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/roles' });
  });

  it('offers a new role with roles:write only', async () => {
    signedIn(ALL).reply(200, listOf(allRoles()));
    await renderList();
    expect(screen.getByRole('link', { name: 'New role' })).toHaveAttribute('href', '/roles/new');
  });

  it('offers no new role without roles:write', async () => {
    signedIn(['roles:read']).reply(200, listOf(allRoles()));
    await renderList();
    expect(screen.queryByRole('link', { name: 'New role' })).not.toBeInTheDocument();
  });

  it('pages forward with the C1 cursor', async () => {
    signedIn(ALL).reply(
      200,
      listOf(allRoles(), `/api/v1/dashboard/roles?page%5Bafter%5D=${ROLE_IDS.admin}`),
    );

    await renderList({ after: ROLE_IDS.support });

    expect(Object.fromEntries(api.last().query)).toMatchObject({
      'page[after]': ROLE_IDS.support,
    });
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/roles?after=${ROLE_IDS.admin}`,
    );
  });

  it('says when there is no role', async () => {
    signedIn(ALL).reply(200, listOf([]));
    await renderList();
    expect(screen.getByRole('table', { name: 'Roles' })).toHaveTextContent('No roles yet.');
  });

  it('shows the forbidden panel without roles:read', async () => {
    signedIn(['users:read']);
    await renderList();
    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Roles');
  });
});

describe('new role page', () => {
  it('offers the name and every permission, only those the operator holds enabled', async () => {
    signedIn(['roles:read', 'roles:write', 'inquiries:read']);
    // C167.4 (Workflow 9C): the editor reads what the API would grant.
    api.replyTo('GET /dashboard/roles/grantable', 200, grantableDocument(['inquiries:read']));

    render(<ToastProvider>{await NewRolePage()}</ToastProvider>);

    expect(screen.getByRole('heading', { level: 1, name: 'New role' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'View inquiries' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Redact inquiries' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create role' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Roles' })).toHaveAttribute('href', '/roles');
    expect(newRoleMetadata.title).toBe('New role');
  });

  it('shows the forbidden panel without roles:write', async () => {
    signedIn(['roles:read']);

    render(<ToastProvider>{await NewRolePage()}</ToastProvider>);

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(screen.getByText('roles:write')).toBeVisible();
  });
});

describe('role page', () => {
  async function renderRole(id: string) {
    render(<ToastProvider>{await RolePage({ params: Promise.resolve({ id }) })}</ToastProvider>);
  }

  /** `GET /dashboard/roles/:id` answers this role (C25.2). */
  const answerRole = (role: ReturnType<typeof customRole>) =>
    api.replyTo(`GET /dashboard/roles/${role.id}`, 200, { data: role });

  it('shows a built-in role read-only, with its permissions by area', async () => {
    signedIn(ALL);
    answerRole(builtinRole('reviewer'));

    await renderRole(ROLE_IDS.reviewer);

    expect(screen.getByRole('heading', { level: 1, name: 'Reviewer' })).toBeVisible();
    expect(screen.getByText('Built-in role. It cannot be changed or deleted.')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Personal data' })).toHaveTextContent(
      'View personal data and files',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete role' })).not.toBeInTheDocument();
  });

  it('edits and deletes a custom role with roles:write', async () => {
    signedIn(ALL);
    answerRole(customRole());
    // C167.4 (Workflow 9C): what the API would grant, and the users a removal reaches.
    api
      .replyTo('GET /dashboard/roles/grantable', 200, grantableDocument())
      .replyTo('GET /dashboard/users', 200, { data: [], links: { next: null } });

    await renderRole(ROLE_IDS.support);

    expect(screen.getByRole('heading', { level: 1, name: 'Support' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('Support');
    expect(screen.getByRole('checkbox', { name: 'View inquiries' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Delete role' }));
    expect(screen.getByRole('dialog', { name: 'Delete Support?' })).toHaveAccessibleDescription(
      'A role that users still hold cannot be deleted: give them other roles first.',
    );
  });

  it('shows a custom role read-only without roles:write', async () => {
    signedIn(['roles:read']);
    answerRole(customRole());

    await renderRole(ROLE_IDS.support);

    expect(screen.getByRole('list', { name: 'Inquiries' })).toHaveTextContent('View inquiries');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete role' })).not.toBeInTheDocument();
  });

  it('explains why a role with permissions the operator lacks cannot be edited or deleted by them (Workflow 2D K002)', async () => {
    signedIn(['roles:read', 'roles:write', 'inquiries:read']);
    answerRole(customRole({ permissions: ['inquiries:read', 'pii:view'] }));
    api.replyTo('GET /dashboard/roles/grantable', 200, grantableDocument(['inquiries:read']));

    await renderRole(ROLE_IDS.support);

    expect(
      screen.getByText(
        'You cannot change this role: it grants permissions you do not hold (pii:view).',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete role' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'You cannot delete this role: it grants permissions you do not hold (pii:view).',
      ),
    ).toBeVisible();
  });

  it('answers not found for a malformed id, without calling the API', async () => {
    await expectNotFound(RolePage({ params: Promise.resolve({ id: 'admin' }) }));
    expect(api.requests).toHaveLength(0);
  });

  it('answers not found when the API answers 404 for the role (C25.2)', async () => {
    signedIn(ALL).replyProblemTo(`GET /dashboard/roles/${ROLE_IDS.support}`, 404);

    await expectNotFound(RolePage({ params: Promise.resolve({ id: ROLE_IDS.support }) }));
  });

  it('is titled for the browser tab', () => {
    expect(roleMetadata.title).toBe('Role');
  });
});

describe('roles loading and error states', () => {
  it('announces that the roles are loading', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading roles…');
  });

  it('explains a failure of the list and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<RolesError error={new Error('internal')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The roles could not be loaded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('explains a failure of one role', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<RoleError error={new Error('internal')} retry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The role could not be loaded.');
  });
});
