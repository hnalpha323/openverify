/**
 * C147.6, C147.7, C148.3, C148.4, C149.2 (owner `flow-spec-logic`, Workflow 9A Stage 2): the graph
 * rules run after the schema on save, validate, publish and promote, and the canonical form the
 * `flow-sha256` hash is computed over. Stubs until built: they throw, so nothing passes unchecked.
 */
import { canonicalJson } from './canonical-json.js';
import { checkContent } from './rules/screens.js';
import { Problems } from './rules/shared.js';
import { checkStructure } from './rules/structure.js';
import { checkWarnings } from './rules/warnings.js';
import type { FlowProblem } from './schemas/problems.js';
import type { FlowV2 } from './schemas/flow.js';

export { canonicalJson } from './canonical-json.js';
export { MAX_FIELD_SCHEMAS, checkFieldSchemaChanges } from './rules/fields.js';
export { REVEALING_WORDS } from './rules/warnings.js';
export * from './analyses.js';

/** WCAG 2.2.1's 20 hours (C147.6, C171.4): a shorter window warns at publish. */
export const SHORT_WINDOW_SECONDS = 72_000;

/** The 2.2.1 warning on a version's windows, by pointer into its settings. Never blocks. */
export function checkSettingsWindows(
  settings: Readonly<Record<string, number | null | undefined>>,
): FlowProblem[] {
  return Object.entries(settings)
    .filter(
      ([name, seconds]) =>
        WINDOW_SETTINGS.includes(name) &&
        typeof seconds === 'number' &&
        seconds < SHORT_WINDOW_SECONDS,
    )
    .map(([name]) => ({
      pointer: `/${name}`,
      code: 'window_below_20_hours',
      detail:
        'A person may need more time than this window gives (WCAG 2.2.1); 20 hours is the threshold',
      severity: 'warning' as const,
    }));
}

/** The windows a person lives through (C11, C151.10); a one-time link's lifetime is not one. */
const WINDOW_SETTINGS: readonly string[] = [
  'inquiry-expiration-seconds',
  'session-expiration-seconds',
  'inquiry-expiration-after-start-seconds',
  'inquiry-expiration-after-resume-seconds',
];

/** A template field as the graph rules read it (C149.1): its key, type and PII mark. */
export interface FieldSchemaInput {
  readonly key: string;
  readonly type: string;
  readonly pii: boolean;
}

export interface FlowGraphOptions {
  /** `publish` adds the publish rules (C154.9) to the save rules. */
  readonly mode: 'save' | 'publish';
  /**
   * The version's `field-schemas` (C149): bindings are typed against them and each bound field's
   * PII mark read. Absent, bindings are not typed and every bound field counts as PII (fail closed).
   */
  readonly fieldSchemas?: readonly FieldSchemaInput[];
  /** The version's link fields that hold a URL (C162.3); absent, link buttons are not checked. */
  readonly linkFields?: readonly string[];
  /** The version's consent step uses custom consent copy (C162.9, V11). */
  readonly customConsentCopy?: boolean;
  /** The copy keys whose text is a legal notice (C162.2); default `COPY_KEYS` with `legal: notice`. */
  readonly noticeKeys?: readonly string[];
  /** `verification-config`'s checks by verification type (core's names), for the beta warning. */
  readonly checks?: Readonly<
    Record<
      string,
      Readonly<Record<string, { readonly enabled: boolean; readonly required: boolean }>>
    >
  >;
}

/** The error codes of the graph, component and field rules (beside C174.8's). */
export const FLOW_GRAPH_PROBLEM_CODES = Object.freeze([
  'entry_unknown',
  'edge_endpoint_unknown',
  'port_invalid',
  'port_duplicate',
  'port_unwired',
  'action_error_edge_missing',
  'step_unreachable',
  'terminal_unreachable',
  'cycle_not_allowed',
  'verification_type_repeated',
  'step_order_invalid',
  'consent_not_dominating',
  'step_id_reserved',
  'screen_submit_missing',
  'button_port_duplicate',
  'link_field_unset',
  'pattern_refused',
  'visibility_scope_invalid',
  'visibility_rule_invalid',
  'screen_components_too_many',
  'container_too_deep',
  'step_too_large',
  'flow_too_large',
  'field_binding_mismatch',
  'field_unknown',
  'on_null_route_unknown',
  'action_source_invalid',
  'field_type_changed',
  'fields_too_many',
] as const);

/** The warnings, which never block (C147.6, C150.9, C150.11, C151.7, C151.8). */
export const FLOW_GRAPH_WARNING_CODES = Object.freeze([
  'unverified_path',
  'verification_all_beta',
  'duplicate_collection',
  'step_id_revealing',
  'spec1_unsupported',
  'client_signal_before_screen',
  'tipping_off_route',
] as const);

/** Every graph, component, field and publish rule's problem, by pointer; warnings included. */
export function checkFlowGraph(
  flow: FlowV2,
  options: FlowGraphOptions = { mode: 'save' },
): FlowProblem[] {
  const problems = new Problems();
  const structure = checkStructure(flow, options, problems);
  checkContent(flow, options, problems);
  checkWarnings(flow, structure.model, structure.entryKnown, options, problems);
  return problems.list;
}

/** The RFC 8785 canonical JSON of everything but `layout` (C147.7); its SHA-256 is `flow-sha256`. */
export function canonicalFlowJson(flow: FlowV2): string {
  return canonicalJson({ ...flow, layout: undefined });
}
