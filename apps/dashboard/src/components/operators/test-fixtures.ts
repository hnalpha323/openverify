/**
 * Synthetic C15 documents for the operator pages' tests (users, roles, audit logs, settings).
 * No real people: every ID is a made-up ULID, every email is on `example.test`.
 */
import type {
  DashboardSettings,
  RoleResource,
  UserAuditLogResource,
  UserResource,
} from '@openverify/contracts';
import { BUILTIN_ROLES, type BuiltinRoleKey, type Permission } from '@openverify/core';

export const CREATED_AT = '2026-10-20T04:35:00.000Z';
export const UPDATED_AT = '2026-10-20T04:40:00.000Z';

export const ROLE_IDS = {
  admin: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y60',
  developer: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y61',
  reviewer: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y62',
  viewer: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y63',
  support: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y64',
} as const;

export const USER_IDS = {
  admin: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y70',
  reviewer: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y71',
  invited: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y72',
  deactivated: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y73',
} as const;

export const AUDIT_IDS = {
  first: 'aud_01J9ZK3M5Q7R8S9T0V1W2X3Y80',
  second: 'aud_01J9ZK3M5Q7R8S9T0V1W2X3Y81',
} as const;

export const API_KEY_ID = 'key_01J9ZK3M5Q7R8S9T0V1W2X3Y90';
export const INQUIRY_ID = 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y91';

/** A built-in role as the API sends it. */
export function builtinRole(key: BuiltinRoleKey): RoleResource {
  return {
    type: 'role',
    id: ROLE_IDS[key],
    attributes: {
      name: BUILTIN_ROLES[key].name,
      key,
      builtin: true,
      permissions: [...BUILTIN_ROLES[key].permissions],
      'created-at': CREATED_AT,
      'updated-at': CREATED_AT,
    },
  };
}

/** A custom role (by default "Support": inquiries read and write). */
export function customRole(
  overrides: { id?: string; name?: string; permissions?: readonly Permission[] } = {},
): RoleResource {
  return {
    type: 'role',
    id: overrides.id ?? ROLE_IDS.support,
    attributes: {
      name: overrides.name ?? 'Support',
      key: null,
      builtin: false,
      permissions: [...(overrides.permissions ?? ['inquiries:read', 'inquiries:write'])],
      'created-at': CREATED_AT,
      'updated-at': UPDATED_AT,
    },
  };
}

/** Every role of the synthetic organization, newest first as the API lists them. */
export function allRoles(): RoleResource[] {
  return [
    customRole(),
    builtinRole('viewer'),
    builtinRole('reviewer'),
    builtinRole('developer'),
    builtinRole('admin'),
  ];
}

export function user(
  overrides: {
    id?: string;
    email?: string;
    name?: string | null;
    status?: 'invited' | 'active' | 'deactivated';
    roleIds?: readonly string[];
    /** `mfa-enabled`, left out unless given (an API before Workflow 2C sends none). */
    mfaEnabled?: boolean;
  } = {},
): UserResource {
  return {
    type: 'user',
    id: overrides.id ?? USER_IDS.admin,
    attributes: {
      email: overrides.email ?? 'admin@example.test',
      name: overrides.name === undefined ? 'Synthetic Admin' : overrides.name,
      status: overrides.status ?? 'active',
      ...(overrides.mfaEnabled === undefined ? {} : { 'mfa-enabled': overrides.mfaEnabled }),
      'created-at': CREATED_AT,
      'updated-at': UPDATED_AT,
    },
    relationships: {
      roles: {
        data: (overrides.roleIds ?? [ROLE_IDS.admin]).map((id) => ({ type: 'role', id })),
      },
    },
  };
}

/** The synthetic organization's operators: an admin, a reviewer, one invited, one deactivated. */
export function allUsers(): UserResource[] {
  return [
    user(),
    user({
      id: USER_IDS.reviewer,
      email: 'reviewer@example.test',
      name: 'Synthetic Reviewer',
      roleIds: [ROLE_IDS.reviewer],
    }),
    user({
      id: USER_IDS.invited,
      email: 'invited@example.test',
      name: null,
      status: 'invited',
      roleIds: [ROLE_IDS.viewer],
    }),
    user({
      id: USER_IDS.deactivated,
      email: 'gone@example.test',
      name: 'Synthetic Former',
      status: 'deactivated',
      roleIds: [ROLE_IDS.support],
    }),
  ];
}

export function auditLog(
  overrides: Partial<UserAuditLogResource['attributes']> & { id?: string } = {},
): UserAuditLogResource {
  const { id, ...attributes } = overrides;
  return {
    type: 'user-audit-log',
    id: id ?? AUDIT_IDS.first,
    attributes: {
      action: 'inquiry.approved',
      actor: { type: 'user', id: USER_IDS.reviewer },
      'resource-type': 'inquiry',
      'resource-id': INQUIRY_ID,
      'ip-address': '192.0.2.10',
      'user-agent': 'Synthetic Browser/1.0',
      metadata: { from: 'needs_review', to: 'approved' },
      'created-at': CREATED_AT,
      ...attributes,
    },
  };
}

export function settings(overrides: Partial<DashboardSettings> = {}): DashboardSettings {
  return {
    'require-mfa': false,
    'inquiry-retention-days': null,
    'api-log-retention-days': 30,
    'webhook-delivery-retention-days': 30,
    'event-retention-days': 90,
    // C42.4, C42.6: Phase 4 servers send the face template settings too.
    'face-template-retention-days': 365,
    'face-search-max-templates': 50_000,
    ...overrides,
  };
}

/** `{ data, links }` of a list answer. */
export function listOf<Resource>(data: Resource[], next: string | null = null) {
  return { data, links: { next } };
}
