import { USER_STATUSES, idSchema, type UserResource, type UserStatus } from '@openverify/contracts';
import type { Metadata } from 'next';
import { EffectivePermissions } from '../../components/operators/effective-permissions';
import { InviteUserButton } from '../../components/operators/invite-user-button';
import { roleOptions } from '../../components/operators/role-options';
import { UserFilters } from '../../components/operators/user-filters';
import { UsersTable, type UserRow } from '../../components/operators/users-table';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { getGrantable, listAllRoles } from '../../lib/api/roles';
import { assignmentScopes } from '../../components/operators/grantable';
import { getUserPermissions, listUsers } from '../../lib/api/users';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
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

export const metadata: Metadata = { title: 'Users' };

export interface UsersPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isUserStatus = (value: unknown): value is UserStatus =>
  typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value);

function rowOf(user: UserResource, roleNames: ReadonlyMap<string, string> | null): UserRow {
  const roleIds = user.relationships?.roles.data.map(({ id }) => id) ?? [];
  return {
    id: user.id,
    email: user.attributes.email,
    name: user.attributes.name ?? null,
    // Phase 1 documents carry no status: those users could sign in, so they are active.
    status: user.attributes.status ?? 'active',
    roles: roleIds.map((id) => ({ id, name: roleNames?.get(id) ?? null })),
    mfaEnabled: user.attributes['mfa-enabled'] ?? null,
    mfaFactors: user.attributes['mfa-factors'] ?? null,
    lastSignInAt: user.attributes['last-sign-in-at'],
    createdAt: user.attributes['created-at'],
  };
}

/**
 * The organization's operators (C15, C23): their status and roles, invitations, role changes,
 * deactivation and reactivation. The status filter and the cursor live in the URL.
 */
export default async function UsersPage({ searchParams }: UsersPageProps) {
  const params = await searchParams;
  const status = isUserStatus(params.status) ? params.status : undefined;
  const after = parseCursor(params.after, 'usr');
  // K9-22 (DS8): whose effective permissions to show; a malformed id shows none.
  const chosen = idSchema('usr').safeParse(params.permissions);
  const permissionsOf = chosen.success ? chosen.data : null;

  return renderPage({ permissions: ['users:read'] }, async ({ session }) => {
    const page = await listUsers({ status, after });
    // Role names and the roles to offer need roles:read; without it, roles show by ID.
    const roles = hasPermission(session, 'roles:read') ? await listAllRoles() : null;
    const options = roles === null ? null : roleOptions(roles, session.permissions);
    const roleNames =
      roles === null ? null : new Map(roles.map((role) => [role.id, role.attributes.name]));
    const canWrite = hasPermission(session, 'users:write');
    // C167.2: where each role may be assigned, as the API would grant it.
    const grantable = canWrite && roles !== null ? await getGrantable() : null;
    const scopes =
      grantable === null || roles === null
        ? undefined
        : Object.fromEntries(
            roles.map((role) => [
              role.id,
              assignmentScopes(role.id, grantable, session.environments),
            ]),
          );
    const canInvite = canWrite && options?.some((option) => option.grantable) === true;
    const effective = permissionsOf === null ? null : await getUserPermissions(permissionsOf);
    const chosenUser = page.data.find((user) => user.id === permissionsOf);
    const listHref = (userId: string | null) => {
      const query = new URLSearchParams();
      if (status !== undefined) {
        query.set('status', status);
      }
      if (after !== undefined) {
        query.set('after', after);
      }
      if (userId !== null) {
        query.set('permissions', userId);
      }
      const text = query.toString();
      return text === '' ? '/users' : `/users?${text}`;
    };

    return (
      <PageMain>
        <PageHeader
          title="Users"
          description="The people who operate this organization's dashboard, and their roles."
          {...(canInvite
            ? { actions: <InviteUserButton roles={options} action={inviteUser} /> }
            : {})}
        />
        <UserFilters status={status} />
        {effective !== null && permissionsOf !== null && (
          <EffectivePermissions
            userLabel={
              chosenUser === undefined
                ? permissionsOf
                : (chosenUser.attributes.name ?? chosenUser.attributes.email)
            }
            organization={effective.organization}
            environments={effective.environments}
            known={session.environments}
            closeHref={listHref(null)}
          />
        )}
        <UsersTable
          users={page.data.map((user) => rowOf(user, roleNames))}
          currentUserId={session.user.id}
          permissionsHref={listHref}
          manage={
            canWrite
              ? {
                  roles: options,
                  ...(scopes === undefined ? {} : { scopes }),
                  updateRoles: updateUserRoles,
                  readAssignments: readUserAssignments,
                  setStatus: setUserStatus,
                  resendInvitation,
                  reactivate: reactivateUser,
                  resetMfa: resetUserMfa,
                  endSessions: endUserSessions,
                  startStepUpWebauthn,
                }
              : null
          }
          emptyMessage={status === undefined ? 'No users yet.' : 'No users match this filter.'}
        />
        <Pagination
          path="/users"
          query={{ status }}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'usr')}
        />
      </PageMain>
    );
  });
}
