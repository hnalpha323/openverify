/**
 * The step errors the actions raise, with the C120.2 type each maps to. The plaintext error columns
 * hold these codes and nothing else (C120.2); a message is set only for a configuration or an input
 * error, and never carries a value. The engine's own codes are `limits/`'s.
 *
 * Where the plan names a type it is used; the rest follow its rule: `resource-error` when an object
 * or a provider is not in the state a step needs, `configuration-error` when the author or an operator
 * must change something, and `invalid-input-error` when a rendered value is what was refused.
 */
import type { WorkflowErrorType } from '@openverify/core';
import { EVALUATE_CODE_ERROR_TYPES } from './evaluate-code.js';

const resource = 'resource-error';
const configuration = 'configuration-error';
const input = 'invalid-input-error';

export const WORKFLOW_ACTION_ERROR_TYPES = Object.freeze({
  // C127.1, C128, outcome 6.
  invalid_transition: resource,
  review_required: resource,
  subject_redacted: resource,
  human_review_pending: resource,
  decision_basis_missing: configuration,
  biometric_consent_missing: resource,
  cause_lacks_scope: configuration,
  publisher_revoked: configuration,
  run_grant_insufficient: configuration,
  // C127.2, C127.3, C127.12.
  report_timed_out: resource,
  report_errored: resource,
  report_selector_limit: configuration,
  verification_timed_out: resource,
  // C127.4.
  list_unavailable: resource,
  // C127.5, outcomes 26 and 27.
  graph_query_errored: resource,
  graph_query_timed_out: resource,
  graph_query_cancelled: resource,
  graph_index_pending: resource,
  graph_index_failed: resource,
  rate_limited: resource,
  // C127.7, outcome 33.
  related_objects_limit: resource,
  relation_cardinality_exceeded: resource,
  // C122.5.
  provider_not_configured: configuration,
  // C124, C125: `rate_limited` above is the budgets' as well.
  request_failed: resource,
  response_unsupported: resource,
  destination_refused: configuration,
  secret_placement_refused: configuration,
  test_run_egress_disabled: configuration,
  // C126.
  message_link_refused: input,
  recipient_not_allowed: input,
  smtp_unavailable: resource,
  smtp_rejected: resource,
  sandbox_sink_unavailable: resource,
  slack_rate_limited: resource,
  slack_unreachable: resource,
  slack_rejected: resource,
  slack_not_configured: configuration,
  twilio_rate_limited: resource,
  twilio_dns: resource,
  twilio_rejected: resource,
  twilio_blocked: resource,
  twilio_invalid_url: configuration,
  twilio_redirect: resource,
  twilio_not_configured: configuration,
  // Stage 3: an object, a config or a limit a step ran into.
  object_not_found: resource,
  verification_step_missing: resource,
  report_input_missing: 'missing-input-error',
  action_input_invalid: input,
  list_kind_mismatch: input,
  tag_limit_exceeded: resource,
  redaction_limit_exceeded: configuration,
  biometric_list_not_bulk: configuration,
  action_refused: resource,
  // C118.3, C119.9: the target of Run Workflow or Schedule Workflow.
  workflow_not_running: configuration,
  workflow_trigger_mismatch: configuration,
  schedule_base_invalid: input,
  // C120.3: whether a message left is not known.
  unknown_effect: 'unknown-error',
  // Workflow 8B: an action registered before its implementation lands (C140.3, F33). The author can
  // do nothing about it but leave the step out, so it is a configuration error, never unknown.
  not_implemented: configuration,
  // C129.7, C140.3: what the case services refuse, by the same rule as the rest.
  case_transition_refused: resource,
  case_comment_required: configuration,
  case_status_tag_required: configuration,
  case_resolution_invalid: configuration,
  case_objects_limit: resource,
  object_type_unsupported: input,
  case_assignee_ineligible: resource,
  case_version_conflict: resource,
  sla_out_of_range: input,
  case_template_archived: resource,
  case_template_not_published: configuration,
  // C104.2, P12 (Workflow 8C review K8-26): a `platform-file` field the run's grant cannot read; its
  // author or the run's grant must change.
  platform_file_not_allowed: configuration,
  // C243.1 (Phase 11, Workflow 11A, `workflow-connect`): what the share token services refuse a
  // Connect step, by the same rule: a token's, a source's or a consent record's state is the
  // resource's; a policy or environment that cannot carry the share is the configuration's; a body
  // that contradicts itself is the input's.
  connection_not_active: resource,
  environment_kind_mismatch: configuration,
  source_redacted: resource,
  source_not_decided: resource,
  source_is_copy: resource,
  share_source_not_allowed: configuration,
  share_source_not_supported: configuration,
  consent_required: resource,
  share_token_outlives_consent: input,
  share_token_not_expirable: resource,
  share_token_already_redeemed: resource,
  share_token_expired: resource,
  share_token_not_redeemable: resource,
  destination_not_found: resource,
  share_redeem_mode_invalid: input,
  share_redeem_meta_conflict: input,
  destination_inquiry_not_open: resource,
  consent_declined_in_flow: resource,
  // C123.6.
  ...EVALUATE_CODE_ERROR_TYPES,
} as const satisfies Record<string, WorkflowErrorType>);
export type WorkflowActionErrorCode = keyof typeof WORKFLOW_ACTION_ERROR_TYPES;
