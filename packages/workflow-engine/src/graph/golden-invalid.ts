/**
 * One golden invalid definition per rule of the graph check (C113.5, C146.1), each a variation of a
 * small valid base, built by code so the variation is the whole of what it shows. A rule's row names
 * the code and the JSON Pointer the check answers.
 */
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import { createActionRegistry, type AnyActionRegistryEntry } from '../actions/registry.js';
import type { DefinitionCheckContext } from './check.js';
import {
  LIST_ID,
  MODULE_ID,
  action,
  backEdge,
  chain,
  edge,
  output,
  registry,
  tag,
} from './testing.js';

const steps = (list: readonly object[]): WorkflowDefinition['steps'] =>
  list as WorkflowDefinition['steps'];

const trigger = (value: object): WorkflowDefinition['trigger'] =>
  value as WorkflowDefinition['trigger'];

export const parallelStep = (id = 'fork', keys: readonly string[] = ['a', 'b']): WorkflowStep => ({
  id,
  type: 'parallel',
  name: id,
  branches: keys.map((key) => ({ key })),
});

export const joinStep = (id = 'meet', of = 'fork'): WorkflowStep => ({
  id,
  type: 'join',
  name: id,
  'join-of': of,
});

export const conditional = (id: string, routes: readonly object[]): WorkflowStep =>
  ({ id, type: 'conditional', name: id, routes }) as WorkflowStep;

export const forEach = (id: string, items = 'trigger.tags', extra: object = {}): WorkflowStep => ({
  id,
  type: 'loop',
  name: id,
  mode: 'for-each',
  items,
  ...extra,
});

export const whileLoop = (id: string, condition: unknown, extra: object = {}): WorkflowStep =>
  ({
    id,
    type: 'loop',
    name: id,
    mode: 'while',
    condition,
    'max-iterations': 3,
    ...extra,
  }) as WorkflowStep;

export const moduleStep = (id: string, inputs: object = {}): WorkflowStep =>
  ({
    id,
    type: 'module',
    name: id,
    'module-workflow-id': MODULE_ID,
    version: 'latest-published',
    inputs,
  }) as WorkflowStep;

export const waitEvents = (id: string, extra: object = {}): WorkflowStep => ({
  id,
  type: 'wait',
  name: id,
  mode: 'events',
  subject: 'trigger.id',
  events: ['inquiry.approved'],
  'timeout-seconds': 60,
  'on-timeout': 'continue',
  ...extra,
});

export const listMatch = (id = 'match'): WorkflowStep =>
  action(id, 'get_list_match', {
    'list-ids': [LIST_ID],
    probe: { kind: 'string', value: 'x' },
  });

/** `fork` with branches `one` and `two`, each ending at `meet`. */
export function parallel(
  one: WorkflowStep = tag('one'),
  two: WorkflowStep = tag('two'),
): WorkflowDefinition {
  return chain([], {
    steps: [parallelStep(), one, two, joinStep(), output()],
    edges: [
      edge('e1', 'trigger', 'next', 'fork'),
      edge('e2', 'fork', 'branch:a', one.id),
      edge('e3', 'fork', 'branch:b', two.id),
      edge('e4', one.id, 'next', 'meet'),
      edge('e5', two.id, 'next', 'meet'),
      edge('e6', 'meet', 'next', 'output'),
    ],
  });
}

/** `each` with one body step. */
export function looped(loop: WorkflowStep, body: WorkflowStep = tag('inner')): WorkflowDefinition {
  return chain([], {
    steps: [loop, body, output()],
    edges: [
      edge('e1', 'trigger', 'next', loop.id),
      edge('e2', loop.id, 'body', body.id),
      backEdge('e3', body.id, loop.id),
      edge('e4', loop.id, 'done', 'output'),
    ],
  });
}

const nestedLoops = (depth: number): WorkflowDefinition => {
  const loops = Array.from({ length: depth }, (_item, index) => forEach(`l${String(index)}`));
  const inner = tag('inner');
  const ids = loops.map(({ id }) => id);
  const bodies = ids.map((id, index) =>
    edge(`b${String(index)}`, id, 'body', ids[index + 1] ?? inner.id),
  );
  const dones = ids.slice(1).map((id, index) => {
    const outer = ids[index] ?? '';
    return backEdge(`d${String(index)}`, id, outer);
  });
  const fixed = dones.map((done, index) => ({
    ...done,
    'from-port': 'done',
    id: `d${String(index)}`,
  }));
  return chain([], {
    steps: [...loops, inner, output()],
    edges: [
      edge('e1', 'trigger', 'next', ids[0] ?? ''),
      ...bodies,
      ...fixed,
      backEdge('e2', inner.id, ids.at(-1) ?? ''),
      edge('e3', ids[0] ?? '', 'done', 'output'),
    ],
  });
};

/** `a`, a conditional with one route, both ports going to `output`. */
export function routed(route: object, ...before: readonly WorkflowStep[]): WorkflowDefinition {
  const ids = ['trigger', ...before.map(({ id }) => id), 'a'];
  return chain([], {
    steps: [...before, conditional('a', [{ key: 'one', label: 'One', ...route }]), output()],
    edges: [
      ...ids.slice(1).map((to, index) => edge(`e${String(index)}`, ids[index] ?? '', 'next', to)),
      edge('r1', 'a', 'route:one', 'output'),
      edge('r2', 'a', 'else', 'output'),
    ],
  });
}

const withEdges = (
  definition: WorkflowDefinition,
  ...edges: WorkflowDefinition['edges']
): WorkflowDefinition => ({
  ...definition,
  edges: [...definition.edges, ...edges],
});

const base = chain([tag('a')]);

const restricted = createActionRegistry(
  registry
    .list()
    .map((entry) =>
      entry.key === 'tag_object'
        ? ({ ...entry, triggers: ['trigger-api'] } as unknown as AnyActionRegistryEntry)
        : entry,
    ),
);

/** A module with one required input, for a step that references it. */
export const MODULE_DEFINITION: WorkflowDefinition = {
  ...chain([]),
  trigger: null,
  inputs: [{ name: 'needed', type: 'string', required: true }],
  outputs: [{ name: 'held', pii: true }],
  steps: steps([{ id: 'start', type: 'module-input', name: 'In' }, output({ held: true })]),
  edges: [edge('e1', 'start', 'next', 'output')],
};

export interface GoldenInvalid {
  readonly code: string;
  readonly pointer: string;
  readonly definition: WorkflowDefinition;
  readonly context?: Partial<DefinitionCheckContext>;
}

const modules = { modules: () => MODULE_DEFINITION };

/** C113.5: one row per rule. */
export const GOLDEN_INVALID: readonly GoldenInvalid[] = [
  // Start and end.
  {
    code: 'trigger_missing',
    pointer: '/trigger',
    definition: { ...chain([]), trigger: null, edges: [] },
  },
  {
    code: 'module_input_missing',
    pointer: '/steps',
    definition: { ...chain([]), trigger: null, edges: [] },
    context: { kind: 'module' },
  },
  {
    code: 'start_repeated',
    pointer: '/trigger',
    definition: chain([]),
    context: { kind: 'module' },
  },
  {
    code: 'start_repeated',
    pointer: '/steps/0',
    definition: chain([{ id: 'start', type: 'module-input', name: 'In' }]),
  },
  {
    code: 'output_missing',
    pointer: '/steps',
    definition: { ...base, steps: [tag('a')], edges: [edge('e0', 'trigger', 'next', 'a')] },
  },
  // Edges and ports.
  {
    code: 'edge_endpoint_unknown',
    pointer: '/edges/2/to',
    definition: withEdges(base, edge('x', 'a', 'error', 'ghost')),
  },
  {
    code: 'edge_endpoint_unknown',
    pointer: '/edges/2/from',
    definition: withEdges(base, edge('x', 'ghost', 'next', 'a')),
  },
  {
    code: 'edge_port_unknown',
    pointer: '/edges/2/from-port',
    definition: withEdges(base, edge('x', 'a', 'else', 'output')),
  },
  {
    code: 'edge_port_unknown',
    pointer: '/edges/1/from-port',
    definition: {
      ...base,
      steps: [waitEvents('a'), output()],
      edges: [edge('e0', 'trigger', 'next', 'a'), edge('e1', 'a', 'error', 'output')],
    },
  },
  {
    code: 'port_repeated',
    pointer: '/edges/2/from-port',
    definition: withEdges(base, edge('x', 'a', 'next', 'output')),
  },
  {
    code: 'port_unconnected',
    pointer: '/steps/0',
    definition: { ...base, edges: [edge('e0', 'trigger', 'next', 'a')] },
  },
  {
    code: 'port_unconnected',
    pointer: '/trigger',
    definition: { ...base, edges: [edge('e1', 'a', 'next', 'output')] },
  },
  {
    code: 'port_unconnected',
    pointer: '/steps/0',
    definition: {
      ...base,
      steps: [conditional('a', [{ key: 'one', label: 'One', condition: true }]), output()],
      edges: [edge('e0', 'trigger', 'next', 'a'), edge('e1', 'a', 'else', 'output')],
    },
  },
  // Reach.
  {
    code: 'node_unreachable',
    pointer: '/steps/1',
    definition: {
      ...base,
      steps: [tag('a'), tag('lost'), output()],
      edges: [...base.edges, edge('x', 'lost', 'next', 'output')],
    },
  },
  {
    code: 'output_unreachable',
    pointer: '/steps/1',
    definition: {
      ...base,
      steps: [tag('a'), tag('dead'), output()],
      edges: [
        edge('e0', 'trigger', 'next', 'a'),
        edge('e1', 'a', 'next', 'output'),
        edge('e2', 'a', 'error', 'dead'),
      ],
    },
  },
  // Cycles.
  {
    code: 'cycle_refused',
    pointer: '/edges',
    definition: withEdges(base, edge('x', 'a', 'error', 'a')),
  },
  {
    code: 'continue_port_invalid',
    pointer: '/edges/2/to-port',
    definition: withEdges(base, { ...edge('x', 'a', 'error', 'output'), 'to-port': 'continue' }),
  },
  // Parallels.
  {
    code: 'join_missing',
    pointer: '/steps/0',
    definition: {
      ...parallel(),
      steps: [parallelStep(), tag('one'), tag('two'), output()],
      edges: [
        edge('e1', 'trigger', 'next', 'fork'),
        edge('e2', 'fork', 'branch:a', 'one'),
        edge('e3', 'fork', 'branch:b', 'two'),
        edge('e4', 'one', 'next', 'output'),
        edge('e5', 'two', 'next', 'output'),
      ],
    },
  },
  {
    code: 'join_of_invalid',
    pointer: '/steps/1/join-of',
    definition: chain([tag('a'), joinStep('meet', 'a')]),
  },
  {
    code: 'join_repeated',
    pointer: '/steps/4',
    definition: {
      ...parallel(),
      steps: [parallelStep(), tag('one'), tag('two'), joinStep(), joinStep('again'), output()],
      edges: [...parallel().edges, edge('x', 'again', 'next', 'output')],
    },
  },
  {
    code: 'branch_not_joined',
    pointer: '/steps/0/branches/1',
    definition: {
      ...parallel(),
      edges: parallel().edges.map((item) =>
        item.id === 'e5' ? edge('e5', 'two', 'next', 'output') : item,
      ),
    },
  },
  {
    code: 'branch_leaves',
    pointer: '/steps/2',
    definition: {
      ...parallel(),
      edges: parallel().edges.map((item) =>
        item.id === 'e4' ? edge('e4', 'one', 'next', 'two') : item,
      ),
    },
  },
  {
    code: 'branch_leaves',
    pointer: '/steps/3',
    definition: (() => {
      const before = parallel();
      return {
        ...before,
        steps: [
          before.steps[0],
          before.steps[1],
          before.steps[2],
          tag('escape'),
          joinStep(),
          output(),
        ] as WorkflowDefinition['steps'],
        edges: [
          ...before.edges,
          edge('x', 'one', 'error', 'escape'),
          edge('y', 'escape', 'next', 'output'),
        ],
      };
    })(),
  },
  {
    code: 'branch_entered',
    pointer: '/edges/7',
    definition: (() => {
      const before = parallel();
      return {
        ...before,
        steps: [tag('first'), ...before.steps],
        edges: [
          edge('e0', 'trigger', 'next', 'first'),
          edge('e1', 'first', 'next', 'fork'),
          ...before.edges.slice(1),
          edge('x', 'first', 'error', 'two'),
        ],
      };
    })(),
  },
  // Loops.
  {
    code: 'loop_body_open',
    pointer: '/steps/0',
    definition: {
      ...looped(forEach('each')),
      edges: looped(forEach('each')).edges.filter(({ id }) => id !== 'e3'),
    },
  },
  {
    code: 'loop_body_escapes',
    pointer: '/steps/2',
    definition: (() => {
      const before = looped(forEach('each'));
      return {
        ...before,
        steps: [...before.steps.slice(0, 2), tag('escape'), output()],
        edges: [
          ...before.edges,
          edge('x', 'inner', 'error', 'escape'),
          edge('y', 'escape', 'next', 'output'),
        ],
      };
    })(),
  },
  {
    code: 'loop_body_entered',
    pointer: '/edges/5',
    definition: (() => {
      const before = looped(forEach('each'));
      return {
        ...before,
        steps: [tag('first'), ...before.steps],
        edges: [
          edge('e0', 'trigger', 'next', 'first'),
          edge('e1', 'first', 'next', 'each'),
          ...before.edges.slice(1),
          edge('x', 'first', 'error', 'inner'),
        ],
      };
    })(),
  },
  {
    code: 'map_output_missing',
    pointer: '/steps/0',
    definition: looped({ ...forEach('each'), mode: 'map' } as WorkflowStep),
  },
  {
    code: 'map_of_invalid',
    pointer: '/steps/0/map-of',
    definition: chain([
      {
        id: 'collect',
        type: 'array-map-output',
        name: 'c',
        'map-of': 'nothing',
        value: 1,
      },
    ]),
  },
  {
    code: 'loop_concurrency_refused',
    pointer: '/steps/0/concurrency',
    definition: looped(whileLoop('each', true, { concurrency: 2 })),
  },
  { code: 'nesting_too_deep', pointer: '/steps/3', definition: nestedLoops(4) },
  // Modules.
  {
    code: 'module_nested',
    pointer: '/steps/1',
    definition: {
      ...chain([]),
      trigger: null,
      steps: steps([
        { id: 'start', type: 'module-input', name: 'In' },
        moduleStep('inner'),
        output(),
      ]),
      edges: [edge('e1', 'start', 'next', 'inner'), edge('e2', 'inner', 'next', 'output')],
    },
    context: { kind: 'module', ...modules },
  },
  {
    code: 'module_refused_for_trigger',
    pointer: '/steps/0',
    definition: chain([moduleStep('mod', { needed: 'x' })], {
      trigger: trigger({ type: 'trigger-account', config: {} }),
    }),
    context: modules,
  },
  {
    code: 'module_unknown',
    pointer: '/steps/0/module-workflow-id',
    definition: chain([moduleStep('mod')]),
    context: { modules: () => undefined },
  },
  {
    code: 'module_input_unknown',
    pointer: '/steps/0/inputs/other',
    definition: chain([moduleStep('mod', { needed: 'x', other: 'y' })]),
    context: modules,
  },
  {
    code: 'module_input_missing',
    pointer: '/steps/0/inputs',
    definition: chain([moduleStep('mod')]),
    context: modules,
  },
  {
    code: 'module_variables_refused',
    pointer: '/variables',
    definition: {
      ...MODULE_DEFINITION,
      variables: [{ name: 'risk', type: 'number' }],
    },
    context: { kind: 'module' },
  },
  // Actions.
  {
    code: 'action_unknown',
    pointer: '/steps/0/action-key',
    definition: chain([action('a', 'no_such_action', {})]),
  },
  {
    code: 'action_unknown',
    pointer: '/steps/0/action-key',
    definition: chain([action('a', 'tag_object', {}, { 'action-version': 99 })]),
  },
  {
    code: 'action_trigger_refused',
    pointer: '/steps/0/action-key',
    definition: base,
    context: { registry: restricted },
  },
  {
    code: 'action_requires_inquiry',
    pointer: '/steps/0',
    definition: chain(
      [
        action('face', 'add_face_list_item', {
          'list-id': LIST_ID,
          'inquiry-id': '{{ inputs.id }}',
        }),
      ],
      {
        trigger: trigger({ type: 'trigger-api', config: {} }),
        inputs: [{ name: 'id', type: 'id<inq>', required: true }],
      },
    ),
  },
  {
    code: 'action_refused_in_loop',
    pointer: '/steps/1',
    definition: looped(
      forEach('each'),
      action('inner', 'add_face_list_item', {
        'list-id': LIST_ID,
        'inquiry-id': '{{ trigger.id }}',
      }),
    ),
  },
  {
    code: 'config_invalid',
    pointer: '/steps/0/config/tag',
    definition: chain([action('a', 'tag_object', { 'object-type': 'inquiry', 'object-id': 'x' })]),
  },
  {
    code: 'config_too_large',
    pointer: '/steps/0/config',
    definition: chain([
      action('a', 'tag_object', {
        'object-type': 'inquiry',
        'object-id': 'x',
        tag: 'a'.repeat(17_000),
      }),
    ]),
  },
  {
    code: 'retry_refused',
    pointer: '/steps/0/retry',
    definition: chain([
      action(
        'a',
        'tag_object',
        { 'object-type': 'inquiry', 'object-id': 'x', tag: 'y' },
        {
          retry: { 'intervals-seconds': [5] },
        },
      ),
    ]),
  },
  // Variables and declarations.
  {
    code: 'variable_unknown',
    pointer: '/steps/0/config/name',
    definition: chain([
      action('a', 'update_variable', { name: 'nope', operator: 'set', value: 1 }),
    ]),
  },
  {
    code: 'variable_read_only',
    pointer: '/steps/1',
    definition: {
      ...MODULE_DEFINITION,
      steps: steps([
        { id: 'start', type: 'module-input', name: 'In' },
        action('a', 'update_variable', { name: 'x', operator: 'set', value: 1 }),
        output({ held: true }),
      ]),
      edges: [edge('e1', 'start', 'next', 'a'), edge('e2', 'a', 'next', 'output')],
    },
    context: { kind: 'module' },
  },
  {
    code: 'parallel_variable_conflict',
    pointer: '/steps/2',
    definition: {
      ...parallel(
        action('one', 'update_variable', { name: 'risk', operator: 'set', value: 1 }),
        action('two', 'update_variable', { name: 'risk', operator: 'set', value: 2 }),
      ),
      variables: [{ name: 'risk', type: 'number' }],
    },
  },
  {
    code: 'parallel_variable_conflict',
    pointer: '/steps/1',
    definition: {
      ...looped(
        forEach('each', 'trigger.tags', { concurrency: 2 }),
        action('inner', 'update_variable', { name: 'risk', operator: 'set', value: 1 }),
      ),
      variables: [{ name: 'risk', type: 'number' }],
    },
  },
  {
    code: 'type_invalid',
    pointer: '/inputs/0/type',
    definition: chain([], { inputs: [{ name: 'a', type: 'money', required: true }] }),
  },
  {
    code: 'type_invalid',
    pointer: '/variables/0/type',
    definition: chain([], { variables: [{ name: 'a', type: 'money' }] }),
  },
  {
    code: 'variable_default_invalid',
    pointer: '/variables/0/default',
    definition: chain([], { variables: [{ name: 'risk', type: 'number', default: 'high' }] }),
  },
  {
    code: 'output_mapping_missing',
    pointer: '/steps/0/mappings',
    definition: chain([], { outputs: [{ name: 'decision', pii: false }] }),
  },
  {
    code: 'output_mapping_unknown',
    pointer: '/steps/0/mappings/other',
    definition: { ...chain([]), steps: [output({ other: 1 })] },
  },
  // Conditions and paths.
  {
    code: 'condition_malformed',
    pointer: '/steps/0/routes/0/condition',
    definition: routed({ condition: { a: 1, b: 2 } }),
  },
  {
    code: 'operator_refused',
    pointer: '/steps/0/routes/0/condition/and/0',
    definition: routed({ condition: { and: [{ log: [1] }] } }),
  },
  {
    code: 'path_unknown',
    pointer: '/steps/0/routes/0/condition/var',
    definition: routed({ condition: { var: 'trigger.nope' } }),
  },
  {
    code: 'type_incomparable',
    pointer: '/steps/0/routes/0/condition',
    definition: routed({ condition: { '===': [{ var: 'trigger.status' }, 'not-a-status'] } }),
  },
  {
    code: 'pii_literal_in_condition',
    pointer: '/steps/0/routes/0/condition',
    definition: routed({
      condition: { '===': [{ var: 'trigger.fields.name' }, 'Ada'] },
      'on-null': 'error',
    }),
  },
  {
    code: 'nullable_in_boolean_position',
    pointer: '/steps/1/routes/0/condition/!/0/var',
    definition: routed(
      { condition: { '!': [{ var: 'steps.match.output.matched' }] }, 'on-null': 'error' },
      listMatch(),
    ),
  },
  {
    code: 'current_case_unavailable',
    pointer: '/steps/0/routes/0/condition/var',
    definition: routed({ condition: { var: 'current_case.status' } }),
  },
  // on-null at every position.
  {
    code: 'on_null_missing',
    pointer: '/steps/1/routes/0',
    definition: routed(
      { condition: { '===': [{ var: 'steps.match.output.matched' }, true] } },
      listMatch(),
    ),
  },
  {
    code: 'on_null_route_unknown',
    pointer: '/steps/0/routes/0/on-null',
    definition: routed({ condition: true, 'on-null': 'route:nowhere' }),
  },
  {
    code: 'on_null_missing',
    pointer: '/trigger/config',
    definition: chain([], {
      trigger: trigger({
        type: 'trigger-event',
        config: {
          events: ['inquiry.completed'],
          criteria: { '===': [{ var: 'trigger.account.id' }, 'x'] },
        },
      }),
    }),
  },
  {
    code: 'on_null_missing',
    pointer: '/trigger/config',
    definition: chain([], {
      trigger: trigger({
        type: 'trigger-recurring',
        config: {
          'every-minutes': 60,
          'time-zone': 'UTC',
          'object-type': 'inquiry',
          filter: { '===': [{ var: 'trigger.account.id' }, 'x'] },
        },
      }),
    }),
  },
  {
    code: 'on_null_missing',
    pointer: '/steps/0',
    definition: chain([waitEvents('a', { filter: { '===': [{ var: 'event.account.id' }, 'x'] } })]),
  },
  {
    code: 'on_null_missing',
    pointer: '/steps/1',
    definition: {
      ...looped(whileLoop('each', { '===': [{ var: 'steps.match.output.matched' }, true] })),
      steps: [
        listMatch(),
        ...looped(whileLoop('each', { '===': [{ var: 'steps.match.output.matched' }, true] }))
          .steps,
      ],
      edges: [
        edge('e0', 'trigger', 'next', 'match'),
        edge('e1', 'match', 'next', 'each'),
        ...looped(whileLoop('each', true)).edges.slice(1),
      ],
    },
  },
  {
    code: 'on_null_missing',
    pointer: '/steps/1/routes/0/condition',
    definition: routed(
      {
        condition: {
          some: [{ var: 'steps.match.output.matches' }, { '>': [{ var: 'confidence' }, 0.5] }],
        },
      },
      listMatch(),
    ),
  },
  // Loops and waits.
  {
    code: 'path_invalid',
    pointer: '/steps/0/items',
    definition: looped(forEach('each', 'a b')),
  },
  {
    code: 'loop_items_invalid',
    pointer: '/steps/0/items',
    definition: looped(forEach('each', 'trigger.status')),
  },
  {
    code: 'path_unknown',
    pointer: '/steps/0/items',
    definition: looped(forEach('each', 'trigger.nope')),
  },
  {
    code: 'path_invalid',
    pointer: '/steps/0/subject',
    definition: chain([waitEvents('a', { subject: 'a b' })]),
  },
  {
    code: 'wait_subject_invalid',
    pointer: '/steps/0/subject',
    definition: chain([waitEvents('a', { subject: 'trigger.tags' })]),
  },
  // Templates.
  {
    code: 'template_invalid',
    pointer: '/steps/0/config/tag',
    definition: chain([tag('a', '{{ trigger.id | upper }}')]),
  },
  {
    code: 'path_unknown',
    pointer: '/steps/0/config/tag',
    definition: chain([tag('a', '{{ trigger.nope }}')]),
  },
  {
    code: 'path_unknown',
    pointer: '/steps/0/inputs/needed',
    definition: chain([moduleStep('mod', { needed: '{{ steps.nope.output }}' })]),
    context: modules,
  },
  {
    code: 'path_unknown',
    pointer: '/steps/0/mappings/decision',
    definition: {
      ...chain([]),
      outputs: [{ name: 'decision', pii: false }],
      steps: [output({ decision: '{{ vars.nope }}' })],
    },
  },
  {
    code: 'secret_placement_refused',
    pointer: '/steps/0/config/tag',
    definition: chain([tag('a', '{{ secrets.api_key }}')]),
  },
  {
    code: 'secret_placement_refused',
    pointer: '/steps/0/mappings/decision',
    definition: {
      ...chain([]),
      outputs: [{ name: 'decision', pii: false }],
      steps: [output({ decision: '{{ secrets.api_key }}' })],
    },
  },
  // The publish rules of C118.4, C115.6, C122.1, C127.2 and C127.5.
  {
    code: 'literal_member_refused',
    pointer: '/steps/0/config/status',
    definition: chain([
      action('a', 'update_transaction_status', {
        'transaction-id': '{{ trigger.id }}',
        status: '{{ trigger.status }}',
      }),
    ]),
  },
  {
    code: 'has_match_refused',
    pointer: '/steps/0',
    definition: chain([
      action('a', 'run_report', {
        'report-template-id': 'rptp_1',
        'inquiry-id': '{{ trigger.id }}',
      }),
      tag('b', '{{ steps.a.output.has-match }}'),
    ]),
    context: { reportReviewModel: () => 'none' },
  },
  {
    code: 'account_count_refused',
    pointer: '/steps/0',
    definition: chain([
      action('a', 'run_graph_query', {
        'graph-query-template-id': 'grqt_1',
        'account-id': '{{ trigger.account.id }}',
        mode: 'asynchronous',
      }),
      tag('b', '{{ steps.a.output.account-count }}'),
    ]),
  },
  {
    code: 'schedule_invalid',
    pointer: '/trigger/config',
    definition: chain([], {
      trigger: trigger({
        type: 'trigger-recurring',
        config: { cron: 'H 9 * * *', 'time-zone': 'UTC', 'object-type': 'inquiry' },
      }),
    }),
  },
  {
    code: 'schedule_zone_invalid',
    pointer: '/trigger/config',
    definition: chain([], {
      trigger: trigger({
        type: 'trigger-recurring',
        config: { cron: '0 9 * * *', 'time-zone': 'Mars/Base', 'object-type': 'inquiry' },
      }),
    }),
  },
  {
    code: 'pii_into_plain_sink',
    pointer: '/steps/0/config/tag',
    definition: chain([tag('a', '{{ trigger.fields.name }}')]),
  },
  {
    code: 'pii_in_url',
    pointer: '/steps/0/config/url',
    definition: chain([
      action('a', 'make_https_request', {
        method: 'GET',
        url: 'https://api.example.com/{{ trigger.fields.name }}',
      }),
    ]),
  },
];
