/**
 * The action catalogue and the recipes (plan C122.4, C140.5). `GET /api/v1/workflow-actions` renders
 * the registry, so the console's palette never hard-codes a step (C141.4): each action version with
 * its config schema from `z.toJSONSchema()`, its output schema with PII marks, grant, delivery, adverse
 * flag, stage, triggers and whether it is available here. The registry itself is
 * `@openverify/workflow-engine`'s; this is what a client reads of it.
 *
 * Routes (frozen by `foundation-8a`): `workflow-actions.ts` (`api-engine`) and `workflow-recipes.ts`
 * (`api-workflows`), read with `workflows:read`; installing a recipe takes `workflows:write`.
 */
import {
  ACTION_ADVERSE,
  ACTION_DELIVERIES,
  ACTION_KINDS,
  ACTION_STAGES,
  actionAdverseSchema,
  actionDeliverySchema,
  actionKindSchema,
  actionStageSchema,
  workflowTriggerTypeSchema,
} from '@openverify/core';
import { z } from 'zod';
import { emptyActionBodySchema } from './actions.js';
import { eventNameSchema } from './event-names.js';
import { listDocumentSchema, singleDocumentSchema } from './json-api.js';
import { workflowActionKeySchema, workflowJsonSchema } from './workflow-definition.js';
import { workflowGrantSchema } from './workflows.js';

export { ACTION_ADVERSE, ACTION_DELIVERIES, ACTION_KINDS, ACTION_STAGES };

/** One action version: `<key>@<version>`. */
export const workflowActionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}@[1-9][0-9]{0,5}$/, 'must be an action key and version');

/** C122.5: `available` is false only with a reason. */
export const WORKFLOW_ACTION_UNAVAILABLE_REASONS = [
  'provider_not_configured',
  'code_disabled',
] as const;

export const workflowActionAttributesSchema = z
  .strictObject({
    key: workflowActionKeySchema,
    version: z.int().min(1),
    kind: actionKindSchema,
    stage: actionStageSchema,
    delivery: actionDeliverySchema,
    adverse: actionAdverseSchema,
    /** `z.toJSONSchema()` of the config, for the step's form. */
    'config-schema': z.record(z.string(), workflowJsonSchema),
    /** `z.toJSONSchema()` of the output, each member with its PII mark (C120.6). */
    'output-schema': z.record(z.string(), workflowJsonSchema),
    /** What every use of it needs; `grant-depends-on-config` says when a config adds to it. */
    grant: workflowGrantSchema,
    'grant-depends-on-config': z.boolean(),
    emits: z.array(eventNameSchema),
    /** `null` serves every trigger type (C122.3). */
    triggers: z.array(workflowTriggerTypeSchema).nullable(),
    available: z.boolean(),
    reason: z.enum(WORKFLOW_ACTION_UNAVAILABLE_REASONS).nullable(),
  })
  .refine(({ available, reason }) => available === (reason === null), {
    message: 'an action is unavailable exactly when it says why (C122.5)',
    path: ['reason'],
  });

export const workflowActionResourceSchema = z.strictObject({
  type: z.literal('workflow-action'),
  id: workflowActionIdSchema,
  attributes: workflowActionAttributesSchema,
});
export type WorkflowActionResource = z.infer<typeof workflowActionResourceSchema>;
export const workflowActionListDocumentSchema = listDocumentSchema(workflowActionResourceSchema);
export type WorkflowActionListDocument = z.infer<typeof workflowActionListDocumentSchema>;

/** The catalogue is one document: every action version, with no pagination. */
export const listWorkflowActionsQuerySchema = z.strictObject({});

/** A recipe's key: kebab-case, because it is a path segment. */
export const workflowRecipeKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, 'must be a kebab-case key');

/** C140.5: a documented, disabled workflow an operator installs. */
export const workflowRecipeResourceSchema = z.strictObject({
  type: z.literal('workflow-recipe'),
  id: workflowRecipeKeySchema,
  attributes: z.strictObject({
    name: z.string().min(1).max(80),
    description: z.string().max(500),
    'trigger-type': workflowTriggerTypeSchema,
    /** What must be filled before it can be published in production (C128.3). */
    'needs-configuration': z.array(z.string().min(1).max(64)),
  }),
});
export type WorkflowRecipeResource = z.infer<typeof workflowRecipeResourceSchema>;
export const workflowRecipeDocumentSchema = singleDocumentSchema(workflowRecipeResourceSchema);
export const workflowRecipeListDocumentSchema = listDocumentSchema(workflowRecipeResourceSchema);
export type WorkflowRecipeListDocument = z.infer<typeof workflowRecipeListDocumentSchema>;
export const listWorkflowRecipesQuerySchema = z.strictObject({});

/** `POST /api/v1/workflow-recipes/:key/install`: answers the new workflow, paused, with its draft. */
export const installWorkflowRecipeBodySchema = emptyActionBodySchema;
