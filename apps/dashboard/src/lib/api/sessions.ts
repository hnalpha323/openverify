/**
 * The dashboard API routes that open and close an operator's session (C4, C15, C22): login,
 * the second factor, logout and invitations. They take no session (logout uses the cookie's),
 * and they carry the operator's address like every BFF request, so the login limiter counts the
 * operator, never the dashboard server. Failures come back as outcomes, never thrown, because
 * each one is a message on a sign-in form. The password step's 401 never says which part was
 * wrong; the second factor's 401 says whether the `mfa-token` is still usable (C25.1).
 */
import 'server-only';
import {
  ACCESS_PROBLEM_STATUSES,
  dashboardMfaChallengeResponseSchema,
  dashboardSessionResponseSchema,
  dashboardWebauthnLoginOptionsResponseSchema,
  mfaSignInProblemCodeSchema,
  userDocumentSchema,
  revokeOtherSessionsResponseSchema,
  stepUpResponseSchema,
  userSessionListDocumentSchema,
  userSessionResourceSchema,
  type StepUpBody,
  type DashboardAcceptInvitationBody,
  type DashboardMfaChallengeResponse,
  type DashboardMfaLoginBody,
  type DashboardSessionResponse,
  type MfaSignInProblemCode,
} from '@openverify/contracts';
import { OpenVerifyApiError, OpenVerifyConnectionError } from '@openverify/node';
import { z } from 'zod';
import { getSessionToken } from '../session';
import { headers } from 'next/headers';
import { apiBaseUrl, bffToken } from '../config';
import { apiRequest } from './client';
import { requestClientAddress } from './client-address';
import { sendApiRequest, type ApiCall } from './http';

/**
 * Why a sign-in opened no session. `no_environment_role`: the API's 403 of C167.2, for a user who
 * holds no role in any environment of the organization (told only after every factor passed).
 */
export type LoginFailure =
  'invalid_credentials' | 'rate_limited' | 'no_environment_role' | 'unavailable';

export type LoginOutcome =
  | { readonly kind: 'session'; readonly session: DashboardSessionResponse }
  | { readonly kind: 'mfa'; readonly challenge: DashboardMfaChallengeResponse }
  | { readonly kind: 'failed'; readonly reason: LoginFailure };

/**
 * Why a second factor opened no session (C25.1): `invalid_code` (wrong, the `mfa-token` still
 * usable), `attempts_exhausted` (the wrong attempt that revoked it), `token_invalid` (unknown,
 * expired, used or revoked), `no_environment_role` (both factors passed, but the user holds no role
 * in any environment, C167.2), or `unavailable`.
 */
export type MfaLoginFailure =
  'invalid_code' | 'attempts_exhausted' | 'token_invalid' | 'no_environment_role' | 'unavailable';

export type MfaLoginOutcome =
  | { readonly kind: 'session'; readonly session: DashboardSessionResponse }
  | { readonly kind: 'failed'; readonly reason: MfaLoginFailure };

export type WebauthnOptionsOutcome =
  | { readonly kind: 'options'; readonly options: Record<string, unknown> }
  | { readonly kind: 'failed'; readonly reason: 'rejected' | 'unavailable' };

export type InvitationOutcome =
  | { readonly kind: 'accepted'; readonly email: string }
  | { readonly kind: 'failed'; readonly reason: 'invalid_token' | 'invalid_input' | 'unavailable' };

/** The longest User-Agent forwarded; the API keeps the first 1,024 characters for its summary. */
const MAX_USER_AGENT = 1024;

/**
 * One call of the routes that open a session (sign-in, the second factor, an accepted invitation),
 * with no session token, the BFF headers, and the browser's own `User-Agent` (C168.4): the API
 * derives the session's device summary from it, and without it "my sessions" could not name the
 * device. Only those calls carry it; every other BFF call sends the server's own.
 */
async function signInRequest<Schema extends z.ZodType>(
  call: ApiCall<Schema>,
): Promise<z.output<Schema>> {
  const agent = (await headers()).get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null;
  const context = {
    baseUrl: apiBaseUrl(),
    token: null,
    clientAddress: await requestClientAddress(),
    bffToken: bffToken(),
  };
  const withAgent: typeof fetch = (input, init = {}) => {
    const sent = new Headers(init.headers);
    if (agent !== null && agent !== '') {
      sent.set('user-agent', agent);
    }
    return fetch(input, { ...init, headers: sent });
  };
  return sendApiRequest(context, call, withAgent);
}

const statusOf = (error: unknown): number | null =>
  error instanceof OpenVerifyApiError ? error.status : null;

/** C167.2: the API's 403 for a user who holds no role it may use; only its code says so. */
export const isNoEnvironmentRole = (error: unknown): boolean =>
  error instanceof OpenVerifyApiError &&
  error.status === ACCESS_PROBLEM_STATUSES.no_environment_role &&
  error.code === 'no_environment_role';

/** `POST /sessions`: 201 opens a session; 202 asks for the second factor. */
const loginAnswerSchema = z.union([
  dashboardSessionResponseSchema,
  dashboardMfaChallengeResponseSchema,
]);

export async function createSession(credentials: {
  email: string;
  password: string;
}): Promise<LoginOutcome> {
  try {
    const answer = await signInRequest({
      method: 'POST',
      path: '/dashboard/sessions',
      body: credentials,
      schema: loginAnswerSchema,
    });
    return 'token' in answer
      ? { kind: 'session', session: answer }
      : { kind: 'mfa', challenge: answer };
  } catch (error) {
    const status = statusOf(error);
    if (status === 400 || status === 401) {
      return { kind: 'failed', reason: 'invalid_credentials' };
    }
    if (isNoEnvironmentRole(error)) {
      return { kind: 'failed', reason: 'no_environment_role' };
    }
    return { kind: 'failed', reason: status === 429 ? 'rate_limited' : 'unavailable' };
  }
}

/** What the API's C25.1 problem codes mean for the sign-in. */
const MFA_FAILURES: Readonly<Record<MfaSignInProblemCode, MfaLoginFailure>> = {
  mfa_code_invalid: 'invalid_code',
  mfa_attempts_exhausted: 'attempts_exhausted',
  mfa_token_invalid: 'token_invalid',
};

/**
 * Why the API refused a second factor. A 401 names it with its C25.1 code; one without a known
 * code cannot be relied on, so the sign-in starts over. A 400 is a body the API refused, which
 * counts as a code that is not valid.
 */
function mfaFailureOf(error: unknown): MfaLoginFailure {
  const status = statusOf(error);
  if (status === 401) {
    const code = mfaSignInProblemCodeSchema.safeParse((error as OpenVerifyApiError).code);
    return code.success ? MFA_FAILURES[code.data] : 'token_invalid';
  }
  if (isNoEnvironmentRole(error)) {
    return 'no_environment_role';
  }
  return status === 400 ? 'invalid_code' : 'unavailable';
}

async function mfaSession(path: string, body: unknown): Promise<MfaLoginOutcome> {
  try {
    const session = await signInRequest({
      method: 'POST',
      path,
      body,
      schema: dashboardSessionResponseSchema,
    });
    return { kind: 'session', session };
  } catch (error) {
    return { kind: 'failed', reason: mfaFailureOf(error) };
  }
}

/** `POST /sessions/mfa`: a TOTP or recovery code with the `mfa-token`. */
export function completeMfaLogin(body: DashboardMfaLoginBody): Promise<MfaLoginOutcome> {
  return mfaSession('/dashboard/sessions/mfa', body);
}

/**
 * `POST /sessions/mfa/webauthn/options`: assertion options for `navigator.credentials.get()`.
 * `rejected`: the `mfa-token` is no longer valid (401 `mfa_token_invalid`, C25.1).
 */
export async function webauthnLoginOptions(mfaToken: string): Promise<WebauthnOptionsOutcome> {
  try {
    const { options } = await signInRequest({
      method: 'POST',
      path: '/dashboard/sessions/mfa/webauthn/options',
      body: { 'mfa-token': mfaToken },
      schema: dashboardWebauthnLoginOptionsResponseSchema,
    });
    return { kind: 'options', options };
  } catch (error) {
    return { kind: 'failed', reason: statusOf(error) === 401 ? 'rejected' : 'unavailable' };
  }
}

/** `POST /sessions/mfa/webauthn/verify`: the assertion with the `mfa-token`. */
export function verifyWebauthnLogin(
  mfaToken: string,
  credential: unknown,
): Promise<MfaLoginOutcome> {
  return mfaSession('/dashboard/sessions/mfa/webauthn/verify', {
    'mfa-token': mfaToken,
    credential,
  });
}

/**
 * Whether signing out ended the session in the API: `ended` (or there was none, or the API says
 * it is gone already), or `incomplete`, when the token stays valid until it expires.
 */
export type SessionEnd = 'ended' | 'incomplete';

const endSession = () =>
  apiRequest({ method: 'DELETE', path: '/dashboard/sessions/current', schema: z.unknown() });

/**
 * `DELETE /sessions/current`. Never throws: signing out locally must always work. A connection
 * error or timeout is tried once more; a 401 means the session is gone already. Any other failure
 * is logged, without the token, and answered `incomplete` so the operator is told (Workflow 2D
 * F005).
 */
export async function deleteSession(): Promise<SessionEnd> {
  if ((await getSessionToken()) === null) {
    return 'ended';
  }
  try {
    await endSession().catch((error: unknown) => {
      if (error instanceof OpenVerifyConnectionError) {
        return endSession();
      }
      throw error;
    });
    return 'ended';
  } catch (error) {
    if (statusOf(error) === 401) {
      return 'ended';
    }
    console.error('The dashboard could not end a session in the API', {
      error: error instanceof Error ? error.name : typeof error,
      status: statusOf(error),
    });
    return 'incomplete';
  }
}

/** `POST /invitations/accept`; the invited operator then signs in with the email it returns. */
export async function acceptInvitation(
  body: DashboardAcceptInvitationBody,
): Promise<InvitationOutcome> {
  try {
    const { data } = await signInRequest({
      method: 'POST',
      path: '/dashboard/invitations/accept',
      body,
      schema: userDocumentSchema,
    });
    return { kind: 'accepted', email: data.attributes.email };
  } catch (error) {
    const status = statusOf(error);
    if (status === 404) {
      return { kind: 'failed', reason: 'invalid_token' };
    }
    return { kind: 'failed', reason: status === 400 ? 'invalid_input' : 'unavailable' };
  }
}

export type UserSession = z.infer<typeof userSessionResourceSchema>;

const SESSIONS_PATH = '/dashboard/sessions';

/** `GET /dashboard/sessions` (C168.4): the caller's own, a device summary each, the current marked. */
export async function listMySessions(): Promise<UserSession[]> {
  const { data } = await apiRequest({
    method: 'GET',
    path: SESSIONS_PATH,
    schema: userSessionListDocumentSchema,
  });
  return data;
}

/** `POST /dashboard/sessions/:id/revoke`: ends one of the caller's sessions. */
export async function revokeMySession(id: string): Promise<void> {
  await apiRequest({
    method: 'POST',
    path: `${SESSIONS_PATH}/${encodeURIComponent(id)}/revoke`,
    body: {},
    schema: z.unknown(),
  });
}

/** `POST /dashboard/sessions/revoke-others`: ends every other session; answers how many. */
export async function revokeOtherSessions(): Promise<number> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${SESSIONS_PATH}/revoke-others`,
    body: {},
    schema: revokeOtherSessionsResponseSchema,
  });
  return answer.meta.revoked;
}

/**
 * `POST /dashboard/sessions/current/step-up/webauthn/options` (C168.1; K9-11): the request options
 * for the signed-in user's passkeys, for a step-up in the reset and reactivate dialogs.
 */
export async function stepUpWebauthnOptions(): Promise<Record<string, unknown>> {
  const { options } = await apiRequest({
    method: 'POST',
    path: `${SESSIONS_PATH}/current/step-up/webauthn/options`,
    body: {},
    schema: dashboardWebauthnLoginOptionsResponseSchema,
  });
  return options;
}

/**
 * `POST /dashboard/sessions/current/step-up` (C168.1): a factor verified again, which lets the
 * session reset another user's MFA or reactivate a user until the time answered (10 minutes).
 */
export async function stepUpSession(body: StepUpBody): Promise<{ readonly expiresAt: string }> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${SESSIONS_PATH}/current/step-up`,
    body,
    schema: stepUpResponseSchema,
  });
  return { expiresAt: answer['step-up-expires-at'] };
}
