/**
 * Synthetic principals (C12) and an in-memory user-session resolver, so tests can call the
 * server API as a dashboard user with chosen permissions without the operators' database
 * tables. Only tests import this folder.
 */
import { newId, newUserSessionToken } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import type { ApiKeyPrincipal, PrincipalResolver, UserPrincipal } from '../ports.js';

interface TenantOptions {
  organizationId: string;
  environmentId: string;
  /** Defaults to `sandbox`. */
  environmentKind?: 'sandbox' | 'production';
  /** Defaults to every permission (an admin, or a key with every scope). */
  permissions?: Iterable<Permission>;
}

export interface TestUserPrincipalOptions extends TenantOptions {
  /** Defaults to true. */
  mfaSatisfied?: boolean;
  /** Defaults to a new `usr_` id. */
  userId?: string;
  /** Defaults to a new `uss_` id. */
  userSessionId?: string;
}

export interface TestApiKeyPrincipalOptions extends TenantOptions {
  /** Defaults to a new `key_` id. */
  apiKeyId?: string;
}

/** A dashboard user principal: by default an admin whose session satisfied MFA. */
export function userPrincipal(options: TestUserPrincipalOptions): UserPrincipal {
  return {
    kind: 'user',
    userId: options.userId ?? newId('usr'),
    userSessionId: options.userSessionId ?? newId('uss'),
    organizationId: options.organizationId,
    environmentId: options.environmentId,
    environmentKind: options.environmentKind ?? 'sandbox',
    permissions: new Set(options.permissions ?? PERMISSIONS),
    mfaSatisfied: options.mfaSatisfied ?? true,
  };
}

/** An API key principal: by default holding every permission. */
export function apiKeyPrincipal(options: TestApiKeyPrincipalOptions): ApiKeyPrincipal {
  return {
    kind: 'api-key',
    apiKeyId: options.apiKeyId ?? newId('key'),
    organizationId: options.organizationId,
    environmentId: options.environmentId,
    environmentKind: options.environmentKind ?? 'sandbox',
    permissions: new Set(options.permissions ?? PERMISSIONS),
  };
}

export interface TestUserSessions {
  /** Inject as `resolveUserSession`: a token resolves to the principal it was issued for. */
  readonly resolve: PrincipalResolver;
  /** A new `ovu_` token for `principal`. */
  issue(principal: UserPrincipal): string;
  /** The token stops resolving, as after logout or deactivation. */
  revoke(token: string): void;
}

/** User sessions held in memory, in place of the operators' resolver. */
export function createTestUserSessions(): TestUserSessions {
  const sessions = new Map<string, UserPrincipal>();
  return {
    resolve: (token) => Promise.resolve(sessions.get(token) ?? null),
    issue(principal) {
      const token = newUserSessionToken();
      sessions.set(token, principal);
      return token;
    },
    revoke(token) {
      sessions.delete(token);
    },
  };
}
