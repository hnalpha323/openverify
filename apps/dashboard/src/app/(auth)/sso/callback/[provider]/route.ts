/**
 * `GET /sso/callback/<provider>` (C248.4; review P20): the per-provider redirect URI the operator
 * registers at its identity provider. It hands the provider's query, unchanged, and the browser
 * binding from its cookie to the API, clears the binding on every answer, and then opens the console
 * (201, the session cookie), continues to the second factor (202), returns from a step-up (200), or
 * goes back to the sign-in page with one generic sentence.
 */
import { idSchema, ssoBindingSchema } from '@openverify/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { secureCookies } from '../../../../../lib/config';
import {
  MFA_CHALLENGE_COOKIE,
  MFA_CHALLENGE_PATH,
  MFA_CHALLENGE_TTL_MS,
  encodeMfaChallenge,
} from '../../../../../lib/mfa-challenge';
import { sessionCookieName } from '../../../../../lib/session-cookie';
import {
  SSO_RETURN_COOKIE,
  finishSso,
  returnPathOf,
  ssoBindingCookieName,
  ssoFailureReason,
  type SsoCallbackOutcome,
} from '../../sso-bff';

const providerIdSchema = idSchema('ssop');

/** Where the console goes after a step-up, when the start named no return path. */
const STEP_UP_HOME = '/account/security';

/**
 * The page that continues to `/login/mfa`. A redirect would keep the identity provider's cross-site
 * navigation going, and browsers withhold the second-factor challenge's SameSite=Strict cookie on
 * such a chain; a navigation this page starts is same-site, so the cookie is sent. No script and no
 * style, so the console's CSP has nothing to allow.
 */
const CONTINUE_TO_MFA = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/login/mfa">',
  '<title>Continue signing in</title></head>',
  '<body><main><h1>Continue signing in</h1>',
  '<p><a href="/login/mfa">Continue with your second factor</a></p></main></body>',
  '</html>',
].join('');

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

function answerOf(
  request: NextRequest,
  outcome: SsoCallbackOutcome,
  returnTo: string | null,
): NextResponse {
  const signedIn = (request.cookies.get(sessionCookieName())?.value ?? '') !== '';
  switch (outcome.kind) {
    case 'session': {
      const response = redirectTo(request, returnTo ?? '/');
      response.cookies.set(sessionCookieName(), outcome.session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies(),
        path: '/',
        expires: new Date(outcome.session['expires-at']),
      });
      return response;
    }
    case 'mfa': {
      const response = new NextResponse(CONTINUE_TO_MFA, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
      const expiresAt = Date.now() + MFA_CHALLENGE_TTL_MS;
      response.cookies.set(
        MFA_CHALLENGE_COOKIE,
        encodeMfaChallenge({
          token: outcome.challenge['mfa-token'],
          factors: [...new Set(outcome.challenge.factors.map((factor) => factor.type))],
          expiresAt,
        }),
        {
          httpOnly: true,
          sameSite: 'strict',
          secure: secureCookies(),
          path: MFA_CHALLENGE_PATH,
          maxAge: Math.floor(MFA_CHALLENGE_TTL_MS / 1000),
        },
      );
      return response;
    }
    case 'stepped-up':
      return redirectTo(request, returnTo ?? STEP_UP_HOME);
    case 'failed':
      // A signed-in browser was stepping up: it stays where it was, the step-up still due.
      return signedIn
        ? redirectTo(request, returnTo ?? STEP_UP_HOME)
        : redirectTo(request, `/login?reason=${ssoFailureReason(outcome.failure)}`);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  const cookieName = ssoBindingCookieName();
  const stored = request.cookies.get(cookieName)?.value ?? '';
  const binding = ssoBindingSchema.safeParse(stored).success ? stored : null;
  const returnTo = returnPathOf(request.cookies.get(SSO_RETURN_COOKIE)?.value);
  const outcome: SsoCallbackOutcome = providerIdSchema.safeParse(provider).success
    ? await finishSso(
        provider,
        request.nextUrl.searchParams,
        binding,
        request.headers.get('user-agent'),
      )
    : { kind: 'failed', failure: 'sso_state_invalid' };
  const response = answerOf(request, outcome, returnTo);
  response.headers.set('cache-control', 'no-store');
  // The binding is single use whatever the answer (C248.4).
  response.cookies.set(cookieName, '', { path: '/', maxAge: 0, secure: secureCookies() });
  response.cookies.set(SSO_RETURN_COOKIE, '', { path: '/sso/', maxAge: 0 });
  return response;
}
