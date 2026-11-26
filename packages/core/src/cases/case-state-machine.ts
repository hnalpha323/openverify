/**
 * The case status machine (plan C131.1): pure, over the statuses, resolutions and transition map of
 * the template version a case pinned (C130.2). It decides what `set-status` does and never touches a
 * row; `api-cases` takes the case row `FOR UPDATE`, checks `lock-version`, writes the history and
 * stages the events this answers, in one transaction (C131.2).
 */
import { DomainError } from '../errors.js';
import { pointerToken } from './pointer.js';
import type { CaseStatusDefinition } from './vocabulary.js';

/** C129.7: the problems a refused `set-status` answers, each 422. */
export const CASE_TRANSITION_REFUSALS = [
  'case_transition_refused',
  'case_comment_required',
  'case_status_tag_required',
  'case_resolution_invalid',
] as const;
export type CaseTransitionRefusal = (typeof CASE_TRANSITION_REFUSALS)[number];

/** C129.6: the events a status change stages, in the order they are staged. */
export type CaseStatusEventName = 'case.status-updated' | 'case.resolved' | 'case.reopened';

/** C131.4: the history kind of an applied change. */
export type CaseTransitionKind = 'status-changed' | 'resolved' | 'reopened';

/** What a pinned version says about statuses (C130.2). */
export interface CaseStatusMachine {
  readonly statuses: readonly CaseStatusDefinition[];
  readonly resolutions: readonly string[];
  readonly transitions: Readonly<Record<string, readonly string[]>>;
}

/** `set-status`'s `meta` (C131.1): a status key, and ours `resolution`, `comment` and `status-tag`. */
export interface CaseStatusRequest {
  readonly status: string;
  readonly resolution?: string | undefined;
  readonly comment?: string | undefined;
  readonly statusTag?: string | undefined;
}

export type CaseTransitionDecision =
  | { readonly outcome: 'no_change' }
  | {
      readonly outcome: 'refused';
      readonly code: CaseTransitionRefusal;
      /** The JSON Pointer of the member at fault in the request body; never a value. */
      readonly pointer: string;
    }
  | {
      readonly outcome: 'applied';
      readonly kind: CaseTransitionKind;
      readonly from: CaseStatusDefinition;
      readonly to: CaseStatusDefinition;
      /** True when the case enters an `end` status: `resolved-at` and the resolver are set. */
      readonly resolves: boolean;
      /** True when the case leaves an `end` status: `resolution` and `resolved-at` are cleared. */
      readonly reopens: boolean;
      /** The case's resolution after the change; `null` outside an `end` status. */
      readonly resolution: string | null;
      /** The comment to add as a case comment, when one was sent. */
      readonly comment: string | null;
      readonly statusTag: string | null;
      readonly events: readonly CaseStatusEventName[];
    };

/** An own key of a map, so `constructor` or `__proto__` is never read as one (C131.1). */
const ownList = (
  map: Readonly<Record<string, readonly string[]>>,
  key: string,
): readonly string[] | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

const statusNamed = (machine: CaseStatusMachine, key: string): CaseStatusDefinition | undefined =>
  machine.statuses.find((status) => status.key === key);

const refused = (code: CaseTransitionRefusal, member: string): CaseTransitionDecision => ({
  outcome: 'refused',
  code,
  pointer: `/meta/${member}`,
});

/**
 * The resolution a case takes on entering `to` (C131.1): `meta.resolution` when given, which must be
 * one of the version's, matched exactly; otherwise the status label when it is one; otherwise `null`.
 */
function resolutionOf(
  machine: CaseStatusMachine,
  to: CaseStatusDefinition,
  requested: string | undefined,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  if (requested !== undefined) {
    return machine.resolutions.includes(requested) && to.category === 'end'
      ? { ok: true, value: requested }
      : { ok: false };
  }
  if (to.category !== 'end') {
    return { ok: true, value: null };
  }
  return { ok: true, value: machine.resolutions.includes(to.label) ? to.label : null };
}

/**
 * What `set-status` does to a case in status `current` (C131.1). The checks run in a fixed order: the
 * status exists, the map allows the move, then the entered status's rules (the resolution, the status
 * tag, the comment). A move to the status the case is in changes nothing, whatever `meta` says.
 *
 * Ours, where C131.1 is silent: a move between two `end` statuses re-resolves the case (a new
 * resolution, resolver and `resolved-at`) without reopening it; a reopen fires `case.status-updated`
 * before `case.reopened`, as a resolution fires it before `case.resolved`; a status the map does not
 * name has no exits; a resolution with a status outside `end` is refused; and a status tag the
 * entered status does not list is refused even where none is required.
 */
export function decideCaseTransition(
  machine: CaseStatusMachine,
  current: string,
  request: CaseStatusRequest,
): CaseTransitionDecision {
  const from = statusNamed(machine, current);
  const to = statusNamed(machine, request.status);
  if (from === undefined || to === undefined) {
    return refused('case_transition_refused', 'status');
  }
  if (from.key === to.key) {
    return { outcome: 'no_change' };
  }
  if (!(ownList(machine.transitions, from.key) ?? []).includes(to.key)) {
    return refused('case_transition_refused', 'status');
  }
  const resolution = resolutionOf(machine, to, request.resolution);
  if (!resolution.ok) {
    return refused('case_resolution_invalid', 'resolution');
  }
  const tag = request.statusTag;
  if (
    (tag === undefined && to['status-tag-required']) ||
    (tag !== undefined && !to['status-tags'].some(({ key }) => key === tag))
  ) {
    return refused('case_status_tag_required', 'status-tag');
  }
  const comment = request.comment;
  const hasComment = comment !== undefined && comment.trim().length > 0;
  if (to['required-comment'] && !hasComment) {
    return refused('case_comment_required', 'comment');
  }
  const resolves = to.category === 'end';
  const reopens = from.category === 'end' && !resolves;
  return {
    outcome: 'applied',
    kind: resolves ? 'resolved' : reopens ? 'reopened' : 'status-changed',
    from,
    to,
    resolves,
    reopens,
    resolution: resolution.value,
    comment: hasComment ? comment : null,
    statusTag: tag ?? null,
    events: resolves
      ? ['case.status-updated', 'case.resolved']
      : reopens
        ? ['case.status-updated', 'case.reopened']
        : ['case.status-updated'],
  };
}

/**
 * The one `initial` status a new case starts in (C130.2).
 * @throws {DomainError} `case_template_version_invalid` when the version holds none or several.
 */
export function initialCaseStatus(machine: CaseStatusMachine): CaseStatusDefinition {
  const initial = machine.statuses.filter(({ category }) => category === 'initial');
  const [only] = initial;
  if (initial.length !== 1 || only === undefined) {
    throw new DomainError(
      'case_template_version_invalid',
      'A case template version needs exactly one initial status',
    );
  }
  return only;
}

/** Codes of `caseTransitionMapProblems`, ours. */
export const CASE_TRANSITION_MAP_PROBLEMS = [
  'initial_status_count',
  'end_status_missing',
  'status_repeated',
  'transition_status_unknown',
  'transition_to_itself',
  'transition_repeated',
  'end_status_unreachable',
] as const;
export type CaseTransitionMapProblemCode = (typeof CASE_TRANSITION_MAP_PROBLEMS)[number];

export interface CaseTransitionMapProblem {
  readonly code: CaseTransitionMapProblemCode;
  /** A JSON Pointer into the version's attributes. */
  readonly pointer: string;
}

function statusProblems(
  statuses: readonly Pick<CaseStatusDefinition, 'key' | 'category'>[],
): CaseTransitionMapProblem[] {
  const problems: CaseTransitionMapProblem[] = [];
  if (statuses.filter(({ category }) => category === 'initial').length !== 1) {
    problems.push({ code: 'initial_status_count', pointer: '/statuses' });
  }
  if (!statuses.some(({ category }) => category === 'end')) {
    problems.push({ code: 'end_status_missing', pointer: '/statuses' });
  }
  const seen = new Set<string>();
  statuses.forEach(({ key }, index) => {
    if (seen.has(key)) {
      problems.push({ code: 'status_repeated', pointer: `/statuses/${String(index)}` });
    }
    seen.add(key);
  });
  return problems;
}

function mapProblems(
  keys: ReadonlySet<string>,
  transitions: Readonly<Record<string, readonly string[]>>,
): CaseTransitionMapProblem[] {
  const problems: CaseTransitionMapProblem[] = [];
  for (const [from, targets] of Object.entries(transitions)) {
    const at = `/transitions/${pointerToken(from)}`;
    if (!keys.has(from)) {
      problems.push({ code: 'transition_status_unknown', pointer: at });
      continue;
    }
    const seen = new Set<string>();
    targets.forEach((to, index) => {
      const pointer = `${at}/${String(index)}`;
      if (!keys.has(to)) {
        problems.push({ code: 'transition_status_unknown', pointer });
      } else if (to === from) {
        problems.push({ code: 'transition_to_itself', pointer });
      } else if (seen.has(to)) {
        problems.push({ code: 'transition_repeated', pointer });
      }
      seen.add(to);
    });
  }
  return problems;
}

/** The statuses a case starting in `initial` can reach through the map, `initial` included. */
function reachableFrom(
  initial: string,
  keys: ReadonlySet<string>,
  transitions: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const reached = new Set([initial]);
  const pending = [initial];
  for (let from = pending.pop(); from !== undefined; from = pending.pop()) {
    for (const to of ownList(transitions, from) ?? []) {
      if (keys.has(to) && !reached.has(to)) {
        reached.add(to);
        pending.push(to);
      }
    }
  }
  return reached;
}

/**
 * The rules of a version's statuses and transition map that publish applies (C130.2, C131.1): exactly
 * one `initial` status and at least one `end`, distinct keys, a map naming only the version's
 * statuses, no move to itself or repeated, and every `end` status reachable from `initial`. Problems
 * come in that order, each with a pointer and never a label.
 */
export function caseTransitionMapProblems(
  statuses: readonly Pick<CaseStatusDefinition, 'key' | 'category'>[],
  transitions: Readonly<Record<string, readonly string[]>>,
): CaseTransitionMapProblem[] {
  const keys = new Set(statuses.map(({ key }) => key));
  const problems = [...statusProblems(statuses), ...mapProblems(keys, transitions)];
  const initial = statuses.filter(({ category }) => category === 'initial');
  if (initial.length === 1 && initial[0] !== undefined) {
    const reached = reachableFrom(initial[0].key, keys, transitions);
    statuses.forEach(({ key, category }, index) => {
      if (category === 'end' && !reached.has(key)) {
        problems.push({ code: 'end_status_unreachable', pointer: `/statuses/${String(index)}` });
      }
    });
  }
  return problems;
}
