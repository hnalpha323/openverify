/**
 * `dashboard-settings`' mock routes and documents (Workflow 9C: C167 to C170, C174.6): what the role
 * editor may grant, a user's assignments, the caller's sessions, notification preferences, a key
 * rotation and a delivery search, as the API answers them (each built through its contract schema
 * in the tests that read it). Paths are after `/api/v1`; every value is synthetic.
 */
import {
  API_KEY_ROTATE_PREVIOUS_MAX_SECONDS,
  type GrantableDocument,
  type RoleAssignment,
} from '@openverify/contracts';
import {
  PERMISSIONS,
  USER_NOTIFICATION_KINDS,
  type Permission,
  type UserNotificationKind,
} from '@openverify/core';
import { ROLE_IDS, USER_IDS } from '../../components/operators/test-fixtures';
import {
  AT,
  INTEGRATION_IDS,
  LATER,
  apiKeyResource,
  apiKeyToken,
  deliveryResource,
} from '../../components/integrations/testing-fixtures';
import { ENVIRONMENTS } from '../api-mock';
import type { RouteApi } from '../api-routes';

export const SETTINGS_IDS = {
  sandbox: ENVIRONMENTS.sandbox.id,
  production: ENVIRONMENTS.production.id,
  caller: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y46',
  currentSession: 'uss_01J9ZK3M5Q7R8S9T0V1W2X3S01',
  otherSession: 'uss_01J9ZK3M5Q7R8S9T0V1W2X3S02',
  rotatedKey: 'key_01J9ZK3M5Q0000000000000069',
} as const;

export { ROLE_IDS, USER_IDS };

/** The paths this area's pages call, after `/api/v1`. */
export const SETTINGS_PATHS = {
  grantable: '/dashboard/roles/grantable',
  userRoles: (id: string) => `/dashboard/users/${id}/roles`,
  reactivate: (id: string) => `/dashboard/users/${id}/reactivate`,
  resetMfa: (id: string) => `/dashboard/users/${id}/reset-mfa`,
  resend: (id: string) => `/dashboard/invitations/${id}/resend`,
  sessions: '/dashboard/sessions',
  revokeSession: (id: string) => `/dashboard/sessions/${id}/revoke`,
  revokeOthers: '/dashboard/sessions/revoke-others',
  stepUp: '/dashboard/sessions/current/step-up',
  preferences: '/dashboard/notification-preferences',
  rotate: (id: string) => `/api-keys/${id}/rotate`,
  deliverySearch: '/webhook-deliveries/search',
  settings: '/dashboard/settings',
  auditLogs: '/dashboard/audit-logs',
} as const;

type Scope = GrantableDocument['data']['attributes']['scopes'][number];

/**
 * One grantable scope: every permission, refused `not-held` unless `held`, and refused
 * `organization-level` outside an organisation-wide scope for `users:*` and `roles:*`; the
 * built-in admin role grantable only organisation-wide.
 */
export function grantableScope(
  environmentId: string | null,
  held: readonly Permission[] = PERMISSIONS,
): Scope {
  const organisationLevel = (permission: Permission) =>
    permission.startsWith('users:') || permission.startsWith('roles:');
  return {
    'environment-id': environmentId,
    permissions: PERMISSIONS.map((permission) => {
      const reason = !held.includes(permission)
        ? ('not-held' as const)
        : environmentId !== null && organisationLevel(permission)
          ? ('organization-level' as const)
          : null;
      return { permission, grantable: reason === null, reason };
    }),
    roles: Object.entries(ROLE_IDS).map(([key, id]) => {
      const reason =
        key === 'admin' && environmentId !== null ? ('admin-organization-wide' as const) : null;
      return { 'role-id': id, grantable: reason === null, reason };
    }),
  };
}

/** `GET /dashboard/roles/grantable`: the sandbox, production, then organisation-wide. */
export function grantableDocument(
  held: readonly Permission[] = PERMISSIONS,
  scopes: readonly Scope[] = [
    grantableScope(SETTINGS_IDS.sandbox, held),
    grantableScope(SETTINGS_IDS.production, held),
    grantableScope(null, held),
  ],
): GrantableDocument {
  return {
    data: {
      type: 'grantable',
      id: SETTINGS_IDS.caller,
      attributes: { scopes: [...scopes] },
    },
  };
}

/** `PUT /dashboard/users/:id/roles`' answer. */
export function userRoleAssignmentsDocument(id: string, assignments: readonly RoleAssignment[]) {
  return { data: { type: 'user-role-assignments', id, attributes: { assignments } } };
}

/** One of the caller's sessions. */
export function sessionResource(
  id: string,
  overrides: Partial<{
    device: string | null;
    current: boolean;
    'created-at': string;
    'last-seen-at': string;
    'expires-at': string;
    'mfa-verified-at': string | null;
    'provider-amr': string[] | null;
  }> = {},
) {
  return {
    type: 'user-session' as const,
    id,
    attributes: {
      device: 'Firefox on Linux',
      'created-at': AT,
      'last-seen-at': LATER,
      'expires-at': '2026-10-20T16:35:00.000Z',
      current: false,
      'mfa-verified-at': null,
      // C248.6 (KP11-26, fix-server's checkpoint): `null` for a password sign-in.
      'provider-amr': null,
      ...overrides,
    },
  };
}

/** `GET /dashboard/sessions`: the current session first, then another. */
export function sessionsDocument() {
  return {
    data: [
      sessionResource(SETTINGS_IDS.currentSession, { current: true, device: 'Chrome on macOS' }),
      sessionResource(SETTINGS_IDS.otherSession, { device: null }),
    ],
    links: { next: null },
  };
}

/** One kind's channels. */
interface Channels {
  console: boolean;
  email: boolean;
}

/** Every notification kind with the API's defaults (console on, email off), then `changes`. */
export function preferences(
  changes: Partial<Record<UserNotificationKind, Channels>> = {},
): Record<UserNotificationKind, Channels> {
  return Object.fromEntries(
    USER_NOTIFICATION_KINDS.map((kind) => [kind, changes[kind] ?? { console: true, email: false }]),
  ) as Record<UserNotificationKind, Channels>;
}

/** `GET`/`PUT /dashboard/notification-preferences`. */
export function preferencesDocument(changes: Partial<Record<UserNotificationKind, Channels>> = {}) {
  return {
    data: {
      type: 'notification-preferences',
      id: SETTINGS_IDS.caller,
      attributes: { preferences: preferences(changes) },
    },
  };
}

/** `POST /api-keys/:id/rotate`'s answer: a new key, its token once, and the old key's end. */
export function rotatedKeyDocument(previousExpiresAt = LATER) {
  return {
    data: apiKeyResource({ 'created-at': LATER }, SETTINGS_IDS.rotatedKey),
    meta: {
      token: apiKeyToken('r'),
      'previous-key-id': INTEGRATION_IDS.apiKey,
      'previous-expires-at': previousExpiresAt,
    },
  };
}

/** The longest end of a rotated key's old token, in seconds (30 days). */
export const MAX_PREVIOUS_SECONDS = API_KEY_ROTATE_PREVIOUS_MAX_SECONDS;

/** `POST /webhook-deliveries/search`'s answer: one delivery and the next cursor. */
export function deliverySearchDocument(next: string | null = null) {
  return {
    data: [deliveryResource()],
    links: { next },
  };
}

/** Registers the reads every settings page of this area makes, on a test's `routeApi()`. */
export function serveSettingsReads(api: RouteApi): RouteApi {
  return api
    .on('GET', SETTINGS_PATHS.grantable, 200, grantableDocument())
    .on('GET', SETTINGS_PATHS.sessions, 200, sessionsDocument())
    .on('GET', SETTINGS_PATHS.preferences, 200, preferencesDocument());
}
