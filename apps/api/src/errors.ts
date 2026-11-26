import { STATUS_CODES } from 'node:http';
import {
  PHASE5_PROBLEM_STATUSES,
  REPORT_PROBLEM_STATUSES,
  type ReportProblemCode,
  LIST_PROBLEM_STATUSES,
  TRANSACTION_PROBLEM_STATUSES,
  GRAPH_PROBLEM_STATUSES,
  WORKFLOW_PROBLEM_STATUSES,
  TEMPLATE_PROBLEM_STATUSES,
  type TemplateProblemCode,
  type GraphProblemCode,
  type WorkflowProblemCode,
  type ListProblemCode,
  type TransactionProblemCode,
  SIGNAL_PROBLEM_STATUSES,
  type SignalProblemCode,
  PROBLEM_TYPES,
  problemTypeUri,
  type FlowSessionInactiveCode,
  type Phase5ProblemCode,
  type ProblemTypeSlug,
  type SessionCanceledReason,
  PHASE10_FLOW_PROBLEM_STATUSES,
  type Phase10FlowProblemCode,
} from '@openverify/contracts';

/** One failing field, in the shape request validation reports it (`errors` member). */
export interface ProblemFieldError {
  /** Which part of the request failed: `body`, `querystring`, `params` or `headers`. */
  location: string;
  /** JSON Pointer into that part, e.g. `/data/attributes/fields/age`. */
  pointer: string;
  detail: string;
  /** C113.6: a publish rule's code, on a `definition` error. */
  code?: string;
}

export interface AppErrorInit {
  status: number;
  /** Human-readable explanation. It is sent to the client, so it must never contain PII. */
  detail: string;
  /** Defaults to the HTTP status text. */
  title?: string;
  /** Problem type URI. Defaults to `about:blank` (RFC 9457 §4.2.1). */
  type?: string;
  /** Extra response headers, such as `WWW-Authenticate`. */
  headers?: Record<string, string>;
  /** Machine-readable snake_case `code` extension member, e.g. `session_expired` (C10). */
  code?: string;
  /** Why, with `code: session_canceled` (C25.8 `reason` extension member). */
  reason?: string;
  /** Per-field failures (`errors` extension member). Never include submitted values: PII. */
  errors?: readonly ProblemFieldError[];
  /**
   * More extension members (RFC 9457 §3.2), such as C52.7's `attempts-remaining`. They never
   * replace a standard member. Never PII.
   */
  members?: ProblemMembers;
}

/** RFC 9457 extension members: text and numbers, a list of codes, or a `source` pointer. */
export type ProblemMembers = Readonly<
  Record<string, string | number | readonly string[] | Readonly<Record<string, string>>>
>;

/**
 * Base class for errors the API reports on purpose. The error handler turns it into an
 * RFC 9457 problem document; any other error becomes an opaque 500 in production.
 */
export class AppError extends Error {
  override name = 'AppError';
  readonly status: number;
  readonly title: string;
  readonly type: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly code: string | undefined;
  readonly reason: string | undefined;
  readonly errors: readonly ProblemFieldError[] | undefined;
  readonly members: ProblemMembers | undefined;

  constructor(init: AppErrorInit) {
    super(init.detail);
    this.status = init.status;
    this.title = init.title ?? STATUS_CODES[init.status] ?? 'Error';
    this.type = init.type ?? 'about:blank';
    this.headers = init.headers ?? {};
    this.code = init.code;
    this.reason = init.reason;
    this.errors = init.errors;
    this.members = init.members;
  }
}

const BEARER_REALM = 'Bearer realm="openverify"';

/** RFC 6750 quoted-string values may not contain `"` or `\`. */
const quoted = (value: string): string => `"${value.replace(/["\\]/g, "'")}"`;

/** An RFC 6750 Bearer challenge with an error code and the detail as its description. */
const bearerError = (error: string, detail: string): string =>
  `${BEARER_REALM}, error=${quoted(error)}, error_description=${quoted(detail)}`;

/** The RFC 6750 `insufficient_scope` challenge naming the missing scopes or permissions. */
function insufficientScope(missing: readonly string[]): Record<string, string> {
  return missing.length === 0
    ? {}
    : {
        'www-authenticate': `${BEARER_REALM}, error="insufficient_scope", scope=${quoted(missing.join(' '))}`,
      };
}

/** 401 with an RFC 6750 Bearer challenge. Omit `challenge` when no credentials were sent. */
export class UnauthorizedError extends AppError {
  override name = 'UnauthorizedError';

  constructor(
    detail: string,
    challenge?: { error: 'invalid_token' },
    code?: string,
    reason?: string,
  ) {
    const header = challenge === undefined ? BEARER_REALM : bearerError(challenge.error, detail);
    super({
      status: 401,
      detail,
      headers: { 'www-authenticate': header },
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

const SESSION_INACTIVE_DETAIL: Readonly<Record<FlowSessionInactiveCode, string>> = {
  session_expired: 'The session has expired.',
  session_canceled: 'The session was canceled.',
};

/**
 * 401 for a flow API call with an expired or canceled session token (C10). The `code` member
 * (`session_expired`, `session_canceled`) lets the flow show a screen without a retry; a canceled
 * session also says why (`reason`, C25.8): its inquiry was redacted, expired or finished.
 */
export class SessionInactiveError extends UnauthorizedError {
  override name = 'SessionInactiveError';

  constructor(code: FlowSessionInactiveCode, reason?: SessionCanceledReason) {
    super(SESSION_INACTIVE_DETAIL[code], { error: 'invalid_token' }, code, reason);
  }
}

/**
 * 403 for valid credentials that may not do this, such as a client address outside the API
 * key's allowlist. With `missingScopes`, it carries an RFC 6750 `insufficient_scope` challenge
 * naming them. A principal without a route's permission gets {@link PermissionDeniedError}.
 */
export class ForbiddenError extends AppError {
  override name = 'ForbiddenError';

  constructor(detail: string, missingScopes: readonly string[] = []) {
    super({ status: 403, detail, headers: insufficientScope(missingScopes) });
  }
}

/** 400 for a request that is well-formed JSON but cannot be used, e.g. a stale cursor. */
export class BadRequestError extends AppError {
  override name = 'BadRequestError';

  constructor(detail: string) {
    super({ status: 400, detail });
  }
}

/**
 * 404 for a resource that does not exist in the caller's environment. Resources of other
 * environments are reported the same way, never as 403 (C2 tenant isolation).
 */
export class NotFoundError extends AppError {
  override name = 'NotFoundError';

  constructor(detail: string) {
    super({ status: 404, detail });
  }
}

/** 409 for a request the resource's current state does not allow. */
export class ConflictError extends AppError {
  override name = 'ConflictError';

  constructor(detail: string) {
    super({ status: 409, detail });
  }
}

/** 413 for a file over the cap of its kind (C52.4). */
export class PayloadTooLargeError extends AppError {
  override name = 'PayloadTooLargeError';

  constructor(detail: string) {
    super({ status: 413, detail });
  }
}

/** 415 for a body whose type the API does not accept, such as an upload that is not an image. */
export class UnsupportedMediaTypeError extends AppError {
  override name = 'UnsupportedMediaTypeError';

  constructor(detail: string) {
    super({ status: 415, detail });
  }
}

/**
 * 422 for a valid body that breaks a rule of the resource it targets (RFC 9110 §15.5.21).
 * `errors` may point at the fields that broke it.
 */
export class UnprocessableContentError extends AppError {
  override name = 'UnprocessableContentError';

  constructor(detail: string, errors?: readonly ProblemFieldError[]) {
    super({
      status: 422,
      title: 'Unprocessable Content',
      detail,
      ...(errors === undefined ? {} : { errors }),
    });
  }
}

// C9 problem types ------------------------------------------------------------

/** What a {@link ProblemTypeError} may add to its slug and detail. */
export interface ProblemTypeErrorInit {
  headers?: Record<string, string>;
  code?: string;
  errors?: readonly ProblemFieldError[];
}

/**
 * An error with a C9 problem type: `type` is `https://openverify.dev/problems/<slug>`, and the
 * status and title are the slug's (`PROBLEM_TYPES` in @openverify/contracts). Phase 1 errors keep
 * `about:blank`.
 */
export class ProblemTypeError extends AppError {
  override name = 'ProblemTypeError';
  readonly slug: ProblemTypeSlug;

  constructor(slug: ProblemTypeSlug, detail: string, init: ProblemTypeErrorInit = {}) {
    const { status, title } = PROBLEM_TYPES[slug];
    super({ ...init, status, title, type: problemTypeUri(slug), detail });
    this.slug = slug;
  }
}

/** 409 `invalid-transition`: the resource's status does not allow this change (C10, C11). */
export class InvalidTransitionError extends ProblemTypeError {
  override name = 'InvalidTransitionError';

  constructor(detail: string) {
    super('invalid-transition', detail);
  }
}

/** 422 `template-archived`: inquiries cannot be created from an archived template (C11). */
export class TemplateArchivedError extends ProblemTypeError {
  override name = 'TemplateArchivedError';

  constructor(detail: string) {
    super('template-archived', detail);
  }
}

/** 422 `idempotency-key-reused`: the key was used before with a different request (C12). */
export class IdempotencyKeyReusedError extends ProblemTypeError {
  override name = 'IdempotencyKeyReusedError';

  constructor(detail: string) {
    super('idempotency-key-reused', detail);
  }
}

/** 409 `idempotency-key-in-use`: a request with this key is still in progress (C12). */
export class IdempotencyKeyInUseError extends ProblemTypeError {
  override name = 'IdempotencyKeyInUseError';

  constructor(detail: string) {
    super('idempotency-key-in-use', detail);
  }
}

/** 429 `rate-limited` with `Retry-After` in whole seconds (C12). */
export class RateLimitedError extends ProblemTypeError {
  override name = 'RateLimitedError';

  constructor(detail: string, retryAfterSeconds: number) {
    const seconds = Math.max(0, Math.ceil(retryAfterSeconds));
    super('rate-limited', detail, { headers: { 'retry-after': String(seconds) } });
  }
}

/** 400 `unsupported-api-version`: the `OpenVerify-Version` header names no known version. */
export class UnsupportedApiVersionError extends ProblemTypeError {
  override name = 'UnsupportedApiVersionError';

  constructor(detail: string) {
    super('unsupported-api-version', detail);
  }
}

/** 403 `sandbox-only`: the action exists only in sandbox environments (C10). */
export class SandboxOnlyError extends ProblemTypeError {
  override name = 'SandboxOnlyError';

  constructor(detail: string) {
    super('sandbox-only', detail);
  }
}

/**
 * 403 `forbidden` (C12, C15): the principal lacks a permission, such as the route's scope or
 * `pii:view` for file content. With `missing`, it carries an RFC 6750 `insufficient_scope`
 * challenge naming them.
 */
export class PermissionDeniedError extends ProblemTypeError {
  override name = 'PermissionDeniedError';

  constructor(detail: string, missing: readonly string[] = []) {
    super('forbidden', detail, { headers: insufficientScope(missing) });
  }
}

const MFA_REQUIRED_DETAIL =
  'This session must complete multi-factor authentication before it can do this.';

/**
 * 401 `mfa-required` (C15): the organization requires MFA and the user session has not
 * satisfied it. The challenge uses the RFC 9470 `insufficient_user_authentication` error.
 */
export class MfaRequiredError extends ProblemTypeError {
  override name = 'MfaRequiredError';

  constructor(detail: string = MFA_REQUIRED_DETAIL) {
    super('mfa-required', detail, {
      headers: { 'www-authenticate': bearerError('insufficient_user_authentication', detail) },
    });
  }
}

/** 410 `redacted` (C16): the resource's PII or file was requested after redaction. */
export class RedactedError extends ProblemTypeError {
  override name = 'RedactedError';

  constructor(detail: string) {
    super('redacted', detail);
  }
}

// C52.7 Phase 5 problem codes --------------------------------------------------

/** What a {@link Phase5ProblemError} may add to its code and detail. */
export interface Phase5ProblemInit {
  /**
   * Extension members, such as `attempts-remaining` (`otp_incorrect`) or `resend-available-at`
   * (`otp_resend_too_soon`). Never PII: no destination, code or entered value.
   */
  members?: Readonly<Record<string, string | number>>;
  /** Such as `Retry-After` on `otp_rate_limited`. */
  headers?: Record<string, string>;
  /** C55.7: `otp_rate_limited` answers 503 instead of 429 while the limit store is down. */
  storeUnavailable?: boolean;
  /** JSON Pointers to the fields that broke a rule. */
  errors?: readonly ProblemFieldError[];
}

/**
 * A C52.7 problem: the status `PHASE5_PROBLEM_STATUSES` gives its code, `type` `about:blank`,
 * the code as the `code` member and any extension members, as the golden problems in
 * `contracts/fixtures/problems/flow/` show them.
 */
export class Phase5ProblemError extends AppError {
  override name = 'Phase5ProblemError';
  declare readonly code: Phase5ProblemCode;

  constructor(code: Phase5ProblemCode, detail: string, init: Phase5ProblemInit = {}) {
    if (init.storeUnavailable === true && code !== 'otp_rate_limited') {
      throw new RangeError('Only otp_rate_limited answers 503 while the limit store is down');
    }
    const status = init.storeUnavailable === true ? 503 : PHASE5_PROBLEM_STATUSES[code];
    super({
      status,
      // RFC 9110 names 422 "Unprocessable Content", as `UnprocessableContentError` does.
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
      ...(init.members === undefined ? {} : { members: init.members }),
    });
  }
}

/** What a report problem carries besides its code and detail (C72.4). */
export interface ReportProblemInit {
  /** JSON Pointers to the fields that broke a rule. */
  errors?: readonly ProblemFieldError[];
  /** Such as `Retry-After`. */
  headers?: Record<string, string>;
}

/**
 * A C72.4 report problem: the status `REPORT_PROBLEM_STATUSES` gives its code, `type`
 * `about:blank`, the code as the `code` member, as the golden problems in
 * `contracts/fixtures/problems/reports/` show them.
 */
export class ReportProblemError extends AppError {
  override name = 'ReportProblemError';
  declare readonly code: ReportProblemCode;

  constructor(code: ReportProblemCode, detail: string, init: ReportProblemInit = {}) {
    const status = REPORT_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
    });
  }
}

/** What a Workflow 7A signal or handoff problem carries besides its code and detail. */
export interface SignalProblemInit {
  /** JSON Pointers to the fields that broke a rule. */
  errors?: readonly ProblemFieldError[];
  /** Such as `Retry-After` on `handoff_send_limited`. */
  headers?: Record<string, string>;
  /** `handoff_send_limited` answers 503 instead of 429 while the budget store is down (C96.3). */
  storeUnavailable?: boolean;
}

/**
 * A Workflow 7A problem: the status `SIGNAL_PROBLEM_STATUSES` gives its code, `type`
 * `about:blank`, the code as the `code` member, as the golden problems in
 * `contracts/fixtures/problems/signals/` show them. Never PII: no address, fingerprint or
 * destination.
 */
export class SignalProblemError extends AppError {
  override name = 'SignalProblemError';
  declare readonly code: SignalProblemCode;

  constructor(code: SignalProblemCode, detail: string, init: SignalProblemInit = {}) {
    if (init.storeUnavailable === true && code !== 'handoff_send_limited') {
      throw new RangeError('Only handoff_send_limited answers 503 while the budget store is down');
    }
    const status = init.storeUnavailable === true ? 503 : SIGNAL_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
    });
  }
}

interface ListProblemInit {
  errors?: readonly ProblemFieldError[];
  headers?: Record<string, string>;
}

/** Workflow 7B: a problem of `LIST_PROBLEM_STATUSES` (C97-C100), with its code and status. */
export class ListProblemError extends AppError {
  override name = 'ListProblemError';
  declare readonly code: ListProblemCode;

  constructor(code: ListProblemCode, detail: string, init: ListProblemInit = {}) {
    const status = LIST_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
    });
  }
}

interface TransactionProblemInit {
  errors?: readonly ProblemFieldError[];
  headers?: Record<string, string>;
}

/** Workflow 7B: a problem of `TRANSACTION_PROBLEM_STATUSES` (C104, C105), with its code and status. */
export class TransactionProblemError extends AppError {
  override name = 'TransactionProblemError';
  declare readonly code: TransactionProblemCode;

  constructor(code: TransactionProblemCode, detail: string, init: TransactionProblemInit = {}) {
    const status = TRANSACTION_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
    });
  }
}

interface GraphProblemInit {
  errors?: readonly ProblemFieldError[];
  headers?: Record<string, string>;
}

/** Workflow 7B: a problem of `GRAPH_PROBLEM_STATUSES` (C101-C103), with its code and status. */
export class GraphProblemError extends AppError {
  override name = 'GraphProblemError';
  declare readonly code: GraphProblemCode;

  constructor(code: GraphProblemCode, detail: string, init: GraphProblemInit = {}) {
    const status = GRAPH_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
    });
  }
}

interface WorkflowProblemInit {
  errors?: readonly ProblemFieldError[];
  headers?: Record<string, string>;
  /** Amendment 18: `missing-scopes`, `source`, `blocked-by` and `step-id`. Never a value. */
  members?: ProblemMembers;
}

/**
 * Workflow 8A: a problem of `WORKFLOW_PROBLEM_STATUSES` (C112.8), with its code and status. A
 * `definition_invalid` lists `errors[] { location: definition, pointer, code, detail }` (C113.6).
 */
export class WorkflowProblemError extends AppError {
  override name = 'WorkflowProblemError';
  declare readonly code: WorkflowProblemCode;

  constructor(code: WorkflowProblemCode, detail: string, init: WorkflowProblemInit = {}) {
    const status = WORKFLOW_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
      ...(init.members === undefined ? {} : { members: init.members }),
    });
  }
}

/**
 * Workflow 9A (C174.8): a problem of `TEMPLATE_PROBLEM_STATUSES` (template versions, their routes
 * and the embedding settings) with its code and status, and `errors[]` naming each refused place by
 * JSON Pointer, never its value. Placed by `foundation-9a` (Stage 1b (F)) for the embedding
 * settings and the redirect check; `api-templates` throws it too.
 */
export class TemplateProblemError extends AppError {
  override name = 'TemplateProblemError';
  declare readonly code: TemplateProblemCode;

  constructor(
    code: TemplateProblemCode,
    detail: string,
    errors?: readonly ProblemFieldError[],
    init: { headers?: Record<string, string>; members?: ProblemMembers } = {},
  ) {
    const status = TEMPLATE_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(errors === undefined ? {} : { errors }),
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.members === undefined ? {} : { members: init.members }),
    });
  }
}

/**
 * A Phase 10 problem of the flow API (C221.6): the status `PHASE10_FLOW_PROBLEM_STATUSES` gives its
 * code, `type` `about:blank` and the code as the `code` member, as the golden problems in
 * `contracts/fixtures/problems/flow/` show them (`client_unable_not_allowed`,
 * `sandbox_chip_anchor_missing`, `sandbox_chip_scenario_unavailable`; 10B's
 * `integrity_challenge_invalid` has its own class). The detail never names a value the client sent.
 */
export class Phase10FlowProblemError extends AppError {
  override name = 'Phase10FlowProblemError';
  declare readonly code: Phase10FlowProblemCode;

  constructor(code: Phase10FlowProblemCode, detail: string) {
    const status = PHASE10_FLOW_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
    });
  }
}

/** 501: a route that exists in the contract but is not built yet (Workflow 4A Stage 1 stubs). */
export class NotImplementedError extends AppError {
  override name = 'NotImplementedError';

  constructor(detail: string) {
    super({ status: 501, detail });
  }
}
