/**
 * C140.5 (V16): the recipe routes. A recipe installs as a disabled workflow with a draft in the
 * caller's environment, and publishes only by the same rules as any draft, so `decision-basis` and
 * `contest-route` left unset keep the production gate shut until the operator fills them.
 */
import type { WorkflowDocument, workflowRecipeListDocumentSchema } from '@openverify/contracts';
import {
  createWorkflow,
  createWorkflowDraft,
  saveWorkflowDraft,
  setWorkflowVersionPointers,
} from '@openverify/db';
import type { z } from 'zod';
import { NotFoundError } from '../../errors.js';
import type { ApiDependencies } from '../../services/context.js';
import { change } from '../../services/transactions/shared.js';
import type { WorkflowActing } from '../acting.js';
import { workflowAudit } from '../definitions/audit.js';
import { workflowResource } from '../definitions/resources.js';
import { held } from '../definitions/shared.js';
import { WORKFLOW_RECIPES } from './rows.js';

export function listWorkflowRecipes(): z.infer<typeof workflowRecipeListDocumentSchema> {
  return {
    data: WORKFLOW_RECIPES.list().map((recipe) => ({
      type: 'workflow-recipe' as const,
      id: recipe.key,
      attributes: {
        name: recipe.name,
        description: recipe.description,
        'trigger-type': recipe.triggerType,
        'needs-configuration': [...recipe.needsConfiguration],
      },
    })),
    links: { next: null },
  };
}

export async function installWorkflowRecipe(
  deps: ApiDependencies,
  acting: WorkflowActing,
  key: string,
): Promise<WorkflowDocument> {
  const recipe = WORKFLOW_RECIPES.get(key);
  if (recipe === undefined) {
    throw new NotFoundError(`Workflow recipe ${key} was not found.`);
  }
  const { environmentId } = acting.ctx;
  const definition = recipe.definition();
  const workflow = await change(deps, acting, async ({ tx, audit }) => {
    const id = deps.ids.newId('wfl');
    await createWorkflow(tx, environmentId, {
      id,
      name: recipe.name,
      description: recipe.description,
      kind: 'workflow',
    });
    const draftVersionId = deps.ids.newId('wfv');
    await createWorkflowDraft(tx, environmentId, {
      id: draftVersionId,
      workflowId: id,
      versionNumber: 1,
      schemaVersion: definition['schema-version'],
      definition,
      lastUpdater: acting.actor.id,
    });
    await saveWorkflowDraft(tx, environmentId, draftVersionId, 1, {
      definition,
      schemaVersion: definition['schema-version'],
      triggerType: definition.trigger?.type ?? null,
      triggerConfig: definition.trigger?.config ?? null,
      warnings: [],
      lastUpdater: acting.actor.id,
    });
    const row = await setWorkflowVersionPointers(tx, environmentId, id, { draftVersionId });
    await audit(workflowAudit('workflow.created', id, { kind: 'workflow' }));
    return held(row);
  });
  return { data: workflowResource(workflow) };
}
