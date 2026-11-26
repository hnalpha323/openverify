/**
 * C30.3: what a vision or provider failure does to a job.
 * - A failure that a retry may cure (network, timeout, 5xx, `inference_failed`) is thrown while
 *   BullMQ has attempts left, so the job runs again (unchanged since Phase 1).
 * - On the last attempt, and at once for a failure no retry can cure (a vision answer that
 *   breaks the contract, `VisionResponseError`), the call is reported as failed: the caller
 *   records `not_applicable`/`execution_error` on the checks that needed it, and the
 *   verification is decided (a required check then sends it to review, C30.1).
 * - Vision's 413, 415 and 422 are an image it cannot read: the Phase 1 `image_unreadable` path.
 * - Anything else (a database error, a file deleted by a concurrent redaction) is thrown as
 *   before, for the processor's retry or `failVerificationAfterError`.
 *
 * Logs name the error class and status only, never a body or an image.
 */
import { ProviderError } from '../providers/index.js';
import { VisionError, VisionServiceError, isUnreadableImageError } from '../vision/index.js';
import type { WorkerLogger } from './logger.js';

export type VisionAttempt<T> =
  { ok: true; value: T } | { ok: false; unreadable: true } | { ok: false; unreadable: false };

export interface AttemptContext {
  lastAttempt: boolean;
  logger: WorkerLogger;
  /** Ids to log with a recorded failure, never PII. */
  log: Record<string, unknown>;
}

/** Runs a vision call under the C30.3 rule. */
export async function attemptVision<T>(
  call: () => Promise<T>,
  context: AttemptContext,
): Promise<VisionAttempt<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (isUnreadableImageError(error)) {
      return { ok: false, unreadable: true };
    }
    if (error instanceof VisionError && (!error.retryable || context.lastAttempt)) {
      context.logger.warn(
        {
          ...context.log,
          endpoint: error.endpoint,
          error: error.name,
          status: error instanceof VisionServiceError ? error.status : null,
        },
        'vision call failed for good; its checks are recorded as execution_error',
      );
      return { ok: false, unreadable: false };
    }
    throw error;
  }
}

export type ProviderAttempt<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs a provider call under the C30.3 rule: any failure of the adapter is a provider failure,
 * retried while attempts remain unless it says no retry can help (`ProviderError`).
 */
export async function attemptProvider<T>(
  call: () => Promise<T>,
  context: AttemptContext,
): Promise<ProviderAttempt<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    const permanent = error instanceof ProviderError && !error.retryable;
    if (permanent || context.lastAttempt) {
      context.logger.warn(
        { ...context.log, error: (error as Error).name },
        'provider call failed for good; its check is recorded as execution_error',
      );
      return { ok: false };
    }
    throw error;
  }
}
