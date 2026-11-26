/**
 * Case queues (plan C132.1): a queue holds unassigned cases for its members to pull, and names the
 * assignment policy that pushes them (C132.2). The public object has `status`, `name` and timestamps;
 * `members` and the policy are ours. A member must hold `cases:write` (the service refuses anyone
 * else with `case_assignee_ineligible`), so the console's member list never needs another check.
 *
 * A queue holds configuration and operator ids, never a subject's data, so nothing here is PII.
 *
 * Routes (frozen by `foundation-8b`, built by `api-queues-sla`): `GET`, `POST /case-queues`, `GET`,
 * `PATCH /case-queues/:id` and `PUT /case-queues/:id/members`, under `case-queues:read` and
 * `case-queues:write` (C129.5).
 */
import { caseQueueStatusSchema, type CaseQueueStatus } from '@openverify/core';
import { z } from 'zod';
import { caseLimit } from './case-templates.js';
import { idSchema } from './ids.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

/** C130.1, C132: a queue's, a policy's or a calendar's name. */
export const caseConfigNameSchema = z.string().min(1).max(caseLimit('config-name-characters'));

/** C132.1 (ours): how many open cases a member takes at once; 1 to 500. */
export const caseQueueMaxOpenSchema = z.int().min(1).max(caseLimit('member-max-open'));

/** C132.1 (ours): one member as served. */
export const caseQueueMemberSchema = z.strictObject({
  'user-id': idSchema('usr'),
  'max-open': caseQueueMaxOpenSchema,
  /** A paused member is skipped by every policy and keeps no turn (C132.3). */
  paused: z.boolean(),
});
export type CaseQueueMember = z.infer<typeof caseQueueMemberSchema>;

/** A member as written: `max-open` defaults to 50 and `paused` to false. */
export const caseQueueMemberInputSchema = z.strictObject({
  'user-id': idSchema('usr'),
  'max-open': caseQueueMaxOpenSchema.optional(),
  paused: z.boolean().optional(),
});
export type CaseQueueMemberInput = z.infer<typeof caseQueueMemberInputSchema>;

const membersOf = <Member extends z.ZodType<{ 'user-id': string }>>(member: Member) =>
  z
    .array(member)
    .max(caseLimit('queue-members'))
    .refine(
      (members) => hasDistinctValues(members.map((each) => each['user-id'])),
      'must not name a user twice',
    );

/** C132.1, C129.3: public attributes, then ours. */
export const caseQueueAttributesSchema = z
  .strictObject({
    status: caseQueueStatusSchema,
    name: caseConfigNameSchema,
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
    'archived-at': timestampSchema.nullable(),
    members: membersOf(caseQueueMemberSchema),
    /** C132.2: the policy that pushes this queue's cases; `null` leaves them to pull and to hand. */
    'case-assignment-policy-id': idSchema('cap').nullable(),
  })
  .refine((a) => (a.status === 'archived') === (a['archived-at'] !== null), {
    message: 'a queue has archived-at exactly when it is archived',
    path: ['archived-at'],
  });

export const caseQueueResourceSchema = resourceSchema(
  'case-queue',
  'cqueue',
  caseQueueAttributesSchema,
);
export type CaseQueueResource = z.infer<typeof caseQueueResourceSchema>;
export const caseQueueDocumentSchema = singleDocumentSchema(caseQueueResourceSchema);
export type CaseQueueDocument = z.infer<typeof caseQueueDocumentSchema>;
export const caseQueueListDocumentSchema = listDocumentSchema(caseQueueResourceSchema);
export type CaseQueueListDocument = z.infer<typeof caseQueueListDocumentSchema>;

/** `GET /api/v1/case-queues`: newest first; `filter[member-id]` reads a person's queues. */
export const listCaseQueuesQuerySchema = listQuerySchema('cqueue', {
  'filter[status]': filterListSchema(caseQueueStatusSchema).optional(),
  'filter[member-id]': filterListSchema(idSchema('usr')).optional(),
});
export type ListCaseQueuesQuery = z.infer<typeof listCaseQueuesQuerySchema>;

/** `POST /api/v1/case-queues` (`case-queues:write`). */
export const createCaseQueueBodySchema = requestDocumentSchema(
  'case-queue',
  z.strictObject({
    name: caseConfigNameSchema,
    'case-assignment-policy-id': idSchema('cap').nullable().optional(),
    members: membersOf(caseQueueMemberInputSchema).optional(),
  }),
);
export type CreateCaseQueueBody = z.infer<typeof createCaseQueueBodySchema>;

/**
 * `PATCH /api/v1/case-queues/:id`. `status` takes `archived` alone, because archiving is permanent
 * (C132.1); it returns the queue's unassigned cases to no queue, with `case.queue-updated` each.
 */
export const updateCaseQueueBodySchema = requestDocumentSchema(
  'case-queue',
  z
    .strictObject({
      name: caseConfigNameSchema.optional(),
      status: z.literal('archived').optional(),
      'case-assignment-policy-id': idSchema('cap').nullable().optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateCaseQueueBody = z.infer<typeof updateCaseQueueBodySchema>;

/**
 * `PUT /api/v1/case-queues/:id/members`: the whole list, replaced. A member who leaves gives back
 * their open cases of this queue through the re-assignment sweep (C132.6).
 */
export const setCaseQueueMembersBodySchema = requestDocumentSchema(
  'case-queue',
  z.strictObject({ members: membersOf(caseQueueMemberInputSchema) }),
);
export type SetCaseQueueMembersBody = z.infer<typeof setCaseQueueMembersBodySchema>;

export interface CaseQueueRecord {
  id: string;
  name: string;
  status: CaseQueueStatus;
  members: readonly { userId: string; maxOpen: number; paused: boolean }[];
  caseAssignmentPolicyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseQueueResource(record: CaseQueueRecord): CaseQueueResource {
  return caseQueueResourceSchema.parse({
    type: 'case-queue',
    id: record.id,
    attributes: {
      status: record.status,
      name: record.name,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'archived-at': toNullableTimestamp(record.archivedAt),
      members: record.members.map(({ userId, maxOpen, paused }) => ({
        'user-id': userId,
        'max-open': maxOpen,
        paused,
      })),
      'case-assignment-policy-id': record.caseAssignmentPolicyId,
    },
  });
}
