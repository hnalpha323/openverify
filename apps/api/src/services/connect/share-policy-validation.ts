/**
 * Stage 1a amendment 27 (C230.3; Workflow 11A Stage 1b (C)): a body that fails validation only inside
 * its share policy answers 422 `share_policy_invalid` with one `errors[]` entry per issue (`location:
 * body`, the issue's JSON pointer, `~1` for a `/` inside a key such as a peek path, `~0` for a `~`,
 * RFC 6901), as `contracts/fixtures/problems/connect/share-policy-invalid.json` shows. Any other body
 * error (or a mixed one) stays Phase 1's 400. The routes that take a policy (create, change the
 * policy) set `attachValidation` and call {@link refuseInvalidSharePolicyBody} first.
 *
 * The pointers are rebuilt from the schema's own issue paths, because the type provider's
 * `instancePath` joins the path with `/` unescaped.
 */
import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { ProblemFieldError } from '../../errors.js';
import { ConnectProblemError } from './problems.js';

const POLICY_PATH = ['data', 'attributes', 'share-policy'] as const;

/** RFC 6901: one reference token. */
const escapeToken = (segment: PropertyKey): string =>
  String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

/** The JSON pointer of an issue path. */
export const jsonPointerOf = (path: readonly PropertyKey[]): string =>
  path.map((segment) => `/${escapeToken(segment)}`).join('');

const underPolicy = (path: readonly PropertyKey[]): boolean =>
  POLICY_PATH.every((segment, index) => path[index] === segment);

/**
 * For a route with `attachValidation`: throws 422 `share_policy_invalid` when every issue of the body
 * lies in its share policy, rethrows the validation error (400) otherwise; does nothing for a valid
 * request.
 */
export function refuseInvalidSharePolicyBody(request: FastifyRequest, bodySchema: ZodType): void {
  const error = request.validationError;
  if (error === undefined) {
    return;
  }
  if (error.validationContext !== 'body') {
    throw error;
  }
  const parsed = bodySchema.safeParse(request.body);
  const issues = parsed.success ? [] : parsed.error.issues;
  if (issues.length === 0 || !issues.every((issue) => underPolicy(issue.path))) {
    throw error;
  }
  const errors: ProblemFieldError[] = issues.map((issue) => ({
    location: 'body',
    pointer: jsonPointerOf(issue.path),
    detail: issue.message,
  }));
  throw new ConnectProblemError('share_policy_invalid', 'The share policy is not valid.', {
    errors,
  });
}
