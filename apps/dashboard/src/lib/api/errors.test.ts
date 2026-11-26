// @vitest-environment node
import type { ProblemTypeSlug } from '@openverify/contracts';
import {
  OpenVerifyApiError,
  OpenVerifyConnectionError,
  OpenVerifyResponseValidationError,
  OpenVerifyTimeoutError,
  type ApiProblem,
} from '@openverify/node';
import { describe, expect, it } from 'vitest';
import { problemDocument } from '../../testing/api-mock';
import { redirectTarget } from '../../testing/next-errors';
import {
  FORBIDDEN_PROBLEM,
  ForbiddenError,
  classifyApiError,
  displayProblemOf,
  redirectIfSignedOut,
} from './errors';

const apiError = (status: number, slug?: ProblemTypeSlug, extra: Record<string, unknown> = {}) =>
  new OpenVerifyApiError(
    problemDocument(status, slug, extra) as unknown as ApiProblem,
    'req-synthetic-0001',
  );

describe('classifyApiError', () => {
  it.each([
    ['a 401', apiError(401), 'unauthenticated'],
    ['a 401 mfa-required', apiError(401, 'mfa-required'), 'mfa-required'],
    ['a 403 forbidden', apiError(403, 'forbidden'), 'forbidden'],
    ['a Phase 1 403 (about:blank)', apiError(403), 'forbidden'],
    ['our own ForbiddenError', new ForbiddenError(['users:read']), 'forbidden'],
    ['a 403 sandbox-only, which is not about access', apiError(403, 'sandbox-only'), 'problem'],
    ['a 404', apiError(404), 'not-found'],
    ['a 409 invalid-transition', apiError(409, 'invalid-transition'), 'problem'],
    ['a 410 redacted', apiError(410, 'redacted'), 'problem'],
    ['a 422', apiError(422), 'problem'],
    ['a 429', apiError(429, 'rate-limited'), 'problem'],
    ['a 500', apiError(500), 'problem'],
    ['a connection failure', new OpenVerifyConnectionError('down'), 'unavailable'],
    ['a timeout', new OpenVerifyTimeoutError('slow'), 'unavailable'],
    ['an answer off contract', new OpenVerifyResponseValidationError('bad', 200), 'unavailable'],
  ] as const)('classifies %s as %s', (_case, error, kind) => {
    expect(classifyApiError(error)).toBe(kind);
  });

  it.each([new Error('bug'), new TypeError('x'), 'thrown text', null])(
    'leaves anything that is not an API failure (%s) to the error boundary',
    (error) => {
      expect(classifyApiError(error)).toBeNull();
    },
  );
});

describe('displayProblemOf', () => {
  it("shows the API problem's title, detail, field errors and request id", () => {
    const error = apiError(400, undefined, {
      title: 'Bad Request',
      detail: 'The request is not valid.',
      errors: [{ location: 'body', pointer: '/data/attributes/name', detail: 'is required' }],
    });

    expect(displayProblemOf(error)).toEqual({
      title: 'Bad Request',
      detail: 'The request is not valid.',
      status: 400,
      requestId: 'req-synthetic-0001',
      errors: [{ pointer: '/data/attributes/name', detail: 'is required' }],
    });
  });

  it('never carries a stack trace, even when the API sent one outside production', () => {
    const error = apiError(500, undefined, { stack: 'Error: boom\n    at secret.ts:1:1' });

    expect(JSON.stringify(displayProblemOf(error))).not.toContain('secret.ts');
  });

  it('says "You do not have access" for a 403', () => {
    expect(displayProblemOf(apiError(403, 'forbidden'))).toEqual(FORBIDDEN_PROBLEM);
    expect(displayProblemOf(new ForbiddenError([]))).toEqual(FORBIDDEN_PROBLEM);
    expect(FORBIDDEN_PROBLEM.title).toBe('You do not have access');
  });

  it('says the API is unreachable, without internals, when no answer came', () => {
    expect(displayProblemOf(new OpenVerifyConnectionError('connect ECONNREFUSED'))).toEqual({
      title: 'The API could not be reached',
      detail: 'Try again in a moment.',
    });
    expect(displayProblemOf(new OpenVerifyResponseValidationError('bad', 200))).toEqual({
      title: 'The API answered in an unexpected way',
      detail: 'Try again in a moment. If it keeps happening, tell your administrator.',
    });
  });

  it('keeps the problem code, so a report refusal can be said in words (C72.4)', () => {
    const error = apiError(409, undefined, {
      code: 'report_match_superseded',
      detail: 'A later match of the same entry replaced this one; review that match.',
    });

    expect(displayProblemOf(error)).toMatchObject({
      status: 409,
      code: 'report_match_superseded',
    });
    expect(displayProblemOf(apiError(409, undefined, { code: 7 }))).not.toHaveProperty('code');
  });

  it('describes anything else generically', () => {
    expect(displayProblemOf(new Error('SELECT * FROM users'))).toEqual({
      title: 'Something went wrong',
      detail: 'Try again in a moment.',
    });
  });
});

describe('redirectIfSignedOut', () => {
  it('sends a 401 to sign in', async () => {
    await expect(
      redirectTarget(
        Promise.resolve().then(() => {
          redirectIfSignedOut(apiError(401));
        }),
      ),
    ).resolves.toBe('/login');
  });

  it('sends a 401 mfa-required to the security page', async () => {
    await expect(
      redirectTarget(
        Promise.resolve().then(() => {
          redirectIfSignedOut(apiError(401, 'mfa-required'));
        }),
      ),
    ).resolves.toBe('/account/security');
  });

  it.each(['idle', 'absolute'])(
    'sends a 401 session_expired (%s) through the signed-out handler, which clears the cookie (C245.2)',
    async (reason) => {
      await expect(
        redirectTarget(
          Promise.resolve().then(() => {
            redirectIfSignedOut(apiError(401, undefined, { code: 'session_expired', reason }));
          }),
        ),
      ).resolves.toBe(`/login/signed-out?reason=${reason}`);
    },
  );

  it('sends a 401 session_expired without a known reason to sign in', async () => {
    await expect(
      redirectTarget(
        Promise.resolve().then(() => {
          redirectIfSignedOut(apiError(401, undefined, { code: 'session_expired', reason: 'x' }));
        }),
      ),
    ).resolves.toBe('/login');
  });

  it('returns for anything else', () => {
    expect(() => {
      redirectIfSignedOut(apiError(403, 'forbidden'));
    }).not.toThrow();
    expect(() => {
      redirectIfSignedOut(new Error('bug'));
    }).not.toThrow();
  });
});

describe('ForbiddenError', () => {
  it('names the permissions that were missing', () => {
    const error = new ForbiddenError(['users:read', 'users:write']);

    expect(error.permissions).toEqual(['users:read', 'users:write']);
    expect(error.message).toBe('Missing permissions: users:read, users:write');
    expect(error.name).toBe('ForbiddenError');
  });
});
