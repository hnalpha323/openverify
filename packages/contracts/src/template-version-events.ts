/**
 * C154.8 (Workflow 9A Stage 1a, (T)): the version an `inquiry-template-version.*` event carries: its
 * summary, never its flow, configuration or copy (which `inquiry-templates:read` serves), and the
 * template it resolves through for strict webhook filters.
 */
import { z } from 'zod';
import { inquiryTemplateIdentifierSchema } from './identifiers.js';
import { inquiryTemplateVersionStatusSchema } from './inquiry-template-versions.js';
import {
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toOneRelationshipSchema,
} from './json-api.js';
import { sha256HexSchema } from './template-fields.js';

export const inquiryTemplateVersionEventResourceSchema = resourceWithRelationshipsSchema(
  'inquiry-template-version',
  'itmplv',
  z.strictObject({
    'version-number': z.int().min(1),
    status: inquiryTemplateVersionStatusSchema,
    'publish-note': z.string().max(255).nullable(),
    'flow-sha256': sha256HexSchema,
    'spec-version': z.union([z.literal(1), z.literal(2)]),
    'created-at': timestampSchema,
    'published-at': timestampSchema.nullable(),
  }),
  z.strictObject({ 'inquiry-template': toOneRelationshipSchema(inquiryTemplateIdentifierSchema) }),
);
export type InquiryTemplateVersionEventResource = z.infer<
  typeof inquiryTemplateVersionEventResourceSchema
>;

/** The summary as a document (the webhook samples' resource fixture). */
export const inquiryTemplateVersionSummaryDocumentSchema = singleDocumentSchema(
  inquiryTemplateVersionEventResourceSchema,
);
