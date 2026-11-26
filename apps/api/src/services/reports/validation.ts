/**
 * C71.1, C72.1: a request body whose only problems sit under one member (a template's `config`, a
 * report's `query`) answers 422 with a JSON Pointer per problem, as the plan documents; any other
 * problem keeps the schema's 400. Routes attach validation (`attachValidation: true`) and call
 * {@link refuseInvalidMember} first.
 */
import type { z } from 'zod';
import type { ProblemFieldError } from '../../errors.js';

/** An RFC 6901 pointer from a path. */
export function pointerOfPath(path: readonly PropertyKey[]): string {
  return path
    .map((part) => `/${String(part).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

/**
 * Throws the problem for a body the schema refused: `unprocessable(errors)` when every issue is
 * under `member` (a path such as `['data', 'attributes', 'query']`), else the schema's own error.
 * Does nothing when the body was valid.
 */
export function refuseInvalidMember(
  validationError: Error | undefined,
  body: unknown,
  schema: z.ZodType,
  member: readonly PropertyKey[],
  unprocessable: (errors: ProblemFieldError[]) => Error,
): void {
  if (validationError === undefined) {
    return;
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    throw validationError;
  }
  const issues = parsed.error.issues;
  const under = (path: readonly PropertyKey[]) =>
    member.every((part, index) => path[index] === part) && path.length >= member.length;
  if (issues.length === 0 || !issues.every((issue) => under(issue.path))) {
    throw validationError;
  }
  throw unprocessable(
    issues.map((issue) => ({
      location: 'body',
      pointer: pointerOfPath(issue.path),
      detail: issue.message,
    })),
  );
}
