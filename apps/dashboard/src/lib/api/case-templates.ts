/**
 * Case template reads of the case console (C130, C142.1), through the server API with the
 * operator's session, under `case-templates:read`. A template and its versions hold configuration,
 * never a subject's data, so nothing here is masked. Failures are `@openverify/node` errors, which
 * `renderPage` maps.
 */
import 'server-only';
import {
  caseTemplateDocumentSchema,
  caseTemplateListDocumentSchema,
  caseTemplateVersionDocumentSchema,
  caseTemplateVersionListDocumentSchema,
} from '@openverify/contracts';
import type { CaseTemplateStatus } from '@openverify/core';
import { apiRequest } from './client';

/** Templates and versions per list page. */
export const CASE_TEMPLATES_PAGE_SIZE = 25;
/** The templates a choice offers (a filter, the graph's create-case), from one page. */
export const CASE_TEMPLATE_CHOICES = 100;

/** `GET /case-templates`: one page, newest first. */
export function listCaseTemplates(
  options: {
    readonly after?: string | undefined;
    readonly size?: number;
    readonly status?: CaseTemplateStatus;
  } = {},
) {
  return apiRequest({
    method: 'GET',
    path: '/case-templates',
    query: {
      'filter[status]': options.status,
      'page[after]': options.after,
      'page[size]': String(options.size ?? CASE_TEMPLATES_PAGE_SIZE),
    },
    schema: caseTemplateListDocumentSchema,
  });
}

/** `GET /case-templates/:id`: the published version's fields and resolutions with the template's own. */
export function getCaseTemplate(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/case-templates/${encodeURIComponent(id)}`,
    schema: caseTemplateDocumentSchema,
  });
}

/** `GET /case-template-versions?filter[case-template-id]=`: one page of a template's, newest first. */
export function listCaseTemplateVersions(templateId: string, after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/case-template-versions',
    query: {
      'filter[case-template-id]': templateId,
      'page[after]': after,
      'page[size]': String(CASE_TEMPLATES_PAGE_SIZE),
    },
    schema: caseTemplateVersionListDocumentSchema,
  });
}

/** `GET /case-template-versions/:id`. */
export function getCaseTemplateVersion(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/case-template-versions/${encodeURIComponent(id)}`,
    schema: caseTemplateVersionDocumentSchema,
  });
}
