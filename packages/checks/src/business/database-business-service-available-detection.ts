/**
 * `database_business_service_available_detection` (R, user behaviour, required; C61.7): a bound
 * register covering the business's country answered. No register bound, or none covering the
 * country, answers `provider_not_configured`; a register that failed for good with no other answer
 * `execution_error`.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { businessRegistryCoverage, type DatabaseBusinessContext } from './context.js';

const ID = 'database_business_service_available_detection';

export function databaseBusinessServiceAvailableDetection(
  context: DatabaseBusinessContext,
): CheckResult {
  if (context.input.values === null) {
    return checkResult(ID, 'not_applicable', ['input_missing']);
  }
  const coverage = businessRegistryCoverage(context.input.registry);
  switch (coverage.kind) {
    case 'answered':
      return checkResult(ID, 'passed', [], {}, { provider: coverage.provider });
    case 'error':
      return checkResult(ID, 'not_applicable', ['execution_error']);
    case 'uncovered':
    case 'not_configured':
      return checkResult(ID, 'not_applicable', ['provider_not_configured'], {
        ...(coverage.kind === 'uncovered' ? { flags: ['country-not-covered'] } : {}),
      });
  }
}
