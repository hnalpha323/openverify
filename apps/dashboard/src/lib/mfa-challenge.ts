/**
 * The MFA challenge between the password and the second factor (C22): the `mfa-token` the API
 * answered with a 202 and the factor types to offer. It lives in an httpOnly, SameSite=Strict
 * cookie scoped to `/login`, for as long as the token (5 minutes, C9), so it reaches only the
 * sign-in pages and their server actions, and never a URL or client JavaScript. It counts no
 * attempts: the API does, and says when a wrong attempt used up the token (C25.1).
 */
import 'server-only';
import { MFA_FACTOR_KINDS, mfaTokenSchema, type MfaFactorKind } from '@openverify/contracts';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { secureCookies } from './config';

export const MFA_CHALLENGE_COOKIE = 'openverify_mfa';
export const MFA_CHALLENGE_PATH = '/login';
/** C9: an `ovm_` token lives 5 minutes. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;

export interface MfaChallenge {
  readonly token: string;
  readonly factors: readonly MfaFactorKind[];
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

const storedSchema = z.strictObject({
  t: mfaTokenSchema,
  f: z.array(z.enum(MFA_FACTOR_KINDS)).max(MFA_FACTOR_KINDS.length),
  e: z.int().positive(),
});

export function encodeMfaChallenge(challenge: MfaChallenge): string {
  return Buffer.from(
    JSON.stringify({ t: challenge.token, f: challenge.factors, e: challenge.expiresAt }),
  ).toString('base64url');
}

/** The challenge a cookie value holds, or `null` when it is not one. */
export function decodeMfaChallenge(value: string): MfaChallenge | null {
  let stored: unknown;
  try {
    stored = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = storedSchema.safeParse(stored);
  return parsed.success
    ? { token: parsed.data.t, factors: parsed.data.f, expiresAt: parsed.data.e }
    : null;
}

/** Writes the challenge; the cookie expires with the token. */
export async function setMfaChallenge(challenge: MfaChallenge): Promise<void> {
  const maxAge = Math.max(1, Math.floor((challenge.expiresAt - Date.now()) / 1000));
  (await cookies()).set(MFA_CHALLENGE_COOKIE, encodeMfaChallenge(challenge), {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies(),
    path: MFA_CHALLENGE_PATH,
    maxAge,
  });
}

/** The live challenge, or `null` when there is none or its token expired. */
export async function getMfaChallenge(): Promise<MfaChallenge | null> {
  const value = (await cookies()).get(MFA_CHALLENGE_COOKIE)?.value;
  const challenge = value === undefined ? null : decodeMfaChallenge(value);
  return challenge !== null && challenge.expiresAt > Date.now() ? challenge : null;
}

export async function clearMfaChallenge(): Promise<void> {
  (await cookies()).delete({ name: MFA_CHALLENGE_COOKIE, path: MFA_CHALLENGE_PATH });
}
