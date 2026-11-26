/**
 * `dashboard-graph`'s own mock routes (C108): graph queries, their unmask and bulk actions, and the
 * query templates and versions of the server API, registered on a `routeApi()` the test made.
 * Paths are after `/api/v1`; every value is synthetic.
 */
import type {
  AccountGraphComponentDocument,
  GraphQueryResource,
  GraphQueryTemplateResource,
  GraphQueryTemplateVersionResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { RouteApi } from '../api-routes';
import { page, single } from '../graph-fixtures';

export const GRAPH_QUERIES_PATH = '/graph-queries';
export const GRAPH_TEMPLATES_PATH = '/graph-query-templates';
export const GRAPH_TEMPLATE_VERSIONS_PATH = '/graph-query-template-versions';

/** A reviewer with `pii:view` (7B Stage 1a amendment 21, plus the PII permission). */
export const GRAPH_REVIEWER: readonly Permission[] = [
  'graph:read',
  'graph:write',
  'accounts:read',
  'accounts:write',
  'lists:read',
  'lists:write',
  'pii:view',
];
/** A developer: every 7B scope but `transactions:redact`, and no `pii:view`. */
export const GRAPH_DEVELOPER: readonly Permission[] = [
  'graph:read',
  'graph:write',
  'accounts:read',
  'accounts:write',
  'lists:read',
  'lists:write',
];
/** Reads the graph and nothing else. */
export const GRAPH_READER: readonly Permission[] = ['graph:read'];

/** `GET /accounts/:id/graph-component` answers `component` (K7B-2, C101.6). */
export function serveAccountGraphComponent(
  api: RouteApi,
  component: AccountGraphComponentDocument,
): RouteApi {
  return api.on('GET', `/accounts/${component.data.id}/graph-component`, 200, component);
}

/** `GET /graph-queries/:id` answers `query`. */
export function serveGraphQuery(api: RouteApi, query: GraphQueryResource): RouteApi {
  return api.on('GET', `${GRAPH_QUERIES_PATH}/${query.id}`, 200, single(query));
}

/** `GET /graph-queries` answers one page of `queries`. */
export function serveGraphQueries(
  api: RouteApi,
  queries: readonly GraphQueryResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', GRAPH_QUERIES_PATH, 200, page(queries, next));
}

/** `GET /graph-query-templates` answers one page of `templates`. */
export function serveGraphTemplates(
  api: RouteApi,
  templates: readonly GraphQueryTemplateResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', GRAPH_TEMPLATES_PATH, 200, page(templates, next));
}

/** `GET /graph-query-template-versions` answers one page of `versions` (K7B-3). */
export function serveGraphTemplateVersions(
  api: RouteApi,
  versions: readonly GraphQueryTemplateVersionResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', GRAPH_TEMPLATE_VERSIONS_PATH, 200, page(versions, next));
}

/** `GET /graph-query-templates/:id` answers `template`, with an empty version list to replace. */
export function serveGraphTemplate(api: RouteApi, template: GraphQueryTemplateResource): RouteApi {
  serveGraphTemplateVersions(api, []);
  return api.on('GET', `${GRAPH_TEMPLATES_PATH}/${template.id}`, 200, single(template));
}

/** `GET /graph-query-template-versions/:id` answers `version`. */
export function serveGraphTemplateVersion(
  api: RouteApi,
  version: GraphQueryTemplateVersionResource,
): RouteApi {
  return api.on('GET', `${GRAPH_TEMPLATE_VERSIONS_PATH}/${version.id}`, 200, single(version));
}
