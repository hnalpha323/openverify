import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type ProblemFieldError, type ProblemMembers } from './errors.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/**
 * RFC 9457 problem details, plus the `requestId` extension member. `type` is `about:blank` or a
 * C9 type, `https://openverify.dev/problems/<slug>`.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  /** Machine-readable snake_case code, e.g. `session_expired` (C10). */
  code?: string;
  /** Why a flow session was canceled, with `code: session_canceled` (C25.8). */
  reason?: string;
  /** Per-field failures: request validation, or an `AppError` that lists them. */
  errors?: ProblemFieldError[];
  /** Only outside production. */
  stack?: string;
}

type ProblemBody = Omit<ProblemDetails, 'instance' | 'requestId'>;

interface Classified {
  problem: ProblemBody;
  headers: Readonly<Record<string, string>>;
  /** More extension members (C52.7), such as `attempts-remaining`; never a standard one. */
  members?: ProblemMembers | undefined;
}

export interface ProblemDetailsOptions {
  /** Include messages and stack traces of unexpected errors. Never enable in production. */
  exposeInternals: boolean;
}

const statusText = (status: number): string => STATUS_CODES[status] ?? 'Error';

/** The path without the query string, which may carry PII. */
const pathOf = (url: string): string => url.split('?', 1)[0] ?? url;

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599;
}

/** Fastify's own errors have `FST_` codes and messages that are safe to show. */
const isFastifyError = (error: Partial<FastifyError>): boolean =>
  typeof error.code === 'string' && error.code.startsWith('FST_');

function classify(error: Error & Partial<FastifyError>, exposeInternals: boolean): Classified {
  if (error instanceof AppError) {
    const problem: ProblemBody = {
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.message,
    };
    if (error.code !== undefined) {
      problem.code = error.code;
    }
    if (error.reason !== undefined) {
      problem.reason = error.reason;
    }
    if (error.errors !== undefined) {
      problem.errors = error.errors.map((failure) => ({ ...failure }));
    }
    return { problem, headers: error.headers, members: error.members };
  }

  if (Array.isArray(error.validation)) {
    const location = error.validationContext ?? 'request';
    return {
      problem: {
        type: 'about:blank',
        title: statusText(400),
        status: 400,
        detail: `The request ${location} failed validation.`,
        errors: error.validation.map((issue) => ({
          location,
          pointer: issue.instancePath,
          detail: issue.message ?? 'is invalid',
        })),
      },
      headers: {},
    };
  }

  const status = isHttpStatus(error.statusCode) ? error.statusCode : 500;
  if (status < 500) {
    let detail = statusText(status);
    if (error instanceof SyntaxError) {
      detail = 'The request body is not valid JSON.';
    } else if (isFastifyError(error)) {
      detail = error.message;
    }
    return {
      problem: { type: 'about:blank', title: statusText(status), status, detail },
      headers: {},
    };
  }

  const problem: ProblemBody = {
    type: 'about:blank',
    title: statusText(status),
    status,
    detail: exposeInternals ? error.message : 'An unexpected error occurred.',
  };
  if (exposeInternals && error.stack !== undefined) {
    problem.stack = error.stack;
  }
  return { problem, headers: {} };
}

function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  { problem, headers, members }: Classified,
): FastifyReply {
  // Extension members never replace a standard one.
  const body: ProblemDetails = {
    ...members,
    ...problem,
    instance: pathOf(request.url),
    requestId: request.id,
  };
  return reply.code(problem.status).headers(headers).type(PROBLEM_CONTENT_TYPE).send(body);
}

/** Answers every error and unknown route with `application/problem+json` (RFC 9457). */
export function registerProblemDetails(app: FastifyInstance, options: ProblemDetailsOptions): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, {
      problem: {
        type: 'about:blank',
        title: statusText(404),
        status: 404,
        detail: `No route matches ${request.method} ${pathOf(request.url)}.`,
      },
      headers: {},
    }),
  );

  app.setErrorHandler<Error & Partial<FastifyError>>((error, request, reply) => {
    const classified = classify(error, options.exposeInternals);
    if (classified.problem.status >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ err: error }, 'request rejected');
    }
    return sendProblem(request, reply, classified);
  });
}
