/**
 * C140.5 (V16): the recipes as data. A recipe is a definition with its configuration left to fill,
 * installed as a draft of a disabled workflow, so it passes every publish rule before it can run.
 * The table takes rows, so Workflow 8B registers its case recipes by passing them (F33), and
 * `api-actions` the recipes without a case.
 */
import { workflowDefinitionSchema, type WorkflowDefinition } from '@openverify/contracts';
import type { WorkflowTriggerType } from '@openverify/core';

export interface WorkflowRecipe {
  /** kebab-case, stable: `POST /workflow-recipes/:key/install`. */
  key: string;
  name: string;
  description: string;
  /** What must be filled before it can be published in production (C128.3). */
  needsConfiguration: readonly string[];
  /** Built when read, so a recipe holds no state. */
  definition: () => WorkflowDefinition;
}

/** A row with what its definition says, read once. */
export interface ListedWorkflowRecipe extends WorkflowRecipe {
  triggerType: WorkflowTriggerType;
}

export interface WorkflowRecipeTable {
  list(): readonly ListedWorkflowRecipe[];
  get(key: string): ListedWorkflowRecipe | undefined;
}

/** @throws {Error} for a key given twice, or a definition the schema refuses: a bug at start. */
export function createWorkflowRecipeTable(rows: readonly WorkflowRecipe[]): WorkflowRecipeTable {
  const byKey = new Map<string, ListedWorkflowRecipe>();
  for (const row of rows) {
    if (byKey.has(row.key)) {
      throw new Error(`The recipe ${row.key} is registered twice`);
    }
    const { trigger } = workflowDefinitionSchema.parse(row.definition());
    if (trigger === null) {
      throw new Error(`The recipe ${row.key} has no trigger`);
    }
    byKey.set(row.key, { ...row, triggerType: trigger.type });
  }
  const listed = Object.freeze([...byKey.values()]);
  return Object.freeze({ list: () => listed, get: (key: string) => byKey.get(key) });
}
