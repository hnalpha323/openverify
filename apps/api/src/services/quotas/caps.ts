/**
 * C251.2 (Phase 11, Workflow 11B Stage 2, `quotas`; decision 38, review P15; Stage 1a amendment 17):
 * an environment's in-flight cap per queue, and the install ceiling no tenant can raise it past.
 *
 * - Each capped queue (`QUEUE_IN_FLIGHT_CAP_QUEUES`) holds at most 50 of one environment's jobs
 *   queued or running (`QUEUE_IN_FLIGHT_CAP.default`; ours, provisional: Phase 8's step cap, C117.8),
 *   sandbox and production separately, since each is its own environment.
 * - `queue-in-flight-caps` lowers a queue's cap freely; it never raises one above the install
 *   ceiling `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX` (default 50, at most 1,000), so a tenant cannot take
 *   a larger share of the worker on a multi-customer install. A value above the ceiling is refused at
 *   write with C55.7's generic 422 and a pointer; an older value above a lowered ceiling is clamped on
 *   read, never refused.
 * - `workflow-step` keeps Phase 8's own setting `workflow-in-flight-cap` (1 to 10,000, unchanged so
 *   stored values parse) and the install default `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP`; both are bounded
 *   by the same ceiling, and its effective cap is the lower of the two.
 *
 * Pure: no database, no clock.
 */
import {
  QUEUE_IN_FLIGHT_CAP,
  QUEUE_IN_FLIGHT_CAP_QUEUES,
  WORKFLOW_IN_FLIGHT_CAP,
  type CappedQueue,
  type QueueInFlightCaps,
} from '@openverify/contracts';

/** Every queue under a per-environment cap: the fifteen of the setting and Phase 8's steps. */
export const ADMITTED_QUEUES = Object.freeze([
  ...QUEUE_IN_FLIGHT_CAP_QUEUES,
  'workflow-step',
] as const);
export type AdmittedQueue = (typeof ADMITTED_QUEUES)[number];

/** Whether `queue` is one of {@link ADMITTED_QUEUES}. */
export function isAdmittedQueue(queue: string): queue is AdmittedQueue {
  return (ADMITTED_QUEUES as readonly string[]).includes(queue);
}

/** The install's side of a cap: its ceiling and Phase 8's install default for workflow steps. */
export interface InstallQueueLimits {
  /** `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`, 1 to 1,000. */
  readonly ceiling: number;
  /** `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP`, Phase 8's default for `workflow-step`; absent is 50. */
  readonly workflowDefault?: number | undefined;
}

/** What an environment stores that bears on its caps (its `settings` jsonb, read loosely). */
export interface StoredQueueSettings {
  readonly 'queue-in-flight-caps'?: unknown;
  readonly 'workflow-in-flight-cap'?: unknown;
}

function storedCap(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : null;
}

/** The stored map read loosely: a member that is not a capped queue or not a cap is ignored. */
export function storedQueueCaps(value: unknown): QueueInFlightCaps {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const caps: Partial<Record<CappedQueue, number>> = {};
  for (const queue of QUEUE_IN_FLIGHT_CAP_QUEUES) {
    const cap = storedCap((value as Record<string, unknown>)[queue], QUEUE_IN_FLIGHT_CAP.max);
    if (cap !== null) {
      caps[queue] = cap;
    }
  }
  return caps;
}

/**
 * The cap in force for `queue` in an environment: its own setting (or the default), never above the
 * install ceiling. For `workflow-step`, a slot's own override (Phase 8's `in_flight_cap`) comes
 * first, then `workflow-in-flight-cap`, then the install default, each clamped the same way.
 */
export function effectiveQueueCap(
  queue: AdmittedQueue,
  settings: StoredQueueSettings,
  install: InstallQueueLimits,
  slotOverride: number | null = null,
): number {
  const ceiling = Math.max(QUEUE_IN_FLIGHT_CAP.min, install.ceiling);
  if (queue === 'workflow-step') {
    const own =
      slotOverride ??
      storedCap(settings['workflow-in-flight-cap'], WORKFLOW_IN_FLIGHT_CAP.max) ??
      install.workflowDefault ??
      WORKFLOW_IN_FLIGHT_CAP.default;
    return Math.min(own, ceiling);
  }
  const own =
    storedQueueCaps(settings['queue-in-flight-caps'])[queue] ?? QUEUE_IN_FLIGHT_CAP.default;
  return Math.min(own, ceiling);
}

/** Every admitted queue's cap in force for one environment, in {@link ADMITTED_QUEUES} order. */
export function effectiveQueueCaps(
  settings: StoredQueueSettings,
  install: InstallQueueLimits,
): Record<AdmittedQueue, number> {
  return Object.fromEntries(
    ADMITTED_QUEUES.map((queue) => [queue, effectiveQueueCap(queue, settings, install)]),
  ) as Record<AdmittedQueue, number>;
}

/** The stored map as served: each value clamped to the ceiling (C251.2's read). */
export function clampQueueCaps(caps: QueueInFlightCaps, ceiling: number): QueueInFlightCaps {
  return Object.fromEntries(
    Object.entries(caps).map(([queue, cap]) => [queue, Math.min(cap, ceiling)]),
  );
}

/** One refused member of a settings write: where it is, and why. */
export interface QueueCapRefusal {
  readonly pointer: string;
  readonly detail: string;
}

/** The members of a settings write that bear on caps (the `PATCH /dashboard/settings` body). */
export interface QueueCapChanges {
  readonly 'queue-in-flight-caps'?: QueueInFlightCaps | undefined;
  readonly 'workflow-in-flight-cap'?: number | undefined;
}

/**
 * C251.2's write check: every cap in `changes` above the install ceiling, with its JSON pointer, in
 * the setting's queue order and then `workflow-in-flight-cap`; empty when the write may go ahead.
 * The schema already bounds each value (1 to 1,000; Phase 8's 1 to 10,000).
 */
export function queueCapRefusals(
  changes: QueueCapChanges,
  ceiling: number,
): readonly QueueCapRefusal[] {
  const detail = `must be at most ${String(ceiling)}`;
  const refusals: QueueCapRefusal[] = [];
  const caps = changes['queue-in-flight-caps'];
  if (caps !== undefined) {
    for (const queue of QUEUE_IN_FLIGHT_CAP_QUEUES) {
      const cap = caps[queue];
      if (cap !== undefined && cap > ceiling) {
        refusals.push({ pointer: `/queue-in-flight-caps/${queue}`, detail });
      }
    }
  }
  const workflow = changes['workflow-in-flight-cap'];
  if (workflow !== undefined && workflow > ceiling) {
    refusals.push({ pointer: '/workflow-in-flight-cap', detail });
  }
  return refusals;
}

/** The 422's detail for {@link queueCapRefusals}, naming the ceiling (C55.7's words). */
export function queueCapRefusalDetail(ceiling: number): string {
  return `A queue's in-flight cap is at most this installation's ceiling, ${String(ceiling)}.`;
}
