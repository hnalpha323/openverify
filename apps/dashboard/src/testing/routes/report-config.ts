/**
 * `dashboard-report-config`'s own mock routes (Workflow 6B, C86): the watchlist sources page
 * (`GET /dashboard/watchlist-sources`) and the report templates and versions of the server API,
 * registered on a `routeApi()` the test made. Paths are after `/api/v1`; every value is
 * synthetic.
 */
import type {
  DashboardWatchlistSources,
  ReportTemplateResource,
  ReportTemplateVersionResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { RouteApi } from '../api-routes';
import { page, single } from '../report-config-fixtures';

export const WATCHLIST_SOURCES_PATH = '/dashboard/watchlist-sources';
export const REPORT_TEMPLATES_PATH = '/report-templates';
export const REPORT_TEMPLATE_VERSIONS_PATH = '/report-template-versions';

/** A viewer: templates and sources, read-only (C72.2). */
export const CONFIG_VIEWER: readonly Permission[] = ['report-templates:read', 'watchlists:read'];
/** A developer: templates written and published, and the sources page (C72.2). */
export const CONFIG_EDITOR: readonly Permission[] = [
  'report-templates:read',
  'report-templates:write',
  'report-templates:publish',
  'watchlists:read',
];

/** `GET /dashboard/watchlist-sources` answers `body`. */
export function serveWatchlistSources(api: RouteApi, body: DashboardWatchlistSources): RouteApi {
  return api.on('GET', WATCHLIST_SOURCES_PATH, 200, body);
}

/** `GET /report-templates` answers one page of `templates`. */
export function serveReportTemplates(
  api: RouteApi,
  templates: readonly ReportTemplateResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', REPORT_TEMPLATES_PATH, 200, page(templates, next));
}

/**
 * `GET /report-templates` answers `pages` in turn (Workflow 6B R013): the first without
 * `page[after]`, each later one after the last template of the page before it, with a next link
 * while a page follows.
 */
export function serveReportTemplatePages(
  api: RouteApi,
  pages: readonly (readonly ReportTemplateResource[])[],
): RouteApi {
  return api.handle('GET', REPORT_TEMPLATES_PATH, (request) => {
    const after = request.query.get('page[after]');
    const index = after === null ? 0 : pages.findIndex((each) => each.at(-1)?.id === after) + 1;
    const templates = pages[index] ?? [];
    const last = templates.at(-1);
    const next =
      index < pages.length - 1 && last !== undefined
        ? `/api/v1${REPORT_TEMPLATES_PATH}?page%5Bafter%5D=${last.id}&page%5Bsize%5D=100`
        : null;
    return { status: 200, body: page(templates, next) };
  });
}

/**
 * `GET /report-templates/:id` answers `template`, and `GET /report-template-versions` one page of
 * `versions`.
 */
export function serveReportTemplate(
  api: RouteApi,
  template: ReportTemplateResource,
  versions: readonly ReportTemplateVersionResource[] = [],
  next: string | null = null,
): RouteApi {
  api.on('GET', `${REPORT_TEMPLATES_PATH}/${template.id}`, 200, single(template));
  return api.on('GET', REPORT_TEMPLATE_VERSIONS_PATH, 200, page(versions, next));
}

/** `GET /report-template-versions/:id` answers `version`, and its template's route `template`. */
export function serveReportTemplateVersion(
  api: RouteApi,
  version: ReportTemplateVersionResource,
  template: ReportTemplateResource,
): RouteApi {
  api.on('GET', `${REPORT_TEMPLATE_VERSIONS_PATH}/${version.id}`, 200, single(version));
  return api.on('GET', `${REPORT_TEMPLATES_PATH}/${template.id}`, 200, single(template));
}
