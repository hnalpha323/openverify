/**
 * C143.5 (P19; Workflow 8B, `api-queues-sla`): the audit entries of queues, policies, calendars and
 * assignment. Each action's metadata is a strict schema of ids, enumerated names, member names and
 * counts, so a queue's name, a holiday's label or an address can never reach `audit_logs.metadata`.
 */
import { idSchema } from '@openverify/contracts';
import { CASE_ASSIGNMENT_STRATEGIES } from '@openverify/core';
import { z } from 'zod';
import type { AuditedAction } from '../../context.js';

const count = z.int().min(0);
const attributeNames = z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(20);

const SCHEMAS = {
  'case-queue.created': z.strictObject({
    'member-count': count,
    'case-assignment-policy-id': idSchema('cap').nullable(),
  }),
  'case-queue.updated': z.strictObject({ attributes: attributeNames }),
  'case-queue.archived': z.strictObject({ 'returned-case-count': count }),
  'case-queue.members-set': z.strictObject({
    'member-count': count,
    'removed-count': count,
    'returned-case-count': count,
  }),
  'case-assignment-policy.created': z.strictObject({
    distribution: z.string().regex(/^[a-z-]{1,32}$/),
    'source-count': count,
  }),
  'case-assignment-policy.updated': z.strictObject({ attributes: attributeNames }),
  'case-sla-policy.created': z.strictObject({ revision: z.int().min(1) }),
  'case-sla-policy.updated': z.strictObject({
    attributes: attributeNames,
    revision: z.int().min(1),
  }),
  'case-calendar.created': z.strictObject({ 'holiday-count': count, 'closure-count': count }),
  'case-calendar.updated': z.strictObject({
    attributes: attributeNames,
    'recomputed-case-count': count,
  }),
  'case-calendar.holidays-imported': z.strictObject({
    'imported-count': count,
    'refused-count': count,
    replace: z.boolean(),
  }),
  'case.assigned': z.strictObject({
    strategy: z.enum(CASE_ASSIGNMENT_STRATEGIES),
    'assignee-id': idSchema('usr').nullable(),
  }),
} as const;

export type QueueAuditAction = keyof typeof SCHEMAS;

export const QUEUE_AUDIT_ACTIONS = Object.keys(SCHEMAS) as readonly QueueAuditAction[];

const RESOURCE_TYPES: Record<QueueAuditAction, string> = {
  'case-queue.created': 'case-queue',
  'case-queue.updated': 'case-queue',
  'case-queue.archived': 'case-queue',
  'case-queue.members-set': 'case-queue',
  'case-assignment-policy.created': 'case-assignment-policy',
  'case-assignment-policy.updated': 'case-assignment-policy',
  'case-sla-policy.created': 'case-sla-policy',
  'case-sla-policy.updated': 'case-sla-policy',
  'case-calendar.created': 'case-calendar',
  'case-calendar.updated': 'case-calendar',
  'case-calendar.holidays-imported': 'case-calendar',
  'case.assigned': 'case',
};

/**
 * The audited action, its metadata held to the action's schema.
 * @throws {z.ZodError} for metadata outside the action's schema, which is a bug here.
 */
export function queueAudit<Action extends QueueAuditAction>(
  action: Action,
  resourceId: string,
  metadata: z.input<(typeof SCHEMAS)[Action]>,
): AuditedAction & { metadata: Record<string, unknown> } {
  return {
    action,
    resourceType: RESOURCE_TYPES[action],
    resourceId,
    metadata: SCHEMAS[action].parse(metadata),
  };
}
