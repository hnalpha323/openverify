/**
 * `GET /sso/start?organization=<sign-in name>` (C248.8; ours): the sign-in page's single sign-on
 * form is a plain GET form (no script, no server action), and this handler sends it on to
 * `/sso/<sign-in name>/start`. A name that is not one goes back to the sign-in page with the same
 * sentence as an unknown one.
 */
import { organizationSlugSchema } from '@openverify/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { ssoFailureReason } from '../sso-bff';

export function GET(request: NextRequest): Promise<Response> {
  const value = (request.nextUrl.searchParams.get('organization') ?? '').trim().toLowerCase();
  const parsed = organizationSlugSchema.safeParse(value);
  const path = parsed.success
    ? `/sso/${parsed.data}/start`
    : `/login?reason=${ssoFailureReason('sso_not_configured')}`;
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set('cache-control', 'no-store');
  return Promise.resolve(response);
}
