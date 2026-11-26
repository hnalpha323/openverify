/**
 * Who the operator is and what they may do here (C15, C21): `GET /dashboard/me`, read once per
 * server render (React `cache`), shared by the layout, the navigation and the page.
 *
 * Hiding navigation and buttons without a permission is UX only: the API enforces every
 * permission itself.
 */
import 'server-only';
import { dashboardMeDocumentSchema } from '@openverify/contracts';
import type { EnvironmentKind } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { cache } from 'react';
import type { z } from 'zod';
import { apiRequest } from './client';
import { ForbiddenError, redirectIfSignedOut } from './errors';

export interface SessionEnvironment {
  readonly id: string;
  readonly kind: EnvironmentKind;
}

export interface DashboardSession {
  readonly user: { readonly id: string; readonly email: string; readonly name: string | null };
  /** Where the session works now. */
  readonly environment: SessionEnvironment;
  /**
   * The organization's environments, from `GET /dashboard/me` `meta.environments`; the switcher
   * offers those the role allows. An API that sends no list leaves only the current one.
   */
  readonly environments: readonly SessionEnvironment[];
  readonly permissions: ReadonlySet<Permission>;
  /** False while the organization requires MFA and this session has not passed it. */
  readonly mfaSatisfied: boolean;
}

/**
 * The operator's session. Without a session cookie, or when the API refuses it, the operator
 * is sent to sign in.
 * @throws {Error} when the API sends no session context (an API older than Phase 2).
 */
export const getSession = cache(async (): Promise<DashboardSession> => {
  let document: z.output<typeof dashboardMeDocumentSchema>;
  try {
    document = await apiRequest({
      method: 'GET',
      path: '/dashboard/me',
      schema: dashboardMeDocumentSchema,
    });
  } catch (error) {
    redirectIfSignedOut(error);
    throw error;
  }
  const { data: user, meta } = document;
  if (meta === undefined) {
    throw new Error('GET /dashboard/me sent no session context');
  }
  return {
    user: { id: user.id, email: user.attributes.email, name: user.attributes.name ?? null },
    environment: meta.environment,
    environments: meta.environments ?? [meta.environment],
    permissions: new Set(meta.permissions),
    mfaSatisfied: meta['mfa-satisfied'],
  };
});

/** Whether `session` holds every one of `permissions`. */
export function hasPermission(
  session: Pick<DashboardSession, 'permissions'>,
  ...permissions: readonly Permission[]
): boolean {
  return permissions.every((permission) => session.permissions.has(permission));
}

/**
 * The session, when it holds every one of `permissions`.
 * @throws {ForbiddenError} naming the missing ones; `renderPage` shows the forbidden panel and
 *   `runAction` answers "You do not have access".
 */
export async function requirePermission(
  ...permissions: readonly Permission[]
): Promise<DashboardSession> {
  const session = await getSession();
  const missing = permissions.filter((permission) => !session.permissions.has(permission));
  if (missing.length > 0) {
    throw new ForbiddenError(missing);
  }
  return session;
}
