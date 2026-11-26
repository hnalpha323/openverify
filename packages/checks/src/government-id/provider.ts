/**
 * The shared answers of the A-tier checks (C35, ADR 0002 §3d, §3e): without a provider bound in
 * this environment, `provider_not_configured`; after the provider failed on the job's last
 * attempt, `execution_error`. Never a pass without a provider's result.
 */
import type { CheckId, CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { ProviderOutcome } from './inputs.js';

/** The provider's result, or the check result that stands in for a missing one. */
export function providerResult<Result>(
  checkId: CheckId,
  outcome: ProviderOutcome<Result> | undefined,
  options: { thresholds?: Record<string, number> } = {},
): Extract<ProviderOutcome<Result>, { kind: 'result' }> | CheckResult {
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(checkId, 'not_applicable', ['provider_not_configured'], {}, options);
  }
  if (outcome.kind === 'error') {
    return checkResult(checkId, 'not_applicable', ['execution_error'], {}, options);
  }
  return outcome;
}

export const isCheckResult = (value: object): value is CheckResult => 'status' in value;
