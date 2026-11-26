/**
 * C140.5: the recipes Workflow 8A ships. "Review on report match" holds a case, so it joins with
 * Workflow 8B. Custom-list re-screening needs no recipe: the report engine does it (C127.12).
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { createWorkflowRecipeTable, type WorkflowRecipe } from './table.js';
import { CASE_RECIPE_ROWS } from '../actions/cases/recipes.js';

/**
 * K8-7 (C127.12, C140.5): one step re-screens each monitored report of the account whose query
 * reads a field that changed, from the same template with the account's current value.
 */
function rescreenOnAccountChange(): WorkflowDefinition {
  return {
    'schema-version': 1,
    trigger: { type: 'trigger-event', config: { events: ['account.updated-fields'] } },
    inputs: [],
    variables: [],
    steps: [
      {
        id: 'rescreen',
        type: 'action',
        name: 'Re-screen the account’s monitored reports whose fields changed',
        'action-key': 'rescreen_account_reports',
        'action-version': 1,
        config: { 'account-id': '{{ trigger.id }}', 'timeout-seconds': 3_600 },
      },
      { id: 'output', type: 'output', name: 'Output', mappings: {} },
    ],
    edges: [
      { id: 'start', from: 'trigger', 'from-port': 'next', to: 'rescreen' },
      { id: 'end', from: 'rescreen', 'from-port': 'next', to: 'output' },
    ],
    outputs: [],
    layout: {},
  };
}

export const WORKFLOW_RECIPE_ROWS: readonly WorkflowRecipe[] = [
  {
    key: 'rescreen-on-account-field-change',
    name: 'Re-screen on account field change',
    description:
      'When an account’s fields change, creates a new report for each monitored report whose ' +
      'query reads a changed field, from the same template with the current value. A rerun ' +
      'would repeat the old query.',
    needsConfiguration: [],
    definition: rescreenOnAccountChange,
  },
  // Workflow 8B (C140.5): the recipes with a case, `api-case-workflows`'.
  ...CASE_RECIPE_ROWS,
];

export const WORKFLOW_RECIPES = createWorkflowRecipeTable(WORKFLOW_RECIPE_ROWS);
