/**
 * C169.6, C174.3 (Workflow 9B Stage 1b (W)): the `webhook-failure-alerts` repeatable job, every
 * 60 seconds (`jobs/repeatable/index.ts`' `webhookAlertRepeatableJobs`, whenever the worker runs it),
 * calling `runWebhookFailureAlerts` (`jobs/repeatable/webhook-alerts.ts`, `api-keys-webhooks`). Frozen
 * by `foundation-9b`; a change is a plan amendment.
 */

/** C169.6: the sweep's name (also its queue's and scheduler's) and period. */
export const WEBHOOK_FAILURE_ALERTS_QUEUE = 'webhook-failure-alerts';
export const WEBHOOK_FAILURE_ALERTS_INTERVAL_MS = 60_000;
