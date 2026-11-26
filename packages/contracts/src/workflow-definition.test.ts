/** C113.1-C113.4: the shape. The graph rules (C113.5) are `@openverify/workflow-engine`'s. */
import { describe, expect, it } from 'vitest';
import { readFixture } from './test-support.js';
import {
  WORKFLOW_RESERVED_STEP_IDS,
  WORKFLOW_SCHEMA_VERSION,
  isTriggerableEvent,
  workflowDefinitionSchema,
  workflowEdgeSchema,
  workflowPortSchema,
  workflowRouteOnNullSchema,
  workflowStepIdSchema,
  workflowStepSchema,
  workflowTriggerSchema,
} from './workflow-definition.js';

const WFL = 'wfl_01M5CM00000000000000000001';
const WFV = 'wfv_01M5CM00000000000000000002';
const NAME = { name: 'A step' };

const empty = {
  'schema-version': 1,
  trigger: null,
  inputs: [],
  variables: [],
  steps: [],
  edges: [],
  outputs: [],
  layout: {},
};

const parses = (step: unknown) => workflowStepSchema.safeParse(step).success;
const parsesTrigger = (trigger: unknown) => workflowTriggerSchema.safeParse(trigger).success;

describe('the definition (C113.1)', () => {
  it('reads schema version 1 and takes a draft with no trigger', () => {
    expect(WORKFLOW_SCHEMA_VERSION).toBe(1);
    expect(workflowDefinitionSchema.parse(empty)).toEqual(empty);
  });

  it('refuses an unknown key at every level', () => {
    expect(workflowDefinitionSchema.safeParse({ ...empty, extra: 1 }).success).toBe(false);
    expect(parses({ id: 'a', ...NAME, type: 'join', 'join-of': 'b', extra: 1 })).toBe(false);
    expect(parsesTrigger({ type: 'trigger-api', config: { extra: 1 } })).toBe(false);
    expect(
      workflowEdgeSchema.safeParse({
        id: 'e1',
        from: 'trigger',
        'from-port': 'next',
        to: 'a',
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('refuses another schema version, which readDefinition upgrades first', () => {
    expect(workflowDefinitionSchema.safeParse({ ...empty, 'schema-version': 2 }).success).toBe(
      false,
    );
  });

  it.each(['run_watchlist', 'a', `a${'b'.repeat(39)}`])('takes the step id %s', (id) => {
    expect(workflowStepIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(['Run', '1a', 'a-b', '', `a${'b'.repeat(40)}`, ...WORKFLOW_RESERVED_STEP_IDS])(
    'refuses the step id %j',
    (id) => {
      expect(workflowStepIdSchema.safeParse(id).success).toBe(false);
    },
  );

  it('keeps the id output for the output node alone', () => {
    expect(parses({ id: 'output', ...NAME, type: 'output', mappings: {} })).toBe(true);
    expect(parses({ id: 'other', ...NAME, type: 'output', mappings: {} })).toBe(false);
    expect(parses({ id: 'output', ...NAME, type: 'module-input' })).toBe(false);
  });

  it('refuses a name past 80 characters and an empty one', () => {
    const join = { id: 'a', type: 'join', 'join-of': 'b' };
    expect(parses({ ...join, name: 'x'.repeat(80) })).toBe(true);
    expect(parses({ ...join, name: 'x'.repeat(81) })).toBe(false);
    expect(parses({ ...join, name: '' })).toBe(false);
  });

  it('refuses a declared name that reads the prototype chain', () => {
    const input = { name: 'constructor', type: 'string', required: true };
    expect(workflowDefinitionSchema.safeParse({ ...empty, inputs: [input] }).success).toBe(false);
  });

  it.each([
    ['inputs', { name: 'a', type: 'string', required: true }],
    ['variables', { name: 'a', type: 'number' }],
    ['outputs', { name: 'a', pii: false }],
    ['edges', { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'a' }],
    ['steps', { id: 'a', ...NAME, type: 'join', 'join-of': 'b' }],
  ])('refuses a repeated member of %s, at its pointer', (member, item) => {
    const result = workflowDefinitionSchema.safeParse({ ...empty, [member]: [item, item] });
    expect(result.error?.issues.map((issue: { path: unknown }) => issue.path)).toEqual([
      [member, 1],
    ]);
  });

  it('holds the caps of C113.4', () => {
    const many = (count: number, make: (index: number) => unknown) =>
      Array.from({ length: count }, (_, index) => make(index));
    const step = (index: number) => ({
      id: `s${String(index)}`,
      ...NAME,
      type: 'join',
      'join-of': 'a',
    });
    const edge = (index: number) => ({
      id: `e${String(index)}`,
      from: 'a',
      'from-port': 'next',
      to: 'b',
    });
    const input = (index: number) => ({
      name: `i${String(index)}`,
      type: 'string',
      required: false,
    });
    const variable = (index: number) => ({ name: `v${String(index)}`, type: 'string' });
    const output = (index: number) => ({ name: `o${String(index)}`, pii: false });
    const fits = (member: string, items: unknown[]) =>
      workflowDefinitionSchema.safeParse({ ...empty, [member]: items }).success;
    expect(fits('steps', many(200, step))).toBe(true);
    expect(fits('steps', many(201, step))).toBe(false);
    expect(fits('edges', many(400, edge))).toBe(true);
    expect(fits('edges', many(401, edge))).toBe(false);
    expect(fits('inputs', many(33, input))).toBe(false);
    expect(fits('variables', many(33, variable))).toBe(false);
    expect(fits('outputs', many(33, output))).toBe(false);
  });

  it('refuses a definition past 256 KiB, in bytes rather than characters', () => {
    const config = { text: 'é'.repeat(140_000) };
    const step = {
      id: 'a',
      ...NAME,
      type: 'action',
      'action-key': 'evaluate_code',
      'action-version': 1,
      config,
    };
    expect(workflowDefinitionSchema.safeParse({ ...empty, steps: [step] }).success).toBe(false);
  });

  it('keeps positions in layout, by node id', () => {
    const layout = { trigger: { x: 0, y: 0 }, run_watchlist: { x: 0, y: 120.5 } };
    expect(workflowDefinitionSchema.parse({ ...empty, layout }).layout).toEqual(layout);
    expect(
      workflowDefinitionSchema.safeParse({ ...empty, layout: { 'not an id': { x: 0, y: 0 } } })
        .success,
    ).toBe(false);
  });
});

describe('the nodes (C113.2)', () => {
  const action = {
    id: 'run_report',
    ...NAME,
    type: 'action',
    'action-key': 'run_report',
    'action-version': 1,
    config: { 'report-template-id': 'rptp_01M5CM00000000000000000003' },
  };

  it('takes an action with its retries, leaving its config to the registry', () => {
    expect(parses(action)).toBe(true);
    expect(parses({ ...action, 'continue-on-error': true })).toBe(true);
    expect(parses({ ...action, retry: { 'intervals-seconds': [1, 60, 3600] } })).toBe(true);
  });

  it.each([
    ['an empty list', []],
    ['more than ten intervals', Array.from({ length: 11 }, () => 1)],
    ['an interval below a second', [0]],
    ['an interval past an hour', [3601]],
  ])('refuses a retry with %s', (_name, intervals) => {
    expect(parses({ ...action, retry: { 'intervals-seconds': intervals } })).toBe(false);
  });

  it('refuses an action version below 1 and a key that is not snake_case', () => {
    expect(parses({ ...action, 'action-version': 0 })).toBe(false);
    expect(parses({ ...action, 'action-key': 'Run-Report' })).toBe(false);
  });

  const events = {
    id: 'wait_case',
    ...NAME,
    type: 'wait',
    mode: 'events',
    subject: 'steps.open_case.output.case-id',
    events: ['inquiry.completed'],
    'timeout-seconds': 86_400,
    'on-timeout': 'continue',
  };

  it('takes a wait on events and a wait for time, each at most 30 days', () => {
    expect(parses(events)).toBe(true);
    expect(parses({ ...events, filter: { '==': [1, 1] }, 'on-null': 'keep-waiting' })).toBe(true);
    expect(parses({ ...events, 'timeout-seconds': 2_592_000 })).toBe(true);
    expect(parses({ ...events, 'timeout-seconds': 2_592_001 })).toBe(false);
    const time = { id: 'pause', ...NAME, type: 'wait', mode: 'time', seconds: 60 };
    expect(parses(time)).toBe(true);
    expect(parses({ ...time, seconds: 2_592_001 })).toBe(false);
  });

  it('refuses a wait on no event, an unknown event, and a wait with no mode', () => {
    expect(parses({ ...events, events: [] })).toBe(false);
    expect(parses({ ...events, events: ['inquiry.deleted'] })).toBe(false);
    expect(parses({ ...events, 'on-timeout': 'ignore' })).toBe(false);
    expect(parses({ ...events, 'on-null': 'skip' })).toBe(false);
    expect(parses({ id: 'a', ...NAME, type: 'wait', seconds: 60 })).toBe(false);
  });

  const parallel = { id: 'fan_out', ...NAME, type: 'parallel' };

  it('takes 2 to 10 branches, each with a key', () => {
    const branches = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ key: `b${String(index)}` }));
    expect(parses({ ...parallel, branches: branches(2) })).toBe(true);
    expect(parses({ ...parallel, branches: branches(10) })).toBe(true);
    expect(parses({ ...parallel, branches: branches(1) })).toBe(false);
    expect(parses({ ...parallel, branches: branches(11) })).toBe(false);
  });

  it('pairs a join with its parallel', () => {
    expect(parses({ id: 'join_up', ...NAME, type: 'join', 'join-of': 'fan_out' })).toBe(true);
    expect(parses({ id: 'join_up', ...NAME, type: 'join' })).toBe(false);
  });

  const conditional = { id: 'decide', ...NAME, type: 'conditional' };

  it('takes ordered routes, a catch-all among them', () => {
    const routes = [
      {
        key: 'high',
        label: 'High',
        condition: { '>': [{ var: 'vars.risk' }, 5] },
        'on-null': 'error',
      },
      { key: 'rest', label: 'The rest' },
    ];
    expect(parses({ ...conditional, routes })).toBe(true);
    expect(parses({ ...conditional, routes, 'continue-on-error': true })).toBe(true);
    expect(parses({ ...conditional, routes: [] })).toBe(false);
  });

  it.each(['error', 'skip-route', 'route:high'])('takes the route on-null %s', (value) => {
    expect(workflowRouteOnNullSchema.safeParse(value).success).toBe(true);
  });

  it.each(['else', 'route:', 'route:High', 'admit', ''])(
    'refuses the route on-null %j',
    (value) => {
      expect(workflowRouteOnNullSchema.safeParse(value).success).toBe(false);
    },
  );

  const loop = { id: 'each', ...NAME, type: 'loop' };

  it('takes the three loops, and a while only with its maximum', () => {
    expect(parses({ ...loop, mode: 'for-each', items: 'trigger.tags' })).toBe(true);
    expect(parses({ ...loop, mode: 'map', items: 'trigger.tags', concurrency: 10 })).toBe(true);
    const whileLoop = { ...loop, mode: 'while', condition: { var: 'vars.more' } };
    expect(parses({ ...whileLoop, 'max-iterations': 100, 'on-null': 'stop' })).toBe(true);
    expect(parses(whileLoop)).toBe(false);
    expect(parses({ ...whileLoop, 'max-iterations': 101 })).toBe(false);
    expect(parses({ ...whileLoop, 'max-iterations': 1, 'on-null': 'skip' })).toBe(false);
  });

  it('holds a loop to concurrency 1-10 and for-each to its items', () => {
    expect(parses({ ...loop, mode: 'for-each', items: 'a', concurrency: 11 })).toBe(false);
    expect(parses({ ...loop, mode: 'for-each', items: 'a', concurrency: 0 })).toBe(false);
    expect(parses({ ...loop, mode: 'for-each' })).toBe(false);
  });

  it('pairs an array-map-output with its map', () => {
    const node = { id: 'collect', ...NAME, type: 'array-map-output', 'map-of': 'each' };
    expect(parses({ ...node, value: '{{ loop.item }}' })).toBe(true);
    expect(parses(node)).toBe(false);
  });

  const moduleStep = {
    id: 'checks',
    ...NAME,
    type: 'module',
    'module-workflow-id': WFL,
    version: 'latest-published',
    inputs: { reference_id: '{{ trigger.reference-id }}' },
  };

  it('takes a module at the latest published version or a named one', () => {
    expect(parses(moduleStep)).toBe(true);
    expect(parses({ ...moduleStep, version: WFV })).toBe(true);
    expect(parses({ ...moduleStep, version: 'latest' })).toBe(false);
    expect(parses({ ...moduleStep, 'module-workflow-id': WFV })).toBe(false);
  });

  it('starts a module at its input node', () => {
    expect(parses({ id: 'start', ...NAME, type: 'module-input' })).toBe(true);
  });

  it('refuses a type that is no node', () => {
    expect(parses({ id: 'a', ...NAME, type: 'custom-function' })).toBe(false);
  });
});

describe('the triggers (C113.1, C118)', () => {
  const event = { type: 'trigger-event', config: { events: ['inquiry.completed'] } };

  it('takes every trigger type, each with its own config', () => {
    expect(parsesTrigger(event)).toBe(true);
    expect(parsesTrigger({ type: 'trigger-api', config: {} })).toBe(true);
    expect(parsesTrigger({ type: 'trigger-schedule', config: {} })).toBe(true);
    expect(
      parsesTrigger({
        type: 'trigger-recurring',
        config: { cron: '0 9 * * 1', 'time-zone': 'Europe/London', 'object-type': 'account' },
      }),
    ).toBe(true);
    expect(parsesTrigger({ type: 'trigger-direct', config: { 'object-type': 'inquiry' } })).toBe(
      true,
    );
    expect(parsesTrigger({ type: 'trigger-account', config: {} })).toBe(true);
    expect(parsesTrigger({ type: 'trigger-case', config: {} })).toBe(true);
    expect(
      parsesTrigger({
        type: 'trigger-verification',
        config: {
          events: ['verification.passed'],
          'verification-types': ['verification/government-id'],
        },
      }),
    ).toBe(true);
  });

  it('takes criteria with their answer to a null, and refuses another answer', () => {
    const criteria = { criteria: { in: [{ var: 'trigger.template.id' }, []] } };
    const config = { ...event.config, ...criteria };
    expect(parsesTrigger({ ...event, config: { ...config, 'on-null': 'admit' } })).toBe(true);
    expect(parsesTrigger({ ...event, config: { ...config, 'on-null': 'keep-waiting' } })).toBe(
      false,
    );
  });

  it('takes the per-workflow options on the trigger', () => {
    expect(
      parsesTrigger({ ...event, 'allow-self-trigger': true, 'one-run-per-subject': true }),
    ).toBe(true);
  });

  it.each([
    'workflow-run.created',
    'workflow-run.completed',
    'workflow.published',
    'workflow-version.published',
  ])('never starts on %s (C118.8)', (name) => {
    expect(isTriggerableEvent(name as never)).toBe(false);
    expect(parsesTrigger({ ...event, config: { events: [name] } })).toBe(false);
  });

  it('starts on any other event, list and pause events among them', () => {
    expect(isTriggerableEvent('inquiry.completed')).toBe(true);
    expect(isTriggerableEvent('list.updated')).toBe(true);
    expect(isTriggerableEvent('workflow.paused')).toBe(true);
  });

  it('refuses an event trigger on no event, or on an unknown one', () => {
    expect(parsesTrigger({ ...event, config: { events: [] } })).toBe(false);
    expect(parsesTrigger({ ...event, config: { events: ['inquiry.deleted'] } })).toBe(false);
  });

  it('holds a verification trigger to verification events', () => {
    expect(
      parsesTrigger({ type: 'trigger-verification', config: { events: ['inquiry.completed'] } }),
    ).toBe(false);
  });

  const recurring = { 'time-zone': 'UTC', 'object-type': 'report' };

  it('takes a cron or an interval, never both and never neither', () => {
    const trigger = (config: object) => ({
      type: 'trigger-recurring',
      config: { ...recurring, ...config },
    });
    expect(parsesTrigger(trigger({ 'every-minutes': 1 }))).toBe(true);
    expect(parsesTrigger(trigger({ 'every-minutes': 0 }))).toBe(false);
    expect(parsesTrigger(trigger({}))).toBe(false);
    expect(parsesTrigger(trigger({ cron: '* * * * *', 'every-minutes': 5 }))).toBe(false);
  });

  it('holds a recurring batch to 1,000 and its object to the five types', () => {
    const trigger = (config: object) => ({
      type: 'trigger-recurring',
      config: { cron: '* * * * *', ...recurring, ...config },
    });
    expect(parsesTrigger(trigger({ 'batch-cap': 1000 }))).toBe(true);
    expect(parsesTrigger(trigger({ 'batch-cap': 1001 }))).toBe(false);
    expect(parsesTrigger(trigger({ 'object-type': 'list' }))).toBe(false);
  });
});

describe('the edges and ports (C113.3)', () => {
  it.each(['next', 'error', 'else', 'body', 'done', 'route:high', 'branch:left'])(
    'takes the port %s',
    (port) => {
      expect(workflowPortSchema.safeParse(port).success).toBe(true);
    },
  );

  it.each(['continue', 'route:', 'branch:Left', 'other', ''])('refuses the port %j', (port) => {
    expect(workflowPortSchema.safeParse(port).success).toBe(false);
  });

  it('ends a back-edge at the continue port and at no other', () => {
    const edge = { id: 'back', from: 'tag_one', 'from-port': 'next', to: 'each' };
    expect(workflowEdgeSchema.safeParse({ ...edge, 'to-port': 'continue' }).success).toBe(true);
    expect(workflowEdgeSchema.safeParse({ ...edge, 'to-port': 'next' }).success).toBe(false);
  });
});

describe('the golden definitions (C146.1)', () => {
  it.each(['definition-every-node.json', 'definition-module.json', 'definition-event-filter.json'])(
    '%s parses unchanged',
    (file) => {
      const raw = readFixture(`workflows/${file}`);
      expect(workflowDefinitionSchema.parse(raw)).toEqual(raw);
    },
  );

  it('exercises every node type and every port', () => {
    const { steps, edges } = workflowDefinitionSchema.parse(
      readFixture('workflows/definition-every-node.json'),
    );
    expect(new Set(steps.map((step: { type: string }) => step.type))).toEqual(
      new Set([
        'action',
        'wait',
        'parallel',
        'join',
        'conditional',
        'loop',
        'output',
        'module',
        'array-map-output',
      ]),
    );
    const ports = new Set(
      edges.map((edge: { 'from-port': string }) => edge['from-port'].replace(/:.*/, '')),
    );
    expect(ports).toEqual(new Set(['next', 'error', 'route', 'else', 'branch', 'body', 'done']));
  });
});

describe('an event trigger’s subject filter (K8-10, Workflow 8D; plan amendments 67, 126)', () => {
  const config = (filter: unknown) => ({
    'schema-version': 1,
    trigger: { type: 'trigger-event', config: { events: ['inquiry.completed'], filter } },
    inputs: [],
    variables: [],
    steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
    outputs: [],
    layout: {},
  });

  it('takes the webhook filter keys, each a list of ids of its kind', () => {
    for (const filter of [
      { 'inquiry-template-ids': ['itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6'] },
      { 'account-type-ids': ['acctp_01M5A0GTG0RSTVX9PHA0V7P3X6'] },
      { 'workflow-ids': ['wfl_01M5A0GTG0RSTVX9PHA0V7P3X6'] },
      { 'list-ids': ['lst_01M5A0GTG0RSTVX9PHA0V7P3X6'] },
      { 'case-template-ids': ['ctmpl_01M5A0GTG0RSTVX9PHA0V7P3X6'] },
    ]) {
      expect(
        workflowDefinitionSchema.safeParse(config(filter)).success,
        JSON.stringify(filter),
      ).toBe(true);
    }
  });

  it('refuses a key it does not know and an id of another kind', () => {
    expect(workflowDefinitionSchema.safeParse(config({ 'report-ids': [] })).success).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse(
        config({ 'inquiry-template-ids': ['acctp_01M5A0GTG0RSTVX9PHA0V7P3X6'] }),
      ).success,
    ).toBe(false);
  });
});
