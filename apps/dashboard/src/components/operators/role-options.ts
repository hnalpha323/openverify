/**
 * Roles as the operator pages offer them (C15). An operator may grant only roles whose every
 * permission they hold themselves (C12's no-escalation rule); the API refuses the others, so the
 * pages offer only those. Computed on the server and handed to client components as plain data.
 */
import type { RoleResource } from '@openverify/contracts';
import { BUILTIN_ROLE_KEYS, type Permission } from '@openverify/core';

export interface RoleOption {
  readonly id: string;
  readonly name: string;
  readonly builtin: boolean;
  /** Whether the operator holds every permission of the role, so may grant it. */
  readonly grantable: boolean;
}

/** The position of a built-in role in the usual order (admin first), custom roles after. */
function builtinRank(role: RoleResource): number {
  const key = role.attributes.key;
  return key === null ? BUILTIN_ROLE_KEYS.length : BUILTIN_ROLE_KEYS.indexOf(key);
}

/** Built-in roles first, in their usual order, then custom roles by name. */
export function sortRoles(roles: readonly RoleResource[]): RoleResource[] {
  return [...roles].sort(
    (left, right) =>
      builtinRank(left) - builtinRank(right) ||
      left.attributes.name.localeCompare(right.attributes.name, 'en'),
  );
}

/** Every role, with whether an operator holding `held` may grant it. */
export function roleOptions(
  roles: readonly RoleResource[],
  held: ReadonlySet<Permission>,
): RoleOption[] {
  return sortRoles(roles).map((role) => ({
    id: role.id,
    name: role.attributes.name,
    builtin: role.attributes.builtin,
    grantable: role.attributes.permissions.every((permission) => held.has(permission)),
  }));
}

/** The names of `roleIds`, in that order; a role not in `roles` keeps its ID. */
export function roleNames(roleIds: readonly string[], roles: readonly RoleResource[]): string[] {
  const names = new Map(roles.map((role) => [role.id, role.attributes.name]));
  return roleIds.map((id) => names.get(id) ?? id);
}
