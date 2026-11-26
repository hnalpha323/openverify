/**
 * Case templates (plan C130): environment-scoped, each with a key that prefixes its cases' names, and
 * immutable versions that a case pins (decision 53; the public templates have none). A version holds
 * the Phase 7 field-schema union without `file` and `json` (F37), the statuses in the public
 * categories (decision 54), resolutions, the transition map, the queue, policy and SLA it starts with,
 * what a case may hold, the attachment policy, who is told of a new case and the default modules.
 *
 * A template holds configuration, never a subject's data, so nothing here is PII. A status, a label
 * or a resolution is an operator's word, and the docs say not to put a person's data in one.
 *
 * Routes (frozen by `foundation-8b`, built by `api-cases`): `GET`, `POST /case-templates`, `GET`,
 * `PATCH /case-templates/:id`, `POST /case-templates/:id/archive`, `GET`, `POST
 * /case-template-versions`, `GET`, `PATCH /case-template-versions/:id` and `POST
 * /case-template-versions/:id/publish`, under `case-templates:read`, `:write` and `:publish`.
 */
import {
  CASE_LIMITS,
  CASE_STATUS_KEY_PATTERN,
  CASE_TEMPLATE_KEY_PATTERN,
  TRANSACTION_LIMITS,
  caseAttachmentTypeSchema,
  caseFieldTypeProblems,
  caseHeldObjectTypeSchema,
  caseLayoutModuleSchema,
  caseSlaStartsOnSchema,
  caseStatusCategorySchema,
  caseTemplateStatusSchema,
  caseTemplateVersionStatusSchema,
  fieldSchemaSchema,
  permissionSchema,
  type CaseAttachmentType,
  type CaseHeldObjectType,
  type CaseLayoutModule,
  type CaseLimit,
  type CaseSlaStartsOn,
  type CaseStatusCategory,
  type CaseTemplateStatus,
  type CaseTemplateVersionStatus,
  type FieldSchema,
  type Permission,
} from '@openverify/core';
import { z } from 'zod';
import { emptyActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceIdentifierSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

export const caseLimit = (name: CaseLimit): number => CASE_LIMITS[name].value;

export const caseTemplateIdentifierSchema = resourceIdentifierSchema('case-template', 'ctmpl');
export const caseTemplateVersionIdentifierSchema = resourceIdentifierSchema(
  'case-template-version',
  'ctmplv',
);

const nameSchema = z.string().min(1).max(caseLimit('template-name-characters'));

/** C130.1: the prefix of a case's name; it never changes. */
export const caseTemplateKeySchema = z
  .string()
  .regex(CASE_TEMPLATE_KEY_PATTERN, 'must be 2 to 10 capitals and digits, starting with a capital');

const rolesSchema = z
  .array(idSchema('role'))
  .max(caseLimit('visible-to-roles'))
  .refine(hasDistinctValues, 'must not contain duplicates');

// ---------------------------------------------------------------------------------------------
// What a version holds (C130.2)

/** C130.2: a status's key, what `meta.status` and a case's `status` hold. */
export const caseStatusKeySchema = z
  .string()
  .min(1)
  .max(caseLimit('status-key-characters'))
  .regex(CASE_STATUS_KEY_PATTERN, 'must be lower case letters, digits, _ or -');

const labelSchema = z.string().min(1).max(caseLimit('status-label-characters'));

export const caseResolutionSchema = z.string().min(1).max(caseLimit('resolution-characters'));

export const caseStatusTagSchema = z.strictObject({ key: caseStatusKeySchema, label: labelSchema });

/** C130.2 (decision 54). */
export const caseStatusDefinitionSchema = z.strictObject({
  key: caseStatusKeySchema,
  label: labelSchema,
  category: caseStatusCategorySchema,
  'pauses-sla': z.boolean(),
  'required-comment': z.boolean(),
  'status-tags': z.array(caseStatusTagSchema).max(caseLimit('status-tags')),
  'status-tag-required': z.boolean(),
  /**
   * C172.3 (Workflow 9B; the public status-switcher rule): the field keys that must hold a value
   * before a case enters this status (422 `case_fields_required`). Left out by earlier servers.
   */
  'requires-fields': z
    .array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/))
    .max(50)
    .refine(hasDistinctValues, 'must not repeat a field')
    .optional(),
});
export type CaseStatusDefinitionResource = z.infer<typeof caseStatusDefinitionSchema>;

const fieldSchemasSchema = z
  .array(fieldSchemaSchema)
  .max(TRANSACTION_LIMITS.fieldsPerVersion)
  .refine(
    (fields) => caseFieldTypeProblems(fields).length === 0,
    'a case field is never a file or json: attachments carry files (C130.2)',
  );

const resolutionsSchema = z
  .array(caseResolutionSchema)
  .max(caseLimit('resolutions'))
  .refine(hasDistinctValues, 'must not contain duplicates');

const heldObjectTypesSchema = z
  .array(caseHeldObjectTypeSchema)
  .refine(hasDistinctValues, 'must not contain duplicates');

/** C130.2: `max-files` is at most 20, and `types` a subset of the four (decision 62). */
export const caseAttachmentPolicySchema = z.strictObject({
  'max-files': z.int().min(0).max(caseLimit('attachments-per-case')),
  types: z.array(caseAttachmentTypeSchema).refine(hasDistinctValues, 'must not repeat a type'),
});
export type CaseAttachmentPolicy = z.infer<typeof caseAttachmentPolicySchema>;

/** C130.2, C142.2: a default module, and what a reader needs to see it. */
export const caseLayoutModuleEntrySchema = z.strictObject({
  key: caseLayoutModuleSchema,
  'required-permissions': z.array(permissionSchema),
});
export type CaseLayoutModuleEntry = z.infer<typeof caseLayoutModuleEntrySchema>;

/**
 * C172.1 (Workflow 9B; Phase 8 decision 70): the case page's layout over `layout-modules`: one to
 * three columns, each module once, in a column of the layout, ordered within it.
 */
export const caseLayoutSchema = z
  .strictObject({
    columns: z.int().min(1).max(3),
    modules: z
      .array(
        z.strictObject({
          key: caseLayoutModuleSchema,
          column: z.int().min(1).max(3),
          order: z.int().min(0).max(99),
          collapsed: z.boolean(),
        }),
      )
      .max(13),
  })
  .refine((layout) => layout.modules.every((module) => module.column <= layout.columns), {
    message: 'puts every module in a column of the layout',
    path: ['modules'],
  })
  .refine((layout) => hasDistinctValues(layout.modules.map(({ key }) => key)), {
    message: 'must not repeat a module',
    path: ['modules'],
  });
export type CaseLayout = z.infer<typeof caseLayoutSchema>;

const checklistKeySchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/**
 * C172.2 (Workflow 9B): checklists, each item naming the statuses an unchecked item refuses to
 * enter (422 `case_checklist_incomplete`).
 */
export const caseChecklistsSchema = z
  .array(
    z.strictObject({
      key: checklistKeySchema,
      label: z.string().trim().min(1).max(100),
      items: z
        .array(
          z.strictObject({
            key: checklistKeySchema,
            label: z.string().trim().min(1).max(200),
            'required-for-statuses': z.array(caseStatusKeySchema).max(20),
          }),
        )
        .min(1)
        .max(50)
        .refine(
          (items) => hasDistinctValues(items.map(({ key }) => key)),
          'must not repeat an item',
        ),
    }),
  )
  .max(10)
  .refine(
    (checklists) => hasDistinctValues(checklists.map(({ key }) => key)),
    'must not repeat a checklist',
  );
export type CaseChecklists = z.infer<typeof caseChecklistsSchema>;

/**
 * C172.4 (Workflow 9B): comments an operator inserts and edits before posting; plain text, at most
 * 2,000 characters, no placeholder, never posted by themselves.
 */
export const casePresetCommentsSchema = z
  .array(
    z.strictObject({
      key: checklistKeySchema,
      label: z.string().trim().min(1).max(100),
      text: z
        .string()
        .min(1)
        .max(2000)
        .refine((text) => !/\{[^}]*\}/u.test(text), 'must not hold a placeholder'),
    }),
  )
  .max(50)
  .refine((comments) => hasDistinctValues(comments.map(({ key }) => key)), 'must not repeat a key');
export type CasePresetComments = z.infer<typeof casePresetCommentsSchema>;

const layoutModulesSchema = z
  .array(caseLayoutModuleEntrySchema)
  .refine(
    (modules) => hasDistinctValues(modules.map(({ key }) => key)),
    'must not repeat a module',
  );

const notifySchema = z
  .array(idSchema('usr'))
  .max(caseLimit('notify-on-create'))
  .refine(hasDistinctValues, 'must not contain duplicates');

const transitionsSchema = z.record(caseStatusKeySchema, z.array(caseStatusKeySchema));

/** Exactly one `initial`, at least one `end`, distinct keys; publish adds what needs a walk. */
function statusesFit(statuses: readonly { key: string; category: CaseStatusCategory }[]): boolean {
  return (
    hasDistinctValues(statuses.map(({ key }) => key)) &&
    statuses.filter(({ category }) => category === 'initial').length === 1 &&
    statuses.some(({ category }) => category === 'end')
  );
}

const statusesSchema = z
  .array(caseStatusDefinitionSchema)
  .min(2)
  .max(caseLimit('statuses'))
  .refine(statusesFit, 'needs distinct keys, exactly one initial status and at least one end');

/** Every key the map names is a status of the version. */
function transitionsFit(attributes: {
  readonly statuses?: readonly { key: string }[] | undefined;
  readonly transitions?: Readonly<Record<string, readonly string[]>> | undefined;
}): boolean {
  const { statuses, transitions } = attributes;
  if (statuses === undefined || transitions === undefined) {
    return true;
  }
  const keys = new Set(statuses.map(({ key }) => key));
  return Object.entries(transitions).every(
    ([from, to]) => keys.has(from) && to.every((key) => keys.has(key)),
  );
}

const TRANSITIONS_RULE = {
  message: 'names a status the version does not hold',
  path: ['transitions'],
};

const VERSION_ATTRIBUTES = {
  'field-schemas': fieldSchemasSchema,
  statuses: statusesSchema,
  resolutions: resolutionsSchema,
  transitions: transitionsSchema,
  'default-queue-id': idSchema('cqueue').nullable(),
  'assignment-policy-id': idSchema('cap').nullable(),
  'sla-policy-id': idSchema('cslap').nullable(),
  'sla-starts-on': caseSlaStartsOnSchema,
  'held-object-types': heldObjectTypesSchema,
  'attachment-policy': caseAttachmentPolicySchema,
  'notify-on-create': notifySchema,
  'layout-modules': layoutModulesSchema,
  // C172.1, C172.2, C172.4 (Workflow 9B): optional, since earlier servers send none.
  layout: caseLayoutSchema.nullable().optional(),
  checklists: caseChecklistsSchema.optional(),
  'preset-comments': casePresetCommentsSchema.optional(),
};

// ---------------------------------------------------------------------------------------------
// Templates (C130.1, C129.3)

/** C129.3: public attributes, then ours; `field-schemas` and `resolutions` are the published one's. */
export const caseTemplateAttributesSchema = z.strictObject({
  status: caseTemplateStatusSchema,
  name: nameSchema,
  resolutions: resolutionsSchema,
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'archived-at': timestampSchema.nullable(),
  'field-schemas': fieldSchemasSchema,
  key: caseTemplateKeySchema,
  /** Role ids; empty means every role with `cases:read` (C130.1). */
  'visible-to-roles': rolesSchema,
  /** `null` until a version is published. */
  'published-version': z.int().min(1).nullable(),
  /** `null` when no draft is open. */
  'draft-version': z.int().min(1).nullable(),
});

export const caseTemplateRelationshipsSchema = z.strictObject({
  'published-version': z.strictObject({ data: caseTemplateVersionIdentifierSchema.nullable() }),
  'draft-version': z.strictObject({ data: caseTemplateVersionIdentifierSchema.nullable() }),
});

export const caseTemplateResourceSchema = resourceWithRelationshipsSchema(
  'case-template',
  'ctmpl',
  caseTemplateAttributesSchema,
  caseTemplateRelationshipsSchema,
);
export type CaseTemplateResource = z.infer<typeof caseTemplateResourceSchema>;
export const caseTemplateDocumentSchema = singleDocumentSchema(caseTemplateResourceSchema);
export type CaseTemplateDocument = z.infer<typeof caseTemplateDocumentSchema>;
export const caseTemplateListDocumentSchema = listDocumentSchema(caseTemplateResourceSchema);
export type CaseTemplateListDocument = z.infer<typeof caseTemplateListDocumentSchema>;

export const listCaseTemplatesQuerySchema = listQuerySchema('ctmpl', {
  'filter[status]': filterListSchema(caseTemplateStatusSchema).optional(),
  'filter[key]': filterListSchema(caseTemplateKeySchema).optional(),
});

const OPTIONAL_VERSION_ATTRIBUTES = {
  'field-schemas': fieldSchemasSchema.optional(),
  statuses: statusesSchema.optional(),
  resolutions: resolutionsSchema.optional(),
  transitions: transitionsSchema.optional(),
  'default-queue-id': idSchema('cqueue').nullable().optional(),
  'assignment-policy-id': idSchema('cap').nullable().optional(),
  'sla-policy-id': idSchema('cslap').nullable().optional(),
  'sla-starts-on': caseSlaStartsOnSchema.optional(),
  'held-object-types': heldObjectTypesSchema.optional(),
  'attachment-policy': caseAttachmentPolicySchema.optional(),
  'notify-on-create': notifySchema.optional(),
  'layout-modules': layoutModulesSchema.optional(),
  // C172.1, C172.2, C172.4 (Workflow 9B).
  layout: caseLayoutSchema.nullable().optional(),
  checklists: caseChecklistsSchema.optional(),
  'preset-comments': casePresetCommentsSchema.optional(),
};

/**
 * `POST /api/v1/case-templates` (`case-templates:write`): a first draft comes with it, holding the
 * defaults (C130.2) unless these say otherwise.
 */
export const createCaseTemplateBodySchema = requestDocumentSchema(
  'case-template',
  z
    .strictObject({
      name: nameSchema,
      key: caseTemplateKeySchema,
      'visible-to-roles': rolesSchema.optional(),
      ...OPTIONAL_VERSION_ATTRIBUTES,
    })
    .refine(transitionsFit, TRANSITIONS_RULE),
);
export type CreateCaseTemplateBody = z.infer<typeof createCaseTemplateBodySchema>;

/** `PATCH /api/v1/case-templates/:id`: what is the template's rather than a version's. */
export const updateCaseTemplateBodySchema = requestDocumentSchema(
  'case-template',
  z
    .strictObject({ name: nameSchema.optional(), 'visible-to-roles': rolesSchema.optional() })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateCaseTemplateBody = z.infer<typeof updateCaseTemplateBodySchema>;

/** `POST /api/v1/case-templates/:id/archive`: refuses new cases and keeps existing ones (C130.1). */
export const archiveCaseTemplateBodySchema = emptyActionBodySchema;

// ---------------------------------------------------------------------------------------------
// Versions (C130.2)

export const caseTemplateVersionAttributesSchema = z
  .strictObject({
    'version-number': z.int().min(1),
    status: caseTemplateVersionStatusSchema,
    ...VERSION_ATTRIBUTES,
    'created-at': timestampSchema,
    'published-at': timestampSchema.nullable(),
  })
  .refine(transitionsFit, TRANSITIONS_RULE)
  .refine(
    (attributes) => (attributes.status === 'draft') === (attributes['published-at'] === null),
    { message: 'a version is published exactly when it is no longer a draft', path: ['status'] },
  );

export const caseTemplateVersionRelationshipsSchema = z.strictObject({
  'case-template': z.strictObject({ data: caseTemplateIdentifierSchema }),
});

export const caseTemplateVersionResourceSchema = resourceWithRelationshipsSchema(
  'case-template-version',
  'ctmplv',
  caseTemplateVersionAttributesSchema,
  caseTemplateVersionRelationshipsSchema,
);
export type CaseTemplateVersionResource = z.infer<typeof caseTemplateVersionResourceSchema>;
export const caseTemplateVersionDocumentSchema = singleDocumentSchema(
  caseTemplateVersionResourceSchema,
);
export type CaseTemplateVersionDocument = z.infer<typeof caseTemplateVersionDocumentSchema>;
export const caseTemplateVersionListDocumentSchema = listDocumentSchema(
  caseTemplateVersionResourceSchema,
);
export type CaseTemplateVersionListDocument = z.infer<typeof caseTemplateVersionListDocumentSchema>;

/** Owner decision 7 after 7B: `GET /api/v1/case-template-versions`, newest first. */
export const listCaseTemplateVersionsQuerySchema = listQuerySchema('ctmplv', {
  'filter[case-template-id]': filterListSchema(idSchema('ctmpl')).optional(),
});

/** `POST /api/v1/case-template-versions`: a draft from the latest version; members replace. */
export const createCaseTemplateVersionBodySchema = requestDocumentSchema(
  'case-template-version',
  z
    .strictObject({ 'case-template-id': idSchema('ctmpl'), ...OPTIONAL_VERSION_ATTRIBUTES })
    .refine(transitionsFit, TRANSITIONS_RULE),
);
export type CreateCaseTemplateVersionBody = z.infer<typeof createCaseTemplateVersionBodySchema>;

/** `PATCH /api/v1/case-template-versions/:id` (drafts only). */
export const updateCaseTemplateVersionBodySchema = requestDocumentSchema(
  'case-template-version',
  z
    .strictObject(OPTIONAL_VERSION_ATTRIBUTES)
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update')
    .refine(transitionsFit, TRANSITIONS_RULE),
);
export type UpdateCaseTemplateVersionBody = z.infer<typeof updateCaseTemplateVersionBodySchema>;

/** `POST /api/v1/case-template-versions/:id/publish` (`case-templates:publish`). */
export const publishCaseTemplateVersionBodySchema = emptyActionBodySchema;

/** C130.3, H29: `payload.meta` of `case-template.deleted-field`. */
export const caseTemplateDeletedFieldMetaSchema = z.strictObject({
  'field-key': z.string().min(1).max(200),
  'version-number': z.int().min(1),
});

// ---------------------------------------------------------------------------------------------
// Builders

export interface CaseTemplateRecord {
  id: string;
  name: string;
  key: string;
  status: CaseTemplateStatus;
  visibleToRoles: readonly string[];
  resolutions: readonly string[];
  fieldSchemas: readonly FieldSchema[];
  publishedVersion: number | null;
  publishedVersionId: string | null;
  draftVersion: number | null;
  draftVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

const versionIdentifier = (id: string | null) =>
  id === null ? null : { type: 'case-template-version', id };

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseTemplateResource(record: CaseTemplateRecord): CaseTemplateResource {
  return caseTemplateResourceSchema.parse({
    type: 'case-template',
    id: record.id,
    attributes: {
      status: record.status,
      name: record.name,
      resolutions: record.resolutions,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'archived-at': toNullableTimestamp(record.archivedAt),
      'field-schemas': record.fieldSchemas,
      key: record.key,
      'visible-to-roles': record.visibleToRoles,
      'published-version': record.publishedVersion,
      'draft-version': record.draftVersion,
    },
    relationships: {
      'published-version': { data: versionIdentifier(record.publishedVersionId) },
      'draft-version': { data: versionIdentifier(record.draftVersionId) },
    },
  });
}

export interface CaseTemplateVersionRecord {
  id: string;
  caseTemplateId: string;
  versionNumber: number;
  status: CaseTemplateVersionStatus;
  fieldSchemas: readonly FieldSchema[];
  statuses: readonly CaseStatusDefinitionResource[];
  resolutions: readonly string[];
  transitions: Readonly<Record<string, readonly string[]>>;
  defaultQueueId: string | null;
  assignmentPolicyId: string | null;
  slaPolicyId: string | null;
  slaStartsOn: CaseSlaStartsOn;
  heldObjectTypes: readonly CaseHeldObjectType[];
  attachmentPolicy: { 'max-files': number; types: readonly CaseAttachmentType[] };
  notifyOnCreate: readonly string[];
  layoutModules: readonly {
    key: CaseLayoutModule;
    'required-permissions': readonly Permission[];
  }[];
  /** C172.1, C172.2, C172.4 (Workflow 9B). Each left out is not sent. */
  layout?: CaseLayout | null;
  checklists?: CaseChecklists;
  presetComments?: CasePresetComments;
  createdAt: Date;
  publishedAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseTemplateVersionResource(
  record: CaseTemplateVersionRecord,
): CaseTemplateVersionResource {
  return caseTemplateVersionResourceSchema.parse({
    type: 'case-template-version',
    id: record.id,
    attributes: {
      'version-number': record.versionNumber,
      status: record.status,
      'field-schemas': record.fieldSchemas,
      statuses: record.statuses,
      resolutions: record.resolutions,
      transitions: record.transitions,
      'default-queue-id': record.defaultQueueId,
      'assignment-policy-id': record.assignmentPolicyId,
      'sla-policy-id': record.slaPolicyId,
      'sla-starts-on': record.slaStartsOn,
      'held-object-types': record.heldObjectTypes,
      'attachment-policy': record.attachmentPolicy,
      'notify-on-create': record.notifyOnCreate,
      'layout-modules': record.layoutModules,
      ...(record.layout === undefined ? {} : { layout: record.layout }),
      ...(record.checklists === undefined ? {} : { checklists: record.checklists }),
      ...(record.presetComments === undefined ? {} : { 'preset-comments': record.presetComments }),
      'created-at': toTimestamp(record.createdAt),
      'published-at': toNullableTimestamp(record.publishedAt),
    },
    relationships: {
      'case-template': { data: { type: 'case-template', id: record.caseTemplateId } },
    },
  });
}
