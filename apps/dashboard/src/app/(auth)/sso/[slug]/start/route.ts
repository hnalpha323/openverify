/**
 * `GET /sso/<sign-in name>/start` (C248.4; review F21): the console's start of an OIDC sign-in.
 * It asks the API for the provider's authorization URL and the browser binding, sets the binding as
 * the host-only cookie (HttpOnly, Secure, SameSite=Lax because the identity provider's redirect back
 * is a cross-site top-level GET, path `/`, 10 minutes) and sends the browser to the provider. An
 * organisation with several providers is asked to choose on the sign-in page; any failure returns to
 * the sign-in page with one generic sentence.
 */
import {
  SSO_LOGIN_STATE_TTL_SECONDS,
  idSchema,
  organizationSlugSchema,
} from '@openverify/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { secureCookies } from '../../../../../lib/config';
import {
  SSO_RETURN_COOKIE,
  returnPathOf,
  ssoBindingCookieName,
  ssoFailureReason,
  startSso,
} from '../../sso-bff';

const providerIdSchema = idSchema('ssop');

function toLogin(request: NextRequest, query: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/login?${query}`, request.url), 303);
  response.headers.set('cache-control', 'no-store');
  return response;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const providerId = request.nextUrl.searchParams.get('provider-id');
  const returnTo = request.nextUrl.searchParams.get('return-to');
  const notConfigured = `reason=${ssoFailureReason('sso_not_configured')}`;
  if (
    !organizationSlugSchema.safeParse(slug).success ||
    (providerId !== null && !providerIdSchema.safeParse(providerId).success) ||
    (returnTo !== null && returnPathOf(returnTo) === null)
  ) {
    return toLogin(request, notConfigured);
  }
  const outcome = await startSso(
    slug,
    {
      ...(providerId === null ? {} : { providerId }),
      ...(returnTo === null ? {} : { returnTo }),
    },
    request.headers.get('user-agent'),
  );
  if (outcome.kind === 'choose') {
    return toLogin(request, `sso=${encodeURIComponent(slug)}`);
  }
  if (outcome.kind === 'failed') {
    return toLogin(request, `reason=${ssoFailureReason(outcome.failure)}`);
  }
  const response = NextResponse.redirect(outcome.authorizationUrl, 303);
  response.headers.set('cache-control', 'no-store');
  // C248.4: host-only (no Domain), path `/`, HttpOnly, Secure where the console can be; Lax, because
  // the provider's redirect back is a cross-site top-level GET that a Strict cookie would miss.
  response.cookies.set(ssoBindingCookieName(), outcome.binding, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: SSO_LOGIN_STATE_TTL_SECONDS,
  });
  if (returnTo !== null) {
    response.cookies.set(SSO_RETURN_COOKIE, returnTo, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'lax',
      path: '/sso/',
      maxAge: SSO_LOGIN_STATE_TTL_SECONDS,
    });
  }
  return response;
}
