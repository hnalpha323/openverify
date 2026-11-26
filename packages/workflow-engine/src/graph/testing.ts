/**
 * Golden definitions, built by code from one valid base (C146.1): one small workflow every rule's
 * invalid definition is a variation of, read through the real action catalogue.
 */
import type { WorkflowDefinition, WorkflowEdge, WorkflowStep } from '@openverify/contracts';
import { createWorkflowActionEntries } from '../actions/catalogue.js';
import {
  ACTION_OBJECT_TYPE_ENTRIES,
  createActionObjectTypeTable,
  createActionRegistry,
  type ActionRegistry,
} from '../actions/registry.js';

export const LIST_ID = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
export const MODULE_ID = 'wfl_01M5CM00000000000000000015';

export const registry: ActionRegistry = createActionRegistry(
  createWorkflowActionEntries(createActionObjectTypeTable(ACTION_OBJECT_TYPE_ENTRIES)),
);

export const edge = (id: string, from: string, port: string, to: string): WorkflowEdge => ({
  id,
  from,
  'from-port': port,
  to,
});

export const backEdge = (id: string, from: string, to: string): WorkflowEdge => ({
  ...edge(id, from, 'next', to),
  'to-port': 'continue',
});

export const action = (
  id: string,
  key: string,
  config: Readonly<Record<string, unknown>>,
  extra: object = {},
): WorkflowStep =>
  ({
    id,
    type: 'action',
    name: id,
    'action-key': key,
    'action-version': 1,
    config,
    ...extra,
  }) as WorkflowStep;

export const tag = (id: string, value = 'checked'): WorkflowStep =>
  action(id, 'tag_object', {
    'object-type': 'inquiry',
    'object-id': '{{ trigger.id }}',
    tag: value,
  });

export const output = (mappings: object = {}): WorkflowStep =>
  ({ id: 'output', type: 'output', name: 'Output', mappings }) as WorkflowStep;

export const INQUIRY_TRIGGER = {
  type: 'trigger-event',
  config: { events: ['inquiry.completed'] },
} as WorkflowDefinition['trigger'];

/** A chain `trigger -> ...steps -> output`, each on `next`. */
export function chain(
  steps: readonly WorkflowStep[],
  over: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  const ids = ['trigger', ...steps.map(({ id }) => id), 'output'];
  return {
    'schema-version': 1,
    trigger: INQUIRY_TRIGGER,
    inputs: [],
    variables: [],
    steps: [...steps, output()],
    edges: ids.slice(1).map((to, index) => edge(`e${String(index)}`, ids[index] ?? '', 'next', to)),
    outputs: [],
    layout: {},
    ...over,
  };
}
