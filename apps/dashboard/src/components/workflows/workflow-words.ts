/**
 * The words of workflows and runs (C120, C141; ADR 0007): each status, reason and type the API
 * serves, said as what happened. Keyed by string so a value the console does not know yet still
 * renders (`wordOf`), and each list's test walks the core vocabulary first.
 */
import { CONNECT_PROBLEM_WORDS } from '../connect/connect-problem-words';

export const WORKFLOW_STATUS_WORDS: Readonly<Record<string, string>> = {
  paused: 'Paused',
  running: 'Running',
  archived: 'Archived',
};

/** C121.5: why a workflow is paused, the banner's words. */
export const WORKFLOW_PAUSED_REASON_WORDS: Readonly<Record<string, string>> = {
  operator: 'Paused by an operator',
  publisher_revoked:
    'Paused because its publisher lost a right its live version needs; runs stop at their next such step, and only a republish by someone who holds the rights starts it again',
};

export const WORKFLOW_VERSION_STATUS_WORDS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export const WORKFLOW_TRIGGER_TYPE_WORDS: Readonly<Record<string, string>> = {
  'trigger-event': 'An event',
  'trigger-api': 'The API',
  'trigger-schedule': 'A schedule',
  'trigger-recurring': 'A recurring search',
  'trigger-direct': 'Run by hand',
  'trigger-account': 'An account action',
  'trigger-case': 'A case action',
  'trigger-verification': 'A verification event',
  // C152.2 (Phase 9): started only by an inquiry flow's run_workflow step.
  'trigger-flow': 'An inquiry flow step',
};

export const WORKFLOW_RUN_STATUS_WORDS: Readonly<Record<string, string>> = {
  in_progress: 'In progress',
  completed: 'Completed',
  errored: 'Errored',
  canceled: 'Canceled',
};

export const WORKFLOW_RUN_WAITING_ON_WORDS: Readonly<Record<string, string>> = {
  event: 'Waiting for an event',
  time: 'Waiting for a time',
  'earlier-run': 'Waiting for an earlier run of the same subject',
  'child-run': 'Waiting for a run it started',
  admission: 'Waiting for a slot in this environment',
};

export const WORKFLOW_RUN_CREATOR_WORDS: Readonly<Record<string, string>> = {
  user: 'User',
  'api-key': 'API key',
  event: 'Event',
  'scheduled-run': 'Scheduled run',
  'workflow-run': 'Workflow run',
  'account-action': 'Account action',
  'case-action': 'Case action',
  'inquiry-flow': 'Inquiry flow',
};

export const WORKFLOW_STEP_STATUS_WORDS: Readonly<Record<string, string>> = {
  pending: 'Pending',
  ready: 'Ready',
  running: 'Running',
  waiting: 'Waiting',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
  canceled: 'Canceled',
  timed_out: 'Timed out',
};

/** C118.1 (H18): what became of an event owed a run. */
export const WORKFLOW_DELIVERY_STATUS_WORDS: Readonly<Record<string, string>> = {
  pending: 'Pending',
  run_created: 'Run started',
  filtered: 'Filtered out by the trigger',
  refused: 'Refused',
  expired: 'Expired before it was processed',
};

/** C120.2: the six error types, as an open set. */
export const WORKFLOW_ERROR_TYPE_WORDS: Readonly<Record<string, string>> = {
  'missing-input-error': 'A required input was missing',
  'invalid-input-error': 'An input was not valid',
  'configuration-error': 'The workflow or an environment setting needs a change',
  'resource-error': 'An object or service the step needed was not available',
  'unknown-error': 'The step failed for a reason it could not name',
  'run-failure': 'The run as a whole failed',
};

/** C116.4: each acknowledgement a publish can need, with its reason. */
export const WORKFLOW_ACKNOWLEDGEMENT_WORDS: Readonly<Record<string, string>> = {
  egress: 'Personal data leaves OpenVerify in this step',
  irreversible: 'This step redacts objects, which cannot be undone',
  heuristic: 'This adverse step reads a heuristic (H-tier, beta) result',
  'override-failed': 'This step approves an inquiry that failed',
  unconfirmed: 'This step messages an address or number nobody confirmed',
};

/** The engine's own step error codes (C117.7, C114, C115). */
const ENGINE_ERROR_WORDS: Readonly<Record<string, string>> = {
  condition_input_null:
    'A condition read a value that is unknown (null), and its route says to stop with an error',
  execution_error: 'The step failed for a reason the engine could not name',
  expression_arithmetic_error: 'A calculation in a condition had no finite answer',
  expression_clock_missing: 'A condition read the run’s clock, which was not recorded',
  expression_conversion_failed: 'A condition could not convert a value to the type it asked for',
  expression_evaluation_failed: 'A condition could not be evaluated',
  expression_limit_exceeded: 'A condition went past its size or evaluation limit',
  expression_type_mismatch: 'A condition compared values of types that cannot be compared',
  loop_items_invalid: 'A loop’s items were not a list',
  loop_limit_exceeded: 'A loop had more than 100 items or iterations; none was dropped silently',
  payload_too_large: 'A value was larger than the limit the run stores',
  run_deadline_exceeded: 'The run went past its 90-day deadline',
  run_depth_exceeded: 'Runs started by runs went deeper than five levels',
  secret_placement_refused: 'A secret was placed where the secret does not allow it',
  step_limit_exceeded: 'The run went past 5,000 step executions',
  template_type_mismatch: 'A template’s value did not have the type its place needs',
  template_value_refused: 'A rendered value was refused where it was to be placed',
  template_variable_missing:
    'A template read a value that the run does not hold; nothing was put in its place',
  variable_type_mismatch: 'A variable was given a value of another type',
  variable_unset: 'A variable was read before it held a value',
  wait_timed_out: 'The wait ended at its timeout, with no event',
};

/** The actions' step error codes (C122 to C128, C140.3). */
const ACTION_ERROR_WORDS: Readonly<Record<string, string>> = {
  action_input_invalid: 'The step’s rendered settings were refused by the action',
  action_refused: 'The service the step called refused the change',
  biometric_consent_missing:
    'The inquiry did not record the consents a biometric decision needs; it was marked for review',
  biometric_list_not_bulk: 'A face list cannot take faces in bulk',
  case_assignee_ineligible: 'The case cannot be assigned to that operator',
  case_comment_required: 'The case’s new status needs a comment',
  case_objects_limit: 'The case already holds 1,000 objects',
  case_resolution_invalid: 'The case template has no such resolution',
  case_status_tag_required: 'The case’s new status needs one of its status tags',
  case_template_archived: 'The case template is archived',
  case_template_not_published: 'The case template has no published version',
  case_transition_refused: 'The case template does not allow that change of status',
  case_version_conflict: 'The case changed while the step ran',
  cause_lacks_scope:
    'Whoever caused the triggering event lacks the right this step needs; the inquiry was marked for review',
  code_disabled: 'Evaluate Code is turned off for this install',
  decision_basis_missing:
    'An automated adverse decision needs a decision basis and a contest route; the subject went to review',
  destination_refused: 'The request’s destination is not allowed',
  graph_index_failed: 'The graph index could not be built for this account',
  graph_index_pending: 'The graph index was still being built when the step gave up',
  graph_query_cancelled: 'The graph query was cancelled',
  graph_query_errored: 'The graph query errored; no account count was read',
  graph_query_timed_out: 'The graph query timed out; no account count was read',
  human_review_pending: 'A reopened inquiry waits for a person to decide it',
  invalid_output: 'Evaluate Code returned a value that is not JSON',
  invalid_transition: 'The inquiry’s state does not allow that decision',
  list_kind_mismatch: 'The value is not of the kind the list holds',
  list_unavailable: 'A list could not be read, so the value was not screened',
  memory_limit: 'Evaluate Code went past its memory limit',
  message_link_refused: 'The message held a link to a host that is not allowed',
  not_implemented: 'This action is registered but not built yet; leave the step out',
  object_not_found: 'The object was not found in this environment',
  object_type_unsupported: 'The action does not take that type of object',
  platform_file_not_allowed: 'The run’s rights do not cover that file field',
  provider_not_configured: 'No provider is bound for this action in this environment',
  publisher_revoked:
    'The workflow’s publisher lost a right this step needs; only a rerun after a republish goes on',
  rate_limited: 'A rate limit was reached; the step may be retried later',
  recipient_not_allowed: 'The recipient is not confirmed or not on the allowlist',
  redaction_limit_exceeded: 'A run redacts at most 100 objects',
  related_objects_limit: 'The transaction already lists 100 related objects',
  relation_cardinality_exceeded: 'The relation already has as many objects as it allows',
  report_errored: 'The report errored; it was not read as no match',
  report_input_missing: 'The report needs an input the run does not hold',
  report_selector_limit: 'More than 100 reports matched the selector; none was run',
  report_timed_out: 'The report was not ready before the timeout; it was not read as no match',
  request_failed: 'The HTTPS request failed before an answer came back',
  response_unsupported: 'The answer was not JSON or text, or was too large',
  review_required:
    'The inquiry needs a person’s review before a workflow may approve it (missing or pending evidence)',
  run_grant_insufficient: 'The run started by this step needs rights this run does not hold',
  runtime_error: 'Evaluate Code threw an error',
  sandbox_crashed: 'The Evaluate Code sandbox stopped unexpectedly',
  sandbox_sink_unavailable: 'The sandbox record of messages could not be written',
  schedule_base_invalid: 'The schedule’s base time is not a valid date',
  sla_out_of_range: 'The SLA is outside 1 second to 90 days',
  slack_not_configured: 'No Slack provider is bound in this environment',
  slack_rate_limited: 'Slack asked to slow down; the step may be retried later',
  slack_rejected: 'Slack refused the message',
  slack_unreachable: 'Slack could not be reached; whether it took the message is not known',
  smtp_rejected: 'The mail server refused the message',
  smtp_unavailable: 'The mail server could not be reached',
  stack_overflow: 'Evaluate Code went past its stack limit',
  subject_redacted: 'The run’s subject was redacted',
  tag_limit_exceeded: 'The object already has 50 tags',
  test_run_egress_disabled:
    'A test run calls no outside host unless the step is overridden or the host allowed',
  timeout: 'Evaluate Code went past its time limit',
  twilio_blocked: 'The SMS provider blocked the number',
  twilio_dns: 'The SMS provider could not be found',
  twilio_invalid_url: 'The SMS provider’s address is not valid',
  twilio_not_configured: 'No SMS provider is bound in this environment',
  twilio_rate_limited: 'The SMS provider asked to slow down; the step may be retried later',
  twilio_redirect: 'The SMS provider answered with a redirect, which is not followed',
  twilio_rejected: 'The SMS provider refused the message',
  type_mismatch: 'Evaluate Code returned a value of another type than declared',
  unknown_effect:
    'Whether the message left is not known; a resume needs that acknowledged and never sends it again',
  verification_step_missing: 'The inquiry has no verification of that type',
  verification_timed_out: 'The verification did not finish before the timeout',
  workflow_not_running: 'The workflow to start is paused or archived',
  workflow_trigger_mismatch: 'The workflow to start has a different trigger',
};

/** C120.2: each step error code the engine and the actions raise, in words. */
export const WORKFLOW_STEP_ERROR_WORDS: Readonly<Record<string, string>> = {
  ...ENGINE_ERROR_WORDS,
  ...ACTION_ERROR_WORDS,
  // C243.1 (Workflow 11A, `workflow-connect`): a Connect step answers its service's problem by its
  // code, said as the Connect console says it (`console-connect`'s words).
  ...CONNECT_PROBLEM_WORDS,
};

/** C113.5: the graph's structure. */
const STRUCTURE_WORDS: Readonly<Record<string, string>> = {
  trigger_missing: 'The workflow has no trigger yet.',
  module_input_missing: 'A module needs its module-input start node.',
  start_repeated: 'A definition has one start node.',
  output_missing: 'A definition needs its output node.',
  edge_endpoint_unknown: 'An edge leads from or to a node that does not exist.',
  edge_port_unknown: 'An edge leaves from a port its node does not have.',
  port_repeated: 'A port has more than one edge.',
  port_unconnected: 'A port leads nowhere yet.',
  node_unreachable: 'Nothing leads to this step from the start.',
  output_unreachable: 'This step does not lead on to the output.',
  cycle_refused: 'Steps lead in a circle outside a loop.',
  continue_port_invalid: 'Only a loop body’s last step leads back to its loop.',
  join_missing: 'A parallel needs its join.',
  join_repeated: 'A parallel has one join.',
  join_of_invalid: 'A join names no parallel.',
  branch_not_joined: 'A parallel’s branch does not reach its join.',
  branch_leaves: 'A parallel’s branch leads out of the parallel.',
  branch_entered: 'A step inside a branch is reached from outside it.',
  loop_body_open: 'A loop’s body does not lead back to the loop.',
  loop_body_escapes: 'A loop’s body leads out of the loop.',
  loop_body_entered: 'A step inside a loop is reached from outside it.',
  map_output_missing: 'A map loop needs its map output node.',
  map_of_invalid: 'A map output names no map loop.',
  loop_concurrency_refused: 'This loop cannot run its iterations side by side.',
  nesting_too_deep: 'Parallels and loops nest at most three deep.',
};

/** C113.5, C122.3: modules and actions. */
const ACTION_PROBLEM_WORDS: Readonly<Record<string, string>> = {
  module_nested: 'A module cannot hold a module step.',
  module_refused_for_trigger: 'This trigger cannot use a module.',
  module_unknown: 'The module is not a published module of this environment.',
  module_input_unknown: 'The module has no such input.',
  module_variables_refused: 'A module reads its parent’s variables only as inputs.',
  action_unknown: 'No action of that key and version exists.',
  action_trigger_refused: 'This action does not serve the workflow’s trigger.',
  action_requires_inquiry: 'This action needs an inquiry earlier on its path.',
  action_refused_in_loop: 'This action cannot run inside a loop.',
  config_invalid: 'The step’s settings do not fit the action.',
  config_too_large: 'The step’s settings are larger than 16 KiB.',
  retry_refused: 'This action does not allow retries.',
  literal_member_refused: 'This setting must be written as it is, not filled from a path.',
};

/** C115: declarations. */
const DECLARATION_WORDS: Readonly<Record<string, string>> = {
  type_invalid: 'The type is not one the workflow knows.',
  variable_default_invalid: 'The variable’s default does not have its type.',
  variable_unknown: 'No variable of that name is declared.',
  variable_read_only: 'A module cannot change that variable.',
  parallel_variable_conflict: 'Two branches of a parallel change the same variable.',
  output_mapping_missing: 'A declared output is not mapped by the output node.',
  output_mapping_unknown: 'The output node maps an output that is not declared.',
};

/** C114: conditions. */
const CONDITION_WORDS: Readonly<Record<string, string>> = {
  condition_malformed: 'The condition is not one the dialect reads.',
  operator_refused: 'The condition uses an operator that is not allowed.',
  operator_arity: 'An operator has the wrong number of operands.',
  operator_argument: 'An operator has an operand it does not take.',
  var_default_refused: 'A path in a condition cannot have a default.',
  path_invalid: 'The path is not written the way paths are.',
  path_unknown: 'Nothing in scope here has that path.',
  path_untyped: 'The path’s type is not known, so it cannot be compared.',
  current_case_unavailable: 'Only a case trigger has a current case.',
  type_incomparable: 'The two sides of the comparison have types that cannot be compared.',
  expression_limit_exceeded: 'The condition is past its size limit.',
  pii_literal_in_condition:
    'Personal data is never compared with typed text in a definition; use Get List Match.',
  nullable_in_boolean_position:
    'A value that can be unknown (null) cannot stand alone as true or false; compare it.',
  on_null_missing:
    'This condition reads a value that can be unknown (null): say what happens then.',
  on_null_route_unknown: 'The route named for an unknown value does not exist.',
  secret_placement_refused: 'A secret cannot be placed there.',
};

/** C119, C115.2, C124.3: loops, waits, templates and URLs. */
const TEMPLATE_WORDS: Readonly<Record<string, string>> = {
  loop_items_invalid: 'The loop’s items path is not a list.',
  wait_subject_invalid: 'The wait’s subject is not a path to an object id.',
  template_invalid: 'The template is not written the way templates are.',
  template_too_large: 'The template is larger than 32 KiB.',
  url_invalid: 'The URL is not valid.',
  url_host_not_literal: 'The URL’s host must be written as it is, not filled from a path.',
  url_scheme_refused: 'Only https URLs are allowed.',
  url_credentials_refused: 'A URL never holds a user name or password.',
  url_position_refused: 'A path can fill only a path segment or a query value of a URL.',
};

/** C116.4, C128, C118.4: the publish rules. */
const PUBLISH_WORDS: Readonly<Record<string, string>> = {
  schedule_invalid: 'The schedule is not valid.',
  schedule_zone_invalid: 'The time zone does not exist.',
  schedule_never_fires: 'The schedule never fires.',
  pii_into_plain_sink:
    'Personal data cannot go into a tag, a label, a status or anything not declared as personal data.',
  pii_in_url: 'Personal data never goes in a URL; put it in the body or a header.',
  has_match_refused: 'This report type has no match to read.',
  account_count_refused: 'An asynchronous graph query has no account count to read here.',
  reference_unknown: 'An object this step names does not exist in this environment.',
  decision_basis_missing: 'An automated adverse decision needs its decision basis.',
  contest_route_missing: 'An automated adverse decision needs a contest route.',
  contest_route_host_refused: 'The contest route’s host is not an allowed link host.',
  biometric_basis_missing: 'A biometric adverse decision needs its biometric basis.',
  recipient_not_allowed: 'The recipient is not confirmed or not on the allowlist.',
  rollout_refused_for_module: 'A module is never published by staged rollout.',
  rollout_without_control: 'A first publish has no version to roll out against.',
  rollout_trigger_changed: 'A staged rollout keeps the trigger of the live version.',
};

/** C113.6: warnings, which never block publish. */
const WARNING_WORDS: Readonly<Record<string, string>> = {
  variable_unused: 'Nothing reads this variable.',
  output_unread: 'Nothing reads this step’s output.',
  trigger_self_emitted: 'This step can emit the workflow’s own trigger event.',
  read_without_companion: 'A value is read without the value that says whether it is complete.',
  approve_without_evidence: 'An approval is reachable without waiting for a report or a list.',
  provider_not_configured: 'No provider is bound for this action here; a run reaching it errors.',
  signal_not_exposed: 'That signal is not served to workflows.',
  child_workflow_unpublished: 'The workflow this step starts has no published version.',
  child_grant_widened: 'The workflow this step starts now needs more rights than at publish.',
  publisher_scope_lost: 'The publisher no longer holds a right this version uses.',
};

/** C113.6, C116.4: each `definition_invalid` code and warning, in words. */
export const WORKFLOW_DEFINITION_PROBLEM_WORDS: Readonly<Record<string, string>> = {
  ...STRUCTURE_WORDS,
  ...ACTION_PROBLEM_WORDS,
  ...DECLARATION_WORDS,
  ...CONDITION_WORDS,
  ...TEMPLATE_WORDS,
  ...PUBLISH_WORDS,
  ...WARNING_WORDS,
};

/** C112.8: each workflow problem code an API answer carries, in words. */
export const WORKFLOW_PROBLEM_WORDS: Readonly<Record<string, string>> = {
  definition_invalid: 'The definition has problems; each is listed at its place',
  version_locked: 'The draft changed elsewhere, or a rollout locks it; reload the draft',
  draft_missing: 'The workflow has no draft',
  draft_exists: 'The target already has a draft, which a promote never replaces',
  rollout_in_progress: 'A rollout is in progress; finish or undo it first',
  promote_unresolved: 'Some references could not be found in the target environment',
  publish_grant_missing: 'You lack a right the version needs',
  publish_acknowledgement_missing: 'Publishing needs each acknowledgement listed',
  publish_trigger_fanout_exceeded: '50 published workflows already listen to this event',
  trigger_input_invalid: 'An input does not fit the version’s declared inputs',
  workflow_not_running: 'The workflow is paused or archived',
  run_not_resumable: 'The run cannot be resumed',
  run_not_cancelable: 'The run has already ended',
  test_runs_sandbox_only: 'Test runs exist only in sandbox environments',
  secret_reference_invalid: 'A secret is referenced where it is not allowed',
  secret_value_missing: 'A secret has no value in this environment',
  secret_in_use: 'A published version uses this secret',
  human_review_pending: 'A reopened inquiry waits for a person to decide it',
};

/** A step error code in words; a Slack code is Slack’s own, and an unknown one stays a code. */
export function stepErrorWords(code: string): string {
  const said = WORKFLOW_STEP_ERROR_WORDS[code];
  if (said !== undefined) {
    return said;
  }
  return code.startsWith('slack_') ? `Slack refused the message (${code.slice(6)})` : code;
}

/** A definition problem code in words, or the code when the console has none. */
export function definitionProblemWords(code: string): string {
  return wordOf(WORKFLOW_DEFINITION_PROBLEM_WORDS, code);
}

/** The word for `value`, or the value itself when the console has none. */
export function wordOf(words: Readonly<Record<string, string>>, value: string): string {
  return words[value] ?? value;
}

/** C120.1 (H32): a run's status, with its step errors said, never hidden behind "completed". */
export function runStatusWords(
  status: string,
  outcomes: {
    readonly 'failed-continued': number;
    readonly 'timed-out': number;
    readonly 'unknown-effect': number;
  },
): string {
  const said = wordOf(WORKFLOW_RUN_STATUS_WORDS, status);
  const errors = outcomes['failed-continued'] + outcomes['timed-out'] + outcomes['unknown-effect'];
  if (errors === 0) {
    return said;
  }
  const count = `${String(errors)} step ${errors === 1 ? 'error' : 'errors'}`;
  const unknown =
    outcomes['unknown-effect'] === 0
      ? ''
      : ` (${String(outcomes['unknown-effect'])} outcome${outcomes['unknown-effect'] === 1 ? '' : 's'} unknown)`;
  return `${said} with ${count}${unknown}`;
}
