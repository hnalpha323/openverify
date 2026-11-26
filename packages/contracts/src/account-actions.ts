/**
 * Account actions (plan C118.7, public W8): a running workflow whose trigger is `trigger-account`,
 * bound to an account type with a label and a parameter form (the trigger's `inputs`). A prefill names
 * an `account.fields.*` path, never a value, so an action holds configuration only. The available
 * actions a viewer sees are prefilled under that viewer's mask (P38): a masked field stays empty, and
 * the run reads the live value under its grant.
 *
 * Routes (frozen by `foundation-8a`, built by `api-triggers`): `GET`, `POST /account-actions`, `GET`,
 * `PATCH /account-actions/:id` under `workflows:write`, `POST /accounts/:id/run-action` (`accounts:read`,
 * `workflows:trigger` and the version's grant, C121.3) and `GET /accounts/:id/available-actions`.
 */
import { z } from 'zod';
import { accountTypeIdentifierSchema } from './identifiers.js';
import { idSchema } from './ids.js';
import {
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

/** Ours: there is no delete route, so an action is retired by archiving it. */
export const ACCOUNT_ACTION_STATUSES = ['active', 'archived'] as const;
export const accountActionStatusSchema = z.enum(ACCOUNT_ACTION_STATUSES);
export type AccountActionStatus = z.infer<typeof accountActionStatusSchema>;

const labelSchema = z.string().min(1).max(80);

/** Input name to an `account.fields.*` path. */
const prefillSchema = z.record(workflowDeclaredNameSchema, workflowPathSchema);

export const accountActionAttributesSchema = z.strictObject({
  label: labelSchema,
  status: accountActionStatusSchema,
  prefill: prefillSchema,
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});

export const accountActionRelationshipsSchema = z.strictObject({
  workflow: toOneRelationshipSchema(workflowIdentifierSchema),
  'account-type': toOneRelationshipSchema(accountTypeIdentifierSchema),
});

export const accountActionResourceSchema = resourceWithRelationshipsSchema(
  'account-action',
  'accac',
  accountActionAttributesSchema,
  accountActionRelationshipsSchema,
);
export type AccountActionResource = z.infer<typeof accountActionResourceSchema>;
export const accountActionDocumentSchema = singleDocumentSchema(accountActionResourceSchema);
export type AccountActionDocument = z.infer<typeof accountActionDocumentSchema>;
export const accountActionListDocumentSchema = listDocumentSchema(accountActionResourceSchema);

export const listAccountActionsQuerySchema = listQuerySchema('accac', {
  'filter[workflow-id]': filterListSchema(idSchema('wfl')).optional(),
  'filter[account-type-id]': filterListSchema(idSchema('acctp')).optional(),
  'filter[status]': filterListSchema(accountActionStatusSchema).optional(),
});

export const createAccountActionBodySchema = requestDocumentSchema(
  'account-action',
  z.strictObject({
    'workflow-id': idSchema('wfl'),
    'account-type-id': idSchema('acctp'),
    label: labelSchema,
    prefill: prefillSchema.optional(),
  }),
);
export type CreateAccountActionBody = z.infer<typeof createAccountActionBodySchema>;

export const updateAccountActionBodySchema = requestDocumentSchema(
  'account-action',
  z
    .strictObject({
      label: labelSchema.optional(),
      prefill: prefillSchema.optional(),
      status: accountActionStatusSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'must change something'),
);
export type UpdateAccountActionBody = z.infer<typeof updateAccountActionBodySchema>;

/** `POST /api/v1/accounts/:id/run-action` (public: `data.account-action-id`, `data.parameters`). */
export const runAccountActionBodySchema = z.strictObject({
  data: z.strictObject({
    'account-action-id': idSchema('accac'),
    parameters: z
      .record(workflowDeclaredNameSchema, workflowJsonSchema)
      .optional()
      .meta({ pii: true }),
  }),
});
export type RunAccountActionBody = z.infer<typeof runAccountActionBodySchema>;

/** The public answer: the run it created. */
export const runAccountActionDocumentSchema = z.strictObject({
  data: z.strictObject({ 'workflow-run-id': idSchema('wfr') }),
});
export type RunAccountActionDocument = z.infer<typeof runAccountActionDocumentSchema>;

/** One input of the form, prefilled under the viewer's mask (P38). */
export const accountActionParameterSchema = z.strictObject({
  name: workflowDeclaredNameSchema,
  type: workflowTypeSchema,
  required: z.boolean(),
  'prefilled-value': workflowJsonSchema.nullable().meta({ pii: true }),
});

/** `GET /api/v1/accounts/:id/available-actions` (H14): filtered by the caller's grant. */
export const accountAvailableActionResourceSchema = resourceWithRelationshipsSchema(
  'account-action',
  'accac',
  z.strictObject({
    label: labelSchema,
    /** The parameter form: a PII attribute by name, so this one is not called `parameters`. */
    form: z.array(accountActionParameterSchema),
  }),
  z.strictObject({ workflow: toOneRelationshipSchema(workflowIdentifierSchema) }),
);
export const accountAvailableActionListDocumentSchema = listDocumentSchema(
  accountAvailableActionResourceSchema,
);
export type AccountAvailableActionListDocument = z.infer<
  typeof accountAvailableActionListDocumentSchema
>;

export interface AccountActionRecord {
  id: string;
  workflowId: string;
  accountTypeId: string;
  label: string;
  status: AccountActionStatus;
  prefill: Readonly<Record<string, string>>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Builds the account action resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildAccountActionResource(record: AccountActionRecord): AccountActionResource {
  return accountActionResourceSchema.parse({
    type: 'account-action',
    id: record.id,
    attributes: {
      label: record.label,
      status: record.status,
      prefill: record.prefill,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: record.workflowId } },
      'account-type': { data: { type: 'account-type', id: record.accountTypeId } },
    },
  });
}
