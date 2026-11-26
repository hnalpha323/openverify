/**
 * The order the console lists a verification's checks in (C37): what needs the operator first.
 * A government ID runs about 32 checks, so the console keeps the failed and review checks in
 * view and folds the rest away (`check-results.tsx`).
 */
import { NON_BLOCKING_REASONS, type VerificationCheck } from '@openverify/contracts';
import { CHECK_STATUSES, type CheckStatus } from '@openverify/core';

/**
 * - `failed`: a required check that failed;
 * - `review`: a required check without evidence (pending, or not applicable for a blocking
 *   reason), which sends the verification to review (C30.1);
 * - `advisory-failed`: an optional check that failed;
 * - `other`: everything else (passed, not applicable without blocking, optional and pending).
 */
export type CheckGroup = 'failed' | 'review' | 'advisory-failed' | 'other';

/** The groups in the order they are listed. */
const GROUP_ORDER: readonly CheckGroup[] = ['failed', 'review', 'advisory-failed', 'other'];

export interface GroupedChecks {
  /** Failed, then review, then advisory failures, each in the API's order. */
  readonly attention: readonly VerificationCheck[];
  /** The rest, in the API's order. */
  readonly other: readonly VerificationCheck[];
}

const NON_BLOCKING: readonly string[] = NON_BLOCKING_REASONS;

/**
 * Whether `check` is a required check without evidence (C30.1): pending, or not applicable for
 * a reason other than `feature_absent` and `not_requested` (or for no reason). Such a check
 * sends the verification to review when nothing failed. The decision engine's rule, read from
 * the results the API serves.
 */
export function sendsToReview(check: VerificationCheck): boolean {
  if (check.requirement !== 'required') {
    return false;
  }
  if (check.status === 'pending') {
    return true;
  }
  return (
    check.status === 'not_applicable' &&
    (check.reasons.length === 0 || check.reasons.some((reason) => !NON_BLOCKING.includes(reason)))
  );
}

export function checkGroupOf(check: VerificationCheck): CheckGroup {
  if (check.status === 'failed') {
    return check.requirement === 'required' ? 'failed' : 'advisory-failed';
  }
  return sendsToReview(check) ? 'review' : 'other';
}

/** `checks` split into what needs the operator, in group order, and the rest. */
export function groupChecks(checks: readonly VerificationCheck[]): GroupedChecks {
  const byGroup = new Map<CheckGroup, VerificationCheck[]>(GROUP_ORDER.map((group) => [group, []]));
  for (const check of checks) {
    byGroup.get(checkGroupOf(check))?.push(check);
  }
  const of = (group: CheckGroup) => byGroup.get(group) ?? [];
  return {
    attention: [...of('failed'), ...of('review'), ...of('advisory-failed')],
    other: of('other'),
  };
}

/** How many of `checks` have each status, in `CHECK_STATUSES` order, leaving out zeros. */
export function countByStatus(
  checks: readonly VerificationCheck[],
): readonly { readonly status: CheckStatus; readonly count: number }[] {
  return CHECK_STATUSES.map((status) => ({
    status,
    count: checks.filter((check) => check.status === status).length,
  })).filter(({ count }) => count > 0);
}
