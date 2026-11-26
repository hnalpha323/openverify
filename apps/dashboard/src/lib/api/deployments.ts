/**
 * The read-only deployment history of a template (C154.7, Workflow 9C): one record per publish in
 * the template's own environment (`deployments:read`), newest first.
 */
import 'server-only';
import { deploymentListDocumentSchema, type DeploymentResource } from '@openverify/contracts';
import { apiRequest } from './client';

export const DEPLOYMENT_PAGE_SIZE = 25;

export interface DeploymentPage {
  readonly data: readonly DeploymentResource[];
  readonly links: { readonly next: string | null };
}

/** One page of `templateId`'s deployments, newest first, after `after`. */
export async function listTemplateDeployments(
  templateId: string,
  options: { readonly after?: string } = {},
): Promise<DeploymentPage> {
  const answer = await apiRequest({
    method: 'GET',
    path: '/deployments',
    query: {
      'filter[inquiry-template-id]': templateId,
      'page[after]': options.after,
      'page[size]': String(DEPLOYMENT_PAGE_SIZE),
    },
    schema: deploymentListDocumentSchema,
  });
  return { data: answer.data, links: { next: answer.links.next ?? null } };
}
