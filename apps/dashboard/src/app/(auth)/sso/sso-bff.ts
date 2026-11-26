/**
 * C248.4 (Phase 11, Workflow 11B, `sso-oidc`; review F21): the console's side of OIDC sign-in. The
 * route handlers `/sso/<sign-in name>/start` and `/sso/callback/<provider>` call the API as the BFF
 * (the BFF token, the operator's address and the browser's own `User-Agent`, as the password sign-in
 * does) and hold the browser binding: the start answer's `ovsb_` value goes into a host-only cookie
 * (`__Host-openverify-sso`; `openverify-sso` where cookies cannot be `Secure`), and the callback
 * hands it back in `x-openverify-sso-binding`, so a callback in another browser, or one replayed,
 * never matches. Nothing of it is in a URL. Failures come back as outcomes naming the API's code; the
 * browser sees one generic sentence per code (`SSO_FAILURE_WORDS`).
 */
import 'server-only';
import {
  SSO_BINDING_COOKIE,
  SSO_BINDING_COOKIE_INSECURE,
  SSO_BINDING_HEADER,
  SSO_PROBLEM_STATUSES,
  dashboardMfaChallengeResponseSchema,
  dashboardSessionResponseSchema,
  ssoCallbackResponseSchema,
  ssoRedirectSchema,
  ssoStartResponseSchema,
  stepUpResponseSchema,
  type DashboardMfaChallengeResponse,
  type DashboardSessionResponse,
  type SsoProblemCode,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { z } from 'zod';
import { apiBaseUrl, bffToken, secureCookies } from '../../../lib/config';
import { requestClientAddress } from '../../../lib/api/client-address';
import { sendApiRequest, type ApiCall } from '../../../lib/api/http';

/** The longest `User-Agent` forwarded, as the password sign-in forwards it. */
const MAX_USER_AGENT = 1024;

/** The binding cookie's name: `__Host-` needs `Secure`, so a plain-http console uses the other. */
export function ssoBindingCookieName(): string {
  return secureCookies() ? SSO_BINDING_COOKIE : SSO_BINDING_COOKIE_INSECURE;
}

/** Ours: where the console returns after a step-up or a sign-in, kept beside the binding. */
export const SSO_RETURN_COOKIE = 'openverify_sso_return';

/** A path of the console (`ssoStartQuerySchema`'s `return-to`): one leading `/`, no other origin. */
export const RETURN_PATH = /^\/(?![/\\])[^\s]*$/;

/** The path to come back to, if it is one of the console's. */
export function returnPathOf(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length <= 2048 && RETURN_PATH.test(value)
    ? value
    : null;
}

/** Why the browser was sent back to sign-in: an API problem, or the API not answering. */
export type SsoFailure = SsoProblemCode | 'no_environment_role' | 'unavailable';

/** One generic sentence per failure (C248.7): the browser never learns more. */
export const SSO_FAILURE_WORDS: Readonly<Record<SsoFailure, string>> = Object.freeze({
  sso_not_configured: 'Single sign-on is not available for that sign-in name.',
  sso_state_invalid: 'The single sign-on attempt could not be completed. Start again.',
  sso_email_unverified:
    'Your identity provider did not confirm a verified email address, so your account could not be linked.',
  sso_user_unknown:
    'Your identity provider’s account does not match a user of this organization. Ask an administrator.',
  sso_password_disabled: 'This organization signs in with single sign-on only.',
  organization_slug_taken: 'Single sign-on is not available for that sign-in name.',
  no_environment_role: 'Your account holds no role in any environment of this organization.',
  unavailable: 'Single sign-on could not be reached. Try again in a moment.',
});

/** The `reason` of `/login?reason=...` for each failure (C167.2's own for `no_environment_role`). */
export function ssoFailureReason(failure: SsoFailure): string {
  const dashed = failure.replaceAll('_', '-');
  if (failure === 'no_environment_role' || failure.startsWith('sso_')) {
    return dashed;
  }
  return `sso-${dashed}`;
}

/** The failure a refused or unanswered call stands for. */
export function ssoFailureOf(error: unknown): SsoFailure {
  if (error instanceof OpenVerifyApiError) {
    if (error.code === 'no_environment_role') {
      return 'no_environment_role';
    }
    const code = error.code ?? '';
    if (Object.hasOwn(SSO_PROBLEM_STATUSES, code)) {
      return code as SsoProblemCode;
    }
    // A malformed start or callback the API refused with 400 is an attempt to start again.
    if (error.status === 400) {
      return 'sso_state_invalid';
    }
    if (error.status === 404) {
      return 'sso_not_configured';
    }
  }
  return 'unavailable';
}

/** One BFF call without a session (or with the step-up's), with the browser's `User-Agent`. */
async function bffCall<Schema extends z.ZodType>(
  call: ApiCall<Schema>,
  context: { readonly token: string | null; readonly userAgent: string | null },
): Promise<z.output<Schema>> {
  const agent = context.userAgent?.slice(0, MAX_USER_AGENT) ?? null;
  const withAgent: typeof fetch = (input, init = {}) => {
    const sent = new Headers(init.headers);
    if (agent !== null && agent !== '') {
      sent.set('user-agent', agent);
    }
    return fetch(input, { ...init, headers: sent });
  };
  return sendApiRequest(
    {
      baseUrl: apiBaseUrl(),
      token: context.token,
      clientAddress: await requestClientAddress(),
      bffToken: bffToken(),
    },
    call,
    withAgent,
  );
}

export type SsoStartOutcome =
  | {
      readonly kind: 'redirect';
      readonly authorizationUrl: string;
      readonly binding: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: 'choose';
      readonly providers: readonly { readonly id: string; readonly displayName: string }[];
    }
  | { readonly kind: 'failed'; readonly failure: SsoFailure };

/** `GET /dashboard/sso/:organization-slug/start`. */
export async function startSso(
  slug: string,
  options: { providerId?: string | undefined; returnTo?: string | undefined },
  userAgent: string | null,
): Promise<SsoStartOutcome> {
  try {
    const answer = await bffCall(
      {
        method: 'GET',
        path: `/dashboard/sso/${encodeURIComponent(slug)}/start`,
        query: { 'provider-id': options.providerId, 'return-to': options.returnTo },
        schema: ssoStartResponseSchema,
      },
      { token: null, userAgent },
    );
    if (answer.kind === 'choose') {
      return {
        kind: 'choose',
        providers: answer.providers.map((each) => ({
          id: each.id,
          displayName: each['display-name'],
        })),
      };
    }
    return {
      kind: 'redirect',
      authorizationUrl: answer['authorization-url'],
      binding: answer.binding,
      expiresAt: answer['expires-at'],
    };
  } catch (error) {
    return { kind: 'failed', failure: ssoFailureOf(error) };
  }
}

/** `POST /dashboard/sessions/current/step-up/sso` (C248.6): a re-authentication of this session. */
export async function startSsoStepUp(
  token: string,
  userAgent: string | null,
): Promise<SsoStartOutcome> {
  try {
    const answer = await bffCall(
      {
        method: 'POST',
        path: '/dashboard/sessions/current/step-up/sso',
        body: {},
        schema: ssoRedirectSchema,
      },
      { token, userAgent },
    );
    return {
      kind: 'redirect',
      authorizationUrl: answer['authorization-url'],
      binding: answer.binding,
      expiresAt: answer['expires-at'],
    };
  } catch (error) {
    return { kind: 'failed', failure: ssoFailureOf(error) };
  }
}

export type SsoCallbackOutcome =
  | { readonly kind: 'session'; readonly session: DashboardSessionResponse }
  | { readonly kind: 'mfa'; readonly challenge: DashboardMfaChallengeResponse }
  | { readonly kind: 'stepped-up' }
  | { readonly kind: 'failed'; readonly failure: SsoFailure };

/** `GET /dashboard/sso/callback/:provider-id` with the provider's query unchanged and the binding. */
export async function finishSso(
  providerId: string,
  query: URLSearchParams,
  binding: string | null,
  userAgent: string | null,
): Promise<SsoCallbackOutcome> {
  try {
    const answer = await bffCall(
      {
        method: 'GET',
        path: `/dashboard/sso/callback/${encodeURIComponent(providerId)}`,
        query: Object.fromEntries(query),
        headers: binding === null ? {} : { [SSO_BINDING_HEADER]: binding },
        schema: ssoCallbackResponseSchema,
      },
      { token: null, userAgent },
    );
    const session = dashboardSessionResponseSchema.safeParse(answer);
    if (session.success) {
      return { kind: 'session', session: session.data };
    }
    const challenge = dashboardMfaChallengeResponseSchema.safeParse(answer);
    if (challenge.success) {
      return { kind: 'mfa', challenge: challenge.data };
    }
    stepUpResponseSchema.parse(answer);
    return { kind: 'stepped-up' };
  } catch (error) {
    return { kind: 'failed', failure: ssoFailureOf(error) };
  }
}
