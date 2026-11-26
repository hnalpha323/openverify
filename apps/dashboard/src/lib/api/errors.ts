/**
 * How the dashboard treats a failed API call (C21):
 * - 401 sends the operator to `/login`; 401 `mfa-required` to `/account/security`;
 * - 403 renders "You do not have access" on a page (the forbidden panel); a 403 answered to an
 *   action keeps the API's own title and detail, which say what was refused (Workflow 2D K004:
 *   "You cannot grant permissions you do not hold: pii:view.");
 * - 404 renders not found;
 * - any other problem shows its `title` and `detail`, never a stack;
 * - no answer, or an answer off contract, says the API is unavailable.
 */
import 'server-only';
import {
  problemTypeUri,
  sessionExpiredReasonSchema,
  type SessionExpiredReason,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import {
  OpenVerifyApiError,
  OpenVerifyConnectionError,
  OpenVerifyResponseValidationError,
} from '@openverify/node';
import { redirect } from 'next/navigation';
import type { DisplayProblem } from '../action-state';

export type { DisplayProblem } from '../action-state';

/** The operator lacks a permission the page or action needs; the API was not called. */
export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
  readonly permissions: readonly Permission[];

  constructor(permissions: readonly Permission[]) {
    super(`Missing permissions: ${permissions.join(', ')}`);
    this.permissions = permissions;
  }
}

export type ApiFailureKind =
  'unauthenticated' | 'mfa-required' | 'forbidden' | 'not-found' | 'problem' | 'unavailable';

const MFA_REQUIRED = problemTypeUri('mfa-required');
const SANDBOX_ONLY = problemTypeUri('sandbox-only');

/** What kind of API failure `error` is, or `null` when it is not one (a bug, a redirect). */
export function classifyApiError(error: unknown): ApiFailureKind | null {
  if (error instanceof ForbiddenError) {
    return 'forbidden';
  }
  if (error instanceof OpenVerifyApiError) {
    if (error.status === 401) {
      return error.type === MFA_REQUIRED ? 'mfa-required' : 'unauthenticated';
    }
    if (error.status === 403 && error.type !== SANDBOX_ONLY) {
      return 'forbidden';
    }
    return error.status === 404 ? 'not-found' : 'problem';
  }
  if (
    error instanceof OpenVerifyConnectionError ||
    error instanceof OpenVerifyResponseValidationError
  ) {
    return 'unavailable';
  }
  return null;
}

export const FORBIDDEN_PROBLEM: DisplayProblem = Object.freeze({
  title: 'You do not have access',
  detail: 'Your role does not allow this. Ask an administrator if you need it.',
});

const UNREACHABLE: DisplayProblem = Object.freeze({
  title: 'The API could not be reached',
  detail: 'Try again in a moment.',
});

const OFF_CONTRACT: DisplayProblem = Object.freeze({
  title: 'The API answered in an unexpected way',
  detail: 'Try again in a moment. If it keeps happening, tell your administrator.',
});

const UNKNOWN: DisplayProblem = Object.freeze({
  title: 'Something went wrong',
  detail: 'Try again in a moment.',
});

function fieldErrorsOf(errors: unknown): DisplayProblem['errors'] {
  if (!Array.isArray(errors)) {
    return undefined;
  }
  const fields = errors.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const { pointer, detail } = item as Record<string, unknown>;
    return typeof pointer === 'string' && typeof detail === 'string' ? [{ pointer, detail }] : [];
  });
  return fields.length === 0 ? undefined : fields;
}

/**
 * What to show for `error`. Only members of the API's problem that are meant for people. A 403
 * from the API says "You do not have access" unless `apiForbidden` is `'detail'` (an action, whose
 * refusal names what was refused); a `ForbiddenError` (the dashboard's own check) always does.
 */
export function displayProblemOf(
  error: unknown,
  { apiForbidden = 'generic' }: { apiForbidden?: 'generic' | 'detail' } = {},
): DisplayProblem {
  const kind = classifyApiError(error);
  if (kind === 'forbidden' && !(apiForbidden === 'detail' && error instanceof OpenVerifyApiError)) {
    return FORBIDDEN_PROBLEM;
  }
  if (error instanceof OpenVerifyApiError) {
    const { problem } = error;
    const errors = fieldErrorsOf(problem.errors);
    // The x-request-id header, or the problem's own `requestId` member.
    const requestId = error.requestId ?? problem.requestId;
    return {
      title: problem.title,
      ...(typeof problem.detail === 'string' && problem.detail !== ''
        ? { detail: problem.detail }
        : {}),
      status: error.status,
      ...(typeof requestId === 'string' && requestId !== '' ? { requestId } : {}),
      ...(errors === undefined ? {} : { errors }),
      // C72.4: a report refusal is said in words by its code (`lib/report-problem-words.ts`).
      ...(typeof problem.code === 'string' && problem.code !== '' ? { code: problem.code } : {}),
    };
  }
  if (error instanceof OpenVerifyResponseValidationError) {
    return OFF_CONTRACT;
  }
  return kind === 'unavailable' ? UNREACHABLE : UNKNOWN;
}

export const LOGIN_PATH = '/login';
export const SECURITY_PATH = '/account/security';

/**
 * C245.2 (Workflow 11B): which limit ended the session, when `error` is the API's 401
 * `session_expired` with its reason; `null` for anything else.
 */
export function sessionExpiryOf(error: unknown): SessionExpiredReason | null {
  if (!(error instanceof OpenVerifyApiError) || error.status !== 401) {
    return null;
  }
  if (error.code !== 'session_expired') {
    return null;
  }
  const reason = sessionExpiredReasonSchema.safeParse(error.reason);
  return reason.success ? reason.data : null;
}

/**
 * C245.2: the route handler that clears the cookie of a session the API ended and shows the sign-in
 * page with the reason (`app/login/signed-out/route.ts`).
 */
export const signedOutPath = (reason: SessionExpiredReason): string =>
  `/login/signed-out?reason=${reason}`;

/**
 * Redirects when `error` means the session ended (`/login`, through `/login/signed-out` when the API
 * said it expired) or must pass MFA first (`/account/security`); returns otherwise.
 */
export function redirectIfSignedOut(error: unknown): void {
  const kind = classifyApiError(error);
  if (kind === 'unauthenticated') {
    const expiry = sessionExpiryOf(error);
    redirect(expiry === null ? LOGIN_PATH : signedOutPath(expiry));
  }
  if (kind === 'mfa-required') {
    redirect(SECURITY_PATH);
  }
}
