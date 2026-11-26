/**
 * How the client reads an answer: a success parsed with the endpoint's contract schema, an error
 * answer turned into `OpenVerifyApiError`. Exported for callers that reach an endpoint this client
 * has no method for, such as the dashboard BFF on the dashboard API, so they parse and fail
 * exactly as every client method does.
 */
import type { z } from 'zod';
import {
  OpenVerifyApiError,
  OpenVerifyResponseValidationError,
  type ApiProblem,
} from './errors.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The problem document of an error answer, or one made from the status. */
function problemOf(response: Response, text: string): ApiProblem {
  try {
    const body: unknown = JSON.parse(text);
    if (
      isObject(body) &&
      typeof body.type === 'string' &&
      typeof body.title === 'string' &&
      typeof body.status === 'number'
    ) {
      return body as ApiProblem;
    }
  } catch {
    // Not JSON: describe the status instead.
  }
  return {
    type: 'about:blank',
    title: response.statusText === '' ? 'HTTP error' : response.statusText,
    status: response.status,
  };
}

/**
 * The error the client throws for an error answer (`response` is not ok): its problem document,
 * or one made from the status when something in front of the API answered, with the
 * `x-request-id`.
 */
export function apiErrorOf(response: Response, text: string): OpenVerifyApiError {
  return new OpenVerifyApiError(problemOf(response, text), response.headers.get('x-request-id'));
}

/** Passes over an answer that each drop the unknown members one parse reported. */
const MAX_TOLERANCE_PASSES = 10;

/**
 * A copy of `body` without the members `issues` report as unknown, or `undefined` when any
 * issue is about something else. The contract schemas are strict, and a server that is newer
 * than this client may add attributes (C9: additive changes), so unknown members are dropped
 * rather than failing an answer, which for a write would hide that it succeeded (Workflow 2B
 * F028). Everything the client knows is still checked.
 */
function withoutUnknownMembers(body: unknown, issues: readonly z.core.$ZodIssue[]): unknown {
  if (issues.length === 0 || issues.some((issue) => issue.code !== 'unrecognized_keys')) {
    return undefined;
  }
  const copy = structuredClone(body);
  for (const issue of issues) {
    let target: unknown = copy;
    for (const key of issue.path) {
      target =
        typeof target === 'object' && target !== null
          ? (target as Record<PropertyKey, unknown>)[key]
          : undefined;
    }
    if (issue.code === 'unrecognized_keys' && typeof target === 'object' && target !== null) {
      for (const key of issue.keys) {
        Reflect.deleteProperty(target, key);
      }
    }
  }
  return copy;
}

/**
 * A success answer's `text` (empty for `undefined`, as a 204 has it) parsed with `schema`.
 * @throws {OpenVerifyResponseValidationError} when it is not JSON or breaks the contract.
 */
export function parseApiAnswer<Schema extends z.ZodType>(
  schema: Schema,
  status: number,
  text: string,
): z.output<Schema> {
  let body: unknown;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    throw new OpenVerifyResponseValidationError('The API answer is not JSON', status);
  }
  let parsed = schema.safeParse(body);
  for (let pass = 0; !parsed.success && pass < MAX_TOLERANCE_PASSES; pass += 1) {
    const tolerated = withoutUnknownMembers(body, parsed.error.issues);
    if (tolerated === undefined) {
      break;
    }
    body = tolerated;
    parsed = schema.safeParse(body);
  }
  if (!parsed.success) {
    throw new OpenVerifyResponseValidationError(
      'The API answer does not match the contract this client was built with',
      status,
      parsed.error.issues,
    );
  }
  return parsed.data;
}
