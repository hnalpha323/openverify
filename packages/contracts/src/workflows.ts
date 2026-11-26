/**
 * Workflows, their versions and deployments (plan C112, C116). Workflows belong to one environment,
 * a version is immutable once published, and a version holds configuration only, so `workflows:read`
 * reads all of this and none of it is PII. Runs are `workflow-runs.ts`, because their values are.
 *
 * Routes (frozen by `foundation-8a`, built by `api-workflows`): C112.6. Scopes `workflows:read`,
 * `workflows:write` and `workflows:publish`, and publish, rollout, restore and promote are user-only
 * (C121.2). An event of a version carries no definition.
 */
import {
  WORKFLOW_ACKNOWLEDGEMENT_KINDS,
  WORKFLOW_DEFINITION_LIMITS,
  WORKFLOW_DEPLOYMENT_STATUSES,
  WORKFLOW_KINDS,
  WORKFLOW_PAUSED_REASONS,
  WORKFLOW_ROLLOUT_LABELS,
  WORKFLOW_STATUSES,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VERSION_STATUSES,
  apiScopeSchema,
  workflowDeploymentStatusSchema,
  workflowKindSchema,
  workflowPausedReasonSchema,
  workflowRolloutLabelSchema,
  workflowStatusSchema,
  workflowTriggerTypeSchema,
  workflowVersionStatusSchema,
  type Permission,
  type WorkflowDeploymentStatus,
  type WorkflowKind,
  type WorkflowPausedReason,
  type WorkflowRolloutLabel,
  type WorkflowStatus,
  type WorkflowTriggerType,
  type WorkflowVersionStatus,
} from '@openverify/core';
import { z } from 'zod';
import { actionBodySchema, emptyActionBodySchema, optionalActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceIdentifierSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import {
  WORKFLOW_STEP_ID_PATTERN,
  workflowDeclaredNameSchema,
  workflowDefinitionSchema,
  workflowInputSchema,
  workflowJsonSchema,
  workflowNodeIdSchema,
  type WorkflowDefinition,
} from './workflow-definition.js';

export {
  WORKFLOW_ACKNOWLEDGEMENT_KINDS,
  WORKFLOW_DEFINITION_LIMITS,
  WORKFLOW_DEPLOYMENT_STATUSES,
  WORKFLOW_KINDS,
  WORKFLOW_PAUSED_REASONS,
  WORKFLOW_ROLLOUT_LABELS,
  WORKFLOW_STATUSES,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VERSION_STATUSES,
};

/** C112.3: the most a name and a description hold. */
export const WORKFLOW_NAME_LENGTH = WORKFLOW_DEFINITION_LIMITS['name-length'].value;
export const WORKFLOW_DESCRIPTION_LENGTH = 500;

const nameSchema = z.string().min(1).max(WORKFLOW_NAME_LENGTH);
const descriptionSchema = z.string().max(WORKFLOW_DESCRIPTION_LENGTH);

export const workflowIdentifierSchema = resourceIdentifierSchema('workflow', 'wfl');
export const workflowVersionIdentifierSchema = resourceIdentifierSchema('workflow-version', 'wfv');
export const workflowDeploymentIdentifierSchema = resourceIdentifierSchema(
  'workflow-deployment',
  'wfd',
);

const toOneOrNull = <Identifier extends z.ZodType>(identifier: Identifier) =>
  toOneRelationshipSchema(identifier.nullable());

// ---------------------------------------------------------------------------------------------
// Workflows (C112.3)

interface WorkflowAttributesShape {
  readonly status: WorkflowStatus;
  readonly 'paused-reason': WorkflowPausedReason | null;
  readonly 'archived-at': string | null;
}

export const workflowAttributesSchema = z
  .strictObject({
    name: nameSchema,
    description: descriptionSchema.nullable(),
    status: workflowStatusSchema,
    kind: workflowKindSchema,
    /** Ours (C121.5): what the console's banner says, `null` unless paused. */
    'paused-reason': workflowPausedReasonSchema.nullable(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
    'archived-at': timestampSchema.nullable(),
  })
  .refine(
    (value) => {
      const attributes = value as WorkflowAttributesShape;
      return (attributes.status === 'archived') === (attributes['archived-at'] !== null);
    },
    { message: 'a workflow is archived exactly when it says when', path: ['archived-at'] },
  )
  .refine(
    (value) => {
      const attributes = value as WorkflowAttributesShape;
      return (attributes.status === 'paused') === (attributes['paused-reason'] !== null);
    },
    { message: 'a paused workflow says why, and no other does', path: ['paused-reason'] },
  );

export const workflowRelationshipsSchema = z.strictObject({
  'latest-published-version': toOneOrNull(workflowVersionIdentifierSchema),
  'active-deployment': toOneOrNull(workflowDeploymentIdentifierSchema),
  /** Ours (C112.3): at most one draft (C116.1). */
  'draft-version': toOneOrNull(workflowVersionIdentifierSchema),
});

export const workflowResourceSchema = resourceWithRelationshipsSchema(
  'workflow',
  'wfl',
  workflowAttributesSchema,
  workflowRelationshipsSchema,
);
export type WorkflowResource = z.infer<typeof workflowResourceSchema>;
export const workflowDocumentSchema = singleDocumentSchema(workflowResourceSchema);
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export const workflowListDocumentSchema = listDocumentSchema(workflowResourceSchema);

export const listWorkflowsQuerySchema = listQuerySchema('wfl', {
  'filter[status]': filterListSchema(workflowStatusSchema).optional(),
  'filter[kind]': filterListSchema(workflowKindSchema).optional(),
});

/** `POST /api/v1/workflows`: a draft with an empty definition comes with it. */
export const createWorkflowBodySchema = requestDocumentSchema(
  'workflow',
  z.strictObject({
    name: nameSchema,
    description: descriptionSchema.optional(),
    kind: workflowKindSchema.optional(),
  }),
);
export type CreateWorkflowBody = z.infer<typeof createWorkflowBodySchema>;

/** `PATCH /api/v1/workflows/:id`: the name and description only (C112.6). */
export const updateWorkflowBodySchema = requestDocumentSchema(
  'workflow',
  z
    .strictObject({
      name: nameSchema.optional(),
      description: descriptionSchema.nullable().optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'must change something'),
);
export type UpdateWorkflowBody = z.infer<typeof updateWorkflowBodySchema>;

/** `POST /api/v1/workflows/:id/{pause,activate,archive}` take no parameters. */
export const pauseWorkflowBodySchema = emptyActionBodySchema;
export const activateWorkflowBodySchema = emptyActionBodySchema;
/** Archiving needs a paused workflow first, as in the public product. */
export const archiveWorkflowBodySchema = emptyActionBodySchema;

// ---------------------------------------------------------------------------------------------
// Versions (C112.4)

/** C121.2: API scopes only, frozen at publish. Operator permissions are never part of a grant. */
export const workflowGrantSchema = z.strictObject({
  scopes: z.array(apiScopeSchema),
  pii: z.boolean(),
});
export type WorkflowGrant = z.infer<typeof workflowGrantSchema>;

/** C121.4: a step that sends tainted values off the platform: the paths, never the values. */
export const workflowEgressMarkSchema = z.strictObject({
  'step-id': workflowNodeIdSchema,
  paths: z.array(z.string().min(1).max(512)),
  /** The literal host, or the Slack secret's id, never an address of a person. */
  destination: z.string().min(1).max(255),
});
export type WorkflowEgressMark = z.infer<typeof workflowEgressMarkSchema>;

/** C116.4: `egress:<step id>`, `irreversible:<step id>` and the rest. */
export const workflowAcknowledgementKeySchema = z
  .string()
  .max(64)
  .refine((key) => {
    const separator = key.indexOf(':');
    return (
      (WORKFLOW_ACKNOWLEDGEMENT_KINDS as readonly string[]).includes(key.slice(0, separator)) &&
      WORKFLOW_STEP_ID_PATTERN.test(key.slice(separator + 1))
    );
  }, 'must be an acknowledgement kind and a step id');

/** C116.4: stored on the version with the publisher's id and time. */
export const workflowAcknowledgementSchema = z.strictObject({
  key: workflowAcknowledgementKeySchema,
  'acknowledged-by': idSchema('usr'),
  'acknowledged-at': timestampSchema,
});
export type WorkflowAcknowledgement = z.infer<typeof workflowAcknowledgementSchema>;

/** C113.6: one error or warning. A pointer and a code, and text that never echoes a value (P21). */
export const workflowDefinitionIssueSchema = z.strictObject({
  pointer: z.string().max(512),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case code'),
  detail: z.string().max(500).optional(),
});
export type WorkflowDefinitionIssue = z.infer<typeof workflowDefinitionIssueSchema>;

interface WorkflowVersionAttributesShape {
  readonly status: WorkflowVersionStatus;
  readonly 'published-at': string | null;
}

export const workflowVersionAttributesSchema = z
  .strictObject({
    // Public (C112.4).
    status: workflowVersionStatusSchema,
    /** `null` until a trigger is set. */
    'trigger-type': workflowTriggerTypeSchema.nullable(),
    live: z.boolean(),
    'rollout-label': workflowRolloutLabelSchema.nullable(),
    'rollout-percentage': z.int().min(1).max(100).nullable(),
    /** An OpenVerify id, never an email address (decision 64). */
    'last-updater': z.union([idSchema('usr'), idSchema('key')]).nullable(),
    inputs: z.array(workflowInputSchema.pick({ name: true, type: true, required: true })),
    outputs: z.array(z.strictObject({ name: workflowDeclaredNameSchema })),
    /** The change note; `null` on a draft. */
    description: descriptionSchema.nullable(),
    'published-at': timestampSchema.nullable(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
    // Ours (C112.4).
    'version-number': z.int().min(1),
    'schema-version': z.int().min(1),
    /** C116.1: a draft's optimistic concurrency. */
    'lock-version': z.int().min(0),
    /** `null` in an event only: read it from the version, under `workflows:read`. */
    definition: workflowDefinitionSchema.nullable(),
    'definition-sha256': z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'must be a hex SHA-256')
      .nullable(),
    /** `null` until published (C121.2). */
    grant: workflowGrantSchema.nullable(),
    egress: z.array(workflowEgressMarkSchema),
    acknowledgements: z.array(workflowAcknowledgementSchema),
    warnings: z.array(workflowDefinitionIssueSchema),
    'promoted-from': idSchema('wfv').nullable(),
  })
  .refine(
    (value) => {
      const attributes = value as WorkflowVersionAttributesShape;
      return (attributes.status === 'draft') === (attributes['published-at'] === null);
    },
    { message: 'a version is published exactly when it is no longer a draft', path: ['status'] },
  );

export const workflowVersionRelationshipsSchema = z.strictObject({
  workflow: toOneRelationshipSchema(workflowIdentifierSchema),
});

export const workflowVersionResourceSchema = resourceWithRelationshipsSchema(
  'workflow-version',
  'wfv',
  workflowVersionAttributesSchema,
  workflowVersionRelationshipsSchema,
);
export type WorkflowVersionResource = z.infer<typeof workflowVersionResourceSchema>;
export const workflowVersionDocumentSchema = singleDocumentSchema(workflowVersionResourceSchema);
export type WorkflowVersionDocument = z.infer<typeof workflowVersionDocumentSchema>;
export const workflowVersionListDocumentSchema = listDocumentSchema(workflowVersionResourceSchema);

/** `GET /workflow-versions`: the filter is required, and archived versions are never listed. */
export const listWorkflowVersionsQuerySchema = listQuerySchema('wfv', {
  'filter[workflow-id]': idSchema('wfl'),
});

/** `PUT /api/v1/workflows/:id/draft`: replaces the definition (C116.1). */
export const putWorkflowDraftBodySchema = requestDocumentSchema(
  'workflow-version',
  z.strictObject({ definition: workflowDefinitionSchema, 'lock-version': z.int().min(0) }),
);
export type PutWorkflowDraftBody = z.infer<typeof putWorkflowDraftBodySchema>;

/**
 * `POST /api/v1/workflows/:id/draft/validate`: checks the given definition, or the stored draft, and
 * saves nothing. The definition is read loosely here, so a schema failure comes back as `errors`
 * with its pointers rather than as a bad request.
 */
export const validateWorkflowDraftBodySchema = z
  .strictObject({
    data: z.strictObject({
      type: z.literal('workflow-version').optional(),
      attributes: z.strictObject({ definition: workflowJsonSchema }),
    }),
  })
  .optional();
export type ValidateWorkflowDraftBody = z.infer<typeof validateWorkflowDraftBodySchema>;

/** C113.6: the check's answer: errors and warnings together, and warnings never block publish. */
export const workflowDefinitionCheckDocumentSchema = z.strictObject({
  meta: z.strictObject({
    valid: z.boolean(),
    errors: z.array(workflowDefinitionIssueSchema),
    warnings: z.array(workflowDefinitionIssueSchema),
  }),
});
export type WorkflowDefinitionCheckDocument = z.infer<typeof workflowDefinitionCheckDocumentSchema>;

/** `POST /api/v1/workflows/:id/publish` (C116.4). */
export const publishWorkflowBodySchema = optionalActionBodySchema(
  z.strictObject({
    'rollout-percentage': z.int().min(1).max(100).optional(),
    description: descriptionSchema.optional(),
    acknowledgements: z.array(workflowAcknowledgementKeySchema).max(400).optional(),
  }),
);
export type PublishWorkflowBody = z.infer<typeof publishWorkflowBodySchema>;

/** `POST /api/v1/workflows/:id/rollout`: 100 finishes, 0 undoes (C116.3). */
export const rolloutWorkflowBodySchema = actionBodySchema(
  z.strictObject({ 'rollout-percentage': z.int().min(0).max(100) }),
);
export type RolloutWorkflowBody = z.infer<typeof rolloutWorkflowBodySchema>;

/** `POST /api/v1/workflows/:id/restore`: creates a draft from that version (decision 19). */
export const restoreWorkflowBodySchema = actionBodySchema(
  z.strictObject({ 'version-id': idSchema('wfv') }),
);
export type RestoreWorkflowBody = z.infer<typeof restoreWorkflowBodySchema>;

/** `POST /api/v1/workflows/:id/promote` (C112.2): a draft in the target environment. */
export const promoteWorkflowBodySchema = actionBodySchema(
  z.strictObject({ 'environment-id': idSchema('env') }),
);
export type PromoteWorkflowBody = z.infer<typeof promoteWorkflowBodySchema>;

/** `GET /api/v1/workflow-versions/:id/diff?against=<wfv_>`. */
export const workflowVersionDiffQuerySchema = z.strictObject({ against: idSchema('wfv') });

/** C116.6: one change, as definitions hold configuration and never subject data. */
export const workflowDefinitionChangeSchema = z.strictObject({
  pointer: z.string().max(512),
  before: workflowJsonSchema,
  after: workflowJsonSchema,
});

const nodeIds = z.array(workflowNodeIdSchema);

/** C116.6: the diff, keyed by step id, with layout-only changes apart. */
export const workflowVersionDiffAttributesSchema = z.strictObject({
  'against-version-id': idSchema('wfv'),
  steps: z.strictObject({
    added: nodeIds,
    removed: nodeIds,
    changed: z.array(
      z.strictObject({
        id: workflowNodeIdSchema,
        changes: z.array(workflowDefinitionChangeSchema),
      }),
    ),
  }),
  edges: z.strictObject({ added: z.array(z.string()), removed: z.array(z.string()) }),
  'trigger-changes': z.array(workflowDefinitionChangeSchema),
  'input-changes': z.array(workflowDefinitionChangeSchema),
  'output-changes': z.array(workflowDefinitionChangeSchema),
  'variable-changes': z.array(workflowDefinitionChangeSchema),
  /** The nodes that only moved. */
  'layout-changes': nodeIds,
});

/** Its id is the version's, as an account's graph component's is the account's. */
export const workflowVersionDiffDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('workflow-version-diff'),
    id: idSchema('wfv'),
    attributes: workflowVersionDiffAttributesSchema,
  }),
);
export type WorkflowVersionDiffDocument = z.infer<typeof workflowVersionDiffDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// Deployments (C116.3)

export const workflowDeploymentVersionSchema = z.strictObject({
  token: idSchema('wfv'),
  percentage: z.int().min(1).max(100),
  label: workflowRolloutLabelSchema,
});

export const workflowDeploymentResourceSchema = resourceWithRelationshipsSchema(
  'workflow-deployment',
  'wfd',
  z.strictObject({
    status: workflowDeploymentStatusSchema,
    configuration: z.strictObject({ versions: z.array(workflowDeploymentVersionSchema) }),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
  z.strictObject({ workflow: toOneRelationshipSchema(workflowIdentifierSchema) }),
);
export type WorkflowDeploymentResource = z.infer<typeof workflowDeploymentResourceSchema>;
export const workflowDeploymentDocumentSchema = singleDocumentSchema(
  workflowDeploymentResourceSchema,
);

/** C143.6: what `GET /api/v1/workflows/:id` can include (public since 2025-06-23). */
export const WORKFLOW_INCLUDES = ['latest-published-version', 'active-deployment'] as const;
export const workflowIncludeSchema = z.enum(WORKFLOW_INCLUDES);
export type WorkflowInclude = z.infer<typeof workflowIncludeSchema>;

/** C143.6: each include is a definition or a rollout, both read with `workflows:read`. */
export const WORKFLOW_INCLUDE_PERMISSIONS: Readonly<
  Record<WorkflowInclude, readonly Permission[]>
> = Object.freeze({
  'latest-published-version': ['workflows:read'],
  'active-deployment': ['workflows:read'],
});

export const getWorkflowQuerySchema = z.strictObject({
  include: filterListSchema(workflowIncludeSchema, WORKFLOW_INCLUDES.length).optional(),
});

export const workflowIncludeDocumentSchema = z.strictObject({
  data: workflowResourceSchema,
  included: z
    .array(
      z.discriminatedUnion('type', [
        workflowVersionResourceSchema,
        workflowDeploymentResourceSchema,
      ]),
    )
    .optional(),
});
export type WorkflowIncludeDocument = z.infer<typeof workflowIncludeDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// Builders

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  kind: WorkflowKind;
  pausedReason: WorkflowPausedReason | null;
  latestPublishedVersionId: string | null;
  activeDeploymentId: string | null;
  draftVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

const linkTo = <const Type extends string>(type: Type, id: string | null) => ({
  data: id === null ? null : { type, id },
});

/**
 * Builds the workflow resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWorkflowResource(record: WorkflowRecord): WorkflowResource {
  return workflowResourceSchema.parse({
    type: 'workflow',
    id: record.id,
    attributes: {
      name: record.name,
      description: record.description,
      status: record.status,
      kind: record.kind,
      'paused-reason': record.pausedReason,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'archived-at': toNullableTimestamp(record.archivedAt),
    },
    relationships: {
      'latest-published-version': linkTo('workflow-version', record.latestPublishedVersionId),
      'active-deployment': linkTo('workflow-deployment', record.activeDeploymentId),
      'draft-version': linkTo('workflow-version', record.draftVersionId),
    },
  });
}

export interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  status: WorkflowVersionStatus;
  triggerType: WorkflowTriggerType | null;
  live: boolean;
  rolloutLabel: WorkflowRolloutLabel | null;
  rolloutPercentage: number | null;
  lastUpdater: string | null;
  description: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  versionNumber: number;
  schemaVersion: number;
  lockVersion: number;
  /** `null` in an event. */
  definition: WorkflowDefinition | null;
  /** The declared inputs and outputs, which an event keeps when it drops the definition. */
  inputs: readonly { name: string; type: string; required: boolean }[];
  outputs: readonly { name: string }[];
  definitionSha256: string | null;
  grant: WorkflowGrant | null;
  egress: readonly WorkflowEgressMark[];
  acknowledgements: readonly WorkflowAcknowledgement[];
  warnings: readonly WorkflowDefinitionIssue[];
  promotedFrom: string | null;
}

/**
 * Builds the version resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWorkflowVersionResource(
  record: WorkflowVersionRecord,
): WorkflowVersionResource {
  return workflowVersionResourceSchema.parse({
    type: 'workflow-version',
    id: record.id,
    attributes: {
      status: record.status,
      'trigger-type': record.triggerType,
      live: record.live,
      'rollout-label': record.rolloutLabel,
      'rollout-percentage': record.rolloutPercentage,
      'last-updater': record.lastUpdater,
      inputs: record.inputs,
      outputs: record.outputs,
      description: record.description,
      'published-at': toNullableTimestamp(record.publishedAt),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'version-number': record.versionNumber,
      'schema-version': record.schemaVersion,
      'lock-version': record.lockVersion,
      definition: record.definition,
      'definition-sha256': record.definitionSha256,
      grant: record.grant,
      egress: record.egress,
      acknowledgements: record.acknowledgements,
      warnings: record.warnings,
      'promoted-from': record.promotedFrom,
    },
    relationships: { workflow: { data: { type: 'workflow', id: record.workflowId } } },
  });
}

export interface WorkflowDeploymentRecord {
  id: string;
  workflowId: string;
  status: WorkflowDeploymentStatus;
  versions: readonly z.infer<typeof workflowDeploymentVersionSchema>[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Builds the deployment resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWorkflowDeploymentResource(
  record: WorkflowDeploymentRecord,
): WorkflowDeploymentResource {
  return workflowDeploymentResourceSchema.parse({
    type: 'workflow-deployment',
    id: record.id,
    attributes: {
      status: record.status,
      configuration: { versions: record.versions },
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
    relationships: { workflow: { data: { type: 'workflow', id: record.workflowId } } },
  });
}
