/**
 * C30.3 results for checks that could not run after the job's retries. Which checks a vision
 * failure leaves without evidence follows from their registry `inputs` (C29.1), before any
 * evaluator runs: a check that reads vision's measurements answers `execution_error`, a check
 * that needs only the extraction (which vision's answer would have fed) answers `input_missing`.
 * Both are `not_applicable`, so a required one sends the verification to review (C30.1); none is
 * ever reported as passed.
 */
import { checkResult } from '@openverify/checks';
import {
  getCheckDefinition,
  type CheckId,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';

export const EXECUTION_ERROR = 'execution_error';
export const INPUT_MISSING = 'input_missing';

/** The results of the enabled checks, in configuration order, when vision could not answer. */
export function visionFailureChecks(config: VerificationTemplateConfig): CheckResult[] {
  return Object.entries(config.checks)
    .filter(([, { enabled }]) => enabled)
    .map(([name]) => {
      const checkId = name as CheckId;
      const reads = getCheckDefinition(checkId)?.inputs ?? [];
      return checkResult(checkId, 'not_applicable', [
        reads.includes('vision') ? EXECUTION_ERROR : INPUT_MISSING,
      ]);
    });
}

/**
 * `result`'s check as one that could not run: `not_applicable`/`execution_error`, keeping the
 * thresholds it would have been judged against.
 */
export function executionError(result: CheckResult): CheckResult {
  return checkResult(
    result.name as CheckId,
    'not_applicable',
    [EXECUTION_ERROR],
    {},
    { thresholds: result.provenance.thresholds },
  );
}
