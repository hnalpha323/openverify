/**
 * The template calls of C154.4 and C154.5 the console needs beyond `@openverify/node` (Workflow
 * 9C): restore a version as a draft, copy a template, promote into another environment, and what
 * uses a template, each object the caller cannot read only counted (review P34).
 */
import 'server-only';
import {
  inquiryTemplateDocumentSchema,
  inquiryTemplateVersionDocumentSchema,
  promoteMetaSchema,
  templateUsageDocumentSchema,
  type InquiryTemplateResource,
  type InquiryTemplateVersionResource,
} from '@openverify/contracts';
import type { z } from 'zod';
import { apiRequest } from './client';

const templatePath = (templateId: string) => `/inquiry-templates/${encodeURIComponent(templateId)}`;

/** `POST /inquiry-templates/:id/restore`: a new draft from `versionId` (`draft_exists` when one is). */
export async function restoreTemplateVersion(
  templateId: string,
  versionId: string,
): Promise<InquiryTemplateVersionResource> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${templatePath(templateId)}/restore`,
    body: { meta: { 'version-id': versionId } },
    schema: inquiryTemplateVersionDocumentSchema,
  });
  return answer.data;
}

export interface CopyInput {
  readonly name: string;
  readonly versionId?: string;
}

/** `POST /inquiry-templates/:id/copy`: a new template whose draft copies the version. */
export async function copyTemplate(
  templateId: string,
  input: CopyInput,
): Promise<InquiryTemplateResource> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${templatePath(templateId)}/copy`,
    body: {
      meta: {
        name: input.name,
        ...(input.versionId === undefined ? {} : { 'version-id': input.versionId }),
      },
    },
    schema: inquiryTemplateDocumentSchema,
  });
  return answer.data;
}

export interface PromoteInput {
  readonly environmentId: string;
  readonly versionId?: string;
}

export interface Promoted {
  readonly version: InquiryTemplateVersionResource;
  /** The theme sets the promote copied with it (C160.8). */
  readonly copied: readonly { readonly type: 'theme-set'; readonly id: string }[];
}

const promotedDocumentSchema = inquiryTemplateVersionDocumentSchema.safeExtend({
  meta: promoteMetaSchema,
});

/** `POST /inquiry-templates/:id/promote`: a draft in another environment (users only). */
export async function promoteTemplate(templateId: string, input: PromoteInput): Promise<Promoted> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${templatePath(templateId)}/promote`,
    body: {
      meta: {
        'environment-id': input.environmentId,
        ...(input.versionId === undefined ? {} : { 'version-id': input.versionId }),
      },
    },
    schema: promotedDocumentSchema,
  });
  return { version: answer.data, copied: answer.meta.copied };
}

export type TemplateUsage = z.output<typeof templateUsageDocumentSchema>['data']['attributes'];

/** `GET /inquiry-templates/:id/used-by`. */
export async function templateUsedBy(templateId: string): Promise<TemplateUsage> {
  const answer = await apiRequest({
    method: 'GET',
    path: `${templatePath(templateId)}/used-by`,
    schema: templateUsageDocumentSchema,
  });
  return answer.data.attributes;
}
