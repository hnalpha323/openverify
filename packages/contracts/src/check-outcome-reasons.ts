/**
 * How the Phase 5 reasons files state the C51.2 table: per check, the reasons it fails with and
 * the reasons it answers `not_applicable` with. Each check may also answer with the C29.4 shared
 * reasons its evidence (registry `inputs`) calls for:
 * - `input_missing` always (an input it needs could not be had, or the cascade gated it);
 * - `execution_error` with a vision or provider input (the call failed for good, C30.3);
 * - `provider_not_configured` with a provider input (ADR 0002 §3e).
 *
 * A `failed` reason of a user-behaviour check is a retry hint the clients translate, so those are
 * frozen in Stage 1a (`contracts/fixtures/flow/retry-hint-reasons.json`); later stages may add
 * fraud reasons only, each recorded as a plan amendment. Reasons are codes, never prose, and
 * never carry a value.
 */
import { getCheckDefinition, type CheckId } from '@openverify/core';
import {
  EXECUTION_ERROR_REASON,
  INPUT_MISSING_REASON,
  PROVIDER_NOT_CONFIGURED_REASON,
} from './government-id-check-reasons.js';

/** One check's row of the C51.2 table. */
export interface CheckOutcomeReasons {
  readonly failed: readonly string[];
  readonly notApplicable: readonly string[];
}

export type CheckOutcomeTable<Id extends string = CheckId> = Readonly<
  Record<Id, CheckOutcomeReasons>
>;

/** A frozen row: what the check fails with, and what it answers `not_applicable` with. */
export function outcome(
  failed: readonly string[],
  notApplicable: readonly string[] = [],
): CheckOutcomeReasons {
  return Object.freeze({
    failed: Object.freeze([...failed]),
    notApplicable: Object.freeze([...notApplicable]),
  });
}

/** The C29.4 shared reasons a check's registry inputs call for (C51.2). */
export function sharedReasonsFor(checkId: string): readonly string[] {
  const inputs = getCheckDefinition(checkId)?.inputs ?? [];
  const provider = inputs.includes('provider');
  return [
    INPUT_MISSING_REASON,
    ...(provider || inputs.includes('vision') ? [EXECUTION_ERROR_REASON] : []),
    ...(provider ? [PROVIDER_NOT_CONFIGURED_REASON] : []),
  ];
}

/** Every reason each check of `table` may emit: its shared reasons, then its row. */
export function checkReasonsOf<Id extends string>(
  table: CheckOutcomeTable<Id>,
): Readonly<Record<Id, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries<CheckOutcomeReasons>(table).map(([id, row]) => [
        id,
        Object.freeze([...new Set([...sharedReasonsFor(id), ...row.failed, ...row.notApplicable])]),
      ]),
    ),
  ) as unknown as Readonly<Record<Id, readonly string[]>>;
}

/** The failure reasons of the user-behaviour checks of `table`: what a retry hint can carry. */
export function retryHintReasonsOf(table: CheckOutcomeTable<string>): readonly string[] {
  return Object.entries(table)
    .filter(([id]) => getCheckDefinition(id)?.checkType === 'user_behavior')
    .flatMap(([, row]) => row.failed);
}
