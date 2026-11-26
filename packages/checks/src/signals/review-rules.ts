/**
 * C90.7 (H03, V01): which `signal-config` review rules match the inquiry's frozen signals, with
 * `ON_NULL_DEFAULTS` applied. Pure: the `inquiry-signals` job (`api-signals`) applies `on-signal`
 * with the result, moving only a `completed` inquiry to `needs_review` and never declining.
 *
 * A rule matches when its comparison holds for a non-null value (`gte` and `lte` on numbers, `eq`
 * and `in` by strict equality, so an operand of another type never matches), or when the value is
 * `null` and the rule's `on-null` (else the null reason's default) is `needs_review`. The default
 * of `sessions_not_evaluated` is derived: `needs_review` when any session's own reason is a gap. A
 * rule on a signal the inquiry does not carry never matches (publish refuses one outside
 * `collect`).
 */
import {
  isGapNullReason,
  type InquirySignalsResult,
  type SignalDetailEntry,
} from './vocabulary.js';

/** One review rule (the contracts' `signalReviewRuleSchema`). */
export interface SignalReviewRuleInput {
  readonly signal: string;
  readonly gte?: number | undefined;
  readonly lte?: number | undefined;
  readonly eq?: number | string | boolean | undefined;
  readonly in?: readonly (number | string | boolean)[] | undefined;
  readonly 'on-null'?: 'needs_review' | 'ignore' | undefined;
}

/** C90.7: the rules that matched, and the cause the job records (`signal-details.review`). */
export interface SignalReviewMatch {
  /** The indexes of the matching rules, in rule order. */
  readonly rules: readonly number[];
  /** `signal_rule` when a value matched; `signal_unevaluated` when only `on-null` did. */
  readonly cause: 'signal_rule' | 'signal_unevaluated' | null;
}

/** C90.7 (V01): the `on-null` default of a null value, derived from its sessions where it says so. */
function onNullDefault(detail: SignalDetailEntry | undefined): 'needs_review' | 'ignore' {
  const reason = detail?.['null-reason'] ?? null;
  if (reason === null) {
    return 'ignore';
  }
  if (reason === 'sessions_not_evaluated') {
    return (detail?.sessions ?? []).some(
      ({ 'null-reason': own }) =>
        own !== null && own !== 'sessions_not_evaluated' && isGapNullReason(own),
    )
      ? 'needs_review'
      : 'ignore';
  }
  return isGapNullReason(reason) ? 'needs_review' : 'ignore';
}

function comparisonHolds(rule: SignalReviewRuleInput, value: number | string | boolean): boolean {
  if (rule.gte !== undefined) {
    return typeof value === 'number' && value >= rule.gte;
  }
  if (rule.lte !== undefined) {
    return typeof value === 'number' && value <= rule.lte;
  }
  if (rule.eq !== undefined) {
    return value === rule.eq;
  }
  return rule.in?.includes(value) ?? false;
}

/** C90.7: the review rules that match `result` (H03). */
export function matchSignalReviewRules(
  rules: readonly SignalReviewRuleInput[],
  result: InquirySignalsResult,
): SignalReviewMatch {
  const matched: number[] = [];
  let byValue = false;
  for (const [index, rule] of rules.entries()) {
    const signal = result.signals.find(({ name }) => name === rule.signal);
    if (signal === undefined) {
      continue;
    }
    if (signal.value === null) {
      const detail = result.details[signal.name];
      if ((rule['on-null'] ?? onNullDefault(detail)) === 'needs_review') {
        matched.push(index);
      }
      continue;
    }
    if (comparisonHolds(rule, signal.value)) {
      matched.push(index);
      byValue = true;
    }
  }
  return {
    rules: matched,
    cause: matched.length === 0 ? null : byValue ? 'signal_rule' : 'signal_unevaluated',
  };
}
