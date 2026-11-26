/**
 * Permissions and built-in roles (contracts C12 and C15). An API key holds API scopes; a
 * dashboard user holds the union of its roles' permissions. A server API route declares one
 * permission, and a principal without it gets 403.
 */
import { z } from 'zod';

/** Scopes an API key can hold (C2, then C12). Each is also a user permission. */
export const API_SCOPES = Object.freeze([
  'inquiries:read',
  'inquiries:write',
  'inquiry-templates:read',
  'inquiry-templates:write',
  'verifications:read',
  'webhooks:read',
  'webhooks:write',
  'events:read',
  'accounts:read',
  'accounts:write',
  'accounts:redact',
  'inquiries:redact',
  'inquiry-sessions:read',
  'inquiry-sessions:write',
  'inquiry-templates:publish',
  'api-keys:read',
  'api-keys:write',
  'api-logs:read',
  'audit-logs:read',
  // C55.11 (Phase 5, decision 13): `POST /sandbox/sms-messages/search`, the sandbox SMS sink.
  'sandbox:read',
  // C72.2 (Phase 6): reports (create, tags, pause, resume and run are `reports:write`; dismiss and
  // review `reports:review`), report templates and the watchlist sources page.
  'reports:read',
  'reports:write',
  'reports:review',
  'reports:redact',
  'report-templates:read',
  'report-templates:write',
  'report-templates:publish',
  'watchlists:read',
  // C97.3, C100.1 (Phase 7, Workflow 7B): lists, their items and matches, and CSV importers.
  'lists:read',
  'lists:write',
  'importers:read',
  'importers:write',
  // C102.1 (P11, F29): `graph:read` for every GET; `graph:write` for every write and for running,
  // re-running and cancelling queries.
  'graph:read',
  'graph:write',
  // C104.1, C105.6: transactions and their types; redaction is its own scope, as for inquiries.
  'transactions:read',
  'transactions:write',
  'transactions:redact',
  'transaction-types:write',
  // C112.5 (Phase 8, Workflow 8A): definitions, runs and secrets are separate reads, because a
  // viewer may read a definition (configuration only) and never a run's values (P11) or a secret's
  // metadata. Publishing and triggering are their own writes.
  'workflows:read',
  'workflows:write',
  'workflows:publish',
  'workflows:trigger',
  'workflow-runs:read',
  'workflow-runs:write',
  'workflow-runs:redact',
  'secrets:read',
  'secrets:write',
  // C127.9, C143.9: Trust Device's mark; a device is read with `inquiry-sessions:read`.
  'devices:write',
  // C129.4 (Phase 8, Workflow 8B): `cases:write` covers resolving, single and bulk, and taking the
  // next case; assigning others, redacting and exporting are their own. `cases:export` is no `:read`,
  // so a viewer never holds it. `case-queues:write` also covers policies and calendars.
  'cases:read',
  'cases:write',
  'cases:assign',
  'cases:redact',
  'cases:export',
  'case-templates:read',
  'case-templates:write',
  'case-templates:publish',
  'case-queues:read',
  'case-queues:write',
  // C167.1 (Phase 9, Workflow 9A): theme sets have their own scopes (decision 29), so a reviewer
  // cannot restyle a consent screen; deployments are the read-only history of publishes (C154.7).
  // Translations use `inquiry-templates:*`, and allowed origins are settings (`settings:write`).
  'theme-sets:read',
  'theme-sets:write',
  'deployments:read',
  // C167.1, C164.8, C166.2 (Phase 9, Workflow 9B): the read-only analytics (counts and rates, no
  // personal data), and an export permission per object type. No `:export` is a `:read`, so a
  // viewer never holds one, and each is admin's alone by default (Phase 8 decision 68's rule).
  'analytics:read',
  'inquiries:export',
  'verifications:export',
  'accounts:export',
  'reports:export',
  'lists:export',
  'transactions:export',
  // C240.1 (Phase 11, Workflow 11A): Connect. `:write` on connections creates, deactivates,
  // reactivates and changes a policy; `:write` on share tokens creates and expires them and
  // withdraws a consent. Redeeming, peeking and attesting a consent are each their own scope:
  // attesting is never implied by `connect-share-tokens:write`, so the key that creates tokens
  // cannot also attest the consent that authorises them unless both are granted on purpose (P03).
  'connect-connections:read',
  'connect-connections:write',
  'connect-share-tokens:read',
  'connect-share-tokens:write',
  'connect-share-tokens:redeem',
  'connect-share-tokens:peek',
  'connect-consent-records:attest',
  // C253.1 (Phase 11, Workflow 11B; Stage 1a amendment 20): the per-account access export, every
  // route of it (create, read, manifest, files). Not Phase 9's `accounts:export` (the accounts list's
  // CSV), not a `:read` (so no viewer holds it), environment-level and admin's alone by default: one
  // key exporting every account in turn is the platform's widest exfiltration path (review P16).
  'account-access:export',
] as const);

export const apiScopeSchema = z.enum(API_SCOPES);
export type ApiScope = z.infer<typeof apiScopeSchema>;

/**
 * Permissions only dashboard users hold. `pii:view` unmasks `fields`, `note` and session IP
 * and user agent, and allows file content; `settings:privacy` changes the collection and
 * profiling settings (C107.7); `environments:production` lets a session switch into production.
 */
export const OPERATOR_PERMISSIONS = Object.freeze([
  'pii:view',
  'users:read',
  'users:write',
  'roles:read',
  'roles:write',
  'settings:read',
  'settings:write',
  // C90.8, C107.7 (Phase 7, F37, P10): the legal switches: the collection tiers, the
  // biometric-list basis, and graph indexing, weak kinds and components. Admin only.
  'settings:privacy',
  'environments:production',
  // C231.3, C240.1 (Phase 11, Workflow 11A): accepting a partner's share policy. Admin only, a user
  // session only (no API key holds it), with a second factor verified in the step-up window.
  'connect-connections:activate',
] as const);

/** Every permission (C15): the API scopes, then the operator permissions. */
export const PERMISSIONS = Object.freeze([...API_SCOPES, ...OPERATOR_PERMISSIONS] as const);

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSIONS);
const KNOWN_SCOPES: ReadonlySet<string> = new Set(API_SCOPES);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && KNOWN_PERMISSIONS.has(value);
}

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && KNOWN_SCOPES.has(value);
}

export const BUILTIN_ROLE_KEYS = Object.freeze([
  'admin',
  'developer',
  'reviewer',
  'viewer',
] as const);
export type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number];

export interface BuiltinRole {
  readonly key: BuiltinRoleKey;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

function role(key: BuiltinRoleKey, name: string, permissions: readonly Permission[]): BuiltinRole {
  return Object.freeze({ key, name, permissions: Object.freeze([...permissions]) });
}

/**
 * Read permissions a viewer does not get: the API and audit logs, the sandbox SMS sink, which
 * serves one-time codes (C55.11), the graph, whose results are profiling (C102.1, P11), workflow
 * runs, whose values are the subject's (C112.5, P11), and workflow secrets' metadata (C125.2).
 * Theme sets, deployments and analytics are not here (C167.1): styles, a publish history and
 * suppressed counts hold no personal data, so a viewer reads all three. The per-reviewer view of
 * case analytics also needs `users:write` (C164.5), which no viewer holds.
 */
const NOT_FOR_VIEWERS: readonly Permission[] = [
  'api-logs:read',
  'audit-logs:read',
  'sandbox:read',
  'graph:read',
  'workflow-runs:read',
  'secrets:read',
  // C240.1 (Workflow 11A): none of these ends in `:read`, so the filter below never reaches them;
  // they are named here so the rule is written down: a viewer never peeks, attests or activates.
  'connect-share-tokens:peek',
  'connect-consent-records:attest',
  'connect-connections:activate',
  // C253.1 (Workflow 11B): not a `:read` either; named for the same reason.
  'account-access:export',
];

const VIEWER_PERMISSIONS = PERMISSIONS.filter(
  (permission) => permission.endsWith(':read') && !NOT_FOR_VIEWERS.includes(permission),
);

/**
 * The roles seeded in every organization (C15). They are stored as ordinary role rows with
 * `builtin: true` and this `key`, and cannot be edited or deleted.
 */
export const BUILTIN_ROLES: Readonly<Record<BuiltinRoleKey, BuiltinRole>> = Object.freeze({
  admin: role('admin', 'Admin', PERMISSIONS),
  developer: role('developer', 'Developer', [
    'inquiry-templates:read',
    'inquiry-templates:write',
    'inquiry-templates:publish',
    'webhooks:read',
    'webhooks:write',
    'api-keys:read',
    'api-keys:write',
    'api-logs:read',
    'events:read',
    'inquiries:read',
    'inquiries:write',
    'inquiry-sessions:read',
    'inquiry-sessions:write',
    'accounts:read',
    'verifications:read',
    'environments:production',
    // C55.11: developers drive sandbox OTP flows against the SMS sink.
    'sandbox:read',
    // C72.2: every report scope but review and redaction.
    'reports:read',
    'reports:write',
    'report-templates:read',
    'report-templates:write',
    'report-templates:publish',
    'watchlists:read',
    // Workflow 7B (C72.2's rule): every list, graph and transaction scope but redaction.
    'lists:read',
    'lists:write',
    'importers:read',
    'importers:write',
    'graph:read',
    'graph:write',
    'transactions:read',
    'transactions:write',
    'transaction-types:write',
    // C112.5: every workflow and secret scope but run redaction, which is admin's (P35).
    'workflows:read',
    'workflows:write',
    'workflows:publish',
    'workflows:trigger',
    'workflow-runs:read',
    'workflow-runs:write',
    'secrets:read',
    'secrets:write',
    // C127.9: the publisher of a Trust Device step must hold its grant (C121.2).
    'devices:write',
    // C129.4 (decision 68): every case scope but `cases:export`, which is admin's.
    'cases:read',
    'cases:write',
    'cases:assign',
    'cases:redact',
    'case-templates:read',
    'case-templates:write',
    'case-templates:publish',
    'case-queues:read',
    'case-queues:write',
    // C167.1: the theme and deployment scopes, and analytics (Workflow 9B); no export.
    'theme-sets:read',
    'theme-sets:write',
    'deployments:read',
    'analytics:read',
    // C240.1 (Workflow 11A): the two Connect reads, as every built-in role holds them; every
    // Connect write, redeem, peek, attest and activate is admin's.
    'connect-connections:read',
    'connect-share-tokens:read',
  ]),
  reviewer: role('reviewer', 'Reviewer', [
    'inquiries:read',
    'inquiries:write',
    'inquiries:redact',
    'inquiry-sessions:read',
    'verifications:read',
    'accounts:read',
    'accounts:write',
    'accounts:redact',
    'events:read',
    // C72.2: reviewers read, review, run and redact reports, and read templates and sources.
    'reports:read',
    'reports:write',
    'reports:review',
    'reports:redact',
    'report-templates:read',
    'watchlists:read',
    // Workflow 7B: reviewers dismiss list matches, read imports, query the graph, and work and
    // redact transactions; they do not import lists or change transaction types.
    'lists:read',
    'lists:write',
    'importers:read',
    'graph:read',
    'graph:write',
    'transactions:read',
    'transactions:write',
    'transactions:redact',
    // C112.5: reviewers run case and account actions under C121.3, and follow them.
    'workflows:read',
    'workflows:trigger',
    'workflow-runs:read',
    // C127.9: trusting a device is a reversible, audited review outcome.
    'devices:write',
    // C129.4 (decision 68): reviewers work and assign cases, and read how they are set up. They
    // neither redact nor export a case.
    'cases:read',
    'cases:write',
    'cases:assign',
    'case-templates:read',
    'case-queues:read',
    'pii:view',
    // C167.1 (Workflow 9B): reviewers read analytics; they export nothing.
    'analytics:read',
    // C240.1 (Workflow 11A): the two Connect reads; a reviewer sees an inquiry's consent records.
    'connect-connections:read',
    'connect-share-tokens:read',
  ]),
  viewer: role('viewer', 'Viewer', VIEWER_PERMISSIONS),
});

/**
 * The permissions of a user holding `roles`: the union of their permissions. Unknown stored
 * values grant nothing, so a stale or tampered row fails closed.
 */
export function permissionsForRoles(
  roles: Iterable<{ readonly permissions: readonly string[] }>,
): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const { permissions } of roles) {
    for (const permission of permissions) {
      if (isPermission(permission)) {
        granted.add(permission);
      }
    }
  }
  return granted;
}

/** C167.2 (Phase 9, Workflow 9B; review P01): where a permission takes effect. */
export const PERMISSION_LEVELS = Object.freeze(['organization', 'environment'] as const);
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/**
 * C167.2 (review P01): the permissions effective only through an organisation-wide assignment
 * (`environment-ids: null`); the API refuses them in a narrower one (422 `role_scope_invalid`).
 */
export const ORGANIZATION_LEVEL_PERMISSIONS: readonly Permission[] = Object.freeze([
  'users:read',
  'users:write',
  'roles:read',
  'roles:write',
  // C231.9 (Workflow 11A; review P01): a connection carries both environment kinds' tokens.
  'connect-connections:write',
  'connect-connections:activate',
]);

/**
 * C167.2 (review P01): every permission's level. Users and roles are organisation rows, so
 * `users:*` and `roles:*` are organisation-level; every other permission, `settings:write` and
 * `environments:production` included, is environment-level (a sandbox-only `settings:write` changes
 * that environment's settings; `SETTING_LEVEL` names the organisation ones, V14).
 */
export const PERMISSION_LEVEL: Readonly<Record<Permission, PermissionLevel>> = Object.freeze(
  Object.fromEntries(
    PERMISSIONS.map((permission) => [
      permission,
      ORGANIZATION_LEVEL_PERMISSIONS.includes(permission) ? 'organization' : 'environment',
    ]),
  ) as Record<Permission, PermissionLevel>,
);

/** The level of `permission`. */
export function permissionLevel(permission: Permission): PermissionLevel {
  return PERMISSION_LEVEL[permission];
}

/**
 * C167.2 (verification round V14): the organisation settings, which `PATCH /dashboard/settings`
 * changes only for a caller holding `settings:write` through an organisation-wide assignment; every
 * setting not named here is the session environment's own: `require-mfa` and, since Workflow 11A,
 * `connect-inbound`, and every later organisation setting.
 */
export const SETTING_LEVEL: Readonly<Record<string, PermissionLevel>> = Object.freeze({
  'require-mfa': 'organization',
  // C231.10 (Phase 11, Workflow 11A; decision 71): the organisation's opt-in to inbound connections,
  // stored on the organisation beside `require-mfa`.
  'connect-inbound': 'organization',
  // C248.8 (Phase 11, Workflow 11B; Stage 1a amendment 10): the organisation's sign-in name, stored on
  // the organisation.
  'organization-slug': 'organization',
});

/** The level of a settings key: `SETTING_LEVEL`'s, else the environment's. */
export function settingLevel(setting: string): PermissionLevel {
  return Object.hasOwn(SETTING_LEVEL, setting)
    ? (SETTING_LEVEL[setting] ?? 'environment')
    : 'environment';
}

/**
 * The requested permissions that `held` lacks, in request order. A principal can only grant
 * (for example as API key scopes) what it holds itself, so a non-empty result means 403.
 */
export function missingPermissions(
  held: ReadonlySet<Permission>,
  requested: Iterable<Permission>,
): Permission[] {
  return [...requested].filter((permission) => !held.has(permission));
}
