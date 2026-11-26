/**
 * RFC 9457 problem details, as `apps/api` sends them (see `apps/api/src/problem-details.ts`).
 * `requestId` is a Phase 0 extension member and keeps its camelCase name. Unknown extension
 * members are kept, because RFC 9457 §3.2 tells clients to ignore them rather than fail.
 */
import {
  CONTRAST_NON_TEXT_MINIMUM,
  CONTRAST_PALETTE_TOKENS,
  CONTRAST_TEXT_MINIMUM,
} from '@openverify/core';
import { z } from 'zod';

export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

/** Problem `type` URIs are this base plus a slug (C9). Phase 1 errors keep `about:blank`. */
export const PROBLEM_TYPE_BASE_URI = 'https://openverify.dev/problems/';

/** The problem types Phase 2 adds (C9), with their HTTP status and title. */
export const PROBLEM_TYPES = Object.freeze({
  'invalid-transition': { status: 409, title: 'Invalid Transition' },
  'template-archived': { status: 422, title: 'Template Archived' },
  'idempotency-key-reused': { status: 422, title: 'Idempotency Key Reused' },
  'idempotency-key-in-use': { status: 409, title: 'Idempotency Key In Use' },
  'rate-limited': { status: 429, title: 'Rate Limited' },
  'unsupported-api-version': { status: 400, title: 'Unsupported API Version' },
  /** The action exists only in sandbox environments. */
  'sandbox-only': { status: 403, title: 'Sandbox Only' },
  /** The principal lacks the route's permission (an API key scope or a user permission). */
  forbidden: { status: 403, title: 'Forbidden' },
  /** The organization requires MFA and this session has not satisfied it. */
  'mfa-required': { status: 401, title: 'MFA Required' },
  /** The resource was redacted; its PII and files are gone. */
  redacted: { status: 410, title: 'Redacted' },
} as const);

export type ProblemTypeSlug = keyof typeof PROBLEM_TYPES;

export const problemTypeSlugSchema = z.enum([
  'invalid-transition',
  'template-archived',
  'idempotency-key-reused',
  'idempotency-key-in-use',
  'rate-limited',
  'unsupported-api-version',
  'sandbox-only',
  'forbidden',
  'mfa-required',
  'redacted',
] as const satisfies readonly ProblemTypeSlug[]);

/** `https://openverify.dev/problems/<slug>`. */
export function problemTypeUri(slug: ProblemTypeSlug): string {
  return `${PROBLEM_TYPE_BASE_URI}${slug}`;
}

/** The slug of a C9 problem type URI, or `null` for any other `type`. */
export function problemTypeSlugOf(type: string): ProblemTypeSlug | null {
  if (!type.startsWith(PROBLEM_TYPE_BASE_URI)) {
    return null;
  }
  const result = problemTypeSlugSchema.safeParse(type.slice(PROBLEM_TYPE_BASE_URI.length));
  return result.success ? result.data : null;
}

/**
 * `code` of the 401 a flow API call gets with an inactive session token (C10), so the hosted
 * flow and Android can show the right screen without offering a retry.
 */
export const FLOW_SESSION_INACTIVE_CODES = ['session_expired', 'session_canceled'] as const;
export const flowSessionInactiveCodeSchema = z.enum(FLOW_SESSION_INACTIVE_CODES);
export type FlowSessionInactiveCode = z.infer<typeof flowSessionInactiveCodeSchema>;

/**
 * `code` of the 401 a failed MFA sign-in gets from `POST /dashboard/sessions/mfa` and
 * `POST /dashboard/sessions/mfa/webauthn/verify` (C25.1, Workflow 2E):
 * - `mfa_code_invalid`: a wrong TOTP code, recovery code or assertion; the `mfa-token` can still
 *   be used;
 * - `mfa_attempts_exhausted`: the wrong attempt that revoked the token (the fifth, C15);
 * - `mfa_token_invalid`: an unknown, expired, used or revoked `mfa-token`.
 *
 * Only the first keeps the operator on the second-factor step; the others mean signing in again.
 */
export const MFA_SIGN_IN_PROBLEM_CODES = [
  'mfa_code_invalid',
  'mfa_attempts_exhausted',
  'mfa_token_invalid',
] as const;
export const mfaSignInProblemCodeSchema = z.enum(MFA_SIGN_IN_PROBLEM_CODES);
export type MfaSignInProblemCode = z.infer<typeof mfaSignInProblemCodeSchema>;

/**
 * `reason` of the flow API's 401 `session_canceled` problem (C25.8, Workflow 2E), derived from
 * the inquiry when the call is made: `inquiry_redacted` when it is redacted, `inquiry_expired`
 * when its status is `expired`, `inquiry_finished` otherwise. `session_expired` has no reason.
 */
export const SESSION_CANCELED_REASONS = [
  'inquiry_redacted',
  'inquiry_expired',
  'inquiry_finished',
] as const;
export const sessionCanceledReasonSchema = z.enum(SESSION_CANCELED_REASONS);
export type SessionCanceledReason = z.infer<typeof sessionCanceledReasonSchema>;

/**
 * C232.1, C234.1 (Phase 11, Workflow 11A): what a consent record lacks for the share or redemption
 * that cites it, the `reason` member of Connect's 422 `consent_required`. One consent authorises
 * one token, so a record another token cites is `already_used`.
 */
export const CONSENT_REQUIRED_REASONS = [
  'missing',
  'subject',
  'recipient',
  'categories',
  'explicit_biometric',
  'attested_not_accepted',
  'withdrawn',
  'expired',
  'already_used',
] as const;
export const consentRequiredReasonSchema = z.enum(CONSENT_REQUIRED_REASONS);
export type ConsentRequiredReason = z.infer<typeof consentRequiredReasonSchema>;

/**
 * C245.2 (Phase 11, Workflow 11B): why a console session ended, the `reason` member of the console's
 * 401 `session_expired`: `idle` after `OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS` without an
 * authenticated request, `absolute` after `OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS` in all. The
 * flow API's own `session_expired` (C10) has no reason.
 */
export const SESSION_EXPIRED_REASONS = ['idle', 'absolute'] as const;
export const sessionExpiredReasonSchema = z.enum(SESSION_EXPIRED_REASONS);
export type SessionExpiredReason = z.infer<typeof sessionExpiredReasonSchema>;

const problemCodeSchema = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a snake_case code');

export const problemValidationErrorSchema = z.strictObject({
  /**
   * Which part of the request failed: `body`, `querystring`, `params` or `headers`, or
   * `definition` for a workflow definition (C113.6), whose pointers start at its root.
   */
  location: z.string(),
  /** JSON Pointer into that part, e.g. `/data/attributes/name`. */
  pointer: z.string(),
  detail: z.string(),
  /** The rule broken at this pointer, for a problem that has several (C113.6). */
  code: problemCodeSchema.optional(),
});

export const problemSchema = z.looseObject({
  /** Problem type URI: `about:blank`, or `problemTypeUri(slug)` for the C9 types. */
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.int().min(400).max(599),
  /** Human-readable explanation. Never contains PII. */
  detail: z.string(),
  /** Request path, without the query string. */
  instance: z.string(),
  /** Same value as the `x-request-id` response header. */
  requestId: z.string().min(1),
  errors: z.array(problemValidationErrorSchema).optional(),
  /** Machine-readable snake_case code, for example `session_expired`. */
  code: problemCodeSchema.optional(),
  /**
   * Why a flow session was canceled, with `code: session_canceled` (C25.8); or, with Connect's
   * `code: consent_required`, what the consent record lacks (C232.1, Workflow 11A); or, with the
   * console's `code: session_expired`, which limit ended the session (C245.2, Workflow 11B).
   */
  reason: z
    .union([sessionCanceledReasonSchema, consentRequiredReasonSchema, sessionExpiredReasonSchema])
    .optional(),
  /** Only outside production. */
  stack: z.string().optional(),
});

export type Problem = z.infer<typeof problemSchema>;

/**
 * C52.7: the problem `code`s Phase 5 adds, frozen in Workflow 5A Stage 1a, and the status each
 * answers with; one golden problem each in `contracts/fixtures/problems/flow/`. A later code is a
 * plan amendment whose fixture and Android listing the integration agent adds.
 * - `inputs_required` (409): a form type submitted before its values were entered (C52.6);
 * - `verification_created_by_server` (409): a create or submit of a silent AAMVA step (C52.2, C59.6);
 * - `otp_channel_not_configured` (422, publish): no SMS sender or mailer for the step (C55.10);
 * - `otp_destination_invalid`, `otp_destination_not_allowed` (422): the C55.8 destination rules;
 * - `otp_resend_too_soon` (429, with `resend-available-at`): a cooldown (C55.6);
 * - `otp_rate_limited` (429 with `Retry-After`, or 503 when the limit store is down): a C55.7
 *   limit refused the user; the refusal is recorded, so the client may submit for review;
 * - `otp_delivery_failed` (502): the provider did not take the send (C55.6);
 * - `otp_not_sent` (409): a confirm with no open code;
 * - `otp_incorrect` (422, with `attempts-remaining`), `otp_expired`, `otp_code_exhausted` (409);
 * - `otp_attempts_exhausted`, `otp_not_confirmed` (409): the verification was submitted (C55.5,
 *   C55.6), so the client offers "start again";
 * - `otp_already_confirmed` (409): a send or confirm after confirmation (C55.4);
 * - `crypto_chain_not_offered`, `crypto_address_invalid`, `crypto_expected_address_mismatch` (422):
 *   the C57.2 challenge refusals;
 * - `crypto_challenge_invalid`, `chip_challenge_invalid` (409): one body for every challenge refusal;
 * - `chip_data_required` (409): the SOD lists a data group among 1, 2, 14, 15 not uploaded (C62.5);
 * - `provider_not_configured` (422, publish): a production step whose provider is unbound (C50.4).
 */
export const PHASE5_PROBLEM_STATUSES = Object.freeze({
  inputs_required: 409,
  verification_created_by_server: 409,
  otp_channel_not_configured: 422,
  otp_destination_invalid: 422,
  otp_destination_not_allowed: 422,
  otp_resend_too_soon: 429,
  otp_rate_limited: 429,
  otp_delivery_failed: 502,
  otp_not_sent: 409,
  otp_incorrect: 422,
  otp_expired: 409,
  otp_code_exhausted: 409,
  otp_attempts_exhausted: 409,
  otp_not_confirmed: 409,
  otp_already_confirmed: 409,
  crypto_chain_not_offered: 422,
  crypto_address_invalid: 422,
  crypto_expected_address_mismatch: 422,
  crypto_challenge_invalid: 409,
  chip_challenge_invalid: 409,
  chip_data_required: 409,
  provider_not_configured: 422,
} as const);

export type Phase5ProblemCode = keyof typeof PHASE5_PROBLEM_STATUSES;

export const PHASE5_PROBLEM_CODES = Object.freeze(
  Object.keys(PHASE5_PROBLEM_STATUSES) as Phase5ProblemCode[],
);
export const phase5ProblemCodeSchema = z.enum(
  PHASE5_PROBLEM_CODES as [Phase5ProblemCode, ...Phase5ProblemCode[]],
);

/**
 * C72.4: the problem `code`s Phase 6 adds, frozen in Workflow 6A Stage 1a, and the status each
 * answers with; one golden problem each in `contracts/fixtures/problems/reports/`:
 * - `report_query_invalid` (422, pointers under `/data/attributes/query`): the query does not fit
 *   the type, or a media name is empty once reduced to letters and digits (C81.2);
 * - `report_template_not_published` (422): unknown, archived or never published; also the inquiry
 *   template's `report-config` publish rule, at `/data/attributes/report-config/on-completion/<i>`;
 * - `report_type_mismatch` (422): the template is another type;
 * - `report_not_reviewable` (409): pending, or errored with no match row (C75.6);
 * - `report_not_recurrable` (409): `run` (or a recurrence) on a type that does not recur;
 * - `report_no_scheduled_run` (409): `pause` needs an upcoming run, `resume` a paused report;
 * - `report_match_not_found` (404): an unknown `record-token` or `entity-id` within the report;
 * - `report_match_superseded` (409): a `record` review of a dismissed match whose entry already has
 *   an `open` or `delisted` row (C75.8, V07);
 * - `report_redacted` (410): every route that changes a redacted report (H23);
 * - `report_recurring_limit` (422): the environment holds its cap of recurring reports or of
 *   scheduled media runs per day (C72.5);
 * - `watchlist_source_unknown`, `watchlist_source_not_allowed`, `watchlist_sources_empty` (422,
 *   create and publish): an unknown source, a sandbox-only source in production, an empty list
 *   (C71.2, V01).
 */
export const REPORT_PROBLEM_STATUSES = Object.freeze({
  report_query_invalid: 422,
  report_template_not_published: 422,
  report_type_mismatch: 422,
  report_not_reviewable: 409,
  report_not_recurrable: 409,
  report_no_scheduled_run: 409,
  report_match_not_found: 404,
  report_match_superseded: 409,
  report_redacted: 410,
  report_recurring_limit: 422,
  watchlist_source_unknown: 422,
  watchlist_source_not_allowed: 422,
  watchlist_sources_empty: 422,
} as const);

export type ReportProblemCode = keyof typeof REPORT_PROBLEM_STATUSES;

export const REPORT_PROBLEM_CODES = Object.freeze(
  Object.keys(REPORT_PROBLEM_STATUSES) as ReportProblemCode[],
);
export const reportProblemCodeSchema = z.enum(
  REPORT_PROBLEM_CODES as [ReportProblemCode, ...ReportProblemCode[]],
);

/**
 * Workflow 7A Stage 1a (C90, C91, C94, C96): the problem `code`s Phase 7's signals, sessions and
 * handoff add, frozen here, and the status each answers with; one golden problem each in
 * `contracts/fixtures/problems/signals/`. A later code is a plan amendment.
 * - `unknown_signal` (422, publish, at `/data/attributes/signal-config/collect/<i>`): a name the
 *   registry does not hold (C90.6);
 * - `signal_not_reviewable` (422, at `/data/attributes/signal-config/review-rules/<i>/signal`): a
 *   rule on a signal registered `review-rule: false` (F31);
 * - `signal_rule_invalid` (422): a rule on a signal outside `collect`, or a comparison that does not
 *   fit the signal's type (C90.6; ours: the plan names no code for these);
 * - `provider_not_bound` (422): a `proxy_detected` rule without an `ipReputation` adapter (C90.7);
 * - `basis_required` (422): `device-recognition: exempt` without a basis (C90.8);
 * - `sandbox_only_value` (422): `sandbox-outcome` in a production environment (C90.9);
 * - `consent_required` (409): `POST /flow/signals` before the session may collect (C94.2);
 * - `consent_text_missing` (422, publish): recognition collected without the optional key (C94.6);
 * - `consent_key_conflicts_with_exempt` (422, publish): `exempt` beside the optional key (C94.6);
 * - `filter_required` (400): `GET /devices` without `filter[inquiry-session-id]` (C91.2);
 * - `session_limit_reached` (409): a session beyond the template's `max-sessions` (C91.5), only
 *   after a valid token on the unauthenticated redemptions (P28);
 * - `sms_not_configured` (422, publish): an `sms` handoff method without an SMS adapter (C96.1);
 * - `display_name_required` (422, publish): a handoff step while `organization-display-name` is
 *   empty (C96.1, F30);
 * - `destination_not_confirmed` (422): an email or SMS handoff to an unconfirmed destination (C96.3);
 * - `handoff_method_not_allowed` (422): a method the step does not offer (ours);
 * - `handoff_not_available` (409): no `device_handoff` step waits in this session's flow (ours);
 * - `handoff_token_invalid` (410): every redeem, preview and decline failure, uniform (C96.3);
 * - `session_handed_off` (409): a non-GET flow call of the issuing session while the phone's
 *   session is active (F13);
 * - `continue_here_not_allowed` (409): `continue-here` with `allow-continue-here: false` (ours);
 * - `handoff_not_redeemed` (409): a reject with no redeemed handoff to reject (ours);
 * - `handoff_send_limited` (429, or 503 when the budget store is down): the environment's send
 *   budget, which fails closed (C96.3, ours).
 */
export const SIGNAL_PROBLEM_STATUSES = Object.freeze({
  unknown_signal: 422,
  signal_not_reviewable: 422,
  signal_rule_invalid: 422,
  provider_not_bound: 422,
  basis_required: 422,
  sandbox_only_value: 422,
  consent_required: 409,
  consent_text_missing: 422,
  consent_key_conflicts_with_exempt: 422,
  filter_required: 400,
  session_limit_reached: 409,
  sms_not_configured: 422,
  display_name_required: 422,
  destination_not_confirmed: 422,
  handoff_method_not_allowed: 422,
  handoff_not_available: 409,
  handoff_token_invalid: 410,
  session_handed_off: 409,
  continue_here_not_allowed: 409,
  handoff_not_redeemed: 409,
  handoff_send_limited: 429,
} as const);

export type SignalProblemCode = keyof typeof SIGNAL_PROBLEM_STATUSES;

export const SIGNAL_PROBLEM_CODES = Object.freeze(
  Object.keys(SIGNAL_PROBLEM_STATUSES) as SignalProblemCode[],
);
export const signalProblemCodeSchema = z.enum(
  SIGNAL_PROBLEM_CODES as [SignalProblemCode, ...SignalProblemCode[]],
);

/**
 * Workflow 7B Stage 1a (C97-C100, C106.2): the problem `code`s of lists, items, matches and
 * importers, frozen here with the status each answers; one golden problem each in
 * `contracts/fixtures/problems/lists/`. No problem carries a value (C100.4).
 * - `biometric_lists_not_acknowledged` (409): a face or background list while
 *   `biometric-lists-basis` is not set (C97.4);
 * - `consent_not_given` (422): a face or background item from an inquiry without
 *   `consent.biometric-matching` (C99.7);
 * - `kind_not_collected` (422, publish): a named list of a kind the environment does not collect
 *   (C99.5, V21);
 * - `list_archived` (409): an item write to an archived list (ours);
 * - `list_kind_mismatch` (422): `list-id` names a list of another kind than the route's (ours);
 * - `list_limit_reached` (409): an environment or list at its C97.5 limit (ours);
 * - `list_item_exists` (409): the value is already active in the list (C98.1, ours);
 * - `list_match_not_open` (409): a dismissal of a dismissed match (ours);
 * - `retention_exceeds_consent` (422): a biometric list retaining items longer than
 *   `face-template-retention-days` (C97.2, P08; ours);
 * - `invalid_value`, `unparseable_phone`, `host_bits_set`, `out_of_range`, `unsupported_class` (422):
 *   an item value its normaliser refused (C98.2), the importer's row codes of the same name;
 * - `report_lists_required` (422): a custom-list report with no list, on the query or pinned on
 *   its template (C106.2; ours);
 * - `report_list_unavailable` (422): a report template pinning an archived or deleted list
 *   (C106.2; ours).
 */
export const LIST_PROBLEM_STATUSES = Object.freeze({
  biometric_lists_not_acknowledged: 409,
  consent_not_given: 422,
  kind_not_collected: 422,
  list_archived: 409,
  list_kind_mismatch: 422,
  list_limit_reached: 409,
  list_item_exists: 409,
  list_match_not_open: 409,
  retention_exceeds_consent: 422,
  invalid_value: 422,
  unparseable_phone: 422,
  host_bits_set: 422,
  out_of_range: 422,
  unsupported_class: 422,
  report_lists_required: 422,
  report_list_unavailable: 422,
} as const);

export type ListProblemCode = keyof typeof LIST_PROBLEM_STATUSES;

export const LIST_PROBLEM_CODES = Object.freeze(
  Object.keys(LIST_PROBLEM_STATUSES) as ListProblemCode[],
);
export const listProblemCodeSchema = z.enum(
  LIST_PROBLEM_CODES as [ListProblemCode, ...ListProblemCode[]],
);

/**
 * Workflow 7B Stage 1a (C104, C105): the problem `code`s of transactions and their types, frozen
 * here with the status each answers; one golden problem each in
 * `contracts/fixtures/problems/transactions/`. No problem carries a field value (C107.5).
 * - `card_number_refused` (422, at the value's position): a card-like value (C104.4, P20);
 * - `status_does_not_exist` (422): a status outside the type's `statuses` (C104.5);
 * - `field_write_once` (409): a second write of a `write_once` field (C105.2);
 * - `field_schema_invalid` (422): a rule of C104.2 or C104.3 broken across a version, or a value that
 *   breaks its field (ours);
 * - `relation_target_unsupported` (422, publish): `document-mdoc` or `document-qr-code` (C104.2);
 * - `relation_schema_unknown` (422): a relation the type does not declare (ours);
 * - `related_object_not_found` (422): an object outside the environment (ours);
 * - `relation_cardinality_exceeded` (422, pointer `/meta/relation-schema-key`): a second target of a
 *   relation that holds one (ours);
 * - `related_objects_limit` (422, pointer `/meta/object-ids`): past `TRANSACTION_LIMITS.relatedObjects`
 *   (ours);
 * - `transaction_type_archived` (409): a new transaction of an archived type (ours);
 * - `transaction_type_not_published` (422): a type with no published version (ours);
 * - `transaction_type_version_not_draft` (409): a change to a published version (ours);
 * - `transaction_redacted` (410): a change to a redacted transaction (ours);
 * - `transaction_file_too_large` (413): beyond the field's `max-file-size-bytes` (C105.2, P22);
 * - `transaction_file_refused` (422): under the minimum, the wrong signature or page count (ours);
 * - `platform_file_not_allowed` (403): a `platform-file` the principal cannot read (C104.2, P12).
 */
export const TRANSACTION_PROBLEM_STATUSES = Object.freeze({
  card_number_refused: 422,
  status_does_not_exist: 422,
  field_write_once: 409,
  field_schema_invalid: 422,
  relation_target_unsupported: 422,
  relation_schema_unknown: 422,
  related_object_not_found: 422,
  relation_cardinality_exceeded: 422,
  related_objects_limit: 422,
  transaction_type_archived: 409,
  transaction_type_not_published: 422,
  transaction_type_version_not_draft: 409,
  transaction_redacted: 410,
  transaction_file_too_large: 413,
  transaction_file_refused: 422,
  platform_file_not_allowed: 403,
} as const);

export type TransactionProblemCode = keyof typeof TRANSACTION_PROBLEM_STATUSES;

export const TRANSACTION_PROBLEM_CODES = Object.freeze(
  Object.keys(TRANSACTION_PROBLEM_STATUSES) as TransactionProblemCode[],
);
export const transactionProblemCodeSchema = z.enum(
  TRANSACTION_PROBLEM_CODES as [TransactionProblemCode, ...TransactionProblemCode[]],
);

/**
 * Workflow 7B Stage 1a (C102, C103): the problem `code`s of the graph, frozen here with the status
 * each answers; one golden problem each in `contracts/fixtures/problems/graph/`. No problem carries
 * a parameter or a value (C107.5).
 * - `weak_kind_not_allowed` (422, publish): a weak kind without `include-weak-kinds`, or the flag
 *   above 4 hops (C102.2, decision 34);
 * - `graph_parameter_unbound` (422, publish): a `{{param}}` no parameter declares (C102.2);
 * - `graph_parameter_missing` (422): a query leaving a parameter without a value (ours);
 * - `graph_parameter_not_allowed` (403): a person-identifying parameter without `pii:view` (P11);
 * - `graph_template_archived` (409): a new query of an archived template (ours);
 * - `graph_template_not_published` (422): a template with no published version (ours);
 * - `graph_template_version_not_draft` (409): a change to a published version (ours);
 * - `graph_query_not_cancellable` (409): a cancel of a query no longer submitted (C102.4);
 * - `graph_query_redacted` (410): an unmask, a rerun or an action on a redacted result (ours);
 * - `graph_sync_limited` (429): a third synchronous query in the environment (C102.4, P25);
 * - `graph_node_not_found` (404): an unmask of a node the result does not hold (ours);
 * - `selection_too_large` (422): `all: true` above 500 accounts (C103.1, P16);
 * - `biometric_list_not_bulk` (422): `add-to-list` naming a face or background list (C103.2, P16).
 */
export const GRAPH_PROBLEM_STATUSES = Object.freeze({
  weak_kind_not_allowed: 422,
  graph_parameter_unbound: 422,
  graph_parameter_missing: 422,
  graph_parameter_not_allowed: 403,
  graph_template_archived: 409,
  graph_template_not_published: 422,
  graph_template_version_not_draft: 409,
  graph_query_not_cancellable: 409,
  graph_query_redacted: 410,
  graph_sync_limited: 429,
  graph_node_not_found: 404,
  selection_too_large: 422,
  biometric_list_not_bulk: 422,
} as const);

export type GraphProblemCode = keyof typeof GRAPH_PROBLEM_STATUSES;

export const GRAPH_PROBLEM_CODES = Object.freeze(
  Object.keys(GRAPH_PROBLEM_STATUSES) as GraphProblemCode[],
);
export const graphProblemCodeSchema = z.enum(
  GRAPH_PROBLEM_CODES as [GraphProblemCode, ...GraphProblemCode[]],
);

/**
 * Workflow 8A Stage 1a (C112.8): the problem `code`s of workflows, frozen here with the status each
 * answers; one golden problem each in `contracts/fixtures/problems/workflows/`. A problem names a
 * position, a rule, a scope or a step id, and never echoes a received value (C143.5).
 * - `definition_invalid` (422): a schema, graph or publish rule, with `errors[]` holding a
 *   `location: definition`, a JSON Pointer into the definition and the rule's `code` (C113.6);
 * - `version_locked` (409): a stale `lock-version`, or a draft edited during a rollout (C116.1);
 * - `draft_missing` (409): nothing to read or publish, because the workflow has no draft (ours);
 * - `draft_exists` (409): a promote never replaces a target's draft (C112.2, P13);
 * - `rollout_in_progress` (409): a promote during a rollout (C112.2);
 * - `promote_unresolved` (422): `errors[]` names each reference by pointer, none or several
 *   candidates alike (C112.2);
 * - `publish_grant_missing` (403): `missing-scopes` names what the publisher lacks (C121.2);
 * - `publish_acknowledgement_missing` (422): each missing key at `/meta/acknowledgements`
 *   (C116.4);
 * - `publish_trigger_fanout_exceeded` (422): 50 published workflows already listen (C117.7);
 * - `trigger_input_invalid` (422): `source.pointer` names the field, never its value (C118.2);
 * - `workflow_not_running` (409): a trigger on a paused or archived workflow (C118.2);
 * - `run_not_resumable` (409): `blocked-by` says `unknown_effect`, naming its `step-id`, or
 *   `publisher_revoked` (C120.3, C121.5);
 * - `run_not_cancelable` (409): a run already ended (ours);
 * - `test_runs_sandbox_only` (403): a test run in production (C120.7);
 * - `secret_reference_invalid` (422): a reference outside its placements (C125.3);
 * - `secret_value_missing` (422): a key with no value in this environment (C125.3);
 * - `human_review_pending` (409): a decline by a run or a key while a reopen awaits a user (C128.6).
 */
export const WORKFLOW_PROBLEM_STATUSES = Object.freeze({
  definition_invalid: 422,
  version_locked: 409,
  draft_missing: 409,
  draft_exists: 409,
  rollout_in_progress: 409,
  promote_unresolved: 422,
  publish_grant_missing: 403,
  publish_acknowledgement_missing: 422,
  publish_trigger_fanout_exceeded: 422,
  trigger_input_invalid: 422,
  workflow_not_running: 409,
  run_not_resumable: 409,
  run_not_cancelable: 409,
  test_runs_sandbox_only: 403,
  secret_reference_invalid: 422,
  secret_value_missing: 422,
  /** C125.2: `DELETE /workflow-secrets/:key` while a published version references it. */
  secret_in_use: 409,
  human_review_pending: 409,
} as const);

export type WorkflowProblemCode = keyof typeof WORKFLOW_PROBLEM_STATUSES;

export const WORKFLOW_PROBLEM_CODES = Object.freeze(
  Object.keys(WORKFLOW_PROBLEM_STATUSES) as WorkflowProblemCode[],
);
export const workflowProblemCodeSchema = z.enum(
  WORKFLOW_PROBLEM_CODES as [WorkflowProblemCode, ...WorkflowProblemCode[]],
);

/**
 * Workflow 8B Stage 1a (C129.7): the problem `code`s of cases, frozen here with the status each
 * answers; one golden problem each in `contracts/fixtures/problems/cases/`. No problem carries a
 * field value, a comment, a filename or an address (C143.5): only ids, status keys and dates.
 * - `case_transition_refused` (422, at `/meta/status`): a move the version's `transitions` refuses
 *   (C131.1);
 * - `case_comment_required` (422): a status with `required-comment`, without `meta.comment` (C131.1);
 * - `case_status_tag_required` (422): a status with `status-tag-required` without one of its tags
 *   (C131.1);
 * - `case_resolution_invalid` (422): a `meta.resolution` outside the version's `resolutions` (C131.1);
 * - `case_objects_limit` (422): past 1,000 held objects (C136.2);
 * - `object_type_unsupported` (422): an object no case holds, or that the version's
 *   `held-object-types` leaves out (C136.1);
 * - `object_already_attached` (409): frozen by C129.7 and raised by no route, because a repeated
 *   attach is a `no_change` (C136.2; Stage 1a amendment 7);
 * - `case_attachment_limit` (422), `attachment_type_refused` (422): the version's attachment policy
 *   (C135.2);
 * - `attachment_infected`, `attachment_scan_pending` (409): what is never served, and what is not yet
 *   (C135.5);
 * - `case_assignee_ineligible` (422): a target outside the organisation, without `cases:write`, or
 *   who cannot see the template; a refusal never says whether an address exists elsewhere (C132.3);
 * - `case_version_conflict` (409, with `lock-version`): a stale `lock-version` (C131.2);
 * - `sla_out_of_range` (422): `sla-expires-in-seconds` outside 1 to 7,776,000 (C133.1);
 * - `calendar_invalid` (422, with `dates`): a boundary in a gap or a repeat (C133.3);
 * - `export_too_large` (422): past 10,000 cases (C138.1);
 * - `case_redacted` (410): every route that changes a redacted case (ours, as `transaction_redacted`);
 * - `case_template_archived` (409): a new case of an archived template (C130.1);
 * - `case_template_not_published` (422): a template with no published version (ours);
 * - `case_template_version_not_draft` (409): a change to a published version (ours);
 * - `case_template_key_taken` (409): a key another template of the environment holds (C130.1);
 * - `case_bulk_too_large` (422): a bulk action's search that matches more than 500 cases (C137.4);
 * - `rendition_unavailable` (422): a file vision could not render, which is never served in its place
 *   (C135.3; ours, the (F) family);
 * - `case_checklist_incomplete` (422): a status change into a status that an unchecked required
 *   checklist item names (C172.2; Workflow 9B);
 * - `case_fields_required` (422): a status change into a status whose `requires-fields` are not
 *   all set (C172.3; Workflow 9B);
 * - `case_action_not_available` (403): `run-action` for an action the case's `visible-when` hides
 *   from the caller, through the same function as `available-actions` (C172.5, review P28);
 * - `case_template_invalid` (422; K8-27, Workflow 9B): a case template version that cannot be
 *   published; `errors[]` keep the field-schema, transition-map, `field_type_changed` and
 *   notify-on-create codes;
 * - `case_search_invalid` (422; K8-27, Workflow 9B): a case search `compileCaseSearch` refuses;
 *   `errors[]` keep the `search_*` codes;
 * - `attachment_scan_failed` (409; K8-27, Workflow 9B): an attachment whose scan ended in error,
 *   which is never served (`assertServable`).
 */
export const CASE_PROBLEM_STATUSES = Object.freeze({
  case_transition_refused: 422,
  case_comment_required: 422,
  case_status_tag_required: 422,
  case_resolution_invalid: 422,
  case_objects_limit: 422,
  object_type_unsupported: 422,
  object_already_attached: 409,
  case_attachment_limit: 422,
  attachment_type_refused: 422,
  attachment_infected: 409,
  attachment_scan_pending: 409,
  case_assignee_ineligible: 422,
  case_version_conflict: 409,
  sla_out_of_range: 422,
  calendar_invalid: 422,
  export_too_large: 422,
  case_redacted: 410,
  case_template_archived: 409,
  case_template_not_published: 422,
  case_template_version_not_draft: 409,
  case_template_key_taken: 409,
  case_bulk_too_large: 422,
  rendition_unavailable: 422,
  case_checklist_incomplete: 422,
  case_fields_required: 422,
  case_action_not_available: 403,
  case_template_invalid: 422,
  case_search_invalid: 422,
  attachment_scan_failed: 409,
} as const);

export type CaseProblemCode = keyof typeof CASE_PROBLEM_STATUSES;

export const CASE_PROBLEM_CODES = Object.freeze(
  Object.keys(CASE_PROBLEM_STATUSES) as CaseProblemCode[],
);
export const caseProblemCodeSchema = z.enum(
  CASE_PROBLEM_CODES as [CaseProblemCode, ...CaseProblemCode[]],
);

/**
 * Workflow 9A Stage 1a (C174.8): the problem `code`s of the flow engine and of inquiry `fields`,
 * frozen with the status each answers; one golden problem each in
 * `contracts/fixtures/problems/flow-engine/`. No problem echoes a value (rule 11): a pointer names a
 * position, and only step ids, keys and sizes appear.
 * - `flow_step_not_current` (409): a consent, verification, upload, screen submission or handoff
 *   for a step that is not the inquiry's position; no detail of another path (C151.4);
 * - `field_unknown` (422): a `fields` key the pinned version's `field-schemas` does not declare,
 *   named by its pointer (C149.3);
 * - `field_write_once` (422): a write to a write-once field that holds a value (C148.5, C149.5);
 * - `fields_too_large` (422, with `size` and `limit` in bytes): `fields` past 256 KiB (C149.2, V17);
 * - `consent_text_mismatch` (422): a consent digest that matches no stored text for its key and
 *   locale (C162.9);
 * - `selfie_capture_not_extendable` (409): an extension after the capture was submitted (C171.4).
 */
export const FLOW_ENGINE_PROBLEM_STATUSES = Object.freeze({
  flow_step_not_current: 409,
  field_unknown: 422,
  field_write_once: 422,
  fields_too_large: 422,
  consent_text_mismatch: 422,
  selfie_capture_not_extendable: 409,
} as const);

export type FlowEngineProblemCode = keyof typeof FLOW_ENGINE_PROBLEM_STATUSES;

export const FLOW_ENGINE_PROBLEM_CODES = Object.freeze(
  Object.keys(FLOW_ENGINE_PROBLEM_STATUSES) as FlowEngineProblemCode[],
);
export const flowEngineProblemCodeSchema = z.enum(
  FLOW_ENGINE_PROBLEM_CODES as [FlowEngineProblemCode, ...FlowEngineProblemCode[]],
);

/**
 * Workflow 9A Stage 1a (C174.8): the problem `code`s of template versions, their routes and the
 * embedding settings, frozen with the status each answers; one golden problem each in
 * `contracts/fixtures/problems/templates/`. Phase 8's `definition_invalid`, `draft_exists`,
 * `promote_unresolved` and `publish_acknowledgement_missing` are reused by name and status.
 * - `definition_invalid` (422): a v2 flow breaks a graph, component, field, scope or action rule;
 *   each `errors[]` entry points into `/data/attributes/flow/...` with its `code`, among them
 *   `FLOW_DEFINITION_PROBLEM_CODES` (C147.6, C148, C150, C152);
 * - `precondition_failed` (412): `If-Match` names an older ETag; the current one is the response's
 *   `ETag` header (C154.3, RFC 9110);
 * - `draft_exists` (409): a restore, copy target or promote target already holds a draft (C154.4);
 * - `promote_unresolved` (422): a reference with none or several candidates in the target, each
 *   named by its pointer (C154.5, C160.8);
 * - `field_type_changed` (422): a field key published before with another type (C149.2);
 * - `consent_copy_incomplete` (422): custom consent copy missing in an enabled locale (C162.4);
 * - `consent_copy_missing_placeholder` (422): a biometric consent override without `{days}` (C162.2);
 * - `locale_unsupported` (422): a locale outside the five, or a region tag (C161.2);
 * - `embed_origin_invalid` (422): an allowed or per-version embed origin outside C158.1's grammar,
 *   named by its position (C158.1, C158.2);
 * - `embed_wildcard_unacknowledged` (422): a production wildcard origin without
 *   `meta.acknowledge-wildcards` (C158.1, V17);
 * - `redirect_uri_not_allowed` (422): a `redirect-uri` outside the allowed redirect origins and
 *   schemes (C158.4);
 * - `publish_acknowledgement_missing` (422): Phase 8's code, each missing key in `errors[].detail`
 *   (`adverse-path:`, `fallback:`, `heuristic:`, `asserted-fact:`, `unverified-path:`, `egress:`,
 *   `legal-copy:`, `locale-unreviewed:`; C154.9).
 */
export const TEMPLATE_PROBLEM_STATUSES = Object.freeze({
  definition_invalid: 422,
  precondition_failed: 412,
  draft_exists: 409,
  promote_unresolved: 422,
  field_type_changed: 422,
  consent_copy_incomplete: 422,
  consent_copy_missing_placeholder: 422,
  locale_unsupported: 422,
  embed_origin_invalid: 422,
  embed_wildcard_unacknowledged: 422,
  redirect_uri_not_allowed: 422,
  publish_acknowledgement_missing: 422,
} as const);

export type TemplateProblemCode = keyof typeof TEMPLATE_PROBLEM_STATUSES;

export const TEMPLATE_PROBLEM_CODES = Object.freeze(
  Object.keys(TEMPLATE_PROBLEM_STATUSES) as TemplateProblemCode[],
);
export const templateProblemCodeSchema = z.enum(
  TEMPLATE_PROBLEM_CODES as [TemplateProblemCode, ...TemplateProblemCode[]],
);

/**
 * The rule codes C174.8 names for a v2 flow, carried in `errors[].code` of a template's
 * `definition_invalid` (Workflow 9A Stage 1a). The graph, component and field checks of
 * `packages/flow-spec` (`flow-spec-logic`) and Phase 8's typing codes (`pii_literal_in_condition`,
 * `nullable_in_boolean_position`, `var_default_refused`) add their own beside these; every code is
 * snake_case, and none carries a value.
 */
export const FLOW_DEFINITION_PROBLEM_CODES = Object.freeze([
  'cycle_not_allowed',
  'action_error_edge_missing',
  'pattern_refused',
  'visibility_scope_invalid',
  'scope_path_unknown',
  'scope_path_unavailable_in_flow',
  'on_null_missing',
  'signal_wait_missing',
] as const);
export type FlowDefinitionProblemCode = (typeof FLOW_DEFINITION_PROBLEM_CODES)[number];

/**
 * Phase 10, Workflow 10B Stage 1a (C211.3, C221.6): the flow API's integrity problem, one golden
 * problem in `contracts/fixtures/problems/flow/` beside the Phase 5 ones.
 * - `integrity_challenge_invalid` (409): one body for every refusal of `POST /flow/integrity-tokens`'s
 *   challenge (unknown, already used, expired, or another session's), so nothing tells them apart.
 */
export const PHASE10_FLOW_PROBLEM_STATUSES = Object.freeze({
  integrity_challenge_invalid: 409,
  // Workflow 10C Stage 1a (C207.9, C208.1, C221.6), each with its golden problem beside it:
  // - `client_unable_not_allowed`: the verification is not the current `nfc` step's open attempt,
  //   or it was already reported;
  // - `sandbox_chip_anchor_missing`: the sandbox trust store does not hold the current Utopia
  //   anchor (`trust:sandbox-utopia` installs it);
  // - `sandbox_chip_scenario_unavailable`: a scenario this server cannot build (`face-mismatch`
  //   without the fetched fixture faces). Outside a sandbox the route is the generic 404.
  client_unable_not_allowed: 409,
  sandbox_chip_anchor_missing: 409,
  sandbox_chip_scenario_unavailable: 422,
} as const);

export type Phase10FlowProblemCode = keyof typeof PHASE10_FLOW_PROBLEM_STATUSES;

export const PHASE10_FLOW_PROBLEM_CODES = Object.freeze(
  Object.keys(PHASE10_FLOW_PROBLEM_STATUSES) as Phase10FlowProblemCode[],
);

/**
 * Phase 10, Workflow 10B Stage 1a (C210.5, C211.9, C221.6): the publish rule codes of the device-
 * integrity signals, carried in `errors[].code` of a `definition_invalid` (422): a flow's (Phase 9's
 * publish checks) and, for the first, a workflow's (Phase 8's). The integrity signals' unbound
 * provider reuses Phase 7's `provider_not_bound`.
 * - `signal_not_decisive_alone`: an adverse step (a flow's `failure`, a workflow's decline and every
 *   other adverse step) is reached from a route reading a `decisive-alone: false` signal without a
 *   verification outcome in between (C210.5);
 * - `play_integrity_notice_missing`: an environment binds a `device-integrity` provider and no screen
 *   that dominates the session-integrity collection shows `notice.play-integrity` (C211.9).
 */
export const SIGNAL_PUBLISH_RULE_CODES = Object.freeze([
  'signal_not_decisive_alone',
  'play_integrity_notice_missing',
] as const);
export type SignalPublishRuleCode = (typeof SIGNAL_PUBLISH_RULE_CODES)[number];

/**
 * Phase 11, Workflow 11A Stage 1a (C235.8, C238.2; verification V06, V09): the Connect publish rule
 * codes, carried in `errors[].code` of a template's `definition_invalid` (422). One hook in Phase 9's
 * publish file runs them all (`services/connect/publish-checks.ts`); none carries a value.
 * - `cloned_results_without_binding` (C235.8): `accept-cloned-results` is relied on behind a
 *   destination-side `share_consent` step with no live `selfie` step matched against the cloned
 *   portrait, or lists `selfie`, without the acknowledgement `cloned-results-unbound`;
 * - `share_consent_connection_invalid` (C238.2): a source-side step's connection is not an outbound
 *   connection of the template's organisation (a `pending` one publishes with the warning below);
 * - `share_consent_after_completion`: a `share_consent` step follows a completion;
 * - `share_consent_after_cloned_step`: a destination-side step does not precede every verification
 *   step whose type `accept-cloned-results` lists;
 * - `share_consent_connect_disabled` (C231.10): the install does not serve Connect;
 * - `share_consent_withdrawal_contact_missing` (C237.4): a step without its `withdrawalContact`;
 * - `share_consent_retention_missing` (C238.9): a destination-side step that can receive biometric
 *   data while neither the template nor the environment sets a retention term.
 */
export const CONNECT_PUBLISH_RULE_CODES = Object.freeze([
  'cloned_results_without_binding',
  'share_consent_connection_invalid',
  'share_consent_after_completion',
  'share_consent_after_cloned_step',
  'share_consent_connect_disabled',
  'share_consent_withdrawal_contact_missing',
  'share_consent_retention_missing',
] as const);
export type ConnectPublishRuleCode = (typeof CONNECT_PUBLISH_RULE_CODES)[number];

/** C238.2: the warning (never blocking) of a source-side step whose connection is still `pending`. */
export const CONNECT_PUBLISH_WARNING_CODES = Object.freeze([
  'share_consent_connection_not_active',
] as const);
export type ConnectPublishWarningCode = (typeof CONNECT_PUBLISH_WARNING_CODES)[number];

/**
 * Workflow 9A Stage 1a, (H) (C160): the theme problem codes, frozen with their statuses for
 * `api-themes` (Workflow 9B); one golden problem each in `contracts/fixtures/problems/themes/`.
 * - `theme_contrast_insufficient` (422, with `pairs[]`): a palette pair below its minimum, checked
 *   on every save (C160.4);
 * - `theme_set_default` (409, public): archiving the environment's default set (C160.7);
 * - `asset_type_refused` (415): an asset that is not a PNG, JPEG or WebP logo or a WOFF2 font by
 *   its bytes, SVG included (C160.6, decision 28).
 */
export const THEME_PROBLEM_STATUSES = Object.freeze({
  theme_contrast_insufficient: 422,
  theme_set_default: 409,
  asset_type_refused: 415,
} as const);

export type ThemeProblemCode = keyof typeof THEME_PROBLEM_STATUSES;

export const THEME_PROBLEM_CODES = Object.freeze(
  Object.keys(THEME_PROBLEM_STATUSES) as ThemeProblemCode[],
);
export const themeProblemCodeSchema = z.enum(
  THEME_PROBLEM_CODES as [ThemeProblemCode, ...ThemeProblemCode[]],
);

/**
 * C160.4: one failing pair. `pointer` names the foreground cell in the request
 * (`/data/attributes/styles/<light|dark>/palette/<token>`, also when the cell was absent and took
 * the built-in token); the pair is named by its tokens, never by a colour; `ratio` is never rounded.
 */
export const themeContrastPairSchema = z.strictObject({
  pointer: z.string().max(512).regex(/^\//, 'must be a JSON Pointer'),
  foreground: z.enum(CONTRAST_PALETTE_TOKENS),
  background: z.enum(CONTRAST_PALETTE_TOKENS),
  ratio: z.number().min(1).max(21),
  required: z.union([z.literal(CONTRAST_TEXT_MINIMUM), z.literal(CONTRAST_NON_TEXT_MINIMUM)]),
});

/** The problem of C160.4, with every failing pair of both palettes (16 a palette at most). */
export const themeContrastProblemSchema = problemSchema.safeExtend({
  code: z.literal('theme_contrast_insufficient'),
  pairs: z.array(themeContrastPairSchema).min(1).max(32),
});
export type ThemeContrastProblem = z.infer<typeof themeContrastProblemSchema>;

/**
 * Workflow 9B Stage 1a (C174.8): the problem codes of saved views and exports, frozen with the
 * status each answers; one golden problem each in `contracts/fixtures/problems/exports/`. Neither
 * echoes a filter's value (rule 11): a pointer names the filter key.
 * - `saved_view_pii_filter` (422): a saved view whose `filters` name a key the list marks as
 *   personal data (`reference-id`, names, emails, addresses, field values), named by its pointer
 *   (C165.2);
 * - `export_too_large` (422): an export whose selection passes its row cap, refused and never
 *   truncated (C166.1); Phase 8's case export code, with its status;
 * - `export_list_kind_refused` (422, Workflow 9D K9-29): a list export of a list whose kind has no
 *   importer (a face or selfie-background list holds templates and layouts, which no export
 *   includes, C166.3), at `/data/attributes/filter/filter[list-id]`.
 */
export const EXPORT_PROBLEM_STATUSES = Object.freeze({
  saved_view_pii_filter: 422,
  export_too_large: 422,
  export_list_kind_refused: 422,
} as const);

export type ExportProblemCode = keyof typeof EXPORT_PROBLEM_STATUSES;

export const EXPORT_PROBLEM_CODES = Object.freeze(
  Object.keys(EXPORT_PROBLEM_STATUSES) as ExportProblemCode[],
);
export const exportProblemCodeSchema = z.enum(
  EXPORT_PROBLEM_CODES as [ExportProblemCode, ...ExportProblemCode[]],
);

/**
 * Workflow 9B Stage 1a (C167.2, C168.1, C174.8): the problem codes of environment-scoped access,
 * frozen with the status each answers; one golden problem each in
 * `contracts/fixtures/problems/access/`. None names a person or another user's permissions.
 * - `role_scope_invalid` (422): an organisation-level permission (`PERMISSION_LEVEL`: `users:*`,
 *   `roles:*`) or the built-in `admin` role in an assignment narrowed to some environments, at
 *   `/assignments/<i>/environment-ids` (C167.2, review P01);
 * - `no_environment_role` (403): sign-in, or the environment switch, for a user who holds no role
 *   in any environment, or in the one asked for (C167.2, review F29);
 * - `user_more_privileged` (403): acting on a user (reset MFA, reactivate, deactivate) whose
 *   effective permissions, in some environment they can enter, are not a subset of the actor's
 *   (C168.1, review P02);
 * - `step_up_required` (403): an MFA reset or a reactivation (and a deactivation by an actor with an
 *   enrolled factor) without a second factor verified in the last 10 minutes (C168.1, V05);
 * - `user_reactivation_required` (422; Workflow 9C, orchestrator decision AC2): `PATCH
 *   /dashboard/users/:id` with `status: active` on a deactivated user, at `/data/attributes/status`;
 *   reactivation goes through `POST /dashboard/users/:id/reactivate` only (C168.1).
 */
export const ACCESS_PROBLEM_STATUSES = Object.freeze({
  role_scope_invalid: 422,
  no_environment_role: 403,
  user_more_privileged: 403,
  step_up_required: 403,
  user_reactivation_required: 422,
} as const);

export type AccessProblemCode = keyof typeof ACCESS_PROBLEM_STATUSES;

export const ACCESS_PROBLEM_CODES = Object.freeze(
  Object.keys(ACCESS_PROBLEM_STATUSES) as AccessProblemCode[],
);
export const accessProblemCodeSchema = z.enum(
  ACCESS_PROBLEM_CODES as [AccessProblemCode, ...AccessProblemCode[]],
);

/**
 * Phase 11, Workflow 11A Stage 1a (C231-C238): Connect's problem codes, frozen with the status each
 * answers; one golden problem each in `contracts/fixtures/problems/connect/`. None carries a shared
 * value, a consent's evidence, an agreement reference or another organisation's name.
 *
 * Connections (C231): `destination_not_found` (422; no organisation with that id on this install,
 * or one that has not turned on `connect-inbound`, byte-identical; also a redemption's destination
 * object, template, account or account type, with its pointer), `connection_exists` (409),
 * `connection_not_active` (409), `share_policy_changed` (409; the activation named a version that is
 * no longer current), `share_policy_invalid` (422, with JSON pointers).
 *
 * Share tokens (C232): `environment_kind_mismatch` (422), `source_redacted` (409),
 * `source_not_decided` (409), `source_is_copy` (409; a copy is never re-shared, decision 77),
 * `share_source_not_allowed` (422; the policy does not share this source type or verification
 * type), `share_source_not_supported` (422; a report id, C286), `consent_required` (422, with
 * `reason`, one of {@link CONSENT_REQUIRED_REASONS}), `share_token_outlives_consent` (422),
 * `share_token_not_expirable` (409).
 *
 * Peek (C233): `share_token_not_redeemable` (409; also a redemption of a failed token),
 * `connect_peek_unavailable` (503; the `connect-peek` policy fails closed when its store is down),
 * `share_token_peek_limit` (429; the per-token cap).
 *
 * Redemption (C234): `share_token_already_redeemed` (409), `share_token_expired` (409),
 * `share_redeem_mode_invalid` (422), `share_redeem_meta_conflict` (422),
 * `destination_inquiry_not_open` (409), `consent_declined_in_flow` (409; a witnessed decline is not
 * overridden, decision 76).
 *
 * Consent (C236-C238): `consent_already_withdrawn` (409), `explicit_consent_required` (422; the
 * share carries biometric data and the separate tick is missing), `share_consent_step_missing` (422;
 * `meta.share-token-id` with a template that has no destination-side `share_consent` step),
 * `share_token_in_use` (409; one inquiry per token).
 *
 * Reused, not declared again: Phase 9's `consent_text_mismatch` (422, `FLOW_ENGINE_PROBLEM_STATUSES`),
 * `flow_step_not_current` (409) and `step_up_required` (403, `ACCESS_PROBLEM_STATUSES`). Phase 7's
 * `consent_required` (409, `SIGNAL_PROBLEM_STATUSES`: `POST /flow/signals` before consent) is another
 * route family's code with the same name; Connect's answers 422 and always carries `reason`.
 */
export const CONNECT_PROBLEM_STATUSES = Object.freeze({
  destination_not_found: 422,
  connection_exists: 409,
  connection_not_active: 409,
  share_policy_changed: 409,
  share_policy_invalid: 422,
  environment_kind_mismatch: 422,
  source_redacted: 409,
  source_not_decided: 409,
  source_is_copy: 409,
  share_source_not_allowed: 422,
  share_source_not_supported: 422,
  consent_required: 422,
  share_token_outlives_consent: 422,
  share_token_not_expirable: 409,
  share_token_not_redeemable: 409,
  connect_peek_unavailable: 503,
  share_token_peek_limit: 429,
  share_token_already_redeemed: 409,
  share_token_expired: 409,
  share_redeem_mode_invalid: 422,
  share_redeem_meta_conflict: 422,
  destination_inquiry_not_open: 409,
  consent_declined_in_flow: 409,
  consent_already_withdrawn: 409,
  explicit_consent_required: 422,
  share_consent_step_missing: 422,
  share_token_in_use: 409,
} as const);

export type ConnectProblemCode = keyof typeof CONNECT_PROBLEM_STATUSES;

export const CONNECT_PROBLEM_CODES = Object.freeze(
  Object.keys(CONNECT_PROBLEM_STATUSES) as ConnectProblemCode[],
);
export const connectProblemCodeSchema = z.enum(
  CONNECT_PROBLEM_CODES as [ConnectProblemCode, ...ConnectProblemCode[]],
);

/** Connect's `consent_required` (422): the problem with its `reason` (C232.1, C234.1). */
export const consentRequiredProblemSchema = problemSchema.safeExtend({
  code: z.literal('consent_required'),
  reason: consentRequiredReasonSchema,
});
export type ConsentRequiredProblem = z.infer<typeof consentRequiredProblemSchema>;

/**
 * C232.8 (decision 22): the one 404 of Connect. Every token, connection or consent record the
 * caller may not see (unknown, another organisation's, the other environment kind's, a third
 * party's), every Connect route while `OPENVERIFY_CONNECT_ENABLED` is off, and every refusal the
 * contracts call "the generic 404" answers this title and detail, built by one function, so the
 * bodies are byte-identical but for the request's own path and id. It carries no `code` and names
 * no id.
 */
export const CONNECT_NOT_FOUND_PROBLEM = Object.freeze({
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'The requested resource was not found.',
} as const);

/**
 * Phase 11, Workflow 11B Stage 1a (common): the problem codes of the console's sessions and sign-in,
 * frozen with their statuses; one golden each in `contracts/fixtures/problems/sessions/` (two for
 * `session_expired`, one per reason), a folder the Android contract test does not read.
 *
 * - `session_expired` (401, with `reason` `idle` or `absolute`; C245.2): a console session past a
 *   limit. The console's BFF clears its cookie and shows the login page with "signed out after
 *   inactivity". The flow API's `session_expired` (C10, `FLOW_SESSION_INACTIVE_CODES`) is another
 *   route family's code with the same name and no reason.
 * - `login_unavailable` (503 with `Retry-After`; C246.2): sign-in, an MFA step-up or any other use
 *   of the login limiter while its store does not answer. The login limiter fails closed; the API's
 *   other limits keep failing open (H18), except `connect-peek` and `account-export`.
 */
export const CONSOLE_SESSION_PROBLEM_STATUSES = Object.freeze({
  session_expired: 401,
  login_unavailable: 503,
} as const);

export type ConsoleSessionProblemCode = keyof typeof CONSOLE_SESSION_PROBLEM_STATUSES;

/** C245.2: the console's `session_expired` with its reason, which it always carries. */
export const sessionExpiredProblemSchema = problemSchema.safeExtend({
  code: z.literal('session_expired'),
  reason: sessionExpiredReasonSchema,
});
export type SessionExpiredProblem = z.infer<typeof sessionExpiredProblemSchema>;

/**
 * C248.7, C248.8 (Workflow 11B Stage 1a; amendment 10): the problem codes of OIDC sign-in and of the
 * organisation's sign-in name, one golden each in `contracts/fixtures/problems/sso/`. Each is answered
 * to the console's BFF, which shows the browser one generic message per page; the precise code is
 * kept for the BFF, the audit entry and the logs, never a value from the identity provider.
 *
 * - `sso_not_configured` (404): an unknown organisation name, one without a provider, or a provider
 *   that is not this organisation's, all byte-identical (no oracle for which organisations exist).
 * - `sso_state_invalid` (400): the callback's `state`, browser binding or provider does not match a
 *   live, unused record (a replay, a swapped provider, a missing cookie, an expired attempt).
 * - `sso_email_unverified` (403): a first link needs `email_verified: true` in the ID token.
 * - `sso_user_unknown` (403): no linked identity and no user to link or provision.
 * - `sso_password_disabled` (403): a password sign-in for an organisation whose provider is
 *   enforced, answered only after the credentials were verified (otherwise the generic 401), so it
 *   is no oracle for which emails exist.
 * - `organization_slug_taken` (409): another organisation already holds that sign-in name.
 */
export const SSO_PROBLEM_STATUSES = Object.freeze({
  sso_not_configured: 404,
  sso_state_invalid: 400,
  sso_email_unverified: 403,
  sso_user_unknown: 403,
  sso_password_disabled: 403,
  organization_slug_taken: 409,
} as const);

export type SsoProblemCode = keyof typeof SSO_PROBLEM_STATUSES;

/**
 * C253 (Workflow 11B Stage 1a): the problem codes of the access export, one golden each in
 * `contracts/fixtures/problems/account-exports/`.
 *
 * - `account_export_pending` (409): the account already has an export being cut (C253.5).
 * - `account_export_too_large` (422, with `item-count` and `item-limit`): the manifest would list
 *   more than `ACCOUNT_EXPORT_LIMITS.items` items (C253.5).
 * - `account_export_item_redacted` (410): a file the manifest lists was redacted since (C253.2).
 * - `account_export_unavailable` (503): the `account-export` policy's store does not answer, so no
 *   export is cut or served (it fails closed, C253.7).
 */
export const ACCOUNT_EXPORT_PROBLEM_STATUSES = Object.freeze({
  account_export_pending: 409,
  account_export_too_large: 422,
  account_export_item_redacted: 410,
  account_export_unavailable: 503,
} as const);

export type AccountExportProblemCode = keyof typeof ACCOUNT_EXPORT_PROBLEM_STATUSES;

/** C253.5: the most items one export's manifest lists (ours, provisional; files count as items). */
export const ACCOUNT_EXPORT_LIMITS = Object.freeze({ items: 5000 } as const);

/** C253.5: `account_export_too_large` with the counts, never an item. */
export const accountExportTooLargeProblemSchema = problemSchema.safeExtend({
  code: z.literal('account_export_too_large'),
  'item-count': z.int().min(ACCOUNT_EXPORT_LIMITS.items + 1),
  'item-limit': z.literal(ACCOUNT_EXPORT_LIMITS.items),
});
export type AccountExportTooLargeProblem = z.infer<typeof accountExportTooLargeProblemSchema>;

/**
 * C254.1 (Workflow 11B Stage 1a; Q10 pending): `watchlist_source_locked` (409), one golden in
 * `contracts/fixtures/problems/watchlists-opt-in/`: an opt-in to a source that cannot be enabled on
 * this install, which is every opt-in to `un-sc` while `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` is
 * false, its default everywhere.
 */
export const WATCHLIST_OPT_IN_PROBLEM_STATUSES = Object.freeze({
  watchlist_source_locked: 409,
} as const);

export type WatchlistOptInProblemCode = keyof typeof WATCHLIST_OPT_IN_PROBLEM_STATUSES;
