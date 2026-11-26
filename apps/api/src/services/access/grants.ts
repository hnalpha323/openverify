/**
 * C167.2, C167.3 (Phase 9, Workflow 9B; decisions 49 and 70, review P01): what an operator may grant
 * where, now that roles are assigned per environment.
 *
 * A grant has a scope: one environment, or `null` for an organisation-wide assignment (every current
 * and future environment). What the granting user holds in a scope is what its own assignments give
 * there ({@link heldInScope}): in an environment, every assignment reaching it; organisation-wide,
 * only its organisation-wide assignments, since only those reach the environments created later.
 *
 * - {@link assertGrantsHeld}: C12's no-escalation rule per scope (Workflow 2D K002, now per
 *   environment): the user holds each permission it grants, or takes away, in each scope.
 * - {@link roleScopeProblems}: an organisation-level permission (`PERMISSION_LEVEL`) or the built-in
 *   admin in a narrower assignment is 422 `role_scope_invalid` (P01).
 * - {@link grantableScopes}: the answer of `GET /dashboard/roles/grantable`.
 */
import {
  PERMISSIONS,
  isPermission,
  missingPermissions,
  permissionLevel,
  type Permission,
} from '@openverify/core';
import type { Role } from '@openverify/db';
import type { ProblemFieldError } from '../../errors.js';
import { PermissionDeniedError } from '../../errors.js';
import {
  ORGANIZATION_WIDE_ROLE_KEY,
  permissionsForEnvironment,
  type EnvironmentRoleAssignment,
} from './permissions.js';
import { AccessProblemError } from './problems.js';

/** Where a grant applies: an environment's id, or `null` for every current and future one. */
export type GrantScope = string | null;

/** A permission granted or removed in a scope. */
export interface ScopedPermissions {
  scope: GrantScope;
  permissions: Iterable<string>;
}

/** What `assignments` hold organisation-wide: their organisation-wide assignments only. */
export function organizationWidePermissions(
  assignments: Iterable<EnvironmentRoleAssignment>,
): ReadonlySet<Permission> {
  const wide = [...assignments].filter((assignment) => assignment.environmentIds === null);
  // An organisation-wide assignment reaches any environment id; the id is never compared.
  return permissionsForEnvironment(wide, '');
}

/** What `assignments` hold in `scope`. */
export function heldInScope(
  assignments: Iterable<EnvironmentRoleAssignment>,
  scope: GrantScope,
): ReadonlySet<Permission> {
  return scope === null
    ? organizationWidePermissions(assignments)
    : permissionsForEnvironment(assignments, scope);
}

/** The permissions `assignments` give in each scope: every environment named, then `null`. */
export function effectivePermissions(
  assignments: readonly EnvironmentRoleAssignment[],
  environmentIds: readonly string[],
): Map<GrantScope, ReadonlySet<Permission>> {
  const byScope = new Map<GrantScope, ReadonlySet<Permission>>();
  for (const environmentId of environmentIds) {
    byScope.set(environmentId, permissionsForEnvironment(assignments, environmentId));
  }
  byScope.set(null, organizationWidePermissions(assignments));
  return byScope;
}

/** What each scope of `after` adds to `before`, and what it takes away. */
export function changedPermissions(
  before: Map<GrantScope, ReadonlySet<Permission>>,
  after: Map<GrantScope, ReadonlySet<Permission>>,
): { granted: ScopedPermissions[]; removed: ScopedPermissions[] } {
  const granted: ScopedPermissions[] = [];
  const removed: ScopedPermissions[] = [];
  for (const scope of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(scope) ?? new Set<Permission>();
    const is = after.get(scope) ?? new Set<Permission>();
    granted.push({ scope, permissions: [...is].filter((permission) => !was.has(permission)) });
    removed.push({ scope, permissions: [...was].filter((permission) => !is.has(permission)) });
  }
  return { granted, removed };
}

const scopeName = (scope: GrantScope) =>
  scope === null ? 'every environment' : `environment ${scope}`;

const REFUSED = {
  grant: 'You cannot grant permissions you do not hold',
  remove: 'You cannot remove permissions you do not hold',
} as const;

/**
 * Checks that the operator holding `actor` holds each permission of `changes` in its scope.
 * @throws {PermissionDeniedError} 403 `forbidden`, naming the scope and each permission it lacks
 *   there, in `PERMISSIONS` order (ids and permission names only).
 */
export function assertGrantsHeld(
  actor: readonly EnvironmentRoleAssignment[],
  changes: readonly ScopedPermissions[],
  kind: keyof typeof REFUSED,
): void {
  for (const change of changes) {
    const touched = new Set([...change.permissions].filter(isPermission));
    const missing = missingPermissions(
      heldInScope(actor, change.scope),
      PERMISSIONS.filter((permission) => touched.has(permission)),
    );
    if (missing.length > 0) {
      throw new PermissionDeniedError(
        `${REFUSED[kind]} in ${scopeName(change.scope)}: ${missing.join(', ')}.`,
        missing,
      );
    }
  }
}

/** Why `role` may not be granted narrower than every environment, or `null` when it may. */
export function narrowRefusal(
  role: Pick<Role, 'key' | 'builtin' | 'permissions'>,
): 'admin-organization-wide' | 'organization-level' | null {
  if (role.builtin && role.key === ORGANIZATION_WIDE_ROLE_KEY) {
    return 'admin-organization-wide';
  }
  return role.permissions.some(
    (permission) => isPermission(permission) && permissionLevel(permission) === 'organization',
  )
    ? 'organization-level'
    : null;
}

/** The organisation-level permissions of `role`, in `PERMISSIONS` order. */
const organizationLevelOf = (role: Pick<Role, 'permissions'>) =>
  PERMISSIONS.filter(
    (permission) =>
      permissionLevel(permission) === 'organization' && role.permissions.includes(permission),
  );

/** One assignment of a `PUT /users/:id/roles` body, with its role loaded. */
export interface RequestedAssignment {
  role: Role;
  environmentIds: readonly string[] | null;
}

/**
 * C167.2 (P01): the `role_scope_invalid` problems of `assignments`: each narrower assignment of the
 * admin role or of a role holding an organisation-level permission, at its `environment-ids`.
 */
export function roleScopeProblems(
  assignments: readonly RequestedAssignment[],
): ProblemFieldError[] {
  return assignments.flatMap((assignment, index) => {
    if (assignment.environmentIds === null) {
      return [];
    }
    const refusal = narrowRefusal(assignment.role);
    if (refusal === null) {
      return [];
    }
    return [
      {
        location: 'body' as const,
        pointer: `/assignments/${String(index)}/environment-ids`,
        detail:
          refusal === 'admin-organization-wide'
            ? 'The admin role is granted only with environment-ids null.'
            : `The role holds ${organizationLevelOf(assignment.role).join(', ')}, which is granted only with environment-ids null.`,
      },
    ];
  });
}

/** 422 `role_scope_invalid` with `errors`. */
export function roleScopeInvalid(errors: readonly ProblemFieldError[]): AccessProblemError {
  return new AccessProblemError(
    'role_scope_invalid',
    'An organisation-level permission and the admin role are granted only in every environment.',
    errors,
  );
}

/** A grant as `grantable` lists it. */
export interface GrantDecision {
  grantable: boolean;
  reason: 'not-held' | 'organization-level' | 'admin-organization-wide' | null;
}

const decided = (reason: GrantDecision['reason']): GrantDecision => ({
  grantable: reason === null,
  reason,
});

/** Whether the holder of `held` may grant `permission` in `scope`, and why not. */
export function permissionDecision(
  held: ReadonlySet<Permission>,
  permission: Permission,
  scope: GrantScope,
): GrantDecision {
  if (scope !== null && permissionLevel(permission) === 'organization') {
    return decided('organization-level');
  }
  return decided(held.has(permission) ? null : 'not-held');
}

/** Whether the holder of `held` may grant `role` in `scope`, and why not. */
export function roleDecision(
  held: ReadonlySet<Permission>,
  role: Pick<Role, 'key' | 'builtin' | 'permissions'>,
  scope: GrantScope,
): GrantDecision {
  if (scope !== null) {
    const refusal = narrowRefusal(role);
    if (refusal !== null) {
      return decided(refusal);
    }
  }
  const all = role.permissions.filter(isPermission).every((permission) => held.has(permission));
  return decided(all ? null : 'not-held');
}

/** One scope of the `grantable` answer. */
export interface GrantableScope {
  environmentId: GrantScope;
  permissions: (GrantDecision & { permission: Permission })[];
  roles: (GrantDecision & { roleId: string })[];
}

/**
 * `GET /dashboard/roles/grantable`: for each environment (in the order given), then
 * organisation-wide, every permission (in `PERMISSIONS` order) and every role (in the order given)
 * with whether `actor` may grant it there.
 */
export function grantableScopes(
  actor: readonly EnvironmentRoleAssignment[],
  environmentIds: readonly string[],
  roles: readonly Role[],
): GrantableScope[] {
  return [...environmentIds, null].map((scope) => {
    const held = heldInScope(actor, scope);
    return {
      environmentId: scope,
      permissions: PERMISSIONS.map((permission) => ({
        permission,
        ...permissionDecision(held, permission, scope),
      })),
      roles: roles.map((role) => ({ roleId: role.id, ...roleDecision(held, role, scope) })),
    };
  });
}
