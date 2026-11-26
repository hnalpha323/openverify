import { dashboardMeDocumentSchema, sessionExpiredReasonSchema } from '@openverify/contracts';
import { NextResponse } from 'next/server';
import { apiRequest } from '../../../lib/api/client';
import { classifyApiError } from '../../../lib/api/errors';
import { clearSessionCookie, getSessionToken } from '../../../lib/session';

/** The sign-in page's notice for each limit (`app/login/page.tsx`). */
const NOTICE = { idle: 'session-idle', absolute: 'session-absolute' } as const;

function redirectTo(request: Request, path: string): Response {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set('cache-control', 'private, no-store');
  return response;
}

/**
 * `GET /login/signed-out?reason=idle|absolute` (C245.2, Phase 11 Workflow 11B, auth-sessions): where
 * the console sends an operator whose session the API ended for inactivity or age
 * (`redirectIfSignedOut`). It clears the session cookie only after the API has refused the session
 * again, so a link from another site cannot sign a live operator out (a live session goes home, an
 * unreachable API keeps the cookie), then shows the sign-in page with the reason in words. The
 * reason in the URL only picks those words; it decides nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = sessionExpiredReasonSchema.safeParse(
    new URL(request.url).searchParams.get('reason'),
  );
  const signIn = parsed.success ? `/login?reason=${NOTICE[parsed.data]}` : '/login';
  if ((await getSessionToken()) === null) {
    return redirectTo(request, signIn);
  }
  try {
    await apiRequest({ method: 'GET', path: '/dashboard/me', schema: dashboardMeDocumentSchema });
    return redirectTo(request, '/');
  } catch (error) {
    if (classifyApiError(error) !== 'unauthenticated') {
      return redirectTo(request, '/login');
    }
  }
  await clearSessionCookie();
  return redirectTo(request, signIn);
}
