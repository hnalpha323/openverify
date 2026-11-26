/**
 * C251.1 (Workflow 11B Stage 1b (P)): the `process-verification` and `report-run` producers behind
 * the admission hook. Every enqueue the API and the worker make (inventory 2.6: the flow's and the
 * server's submits, the OTP submit, a decision hook's attempt, the workflow actions, the report
 * creations and runs, the bulk reports, the outbox and repair sweeps) asks `admitOnProduce`
 * (`services/quotas/admit.ts`, `quotas`') first, and only an admitted row's job is enqueued; a held
 * row waits for the fair sweep, which enqueues through the unwrapped producer.
 *
 * Frozen by `foundation-11b`; a change is a plan amendment.
 */
import type { ReportRunQueue, VerificationQueue } from '../ports.js';
import { admitOnProduce, type AdmitOnProduceDeps } from '../services/quotas/admit.js';
import type { InstallQueueLimits } from '../services/quotas/caps.js';

type Closable<Queue> = Queue & { close(): Promise<void> };

/** The `process-verification` producer, admitting each verification before its job. */
export function withVerificationAdmission(
  inner: Closable<VerificationQueue>,
  deps: AdmitOnProduceDeps,
): Closable<VerificationQueue> {
  return {
    async enqueueProcessVerification(job) {
      const row = {
        queue: 'process-verification' as const,
        environmentId: job.environmentId,
        id: job.verificationId,
      };
      if (await admitOnProduce(deps, row)) {
        await inner.enqueueProcessVerification(job);
      }
    },
    close: () => inner.close(),
  };
}

/** The `report-run` producer, admitting each run before its job. */
export function withReportRunAdmission(
  inner: Closable<ReportRunQueue>,
  deps: AdmitOnProduceDeps,
): Closable<ReportRunQueue> {
  return {
    async enqueueReportRun(job) {
      const row = { queue: 'report-run' as const, environmentId: job.environmentId, id: job.runId };
      if (await admitOnProduce(deps, row)) {
        await inner.enqueueReportRun(job);
      }
    },
    close: () => inner.close(),
  };
}

/**
 * C251.2 (Workflow 11B, `integration-11b`): the install's queue limits from the configuration, for the
 * producers' admission and the worker's quota sweep (`OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`, and Phase
 * 8's `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP` as the workflow-step default).
 */
export function installQueueLimitsOf(config: {
  queueInFlightCapMax: number;
  workflows: { inFlightCap: number };
}): InstallQueueLimits {
  return { ceiling: config.queueInFlightCapMax, workflowDefault: config.workflows.inFlightCap };
}
