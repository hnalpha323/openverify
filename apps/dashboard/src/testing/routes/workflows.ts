/**
 * `dashboard-workflows`' own mock routes (C128, C141; Workflow 8C), registered on a `routeApi()`
 * the test made. Paths are after `/api/v1`; every value is synthetic.
 */
import type {
  AccountAvailableActionListDocument,
  DecisionResource,
  WorkflowActionResource,
  WorkflowRecipeResource,
  WorkflowResource,
  WorkflowRunResource,
  WorkflowRunStepResource,
  WorkflowSecretResource,
  WorkflowTriggerDeliveryResource,
  WorkflowVersionResource,
} from '@openverify/contracts';
import type { RouteApi } from '../api-routes';
import { page } from '../workflow-fixtures';

export const DECISIONS_PATH = '/decisions';

/** `GET /decisions?filter[subject-id]=` answers `decisions`, whatever the filter. */
export function serveDecisions(api: RouteApi, decisions: readonly DecisionResource[]): RouteApi {
  return api.on('GET', DECISIONS_PATH, 200, page(decisions));
}

/** `POST /inquiries/:id/reopen` answers the reopened inquiry `document`. */
export function serveReopen(api: RouteApi, inquiryId: string, document: unknown): RouteApi {
  return api.on('POST', `/inquiries/${inquiryId}/reopen`, 200, document);
}

/** `GET /accounts/:id/available-actions` answers `actions`. */
export function serveAvailableAccountActions(
  api: RouteApi,
  accountId: string,
  actions: AccountAvailableActionListDocument['data'],
): RouteApi {
  return api.on('GET', `/accounts/${accountId}/available-actions`, 200, page(actions));
}

/** `POST /accounts/:id/run-action` answers the started run. */
export function serveRunAccountAction(api: RouteApi, accountId: string, runId: string): RouteApi {
  return api.on('POST', `/accounts/${accountId}/run-action`, 200, {
    data: { 'workflow-run-id': runId },
  });
}

export const WORKFLOWS_PATH = '/workflows';
export const WORKFLOW_RUNS_PATH = '/workflow-runs';
export const WORKFLOW_VERSIONS_PATH = '/workflow-versions';

/** `GET /workflows` answers `workflows`. */
export function serveWorkflows(api: RouteApi, workflows: readonly WorkflowResource[]): RouteApi {
  return api.on('GET', WORKFLOWS_PATH, 200, page(workflows));
}

/** `GET /workflow-recipes` answers `list` (no pagination, Phase 8A amendment 102). */
export function serveRecipes(api: RouteApi, list: readonly WorkflowRecipeResource[]): RouteApi {
  return api.on('GET', '/workflow-recipes', 200, page(list));
}

/** `GET /workflows/:id` answers `workflow`. */
export function serveWorkflow(api: RouteApi, workflow: WorkflowResource): RouteApi {
  return api.on('GET', `${WORKFLOWS_PATH}/${workflow.id}`, 200, { data: workflow });
}

/** `GET /workflow-versions?filter[workflow-id]=` answers `versions`. */
export function serveWorkflowVersions(
  api: RouteApi,
  versions: readonly WorkflowVersionResource[],
): RouteApi {
  return api.on('GET', WORKFLOW_VERSIONS_PATH, 200, page(versions));
}

/** `GET /workflow-runs/:id` and its steps answer `run` and `steps`. */
export function serveWorkflowRun(
  api: RouteApi,
  run: WorkflowRunResource,
  steps: readonly WorkflowRunStepResource[] = [],
): RouteApi {
  api.on('GET', `${WORKFLOW_RUNS_PATH}/${run.id}`, 200, { data: run });
  return api.on('GET', `${WORKFLOW_RUNS_PATH}/${run.id}/steps`, 200, page(steps));
}

/** `GET /workflow-runs?filter[workflow-id]=` answers `runs`. */
export function serveWorkflowRuns(api: RouteApi, runs: readonly WorkflowRunResource[]): RouteApi {
  return api.on('GET', WORKFLOW_RUNS_PATH, 200, page(runs));
}

export const WORKFLOW_SECRETS_PATH = '/workflow-secrets';

/** `GET /workflow-secrets` answers `secrets`. */
export function serveWorkflowSecrets(
  api: RouteApi,
  secrets: readonly WorkflowSecretResource[],
): RouteApi {
  return api.on('GET', WORKFLOW_SECRETS_PATH, 200, page(secrets));
}

/** `GET /workflows/:id/draft` answers `draft`. */
export function serveWorkflowDraft(
  api: RouteApi,
  workflowId: string,
  draft: WorkflowVersionResource,
): RouteApi {
  return api.on('GET', `${WORKFLOWS_PATH}/${workflowId}/draft`, 200, { data: draft });
}

/** `GET /workflow-versions/:id` answers `version`. */
export function serveWorkflowVersion(api: RouteApi, version: WorkflowVersionResource): RouteApi {
  return api.on('GET', `${WORKFLOW_VERSIONS_PATH}/${version.id}`, 200, { data: version });
}

/** `POST /workflows/:id/draft/validate` answers the check. */
export function serveDraftCheck(
  api: RouteApi,
  workflowId: string,
  errors: readonly { pointer: string; code: string; detail?: string }[] = [],
  warnings: readonly { pointer: string; code: string; detail?: string }[] = [],
): RouteApi {
  return api.on('POST', `${WORKFLOWS_PATH}/${workflowId}/draft/validate`, 200, {
    meta: { valid: errors.length === 0, errors, warnings },
  });
}

export const TRIGGER_DELIVERIES_PATH = '/workflow-trigger-deliveries';

/** `GET /workflow-trigger-deliveries?filter[workflow-id]=` answers `deliveries`. */
export function serveTriggerDeliveries(
  api: RouteApi,
  deliveries: readonly WorkflowTriggerDeliveryResource[],
): RouteApi {
  return api.on('GET', TRIGGER_DELIVERIES_PATH, 200, page(deliveries));
}

/** `GET /workflow-versions/:id/diff?against=` answers `attributes` for `versionId`. */
export function serveVersionDiff(
  api: RouteApi,
  versionId: string,
  attributes: Record<string, unknown>,
): RouteApi {
  return api.on('GET', `${WORKFLOW_VERSIONS_PATH}/${versionId}/diff`, 200, {
    data: { type: 'workflow-version-diff', id: versionId, attributes },
  });
}

/** `GET /workflow-actions` answers `actions` (no pagination). */
export function serveWorkflowActions(
  api: RouteApi,
  actions: readonly WorkflowActionResource[],
): RouteApi {
  return api.on('GET', '/workflow-actions', 200, page(actions));
}

export const SANDBOX_EMAIL_SEARCH_PATH = '/sandbox/email-messages/search';
export const SANDBOX_SLACK_SEARCH_PATH = '/sandbox/slack-messages/search';
export const SANDBOX_WORKFLOW_SMS_SEARCH_PATH = '/sandbox/workflow-sms-messages/search';

/** A sandbox message search answers `records`, whatever the recipient. */
export function serveSandboxMessages(
  api: RouteApi,
  path: string,
  records: readonly Record<string, unknown>[],
): RouteApi {
  return api.on('POST', path, 200, { data: records });
}

/** `POST /workflows/:id/test-runs` answers the started run. */
export function serveTestRun(
  api: RouteApi,
  workflowId: string,
  run: WorkflowRunResource,
): RouteApi {
  return api.on('POST', `${WORKFLOWS_PATH}/${workflowId}/test-runs`, 201, { data: run });
}
