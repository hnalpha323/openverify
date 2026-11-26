/**
 * C251.1 (Phase 11, Workflow 11B Stage 1b (P)): one slot per environment and capped queue, the
 * generalisation of Phase 8's `workflow_environment_slots` (C117.8), whose rows became the
 * `workflow-step` queue's in migration 0036. A slot holds an override of the cap (`null` follows the
 * environment's setting) and when the fair sweep last served the environment for that queue; it is
 * never a counter: in-flight work is counted from each queue's own rows (`admitted_at`, or the
 * `enqueued_at` an outbox stamps). Only the sweep writes `last_served_at`.
 *
 * The queue names are `QUEUE_IN_FLIGHT_CAP_QUEUES` of `@openverify/contracts` and `workflow-step`
 * (Stage 1a amendment 16), held equal by an API test.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';

/** C251.1: the queues whose work is admitted under a per-environment cap. */
export const QUEUE_SLOT_QUEUE_VALUES = [
  'workflow-step',
  'process-verification',
  'report-run',
  'connect-redeem',
  'account-export',
  'list-screen',
  'list-import',
  'list-item-embed',
  'graph-index',
  'graph-query',
  'inquiry-signals',
  'list-rescreen',
  'integrity-decode',
  'case-rendition',
  'case-attachment-scan',
  'case-bulk',
] as const;
export type QueueSlotQueue = (typeof QUEUE_SLOT_QUEUE_VALUES)[number];

export const queueSlots = pgTable(
  'queue_slots',
  {
    environmentId: environmentId(),
    queue: text('queue').$type<QueueSlotQueue>().notNull(),
    /** An override of the setting; `null` follows it. */
    inFlightCap: integer('in_flight_cap'),
    lastServedAt: timestamptz('last_served_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'queue_slots_pkey', columns: [table.environmentId, table.queue] }),
    // The fair sweep's rotation per queue: never served first, then the longest unserved.
    index('queue_slots_rotation_idx').on(table.queue, table.lastServedAt.asc().nullsFirst()),
    check('queue_slots_queue_valid', oneOf(table.queue, QUEUE_SLOT_QUEUE_VALUES)),
    check('queue_slots_cap_range', sql`${table.inFlightCap} is null or ${table.inFlightCap} >= 1`),
  ],
);

export type QueueSlotRow = typeof queueSlots.$inferSelect;
