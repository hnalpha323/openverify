/**
 * Assignment and SLA policies (plan C132.2, C133.1). An assignment policy (public `cap_`, behaviour
 * note 3.4) picks an agent for a case that enters a queue or is created on a template; an SLA policy
 * (ours, `cslap_`) sets a deadline in business minutes on a calendar, or around the clock.
 *
 * Where a case's SLA starts and which statuses pause it are the template version's
 * (`sla-starts-on` and each status's `pauses-sla`, C130.2), so a policy does not repeat them
 * (Stage 1a amendment). A policy's `revision` counts its edits: a case pins the revision its SLA
 * started under (C133.4), and a later edit moves only cases that start after it.
 *
 * A policy holds configuration and operator ids, never a subject's data, so nothing here is PII.
 *
 * Routes (frozen by `foundation-8b`, built by `api-queues-sla`): `GET`, `POST
 * /case-assignment-policies`, `GET`, `PATCH /case-assignment-policies/:id`, and the same for
 * `/case-sla-policies`, under `case-queues:read` and `case-queues:write` (C129.5).
 */
import {
  caseAssignmentDistributionSchema,
  caseAssignmentSortSchema,
  caseSlaOnReopenSchema,
  type CaseAssignmentDistribution,
  type CaseAssignmentSort,
  type CaseAssignmentSourceType,
  type CaseSlaOnReopen,
} from '@openverify/core';
import { z } from 'zod';
import { caseConfigNameSchema, caseQueueMaxOpenSchema } from './case-queues.js';
import { caseLimit, caseTemplateIdentifierSchema } from './case-templates.js';
import { caseQueueIdentifierSchema } from './identifiers.js';
import { idSchema } from './ids.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

// ---------------------------------------------------------------------------------------------
// Assignment policies (C132.2)

/** C132.2: a case template or a queue, in priority order. */
export const caseAssignmentSourceSchema = z.union([
  caseTemplateIdentifierSchema,
  caseQueueIdentifierSchema,
]);
export type CaseAssignmentSource = z.infer<typeof caseAssignmentSourceSchema>;

const sourcesSchema = z
  .array(caseAssignmentSourceSchema)
  .min(1)
  .max(caseLimit('policy-sources'))
  .refine(
    (sources) => hasDistinctValues(sources.map(({ id }) => id)),
    'must not name a source twice',
  );

/** `null`: the members of the queue a case is routed to (C132.2's default). */
const agentsSchema = z
  .array(idSchema('usr'))
  .min(1)
  .max(caseLimit('policy-agents'))
  .refine(hasDistinctValues, 'must not contain duplicates');

const ASSIGNMENT_ATTRIBUTES = {
  name: caseConfigNameSchema,
  distribution: caseAssignmentDistributionSchema,
  sort: caseAssignmentSortSchema,
  agents: agentsSchema.nullable(),
  /** `null`: each member's own `max-open` (C132.1). */
  'max-capacity': caseQueueMaxOpenSchema.nullable(),
  sources: sourcesSchema,
};

export const caseAssignmentPolicyResourceSchema = resourceSchema(
  'case-assignment-policy',
  'cap',
  z.strictObject({
    ...ASSIGNMENT_ATTRIBUTES,
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
);
export type CaseAssignmentPolicyResource = z.infer<typeof caseAssignmentPolicyResourceSchema>;
export const caseAssignmentPolicyDocumentSchema = singleDocumentSchema(
  caseAssignmentPolicyResourceSchema,
);
export type CaseAssignmentPolicyDocument = z.infer<typeof caseAssignmentPolicyDocumentSchema>;
export const caseAssignmentPolicyListDocumentSchema = listDocumentSchema(
  caseAssignmentPolicyResourceSchema,
);
export type CaseAssignmentPolicyListDocument = z.infer<
  typeof caseAssignmentPolicyListDocumentSchema
>;

export const listCaseAssignmentPoliciesQuerySchema = listQuerySchema('cap', {
  'filter[distribution]': filterListSchema(caseAssignmentDistributionSchema).optional(),
});

/** `POST /api/v1/case-assignment-policies`: `sort` defaults to `created-at`, the rest to `null`. */
export const createCaseAssignmentPolicyBodySchema = requestDocumentSchema(
  'case-assignment-policy',
  z.strictObject({
    name: ASSIGNMENT_ATTRIBUTES.name,
    distribution: ASSIGNMENT_ATTRIBUTES.distribution,
    sort: ASSIGNMENT_ATTRIBUTES.sort.optional(),
    agents: ASSIGNMENT_ATTRIBUTES.agents.optional(),
    'max-capacity': ASSIGNMENT_ATTRIBUTES['max-capacity'].optional(),
    sources: ASSIGNMENT_ATTRIBUTES.sources,
  }),
);
export type CreateCaseAssignmentPolicyBody = z.infer<typeof createCaseAssignmentPolicyBodySchema>;

/** `PATCH /api/v1/case-assignment-policies/:id`: what it sends replaces; cases assigned stay so. */
export const updateCaseAssignmentPolicyBodySchema = requestDocumentSchema(
  'case-assignment-policy',
  z
    .strictObject({
      name: ASSIGNMENT_ATTRIBUTES.name.optional(),
      distribution: ASSIGNMENT_ATTRIBUTES.distribution.optional(),
      sort: ASSIGNMENT_ATTRIBUTES.sort.optional(),
      agents: ASSIGNMENT_ATTRIBUTES.agents.optional(),
      'max-capacity': ASSIGNMENT_ATTRIBUTES['max-capacity'].optional(),
      sources: ASSIGNMENT_ATTRIBUTES.sources.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateCaseAssignmentPolicyBody = z.infer<typeof updateCaseAssignmentPolicyBodySchema>;

export interface CaseAssignmentPolicyRecord {
  id: string;
  name: string;
  distribution: CaseAssignmentDistribution;
  sort: CaseAssignmentSort;
  agentIds: readonly string[] | null;
  maxCapacity: number | null;
  sources: readonly { type: CaseAssignmentSourceType; id: string }[];
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseAssignmentPolicyResource(
  record: CaseAssignmentPolicyRecord,
): CaseAssignmentPolicyResource {
  return caseAssignmentPolicyResourceSchema.parse({
    type: 'case-assignment-policy',
    id: record.id,
    attributes: {
      name: record.name,
      distribution: record.distribution,
      sort: record.sort,
      agents: record.agentIds,
      'max-capacity': record.maxCapacity,
      sources: record.sources.map(({ type, id }) => ({ type, id })),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}

// ---------------------------------------------------------------------------------------------
// SLA policies (C133.1)

/** C133.1: business minutes, 1 to 525,600. */
export const caseSlaTargetMinutesSchema = z.int().min(1).max(caseLimit('sla-target-minutes'));

const SLA_ATTRIBUTES = {
  name: caseConfigNameSchema,
  'target-minutes': caseSlaTargetMinutesSchema,
  /** `null` counts around the clock (`24x7`, C133.1); otherwise the calendar's business hours. */
  'case-calendar-id': idSchema('ccal').nullable(),
  'on-reopen': caseSlaOnReopenSchema,
};

export const caseSlaPolicyResourceSchema = resourceSchema(
  'case-sla-policy',
  'cslap',
  z.strictObject({
    ...SLA_ATTRIBUTES,
    /** C133.4: counts the policy's edits from 1; a case pins the revision its SLA started under. */
    revision: z.int().min(1),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
);
export type CaseSlaPolicyResource = z.infer<typeof caseSlaPolicyResourceSchema>;
export const caseSlaPolicyDocumentSchema = singleDocumentSchema(caseSlaPolicyResourceSchema);
export type CaseSlaPolicyDocument = z.infer<typeof caseSlaPolicyDocumentSchema>;
export const caseSlaPolicyListDocumentSchema = listDocumentSchema(caseSlaPolicyResourceSchema);
export type CaseSlaPolicyListDocument = z.infer<typeof caseSlaPolicyListDocumentSchema>;

export const listCaseSlaPoliciesQuerySchema = listQuerySchema('cslap', {
  'filter[case-calendar-id]': filterListSchema(idSchema('ccal')).optional(),
});

/** `POST /api/v1/case-sla-policies`: around the clock and `continue` (decision 58) by default. */
export const createCaseSlaPolicyBodySchema = requestDocumentSchema(
  'case-sla-policy',
  z.strictObject({
    name: SLA_ATTRIBUTES.name,
    'target-minutes': SLA_ATTRIBUTES['target-minutes'],
    'case-calendar-id': SLA_ATTRIBUTES['case-calendar-id'].optional(),
    'on-reopen': SLA_ATTRIBUTES['on-reopen'].optional(),
  }),
);
export type CreateCaseSlaPolicyBody = z.infer<typeof createCaseSlaPolicyBodySchema>;

/** `PATCH /api/v1/case-sla-policies/:id`: a new revision; running SLAs keep the one they pinned. */
export const updateCaseSlaPolicyBodySchema = requestDocumentSchema(
  'case-sla-policy',
  z
    .strictObject({
      name: SLA_ATTRIBUTES.name.optional(),
      'target-minutes': SLA_ATTRIBUTES['target-minutes'].optional(),
      'case-calendar-id': SLA_ATTRIBUTES['case-calendar-id'].optional(),
      'on-reopen': SLA_ATTRIBUTES['on-reopen'].optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateCaseSlaPolicyBody = z.infer<typeof updateCaseSlaPolicyBodySchema>;

export interface CaseSlaPolicyRecord {
  id: string;
  name: string;
  targetMinutes: number;
  caseCalendarId: string | null;
  onReopen: CaseSlaOnReopen;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseSlaPolicyResource(record: CaseSlaPolicyRecord): CaseSlaPolicyResource {
  return caseSlaPolicyResourceSchema.parse({
    type: 'case-sla-policy',
    id: record.id,
    attributes: {
      name: record.name,
      'target-minutes': record.targetMinutes,
      'case-calendar-id': record.caseCalendarId,
      'on-reopen': record.onReopen,
      revision: record.revision,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}
