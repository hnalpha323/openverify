/**
 * C51.2, C66: the reason codes the checks of one Phase 5 verification type may give, read from
 * the contracts (`PHASE5_CHECK_REASONS`, which merges the per-area reasons files), as
 * `[check, code]` pairs. Each type's reason-word module test iterates them, so a reason the
 * contracts add without words in the console fails that test.
 */
import {
  PHASE5_CHECK_REASONS,
  toVerificationResourceType,
  type VerificationResourceType,
} from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';

/** One reason a check may give: the check's id and the code. */
export type CheckReason = readonly [check: string, code: string];

/** Every `[check, code]` the checks of `type` may give, in the contracts' order. */
export function checkReasonsOfType(type: VerificationResourceType): CheckReason[] {
  return Object.entries(PHASE5_CHECK_REASONS).flatMap(([check, reasons]) => {
    const definition = getCheckDefinition(check);
    return definition !== undefined &&
      toVerificationResourceType(definition.verificationType) === type
      ? reasons.map((code): CheckReason => [check, code])
      : [];
  });
}
