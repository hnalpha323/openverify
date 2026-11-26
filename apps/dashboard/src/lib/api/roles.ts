/**
 * The organization's roles (C15, dashboard API). Built-in roles cannot be changed or deleted,
 * nor can a role users still hold (409); a role can grant only permissions its author holds
 * (403). Reading needs `roles:read`, the rest `roles:write`.
 */
import 'server-only';
import {
  grantableDocumentSchema,
  roleDocumentSchema,
  roleListDocumentSchema,
  type CreateRoleBody,
  type GrantableDocument,
  type RoleResource,
  type UpdateRoleBody,
} from '@openverify/contracts';
import { z } from 'zod';
import { cursorFromNextLink } from '../list-query';
import { apiRequest } from './client';

const ROLES_PATH = '/dashboard/roles';
/** Roles per page of the `/roles` list. */
export const ROLES_PAGE_SIZE = 50;
/** Pages `listAllRoles` reads at most: 2,000 roles. */
const MAX_ROLE_PAGES = 20;

const rolePath = (id: string) => `${ROLES_PATH}/${encodeURIComponent(id)}`;

/** `GET /dashboard/roles`: one page, newest first. */
export function listRoles(query: { readonly after?: string | undefined } = {}) {
  return apiRequest({
    method: 'GET',
    path: ROLES_PATH,
    query: { 'page[after]': query.after, 'page[size]': String(ROLES_PAGE_SIZE) },
    schema: roleListDocumentSchema,
  });
}

/**
 * Every role of the organization, newest first: to name a user's roles and to offer the roles an
 * operator may grant. Organizations have a handful, so the pages are read in turn.
 */
export async function listAllRoles(): Promise<RoleResource[]> {
  const roles: RoleResource[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_ROLE_PAGES; page += 1) {
    const answer = await apiRequest({
      method: 'GET',
      path: ROLES_PATH,
      query: { 'page[after]': after ?? undefined, 'page[size]': '100' },
      schema: roleListDocumentSchema,
    });
    roles.push(...answer.data);
    after = cursorFromNextLink(answer.links.next, 'role');
    if (after === null) {
      break;
    }
  }
  return roles;
}

/**
 * `GET /dashboard/roles/:id` (C25.2): one built-in or custom role. The API answers 404 for an
 * unknown role or another organization's, which `renderPage` maps to not found.
 */
export async function getRole(id: string): Promise<RoleResource> {
  const { data } = await apiRequest({
    method: 'GET',
    path: rolePath(id),
    schema: roleDocumentSchema,
  });
  return data;
}

/** `POST /dashboard/roles`: a custom role. */
export async function createRole(
  attributes: CreateRoleBody['data']['attributes'],
): Promise<RoleResource> {
  const { data } = await apiRequest({
    method: 'POST',
    path: ROLES_PATH,
    body: { data: { type: 'role', attributes } },
    schema: roleDocumentSchema,
  });
  return data;
}

/** `PATCH /dashboard/roles/:id`: a custom role's name and/or permissions. */
export async function updateRole(
  id: string,
  attributes: UpdateRoleBody['data']['attributes'],
): Promise<RoleResource> {
  const { data } = await apiRequest({
    method: 'PATCH',
    path: rolePath(id),
    body: { data: { type: 'role', attributes } },
    schema: roleDocumentSchema,
  });
  return data;
}

/** `DELETE /dashboard/roles/:id`: a custom role no user holds (204). */
export async function deleteRole(id: string): Promise<void> {
  await apiRequest({ method: 'DELETE', path: rolePath(id), schema: z.null().optional() });
}

/** One scope of `GET /dashboard/roles/grantable`: an environment, or `null` for organisation-wide. */
export type GrantableScope = GrantableDocument['data']['attributes']['scopes'][number];

/**
 * `GET /dashboard/roles/grantable` (`roles:read`): what the caller may grant, per environment of the
 * organisation (oldest first), then organisation-wide (`environment-id: null`); each refused grant
 * with its reason (C167.3, C167.4).
 */
export async function getGrantable(): Promise<GrantableScope[]> {
  const { data } = await apiRequest({
    method: 'GET',
    path: `${ROLES_PATH}/grantable`,
    schema: grantableDocumentSchema,
  });
  return data.attributes.scopes;
}
