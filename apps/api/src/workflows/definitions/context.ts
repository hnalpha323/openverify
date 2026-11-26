/**
 * C113.5: what the graph check needs from the environment, read once before it runs, because the
 * check is pure and synchronous: the modules a definition runs and its report templates' review
 * models.
 */
import type { WorkflowDefinition, WorkflowGrant } from '@openverify/contracts';
import type { WorkflowKind } from '@openverify/core';
import {
  getReportTemplate,
  getWorkflow,
  getWorkflowVersion,
  type Db,
  type WorkflowVersionRow,
} from '@openverify/db';
import { readDefinition, type DefinitionCheckContext } from '@openverify/workflow-engine';
import { ACTION_REPORT_TYPE_TABLE } from '@openverify/workflow-engine/actions';
import { currentCaseScopeOf } from '../actions/cases/current-case.js';
import { WORKFLOW_ACTIONS, WORKFLOW_SINKS } from './registry.js';

/** C113.5: a module of this environment, at the version a step names. */
async function moduleVersion(
  db: Db,
  environmentId: string,
  workflowId: string,
  version: string,
): Promise<WorkflowVersionRow | null> {
  const workflow = await getWorkflow(db, environmentId, workflowId);
  if (workflow?.kind !== 'module') {
    return null;
  }
  const id = version === 'latest-published' ? workflow.latestPublishedVersionId : version;
  const row = id === null ? null : await getWorkflowVersion(db, environmentId, id);
  return row?.workflowId === workflowId && row.status !== 'draft' ? row : null;
}

const moduleKey = (workflowId: string, version: string) => `${workflowId} ${version}`;

export interface LoadedCheckContext {
  context: DefinitionCheckContext;
  /** C121.3: what the modules' own grants add to this version's. */
  moduleGrants: readonly WorkflowGrant[];
}

export async function loadCheckContext(
  db: Db,
  environmentId: string,
  definition: WorkflowDefinition,
  kind: WorkflowKind,
  mode: DefinitionCheckContext['mode'],
): Promise<LoadedCheckContext> {
  const modules = new Map<string, WorkflowDefinition>();
  const moduleGrants: WorkflowGrant[] = [];
  const reviews = new Map<string, string>();
  for (const step of definition.steps) {
    if (step.type === 'module') {
      const version = step.version;
      const workflowId = step['module-workflow-id'];
      const row = await moduleVersion(db, environmentId, workflowId, version);
      if (row !== null) {
        modules.set(moduleKey(workflowId, version), readDefinition(row.definition));
        moduleGrants.push(row.grant as WorkflowGrant);
      }
    }
    if (step.type === 'action' && step['action-key'] === 'run_report') {
      const templateId = step.config['report-template-id'];
      const template =
        typeof templateId === 'string'
          ? await getReportTemplate(db, environmentId, templateId)
          : null;
      if (template !== null) {
        reviews.set(template.id, ACTION_REPORT_TYPE_TABLE[template.reportType].review);
      }
    }
  }
  const currentCase = currentCaseScopeOf(definition);
  return {
    context: {
      kind,
      mode,
      registry: WORKFLOW_ACTIONS,
      modules: (workflowId, version) => modules.get(moduleKey(workflowId, version)),
      reportReviewModel: (templateId) => reviews.get(templateId),
      // Workflow 8B (C115.6, C140.2): the case sinks, and `current_case`'s type from its owner.
      sinks: WORKFLOW_SINKS,
      ...(currentCase === undefined ? {} : { currentCase }),
    },
    moduleGrants,
  };
}
