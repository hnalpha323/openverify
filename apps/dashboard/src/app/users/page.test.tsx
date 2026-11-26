import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROLE_IDS,
  USER_IDS,
  allRoles,
  allUsers,
  listOf,
  user,
} from '../../components/operators/test-fixtures';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { IDS, SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { grantableDocument } from '../../testing/routes/settings';
import UsersError from './error';
import Loading from './loading';
import UsersPage, { metadata } from './page';

vi.mock('./actions', () => ({
  inviteUser: vi.fn(),
  resendInvitation: vi.fn(),
  updateUserRoles: vi.fn(),
  setUserStatus: vi.fn(),
  reactivateUser: vi.fn(),
  readUserAssignments: vi.fn(),
  resetUserMfa: vi.fn(),
  startStepUpWebauthn: vi.fn(),
  endUserSessions: vi.fn(),
}));
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

/** Queues `GET /dashboard/me` for an operator with `permissions`; queue the page's answers next. */
function signedIn(permissions: readonly Permission[]): MockApi {
  return api.reply(200, meDocument({ permissions }));
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(
    <ToastProvider>
      {await UsersPage({ searchParams: Promise.resolve(searchParams) })}
    </ToastProvider>,
  );
}

const rowOf = (name: string) => {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr');
  if (row === null) {
    throw new Error(`No row for ${name}`);
  }
  return within(row);
};

describe('users page', () => {
  it("lists the organization's users with their status and roles", async () => {
    signedIn(ALL)
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Users' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    const admin = rowOf('Synthetic Admin');
    expect(admin.getByText('admin@example.test')).toBeVisible();
    expect(admin.getByText('Active')).toBeVisible();
    expect(admin.getByText('Admin')).toBeVisible();
    expect(rowOf('invited@example.test').getByText('Invited')).toBeVisible();
    expect(rowOf('invited@example.test').getByText('Viewer')).toBeVisible();
    expect(rowOf('Synthetic Former').getByText('Deactivated')).toBeVisible();
    expect(rowOf('Synthetic Former').getByText('Support')).toBeVisible();

    expect(api.requests.map(({ path }) => path)).toEqual([
      '/api/v1/dashboard/me',
      '/api/v1/dashboard/users',
      '/api/v1/dashboard/roles',
      // C167.2 (Workflow 9C): where each role may be assigned.
      '/api/v1/dashboard/roles/grantable',
    ]);
  });

  it('shows whether each user has MFA on, and a dash when the API does not say', async () => {
    const users = [
      user({ mfaEnabled: true }),
      user({
        id: USER_IDS.reviewer,
        email: 'reviewer@example.test',
        name: 'Synthetic Reviewer',
        mfaEnabled: false,
      }),
      user({ id: USER_IDS.invited, email: 'invited@example.test', name: null, status: 'invited' }),
    ];
    signedIn(ALL)
      .reply(200, listOf(users))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();

    expect(screen.getByRole('columnheader', { name: 'MFA' })).toBeVisible();
    expect(rowOf('Synthetic Admin').getByText('On')).toBeVisible();
    expect(rowOf('Synthetic Reviewer').getByText('Off')).toBeVisible();
    const invited = rowOf('invited@example.test');
    expect(invited.queryByText('On')).not.toBeInTheDocument();
    expect(invited.queryByText('Off')).not.toBeInTheDocument();
    expect(invited.getAllByText('None').length).toBeGreaterThan(0);
  });

  it('offers inviting, role changes and status changes to an operator with users:write', async () => {
    signedIn(ALL)
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();

    expect(screen.getByRole('button', { name: 'Invite a user' })).toBeVisible();
    const reviewer = rowOf('Synthetic Reviewer');
    expect(
      reviewer.getByRole('button', { name: 'Edit roles of Synthetic Reviewer' }),
    ).toBeVisible();
    expect(reviewer.getByRole('button', { name: 'Deactivate Synthetic Reviewer' })).toBeVisible();
    const former = rowOf('Synthetic Former');
    expect(former.getByRole('button', { name: 'Reactivate Synthetic Former' })).toBeVisible();
    expect(former.queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
    // An invited user becomes active by accepting; their link can be sent again.
    const invited = rowOf('invited@example.test');
    expect(
      invited.getByRole('button', { name: 'Resend the invitation to invited@example.test' }),
    ).toBeVisible();
    expect(invited.queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
  });

  it('warns an operator that deactivating themselves signs them out', async () => {
    signedIn(ALL)
      .reply(200, listOf([user({ id: IDS.user, name: 'Synthetic Operator' }), ...allUsers()]))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate Synthetic Operator' }));

    expect(
      screen.getByRole('dialog', { name: 'Deactivate Synthetic Operator?' }),
    ).toHaveAccessibleDescription(
      'This is you: you are signed out at once and can no longer sign in.',
    );
  });

  it('explains what deactivating someone else does', async () => {
    signedIn(ALL)
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate Synthetic Reviewer' }));

    expect(
      screen.getByRole('dialog', { name: 'Deactivate Synthetic Reviewer?' }),
    ).toHaveAccessibleDescription(
      'They are signed out at once and can no longer sign in. You can reactivate them later.',
    );
  });

  it('shows the list read-only without users:write', async () => {
    signedIn(['users:read', 'roles:read'])
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()));

    await renderPage();

    expect(screen.queryByRole('button', { name: 'Invite a user' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit roles/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('names roles by ID and offers no role changes without roles:read', async () => {
    signedIn(['users:read', 'users:write']).reply(200, listOf(allUsers()));

    await renderPage();

    expect(rowOf('Synthetic Reviewer').getByText(ROLE_IDS.reviewer)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Invite a user' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit roles/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Synthetic Reviewer' })).toBeVisible();
    expect(api.requests).toHaveLength(2);
  });

  it('explains instead of offering a status change for a user with permissions the operator lacks (Workflow 2D K002)', async () => {
    // Users, roles and every inquiry permission, but not pii:view, which reviewers hold.
    signedIn(['users:read', 'users:write', 'roles:read', 'inquiries:read', 'inquiries:write'])
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();

    const reviewer = rowOf('Synthetic Reviewer');
    expect(reviewer.queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(
      reviewer.getByText(
        'You cannot deactivate or reactivate Synthetic Reviewer: Reviewer includes permissions you do not hold.',
      ),
    ).toBeVisible();
    // Support grants only inquiry permissions, which the operator holds.
    expect(
      rowOf('Synthetic Former').getByRole('button', { name: 'Reactivate Synthetic Former' }),
    ).toBeVisible();
  });

  it('offers no invitation when the operator may grant no role', async () => {
    signedIn(['users:read', 'users:write', 'roles:read'])
      .reply(200, listOf(allUsers()))
      .reply(200, listOf([allRoles()[4]].filter((role) => role !== undefined)))
      .reply(200, grantableDocument());

    await renderPage();

    expect(screen.queryByRole('button', { name: 'Invite a user' })).not.toBeInTheDocument();
  });

  it('filters by status, kept in the URL', async () => {
    signedIn(ALL)
      .reply(200, listOf([allUsers()[2]].filter((item) => item !== undefined)))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage({ status: 'invited' });

    expect(Object.fromEntries(api.requests[1]?.query ?? [])).toMatchObject({
      'filter[status]': 'invited',
    });
    const filters = screen.getByRole('search', { name: 'Filter users' });
    expect(within(filters).getByLabelText('Status')).toHaveValue('invited');
    expect(within(filters).getByRole('button', { name: 'Apply filter' })).toBeVisible();
  });

  it('ignores an unknown status and a malformed cursor in the URL', async () => {
    signedIn(ALL)
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage({ status: 'everyone', after: 'usr_bad' });

    expect(Object.fromEntries(api.requests[1]?.query ?? [])).toEqual({ 'page[size]': '25' });
  });

  it('says when no user matches the filter', async () => {
    signedIn(ALL)
      .reply(200, listOf([]))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage({ status: 'deactivated' });

    expect(screen.getByRole('table', { name: 'Users' })).toHaveTextContent(
      'No users match this filter.',
    );
  });

  it('pages forward with the C1 cursor and keeps the filter', async () => {
    signedIn(ALL)
      .reply(
        200,
        listOf(allUsers(), `/api/v1/dashboard/users?page%5Bafter%5D=${USER_IDS.deactivated}`),
      )
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage({ status: 'active', after: USER_IDS.admin });

    expect(Object.fromEntries(api.requests[1]?.query ?? [])).toMatchObject({
      'page[after]': USER_IDS.admin,
    });
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/users?status=active&after=${USER_IDS.deactivated}`,
    );
    expect(within(pagination).getByRole('link', { name: 'First page' })).toHaveAttribute(
      'href',
      '/users?status=active',
    );
  });

  it('shows the forbidden panel without users:read, without listing anything', async () => {
    signedIn(['inquiries:read']);
    await renderPage();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(screen.getByText('users:read')).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Users');
  });
});

describe('users loading and error states', () => {
  it('announces that the users are loading', () => {
    render(<Loading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading users…');
  });

  it('explains a failure and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<UsersError error={new Error('internal')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The users could not be loaded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('users page: Workflow 9C (C168)', () => {
  const withFactors = (overrides: Parameters<typeof user>[0], extra: Record<string, unknown>) => {
    const made = user(overrides);
    return { ...made, attributes: { ...made.attributes, ...extra } };
  };

  it('shows each user’s factor kinds and last sign-in to an operator with users:write', async () => {
    signedIn(ALL)
      .reply(
        200,
        listOf([
          withFactors(
            { mfaEnabled: true },
            {
              'mfa-factors': [
                { kind: 'totp', count: 1 },
                { kind: 'webauthn', count: 2 },
              ],
              'last-sign-in-at': '2026-10-20T04:40:00.000Z',
            },
          ),
          withFactors(
            {
              id: USER_IDS.reviewer,
              email: 'reviewer@example.test',
              name: 'Synthetic Reviewer',
              mfaEnabled: false,
            },
            { 'mfa-factors': [], 'last-sign-in-at': null },
          ),
        ]),
      )
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();

    expect(screen.getByRole('columnheader', { name: 'Last sign-in (UTC)' })).toBeVisible();
    const admin = rowOf('Synthetic Admin');
    expect(admin.getByText('Authenticator app (1), security key or passkey (2)')).toBeVisible();
    expect(rowOf('Synthetic Reviewer').getByText('Never')).toBeVisible();
  });

  it('shows no MFA or sign-in columns without users:write (C168.5)', async () => {
    signedIn(['users:read', 'roles:read'])
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()));

    await renderPage();

    expect(screen.queryByRole('columnheader', { name: 'MFA' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Last sign-in (UTC)' }),
    ).not.toBeInTheDocument();
  });

  it('reactivates through a new invitation with no role back, asking for a code in the dialog', async () => {
    signedIn(ALL)
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate Synthetic Former' }));

    const dialog = screen.getByRole('dialog', { name: 'Reactivate Synthetic Former?' });
    expect(dialog).toHaveAccessibleDescription(
      'They get a new invitation by email, valid 7 days, and keep their history. No role comes back: grant their roles again once they accept.',
    );
    expect(
      within(dialog).getByRole('textbox', { name: 'Code from your authenticator app' }),
    ).toHaveAttribute('autocomplete', 'one-time-code');
    // K9-11: an operator whose only factor is a passkey can confirm with it.
    expect(
      within(dialog).getByRole('button', { name: 'Use a security key or passkey' }),
    ).toBeVisible();
  });

  it('offers an MFA reset for another user with a factor, never for oneself', async () => {
    signedIn(ALL)
      .reply(
        200,
        listOf([
          user({ id: IDS.user, name: 'Synthetic Operator', mfaEnabled: true }),
          user({
            id: USER_IDS.reviewer,
            email: 'reviewer@example.test',
            name: 'Synthetic Reviewer',
            mfaEnabled: true,
          }),
          user({
            id: USER_IDS.admin,
            email: 'admin@example.test',
            name: 'Synthetic Admin',
            mfaEnabled: false,
          }),
        ]),
      )
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();

    expect(
      rowOf('Synthetic Operator').queryByRole('button', { name: /Reset the second factor/ }),
    ).toBeNull();
    expect(
      rowOf('Synthetic Admin').queryByRole('button', { name: /Reset the second factor/ }),
    ).toBeNull();
    await userEvent.click(
      rowOf('Synthetic Reviewer').getByRole('button', {
        name: 'Reset the second factor of Synthetic Reviewer',
      }),
    );
    expect(
      within(
        screen.getByRole('dialog', { name: 'Reset the second factor of Synthetic Reviewer?' }),
      ).getByRole('button', { name: 'Use a security key or passkey' }),
    ).toBeVisible();
    expect(
      screen.getByRole('dialog', { name: 'Reset the second factor of Synthetic Reviewer?' }),
    ).toHaveAccessibleDescription(
      'Removes their authenticator apps, security keys and recovery codes and signs them out everywhere. If the organization requires a second factor, they add a new one at their next sign-in.',
    );
  });
});

describe('users page: effective permissions (K9-22, DS8)', () => {
  const SANDBOX = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';
  const PRODUCTION = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52';
  const READER: Permission[] = ['users:read', 'roles:read'];
  const effective = {
    data: {
      type: 'user-effective-permissions',
      id: USER_IDS.reviewer,
      attributes: {
        organization: ['users:read'],
        environments: [
          { 'environment-id': SANDBOX, 'may-enter': true, permissions: ['cases:read'] },
          { 'environment-id': PRODUCTION, 'may-enter': false, permissions: [] },
        ],
      },
    },
  };

  it('links each user to their effective permissions, keeping the list’s filter', async () => {
    signedIn(READER).reply(200, listOf(allUsers())).reply(200, listOf(allRoles()));

    await renderPage({ status: 'active' });

    const link = rowOf('Synthetic Reviewer').getByRole('link', {
      name: 'Effective permissions of Synthetic Reviewer',
    });
    expect(link).toHaveAttribute('href', `/users?status=active&permissions=${USER_IDS.reviewer}`);
  });

  it('shows what the user holds organisation-wide and in each environment, and where they cannot enter', async () => {
    api
      .reply(
        200,
        meDocument({
          permissions: READER,
          environments: [ENVIRONMENTS.sandbox, ENVIRONMENTS.production],
        }),
      )
      .reply(200, listOf(allUsers()))
      .reply(200, listOf(allRoles()))
      .reply(200, effective);

    await renderPage({ permissions: USER_IDS.reviewer });

    expect(api.requests.map(({ path }) => path)).toContain(
      `/api/v1/dashboard/users/${USER_IDS.reviewer}/permissions`,
    );
    const section = screen.getByRole('region', {
      name: 'Effective permissions of Synthetic Reviewer',
    });
    const organisation = within(section).getByRole('list', { name: 'Organisation-wide' });
    expect(organisation).toHaveTextContent('users:read');
    const sandbox = within(section).getByRole('list', { name: 'Sandbox' });
    expect(sandbox).toHaveTextContent('cases:read');
    expect(section).toHaveTextContent('Sandbox: can enter');
    expect(section).toHaveTextContent('Production: cannot enter');
    expect(section).toHaveTextContent('Production: holds no permission here.');
  });

  it('reads nothing more for a malformed user id', async () => {
    signedIn(READER).reply(200, listOf(allUsers())).reply(200, listOf(allRoles()));

    await renderPage({ permissions: 'not-a-user' });

    expect(api.requests).toHaveLength(3);
    expect(screen.queryByRole('region', { name: /Effective permissions/ })).toBeNull();
  });
});

describe('users page: ending a user’s sessions (C245.3, Workflow 11B)', () => {
  it('offers ending the sessions of another active user, never of oneself or an invited user', async () => {
    signedIn(ALL)
      .reply(
        200,
        listOf([
          user({ id: IDS.user, name: 'Synthetic Operator' }),
          user({
            id: USER_IDS.reviewer,
            email: 'reviewer@example.test',
            name: 'Synthetic Reviewer',
          }),
          user({
            id: USER_IDS.admin,
            email: 'invited@example.test',
            name: null,
            status: 'invited',
          }),
        ]),
      )
      .reply(200, listOf(allRoles()))
      .reply(200, grantableDocument());

    await renderPage();

    expect(
      rowOf('Synthetic Operator').queryByRole('button', { name: /End the sessions/ }),
    ).toBeNull();
    expect(
      rowOf('invited@example.test').queryByRole('button', { name: /End the sessions/ }),
    ).toBeNull();
    await userEvent.click(
      rowOf('Synthetic Reviewer').getByRole('button', {
        name: 'End the sessions of Synthetic Reviewer',
      }),
    );
    expect(
      screen.getByRole('dialog', { name: 'End every session of Synthetic Reviewer?' }),
    ).toHaveAccessibleDescription(
      'Signs them out in every browser at once. They can sign in again; to stop that, deactivate the user.',
    );
  });

  it('offers nothing without users:write', async () => {
    signedIn(['users:read', 'roles:read'])
      .reply(
        200,
        listOf([
          user({
            id: USER_IDS.reviewer,
            email: 'reviewer@example.test',
            name: 'Synthetic Reviewer',
          }),
        ]),
      )
      .reply(200, listOf(allRoles()));

    await renderPage();

    expect(screen.queryByRole('button', { name: /End the sessions/ })).toBeNull();
  });
});
