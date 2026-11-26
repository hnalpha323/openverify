/**
 * C238.2, C235.3, C235.8, C237.4, C238.9, C238.10, C231.10 (Phase 11, Workflow 11A Stage 2;
 * `connect-logic` checkpoint 4): the Connect publish rules of a template version, pure. `api-consent`'s
 * `services/connect/publish-checks.ts` gathers the facts (the version's flow, settings and copy, the
 * organisation's outbound connections, the install switch, the retention term) and calls
 * {@link connectPublishRules} from `foundation-11a`'s one hook in `flowPublishReport` (verification
 * V06); its problems and acknowledgements go through Phase 9's existing paths.
 */
import type { AcceptClonedResultsRule } from './cloned-results.js';
import type { ShareVerificationKind } from './policy.js';
import { SHARE_CONSENT_TEXT_KEYS } from './share-consent-text.js';

/** The contracts' `CONNECT_PUBLISH_RULE_CODES` and `CONNECT_PUBLISH_WARNING_CODES`, the same lists. */
export const CONNECT_PUBLISH_ERROR_CODES = Object.freeze([
  'cloned_results_without_binding',
  'share_consent_connection_invalid',
  'share_consent_after_completion',
  'share_consent_after_cloned_step',
  'share_consent_connect_disabled',
  'share_consent_withdrawal_contact_missing',
  'share_consent_retention_missing',
] as const);
export const CONNECT_PUBLISH_WARNINGS = Object.freeze([
  'share_consent_connection_not_active',
] as const);
export type ConnectPublishCode =
  (typeof CONNECT_PUBLISH_ERROR_CODES)[number] | (typeof CONNECT_PUBLISH_WARNINGS)[number];

/** One step of a flow-spec 2 flow, as far as these rules read it (a `FlowV2` step is one). */
export interface ConnectPublishStep {
  readonly id: string;
  readonly type: string;
  readonly side?: string | undefined;
  readonly connectionId?: string | undefined;
  readonly withdrawalContact?: string | undefined;
}

/** A flow-spec 2 flow's graph (a `FlowV2` is one). */
export interface ConnectPublishFlow {
  readonly entry: string;
  readonly steps: readonly ConnectPublishStep[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
}

/** `verification-config`'s checks by core verification type, as `flowPublishReport` reads them. */
export type ConnectPublishChecks = Readonly<
  Record<
    string,
    Readonly<Record<string, { readonly enabled: boolean; readonly required: boolean }>>
  >
>;

export interface ConnectPublishInput {
  /** The version's flow-spec 2 flow; `null` for a spec-1 flow (which holds no `share_consent`). */
  readonly flow: ConnectPublishFlow | null;
  /** The version's resolved `accept-cloned-results` (`null` when off). */
  readonly acceptClonedResults: AcceptClonedResultsRule | null | undefined;
  readonly checks: ConnectPublishChecks;
  /** C231.10: `config.connect.enabled`. */
  readonly connectEnabled: boolean;
  /** The template's organisation's outbound connections (its self-connection too): id to status. */
  readonly outboundConnections: Readonly<Record<string, string>>;
  /** C238.9: the template's `retention-days`, else the environment's; `null` when neither is set. */
  readonly retentionDays: number | null;
  /**
   * C238.9: whether a share into this template can carry `biometric` (an inbound connection's
   * policy allows it); a caller that cannot tell passes `true` (fail closed).
   */
  readonly destinationBiometricPossible: boolean;
  /** The version's operator copy: locale to key to text. */
  readonly copy: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly enabledLocales: readonly string[];
  /** flow-spec's `COUNSEL_REVIEW_STATUS` keys still `counsel-unreviewed` (C238.10). */
  readonly counselUnreviewedKeys: readonly string[];
  /** The publish's `meta.acknowledgements`, when known (a draft's validation passes none). */
  readonly givenAcknowledgements?: readonly string[] | undefined;
}

/** A problem as `flowPublishReport` carries it (`TemplateRuleProblem`'s shape). */
export interface ConnectPublishProblem {
  readonly pointer: string;
  readonly code: ConnectPublishCode;
  readonly detail: string;
  readonly severity: 'error' | 'warning';
}

/** An acknowledgement a publish needs (`PublishAcknowledgement`'s shape). */
export interface ConnectPublishAcknowledgement {
  readonly key: string;
  readonly pointer: string;
  readonly reason: string;
}

export interface ConnectPublishReport {
  readonly problems: readonly ConnectPublishProblem[];
  readonly acknowledgements: readonly ConnectPublishAcknowledgement[];
}

/** The flow-spec 2 step type that makes each share type's verification. */
export const STEP_TYPE_OF_SHARE_KIND: Readonly<Record<ShareVerificationKind, string>> =
  Object.freeze({
    'government-id': 'government_id',
    selfie: 'selfie',
    database: 'database',
    document: 'document',
    'email-address': 'email_otp',
    'phone-number': 'phone_otp',
  });

/** The steps reachable from the entry and each one's dominators ("on every path from the entry"). */
interface FlowGraph {
  readonly reachable: ReadonlySet<string>;
  readonly dominators: ReadonlyMap<string, ReadonlySet<string>>;
}

function successorsOf(flow: ConnectPublishFlow): Map<string, string[]> {
  const successors = new Map<string, string[]>();
  for (const edge of flow.edges) {
    successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to]);
  }
  return successors;
}

/** Every step reachable from `starts` along the edges (the starts only when an edge leads back). */
function reachableFrom(
  successors: ReadonlyMap<string, readonly string[]>,
  starts: readonly string[],
): Set<string> {
  const seen = new Set<string>();
  const queue = starts.flatMap((start) => successors.get(start) ?? []);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(...(successors.get(next) ?? []));
    }
  }
  return seen;
}

/** The classic iterative dominator sets over the steps reachable from the entry. */
function graphOf(flow: ConnectPublishFlow): FlowGraph {
  const ids = new Set(flow.steps.map((step) => step.id));
  if (!ids.has(flow.entry)) {
    return { reachable: new Set(), dominators: new Map() };
  }
  const successors = successorsOf(flow);
  const reachable = reachableFrom(successors, [flow.entry]);
  reachable.add(flow.entry);
  const predecessors = new Map<string, string[]>();
  for (const edge of flow.edges) {
    if (reachable.has(edge.from) && reachable.has(edge.to)) {
      predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
    }
  }
  const dominators = new Map<string, Set<string>>();
  for (const id of reachable) {
    dominators.set(id, id === flow.entry ? new Set([id]) : new Set(reachable));
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const id of reachable) {
      if (id === flow.entry) continue;
      const sets = (predecessors.get(id) ?? []).map(
        (from) => dominators.get(from) ?? new Set<string>(),
      );
      const next = new Set<string>([id]);
      for (const candidate of sets[0] ?? []) {
        if (sets.every((set) => set.has(candidate))) next.add(candidate);
      }
      if (next.size !== dominators.get(id)?.size) {
        dominators.set(id, next);
        changed = true;
      }
    }
  }
  return { reachable, dominators };
}

const dominates = (graph: FlowGraph, dominator: string, step: string): boolean =>
  graph.dominators.get(step)?.has(dominator) ?? false;

const error = (
  pointer: string,
  code: ConnectPublishCode,
  detail: string,
): ConnectPublishProblem => ({
  pointer,
  code,
  detail,
  severity: 'error',
});

/** C238.10: whether a step shows a built-in text counsel has not reviewed, in an enabled locale. */
function showsUnreviewedText(step: ConnectPublishStep, input: ConnectPublishInput): boolean {
  const keys = new Set(
    Object.values(SHARE_CONSENT_TEXT_KEYS[step.side === 'destination' ? 'destination' : 'source']),
  );
  const unreviewed = input.counselUnreviewedKeys.filter((key) => keys.has(key));
  // No enabled locale means the version's source locale alone.
  const locales = input.enabledLocales.length === 0 ? ['en'] : input.enabledLocales;
  return unreviewed.some((key) =>
    locales.some((locale) => {
      const texts = Object.hasOwn(input.copy, locale) ? input.copy[locale] : undefined;
      return texts === undefined || !Object.hasOwn(texts, key);
    }),
  );
}

/**
 * C235.8 (review P08): whether a person reaching the clones through a destination-side step is
 * bound to them: a cloned identity document is relied on, no cloned selfie is, and a live selfie
 * step after a destination-side step compares its face with the ID portrait (`selfie_id_comparison`
 * enabled and required), which is then the cloned portrait.
 */
function bindsClonedPortrait(
  flow: ConnectPublishFlow,
  graph: FlowGraph,
  destinationSteps: readonly string[],
  listed: readonly ShareVerificationKind[],
  input: ConnectPublishInput,
): boolean {
  const comparison = input.checks.selfie?.selfie_id_comparison;
  return (
    listed.includes('government-id') &&
    !listed.includes('selfie') &&
    comparison?.enabled === true &&
    comparison.required &&
    flow.steps.some(
      (step) =>
        step.type === 'selfie' &&
        graph.reachable.has(step.id) &&
        destinationSteps.some((destination) => dominates(graph, destination, step.id)),
    )
  );
}

/**
 * C238.2: every Connect publish problem and acknowledgement of a version, in step order, then in
 * `accept-cloned-results`' order. Pointers are the version's (`/flow/steps/<i>`,
 * `/settings/accept-cloned-results/verification-types/<i>`), as `flowPublishReport` carries them.
 *
 * Per `share_consent` step: `share_consent_connect_disabled` while the install does not serve
 * Connect (C231.10); a source-side step's connection unknown to the organisation's outbound ones (or
 * archived) is `share_consent_connection_invalid`, a pending or inactive one the warning
 * `share_consent_connection_not_active`; no withdrawal contact (or a blank one) is
 * `share_consent_withdrawal_contact_missing` at its member (C237.4); a step reachable from a
 * completion or a failure is `share_consent_after_completion`; a reachable destination-side step
 * that does not precede, on every path, each reachable step of a type `accept-cloned-results` lists
 * is `share_consent_after_cloned_step`; a destination-side step without a retention term (the
 * template's, else the environment's) while a share can carry `biometric` is
 * `share_consent_retention_missing` (C238.9); a step that shows a built-in text counsel has not
 * reviewed, in an enabled locale, needs `share-consent-default-text:<step id>` (C238.10).
 *
 * Per listed type: `cloned-results:<type>` (C235.3). `cloned-results-unbound:<type>` for `selfie`
 * always (a cloned selfie binds nothing to the person), and for every type when a destination-side
 * step leads into the clones and no live selfie binds the person to the cloned portrait (C235.8);
 * without that acknowledgement among `givenAcknowledgements`, `cloned_results_without_binding`.
 */
export function connectPublishRules(input: ConnectPublishInput): ConnectPublishReport {
  const problems: ConnectPublishProblem[] = [];
  const acknowledgements: ConnectPublishAcknowledgement[] = [];
  const listed = input.acceptClonedResults?.['verification-types'] ?? [];
  const listedStepTypes = new Set(listed.map((kind) => STEP_TYPE_OF_SHARE_KIND[kind]));
  const { flow } = input;
  const graph = flow === null ? null : graphOf(flow);
  const afterTerminal =
    flow === null
      ? new Set<string>()
      : reachableFrom(
          successorsOf(flow),
          flow.steps
            .filter((step) => step.type === 'completion' || step.type === 'failure')
            .map((step) => step.id),
        );
  const destinationSteps: string[] = [];

  flow?.steps.forEach((step, index) => {
    if (step.type !== 'share_consent') return;
    const at = `/flow/steps/${String(index)}`;
    if (!input.connectEnabled) {
      problems.push(
        error(at, 'share_consent_connect_disabled', 'This installation does not serve Connect.'),
      );
    }
    if (step.side === 'source') {
      const id = step.connectionId;
      const status =
        id !== undefined && Object.hasOwn(input.outboundConnections, id)
          ? input.outboundConnections[id]
          : undefined;
      if (status === undefined || status === 'archived') {
        problems.push(
          error(
            at,
            'share_consent_connection_invalid',
            'The step names no outbound connection of this organisation.',
          ),
        );
      } else if (status !== 'active') {
        problems.push({
          pointer: at,
          code: 'share_consent_connection_not_active',
          detail: 'The step’s connection is not active; the partner has to activate it.',
          severity: 'warning',
        });
      }
    }
    if ((step.withdrawalContact ?? '').trim().length === 0) {
      problems.push(
        error(
          `${at}/withdrawalContact`,
          'share_consent_withdrawal_contact_missing',
          'The step names no way for the person to withdraw.',
        ),
      );
    }
    if (afterTerminal.has(step.id)) {
      problems.push(
        error(at, 'share_consent_after_completion', 'A sharing consent step follows a completion.'),
      );
    }
    if (step.side === 'destination') {
      if (graph?.reachable.has(step.id) === true) {
        destinationSteps.push(step.id);
        const precedes = flow.steps.every(
          (other) =>
            !listedStepTypes.has(other.type) ||
            !graph.reachable.has(other.id) ||
            dominates(graph, step.id, other.id),
        );
        if (!precedes) {
          problems.push(
            error(
              at,
              'share_consent_after_cloned_step',
              'A destination-side sharing consent comes after a step whose cloned results the version accepts.',
            ),
          );
        }
      }
      if (input.retentionDays === null && input.destinationBiometricPossible) {
        problems.push(
          error(
            at,
            'share_consent_retention_missing',
            'A destination-side step that can receive biometric data needs a retention term.',
          ),
        );
      }
    }
    if (showsUnreviewedText(step, input)) {
      acknowledgements.push({
        key: `share-consent-default-text:${step.id}`,
        pointer: at,
        reason: 'The step shows built-in sharing consent texts that counsel has not reviewed.',
      });
    }
  });

  const given = new Set(input.givenAcknowledgements ?? []);
  const bound =
    flow !== null &&
    graph !== null &&
    bindsClonedPortrait(flow, graph, destinationSteps, listed, input);
  listed.forEach((kind, index) => {
    const at = `/settings/accept-cloned-results/verification-types/${String(index)}`;
    acknowledgements.push({
      key: `cloned-results:${kind}`,
      pointer: at,
      reason: 'The version relies on another organisation’s checks for this verification type.',
    });
    if (kind !== 'selfie' && (destinationSteps.length === 0 || bound)) return;
    const key = `cloned-results-unbound:${kind}`;
    acknowledgements.push({
      key,
      pointer: at,
      reason:
        kind === 'selfie'
          ? 'A cloned selfie binds nothing to the person in the flow.'
          : 'No live selfie matches the person against a cloned portrait.',
    });
    if (!given.has(key)) {
      problems.push(
        error(
          at,
          'cloned_results_without_binding',
          kind === 'selfie'
            ? 'A cloned selfie is relied on, which binds nothing to the person in the flow.'
            : 'A cloned result is relied on, and no live selfie step matches the person against a cloned portrait.',
        ),
      );
    }
  });
  return { problems, acknowledgements };
}
