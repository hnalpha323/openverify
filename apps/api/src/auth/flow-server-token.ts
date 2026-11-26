/**
 * C157.2 (Workflow 9A Stage 1b (F); review P31): the credential of the flow server on the internal
 * embed-policy route, `Authorization: Bearer <OPENVERIFY_FLOW_SERVER_TOKEN>`. During a rotation the
 * previous token (`OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS`) is accepted too. Each comparison runs in
 * constant time over SHA-256 digests, so neither the token nor its length leaks through timing; with
 * no token configured nothing is accepted.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** The flow server's tokens, from the configuration; `previous` only during a rotation. */
export interface FlowServerTokens {
  current: string;
  previous: string | null;
}

/** Which configured token the request presented, or `null` when it presented none of them. */
export type FlowServerTokenMatch = 'current' | 'previous' | null;

const BEARER = 'Bearer ';

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Whether `presented` is `expected`, in time that depends on neither. */
const sameToken = (presented: Buffer, expected: string): boolean =>
  timingSafeEqual(presented, digest(expected));

/**
 * Which configured token `authorization` (`Bearer <token>`, exactly) presents: `current`,
 * `previous` during a rotation, or `null` for anything else, a missing header and an unconfigured
 * server included. Both comparisons always run.
 */
export function matchFlowServerToken(
  authorization: string | undefined,
  tokens: FlowServerTokens | null | undefined,
): FlowServerTokenMatch {
  if (
    tokens === null ||
    tokens === undefined ||
    authorization === undefined ||
    !authorization.startsWith(BEARER) ||
    authorization.length === BEARER.length
  ) {
    return null;
  }
  const presented = digest(authorization.slice(BEARER.length));
  const current = sameToken(presented, tokens.current);
  const previous = tokens.previous !== null && sameToken(presented, tokens.previous);
  if (current) {
    return 'current';
  }
  return previous ? 'previous' : null;
}
