/**
 * C253.5, C253.7, C250.7 (Workflow 11B, `dsar-export`): the access export's rate gate and its
 * refusal counters, ours.
 *
 * - `enforceAccountExportRate` counts one create under the `account-export` policy (10 an hour, one
 *   bucket per environment: the caller key is the environment id, Stage 1a amendment 35) through the
 *   one fail-closed helper (orchestrator decision 16): past the limit the route answers 429; when
 *   the store does not answer, 503 `account_export_unavailable`, never an unlimited export, since one
 *   key exporting every account in turn is the platform's widest exfiltration path.
 * - `countAccountExportRefusal` emits the registered counter of a refusal (`metrics-registry.ts`:
 *   `account_export_refused_pending`, `_rate_limited`, `_too_large`, `_unavailable`), labelled by
 *   the environment only (rule 11): never the account, the caller or a count of its data.
 */
import { RateLimitedError } from '../../errors.js';
import { metrics, type MetricLogger } from '../../metrics-registry.js';
import { enforceFailClosedPolicy } from '../../plugins/rate-limit.js';
import type { RateLimiter } from '../../ports.js';
import { accountExportUnavailable } from './problems.js';

/** The four refusals a counter records. */
export type AccountExportRefusal = 'pending' | 'rate_limited' | 'too_large' | 'unavailable';

const REFUSAL_OF_CODE: Readonly<Record<string, AccountExportRefusal>> = {
  account_export_pending: 'pending',
  account_export_too_large: 'too_large',
  account_export_unavailable: 'unavailable',
};

/** The refusal `error` is, or `null` for any other error. */
export function accountExportRefusalOf(error: unknown): AccountExportRefusal | null {
  if (error instanceof RateLimitedError) {
    return 'rate_limited';
  }
  if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') {
    return null;
  }
  return REFUSAL_OF_CODE[error.code] ?? null;
}

/** Emits the counter of `refusal` for the environment. */
export function countAccountExportRefusal(
  logger: MetricLogger,
  environmentId: string,
  refusal: AccountExportRefusal,
): void {
  metrics.emit(logger, `account_export_refused_${refusal}`, 1, { environmentId });
}

/**
 * Counts one create under `account-export`, emitting the refusal's counter before it is thrown.
 * @throws {RateLimitedError} 429 past the limit.
 * @throws {AppError} 503 `account_export_unavailable` when the store does not answer.
 */
export async function enforceAccountExportRate(
  rateLimiter: RateLimiter,
  logger: MetricLogger,
  environmentId: string,
): Promise<void> {
  try {
    await enforceFailClosedPolicy(
      rateLimiter,
      'account-export',
      environmentId,
      accountExportUnavailable,
    );
  } catch (error) {
    const refusal = accountExportRefusalOf(error);
    if (refusal !== null) {
      countAccountExportRefusal(logger, environmentId, refusal);
    }
    throw error;
  }
}
