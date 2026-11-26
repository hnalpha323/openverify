'use server';

import {
  recoveryCodeInputSchema,
  totpCodeSchema,
  webauthnAuthenticationResponseSchema,
} from '@openverify/contracts';
import { redirect } from 'next/navigation';
import {
  completeMfaLogin,
  createSession,
  deleteSession,
  verifyWebauthnLogin,
  webauthnLoginOptions,
  type MfaLoginOutcome,
} from '../../lib/api/sessions';
import type { LoginState } from '../../lib/login-state';
import { hasErrors, validateLogin } from '../../lib/login-validation';
import { clearMfaChallenge, getMfaChallenge } from '../../lib/mfa-challenge';
import type {
  MfaCodeState,
  WebauthnLoginFinish,
  WebauthnLoginStart,
} from '../../lib/mfa-login-state';
import { SIGN_OUT_INCOMPLETE_PATH, clearSessionCookie } from '../../lib/session';
import { continueWithMfa, openConsole } from '../../lib/sign-in';

const MFA_EXPIRED = '/login?reason=mfa-expired';
const MFA_ATTEMPTS = '/login?reason=mfa-attempts';
const MFA_INVALID = '/login?reason=mfa-invalid';
/** C167.2: both factors passed, but the user holds no role in any environment. */
const NO_ENVIRONMENT_ROLE = '/login?reason=no-environment-role';

/**
 * Signs an operator in: validates the form again on the server, calls
 * `POST /api/v1/dashboard/sessions` server-side, keeps the returned token in an httpOnly
 * cookie and opens the console. A user with MFA answers 202: the `mfa-token` goes into its own
 * cookie and the operator continues on `/login/mfa`. No token reaches client JavaScript.
 */
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get('email');
  const password = formData.get('password');
  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'invalid_input' };
  }
  const credentials = { email: email.trim(), password };
  if (hasErrors(validateLogin(credentials))) {
    return { error: 'invalid_input' };
  }
  const outcome = await createSession(credentials);
  if (outcome.kind === 'failed') {
    return { error: outcome.reason };
  }
  if (outcome.kind === 'mfa') {
    return continueWithMfa(outcome.challenge);
  }
  return openConsole(outcome.session);
}

/** Drops the challenge whose `mfa-token` the API no longer takes, and says why on `/login`. */
async function restartSignIn(target: string): Promise<never> {
  await clearMfaChallenge();
  redirect(target);
}

/**
 * Settles a second-factor attempt as the API answered it (C25.1): a session opens the console;
 * a wrong code or key keeps the operator here (`invalid` or `unavailable`); the attempt that used
 * up the token, or a token that is no longer valid, returns to `/login` with a message. The API
 * counts the attempts, so the dashboard keeps no count of its own.
 */
async function settleMfa(outcome: MfaLoginOutcome): Promise<'invalid' | 'unavailable'> {
  if (outcome.kind === 'session') {
    await clearMfaChallenge();
    return openConsole(outcome.session);
  }
  switch (outcome.reason) {
    case 'attempts_exhausted':
      return restartSignIn(MFA_ATTEMPTS);
    case 'token_invalid':
      return restartSignIn(MFA_INVALID);
    case 'no_environment_role':
      return restartSignIn(NO_ENVIRONMENT_ROLE);
    case 'invalid_code':
      return 'invalid';
    case 'unavailable':
      return 'unavailable';
  }
}

/** `POST /sessions/mfa` with a TOTP code (`method=totp`) or a recovery code (`method=recovery`). */
export async function completeMfa(
  _previous: MfaCodeState | null,
  formData: FormData,
): Promise<MfaCodeState> {
  const challenge = await getMfaChallenge();
  if (challenge === null) {
    redirect(MFA_EXPIRED);
  }
  const method = formData.get('method');
  const code = formData.get('code');
  const value = typeof code === 'string' ? code.trim() : '';
  let body;
  if (method === 'totp' && totpCodeSchema.safeParse(value).success) {
    body = { 'mfa-token': challenge.token, 'totp-code': value };
  } else if (method === 'recovery' && recoveryCodeInputSchema.safeParse(value).success) {
    body = { 'mfa-token': challenge.token, 'recovery-code': value };
  } else {
    return { error: 'invalid_input' };
  }
  const settled = await settleMfa(await completeMfaLogin(body));
  return { error: settled === 'unavailable' ? 'unavailable' : 'invalid_code' };
}

/** Assertion options for the browser's `navigator.credentials.get()`. */
export async function startWebauthnLogin(): Promise<WebauthnLoginStart> {
  const challenge = await getMfaChallenge();
  if (challenge === null) {
    return { ok: false, error: 'expired' };
  }
  const outcome = await webauthnLoginOptions(challenge.token);
  if (outcome.kind === 'options') {
    return { ok: true, options: outcome.options };
  }
  if (outcome.reason === 'rejected') {
    return restartSignIn(MFA_INVALID);
  }
  return { ok: false, error: 'unavailable' };
}

/** Verifies the browser's assertion and opens the session. */
export async function finishWebauthnLogin(credential: unknown): Promise<WebauthnLoginFinish> {
  const challenge = await getMfaChallenge();
  if (challenge === null) {
    return { ok: false, error: 'expired' };
  }
  const parsed = webauthnAuthenticationResponseSchema.safeParse(credential);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const settled = await settleMfa(await verifyWebauthnLogin(challenge.token, parsed.data));
  return { ok: false, error: settled === 'unavailable' ? 'unavailable' : 'rejected' };
}

/** Drops the second-factor challenge and starts over. */
export async function cancelMfaLogin(): Promise<void> {
  await clearMfaChallenge();
  redirect('/login');
}

/**
 * Revokes the session in the API, clears the cookie and returns to sign-in, which says so when
 * the API could not end the session (Workflow 2D F005).
 */
export async function logout(): Promise<void> {
  const ended = await deleteSession();
  await clearSessionCookie();
  redirect(ended === 'ended' ? '/login' : SIGN_OUT_INCOMPLETE_PATH);
}
