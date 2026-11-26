/**
 * C235.4, C235.7 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 4): what a cloned
 * result counts for, as a pure decision. `api-redeem`'s `services/connect/cloned-results.ts` calls it
 * behind `foundation-11a`'s hooks in the decision engine, Phase 8's condition reads and Phase 9's
 * analytics, so all three answer the same.
 */
import { shareKindOfVerificationType, type ShareVerificationKind } from './policy.js';

const DAY_MILLISECONDS = 86_400_000;

/** A template version's `accept-cloned-results` (C235.3), as `acceptClonedResultsSchema` holds it. */
export interface AcceptClonedResultsRule {
  readonly 'verification-types': readonly ShareVerificationKind[];
  readonly 'max-age-days': number;
}

/** A cloned verification, as its row and provenance say. */
export interface ClonedVerificationFacts {
  /** Core's verification type (`government_id`). */
  readonly type: string;
  /** The status the clone kept from its source. */
  readonly status: string;
  /** When the source decided it (or, conservatively, when the source created it). */
  readonly sourceDecidedAt: Date;
  /** `provenance.consent-withdrawn-at` (C237.6 (2)). */
  readonly consentWithdrawnAt: Date | null;
}

/** Why a clone counts for nothing (the step runs as if no copy existed). */
export const CLONED_RESULT_IGNORE_REASONS = Object.freeze([
  'accept_cloned_results_off',
  'type_not_listed',
  'consent_withdrawn',
  'too_old',
  'not_decided',
] as const);
export type ClonedResultIgnoreReason = (typeof CLONED_RESULT_IGNORE_REASONS)[number];

/** C235.4: count it, ignore it, or send the inquiry to review. */
export type ClonedResultVerdict =
  | { readonly use: 'count'; readonly reason: 'passed' }
  | { readonly use: 'ignore'; readonly reason: ClonedResultIgnoreReason }
  | { readonly use: 'review'; readonly reason: 'cloned_failure' };

/**
 * C235.4: what one cloned verification counts for at the destination's decision `decidedAt`
 * (review H07: the age is measured then, not at redemption). In order:
 *
 * - off (`accept-cloned-results` absent or `null`): ignored; the step runs as if no copy existed;
 * - a type the version does not list: ignored;
 * - its destination-side consent withdrawn at or before `decidedAt`: ignored from that moment
 *   (C237.6 (2));
 * - its source decision `max-age-days` old or older at `decidedAt`: ignored (it counts only while
 *   younger);
 * - passed: counts toward its step's required checks;
 * - failed: never declines or fails anything by itself; it routes the inquiry to review (only
 *   passes are relied on, so no adverse decision rests on checks the destination never ran);
 * - any other status: ignored.
 */
export function clonedResultVerdict(
  accept: AcceptClonedResultsRule | null | undefined,
  clone: ClonedVerificationFacts,
  decidedAt: Date,
): ClonedResultVerdict {
  if (accept === null || accept === undefined) {
    return { use: 'ignore', reason: 'accept_cloned_results_off' };
  }
  const kind = shareKindOfVerificationType(clone.type);
  if (kind === null || !accept['verification-types'].includes(kind)) {
    return { use: 'ignore', reason: 'type_not_listed' };
  }
  if (
    clone.consentWithdrawnAt !== null &&
    clone.consentWithdrawnAt.getTime() <= decidedAt.getTime()
  ) {
    return { use: 'ignore', reason: 'consent_withdrawn' };
  }
  const age = decidedAt.getTime() - clone.sourceDecidedAt.getTime();
  if (age >= accept['max-age-days'] * DAY_MILLISECONDS) {
    return { use: 'ignore', reason: 'too_old' };
  }
  switch (clone.status) {
    case 'passed':
      return { use: 'count', reason: 'passed' };
    case 'failed':
      return { use: 'review', reason: 'cloned_failure' };
    default:
      return { use: 'ignore', reason: 'not_decided' };
  }
}

/** C235.4: where a clone of an inquiry (C234.3) goes. */
export type ClonedInquiryOutcome =
  | {
      readonly status: 'needs_review';
      readonly reason: 'accept_cloned_results_off' | 'cloned_failure';
    }
  | { readonly status: 'destination_rules' };

/**
 * C235.4: a clone of an inquiry (C234.3) before the destination's own rules run. Off: created in
 * `needs_review`, whatever the source's status. On: `needs_review` when a verdict routes to review,
 * else the destination's own decision rules decide it with the counted clones (never the source's
 * status). A client-side fill (C234.11) reads the verdicts alone: with the setting off they are all
 * ignored and the person completes every step live.
 */
export function clonedInquiryOutcome(
  accept: AcceptClonedResultsRule | null | undefined,
  verdicts: readonly ClonedResultVerdict[],
): ClonedInquiryOutcome {
  if (accept === null || accept === undefined) {
    return { status: 'needs_review', reason: 'accept_cloned_results_off' };
  }
  return verdicts.some((verdict) => verdict.use === 'review')
    ? { status: 'needs_review', reason: 'cloned_failure' }
    : { status: 'destination_rules' };
}

/** C235.4, Phase 8 C128: whether a decision relied on a cloned result (`relied-on-cloned`). */
export function reliedOnCloned(verdicts: readonly ClonedResultVerdict[]): boolean {
  return verdicts.some((verdict) => verdict.use === 'count');
}
