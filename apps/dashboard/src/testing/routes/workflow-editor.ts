/**
 * `console-editor`'s own mock routes (C141; Workflow 8D), registered on a `routeApi()` the test
 * made. Paths are after `/api/v1`; every value is synthetic.
 */
import type { WorkflowActionResource } from '@openverify/contracts';
import type { RouteApi } from '../api-routes';

export const WORKFLOW_ACTIONS_PATH = '/workflow-actions';

/** `GET /workflow-actions` answers `actions`, unpaginated (8A amendment 102). */
export function serveWorkflowActions(
  api: RouteApi,
  actions: readonly WorkflowActionResource[],
): RouteApi {
  return api.on('GET', WORKFLOW_ACTIONS_PATH, 200, { data: actions, links: { next: null } });
}
