/**
 * The `webhook-delivery` queue. One job per delivery attempt, named `<delivery id>-<attempt>`,
 * so an attempt is enqueued at most once while its job exists; the sweep replaces a job that
 * is left over (failed or completed) so the attempt can run again. The dispatcher schedules each
 * retry itself (delay from the C5 backoff); BullMQ's own retries only cover infrastructure
 * errors, such as the database being unavailable.
 */
import type { JobsOptions } from 'bullmq';
import type { JobQueue } from '../jobs/queue.js';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const WEBHOOK_DELIVERY_JOB = 'deliver';

export interface WebhookDeliveryJob {
  environmentId: string;
  /** `whd_...` in `webhook_deliveries`. */
  deliveryId: string;
  /** The attempt this job makes, from 1. */
  attempt: number;
}

export interface ScheduleDeliveryOptions {
  /**
   * Remove a job left under the attempt's id first. BullMQ keeps failed jobs (7 days) and
   * completed ones (1 hour), and an add under an id that still exists does nothing, so the
   * sweep could never enqueue an attempt again after its job failed for good, for example
   * during a database outage (Workflow 2B F011). An active job is locked and is not removed.
   */
  replace?: boolean;
}

export interface WebhookDeliveryScheduler {
  /** Enqueues an attempt to run after `delayMs` (default now). */
  scheduleDelivery(
    job: WebhookDeliveryJob,
    delayMs?: number,
    options?: ScheduleDeliveryOptions,
  ): Promise<void>;
}

/** BullMQ ids may not contain `:`; delivery ids never do. */
export const webhookDeliveryJobId = (job: WebhookDeliveryJob): string =>
  `${job.deliveryId}-${String(job.attempt)}`;

const JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
  removeOnComplete: { age: 3_600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

export function createWebhookDeliveryScheduler(
  queue: JobQueue<WebhookDeliveryJob>,
): WebhookDeliveryScheduler & { close(): Promise<void> } {
  return {
    async scheduleDelivery(job, delayMs = 0, options = {}) {
      if (options.replace === true) {
        await queue.remove?.(webhookDeliveryJobId(job));
      }
      await queue.add(WEBHOOK_DELIVERY_JOB, job, {
        jobId: webhookDeliveryJobId(job),
        delay: Math.max(0, Math.round(delayMs)),
        ...JOB_OPTIONS,
      });
    },
    close: () => queue.close(),
  };
}
