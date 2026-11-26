/**
 * The two ways a successful password step ends (C22), shared by the login and invitation
 * actions: a session opens the console, a 202 continues on `/login/mfa`.
 */
import 'server-only';
import type {
  DashboardMfaChallengeResponse,
  DashboardSessionResponse,
} from '@openverify/contracts';
import { redirect } from 'next/navigation';
import { MFA_CHALLENGE_TTL_MS, setMfaChallenge } from './mfa-challenge';
import { setSessionCookie } from './session';

/** Keeps the second-factor challenge in its `/login` cookie and asks for the factor. */
export async function continueWithMfa(challenge: DashboardMfaChallengeResponse): Promise<never> {
  await setMfaChallenge({
    token: challenge['mfa-token'],
    factors: [...new Set(challenge.factors.map((factor) => factor.type))],
    expiresAt: Date.now() + MFA_CHALLENGE_TTL_MS,
  });
  redirect('/login/mfa');
}

/** Stores the session token in its httpOnly cookie and opens the console. */
export async function openConsole(session: DashboardSessionResponse): Promise<never> {
  await setSessionCookie(session.token, session['expires-at']);
  redirect('/');
}
