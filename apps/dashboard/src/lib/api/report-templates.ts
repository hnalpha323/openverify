/**
 * The report templates a console picker offers (C71, C86): the create-report page's active
 * templates and the `/reports` template filter. The pages are read in turn, up to
 * `MAX_TEMPLATE_CHOICES`, so a template past the first page can be chosen; a picker says when
 * more remain (Workflow 6B R013).
 */
import 'server-only';
import type { ReportTemplateResource } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';

/** Templates asked for per page. */
export const TEMPLATE_PAGE_SIZE = 100;
/** The most templates a picker lists: ten pages. */
export const MAX_TEMPLATE_CHOICES = 1_000;

export interface TemplateChoices {
  /** Newest first, as the API lists them. */
  readonly templates: readonly ReportTemplateResource[];
  /** More templates exist than the picker lists. */
  readonly truncated: boolean;
}

/** The session environment's report templates, or its `active` ones, for a picker. */
export async function listTemplateChoices(
  api: OpenVerifyClient,
  status?: 'active',
): Promise<TemplateChoices> {
  const templates: ReportTemplateResource[] = [];
  const pages = api.reportTemplates.listAll({
    ...(status === undefined ? {} : { filter: { status } }),
    page: { size: TEMPLATE_PAGE_SIZE },
  });
  for await (const template of pages) {
    if (templates.length === MAX_TEMPLATE_CHOICES) {
      return { templates, truncated: true };
    }
    templates.push(template);
  }
  return { templates, truncated: false };
}
