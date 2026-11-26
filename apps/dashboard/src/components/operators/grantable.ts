/**
 * What the role editor and the assignments dialog may offer (C167.2, C167.4), from
 * `GET /dashboard/roles/grantable` (per environment of the organisation, then organisation-wide):
 * a grant the API would refuse is never offered, and each refused one says why. Plain data, computed
 * on the server and handed to the client components.
 */
import type { GrantableDocument } from '@openverify/contracts';
import { permissionLevel, type Permission } from '@openverify/core';

export type GrantableScopeData = GrantableDocument['data']['attributes']['scopes'][number];

export interface EnvironmentSummary {
  readonly id: string;
  readonly kind: 'sandbox' | 'production';
}

const KIND_NAMES = { sandbox: 'Sandbox', production: 'Production' } as const;

const nameOf = (environments: readonly EnvironmentSummary[], id: string) => {
  const kind = environments.find((environment) => environment.id === id)?.kind;
  return kind === undefined ? id : KIND_NAMES[kind];
};

/**
 * The permissions the role editor cannot grant, each with its reason in words. An environment-level
 * permission must be grantable in every environment, because the role may be assigned in any of
 * them; an organisation-level one (`users:*`, `roles:*`) takes effect only organisation-wide, so the
 * organisation-wide scope decides it.
 */
export function roleEditorRefusals(
  scopes: readonly GrantableScopeData[],
  environments: readonly EnvironmentSummary[],
): ReadonlyMap<Permission, string> {
  const refusals = new Map<Permission, string>();
  const organisation = scopes.find((scope) => scope['environment-id'] === null);
  const perEnvironment = scopes.filter((scope) => scope['environment-id'] !== null);
  const permissions = new Set(
    scopes.flatMap((scope) => scope.permissions.map((entry) => entry.permission)),
  );
  for (const permission of permissions) {
    if (permissionLevel(permission) === 'organization') {
      const entry = organisation?.permissions.find((each) => each.permission === permission);
      if (entry !== undefined && !entry.grantable) {
        refusals.set(permission, 'You do not hold it organisation-wide, so you cannot grant it.');
      }
      continue;
    }
    const missing = perEnvironment
      .filter((scope) =>
        scope.permissions.some(
          (entry) => entry.permission === permission && entry.reason === 'not-held',
        ),
      )
      .map((scope) => nameOf(environments, scope['environment-id'] ?? ''));
    if (missing.length > 0) {
      refusals.set(
        permission,
        `You do not hold it in ${missing.join(' or ')}, so you cannot grant it.`,
      );
    }
  }
  return refusals;
}

/**
 * C167.4: the permissions marked sensitive in the editor: personal data, privacy settings, every
 * redaction and export, production, and workflow secrets.
 */
export function isSensitivePermission(permission: Permission): boolean {
  return (
    permission === 'pii:view' ||
    permission === 'settings:privacy' ||
    permission === 'environments:production' ||
    permission.endsWith(':redact') ||
    permission.endsWith(':export') ||
    permission.startsWith('secrets:')
  );
}

export interface AssignmentScopeOption {
  /** `all` (organisation-wide: every current and future environment) or an `env_` id. */
  readonly value: string;
  readonly label: string;
  /** Why the caller may not grant the role there, or `null`. */
  readonly refusal: string | null;
}

const REFUSALS = {
  'not-held': 'You do not hold every permission of this role there, so you cannot grant it.',
  'organization-level':
    'This role holds an organisation-level permission (users or roles), granted organisation-wide only.',
  'admin-organization-wide': 'The built-in admin role is granted organisation-wide only.',
} as const;

/**
 * Where a role can be assigned (C167.2): organisation-wide, or one environment, each with the API's
 * refusal for this caller in words.
 */
export function assignmentScopes(
  roleId: string,
  scopes: readonly GrantableScopeData[],
  environments: readonly EnvironmentSummary[],
): AssignmentScopeOption[] {
  const refusalIn = (scope: GrantableScopeData | undefined) => {
    const entry = scope?.roles.find((role) => role['role-id'] === roleId);
    return entry === undefined || entry.reason === null ? null : REFUSALS[entry.reason];
  };
  const organisation = scopes.find((scope) => scope['environment-id'] === null);
  return [
    {
      value: 'all',
      label: 'Every environment, current and future',
      refusal: refusalIn(organisation),
    },
    ...scopes
      .filter((scope) => scope['environment-id'] !== null)
      .map((scope) => ({
        value: scope['environment-id'] ?? '',
        label: `${nameOf(environments, scope['environment-id'] ?? '')} only`,
        refusal: refusalIn(scope),
      })),
  ];
}
