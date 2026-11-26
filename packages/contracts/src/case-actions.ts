/**
 * Case actions (plan C140.1, public W9): a running workflow whose trigger is `trigger-case`, bound to
 * one or more case templates with a label, a placement and a parameter form (the trigger's `inputs`).
 * A prefill names a `case.fields.*`, `inquiry.fields.*` or `account.fields.*` path, never a value, so
 * an action holds configuration only. The available actions a viewer sees are prefilled under that
 * viewer's mask (P38): a masked field stays empty, and the run reads the live value under its grant.
 *
 * Routes (frozen by `foundation-8b`, built by `api-case-workflows`): `GET`, `POST /case-actions`,
 * `GET`, `PATCH /case-actions/:id` under `workflows:write`, `POST /cases/:id/run-action`
 * (`cases:read`, `workflows:trigger` and the version's grant, C121.3) and
 * `GET /cases/:id/available-actions` (`cases:read` and `workflows:trigger`, H14).
 */
import {
  CASE_ACTION_FIXED_PLACEMENTS,
  CASE_ACTION_MODULE_PLACEMENT_PATTERN,
  caseActionStatusSchema,
  type CaseActionStatus,
} from '@openverify/core';
import { z } from 'zod';
import { caseLimit, caseStatusKeySchema, caseTemplateIdentifierSchema } from './case-templates.js';
import { idSchema } from './ids.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import {
  workflowDeclaredNameSchema,
  workflowJsonSchema,
  workflowPathSchema,
  workflowTypeSchema,
} from './workflow-definition.js';
import { workflowIdentifierSchema } from './workflows.js';

const labelSchema = z.string().min(1).max(80);

/** C140.1: what a prefill reads. The case's first held inquiry or account answers the last two. */
const PREFILL_PATH = /^(?:case|inquiry|account)\.fields\.[^.]/;

/** Input name to a path, never a value. */
const prefillSchema = z.record(
  workflowDeclaredNameSchema,
  workflowPathSchema.refine(
    (path) => PREFILL_PATH.test(path),
    'must read case.fields, inquiry.fields or account.fields',
  ),
);

const templatesSchema = z
  .array(idSchema('ctmpl'))
  .min(1)
  .max(caseLimit('action-templates'))
  .refine(hasDistinctValues, 'must not contain duplicates');

/**
 * C172.5 (Workflow 9B; the Phase 8 C140.1 deferral): where an action shows. The resource's and the
 * bodies' `placement`, with `case_actions_placement_valid` in migration 0031 (`foundation-9b` (C);
 * B34). Until `api-cases-reports` builds it, a placement other than `header` answers 501.
 */
export const caseActionPlacementInputSchema = z.union([
  z.enum(CASE_ACTION_FIXED_PLACEMENTS),
  z.string().regex(CASE_ACTION_MODULE_PLACEMENT_PATTERN, 'must be module:<module key>'),
]);
export type CaseActionPlacementInput = z.infer<typeof caseActionPlacementInputSchema>;

/**
 * C172.5 (review P28): which statuses and roles see the action; an empty list is no restriction.
 * `available-actions` filters by it and `run-action` applies it through the same function (403
 * `case_action_not_available`).
 */
export const caseActionVisibleWhenSchema = z.strictObject({
  statuses: z.array(caseStatusKeySchema).max(20),
  'role-ids': z.array(idSchema('role')).max(20),
});
export type CaseActionVisibleWhen = z.infer<typeof caseActionVisibleWhenSchema>;

export const caseActionAttributesSchema = z.strictObject({
  label: labelSchema,
  status: caseActionStatusSchema,
  placement: caseActionPlacementInputSchema,
  /** C172.5 (Workflow 9B): left out by earlier servers, which restrict nothing. */
  'visible-when': caseActionVisibleWhenSchema.nullable().optional(),
  prefill: prefillSchema,
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});

export const caseActionRelationshipsSchema = z.strictObject({
  workflow: toOneRelationshipSchema(workflowIdentifierSchema),
  'case-templates': z.strictObject({
    data: z.array(caseTemplateIdentifierSchema).min(1).max(caseLimit('action-templates')),
  }),
});

export const caseActionResourceSchema = resourceWithRelationshipsSchema(
  'case-action',
  'cact',
  caseActionAttributesSchema,
  caseActionRelationshipsSchema,
);
export type CaseActionResource = z.infer<typeof caseActionResourceSchema>;
export const caseActionDocumentSchema = singleDocumentSchema(caseActionResourceSchema);
export type CaseActionDocument = z.infer<typeof caseActionDocumentSchema>;
export const caseActionListDocumentSchema = listDocumentSchema(caseActionResourceSchema);
export type CaseActionListDocument = z.infer<typeof caseActionListDocumentSchema>;

export const listCaseActionsQuerySchema = listQuerySchema('cact', {
  'filter[workflow-id]': filterListSchema(idSchema('wfl')).optional(),
  'filter[case-template-id]': filterListSchema(idSchema('ctmpl')).optional(),
  'filter[status]': filterListSchema(caseActionStatusSchema).optional(),
});

export const createCaseActionBodySchema = requestDocumentSchema(
  'case-action',
  z.strictObject({
    'workflow-id': idSchema('wfl'),
    'case-template-ids': templatesSchema,
    label: labelSchema,
    placement: caseActionPlacementInputSchema.optional(),
    /** C172.5 (Workflow 9B Stage 1b (C)): 501 until `api-cases-reports` builds it. */
    'visible-when': caseActionVisibleWhenSchema.nullable().optional(),
    prefill: prefillSchema.optional(),
  }),
);
export type CreateCaseActionBody = z.infer<typeof createCaseActionBodySchema>;

export const updateCaseActionBodySchema = requestDocumentSchema(
  'case-action',
  z
    .strictObject({
      label: labelSchema.optional(),
      'case-template-ids': templatesSchema.optional(),
      prefill: prefillSchema.optional(),
      status: caseActionStatusSchema.optional(),
      /** C172.5 (Workflow 9B Stage 1b (C)): 501 until `api-cases-reports` builds them. */
      placement: caseActionPlacementInputSchema.optional(),
      'visible-when': caseActionVisibleWhenSchema.nullable().optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'must change something'),
);
export type UpdateCaseActionBody = z.infer<typeof updateCaseActionBodySchema>;

/** `POST /api/v1/cases/:id/run-action`, mirroring the public account path (C140.1). */
export const runCaseActionBodySchema = z.strictObject({
  data: z.strictObject({
    'case-action-id': idSchema('cact'),
    parameters: z
      .record(workflowDeclaredNameSchema, workflowJsonSchema)
      .optional()
      .meta({ pii: true }),
  }),
});
export type RunCaseActionBody = z.infer<typeof runCaseActionBodySchema>;

/** The answer: the run it created, as the account path answers. */
export const runCaseActionDocumentSchema = z.strictObject({
  data: z.strictObject({ 'workflow-run-id': idSchema('wfr') }),
});
export type RunCaseActionDocument = z.infer<typeof runCaseActionDocumentSchema>;

/** One input of the form, prefilled under the viewer's mask (P38). */
export const caseActionParameterSchema = z.strictObject({
  name: workflowDeclaredNameSchema,
  type: workflowTypeSchema,
  required: z.boolean(),
  'prefilled-value': workflowJsonSchema.nullable().meta({ pii: true }),
});

/** `GET /api/v1/cases/:id/available-actions` (H14): filtered by the caller's grant. */
export const caseAvailableActionResourceSchema = resourceWithRelationshipsSchema(
  'case-action',
  'cact',
  z.strictObject({
    label: labelSchema,
    placement: caseActionPlacementInputSchema,
    /** The parameter form: a PII attribute by name, so this one is not called `parameters`. */
    form: z.array(caseActionParameterSchema),
  }),
  z.strictObject({ workflow: toOneRelationshipSchema(workflowIdentifierSchema) }),
);
export const caseAvailableActionListDocumentSchema = listDocumentSchema(
  caseAvailableActionResourceSchema,
);
export type CaseAvailableActionListDocument = z.infer<typeof caseAvailableActionListDocumentSchema>;

export interface CaseActionRecord {
  id: string;
  workflowId: string;
  caseTemplateIds: readonly string[];
  label: string;
  status: CaseActionStatus;
  /** C172.5 (Workflow 9B): `header`, `status-switcher` or `module:<module key>`. */
  placement: CaseActionPlacementInput;
  /** C172.5 (Workflow 9B): left out by a server before 0031; `null` restricts nothing. */
  visibleWhen?: Readonly<{
    statuses: readonly string[];
    'role-ids': readonly string[];
  }> | null;
  prefill: Readonly<Record<string, string>>;
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseActionResource(record: CaseActionRecord): CaseActionResource {
  return caseActionResourceSchema.parse({
    type: 'case-action',
    id: record.id,
    attributes: {
      label: record.label,
      status: record.status,
      placement: record.placement,
      ...(record.visibleWhen === undefined
        ? {}
        : {
            'visible-when':
              record.visibleWhen === null
                ? null
                : {
                    statuses: [...record.visibleWhen.statuses],
                    'role-ids': [...record.visibleWhen['role-ids']],
                  },
          }),
      prefill: record.prefill,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: record.workflowId } },
      'case-templates': {
        data: record.caseTemplateIds.map((id) => ({ type: 'case-template', id })),
      },
    },
  });
}
