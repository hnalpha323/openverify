'use client';

/**
 * The documented recipes (C140.5), each naming what it still needs before a production publish,
 * installed as a paused draft in this environment with `workflows:write`.
 */
import type { WorkflowRecipeResource } from '@openverify/contracts';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable } from '../data-table';

export interface InstalledWorkflow {
  readonly workflowId: string;
}

export function RecipesTable({
  recipes,
  install,
}: {
  readonly recipes: readonly WorkflowRecipeResource[];
  /** With `workflows:write`; without it no install is offered. */
  readonly install?:
    | ((
        state: ActionState<InstalledWorkflow>,
        formData: FormData,
      ) => Promise<ActionResult<InstalledWorkflow>>)
    | undefined;
}) {
  return (
    <DataTable
      caption="Recipes"
      captionHidden
      rows={recipes}
      getRowKey={(recipe) => recipe.id}
      emptyMessage="No recipe is available."
      columns={[
        { id: 'name', header: 'Recipe', rowHeader: true, cell: (recipe) => recipe.attributes.name },
        {
          id: 'description',
          header: 'What it does',
          cell: (recipe) => recipe.attributes.description,
        },
        {
          id: 'needs',
          header: 'Still needs',
          cell: (recipe) =>
            recipe.attributes['needs-configuration'].length === 0
              ? 'Nothing'
              : recipe.attributes['needs-configuration'].join(', '),
        },
        ...(install === undefined
          ? []
          : [
              {
                id: 'install',
                header: 'Install',
                cell: (recipe: WorkflowRecipeResource) => (
                  <ConfirmActionButton<InstalledWorkflow>
                    label="Install"
                    accessibleLabel={`Install ${recipe.attributes.name}`}
                    variant="secondary"
                    tone="primary"
                    title={`Install “${recipe.attributes.name}”?`}
                    description="It is added to this environment as a paused workflow with a draft. Nothing runs until it is published and activated."
                    confirmLabel="Install recipe"
                    pendingLabel="Installing…"
                    action={install}
                    fields={{ 'recipe-key': recipe.id }}
                    successMessage="The recipe was installed as a paused workflow."
                  />
                ),
              },
            ]),
      ]}
    />
  );
}
