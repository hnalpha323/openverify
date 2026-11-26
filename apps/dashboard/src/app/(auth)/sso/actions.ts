'use server';

/**
 * C248.6 (Phase 11, Workflow 11B, `sso-oidc`; KP11-18): a step-up by re-authenticating at the
 * identity provider, for an operator who signs in with single sign-on (Phase 9's own step-up takes a
 * code or a passkey). The API answers a re-authentication URL (`prompt=login`, `max_age=0`) and the
 * browser binding, which goes into the same cookie as a sign-in's; the callback sets the session's
 * `mfa_verified_at` and returns to the page the operator came from.
 */
import { SSO_LOGIN_STATE_TTL_SECONDS } from '@openverify/contracts';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { secureCookies } from '../../../lib/config';
import { getSessionToken } from '../../../lib/session';
import {
  SSO_RETURN_COOKIE,
  returnPathOf,
  ssoBindingCookieName,
  ssoFailureReason,
  startSsoStepUp,
} from './sso-bff';

/** Where a step-up that could not start returns, with its notice. */
const SECURITY_PATH = '/account/security';

export async function stepUpWithSso(formData: FormData): Promise<void> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    redirect('/login');
  }
  const posted = formData.get('return-to');
  const returnTo = returnPathOf(typeof posted === 'string' ? posted : null);
  const outcome = await startSsoStepUp(token, (await headers()).get('user-agent'));
  if (outcome.kind !== 'redirect') {
    const failure = outcome.kind === 'failed' ? outcome.failure : 'unavailable';
    redirect(`${SECURITY_PATH}?reason=${ssoFailureReason(failure)}`);
  }
  const jar = await cookies();
  jar.set(ssoBindingCookieName(), outcome.binding, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: SSO_LOGIN_STATE_TTL_SECONDS,
  });
  if (returnTo !== null) {
    jar.set(SSO_RETURN_COOKIE, returnTo, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'lax',
      path: '/sso/',
      maxAge: SSO_LOGIN_STATE_TTL_SECONDS,
    });
  }
  redirect(outcome.authorizationUrl);
}
