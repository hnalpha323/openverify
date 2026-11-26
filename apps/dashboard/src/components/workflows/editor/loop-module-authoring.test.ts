import { describe, expect, it } from 'vitest';
import {
  onNullChoicesOf,
  operatorsFor,
  readCondition,
  writeCondition,
  type Clause,
} from './condition-model';
import {
  connectContinue,
  continueTargets,
  insertStep,
  type DraftDefinition,
  type DraftStep,
} from './document-model';
import { paletteOf } from './palette-model';
import { CONTINUE_PORT, edgeOn } from './port-rules';

const stepOf = (definition: DraftDefinition, id: string): DraftStep | undefined =>
  definition.steps.find((step) => step.id === id);

const MODULE = { id: 'wfl_01JB0000000000000000000007', name: 'Synthetic screening' };

const base: DraftDefinition = {
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  steps: [{ id: 'output', name: 'Output', type: 'output', mappings: {} }],
  edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
  outputs: [],
  layout: {},
};

/** A for-each loop whose body holds one action, not yet led back to the loop. */
const looped: DraftDefinition = {
  ...base,
  steps: [
    { id: 'each', name: 'Each item', type: 'loop', mode: 'for-each', items: 'trigger.items' },
    {
      id: 'tag',
      name: 'Tag',
      type: 'action',
      'action-key': 'calculate',
      'action-version': 1,
      config: {},
    },
    {
      id: 'after',
      name: 'After',
      type: 'action',
      'action-key': 'calculate',
      'action-version': 1,
      config: {},
    },
    ...base.steps,
  ],
  edges: [
    { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'each' },
    { id: 'e2', from: 'each', 'from-port': 'body', to: 'tag' },
    { id: 'e3', from: 'each', 'from-port': 'done', to: 'after' },
    { id: 'e4', from: 'after', 'from-port': 'next', to: 'output' },
  ],
};

describe('loop and module steps in the workflow palette (R005, C113.2)', () => {
  it('offers the three loops and the modules listed, a module refused while none is', () => {
    const plain = paletteOf([], 'trigger-api');
    expect(plain.filter((entry) => entry.group === 'steps').map((entry) => entry.id)).toEqual([
      'step:wait-time',
      'step:wait-events',
      'step:conditional',
      'step:parallel',
      'step:loop-for-each',
      'step:loop-while',
      'step:loop-map',
      'step:module',
    ]);
    expect(plain.find((entry) => entry.id === 'step:module')?.refusal).toMatch(/No workflow/);

    const withModule = paletteOf([], 'trigger-api', [MODULE]);
    const module = withModule.find((entry) => entry.id === `module:${MODULE.id}`);
    expect(module?.refusal).toBeNull();
    expect(module?.template).toEqual({ kind: 'module', workflowId: MODULE.id, name: MODULE.name });
    expect(withModule.some((entry) => entry.id === 'step:module')).toBe(false);
  });

  it('inserts a for-each loop: its done leads on, its body waits for steps', () => {
    const edited = insertStep(base, { from: 'trigger', port: 'next' }, { kind: 'loop-for-each' });

    const loop = edited === null ? undefined : stepOf(edited.definition, edited.select);
    expect(loop).toMatchObject({ type: 'loop', mode: 'for-each' });
    expect(typeof loop?.items).toBe('string');
    expect(edited && edgeOn(edited.definition, edited.select, 'done')?.to).toBe('output');
    expect(edited && edgeOn(edited.definition, edited.select, 'body')).toBeUndefined();
  });

  it('inserts a while loop with its bound, and a map loop', () => {
    const whileLoop = insertStep(base, { from: 'trigger', port: 'next' }, { kind: 'loop-while' });
    const map = insertStep(base, { from: 'trigger', port: 'next' }, { kind: 'loop-map' });

    const step = whileLoop === null ? undefined : stepOf(whileLoop.definition, whileLoop.select);
    expect(step).toMatchObject({ type: 'loop', mode: 'while' });
    expect(step?.['max-iterations']).toEqual(expect.any(Number));
    expect(map === null ? undefined : stepOf(map.definition, map.select)).toMatchObject({
      type: 'loop',
      mode: 'map',
    });
  });

  it('inserts a module step for the chosen workflow, at its latest published version', () => {
    const edited = insertStep(
      base,
      { from: 'trigger', port: 'next' },
      { kind: 'module', workflowId: MODULE.id, name: MODULE.name },
    );

    const step = edited === null ? undefined : stepOf(edited.definition, edited.select);
    expect(step).toMatchObject({
      type: 'module',
      'module-workflow-id': MODULE.id,
      version: 'latest-published',
      inputs: {},
    });
    expect(edited && edgeOn(edited.definition, edited.select, 'next')?.to).toBe('output');
  });
});

describe('a loop body’s back-edge into continue (R005, C113.3)', () => {
  it('offers the loop whose body reaches a step, and only for steps in a body', () => {
    expect(continueTargets(looped, 'tag')).toEqual(['each']);
    expect(continueTargets(looped, 'after')).toEqual([]);
  });

  it('leads the step’s next back into the loop’s continue port', () => {
    const edited = connectContinue(looped, 'tag', 'each');

    expect(edited?.definition.edges).toContainEqual(
      expect.objectContaining({
        from: 'tag',
        'from-port': 'next',
        to: 'each',
        'to-port': CONTINUE_PORT,
      }),
    );
    expect(connectContinue(looped, 'after', 'each')).toBeNull();
  });
});

describe('the condition builder’s while and list-predicate positions (R005, C114.6)', () => {
  it('offers a while loop’s on-null choices, error and stop, in words', () => {
    expect(onNullChoicesOf('while').map((choice) => choice.value)).toEqual(['error', 'stop']);
    expect(onNullChoicesOf('while').every((choice) => choice.label !== choice.value)).toBe(true);
  });

  it('writes and reads a list predicate with its own on-null', () => {
    const clause: Clause = {
      path: 'trigger.tags',
      operator: 'any-is',
      value: 'vip',
      predicateOnNull: 'exclude',
    };
    const written = writeCondition([[clause]]);

    expect(written).toEqual({
      some: [{ var: 'trigger.tags' }, { '===': [{ var: '' }, 'vip'] }, 'exclude'],
    });
    expect(readCondition(written)).toEqual([[clause]]);
    expect(
      readCondition({ none: [{ var: 'trigger.tags' }, { '===': [{ var: '' }, 'vip'] }] }),
    ).toEqual([[{ path: 'trigger.tags', operator: 'none-is', value: 'vip' }]]);
    expect(
      operatorsFor({
        path: 'trigger.tags',
        type: 'list',
        options: [],
        nullable: false,
        pii: false,
        source: 'Trigger',
      }),
    ).toEqual(['any-is', 'all-are', 'none-is']);
  });
});
