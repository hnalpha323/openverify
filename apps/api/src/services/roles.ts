/**
 * C15 roles. The four built-in roles (`admin`, `developer`, `reviewer`, `viewer`) are ordinary
 * rows per organization with `builtin` and a stable key, kept in step with
 * `BUILTIN_ROLES` in `@openverify/core`: the API syncs them at startup, and whoever creates
 * an organization syncs it. Custom roles hold any subset of the permissions.
 */
import {
  buildRoleResource,
  grantableDocumentSchema,
  type AuditActor,
  type GrantableDocument,
  type CreateRoleBody,
  type RoleResource,
  type UpdateRoleBody,
} from '@openverify/contracts';
import {
  BUILTIN_ROLES,
  PERMISSIONS,
  isPermission,
  missingPermissions,
  type BuiltinRoleKey,
  type Permission,
} from '@openverify/core';
import {
  createRole,
  deleteRole,
  getRole,
  listEnvironments,
  listOrganizationRoles,
  listRoleAssignmentEnvironments,
  listRoles,
  listUserRoleAssignments,
  organizations,
  pgErrorCode,
  roles,
  syncBuiltinRoles,
  updateRole,
  type Db,
  type Role,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError, NotFoundError, PermissionDeniedError } from '../errors.js';
import type { AuditLogger, IdGenerator, ServiceContext } from '../ports.js';
import { recordInEveryEnvironment } from './access/audit.js';
import {
  assertGrantsHeld,
  grantableScopes,
  narrowRefusal,
  roleScopeInvalid,
  type GrantScope,
} from './access/grants.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from './pagination.js';

const BUILTIN_DEFINITIONS = Object.values(BUILTIN_ROLES);

const isBuiltinKey = (key: string | null): key is BuiltinRoleKey =>
  key !== null && Object.hasOwn(BUILTIN_ROLES, key);

/**
 * Creates the organization's missing built-in roles and resets the permissions of the others
 * to core's. Idempotent; returns the built-in roles in `BUILTIN_ROLE_KEYS` order.
 */
export function syncOrganizationRoles(
  db: Db,
  organizationId: string,
  ids: IdGenerator,
): Promise<Role[]> {
  return syncBuiltinRoles(db, organizationId, BUILTIN_DEFINITIONS, () => ids.newId('role'));
}

/** Syncs the built-in roles of every organization (API startup). Returns how many. */
export async function syncAllOrganizationRoles(db: Db, ids: IdGenerator): Promise<number> {
  const rows = await db.select({ id: organizations.id }).from(organizations);
  for (const { id } of rows) {
    await syncOrganizationRoles(db, id, ids);
  }
  return rows.length;
}

/**
 * The id of the organization's built-in role `key`.
 * @throws {Error} when the organization's built-in roles were never synced.
 */
export async function builtinRoleId(
  db: Db,
  organizationId: string,
  key: BuiltinRoleKey,
): Promise<string> {
  const [row] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, key)))
    .limit(1);
  if (row === undefined) {
    throw new Error(`Organization ${organizationId} has no built-in role ${key}`);
  }
  return row.id;
}

/** The C15 role resource. Stored permissions core does not know grant nothing and are left out. */
export function roleResource(role: Role): RoleResource {
  return buildRoleResource({
    id: role.id,
    name: role.name,
    key: role.builtin && isBuiltinKey(role.key) ? role.key : null,
    builtin: role.builtin,
    permissions: role.permissions.filter(isPermission),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  });
}

/** What a change does to someone's access, which names it in a refusal (Workflow 2D K002). */
export type AccessChange = 'grant' | 'remove' | 'change-status' | 'delete-role';

const REFUSED: Readonly<Record<AccessChange, string>> = {
  grant: 'You cannot grant permissions you do not hold',
  remove: 'You cannot remove permissions you do not hold',
  'change-status': 'You cannot change the status of a user with permissions you do not hold',
  'delete-role': 'You cannot delete a role with permissions you do not hold',
};

/**
 * C12's no-escalation rule for operators, applied symmetrically (Workflow 2D K002): a user may
 * change only access it holds itself, whether it grants permissions (in a role it creates or
 * edits, or by assigning roles), takes them away (removing a role or a role's permission),
 * suspends or restores them (a user's status) or deletes a role that grants them.
 * @throws {PermissionDeniedError} 403 `forbidden`, naming each permission it lacks once, in
 *   `PERMISSIONS` order.
 */
export function assertCanChangeAccess(
  held: ReadonlySet<Permission>,
  permissions: Iterable<string>,
  change: AccessChange,
): void {
  const touched = new Set([...permissions].filter(isPermission));
  const missing = missingPermissions(
    held,
    PERMISSIONS.filter((permission) => touched.has(permission)),
  );
  if (missing.length > 0) {
    throw new PermissionDeniedError(`${REFUSED[change]}: ${missing.join(', ')}.`, missing);
  }
}

/**
 * The grant case of {@link assertCanChangeAccess}: a user may grant only permissions it holds.
 * @throws {PermissionDeniedError} 403 `forbidden`, naming the permissions it lacks.
 */
export function assertCanGrant(held: ReadonlySet<Permission>, granted: Iterable<string>): void {
  assertCanChangeAccess(held, granted, 'grant');
}

const roleNameTaken = () => new ConflictError('A role with this name already exists.');

async function withUniqueName<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw roleNameTaken();
    }
    throw error;
  }
}

/** The tenant, actor and permissions of a role change. */
export interface RoleChangeContext {
  ctx: ServiceContext;
  actor: AuditActor;
  permissions: ReadonlySet<Permission>;
}

/** `GET /dashboard/roles`: the organization's roles, newest first. */
export async function listRolesDocument(
  db: Db,
  organizationId: string,
  query: PageQuery,
  path: string,
): Promise<{ data: RoleResource[]; links: { next: string | null } }> {
  const page = await withCursor(() => listRoles(db, organizationId, pageRequest(query)));
  return {
    data: page.items.map(roleResource),
    links: { next: nextLink(path, {}, query, page.next) },
  };
}

/**
 * `GET /dashboard/roles/:id` (C25.2, Workflow 2E): a built-in or custom role of the organization.
 * @throws {NotFoundError} for an unknown role or a role of another organization.
 */
export async function getRoleResource(
  db: Db,
  organizationId: string,
  id: string,
): Promise<RoleResource> {
  const role = await getRole(db, organizationId, id);
  if (role === null) {
    throw new NotFoundError('No role with this id exists.');
  }
  return roleResource(role);
}

/** `POST /dashboard/roles`: a custom role, audited as `role.created`. */
export async function createCustomRole(
  db: Db,
  audit: AuditLogger,
  ids: IdGenerator,
  change: RoleChangeContext,
  attributes: CreateRoleBody['data']['attributes'],
): Promise<RoleResource> {
  assertCanGrant(change.permissions, attributes.permissions);
  const role = await withUniqueName(() =>
    db.transaction(async (tx) => {
      const created = await createRole(tx, change.ctx.organizationId, {
        id: ids.newId('role'),
        name: attributes.name,
        permissions: attributes.permissions,
      });
      // C167.2 (Workflow 9B): an organisation-level action, audited in every environment.
      await recordInEveryEnvironment(tx, audit, change.ctx, change.actor, {
        action: 'role.created',
        resourceType: 'role',
        resourceId: created.id,
        metadata: { permissions: created.permissions },
      });
      return created;
    }),
  );
  return roleResource(role);
}

/**
 * C167.2 (Workflow 9B; review P01): a role's new permissions where it is assigned. An
 * organisation-level permission in a role assigned narrower than every environment is 422
 * `role_scope_invalid`; each added and each removed permission must be held by the editor in every
 * environment where the role is assigned (organisation-wide for an organisation-wide assignment).
 */
async function assertRoleChangeHeldWhereAssigned(
  db: Db,
  change: RoleChangeContext,
  existing: Role,
  permissions: readonly string[],
): Promise<void> {
  const assigned = await listRoleAssignmentEnvironments(db, change.ctx.organizationId, existing.id);
  if (
    assigned.some((environmentIds) => environmentIds !== null) &&
    narrowRefusal({ ...existing, permissions: [...permissions] }) !== null
  ) {
    throw roleScopeInvalid([
      {
        location: 'body',
        pointer: '/data/attributes/permissions',
        detail:
          'The role is assigned in some environments only, so it cannot hold an organisation-level permission.',
      },
    ]);
  }
  const scopes = new Set<GrantScope>(
    assigned.flatMap((environmentIds) => environmentIds ?? [null]),
  );
  const before = new Set(existing.permissions);
  const after = new Set(permissions);
  const actor = await listUserRoleAssignments(db, change.ctx.organizationId, change.actor.id);
  assertGrantsHeld(
    actor,
    [...scopes].map((scope) => ({
      scope,
      permissions: [...after].filter((permission) => !before.has(permission)),
    })),
    'grant',
  );
  assertGrantsHeld(
    actor,
    [...scopes].map((scope) => ({
      scope,
      permissions: [...before].filter((permission) => !after.has(permission)),
    })),
    'remove',
  );
}

/**
 * `PATCH /dashboard/roles/:id`: a custom role's name or permissions.
 * @throws {NotFoundError} for a role of another organization.
 * @throws {ConflictError} for a built-in role or a name in use.
 */
export async function updateCustomRole(
  db: Db,
  audit: AuditLogger,
  change: RoleChangeContext,
  id: string,
  attributes: UpdateRoleBody['data']['attributes'],
): Promise<RoleResource> {
  const existing = await getRole(db, change.ctx.organizationId, id);
  if (existing === null) {
    throw new NotFoundError('No role with this id exists.');
  }
  if (existing.builtin) {
    throw new ConflictError('Built-in roles cannot be changed.');
  }
  if (attributes.permissions !== undefined) {
    assertCanGrant(change.permissions, attributes.permissions);
    const kept = new Set<string>(attributes.permissions);
    assertCanChangeAccess(
      change.permissions,
      existing.permissions.filter((permission) => !kept.has(permission)),
      'remove',
    );
    await assertRoleChangeHeldWhereAssigned(db, change, existing, attributes.permissions);
  }
  const role = await withUniqueName(() =>
    db.transaction(async (tx) => {
      const updated = await updateRole(tx, change.ctx.organizationId, id, {
        ...(attributes.name === undefined ? {} : { name: attributes.name }),
        ...(attributes.permissions === undefined ? {} : { permissions: attributes.permissions }),
      });
      if (updated === null) {
        throw new ConflictError('Built-in roles cannot be changed.');
      }
      await recordInEveryEnvironment(tx, audit, change.ctx, change.actor, {
        action: 'role.updated',
        resourceType: 'role',
        resourceId: id,
        metadata: { ...attributes },
      });
      return updated;
    }),
  );
  return roleResource(role);
}

/**
 * `DELETE /dashboard/roles/:id`: a custom role nobody holds, whose every permission the
 * operator holds (Workflow 2D K002).
 * @throws {NotFoundError} for a role of another organization.
 * @throws {ConflictError} for a built-in role or a role in use.
 * @throws {PermissionDeniedError} for a role with a permission the operator lacks.
 */
export async function deleteCustomRole(
  db: Db,
  audit: AuditLogger,
  change: RoleChangeContext,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await getRole(tx, change.ctx.organizationId, id);
    if (existing !== null && !existing.builtin) {
      assertCanChangeAccess(change.permissions, existing.permissions, 'delete-role');
    }
    const result = await deleteRole(tx, change.ctx.organizationId, id);
    if (result === 'not_found') {
      throw new NotFoundError('No role with this id exists.');
    }
    if (result === 'builtin') {
      throw new ConflictError('Built-in roles cannot be deleted.');
    }
    if (result === 'in_use') {
      throw new ConflictError('Users still hold this role; give them other roles first.');
    }
    await recordInEveryEnvironment(tx, audit, change.ctx, change.actor, {
      action: 'role.deleted',
      resourceType: 'role',
      resourceId: id,
    });
  });
}

/**
 * C167.3 `GET /dashboard/roles/grantable`: what the operator may grant, per environment of the
 * organisation (oldest first), then organisation-wide, each permission and role with why it is
 * refused (`grantableScopes`).
 */
export async function grantableDocument(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<GrantableDocument> {
  const [actor, environments, organizationRoles] = await Promise.all([
    listUserRoleAssignments(db, organizationId, userId),
    listEnvironments(db, organizationId),
    listOrganizationRoles(db, organizationId),
  ]);
  const scopes = grantableScopes(
    actor,
    environments.map(({ id }) => id),
    organizationRoles,
  );
  return grantableDocumentSchema.parse({
    data: {
      type: 'grantable',
      id: userId,
      attributes: {
        scopes: scopes.map((scope) => ({
          'environment-id': scope.environmentId,
          permissions: scope.permissions,
          roles: scope.roles.map(({ roleId, grantable, reason }) => ({
            'role-id': roleId,
            grantable,
            reason,
          })),
        })),
      },
    },
  });
}
