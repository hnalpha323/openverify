/**
 * The page pattern (C21, C23): a server component page renders through `renderPage`, which
 *
 * 1. reads the session (`GET /dashboard/me`, once per request); signed out → `/login`;
 * 2. sends a session that has not passed required MFA to `/account/security`, unless the page
 *    allows it;
 * 3. renders the forbidden panel when a permission is missing, without calling the API;
 * 4. runs the page with the session and the API client, mapping API failures: 401 → `/login`,
 *    401 `mfa-required` → `/account/security`, 403 → the forbidden panel, 404 → not found, and
 *    anything else to the page's error boundary (`error.tsx`).
 *
 * ```tsx
 * export default async function AccountsPage({ searchParams }: PageProps<'/accounts'>) {
 *   const query = await searchParams;
 *   return renderPage({ permissions: ['accounts:read'] }, async ({ api, session }) => {
 *     const page = await api.accounts.list({ page: { size: 25 } });
 *     return <PageMain>...</PageMain>;
 *   });
 * }
 * ```
 */
import 'server-only';
import type { Permission } from '@openverify/core';
import type { OpenVerifyClient } from '@openverify/node';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ForbiddenPanel } from '../../components/forbidden-panel';
import { PageMain } from '../../components/page-main';
import { getApiClient } from './client';
import { ForbiddenError, SECURITY_PATH, classifyApiError, redirectIfSignedOut } from './errors';
import { getSession, type DashboardSession } from './me';

export interface PageGuard {
  /** Every permission the page needs to show anything. */
  readonly permissions?: readonly Permission[];
  /** For the pages a session that has not passed required MFA may see (`/account/security`). */
  readonly allowWithoutMfa?: boolean;
}

export interface PageContext {
  readonly session: DashboardSession;
  /** The server API client of this request (`getApiClient()`). */
  readonly api: OpenVerifyClient;
}

function forbiddenPage(permissions: readonly Permission[]) {
  return (
    <PageMain width="narrow">
      <ForbiddenPanel permissions={permissions} headingLevel={1} />
    </PageMain>
  );
}

export async function renderPage(
  guard: PageGuard,
  render: (context: PageContext) => ReactNode | Promise<ReactNode>,
): Promise<ReactNode> {
  const session = await getSession();
  if (!session.mfaSatisfied && guard.allowWithoutMfa !== true) {
    redirect(SECURITY_PATH);
  }
  const missing = (guard.permissions ?? []).filter(
    (permission) => !session.permissions.has(permission),
  );
  if (missing.length > 0) {
    return forbiddenPage(missing);
  }
  try {
    return await render({ session, api: await getApiClient() });
  } catch (error) {
    redirectIfSignedOut(error);
    const kind = classifyApiError(error);
    if (kind === 'forbidden') {
      return forbiddenPage(error instanceof ForbiddenError ? error.permissions : []);
    }
    if (kind === 'not-found') {
      notFound();
    }
    throw error;
  }
}
