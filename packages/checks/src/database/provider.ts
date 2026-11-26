/**
 * The shared answers of the A-tier and R+A database checks (C35, ADR 0002 §3d, §3e): without a
 * provider bound in this environment, `provider_not_configured`; after the provider failed on the
 * job's last attempt, `execution_error`. Never a pass without a provider's result.
 */
import type { CheckId, CheckProvider, CheckResult } from '@openverify/core';
import type { ProviderOutcome } from '../government-id/inputs.js';
import { checkResult, type CheckResultOptions } from '../result.js';

/** The provider's result with its identity, or the check result that stands in for none. */
export function providerAnswer<Result>(
  checkId: CheckId,
  outcome: ProviderOutcome<Result> | undefined,
  options: CheckResultOptions,
): { readonly provider: CheckProvider; readonly result: Result } | CheckResult {
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(checkId, 'not_applicable', ['provider_not_configured'], {}, options);
  }
  if (outcome.kind === 'error') {
    return checkResult(checkId, 'not_applicable', ['execution_error'], {}, options);
  }
  return { provider: outcome.provider, result: outcome.result };
}

/** Whether a provider answer is the check result standing in for a missing one. */
export const isStandInResult = (value: object): value is CheckResult => 'status' in value;
