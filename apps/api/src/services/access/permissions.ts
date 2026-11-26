/**
 * C167.2 (Phase 9, Workflow 9B; decisions 49 and 70, reviews P01 and F29): what a user may do in one
 * environment, now that a role is assigned per environment (`user_roles.environment_ids`, `NULL` for
 * every current and future one). Owner: `api-access`; `foundation-9b` (Stage 1b (U)) froze the
 * signatures and placed the calls:
 *
 * - {@link permissionsForEnvironment}: the session's permissions, called by `findUserSessionContext`
 *   (`operator-auth/session-context.ts`), where the union of every role was computed before;
 * - {@link userPermissionsInEnvironment}: a user's permissions in an environment other than the
 *   session's, called where a change reaches another environment (the workflow promote, which needs
 *   the rights in both, `workflows/publish/promote.ts`);
 * - {@link mintablePermissions}: the most an API key may be granted, called where a key is minted or
 *   cloned (`services/api-keys.ts`): "an API key holds at most what its minting user holds in the
 *   key's environment".
 *
 * The rules:
 * - an assignment reaches an environment when its `environment-ids` is `null` or names it
 *   ({@link assignmentReaches}; `roleAssignmentReaches` is the same rule in SQL for the Phase 8
 *   resolutions `packages/db` holds);
 * - an organisation-level permission (`PERMISSION_LEVEL`: `users:*`, `roles:*`) counts only through an
 *   organisation-wide assignment (review P01), and the built-in `admin` role grants nothing through a
 *   narrower one (ours: no half-admin); the API refuses both narrower assignments (422
 *   `role_scope_invalid`), so these rules only fail closed on rows written another way;
 * - a stored value that is not a permission grants nothing (C15).
 */
import { isPermission, permissionLevel, type Permission } from '@openverify/core';
import { getEnvironment, listUserRoleAssignments, type Db } from '@openverify/db';
import type { Principal, UserPrincipal } from '../../ports.js';

/** The built-in role assignable organisation-wide only (decision 49). */
export const ORGANIZATION_WIDE_ROLE_KEY = 'admin';

/** One assignment as the hooks read it: the role's permissions and where it is granted. */
export interface EnvironmentRoleAssignment {
  /** The role's permissions; a built-in role names its `key` (`admin` is organisation-wide only). */
  role: { readonly permissions: readonly string[]; readonly key?: string | null };
  /** `null`: every current and future environment of the organisation. */
  environmentIds: readonly string[] | null;
}

/** Whether `assignment` reaches `environmentId`: organisation-wide, or naming it. */
export function assignmentReaches(
  assignment: EnvironmentRoleAssignment,
  environmentId: string,
): boolean {
  return assignment.environmentIds === null || assignment.environmentIds.includes(environmentId);
}

/** The permissions one assignment grants wherever it reaches, at C167.2's levels. */
function grantedBy(assignment: EnvironmentRoleAssignment): Permission[] {
  const organizationWide = assignment.environmentIds === null;
  if (!organizationWide && assignment.role.key === ORGANIZATION_WIDE_ROLE_KEY) {
    return [];
  }
  return assignment.role.permissions
    .filter(isPermission)
    .filter((permission) => organizationWide || permissionLevel(permission) === 'environment');
}

export type PermissionsForEnvironment = (
  assignments: Iterable<EnvironmentRoleAssignment>,
  environmentId: string,
) => ReadonlySet<Permission>;

/** The permissions `assignments` give in `environmentId`: the union of those reaching it. */
export const permissionsForEnvironment: PermissionsForEnvironment = (
  assignments,
  environmentId,
) => {
  const granted = new Set<Permission>();
  for (const assignment of assignments) {
    if (assignmentReaches(assignment, environmentId)) {
      for (const permission of grantedBy(assignment)) {
        granted.add(permission);
      }
    }
  }
  return granted;
};

/** An environment as the sign-in and the switch read it. */
export interface EnterableEnvironment {
  id: string;
  kind: 'sandbox' | 'production';
}

/**
 * Whether `assignments` let the user enter `environment` (C167.2, review F29): a role there, and in
 * production `environments:production` held there.
 */
export function mayEnter(
  assignments: Iterable<EnvironmentRoleAssignment>,
  environment: EnterableEnvironment,
): boolean {
  const reaching = [...assignments].filter((assignment) =>
    assignmentReaches(assignment, environment.id),
  );
  // An organisation-wide assignment is a role everywhere; a narrower one counts only when it
  // grants something there (never an organisation-level permission or the admin role, P01).
  const roleThere = reaching.some(
    (assignment) => assignment.environmentIds === null || grantedBy(assignment).length > 0,
  );
  return (
    roleThere &&
    (environment.kind !== 'production' ||
      permissionsForEnvironment(reaching, environment.id).has('environments:production'))
  );
}

/** The environments `assignments` let the user enter, in the order given. */
export function environmentsEntered<Environment extends EnterableEnvironment>(
  assignments: Iterable<EnvironmentRoleAssignment>,
  environments: readonly Environment[],
): Environment[] {
  const list = [...assignments];
  return environments.filter((environment) => mayEnter(list, environment));
}

export type UserPermissionsInEnvironment = (
  db: Db,
  user: UserPrincipal,
  environmentId: string,
) => Promise<ReadonlySet<Permission>>;

/**
 * What the signed-in `user` holds in `environmentId`, another environment of its organisation (a
 * promote's target): its stored assignments through {@link permissionsForEnvironment}. Nothing for
 * an environment of another organisation.
 */
export const userPermissionsInEnvironment: UserPermissionsInEnvironment = async (
  db,
  user,
  environmentId,
) => {
  const environment = await getEnvironment(db, environmentId);
  if (environment?.organizationId !== user.organizationId) {
    return new Set();
  }
  const assignments = await listUserRoleAssignments(db, user.organizationId, user.userId);
  return permissionsForEnvironment(assignments, environmentId);
};

export type MintablePermissions = (principal: Principal) => ReadonlySet<Permission>;

/**
 * What `principal` may grant a key it mints or clones in its own environment: its permissions, which
 * for a user session are already those of the session's environment, the key's
 * ({@link permissionsForEnvironment} in `findUserSessionContext`), and for a key its own.
 */
export const mintablePermissions: MintablePermissions = (principal) => principal.permissions;
