/**
 * Errors the client throws. Every one extends `OpenVerifyError`; none carries the API key, a
 * request body or a response body other than the API's problem document.
 */

/** One failing request field, as the API reports it in a problem's `errors` member. */
export interface ApiProblemFieldError {
  location: string;
  pointer: string;
  detail: string;
}

/**
 * An RFC 9457 problem document from the API. The API always sends `type`, `title`, `status`,
 * `detail`, `instance` and `requestId`; an error answer from something in front of the API
 * (a proxy, a load balancer) gets a problem made from its status instead.
 */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  /**
   * Machine-readable snake_case code, such as `session_expired`, or for a failed MFA sign-in
   * (C25.1) `mfa_code_invalid`, `mfa_attempts_exhausted` or `mfa_token_invalid`.
   */
  code?: string;
  /**
   * Why, with `code: session_canceled` (C25.8): `inquiry_redacted`, `inquiry_expired` or
   * `inquiry_finished`.
   */
  reason?: string;
  errors?: ApiProblemFieldError[];
  [member: string]: unknown;
}

/** Base class of every error the client throws on purpose. */
export class OpenVerifyError extends Error {
  override name = 'OpenVerifyError';
}

/** The API answered with an error status (4xx or 5xx). */
export class OpenVerifyApiError extends OpenVerifyError {
  override name = 'OpenVerifyApiError';
  readonly status: number;
  readonly problem: ApiProblem;
  /** The problem type URI, such as `https://openverify.dev/problems/invalid-transition`. */
  readonly type: string;
  /** The `x-request-id` of the failed request, to quote when asking for help. */
  readonly requestId: string | null;
  /** The problem's `code` (see {@link ApiProblem.code}), or `null`. */
  readonly code: string | null;
  /** The problem's `reason` (see {@link ApiProblem.reason}), or `null`. */
  readonly reason: string | null;

  constructor(problem: ApiProblem, requestId: string | null) {
    super(problem.detail === undefined ? problem.title : `${problem.title}: ${problem.detail}`);
    this.status = problem.status;
    this.problem = problem;
    this.type = problem.type;
    this.requestId = requestId;
    this.code = typeof problem.code === 'string' ? problem.code : null;
    this.reason = typeof problem.reason === 'string' ? problem.reason : null;
  }
}

/** No answer arrived: the connection failed, or (subclass) the attempt timed out. */
export class OpenVerifyConnectionError extends OpenVerifyError {
  override name = 'OpenVerifyConnectionError';
}

/** An attempt took longer than `timeoutMs`. */
export class OpenVerifyTimeoutError extends OpenVerifyConnectionError {
  override name = 'OpenVerifyTimeoutError';
}

/**
 * A successful answer did not match the contract this client was built with, for example an
 * API version this client does not know. `issues` describe what did not match, by path.
 */
export class OpenVerifyResponseValidationError extends OpenVerifyError {
  override name = 'OpenVerifyResponseValidationError';
  readonly status: number;
  readonly issues: readonly unknown[];

  constructor(message: string, status: number, issues: readonly unknown[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}
