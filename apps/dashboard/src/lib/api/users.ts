/**
 * The organization's operators (C15, dashboard API): the user list, invitations, and changes of
 * a user's roles or status. Reading needs `users:read`, the rest `users:write`; the API enforces
 * both, and also refuses roles that grant a permission the operator lacks (403) and demoting or
 * deactivating the last active admin (409).
 */
import 'server-only';
import {
  dashboardInvitationResponseSchema,
  endUserSessionsResponseSchema,
  userEffectivePermissionsDocumentSchema,
  userRoleAssignmentsDocumentSchema,
  type UserEffectivePermissionsDocument,
  type RoleAssignment,
  userDocumentSchema,
  userListDocumentSchema,
  type UpdateUserBody,
  type UserResource,
  type UserStatus,
} from '@openverify/contracts';
import { cursorFromNextLink } from '../list-query';
import { apiRequest } from './client';

const USERS_PATH = '/dashboard/users';
/** Users per page of the `/users` list. */
export const USERS_PAGE_SIZE = 25;
/** Pages `userDirectory` reads at most: 500 operators, far more than an organization has. */
const DIRECTORY_PAGES = 5;

export interface UserListQuery {
  readonly status?: UserStatus | undefined;
  /** The last user ID of the previous page. */
  readonly after?: string | undefined;
}

/** `GET /dashboard/users`: one page, newest first, with each user's role ids. */
export function listUsers(query: UserListQuery = {}) {
  return apiRequest({
    method: 'GET',
    path: USERS_PATH,
    query: {
      'filter[status]': query.status,
      'page[after]': query.after,
      'page[size]': String(USERS_PAGE_SIZE),
    },
    schema: userListDocumentSchema,
  });
}

export interface Invitation {
  readonly email: string;
  readonly roleIds: readonly string[];
  /** When the emailed link stops working (7 days). */
  readonly expiresAt: string;
}

/**
 * `POST /dashboard/users/invitations`: emails an invitation link. Inviting someone still invited
 * sends a fresh link with these roles. The token itself never reaches the dashboard.
 */
export async function inviteUser(body: {
  readonly email: string;
  readonly 'role-ids': readonly string[];
}): Promise<Invitation> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${USERS_PATH}/invitations`,
    body,
    schema: dashboardInvitationResponseSchema,
  });
  return { email: answer.email, roleIds: answer['role-ids'], expiresAt: answer['expires-at'] };
}

/** `PATCH /dashboard/users/:id`: replaces the roles and/or sets `active` or `deactivated`. */
export async function updateUser(
  id: string,
  attributes: UpdateUserBody['data']['attributes'],
): Promise<UserResource> {
  const { data } = await apiRequest({
    method: 'PATCH',
    path: userPath(id),
    body: { data: { type: 'user', attributes } },
    schema: userDocumentSchema,
  });
  return data;
}

export interface OperatorName {
  readonly name: string | null;
  readonly email: string;
}

/** Every operator's name and email by user ID, to name who acted in the audit log. */
export async function userDirectory(): Promise<ReadonlyMap<string, OperatorName>> {
  const directory = new Map<string, OperatorName>();
  let after: string | null = null;
  for (let page = 0; page < DIRECTORY_PAGES; page += 1) {
    const answer = await apiRequest({
      method: 'GET',
      path: USERS_PATH,
      query: { 'page[after]': after ?? undefined, 'page[size]': '100' },
      schema: userListDocumentSchema,
    });
    for (const user of answer.data) {
      directory.set(user.id, { name: user.attributes.name ?? null, email: user.attributes.email });
    }
    after = cursorFromNextLink(answer.links.next, 'usr');
    if (after === null) {
      break;
    }
  }
  return directory;
}

const userPath = (id: string) => `${USERS_PATH}/${encodeURIComponent(id)}`;

/**
 * `PUT /dashboard/users/:id/roles` (`users:write`; C167.2): every assignment, each a role in the
 * environments named or, with `null`, in every current and future one; answers them as stored.
 */
export async function setUserRoles(
  id: string,
  assignments: readonly RoleAssignment[],
): Promise<RoleAssignment[]> {
  const { data } = await apiRequest({
    method: 'PUT',
    path: `${userPath(id)}/roles`,
    body: { assignments },
    schema: userRoleAssignmentsDocumentSchema,
  });
  return data.attributes.assignments;
}

/**
 * `GET /dashboard/users/:id/roles` (`users:read`; K9-22, DS8): the user's assignments as stored, each
 * a role in the environments named or, with `null`, in every current and future one.
 */
export async function getUserRoles(id: string): Promise<RoleAssignment[]> {
  const { data } = await apiRequest({
    method: 'GET',
    path: `${userPath(id)}/roles`,
    schema: userRoleAssignmentsDocumentSchema,
  });
  return data.attributes.assignments;
}

/** What `GET /dashboard/users/:id/permissions` answers (K9-22). */
export type UserEffectivePermissions = UserEffectivePermissionsDocument['data']['attributes'];

/**
 * `GET /dashboard/users/:id/permissions` (`users:read`; K9-22, DS8): what the user's assignments
 * give, the organisation-level permissions once and the others per environment, with whether the
 * user may enter each environment.
 */
export async function getUserPermissions(id: string): Promise<UserEffectivePermissions> {
  const { data } = await apiRequest({
    method: 'GET',
    path: `${userPath(id)}/permissions`,
    schema: userEffectivePermissionsDocumentSchema,
  });
  return data.attributes;
}

/**
 * `POST /dashboard/users/:id/reactivate` (`users:write`; C168.1, AC2): a new invitation, and no role
 * back. The only way the console reactivates; `PATCH` with `status: active` is never sent for it.
 */
export async function reactivateUser(id: string): Promise<UserResource> {
  const { data } = await apiRequest({
    method: 'POST',
    path: `${userPath(id)}/reactivate`,
    body: {},
    schema: userDocumentSchema,
  });
  return data;
}

/** `POST /dashboard/users/:id/reset-mfa` (`users:write`, never oneself; C168.3). */
export async function resetUserMfa(id: string): Promise<UserResource> {
  const { data } = await apiRequest({
    method: 'POST',
    path: `${userPath(id)}/reset-mfa`,
    body: {},
    schema: userDocumentSchema,
  });
  return data;
}

/**
 * `POST /dashboard/users/:id/end-sessions` (`users:write`, never oneself; C245.3, Workflow 11B):
 * revokes every live session of the user, answering how many.
 */
export async function endUserSessions(id: string): Promise<number> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${userPath(id)}/end-sessions`,
    body: {},
    schema: endUserSessionsResponseSchema,
  });
  return answer['sessions-ended'];
}

/** `POST /dashboard/invitations/:id/resend` (`users:write`; C168.1): a new 7-day link, the old one revoked. */
export async function resendInvitation(id: string): Promise<Invitation> {
  const answer = await apiRequest({
    method: 'POST',
    path: `/dashboard/invitations/${encodeURIComponent(id)}/resend`,
    body: {},
    schema: dashboardInvitationResponseSchema,
  });
  return { email: answer.email, roleIds: answer['role-ids'], expiresAt: answer['expires-at'] };
}

/**
 * C167.4: how many users hold `roleId`, read across at most five pages of 100 (the directory's
 * bound); `null` when there are more pages, so a confirmation never states a count it did not read.
 */
export async function roleHolderCount(roleId: string): Promise<number | null> {
  let count = 0;
  let after: string | null = null;
  for (let page = 0; page < DIRECTORY_PAGES; page += 1) {
    const answer = await apiRequest({
      method: 'GET',
      path: USERS_PATH,
      query: { 'page[after]': after ?? undefined, 'page[size]': '100' },
      schema: userListDocumentSchema,
    });
    count += answer.data.filter((user) =>
      (user.relationships?.roles.data ?? []).some((role) => role.id === roleId),
    ).length;
    after = cursorFromNextLink(answer.links.next, 'usr');
    if (after === null) {
      return count;
    }
  }
  return null;
}
