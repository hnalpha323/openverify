import { problemSchema } from '@openverify/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp, type BuildAppOptions } from './app.js';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  MfaRequiredError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitedError,
  SessionInactiveError,
  UnauthorizedError,
  UnprocessableContentError,
  UnsupportedMediaTypeError,
} from './errors.js';

const PROBLEM_JSON = 'application/problem+json; charset=utf-8';

interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: { location: string; pointer: string; detail: string }[];
  stack?: string;
}

const apps: ReturnType<typeof buildApp>[] = [];

function makeApp(options: Partial<BuildAppOptions> = {}) {
  const app = buildApp({
    lookupApiKey: () => Promise.resolve(null),
    logger: false,
    mode: 'production',
    ...options,
  });
  app.get('/boom', { config: { public: true } }, () => {
    throw new Error('connection to db-internal.example:5432 refused for user svc_admin');
  });
  app.get('/teapot', { config: { public: true } }, () => {
    throw new AppError({
      status: 418,
      title: "I'm a teapot",
      detail: 'Short and stout.',
      type: 'https://example.test/problems/teapot',
    });
  });
  app.get('/third-party-4xx', { config: { public: true } }, () => {
    throw Object.assign(new Error('row 42 conflicts with tenant acme internal id 9'), {
      statusCode: 409,
    });
  });
  app.post(
    '/echo',
    {
      config: { public: true },
      schema: { body: z.object({ name: z.string().min(1), age: z.number().int() }) },
    },
    (request) => request.body,
  );
  apps.push(app);
  return app;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('RFC 9457 problem details', () => {
  it('answers an unknown route with a 404 problem', async () => {
    const response = await makeApp().inject({
      url: '/nope',
      headers: { 'x-request-id': 'trace-1' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<Problem>()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No route matches GET /nope.',
      instance: '/nope',
      requestId: 'trace-1',
    });
  });

  it('never echoes the query string, which may carry PII', async () => {
    const response = await makeApp().inject({ url: '/nope?email=jane%40example.test' });

    expect(response.json<Problem>().instance).toBe('/nope');
    expect(response.body).not.toContain('example.test');
  });

  it('reports request validation failures as a 400 with per-field errors', async () => {
    const response = await makeApp().inject({
      method: 'POST',
      url: '/echo',
      payload: { name: '', age: 'forty' },
    });
    const problem = response.json<Problem>();

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request body failed validation.',
      instance: '/echo',
    });
    expect(problem.errors).toEqual([
      { location: 'body', pointer: '/name', detail: expect.any(String) as unknown },
      { location: 'body', pointer: '/age', detail: expect.any(String) as unknown },
    ]);
    expect(response.body).not.toContain('forty');
  });

  it('reports a malformed JSON body as a 400 problem', async () => {
    const response = await makeApp().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<Problem>()).toMatchObject({ title: 'Bad Request', status: 400 });
  });

  it('reports an unsupported media type as a 415 problem', async () => {
    const response = await makeApp().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-unknown' },
      payload: 'x',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json<Problem>()).toMatchObject({
      title: 'Unsupported Media Type',
      status: 415,
    });
  });

  it('maps an AppError to its status, title, detail and type', async () => {
    const response = await makeApp().inject({ url: '/teapot' });

    expect(response.statusCode).toBe(418);
    expect(response.json<Problem>()).toMatchObject({
      type: 'https://example.test/problems/teapot',
      title: "I'm a teapot",
      status: 418,
      detail: 'Short and stout.',
      instance: '/teapot',
    });
  });

  it('hides the message of a non-OpenVerify error even when it carries a 4xx status', async () => {
    const response = await makeApp().inject({ url: '/third-party-4xx' });

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>()).toMatchObject({ title: 'Conflict', detail: 'Conflict' });
    expect(response.body).not.toContain('tenant');
  });

  describe('unexpected errors', () => {
    it('never leak the message or stack trace in production', async () => {
      const response = await makeApp({ mode: 'production' }).inject({ url: '/boom' });
      const problem = response.json<Problem>();

      expect(response.statusCode).toBe(500);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      expect(problem).toEqual({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred.',
        instance: '/boom',
        requestId: expect.any(String) as unknown,
      });
      expect(response.body).not.toMatch(/db-internal|svc_admin|\.ts:\d+|at /);
    });

    it('include the message and stack trace in development', async () => {
      const response = await makeApp({ mode: 'development' }).inject({ url: '/boom' });
      const problem = response.json<Problem>();

      expect(problem.detail).toContain('db-internal.example:5432');
      expect(problem.stack).toMatch(/app\.test\.ts|problem-details\.test\.ts/);
    });

    it('default to production behaviour unless NODE_ENV is development or test', async () => {
      vi.stubEnv('NODE_ENV', 'staging');
      const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
      apps.push(app);
      app.get('/boom', { config: { public: true } }, () => {
        throw new Error('internal detail');
      });

      const response = await app.inject({ url: '/boom' });

      expect(response.json<Problem>().detail).toBe('An unexpected error occurred.');
      expect(response.body).not.toContain('internal detail');
    });

    it('are logged at error level with the request id', async () => {
      const lines: { level: number; requestId?: string; err?: { message: string } }[] = [];
      const app = makeApp({
        logger: {
          level: 'info',
          stream: {
            write: (line: string) => {
              lines.push(JSON.parse(line) as (typeof lines)[number]);
            },
          },
        },
      });

      await app.inject({ url: '/boom', headers: { 'x-request-id': 'trace-500' } });

      expect(lines).toContainEqual(
        expect.objectContaining({
          level: 50,
          requestId: 'trace-500',
          err: expect.objectContaining({
            message: expect.stringContaining('refused') as unknown,
          }) as unknown,
        }),
      );
    });
  });
});

describe('AppError hierarchy', () => {
  it('defaults the problem type to about:blank and the title to the status text', () => {
    const error = new AppError({ status: 409, detail: 'Already exists.' });

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.title).toBe('Conflict');
    expect(error.type).toBe('about:blank');
    expect(error.message).toBe('Already exists.');
    expect(error.headers).toEqual({});
  });

  it('provides 401 and 403 errors that carry WWW-Authenticate challenges', () => {
    const unauthorized = new UnauthorizedError('Missing key.');
    const invalid = new UnauthorizedError('Bad key.', { error: 'invalid_token' });
    const forbidden = new ForbiddenError('Missing scope.', ['inquiry.write', 'case.read']);

    expect(unauthorized).toMatchObject({ status: 401, title: 'Unauthorized' });
    expect(unauthorized.headers).toEqual({ 'www-authenticate': 'Bearer realm="openverify"' });
    expect(invalid.headers['www-authenticate']).toBe(
      'Bearer realm="openverify", error="invalid_token", error_description="Bad key."',
    );
    expect(forbidden).toMatchObject({ status: 403, title: 'Forbidden' });
    expect(forbidden.headers['www-authenticate']).toBe(
      'Bearer realm="openverify", error="insufficient_scope", scope="inquiry.write case.read"',
    );
  });

  it.each([
    [new BadRequestError('Bad cursor.'), 400, 'Bad Request'],
    [new NotFoundError('No such inquiry.'), 404, 'Not Found'],
    [new ConflictError('Already submitted.'), 409, 'Conflict'],
    [new UnsupportedMediaTypeError('Not an image.'), 415, 'Unsupported Media Type'],
    [new UnprocessableContentError('Missing files.'), 422, 'Unprocessable Content'],
  ])('provides %s with status %i and title %s', (error, status, title) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status, title, type: 'about:blank' });
    expect(error.name).toBe(error.constructor.name);
  });

  it('forbids a 403 without a scope challenge when no scope is missing', () => {
    const forbidden = new ForbiddenError('Not from this address.');

    expect(forbidden.status).toBe(403);
    expect(forbidden.headers).toEqual({});
  });
});

describe('C9 problem types and extension members', () => {
  function appThrowing(error: Error) {
    const app = makeApp();
    app.get('/fails', { config: { public: true } }, () => {
      throw error;
    });
    return app;
  }

  it('sends the problem type URI, its status and title', async () => {
    const response = await appThrowing(
      new InvalidTransitionError('An approved inquiry cannot be declined.'),
    ).inject({ url: '/fails', headers: { 'x-request-id': 'trace-c9' } });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<Problem>()).toEqual({
      type: 'https://openverify.dev/problems/invalid-transition',
      title: 'Invalid Transition',
      status: 409,
      detail: 'An approved inquiry cannot be declined.',
      instance: '/fails',
      requestId: 'trace-c9',
    });
  });

  it('sends the headers of the problem, such as Retry-After', async () => {
    const response = await appThrowing(new RateLimitedError('Slow down.', 7)).inject({
      url: '/fails',
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('7');
    expect(response.json<Problem>().type).toBe('https://openverify.dev/problems/rate-limited');
  });

  it('sends the code and per-field errors extension members when present', async () => {
    const coded = await appThrowing(new SessionInactiveError('session_canceled')).inject({
      url: '/fails',
    });
    const withErrors = await appThrowing(
      new UnprocessableContentError('Unknown fields.', [
        { location: 'body', pointer: '/data/attributes/fields/x', detail: 'is unknown' },
      ]),
    ).inject({ url: '/fails' });

    expect(coded.statusCode).toBe(401);
    expect(coded.json<Problem & { code?: string }>()).toMatchObject({
      type: 'about:blank',
      code: 'session_canceled',
    });
    expect(withErrors.json<Problem>().errors).toEqual([
      { location: 'body', pointer: '/data/attributes/fields/x', detail: 'is unknown' },
    ]);
    expect(withErrors.json<Problem>()).not.toHaveProperty('code');
  });

  it('every C9 response satisfies the contract problem schema', async () => {
    for (const error of [
      new PermissionDeniedError('Missing permission.', ['inquiries:write']),
      new MfaRequiredError(),
      new SessionInactiveError('session_expired'),
    ]) {
      const response = await appThrowing(error).inject({ url: '/fails' });

      expect(problemSchema.safeParse(response.json()).success).toBe(true);
    }
  });
});
