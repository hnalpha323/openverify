/**
 * C140.5: the recipes without a case, for the dev seed: each a paused workflow with a draft, so it
 * passes every publish rule before it can run. Run again, it adds nothing. `seed/dev-seed.ts` calls it.
 */
import { newId } from '@openverify/contracts';
import {
  createWorkflow,
  createWorkflowDraft,
  listWorkflows,
  saveWorkflowDraft,
  setWorkflowVersionPointers,
  type Db,
} from '@openverify/db';
import { WORKFLOW_RECIPES } from '../workflows/recipes/rows.js';

/** Answers how many it installed. `seededBy` is the seeded operator who stands behind the draft. */
export async function seedWorkflowRecipes(
  db: Db,
  environmentId: string,
  seededBy: string,
): Promise<number> {
  const { items } = await listWorkflows(db, environmentId, {}, { size: 100 });
  const held = new Set(items.map(({ name }) => name));
  let installed = 0;
  for (const recipe of WORKFLOW_RECIPES.list()) {
    if (held.has(recipe.name)) {
      continue;
    }
    const definition = recipe.definition();
    await db.transaction(async (tx) => {
      const id = newId('wfl');
      await createWorkflow(tx, environmentId, {
        id,
        name: recipe.name,
        description: recipe.description,
        kind: 'workflow',
      });
      const draftVersionId = newId('wfv');
      await createWorkflowDraft(tx, environmentId, {
        id: draftVersionId,
        workflowId: id,
        versionNumber: 1,
        schemaVersion: definition['schema-version'],
        definition,
        lastUpdater: seededBy,
      });
      await saveWorkflowDraft(tx, environmentId, draftVersionId, 1, {
        definition,
        schemaVersion: definition['schema-version'],
        triggerType: definition.trigger?.type ?? null,
        triggerConfig: definition.trigger?.config ?? null,
        warnings: [],
        lastUpdater: seededBy,
      });
      await setWorkflowVersionPointers(tx, environmentId, id, { draftVersionId });
    });
    installed += 1;
  }
  return installed;
}
