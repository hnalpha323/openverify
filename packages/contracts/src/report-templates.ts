/**
 * Report templates and versions (plan C71): a template is one report type's saved configuration;
 * versions are drafted, then published, superseding the published one. Creating a template
 * publishes version 1. A report pins the version it was created from (`report-template-version`
 * and `report-template-version-name`), so a template change applies to new reports only.
 *
 * Unlike the public templates, ours are versioned and have an API (decision 26); a template is a
 * `report-template` of one `report-type` (not a `report-template/<type>`).
 */
import { REPORT_TYPES, reportTypeSchema, type ReportType } from '@openverify/core';
import { z } from 'zod';
import { emptyActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import { reportTemplateIdentifierSchema } from './identifiers.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import {
  REPORT_TEMPLATE_CONFIG_SCHEMAS,
  RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS,
  resolveReportTemplateConfig,
} from './report-template-config.js';

/** `active` templates create reports; an `archived` one answers 422 `report_template_not_published`. */
export const REPORT_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export const reportTemplateStatusSchema = z.enum(REPORT_TEMPLATE_STATUSES);
export type ReportTemplateStatus = z.infer<typeof reportTemplateStatusSchema>;

export const REPORT_TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export const reportTemplateVersionStatusSchema = z.enum(REPORT_TEMPLATE_VERSION_STATUSES);
export type ReportTemplateVersionStatus = z.infer<typeof reportTemplateVersionStatusSchema>;

export const reportTemplateNameSchema = z.string().min(1).max(200);

/** One variant per type, discriminated by `report-type`. */
function perType<Shape extends z.ZodRawShape>(
  shapeOf: (type: ReportType, config: z.ZodType) => Shape,
  configs: Readonly<Record<ReportType, z.ZodType>>,
) {
  const [first, ...rest] = REPORT_TYPES.map((type) =>
    z.strictObject({ 'report-type': z.literal(type), ...shapeOf(type, configs[type]) }),
  );
  if (first === undefined) {
    throw new TypeError('no report type');
  }
  return z.discriminatedUnion('report-type', [first, ...rest]);
}

/** The template's published version, embedded in the template (as an inquiry template's is). */
const currentVersionShape = (config: z.ZodType) => ({
  'current-version': z.strictObject({
    id: idSchema('rptpv'),
    'version-number': z.int().min(1),
    /** Resolved: the defaults apply to what the version leaves out. */
    config,
    'created-at': timestampSchema,
    'published-at': timestampSchema,
  }),
});

export const reportTemplateAttributesSchema = perType(
  (_type, config) => ({
    name: reportTemplateNameSchema,
    status: reportTemplateStatusSchema,
    ...currentVersionShape(config),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
  RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS,
);

export const reportTemplateResourceSchema = resourceSchema(
  'report-template',
  'rptp',
  reportTemplateAttributesSchema,
);
export type ReportTemplateResource = z.infer<typeof reportTemplateResourceSchema>;
export const reportTemplateDocumentSchema = singleDocumentSchema(reportTemplateResourceSchema);
export const reportTemplateListDocumentSchema = listDocumentSchema(reportTemplateResourceSchema);

export const reportTemplateVersionAttributesSchema = perType(
  (_type, config) => ({
    'version-number': z.int().min(1),
    status: reportTemplateVersionStatusSchema,
    config,
    'created-at': timestampSchema,
    /** Null while the version is a draft. */
    'published-at': timestampSchema.nullable(),
  }),
  RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS,
).refine(
  (attributes) => (attributes.status === 'draft') === (attributes['published-at'] === null),
  {
    message: 'a version has a publication time exactly when it was published',
    path: ['published-at'],
  },
);

export const reportTemplateVersionResourceSchema = resourceWithRelationshipsSchema(
  'report-template-version',
  'rptpv',
  reportTemplateVersionAttributesSchema,
  z.strictObject({ 'report-template': z.strictObject({ data: reportTemplateIdentifierSchema }) }),
);
export type ReportTemplateVersionResource = z.infer<typeof reportTemplateVersionResourceSchema>;
export const reportTemplateVersionDocumentSchema = singleDocumentSchema(
  reportTemplateVersionResourceSchema,
);
export const reportTemplateVersionListDocumentSchema = listDocumentSchema(
  reportTemplateVersionResourceSchema,
);

/**
 * `POST /api/v1/report-templates` (scope `report-templates:write`): a template of one type and its
 * version 1, published. The configuration is checked against the type; the source lists left out
 * are resolved and pinned (C71.2).
 */
export const createReportTemplateBodySchema = requestDocumentSchema(
  'report-template',
  perType(
    (_type, config) => ({ name: reportTemplateNameSchema, config: config.optional() }),
    REPORT_TEMPLATE_CONFIG_SCHEMAS,
  ),
);
export type CreateReportTemplateBody = z.infer<typeof createReportTemplateBodySchema>;

/** `PATCH /api/v1/report-templates/:id`: the name or the status. */
export const updateReportTemplateBodySchema = requestDocumentSchema(
  'report-template',
  z
    .strictObject({
      name: reportTemplateNameSchema.optional(),
      status: reportTemplateStatusSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);

/**
 * A version's configuration as sent. Its type is the template's, which the body does not name, so
 * the service checks it with `reportTemplateConfigSchema(type)` and answers 422 with pointers.
 */
const versionConfigSchema = z.record(z.string(), z.unknown());

/** `POST /api/v1/report-template-versions` (scope `report-templates:write`): a new draft. */
export const createReportTemplateVersionBodySchema = requestDocumentSchema(
  'report-template-version',
  z.strictObject({ 'report-template-id': idSchema('rptp'), config: versionConfigSchema }),
);

/** `PATCH /api/v1/report-template-versions/:id` (drafts only): the configuration. */
export const updateReportTemplateVersionBodySchema = requestDocumentSchema(
  'report-template-version',
  z.strictObject({ config: versionConfigSchema }),
);

/** `POST /api/v1/report-template-versions/:id/publish` (scope `report-templates:publish`). */
export const publishReportTemplateVersionBodySchema = emptyActionBodySchema;

/** `GET /api/v1/report-templates` query. */
export const listReportTemplatesQuerySchema = listQuerySchema('rptp', {
  'filter[report-type]': filterListSchema(reportTypeSchema).optional(),
  'filter[status]': filterListSchema(reportTemplateStatusSchema).optional(),
});

/** `GET /api/v1/report-template-versions` query. */
export const listReportTemplateVersionsQuerySchema = listQuerySchema('rptpv', {
  'filter[report-template-id]': filterListSchema(idSchema('rptp')).optional(),
  'filter[status]': filterListSchema(reportTemplateVersionStatusSchema).optional(),
});

/**
 * `v<N>`, the public `report-template-version-name` (C70.2).
 * @throws {RangeError} for a version number below 1.
 */
export function reportTemplateVersionName(versionNumber: number): string {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new RangeError('a version number is an integer from 1');
  }
  return `v${String(versionNumber)}`;
}

export interface ReportTemplateVersionRecord {
  id: string;
  reportTemplateId: string;
  reportType: ReportType;
  versionNumber: number;
  status: ReportTemplateVersionStatus;
  /** As stored, with the resolved source lists (C71.2); the defaults are applied here. */
  config: Readonly<Record<string, unknown>>;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface ReportTemplateRecord {
  id: string;
  name: string;
  reportType: ReportType;
  status: ReportTemplateStatus;
  createdAt: Date;
  updatedAt: Date;
  /** The published version; `publishedAt` is set. */
  currentVersion: Pick<
    ReportTemplateVersionRecord,
    'id' | 'versionNumber' | 'config' | 'createdAt' | 'publishedAt'
  >;
}

/**
 * Builds the template resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildReportTemplateResource(record: ReportTemplateRecord): ReportTemplateResource {
  const version = record.currentVersion;
  return reportTemplateResourceSchema.parse({
    type: 'report-template',
    id: record.id,
    attributes: {
      'report-type': record.reportType,
      name: record.name,
      status: record.status,
      'current-version': {
        id: version.id,
        'version-number': version.versionNumber,
        config: resolveReportTemplateConfig(record.reportType, version.config),
        'created-at': toTimestamp(version.createdAt),
        'published-at': toNullableTimestamp(version.publishedAt),
      },
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}

/**
 * Builds the template version resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildReportTemplateVersionResource(
  record: ReportTemplateVersionRecord,
): ReportTemplateVersionResource {
  return reportTemplateVersionResourceSchema.parse({
    type: 'report-template-version',
    id: record.id,
    attributes: {
      'report-type': record.reportType,
      'version-number': record.versionNumber,
      status: record.status,
      config: resolveReportTemplateConfig(record.reportType, record.config),
      'created-at': toTimestamp(record.createdAt),
      'published-at': toNullableTimestamp(record.publishedAt),
    },
    relationships: {
      'report-template': { data: { type: 'report-template', id: record.reportTemplateId } },
    },
  });
}
