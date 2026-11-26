import { PROBLEM_TYPES, problemTypeSlugSchema, problemTypeUri } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  IdempotencyKeyInUseError,
  IdempotencyKeyReusedError,
  InvalidTransitionError,
  MfaRequiredError,
  PermissionDeniedError,
  ProblemTypeError,
  RateLimitedError,
  RedactedError,
  SandboxOnlyError,
  SessionInactiveError,
  TemplateArchivedError,
  UnauthorizedError,
  UnprocessableContentError,
  UnsupportedApiVersionError,
} from './errors.js';

describe('C9 problem types', () => {
  it.each(problemTypeSlugSchema.options)('%s carries its URI, status and title', (slug) => {
    const error = new ProblemTypeError(slug, 'Synthetic detail.');

    expect(error).toBeInstanceOf(AppError);
    expect(error.slug).toBe(slug);
    expect(error.type).toBe(`https://openverify.dev/problems/${slug}`);
    expect(error.status).toBe(PROBLEM_TYPES[slug].status);
    expect(error.title).toBe(PROBLEM_TYPES[slug].title);
    expect(error.message).toBe('Synthetic detail.');
  });

  it.each([
    [new InvalidTransitionError('Cannot approve a created inquiry.'), 'invalid-transition', 409],
    [new TemplateArchivedError('The template is archived.'), 'template-archived', 422],
    [new IdempotencyKeyReusedError('Different body.'), 'idempotency-key-reused', 422],
    [new IdempotencyKeyInUseError('Still running.'), 'idempotency-key-in-use', 409],
    [new UnsupportedApiVersionError('Unknown version.'), 'unsupported-api-version', 400],
    [new SandboxOnlyError('Only in sandbox.'), 'sandbox-only', 403],
    [new RedactedError('The inquiry was redacted.'), 'redacted', 410],
  ] as const)('%s is the %s problem with status %i', (error, slug, status) => {
    expect(error).toBeInstanceOf(ProblemTypeError);
    expect(error).toMatchObject({ slug, status, type: problemTypeUri(slug) });
    expect(error.name).toBe(error.constructor.name);
    expect(error.headers).toEqual({});
  });

  it('rate-limited tells the client when to retry, in whole seconds', () => {
    const error = new RateLimitedError('Too many requests.', 1.2);

    expect(error).toMatchObject({ slug: 'rate-limited', status: 429, title: 'Rate Limited' });
    expect(error.headers).toEqual({ 'retry-after': '2' });
    expect(new RateLimitedError('Too many requests.', -5).headers).toEqual({ 'retry-after': '0' });
  });

  it('forbidden names the missing permissions in an insufficient_scope challenge', () => {
    const error = new PermissionDeniedError('Missing permissions.', [
      'inquiries:write',
      'pii:view',
    ]);

    expect(error).toMatchObject({ slug: 'forbidden', status: 403, title: 'Forbidden' });
    expect(error.type).toBe('https://openverify.dev/problems/forbidden');
    expect(error.headers).toEqual({
      'www-authenticate':
        'Bearer realm="openverify", error="insufficient_scope", scope="inquiries:write pii:view"',
    });
    expect(new PermissionDeniedError('No file content.').headers).toEqual({});
  });

  it('mfa-required is a 401 with a step-up challenge (RFC 9470)', () => {
    const error = new MfaRequiredError();

    expect(error).toMatchObject({ slug: 'mfa-required', status: 401, title: 'MFA Required' });
    expect(error.message).toBe(
      'This session must complete multi-factor authentication before it can do this.',
    );
    expect(error.headers['www-authenticate']).toBe(
      'Bearer realm="openverify", error="insufficient_user_authentication", ' +
        'error_description="This session must complete multi-factor authentication before it can do this."',
    );
  });
});

describe('problem extension members', () => {
  it('AppError carries an optional snake_case code and per-field errors', () => {
    const plain = new AppError({ status: 409, detail: 'Conflict.' });
    const coded = new AppError({
      status: 422,
      detail: 'Unknown field.',
      code: 'unknown_field',
      errors: [{ location: 'body', pointer: '/data/attributes/fields/x', detail: 'is unknown' }],
    });

    expect(plain.code).toBeUndefined();
    expect(plain.errors).toBeUndefined();
    expect(coded.code).toBe('unknown_field');
    expect(coded.errors).toEqual([
      { location: 'body', pointer: '/data/attributes/fields/x', detail: 'is unknown' },
    ]);
  });

  it('UnprocessableContentError can list the fields that broke the rule', () => {
    const error = new UnprocessableContentError('Fields do not match the account type.', [
      { location: 'body', pointer: '/data/attributes/fields/age', detail: 'must be a number' },
    ]);

    expect(error.errors).toHaveLength(1);
    expect(new UnprocessableContentError('No.').errors).toBeUndefined();
  });

  it.each(['session_expired', 'session_canceled'] as const)(
    'an inactive flow session answers 401 with code %s and no retry (C10)',
    (code) => {
      const error = new SessionInactiveError(code);

      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error).toMatchObject({ status: 401, type: 'about:blank', code });
      expect(error.headers['www-authenticate']).toContain('error="invalid_token"');
    },
  );
});
