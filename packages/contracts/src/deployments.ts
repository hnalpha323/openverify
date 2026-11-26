/**
 * C154.7 (public resource, read-only history; decision 13; Workflow 9A Stage 1a, (T)): each publish
 * of a template version, a promoted or restored draft's included, writes one `deployment` (`dply_`)
 * with one route. Publishing is deploying to the template's own environment; weighted splits,
 * request criteria, undeploy and "publish without deploy" are not built (C177), and a record never
 * implies a version is live elsewhere (C154.10).
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { inquiryTemplateIdentifierSchema } from './identifiers.js';
import {
  listDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { booleanFilterSchema, filterListSchema, listQuerySchema } from './list-filters.js';
import { lastUpdaterSchema, type LastUpdater } from './template-fields.js';

export const deploymentRouteSchema = z.strictObject({
  'template-id': idSchema('itmpl'),
  'environment-id': idSchema('env'),
  rules: z
    .array(z.strictObject({ strategy: z.literal('constant'), 'version-id': idSchema('itmplv') }))
    .length(1),
  /** The deployment this one superseded on the route, `null` for a first publish. */
  'source-deployment-id': idSchema('dply').nullable(),
});

export const deploymentAttributesSchema = z.strictObject({
  'resource-type': z.literal('inquiry-template'),
  /** Who published: a user, or an API key for a version published through the API. */
  creator: lastUpdaterSchema,
  routes: z.array(deploymentRouteSchema).length(1),
  'created-at': timestampSchema,
});

export const deploymentResourceSchema = resourceWithRelationshipsSchema(
  'deployment',
  'dply',
  deploymentAttributesSchema,
  z.strictObject({ 'inquiry-template': toOneRelationshipSchema(inquiryTemplateIdentifierSchema) }),
);
export type DeploymentResource = z.infer<typeof deploymentResourceSchema>;

export const deploymentDocumentSchema = singleDocumentSchema(deploymentResourceSchema);
export const deploymentListDocumentSchema = listDocumentSchema(deploymentResourceSchema);

/**
 * `GET /api/v1/deployments` (`deployments:read`). `filter[environment-id]` is always the caller's
 * environment, so another id answers an empty list (review H23); `filter[changes-only]` is public and
 * changes nothing here, since every record writes one route.
 */
export const listDeploymentsQuerySchema = listQuerySchema('dply', {
  'filter[inquiry-template-id]': filterListSchema(idSchema('itmpl')).optional(),
  'filter[environment-id]': filterListSchema(idSchema('env')).optional(),
  'filter[changes-only]': booleanFilterSchema.optional(),
});
export type ListDeploymentsQuery = z.infer<typeof listDeploymentsQuerySchema>;

export interface DeploymentRecord {
  id: string;
  templateId: string;
  environmentId: string;
  versionId: string;
  sourceDeploymentId: string | null;
  creator: LastUpdater;
  createdAt: Date;
}

/**
 * Builds the deployment resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildDeploymentResource(record: DeploymentRecord): DeploymentResource {
  return deploymentResourceSchema.parse({
    type: 'deployment',
    id: record.id,
    attributes: {
      'resource-type': 'inquiry-template',
      creator: record.creator,
      routes: [
        {
          'template-id': record.templateId,
          'environment-id': record.environmentId,
          rules: [{ strategy: 'constant', 'version-id': record.versionId }],
          'source-deployment-id': record.sourceDeploymentId,
        },
      ],
      'created-at': toTimestamp(record.createdAt),
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: record.templateId } },
    },
  });
}
