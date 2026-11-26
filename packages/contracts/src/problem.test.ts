import { describe, expect, it } from 'vitest';
import {
  FLOW_SESSION_INACTIVE_CODES,
  MFA_SIGN_IN_PROBLEM_CODES,
  PROBLEM_MEDIA_TYPE,
  PROBLEM_TYPES,
  PROBLEM_TYPE_BASE_URI,
  SESSION_CANCELED_REASONS,
  flowSessionInactiveCodeSchema,
  mfaSignInProblemCodeSchema,
  problemSchema,
  problemTypeSlugOf,
  problemTypeSlugSchema,
  problemTypeUri,
  sessionCanceledReasonSchema,
} from './problem.js';

const problem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'No inquiry matches the given id.',
  instance: '/api/v1/inquiries/inq_01M5CJXHG07XPHF3HRM6NREDH7',
  requestId: '00000000-0000-4000-8000-000000000001',
};

describe('problemSchema (RFC 9457)', () => {
  it('uses the problem+json media type', () => {
    expect(PROBLEM_MEDIA_TYPE).toBe('application/problem+json');
  });

  it('accepts the members the API always sends', () => {
    expect(problemSchema.parse(problem)).toEqual(problem);
  });

  it('accepts validation errors and development stack traces', () => {
    const withErrors = {
      ...problem,
      status: 400,
      title: 'Bad Request',
      errors: [{ location: 'body', pointer: '/data/attributes/name', detail: 'Required' }],
      stack: 'Error: boom',
    };
    expect(problemSchema.parse(withErrors)).toEqual(withErrors);
  });

  it('keeps unknown extension members, as RFC 9457 §3.2 allows', () => {
    expect(problemSchema.parse({ ...problem, retryAfter: 5 })).toEqual({
      ...problem,
      retryAfter: 5,
    });
  });

  it.each([
    ['a success status', { ...problem, status: 200 }],
    ['a non-integer status', { ...problem, status: 404.5 }],
    ['no request id', { ...problem, requestId: undefined }],
    ['no title', { ...problem, title: '' }],
    ['malformed errors', { ...problem, errors: [{ pointer: '/x' }] }],
  ])('rejects %s', (_name, value) => {
    expect(problemSchema.safeParse(value).success).toBe(false);
  });
});

describe('problem types (C9)', () => {
  it('maps every C9 slug to its status', () => {
    expect(
      Object.fromEntries(Object.entries(PROBLEM_TYPES).map(([slug, { status }]) => [slug, status])),
    ).toEqual({
      'invalid-transition': 409,
      'template-archived': 422,
      'idempotency-key-reused': 422,
      'idempotency-key-in-use': 409,
      'rate-limited': 429,
      'unsupported-api-version': 400,
      'sandbox-only': 403,
      forbidden: 403,
      'mfa-required': 401,
      redacted: 410,
    });
    for (const { title } of Object.values(PROBLEM_TYPES)) {
      expect(title.length).toBeGreaterThan(0);
    }
    expect(Object.isFrozen(PROBLEM_TYPES)).toBe(true);
  });

  it('builds the type URI from the slug and reads it back', () => {
    expect(PROBLEM_TYPE_BASE_URI).toBe('https://openverify.dev/problems/');
    expect(problemTypeUri('rate-limited')).toBe('https://openverify.dev/problems/rate-limited');
    expect(problemTypeSlugOf('https://openverify.dev/problems/mfa-required')).toBe('mfa-required');
    expect(problemTypeSlugOf('about:blank')).toBeNull();
    expect(problemTypeSlugOf('https://openverify.dev/problems/toString')).toBeNull();
    expect(problemTypeSlugSchema.safeParse('redacted').success).toBe(true);
    expect(problemTypeSlugSchema.safeParse('teapot').success).toBe(false);
  });

  it('accepts a problem of a C9 type with a machine-readable code', () => {
    const value = {
      ...problem,
      type: problemTypeUri('invalid-transition'),
      title: PROBLEM_TYPES['invalid-transition'].title,
      status: 409,
      code: 'invalid_inquiry_transition',
    };
    expect(problemSchema.parse(value)).toEqual(value);
    expect(problemSchema.safeParse({ ...value, code: 'Not A Code' }).success).toBe(false);
  });
});

describe('inactive flow session codes (C10)', () => {
  it('tell the flow which screen to show', () => {
    expect(FLOW_SESSION_INACTIVE_CODES).toEqual(['session_expired', 'session_canceled']);
    expect(flowSessionInactiveCodeSchema.safeParse('session_canceled').success).toBe(true);
    expect(flowSessionInactiveCodeSchema.safeParse('session_revoked').success).toBe(false);
  });
});

describe('MFA sign-in problem codes (C25.1, Workflow 2E)', () => {
  it('say whether the mfa-token can still be used', () => {
    expect(MFA_SIGN_IN_PROBLEM_CODES).toEqual([
      'mfa_code_invalid',
      'mfa_attempts_exhausted',
      'mfa_token_invalid',
    ]);
    for (const code of MFA_SIGN_IN_PROBLEM_CODES) {
      expect(mfaSignInProblemCodeSchema.safeParse(code).success).toBe(true);
      expect(problemSchema.safeParse({ ...problem, status: 401, code }).success).toBe(true);
    }
    expect(mfaSignInProblemCodeSchema.safeParse('mfa_required').success).toBe(false);
  });
});

describe('why a flow session was canceled (C25.8, Workflow 2E)', () => {
  const canceled = {
    ...problem,
    title: 'Unauthorized',
    status: 401,
    detail: 'The session was canceled.',
    instance: '/api/v1/flow/session',
    code: 'session_canceled',
  };

  it('is one of three reasons derived from the inquiry', () => {
    expect(SESSION_CANCELED_REASONS).toEqual([
      'inquiry_redacted',
      'inquiry_expired',
      'inquiry_finished',
    ]);
    expect(sessionCanceledReasonSchema.safeParse('inquiry_expired').success).toBe(true);
    expect(sessionCanceledReasonSchema.safeParse('inquiry_deleted').success).toBe(false);
  });

  it('is an optional, enumerated member of the problem', () => {
    for (const reason of SESSION_CANCELED_REASONS) {
      expect(problemSchema.parse({ ...canceled, reason })).toEqual({ ...canceled, reason });
    }
    expect(problemSchema.parse(canceled)).toEqual(canceled);
    expect(problemSchema.safeParse({ ...canceled, reason: 'inquiry_deleted' }).success).toBe(false);
  });
});
