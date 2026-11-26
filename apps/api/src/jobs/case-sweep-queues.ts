/**
 * C143.1 (Workflow 8B Stage 1b (Q)): the repeatable case sweeps' names and periods, frozen here.
 * `startWorkers` schedules them with the case options (`caseRepeatableJobs`), and each runs its owner's
 * function (`jobs/repeatable/cases.ts`, `api-queues-sla`).
 */

/** C133.6 (decision 60): running SLAs whose deadline is due expire, once per epoch. */
export const CASE_SLA_QUEUE = 'case-sla';
/** C133.6: every 30 seconds (provisional: half a minute of lateness on a deadline of hours). */
export const CASE_SLA_INTERVAL_MS = 30_000;

/** C132.6: cases of a user who left a queue, was deactivated or lost access return to the queue. */
export const CASE_REASSIGN_QUEUE = 'case-reassign';
/** C132.6: every 60 seconds (provisional: a minute is short beside a review's pace). */
export const CASE_REASSIGN_INTERVAL_MS = 60_000;

/** C143.1 (Workflow 8B (F); C138.1): expired export files deleted. */
export const CASE_EXPORT_SWEEP_QUEUE = 'case-export-sweep';
/** C143.1: every 60 seconds (provisional: a minute past a 24-hour expiry). */
export const CASE_EXPORT_SWEEP_INTERVAL_MS = 60_000;

/**
 * C137.4, C143.2 (Workflow 8B Stage 4): bulk actions a lost enqueue or a crashed worker left
 * unfinished are enqueued again (`requeueUnfinishedCaseBulkActions`); the job id is the `cblk_` id,
 * so a job still queued or running is not doubled.
 */
export const CASE_BULK_SWEEP_QUEUE = 'case-bulk-sweep';
/** Every 60 seconds, for actions older than one period (provisional: a bulk job is minutes long). */
export const CASE_BULK_SWEEP_INTERVAL_MS = 60_000;

/** K8-20 (Workflow 8D): the link-only case notification emails, sent by the worker. */
export const CASE_NOTIFICATION_EMAIL_QUEUE = 'case-notification-emails';
/** Provisional: an email follows its notification within half a minute, as the SLA sweep's period. */
export const CASE_NOTIFICATION_EMAIL_INTERVAL_MS = 30_000;

/** K8-24 (Workflow 8D; C132.2): the drain of waiting cases into agents' room, every 60 seconds. */
export const CASE_ASSIGNMENT_DRAIN_QUEUE = 'case-assignment-drain';
/** Provisional: as `case-reassign`, which also returns cases to their policies. */
export const CASE_ASSIGNMENT_DRAIN_INTERVAL_MS = 60_000;
