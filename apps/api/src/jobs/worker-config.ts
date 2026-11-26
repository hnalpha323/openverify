/**
 * Worker-only settings. The shared ones (database, Valkey, S3, KEK, vision) come from the
 * API's `loadConfig`, so both processes read the same variables.
 */
import {
  webhookNetworkPolicyFromEnv,
  type RuntimeMode,
  type WebhookNetworkPolicy,
} from '../webhooks/ssrf.js';

export const WORKER_CONCURRENCY_ENV = 'OPENVERIFY_WORKER_CONCURRENCY';
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 64;
/** How often overdue webhook deliveries are re-enqueued. */
const SWEEP_INTERVAL_MS = 30_000;

export interface WorkerSettings {
  /** Jobs each queue runs at once. */
  concurrency: number;
  sweepIntervalMs: number;
  webhookPolicy: WebhookNetworkPolicy;
}

/** A worker setting is invalid. The message names the variable, never its value. */
export class WorkerConfigError extends Error {
  override name = 'WorkerConfigError';
}

/**
 * Reads `OPENVERIFY_WORKER_CONCURRENCY` (1-64, default 4) and
 * `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS`.
 * @throws {WorkerConfigError} for an invalid concurrency.
 * @throws {WebhookNetworkConfigError} for private networks in production, or a bad flag.
 */
export function workerSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  mode: RuntimeMode,
): WorkerSettings {
  const raw = (env[WORKER_CONCURRENCY_ENV] ?? '').trim();
  const concurrency = raw === '' ? DEFAULT_CONCURRENCY : Number(raw);
  if (!/^\d*$/.test(raw) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new WorkerConfigError(
      `${WORKER_CONCURRENCY_ENV} must be a whole number from 1 to ${String(MAX_CONCURRENCY)}`,
    );
  }
  return {
    concurrency,
    sweepIntervalMs: SWEEP_INTERVAL_MS,
    webhookPolicy: webhookNetworkPolicyFromEnv(env, mode),
  };
}
