/**
 * Assignment selection (plan C132.3, C132.4): pure. `api-queues-sla` locks the queue row, reads the
 * candidates and their counts in that transaction, and applies what these answer; the selection
 * itself decides nothing about rows, so every rule here is tested without a database.
 */
import {
  CASE_LIMITS,
  type CaseAssignmentDistribution,
  type CaseAssignmentSort,
} from './vocabulary.js';

/** One user a policy could assign, as read under the queue lock. */
export interface CaseAssignmentCandidate {
  readonly userId: string;
  /** An active member of the organisation (not deactivated). */
  readonly active: boolean;
  /** Holds `cases:write` through their roles (C132.1). */
  readonly holdsCasesWrite: boolean;
  /** May see the case's template (`visible-to-roles`, C129.4). */
  readonly seesTemplate: boolean;
  /** A queue member's pause; `false` for a user a policy lists who is not a member. */
  readonly paused: boolean;
  /** Open cases assigned to the user now. */
  readonly openCount: number;
  /** The member's `max-open`; `null` for a user who is not a member of the routed queue. */
  readonly maxOpen: number | null;
  /** The user's latest assignment, `null` if never. */
  readonly lastAssignedAt: Date | null;
}

/** Why a candidate cannot take a case, in the order they are checked. */
export const CASE_ASSIGNEE_INELIGIBILITIES = [
  'inactive',
  'no_permission',
  'template_hidden',
  'paused',
  'at_capacity',
] as const;
export type CaseAssigneeIneligibility = (typeof CASE_ASSIGNEE_INELIGIBILITIES)[number];

/** The capacity a policy can cap; `null` is each member's own `max-open` (Stage 1a amendment 35). */
export interface CaseAssignmentLimits {
  readonly maxCapacity: number | null;
}

/** How many open cases `candidate` may hold under a policy (C132.2). */
export function assigneeCapacity(
  candidate: CaseAssignmentCandidate,
  limits: CaseAssignmentLimits,
): number {
  const own = candidate.maxOpen ?? CASE_LIMITS['member-max-open-default'].value;
  // Ours: where both bind, the lower one, so a policy never lifts a member's own limit.
  return limits.maxCapacity === null ? own : Math.min(own, limits.maxCapacity);
}

/** Why a policy may not assign `candidate`, or `null` when it may (C132.3). */
export function assigneeIneligibility(
  candidate: CaseAssignmentCandidate,
  limits: CaseAssignmentLimits,
): CaseAssigneeIneligibility | null {
  const manual = manualAssigneeIneligibility(candidate);
  if (manual !== null) {
    return manual;
  }
  if (candidate.paused) {
    return 'paused';
  }
  return candidate.openCount >= assigneeCapacity(candidate, limits) ? 'at_capacity' : null;
}

/**
 * Why `POST /cases/:id/assign` may not name `candidate`, or `null` (C132.3, manual): an active member
 * of the organisation with `cases:write` who can see the template. Queues and capacity do not bind a
 * person's choice.
 */
export function manualAssigneeIneligibility(
  candidate: Pick<CaseAssignmentCandidate, 'active' | 'holdsCasesWrite' | 'seesTemplate'>,
): Exclude<CaseAssigneeIneligibility, 'paused' | 'at_capacity'> | null {
  if (!candidate.active) {
    return 'inactive';
  }
  if (!candidate.holdsCasesWrite) {
    return 'no_permission';
  }
  return candidate.seesTemplate ? null : 'template_hidden';
}

/** What a history row records of a policy's choice: ids and counts, never a value (C132.4). */
export type CaseAssignmentInputs = Readonly<Record<string, string | number | boolean | null>>;

export type CaseAssignmentSelection =
  | {
      readonly assigned: true;
      readonly strategy: CaseAssignmentDistribution;
      readonly userId: string;
      /** Round-robin's cursor after this choice; the queue row stores it. */
      readonly cursor: string | null;
      readonly inputs: CaseAssignmentInputs;
    }
  | {
      readonly assigned: false;
      readonly strategy: CaseAssignmentDistribution;
      readonly reason: 'no_eligible_agent' | 'creator_unknown' | 'creator_ineligible';
      readonly cursor: string | null;
      readonly inputs: CaseAssignmentInputs;
    };

/** Code-unit order, as Postgres's `COLLATE "C"` and an id's ULID read. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Two instants in order, with a missing one first or last. */
function compareTimes(a: Date | null, b: Date | null, missing: 'first' | 'last'): number {
  if (a === null || b === null) {
    if (a === b) {
      return 0;
    }
    return (a === null) === (missing === 'first') ? -1 : 1;
  }
  return a.getTime() - b.getTime();
}

const byUserId = (a: CaseAssignmentCandidate, b: CaseAssignmentCandidate): number =>
  compareText(a.userId, b.userId);

const eligibleOf = (
  candidates: readonly CaseAssignmentCandidate[],
  limits: CaseAssignmentLimits,
): CaseAssignmentCandidate[] =>
  candidates.filter((candidate) => assigneeIneligibility(candidate, limits) === null);

/** C132.3 round-robin: the first eligible candidate after `cursor` in user-id order, wrapping. */
export function selectRoundRobin(
  candidates: readonly CaseAssignmentCandidate[],
  cursor: string | null,
  limits: CaseAssignmentLimits,
): CaseAssignmentSelection {
  const eligible = eligibleOf(candidates, limits).sort(byUserId);
  const inputs = { cursor, eligible: eligible.length, candidates: candidates.length };
  const next =
    (cursor === null ? undefined : eligible.find(({ userId }) => userId > cursor)) ?? eligible[0];
  if (next === undefined) {
    return {
      assigned: false,
      strategy: 'round-robin',
      reason: 'no_eligible_agent',
      cursor,
      inputs,
    };
  }
  return {
    assigned: true,
    strategy: 'round-robin',
    userId: next.userId,
    cursor: next.userId,
    inputs,
  };
}

/** C132.3 fewest-open: fewest open cases, then least recently assigned, then user id. */
export function selectFewestOpen(
  candidates: readonly CaseAssignmentCandidate[],
  limits: CaseAssignmentLimits,
): CaseAssignmentSelection {
  const eligible = eligibleOf(candidates, limits).sort(
    (a, b) =>
      a.openCount - b.openCount ||
      compareTimes(a.lastAssignedAt, b.lastAssignedAt, 'first') ||
      byUserId(a, b),
  );
  const [first] = eligible;
  if (first === undefined) {
    return {
      assigned: false,
      strategy: 'fewest-open',
      reason: 'no_eligible_agent',
      cursor: null,
      inputs: { 'open-count': null, eligible: 0, candidates: candidates.length, tied: 0 },
    };
  }
  return {
    assigned: true,
    strategy: 'fewest-open',
    userId: first.userId,
    cursor: null,
    inputs: {
      'open-count': first.openCount,
      eligible: eligible.length,
      candidates: candidates.length,
      tied: eligible.filter(({ openCount }) => openCount === first.openCount).length,
    },
  };
}

/** C132.3 case-creator and inquiry-creator: that user when eligible, otherwise nobody. */
export function selectCreator(
  strategy: 'case-creator' | 'inquiry-creator',
  creatorUserId: string | null,
  candidates: readonly CaseAssignmentCandidate[],
  limits: CaseAssignmentLimits,
): CaseAssignmentSelection {
  const inputs = { creator: creatorUserId };
  if (creatorUserId === null) {
    return { assigned: false, strategy, reason: 'creator_unknown', cursor: null, inputs };
  }
  // Ours: the creator must be one of the policy's agents, and eligible as any agent is.
  const creator = eligibleOf(candidates, limits).find(({ userId }) => userId === creatorUserId);
  if (creator === undefined) {
    return { assigned: false, strategy, reason: 'creator_ineligible', cursor: null, inputs };
  }
  return { assigned: true, strategy, userId: creator.userId, cursor: null, inputs };
}

export interface CaseAssignmentRequest {
  readonly candidates: readonly CaseAssignmentCandidate[];
  readonly limits: CaseAssignmentLimits;
  /** The queue's round-robin cursor. */
  readonly cursor: string | null;
  /** The case's creator, or its first held inquiry's, when it was a user. */
  readonly creatorUserId: string | null;
}

/** A policy's distribution applied to one case (C132.2, C132.3). */
export function selectAssignee(
  distribution: CaseAssignmentDistribution,
  request: CaseAssignmentRequest,
): CaseAssignmentSelection {
  switch (distribution) {
    case 'round-robin':
      return selectRoundRobin(request.candidates, request.cursor, request.limits);
    case 'fewest-open':
      return selectFewestOpen(request.candidates, request.limits);
    case 'case-creator':
    case 'inquiry-creator':
      return selectCreator(distribution, request.creatorUserId, request.candidates, request.limits);
  }
}

/** An unassigned case as a policy drains its sources (C132.2) or a pull takes one (C132.3). */
export interface UnassignedCaseOrderKey {
  readonly id: string;
  readonly createdAt: Date;
  readonly slaExpiresAt: Date | null;
}

/** The order a policy takes unassigned cases in; `sla-expires-at` is the pull's order too. */
export function compareUnassignedCases(
  sort: CaseAssignmentSort,
): (a: UnassignedCaseOrderKey, b: UnassignedCaseOrderKey) => number {
  const byAge = (a: UnassignedCaseOrderKey, b: UnassignedCaseOrderKey): number =>
    a.createdAt.getTime() - b.createdAt.getTime() || compareText(a.id, b.id);
  if (sort === 'created-at') {
    return byAge;
  }
  return (a, b) => compareTimes(a.slaExpiresAt, b.slaExpiresAt, 'last') || byAge(a, b);
}
