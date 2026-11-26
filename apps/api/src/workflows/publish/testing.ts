/** Golden definitions for the publish suites: one small graph each rule is a variation of. */
import { workflowDefinitionSchema, type WorkflowDefinition } from '@openverify/contracts';

type Json = Readonly<Record<string, unknown>>;

export const INQUIRY_COMPLETED = {
  type: 'trigger-event',
  config: { events: ['inquiry.completed'] },
} as const;

export const action = (id: string, key: string, config: Json, extra: Json = {}) => ({
  id,
  type: 'action',
  name: id,
  'action-key': key,
  'action-version': 1,
  config,
  ...extra,
});

export const INQUIRY = '{{ trigger.id }}';

export const decline = (id: string, config: Json = {}) =>
  action(id, 'decline_inquiry', { 'inquiry-id': INQUIRY, ...config });

export const approve = (id: string) => action(id, 'approve_inquiry', { 'inquiry-id': INQUIRY });

/** `trigger -> ...steps -> output`, each on `next`, through the real schema. */
export function chain(steps: readonly Json[], over: Json = {}): WorkflowDefinition {
  const ids = ['trigger', ...steps.map((step) => step.id as string), 'output'];
  return workflowDefinitionSchema.parse({
    'schema-version': 1,
    trigger: INQUIRY_COMPLETED,
    inputs: [],
    variables: [],
    steps: [...steps, { id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: ids
      .slice(1)
      .map((to, index) => ({ id: `e${String(index)}`, from: ids[index], 'from-port': 'next', to })),
    outputs: [],
    layout: {},
    ...over,
  });
}
