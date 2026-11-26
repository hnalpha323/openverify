/**
 * The one error type of the flow API clients. It never carries a token: messages name the
 * method and path only.
 */
import type { Problem } from '@openverify/contracts';

export type FlowApiErrorKind =
  /** The request never got a response (offline, DNS, CORS, TLS). */
  | 'network'
  /** No complete answer arrived in time (1B F018); retrying may help. */
  | 'timeout'
  /** The server answered with a non-2xx status. */
  | 'http'
  /** A 2xx response did not match the contract. */
  | 'invalid-response'
  /** The caller aborted the request. */
  | 'aborted';

export class FlowApiError extends Error {
  override readonly name = 'FlowApiError';
  readonly kind: FlowApiErrorKind;
  /** HTTP status when the server answered, otherwise `null`. */
  readonly status: number | null;
  /** The problem document of an `http` error, when the body was valid problem+json. */
  readonly problem: Problem | null;

  constructor(
    kind: FlowApiErrorKind,
    message: string,
    details: { status?: number | null; problem?: Problem | null; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.kind = kind;
    this.status = details.status ?? null;
    this.problem = details.problem ?? null;
  }
}
