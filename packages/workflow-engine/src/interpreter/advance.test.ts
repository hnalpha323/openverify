/** C117.1: `advance` is pure, and golden graphs pin every node type and edge (C119). */
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { readWorkflowFixture } from '../definition/testing.js';
import {
  conditional,
  forEach,
  joinStep,
  looped,
  moduleStep,
  parallel,
  parallelStep,
  routed,
  waitEvents,
  whileLoop,
} from '../graph/golden-invalid.js';
import { action, backEdge, chain, edge, output, tag } from '../graph/testing.js';
import { WORKFLOW_RUN_LIMITS } from '../limits/index.js';
import { advance, effectKey, runScope, startRun, stepKey } from './advance.js';
import { NOW, SEED, drive, outputOf } from './testing.js';

const sum = (id: string, operands: readonly unknown[], extra: object = {}): WorkflowStep =>
  action(id, 'calculate', { operator: 'sum', operands, ...extra });

const update = (id: string, name: string, operator: string, value?: unknown): WorkflowStep =>
  action(id, 'update_variable', { name, operator, ...(value === undefined ? {} : { value }) });

const variables = (...names: readonly string[]): WorkflowDefinition['variables'] =>
  names.map((name) => ({ name, type: 'list<string>' }));

describe('a chain (C117.1)', () => {
  it('runs each action, then the output node, and completes', () => {
    const trace = drive(chain([tag('a'), tag('b')]));
    expect(trace.steps).toEqual(['a', 'b', 'output']);
    expect(trace.state.status).toBe('completed');
    expect(trace.state.stepExecutions).toBe(3);
  });

  it('asks for one effectful step at a time, with its key and version', () => {
    const { stepsToMakeReady } = startRun(chain([tag('a'), tag('b')]), SEED);
    expect(stepsToMakeReady).toEqual([
      { kind: 'action', nodeId: 'a', iterationPath: '', actionKey: 'tag_object', actionVersion: 1 },
    ]);
  });

  it('is pure: the same input gives the same answer, and leaves its input alone', () => {
    const definition = chain([tag('a')]);
    const state = startRun(definition, SEED).nextState;
    const before = JSON.stringify(state);
    const completed = {
      kind: 'step',
      nodeId: 'a',
      iterationPath: '',
      outcome: 'succeeded',
      output: { outcome: 'applied' },
    } as const;
    const first = advance(definition, state, completed);
    const second = advance(definition, state, completed);
    expect(first).toEqual(second);
    expect(JSON.stringify(state)).toBe(before);
    expect(first.nextState).not.toBe(state);
  });

  it('records a step output where later steps read it', () => {
    const trace = drive(chain([tag('a')]), { a: { outcome: 'applied' } });
    expect(outputOf(trace, 'a')).toEqual({ outcome: 'applied' });
  });

  it('evaluates the output node into the run outputs (C119.10)', () => {
    const definition = {
      ...chain([tag('a')]),
      outputs: [
        { name: 'what', pii: false },
        { name: 'label', pii: false },
      ],
      steps: [
        tag('a'),
        output({ what: '{{ steps.a.output.outcome }}', label: 'id {{ trigger.id }}' }),
      ],
    };
    const trace = drive(definition, { a: { outcome: 'applied' } });
    expect(trace.state.runOutputs).toEqual({ what: 'applied', label: 'id inq_1' });
    expect(trace.state.status).toBe('completed');
  });

  it('ends errored when a mapping cannot render', () => {
    const definition = {
      ...chain([]),
      outputs: [{ name: 'what', pii: false }],
      steps: [output({ what: '{{ trigger.absent }}' })],
    };
    const trace = drive(definition);
    expect(trace.state.status).toBe('errored');
    expect(trace.state.failures).toEqual([
      { nodeId: 'output', iterationPath: '', code: 'template_variable_missing' },
    ]);
  });

  it('sets variable defaults and leaves the rest unset (C115.4)', () => {
    const definition = chain([], {
      variables: [
        { name: 'risk', type: 'number', default: 2 },
        { name: 'later', type: 'string' },
      ],
    });
    expect(startRun(definition, SEED).nextState.variables).toEqual({ risk: 2 });
  });
});

describe('errors and edges (C119.7)', () => {
  const risky = (extra: object = {}) =>
    action('risky', 'tag_object', { 'object-type': 'inquiry', 'object-id': 'x', tag: 'y' }, extra);

  it('ends the run errored with the step and its code', () => {
    const trace = drive(chain([risky(), tag('b')]), { risky: { fail: 'list_unavailable' } });
    expect(trace.steps).toEqual(['risky']);
    expect(trace.state.status).toBe('errored');
    expect(trace.state.failures).toEqual([
      { nodeId: 'risky', iterationPath: '', code: 'list_unavailable' },
    ]);
  });

  it('continue-on-error records the failure and follows next', () => {
    const trace = drive(chain([risky({ 'continue-on-error': true }), tag('b')]), {
      risky: { fail: 'list_unavailable' },
    });
    expect(trace.steps).toEqual(['risky', 'b', 'output']);
    expect(trace.state.status).toBe('completed');
    expect(outputOf(trace, 'risky')).toBeNull();
    expect(trace.executed).toContainEqual({
      nodeId: 'risky',
      iterationPath: '',
      status: 'failed',
      output: null,
      code: 'list_unavailable',
    });
  });

  function withErrorEdge(extra: object = {}): WorkflowDefinition {
    return chain([], {
      steps: [risky(extra), tag('recover'), tag('after'), output()],
      edges: [
        edge('e1', 'trigger', 'next', 'risky'),
        edge('e2', 'risky', 'next', 'after'),
        edge('e3', 'risky', 'error', 'recover'),
        edge('e4', 'recover', 'next', 'after'),
        edge('e5', 'after', 'next', 'output'),
      ],
    });
  }

  it('follows an error edge', () => {
    const trace = drive(withErrorEdge(), { risky: { fail: 'list_unavailable' } });
    expect(trace.steps).toEqual(['risky', 'recover', 'after', 'output']);
    expect(trace.state.status).toBe('completed');
  });

  it('an error edge takes precedence over continue-on-error', () => {
    const definition = withErrorEdge({ 'continue-on-error': true });
    const trace = drive(definition, { risky: { fail: 'list_unavailable' } });
    expect(trace.steps).toEqual(['risky', 'recover', 'after', 'output']);
  });

  it('does not follow the error edge on success', () => {
    expect(drive(withErrorEdge()).steps).toEqual(['risky', 'after', 'output']);
  });
});

describe('a wait (C119.2, C119.3)', () => {
  it('asks for a time wait with its seconds', () => {
    const wait = {
      id: 'pause',
      type: 'wait',
      name: 'p',
      mode: 'time',
      seconds: 60,
    } as WorkflowStep;
    const { stepsToMakeReady } = startRun(chain([wait]), SEED);
    expect(stepsToMakeReady).toEqual([
      { kind: 'wait-time', nodeId: 'pause', iterationPath: '', seconds: 60 },
    ]);
  });

  it('asks for an event wait with its correlation key', () => {
    const { stepsToMakeReady } = startRun(chain([waitEvents('held')]), SEED);
    expect(stepsToMakeReady).toEqual([
      {
        kind: 'wait-events',
        nodeId: 'held',
        iterationPath: '',
        correlationKey: 'inq_1',
        events: ['inquiry.approved'],
        timeoutSeconds: 60,
      },
    ]);
  });

  it('follows next on an event', () => {
    const output = { 'resolved-by': 'event', 'event-id': 'evt_1' };
    const trace = drive(chain([waitEvents('held'), tag('b')]), { held: output });
    expect(trace.steps).toEqual(['held', 'b', 'output']);
    expect(outputOf(trace, 'held')).toEqual(output);
  });

  it('follows next on a timeout with on-timeout continue, saying which', () => {
    const timedOut = { 'resolved-by': 'timeout' };
    const trace = drive(chain([waitEvents('held'), tag('b')]), { held: { timeout: timedOut } });
    expect(trace.steps).toEqual(['held', 'b', 'output']);
    expect(outputOf(trace, 'held')).toEqual(timedOut);
    expect(trace.executed).toContainEqual({
      nodeId: 'held',
      iterationPath: '',
      status: 'timed_out',
      output: timedOut,
      code: null,
    });
  });

  it('errors the run on a timeout with on-timeout error', () => {
    const definition = chain([waitEvents('held', { 'on-timeout': 'error' }), tag('b')]);
    const trace = drive(definition, { held: { timeout: { 'resolved-by': 'timeout' } } });
    expect(trace.state.failures).toEqual([
      { nodeId: 'held', iterationPath: '', code: 'wait_timed_out' },
    ]);
  });

  it('fails a wait whose subject reads null, never waiting on nothing', () => {
    const definition = chain([waitEvents('held', { subject: 'trigger.none' })]);
    expect(drive(definition).state.failures).toEqual([
      { nodeId: 'held', iterationPath: '', code: 'template_variable_missing' },
    ]);
  });
});

describe('a conditional (C119.5)', () => {
  const taken = (route: object) => drive(routed(route));

  it('records the route it took, which the decision record reads', () => {
    const trace = taken({ condition: { '===': [{ var: 'trigger.status' }, 'completed'] } });
    expect(outputOf(trace, 'a')).toEqual({ route: 'one' });
    expect(trace.state.status).toBe('completed');
  });

  it('records else', () => {
    expect(outputOf(taken({ condition: false }), 'a')).toEqual({ route: 'else' });
  });

  it('runs inside the advance that reached it (C117.3)', () => {
    const { stepsToMakeReady, executed } = startRun(routed({ condition: true }), SEED);
    expect(stepsToMakeReady).toEqual([]);
    expect(executed.map(({ nodeId }) => nodeId)).toEqual(['a', 'output']);
  });

  it('follows the taken route to its own step', () => {
    const definition = chain([], {
      steps: [
        conditional('decide', [
          { key: 'yes', label: 'Yes', condition: { '<': [{ var: 'trigger.score' }, 5] } },
          { key: 'no', label: 'No', condition: { '>': [{ var: 'trigger.score' }, 5] } },
        ]),
        tag('low'),
        tag('high'),
        tag('neither'),
        output(),
      ],
      edges: [
        edge('e1', 'trigger', 'next', 'decide'),
        edge('e2', 'decide', 'route:yes', 'low'),
        edge('e3', 'decide', 'route:no', 'high'),
        edge('e4', 'decide', 'else', 'neither'),
        edge('e5', 'low', 'next', 'output'),
        edge('e6', 'high', 'next', 'output'),
        edge('e7', 'neither', 'next', 'output'),
      ],
    });
    expect(drive(definition).steps).toEqual(['decide', 'high', 'output']);
  });

  it('errors on a null with on-null error (C114.6)', () => {
    const trace = taken({ condition: { '<': [{ var: 'trigger.none' }, 5] }, 'on-null': 'error' });
    expect(trace.state.failures).toEqual([
      { nodeId: 'a', iterationPath: '', code: 'condition_input_null' },
    ]);
  });

  it('takes else on an expression error when it continues on error', () => {
    const definition = routed({ condition: { '/': [1, 0] } });
    const steps = definition.steps.map((step) =>
      step.id === 'a' ? { ...step, 'continue-on-error': true } : step,
    ) as WorkflowDefinition['steps'];
    const trace = drive({ ...definition, steps });
    expect(outputOf(trace, 'a')).toEqual({ route: 'else' });
    expect(trace.state.status).toBe('completed');
  });

  it('errors on an expression error otherwise', () => {
    const trace = taken({ condition: { '/': [1, 0] } });
    expect(trace.state.failures).toEqual([
      { nodeId: 'a', iterationPath: '', code: 'expression_arithmetic_error' },
    ]);
  });
});

describe('a parallel (C119.4)', () => {
  it('starts every branch and joins once', () => {
    const trace = drive(parallel());
    expect(trace.steps).toEqual(['fork', 'one', 'two', 'meet', 'output']);
    expect(trace.state.status).toBe('completed');
  });

  it('asks for both branches at once', () => {
    const { stepsToMakeReady } = startRun(parallel(), SEED);
    expect(stepsToMakeReady.map(({ nodeId }) => nodeId)).toEqual(['one', 'two']);
  });

  it('keeps the join waiting until the last branch', () => {
    const trace = drive(parallel(), {}, {}, { hold: ['two'] });
    expect(trace.steps).toEqual(['fork', 'one']);
    expect(trace.pending).toEqual(['two']);
    expect(trace.state.status).toBe('in_progress');
    expect(trace.state.joins.meet).toMatchObject({ open: 1, failed: 0 });
  });

  it('reads both branches after the join', () => {
    const definition = {
      ...parallel(),
      outputs: [{ name: 'both', pii: false }],
      steps: [
        ...parallel().steps.slice(0, -1),
        output({ both: '{{ steps.one.output.ok }}/{{ steps.two.output.ok }}' }),
      ],
    };
    expect(drive(definition).state.runOutputs).toEqual({ both: 'true/true' });
  });

  it('every branch finishes, then a failed branch fails the parallel', () => {
    const trace = drive(parallel(), { one: { fail: 'list_unavailable' } }, {}, { hold: ['two'] });
    expect(trace.state.status).toBe('in_progress');
    const finished = advance(parallel(), trace.state, {
      kind: 'step',
      nodeId: 'two',
      iterationPath: '',
      outcome: 'succeeded',
      output: { ok: true },
    });
    expect(finished.nextState.status).toBe('errored');
    expect(finished.nextState.failures).toEqual([
      { nodeId: 'one', iterationPath: '', code: 'list_unavailable' },
    ]);
  });

  it('a failing step that continues on error does not fail the parallel', () => {
    const lenient = action(
      'one',
      'tag_object',
      { 'object-type': 'inquiry', 'object-id': 'x', tag: 'y' },
      { 'continue-on-error': true },
    );
    const trace = drive(parallel(lenient), { one: { fail: 'list_unavailable' } });
    expect(trace.state.status).toBe('completed');
  });

  it('records every branch that failed', () => {
    const trace = drive(parallel(), { one: { fail: 'a_code' }, two: { fail: 'b_code' } });
    expect(trace.state.status).toBe('errored');
    expect(trace.state.failures.map(({ nodeId }) => nodeId)).toEqual(['one', 'two']);
  });

  it('runs a nested parallel, and fails outward', () => {
    const inner = parallelStep('inner', ['x', 'y']);
    const definition = chain([], {
      steps: [
        parallelStep(),
        inner,
        tag('x1'),
        tag('y1'),
        joinStep('inner_meet', 'inner'),
        tag('two'),
        joinStep(),
        output(),
      ],
      edges: [
        edge('e1', 'trigger', 'next', 'fork'),
        edge('e2', 'fork', 'branch:a', 'inner'),
        edge('e3', 'fork', 'branch:b', 'two'),
        edge('e4', 'inner', 'branch:x', 'x1'),
        edge('e5', 'inner', 'branch:y', 'y1'),
        edge('e6', 'x1', 'next', 'inner_meet'),
        edge('e7', 'y1', 'next', 'inner_meet'),
        edge('e8', 'inner_meet', 'next', 'meet'),
        edge('e9', 'two', 'next', 'meet'),
        edge('e10', 'meet', 'next', 'output'),
      ],
    });
    expect(drive(definition).state.status).toBe('completed');
    const failed = drive(definition, { x1: { fail: 'a_code' } });
    expect(failed.state.status).toBe('errored');
    expect(failed.state.failures).toEqual([{ nodeId: 'x1', iterationPath: '', code: 'a_code' }]);
  });
});

describe('a for-each loop (C119.6)', () => {
  const each = (extra: object = {}) => forEach('each', 'trigger.tags', extra);

  it('runs its body once per item, with its own iteration path', () => {
    const trace = drive(looped(each()));
    expect(trace.steps).toEqual([
      'each[0]/inner',
      'each[1]/inner',
      'each[2]/inner',
      'each',
      'output',
    ]);
    expect(outputOf(trace, 'each')).toEqual({ iterations: 3 });
  });

  it('reads the item and the index in the body', () => {
    const definition = looped(each());
    const started = startRun(definition, SEED);
    const [first] = started.stepsToMakeReady;
    expect(first?.iterationPath).toBe('each[0]/');
    expect(runScope(started.nextState, 'each[0]/').roots.loop).toEqual({ item: 'vip', index: 0 });
    const scope = runScope(started.nextState, 'each[1]/');
    expect(scope.roots.loop).toEqual({ item: 'beta', index: 1 });
  });

  it('skips the body of an empty list', () => {
    const trace = drive(looped(each()), {}, {}, { seed: { trigger: { tags: [] } } });
    expect(trace.steps).toEqual(['each', 'output']);
  });

  it('errors a list over the limit, never truncating it (C117.7)', () => {
    const tags = Array.from({ length: WORKFLOW_RUN_LIMITS['loop-items'].value + 1 }, String);
    const trace = drive(looped(each()), {}, {}, { seed: { trigger: { tags } } });
    expect(trace.state.failures).toEqual([
      { nodeId: 'each', iterationPath: '', code: 'loop_limit_exceeded' },
    ]);
  });

  it('runs a list at the limit', () => {
    const tags = Array.from({ length: WORKFLOW_RUN_LIMITS['loop-items'].value }, String);
    const trace = drive(looped(each()), {}, {}, { seed: { trigger: { tags } } });
    expect(trace.state.status).toBe('completed');
  });

  it('errors a value that is no list', () => {
    const trace = drive(looped(each()), {}, {}, { seed: { trigger: { tags: 'vip' } } });
    expect(trace.state.failures).toEqual([
      { nodeId: 'each', iterationPath: '', code: 'loop_items_invalid' },
    ]);
  });

  it('errors a null list, never reading it as empty', () => {
    const trace = drive(looped(each()), {}, {}, { seed: { trigger: { tags: null } } });
    expect(trace.state.failures).toEqual([
      { nodeId: 'each', iterationPath: '', code: 'condition_input_null' },
    ]);
  });

  it('runs one iteration at a time by default', () => {
    const started = startRun(looped(each()), SEED);
    expect(started.stepsToMakeReady.map(({ iterationPath }) => iterationPath)).toEqual([
      'each[0]/',
    ]);
  });

  it('runs up to its concurrency at once', () => {
    const started = startRun(looped(each({ concurrency: 2 })), SEED);
    expect(started.stepsToMakeReady.map(({ iterationPath }) => iterationPath)).toEqual([
      'each[0]/',
      'each[1]/',
    ]);
    expect(drive(looped(each({ concurrency: 2 }))).state.status).toBe('completed');
  });

  it('stops starting iterations after a failure, and fails once the open ones finish', () => {
    const trace = drive(looped(each({ concurrency: 2 })), { 'each[0]/inner': { fail: 'a_code' } });
    expect(trace.steps).toEqual(['each[0]/inner', 'each[1]/inner']);
    expect(trace.state.status).toBe('errored');
    expect(trace.state.failures).toEqual([
      { nodeId: 'inner', iterationPath: 'each[0]/', code: 'a_code' },
    ]);
  });

  it('a loop that continues on error goes on to done', () => {
    const trace = drive(looped(each({ 'continue-on-error': true })), {
      'each[1]/inner': { fail: 'a_code' },
    });
    expect(trace.state.status).toBe('completed');
    expect(trace.steps).toEqual(['each[0]/inner', 'each[1]/inner', 'output']);
  });

  it('forgets every failure of its iterations when it absorbs them', () => {
    const concurrent = looped(each({ concurrency: 3, 'continue-on-error': true }));
    const trace = drive(concurrent, {
      'each[0]/inner': { fail: 'a_code' },
      'each[1]/inner': { fail: 'b_code' },
    });
    expect(trace.state.status).toBe('completed');
    expect(trace.state.failures).toEqual([]);
  });

  it('a loop with an error edge follows it', () => {
    const definition = looped(each());
    const withEdge = {
      ...definition,
      steps: [tag('recover'), ...definition.steps],
      edges: [
        ...definition.edges,
        edge('x', 'each', 'error', 'recover'),
        edge('y', 'recover', 'next', 'output'),
      ],
    };
    const trace = drive(withEdge, { 'each[0]/inner': { fail: 'a_code' } });
    expect(trace.steps).toEqual(['each[0]/inner', 'recover', 'output']);
  });

  it('a body step that continues on error goes on to the next iteration', () => {
    const inner = action(
      'inner',
      'tag_object',
      { 'object-type': 'inquiry', 'object-id': 'x', tag: 'y' },
      { 'continue-on-error': true },
    );
    const trace = drive(looped(each(), inner), { 'each[0]/inner': { fail: 'a_code' } });
    expect(trace.state.status).toBe('completed');
    expect(outputOf(trace, 'each')).toEqual({ iterations: 3 });
  });

  it('nests, each level with its own path', () => {
    const outer = forEach('outer', 'trigger.tags');
    const inner = forEach('inner', 'trigger.tags');
    const definition = chain([], {
      steps: [outer, inner, tag('leaf'), output()],
      edges: [
        edge('e1', 'trigger', 'next', 'outer'),
        edge('e2', 'outer', 'body', 'inner'),
        edge('e3', 'inner', 'body', 'leaf'),
        backEdge('e4', 'leaf', 'inner'),
        { ...backEdge('e5', 'inner', 'outer'), 'from-port': 'done' },
        edge('e6', 'outer', 'done', 'output'),
      ],
    });
    const trace = drive(definition, {}, {}, { seed: { trigger: { tags: ['a', 'b'] } } });
    expect(trace.steps.filter((key) => key.endsWith('leaf'))).toEqual([
      'outer[0]/inner[0]/leaf',
      'outer[0]/inner[1]/leaf',
      'outer[1]/inner[0]/leaf',
      'outer[1]/inner[1]/leaf',
    ]);
    expect(trace.state.status).toBe('completed');
  });

  it('runs a parallel inside a loop, each iteration with its own join', () => {
    const definition = chain([], {
      steps: [forEach('each'), parallelStep(), tag('one'), tag('two'), joinStep(), output()],
      edges: [
        edge('e1', 'trigger', 'next', 'each'),
        edge('e2', 'each', 'body', 'fork'),
        edge('e3', 'fork', 'branch:a', 'one'),
        edge('e4', 'fork', 'branch:b', 'two'),
        edge('e5', 'one', 'next', 'meet'),
        edge('e6', 'two', 'next', 'meet'),
        backEdge('e7', 'meet', 'each'),
        edge('e8', 'each', 'done', 'output'),
      ],
    });
    const trace = drive(definition, {}, {}, { seed: { trigger: { tags: ['a', 'b'] } } });
    expect(trace.state.status).toBe('completed');
    expect(trace.steps).toContain('each[1]/meet');
    const failed = drive(
      definition,
      { 'each[0]/two': { fail: 'a_code' } },
      {},
      {
        seed: { trigger: { tags: ['a', 'b'] } },
      },
    );
    expect(failed.state.status).toBe('errored');
  });
});

describe('a while loop (C119.6)', () => {
  const below = (limit: number) => ({ '<': [{ var: 'vars.count' }, limit] });
  const counted = (condition: unknown, extra: object = {}): WorkflowDefinition => ({
    ...looped(
      whileLoop('again', condition, extra),
      update('inner', 'count', 'set', '{{ steps.tick.output.value }}'),
    ),
    variables: [{ name: 'count', type: 'number', default: 0 }],
  });
  const ticking = (condition: unknown, extra: object = {}): WorkflowDefinition => {
    const base = counted(condition, extra);
    return {
      ...base,
      steps: [
        whileLoop('again', condition, extra),
        sum('tick', ['{{ vars.count }}', 1], { default: 0 }),
        update('inner', 'count', 'set', '{{ steps.tick.output.value }}'),
        output(),
      ],
      edges: [
        edge('e1', 'trigger', 'next', 'again'),
        edge('e2', 'again', 'body', 'tick'),
        edge('e3', 'tick', 'next', 'inner'),
        backEdge('e4', 'inner', 'again'),
        edge('e5', 'again', 'done', 'output'),
      ],
    };
  };

  it('runs while its condition holds', () => {
    const trace = drive(ticking(below(2)));
    expect(trace.state.variables).toEqual({ count: 2 });
    expect(outputOf(trace, 'again')).toEqual({ iterations: 2 });
    expect(trace.state.status).toBe('completed');
  });

  it('never runs when its condition fails at once', () => {
    expect(drive(ticking(below(0))).steps).toEqual(['again', 'output']);
  });

  it('fails past its maximum, never stopping silently (C117.7)', () => {
    const trace = drive(ticking(below(100), { 'max-iterations': 2 }));
    expect(trace.state.failures).toEqual([
      { nodeId: 'again', iterationPath: '', code: 'loop_limit_exceeded' },
    ]);
  });

  it('stops on a null with on-null stop (C114.6)', () => {
    const trace = drive(ticking({ '<': [{ var: 'trigger.none' }, 1] }, { 'on-null': 'stop' }));
    expect(trace.steps).toEqual(['again', 'output']);
  });

  it('errors on a null with on-null error', () => {
    const trace = drive(ticking({ '<': [{ var: 'trigger.none' }, 1] }, { 'on-null': 'error' }));
    expect(trace.state.failures).toEqual([
      { nodeId: 'again', iterationPath: '', code: 'condition_input_null' },
    ]);
  });
});

describe('a map loop (C119.6)', () => {
  const map = { ...forEach('tags'), mode: 'map' } as WorkflowStep;
  const collect = {
    id: 'collect',
    type: 'array-map-output',
    name: 'Collect',
    'map-of': 'tags',
    value: '{{ loop.index }}:{{ loop.item }}',
  } as WorkflowStep;

  it('collects one value per item, in item order', () => {
    const trace = drive(looped(map, collect));
    expect(outputOf(trace, 'tags')).toEqual({
      iterations: 3,
      values: ['0:vip', '1:beta', '2:new'],
    });
  });

  it('collects by item, however the iterations finish', () => {
    const concurrent = { ...map, concurrency: 3 } as WorkflowStep;
    const definition = chain([], {
      steps: [concurrent, tag('work'), collect, output()],
      edges: [
        edge('e1', 'trigger', 'next', 'tags'),
        edge('e2', 'tags', 'body', 'work'),
        edge('e3', 'work', 'next', 'collect'),
        backEdge('e4', 'collect', 'tags'),
        edge('e5', 'tags', 'done', 'output'),
      ],
    });
    const trace = drive(definition);
    expect(outputOf(trace, 'tags')).toEqual({
      iterations: 3,
      values: ['0:vip', '1:beta', '2:new'],
    });
  });

  it('fails the loop when a value cannot render', () => {
    const broken = { ...collect, value: '{{ trigger.absent }}' } as WorkflowStep;
    const trace = drive(looped(map, broken));
    expect(trace.state.status).toBe('errored');
    expect(trace.state.failures).toEqual([
      { nodeId: 'collect', iterationPath: 'tags[0]/', code: 'template_variable_missing' },
    ]);
  });
});

describe('Update Variable (C115.4)', () => {
  const run = (steps: readonly WorkflowStep[], over: Partial<WorkflowDefinition> = {}) =>
    drive(chain(steps, over));

  it('sets a value inside the advance that reached it (C117.3)', () => {
    const definition = chain([update('a', 'risk', 'set', 5)], {
      variables: [{ name: 'risk', type: 'number' }],
    });
    const { executed, stepsToMakeReady, nextState } = startRun(definition, SEED);
    expect(stepsToMakeReady).toEqual([]);
    expect(nextState.variables).toEqual({ risk: 5 });
    expect(executed[0]).toMatchObject({
      nodeId: 'a',
      output: { name: 'risk', operator: 'set', held: true },
    });
  });

  it('renders the value from the scope', () => {
    const trace = run([update('a', 'who', 'set', '{{ trigger.who }}')], {
      variables: [{ name: 'who', type: 'string', pii: true }],
    });
    expect(trace.state.variables).toEqual({ who: 'Ada' });
  });

  it('unsets a value', () => {
    const trace = run([update('a', 'risk', 'unset')], {
      variables: [{ name: 'risk', type: 'number', default: 1 }],
    });
    expect(trace.state.variables).toEqual({});
    expect(trace.executed[0]).toMatchObject({ output: { held: false } });
  });

  it('pushes to a list and starts one when it is unset', () => {
    const trace = run([update('a', 'seen', 'push', 'x'), update('b', 'seen', 'push', 'y')], {
      variables: variables('seen'),
    });
    expect(trace.state.variables).toEqual({ seen: ['x', 'y'] });
  });

  it('removes each equal item from a list', () => {
    const trace = run([update('a', 'seen', 'remove', 'x')], {
      variables: [{ name: 'seen', type: 'list<string>', default: ['x', 'y', 'x'] }],
    });
    expect(trace.state.variables).toEqual({ seen: ['y'] });
  });

  it('refuses a value of another type', () => {
    const trace = run([update('a', 'risk', 'set', 'high')], {
      variables: [{ name: 'risk', type: 'number' }],
    });
    expect(trace.state.failures).toEqual([
      { nodeId: 'a', iterationPath: '', code: 'variable_type_mismatch' },
    ]);
  });

  it('refuses a push onto something that is no list', () => {
    const trace = run([update('a', 'risk', 'push', 1)], {
      variables: [{ name: 'risk', type: 'number', default: 1 }],
    });
    expect(trace.state.failures).toEqual([
      { nodeId: 'a', iterationPath: '', code: 'variable_type_mismatch' },
    ]);
  });

  it('fails past 1 MiB of variables (C115.4)', () => {
    const huge = 'a'.repeat(WORKFLOW_RUN_LIMITS['variables-bytes'].value);
    const trace = drive(
      chain([update('a', 'text', 'set', '{{ trigger.huge }}')], {
        variables: [{ name: 'text', type: 'string' }],
      }),
      {},
      {},
      { seed: { trigger: { huge } } },
    );
    expect(trace.state.failures).toEqual([
      { nodeId: 'a', iterationPath: '', code: 'payload_too_large' },
    ]);
  });

  it('reads back what it wrote', () => {
    const trace = run([update('a', 'risk', 'set', 9), tag('b', '{{ vars.risk }}')], {
      variables: [{ name: 'risk', type: 'number' }],
    });
    expect(runScope(trace.state, '').roots.vars).toEqual({ risk: 9 });
  });
});

describe('Calculate (C127.10)', () => {
  const answer = (operator: string, operands: readonly unknown[], extra: object = {}) => {
    const step = action('sum', 'calculate', { operator, operands, ...extra });
    return outputOf(drive(chain([step])), 'sum');
  };
  const value = (result: number) => ({ value: result, defaulted: false, 'default-reason': null });
  const defaulted = (result: number, reason: string) => ({
    value: result,
    defaulted: true,
    'default-reason': reason,
  });

  it.each<[string, readonly unknown[], number]>([
    ['add', [1, 2, 3], 6],
    ['subtract', [10, 2, 3], 5],
    ['multiply', [2, 3, 4], 24],
    ['divide', [12, 2, 3], 2],
    ['sum', [1, [2, 3]], 6],
    ['avg', [2, [4, 6]], 4],
  ])('%s', (operator, operands, result) => {
    expect(answer(operator, operands)).toEqual(value(result));
  });

  it('reads its operands from the scope', () => {
    expect(answer('add', ['{{ trigger.score }}', 1])).toEqual(value(8));
  });

  it.each<[string, readonly unknown[], string]>([
    ['divide', [1, 0], 'divide_by_zero'],
    ['add', ['{{ trigger.who }}', 1], 'operand_not_a_number'],
    ['add', ['{{ trigger.none }}', 1], 'operand_null'],
    ['avg', [[]], 'no_operands'],
    ['multiply', [1e308, 10], 'not_finite'],
  ])('%s of %j uses the default and says why', (operator, operands, reason) => {
    expect(answer(operator, operands, { default: 0 })).toEqual(defaulted(0, reason));
  });

  it('fails the step with no default, never answering a number it does not have', () => {
    const step = action('sum', 'calculate', { operator: 'divide', operands: [1, 0] });
    expect(drive(chain([step])).state.failures).toEqual([
      { nodeId: 'sum', iterationPath: '', code: 'expression_arithmetic_error' },
    ]);
  });

  it('fails a reference that does not render, whatever its default', () => {
    const step = action('sum', 'calculate', {
      operator: 'add',
      operands: ['{{ vars.unset }}'],
      default: 0,
    });
    expect(
      drive(chain([step], { variables: [{ name: 'unset', type: 'number' }] })).state.failures,
    ).toEqual([{ nodeId: 'sum', iterationPath: '', code: 'variable_unset' }]);
  });
});

describe('a module (C119.8)', () => {
  const module: WorkflowDefinition = {
    ...chain([]),
    trigger: null,
    inputs: [{ name: 'id', type: 'id<inq>', required: true }],
    outputs: [{ name: 'done', pii: false }],
    steps: [
      { id: 'start', type: 'module-input', name: 'In' },
      tag('inner_tag', '{{ inputs.id }}'),
      output({ done: '{{ inputs.id }}' }),
    ] as WorkflowDefinition['steps'],
    edges: [edge('e1', 'start', 'next', 'inner_tag'), edge('e2', 'inner_tag', 'next', 'output')],
  };
  const parent = chain([moduleStep('checks', { id: '{{ trigger.id }}' }), tag('after')]);
  const modules = { modules: { 'module:checks/': module } };

  it('asks the executor to pin its version', () => {
    const { stepsToMakeReady } = startRun(parent, SEED, modules);
    expect(stepsToMakeReady).toEqual([
      {
        kind: 'module',
        nodeId: 'checks',
        iterationPath: '',
        moduleWorkflowId: 'wfl_01M5CM00000000000000000015',
        version: 'latest-published',
      },
    ]);
  });

  it('runs its steps in the parent run, in their own iteration path', () => {
    const trace = drive(parent, {}, modules);
    expect(trace.steps).toEqual([
      'checks',
      'module:checks/start',
      'module:checks/inner_tag',
      'module:checks/output',
      'checks',
      'after',
      'output',
    ]);
    expect(trace.state.status).toBe('completed');
  });

  it('gives its output to the parent step', () => {
    const trace = drive(parent, {}, modules);
    expect(outputOf(trace, 'checks')).toEqual({ done: 'inq_1' });
  });

  it('reads the parent only through its inputs', () => {
    const started = drive(parent, {}, modules, { hold: ['inner_tag'] });
    const scope = runScope(started.state, 'module:checks/');
    expect(scope.roots.inputs).toEqual({ id: 'inq_1' });
    expect(scope.roots.trigger).toBeUndefined();
    expect(scope.roots.vars).toEqual({});
    expect(scope.roots.steps).toEqual({ start: { output: null } });
  });

  it('fails the module step when a step in it fails', () => {
    const trace = drive(parent, { 'module:checks/inner_tag': { fail: 'a_code' } }, modules);
    expect(trace.state.status).toBe('errored');
    expect(trace.state.failures).toEqual([
      { nodeId: 'inner_tag', iterationPath: 'module:checks/', code: 'a_code' },
    ]);
  });

  it('takes the parent error edge of the module step', () => {
    const definition = chain([], {
      steps: [moduleStep('checks', { id: '{{ trigger.id }}' }), tag('recover'), output()],
      edges: [
        edge('e1', 'trigger', 'next', 'checks'),
        edge('e2', 'checks', 'next', 'output'),
        edge('e3', 'checks', 'error', 'recover'),
        edge('e4', 'recover', 'next', 'output'),
      ],
    });
    const trace = drive(definition, { 'module:checks/inner_tag': { fail: 'a_code' } }, modules);
    expect(trace.state.status).toBe('completed');
    expect(trace.steps).toContain('recover');
  });

  it('fails when a mapped input cannot render', () => {
    const broken = chain([moduleStep('checks', { id: '{{ trigger.absent }}' })]);
    expect(drive(broken, {}, modules).state.failures).toEqual([
      { nodeId: 'checks', iterationPath: '', code: 'template_variable_missing' },
    ]);
  });

  it('fails with no pinned definition, never skipping the module', () => {
    expect(drive(parent, {}, {}).state.failures).toEqual([
      { nodeId: 'checks', iterationPath: '', code: 'execution_error' },
    ]);
  });

  it('runs inside a loop with one frame per iteration', () => {
    const inLoop = looped(forEach('each'), moduleStep('checks', { id: '{{ loop.item }}' }));
    const trace = drive(
      inLoop,
      {},
      {
        modules: {
          'each[0]/module:checks/': module,
          'each[1]/module:checks/': module,
          'each[2]/module:checks/': module,
        },
      },
    );
    expect(trace.state.status).toBe('completed');
    expect(trace.steps).toContain('each[2]/module:checks/inner_tag');
  });
});

describe('the step limit (C117.7)', () => {
  it('ends the run with a whole-run failure, past 5,000 executions', () => {
    const trace = drive(
      chain([tag('a'), tag('b')]),
      {},
      {},
      {
        from: startRun(chain([tag('a'), tag('b')]), SEED),
      },
    );
    expect(trace.state.status).toBe('completed');
    const near = {
      ...startRun(chain([tag('a'), tag('b')]), SEED).nextState,
      stepExecutions: WORKFLOW_RUN_LIMITS['step-executions'].value,
    };
    const stopped = advance(chain([tag('a'), tag('b')]), near, {
      kind: 'step',
      nodeId: 'a',
      iterationPath: '',
      outcome: 'succeeded',
      output: { ok: true },
    });
    expect(stopped.nextState.status).toBe('errored');
    expect(stopped.stepsToMakeReady).toEqual([]);
    expect(stopped.nextState.failures).toEqual([
      { nodeId: null, iterationPath: '', code: 'step_limit_exceeded' },
    ]);
  });
});

describe('resume (C120.3)', () => {
  const resume = (definition: WorkflowDefinition, state: Parameters<typeof advance>[1]) =>
    advance(definition, state, { kind: 'resume' });

  it('re-readies the failed step of an errored run', () => {
    const definition = chain([tag('a'), tag('b')]);
    const failed = drive(definition, { a: { fail: 'a_code' } });
    const resumed = resume(definition, failed.state);
    expect(resumed.nextState.status).toBe('in_progress');
    expect(resumed.nextState.failures).toEqual([]);
    expect(resumed.stepsToMakeReady.map(({ nodeId }) => nodeId)).toEqual(['a']);
  });

  it('finishes the run from there', () => {
    const definition = chain([tag('a'), tag('b')]);
    const failed = drive(definition, { a: { fail: 'a_code' } });
    const trace = drive(definition, {}, {}, { from: resume(definition, failed.state) });
    expect(trace.state.status).toBe('completed');
    expect(trace.steps).toEqual(['a', 'b', 'output']);
  });

  it('re-evaluates a failed control-flow node', () => {
    const definition = routed({
      condition: { '<': [{ var: 'trigger.none' }, 1] },
      'on-null': 'error',
    });
    const failed = drive(definition);
    const resumed = resume(definition, { ...failed.state, trigger: { none: 0 } });
    expect(resumed.nextState.status).toBe('completed');
  });

  it('reopens the join of a failed branch', () => {
    const definition = parallel();
    const failed = drive(definition, { one: { fail: 'a_code' } });
    expect(failed.state.status).toBe('errored');
    const trace = drive(definition, {}, {}, { from: resume(definition, failed.state) });
    expect(trace.state.status).toBe('completed');
    expect(trace.steps).toEqual(['one', 'meet', 'output']);
  });

  it('re-readies every failed branch', () => {
    const definition = parallel();
    const failed = drive(definition, { one: { fail: 'a_code' }, two: { fail: 'b_code' } });
    const trace = drive(definition, {}, {}, { from: resume(definition, failed.state) });
    expect(trace.steps).toEqual(['one', 'two', 'meet', 'output']);
    expect(trace.state.status).toBe('completed');
  });

  it('carries on with a loop after a failed iteration', () => {
    const definition = looped(forEach('each', 'trigger.tags'));
    const failed = drive(definition, { 'each[1]/inner': { fail: 'a_code' } });
    const trace = drive(definition, {}, {}, { from: resume(definition, failed.state) });
    expect(trace.steps).toEqual(['each[1]/inner', 'each[2]/inner', 'each', 'output']);
    expect(trace.state.status).toBe('completed');
  });

  it('reopens a nested parallel once', () => {
    const inner = parallelStep('inner', ['x', 'y']);
    const definition = chain([], {
      steps: [
        parallelStep(),
        inner,
        tag('x1'),
        tag('y1'),
        joinStep('inner_meet', 'inner'),
        tag('two'),
        joinStep(),
        output(),
      ],
      edges: [
        edge('e1', 'trigger', 'next', 'fork'),
        edge('e2', 'fork', 'branch:a', 'inner'),
        edge('e3', 'fork', 'branch:b', 'two'),
        edge('e4', 'inner', 'branch:x', 'x1'),
        edge('e5', 'inner', 'branch:y', 'y1'),
        edge('e6', 'x1', 'next', 'inner_meet'),
        edge('e7', 'y1', 'next', 'inner_meet'),
        edge('e8', 'inner_meet', 'next', 'meet'),
        edge('e9', 'two', 'next', 'meet'),
        edge('e10', 'meet', 'next', 'output'),
      ],
    });
    const failed = drive(definition, { x1: { fail: 'a' }, y1: { fail: 'b' } });
    const trace = drive(definition, {}, {}, { from: resume(definition, failed.state) });
    expect(trace.state.status).toBe('completed');
  });

  it('reopens through a module', () => {
    const module: WorkflowDefinition = {
      ...chain([]),
      trigger: null,
      steps: [
        { id: 'start', type: 'module-input', name: 'In' },
        tag('inner_tag'),
        output(),
      ] as WorkflowDefinition['steps'],
      edges: [edge('e1', 'start', 'next', 'inner_tag'), edge('e2', 'inner_tag', 'next', 'output')],
    };
    const definition = chain([moduleStep('checks'), tag('after')]);
    const modules = { modules: { 'module:checks/': module } };
    const failed = drive(definition, { inner_tag: { fail: 'a_code' } }, modules);
    const trace = drive(definition, {}, modules, {
      from: advance(definition, failed.state, { kind: 'resume' }, modules),
    });
    expect(trace.state.status).toBe('completed');
  });

  it('leaves a whole-run failure as it is: nothing can re-ready it', () => {
    const definition = chain([tag('a')]);
    const failed = {
      ...startRun(definition, SEED).nextState,
      status: 'errored',
      failures: [{ nodeId: null, iterationPath: '', code: 'step_limit_exceeded' }],
    } as const;
    expect(resume(definition, failed).nextState).toEqual(failed);
  });

  it('leaves a run with no failure as it is', () => {
    const definition = chain([tag('a')]);
    const { nextState } = startRun(definition, SEED);
    expect(resume(definition, nextState).stepsToMakeReady).toEqual([]);
  });
});

describe('test runs (C120.7)', () => {
  it('starts at a named step', () => {
    const definition = chain([tag('a'), tag('b'), tag('c')]);
    const trace = drive(definition, {}, {}, { seed: { startStep: 'b' } });
    expect(trace.steps).toEqual(['b', 'c', 'output']);
  });

  it('ends after a named step, with the run completed', () => {
    const trace = drive(chain([tag('a'), tag('b')]), {}, { endStep: 'a' });
    expect(trace.steps).toEqual(['a']);
    expect(trace.state.status).toBe('completed');
  });
});

describe('what it answers for anything unexpected', () => {
  it('ignores a completion of a run that already ended', () => {
    const definition = chain([tag('a')]);
    const { state } = drive(definition);
    const late = advance(definition, state, {
      kind: 'step',
      nodeId: 'a',
      iterationPath: '',
      outcome: 'succeeded',
      output: {},
    });
    expect(late.nextState).toEqual(state);
    expect(late.stepsToMakeReady).toEqual([]);
  });

  it('errors the run on a completion of a node it does not know', () => {
    const definition = chain([tag('a')]);
    const { nextState } = startRun(definition, SEED);
    const odd = advance(definition, nextState, {
      kind: 'step',
      nodeId: 'ghost',
      iterationPath: '',
      outcome: 'succeeded',
      output: {},
    });
    expect(odd.nextState.failures).toEqual([
      { nodeId: 'ghost', iterationPath: '', code: 'execution_error' },
    ]);
  });

  it('errors the run with no start node', () => {
    const definition = { ...chain([]), trigger: null, edges: [] };
    expect(startRun(definition, SEED).nextState.failures).toEqual([
      { nodeId: null, iterationPath: '', code: 'execution_error' },
    ]);
  });

  it('errors a step whose port leads nowhere', () => {
    const definition = { ...chain([tag('a')]), edges: [edge('e0', 'trigger', 'next', 'a')] };
    const trace = drive(definition);
    expect(trace.state.failures).toEqual([
      { nodeId: 'a', iterationPath: '', code: 'execution_error' },
    ]);
  });
});

describe('the contracts golden definition with every node type (C113.2)', () => {
  const fixture = workflowDefinitionSchema.parse(readWorkflowFixture('definition-every-node.json'));
  /** Its `while` never raises `risk`, so it would fail at its maximum (see the next test). */
  const definition: WorkflowDefinition = {
    ...fixture,
    variables: fixture.variables.map((variable) =>
      variable.name === 'risk' ? { ...variable, default: 5 } : variable,
    ),
  };
  const module = workflowDefinitionSchema.parse(readWorkflowFixture('definition-module.json'));
  const modules = { modules: { 'module:shared_checks/': module } };
  const seed = { trigger: { id: 'inq_1', tags: ['a', 'b'] } };

  it('runs from end to end, through the else of the conditional', () => {
    const trace = drive(
      definition,
      { run_watchlist: { 'has-match': false, 'report-id': 'rep_1' } },
      modules,
      { seed },
    );
    expect(trace.state.status).toBe('completed');
    expect(trace.state.runOutputs).toEqual({ decision: 'review' });
    expect(trace.steps).not.toContain('mark_review');
    expect(trace.steps).toContain('each_tag[1]/copy_tag');
    expect(trace.steps).toContain('map_tags[1]/collect');
    expect(trace.steps).toContain('module:shared_checks/tag_it');
    expect(trace.steps).not.toContain('note_failure');
  });

  it('fails a while loop that reaches its maximum, as the fixture stands', () => {
    const trace = drive(
      fixture,
      { run_watchlist: { 'has-match': false, 'report-id': 'rep_1' } },
      modules,
      { seed },
    );
    expect(trace.state.failures).toEqual([
      { nodeId: 'retry_read', iterationPath: '', code: 'loop_limit_exceeded' },
    ]);
  });

  it('takes the matched route', () => {
    const trace = drive(
      definition,
      { run_watchlist: { 'has-match': true, 'report-id': 'rep_1' } },
      modules,
      { seed },
    );
    expect(trace.steps).toContain('mark_review');
  });

  it('errors on a null match, by the route on-null', () => {
    const trace = drive(
      definition,
      { run_watchlist: { 'has-match': null, 'report-id': 'rep_1' } },
      modules,
      { seed },
    );
    expect(trace.state.failures).toEqual([
      { nodeId: 'decide', iterationPath: '', code: 'condition_input_null' },
    ]);
  });

  it('follows the module error edge', () => {
    const trace = drive(
      definition,
      { run_watchlist: { 'has-match': false, 'report-id': 'rep_1' }, tag_it: { fail: 'a_code' } },
      modules,
      { seed },
    );
    expect(trace.state.status).toBe('completed');
    expect(trace.steps).toContain('note_failure');
    expect(trace.state.variables).toMatchObject({ failed: true });
  });
});

describe('keys (C117.2, C117.5)', () => {
  it('reads a node behind its iteration path', () => {
    expect(stepKey('', 'send')).toBe('send');
    expect(stepKey('each[3]/', 'send')).toBe('each[3]/send');
  });

  it('builds an effect key that does not hold the attempt', () => {
    expect(effectKey('wfr_1', 'send', 'each[3]/')).toBe('wfr_1/send/each[3]/');
  });
});

describe('current_case (C140.2)', () => {
  it('is an inert root in 8A', () => {
    const { nextState } = startRun(chain([tag('a')]), SEED);
    expect(runScope(nextState, '').roots.current_case).toBeNull();
  });

  it('holds what a Workflow 8B seed gives it', () => {
    const { nextState } = startRun(chain([tag('a')]), { ...SEED, currentCase: { status: 'open' } });
    expect(runScope(nextState, '').roots.current_case).toEqual({ status: 'open' });
  });
});

describe('runScope (C114.4)', () => {
  it('holds the roots of a run, with the run clock', () => {
    const { nextState } = startRun(chain([tag('a')]), SEED);
    const scope = runScope(nextState, '');
    expect(scope.now).toBe(NOW);
    expect(Object.keys(scope.roots).sort()).toEqual([
      'current_case',
      'current_run',
      'inputs',
      'steps',
      'trigger',
      'vars',
    ]);
  });

  it('holds step outputs under their output member', () => {
    const trace = drive(chain([tag('a')]), { a: { outcome: 'applied' } }, {}, { hold: [] });
    expect(runScope(trace.state, '').roots.steps).toMatchObject({
      a: { output: { outcome: 'applied' } },
    });
  });
});
