/** C115.3, C114.6: what a path may read at each node. */
import type { WorkflowDefinition } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { parsePath } from '../expressions/paths.js';
import { action, backEdge, chain, edge, output, registry, tag } from '../graph/testing.js';
import { indexGraph } from '../graph/structure.js';
import { buildNodeScopes, type ScopeContext } from './scope.js';
import { objectType, resolvePath, scalarType } from './types.js';

const context: ScopeContext = { registry };

function scopeAt(definition: WorkflowDefinition, id: string, over: Partial<ScopeContext> = {}) {
  const scopes = buildNodeScopes(indexGraph(definition), { ...context, ...over });
  const scope = scopes?.at.get(id);
  if (scope === undefined) {
    throw new Error(`no scope at ${id}`);
  }
  return (text: string) => resolvePath(scope, parsePath(text)?.segments ?? []);
}

const match = action('match', 'get_list_match', {
  'list-ids': ['lst_01M5CK3190XEVBM5ZXA76E1JSN'],
  probe: { kind: 'string', value: 'x' },
});
const known = { ok: true };
const unknown = { ok: false };

describe('roots (C114.4, C115.3)', () => {
  const definition = chain([tag('a')], {
    inputs: [
      { name: 'needed', type: 'string', required: true },
      { name: 'optional', type: 'integer', required: false, pii: true },
    ],
    variables: [{ name: 'risk', type: 'number', pii: true }],
  });
  const read = scopeAt(definition, 'a');

  it('reads the trigger view', () => {
    expect(read('trigger.status')).toMatchObject(known);
    expect(read('trigger.template.id')).toMatchObject(known);
  });

  it('reads inputs with their marks', () => {
    expect(read('inputs.needed')).toMatchObject({ ok: true, nullable: false, pii: false });
    expect(read('inputs.optional')).toMatchObject({ ok: true, nullable: true, pii: true });
    expect(read('inputs.absent')).toMatchObject(unknown);
  });

  it('reads variables with their marks', () => {
    expect(read('vars.risk')).toMatchObject({ ok: true, nullable: false, pii: true });
    expect(read('vars.absent')).toMatchObject(unknown);
  });

  it('reads the run', () => {
    for (const path of ['id', 'created-at', 'workflow-id', 'version-id', 'environment.kind']) {
      expect(read(`current_run.${path}`), path).toMatchObject(known);
    }
  });

  it('never holds a secret', () => {
    expect(read('current_run.environment.secrets')).toMatchObject(unknown);
  });

  it('holds current_case only through a provider (C140.2)', () => {
    expect(read('current_case')).toMatchObject(unknown);
    const provided = scopeAt(definition, 'a', {
      currentCase: objectType({ status: scalarType('string') }),
    });
    expect(provided('current_case.status')).toMatchObject(known);
  });
});

describe('the trigger of each type (C115.3)', () => {
  const read = (trigger: object, inputs: WorkflowDefinition['inputs'] = []) =>
    scopeAt(chain([tag('a')], { trigger: trigger as WorkflowDefinition['trigger'], inputs }), 'a');
  const input = [{ name: 'code', type: 'string', required: true }];

  it('an API trigger reads its inputs', () => {
    const scope = read({ type: 'trigger-api', config: {} }, input);
    expect(scope('trigger.code')).toMatchObject(known);
    expect(scope('inputs.code')).toMatchObject(known);
  });

  it('a flow trigger reads its declared inputs alone, never the inquiry (C152.2)', () => {
    const scope = read({ type: 'trigger-flow', config: {} }, input);
    expect(scope('trigger.code')).toMatchObject(known);
    expect(scope('inputs.code')).toMatchObject(known);
    expect(scope('trigger.status')).toMatchObject(unknown);
    expect(scope('trigger.fields')).toMatchObject(unknown);
  });

  it('several events read what they all hold', () => {
    const scope = read({
      type: 'trigger-event',
      config: { events: ['inquiry.completed', 'account.created'] },
    });
    expect(scope('trigger.id')).toMatchObject(known);
    expect(scope('trigger.template.id')).toMatchObject(unknown);
  });

  it('a verification trigger reads what every verification holds', () => {
    const scope = read({
      type: 'trigger-verification',
      config: { events: ['verification.passed'] },
    });
    expect(scope('trigger.status')).toMatchObject(known);
  });

  it('an account trigger reads the account', () => {
    expect(read({ type: 'trigger-account', config: {} })('trigger.reference-id')).toMatchObject(
      known,
    );
  });

  it('a recurring trigger reads its object type', () => {
    const scope = read({
      type: 'trigger-recurring',
      config: { cron: '0 9 * * *', 'time-zone': 'UTC', 'object-type': 'transaction' },
    });
    expect(scope('trigger.status')).toMatchObject(known);
  });

  it('a manual run reads its object type', () => {
    const scope = read({ type: 'trigger-direct', config: { 'object-type': 'report' } });
    expect(scope('trigger.status')).toMatchObject(known);
  });

  it('a scheduled run reads its subject, which may have none', () => {
    const scope = read({ type: 'trigger-schedule', config: {} });
    expect(scope('trigger.id')).toMatchObject({ ok: true, nullable: true });
  });

  it('a case trigger reads the case view: its status and resolution plain, its fields PII (C140.2)', () => {
    const scope = read({ type: 'trigger-case', config: {} });
    expect(scope('trigger.status')).toMatchObject({ ok: true, pii: false });
    expect(scope('trigger.resolution')).toMatchObject({ ok: true, nullable: true, pii: false });
    expect(scope('trigger.fields')).toMatchObject({ ok: true, pii: true });
    expect(scope('trigger.no-such-member')).toMatchObject(unknown);
  });

  it('a module has no trigger', () => {
    const module = chain([tag('a')], { trigger: null, inputs: input });
    const steps = [{ id: 'start', type: 'module-input', name: 'In' }, tag('a'), output()];
    const scope = scopeAt(
      {
        ...module,
        steps: steps as WorkflowDefinition['steps'],
        edges: [edge('e1', 'start', 'next', 'a'), edge('e2', 'a', 'next', 'output')],
      },
      'a',
    );
    expect(scope('trigger.id')).toMatchObject(unknown);
    expect(scope('inputs.code')).toMatchObject(known);
  });
});

describe('step outputs (C115.3)', () => {
  it('holds an earlier step, and not a later one', () => {
    const definition = chain([match, tag('a'), tag('b')]);
    const read = scopeAt(definition, 'a');
    expect(read('steps.match.output.matched')).toMatchObject({ ok: true, nullable: true });
    expect(read('steps.b.output')).toMatchObject(unknown);
    expect(read('steps.a.output')).toMatchObject(unknown);
  });

  it('marks every output of a step that continues on error as nullable (C114.6)', () => {
    const lenient = action(
      'lenient',
      'tag_object',
      { 'object-type': 'inquiry', 'object-id': 'x', tag: 'y' },
      { 'continue-on-error': true },
    );
    const read = scopeAt(chain([lenient, tag('a')]), 'a');
    expect(read('steps.lenient.output.outcome')).toMatchObject({ ok: true, nullable: true });
  });

  function branched(): WorkflowDefinition {
    const route = {
      id: 'decide',
      type: 'conditional',
      name: 'Decide',
      routes: [{ key: 'one', label: 'One', condition: true }],
    };
    return chain([], {
      steps: [
        route,
        tag('left'),
        tag('right'),
        tag('after'),
        output(),
      ] as WorkflowDefinition['steps'],
      edges: [
        edge('e1', 'trigger', 'next', 'decide'),
        edge('e2', 'decide', 'route:one', 'left'),
        edge('e3', 'decide', 'else', 'right'),
        edge('e4', 'left', 'next', 'after'),
        edge('e5', 'right', 'next', 'after'),
        edge('e6', 'after', 'next', 'output'),
      ],
    });
  }

  it('holds at a merge only what every path finished', () => {
    const read = scopeAt(branched(), 'after');
    expect(read('steps.decide.output.route')).toMatchObject(known);
    expect(read('steps.left.output')).toMatchObject(unknown);
    expect(read('steps.right.output')).toMatchObject(unknown);
  });

  it('holds on an error edge everything but the step that failed', () => {
    const definition = chain([], {
      steps: [tag('first'), tag('risky'), tag('recover'), output()],
      edges: [
        edge('e1', 'trigger', 'next', 'first'),
        edge('e2', 'first', 'next', 'risky'),
        edge('e3', 'risky', 'next', 'output'),
        edge('e4', 'risky', 'error', 'recover'),
        edge('e5', 'recover', 'next', 'output'),
      ],
    });
    const read = scopeAt(definition, 'recover');
    expect(read('steps.first.output')).toMatchObject(known);
    expect(read('steps.risky.output')).toMatchObject(unknown);
  });

  function parallel(): WorkflowDefinition {
    return chain([], {
      steps: [
        { id: 'fork', type: 'parallel', name: 'Fork', branches: [{ key: 'a' }, { key: 'b' }] },
        tag('one'),
        tag('two'),
        tag('sibling'),
        { id: 'meet', type: 'join', name: 'Meet', 'join-of': 'fork' },
        tag('after'),
        output(),
      ] as WorkflowDefinition['steps'],
      edges: [
        edge('e1', 'trigger', 'next', 'fork'),
        edge('e2', 'fork', 'branch:a', 'one'),
        edge('e3', 'fork', 'branch:b', 'two'),
        edge('e4', 'two', 'next', 'sibling'),
        edge('e5', 'one', 'next', 'meet'),
        edge('e6', 'sibling', 'next', 'meet'),
        edge('e7', 'meet', 'next', 'after'),
        edge('e8', 'after', 'next', 'output'),
      ],
    });
  }

  it('holds a branch output only after the join', () => {
    expect(scopeAt(parallel(), 'sibling')('steps.one.output')).toMatchObject(unknown);
    expect(scopeAt(parallel(), 'sibling')('steps.two.output')).toMatchObject(known);
    const after = scopeAt(parallel(), 'after');
    expect(after('steps.one.output')).toMatchObject(known);
    expect(after('steps.sibling.output')).toMatchObject(known);
  });

  function looped(mode: object, body: WorkflowDefinition['steps']): WorkflowDefinition {
    const ids = body.map(({ id }) => id);
    const first = ids[0] ?? 'output';
    const last = ids.at(-1) ?? 'output';
    return chain([], {
      steps: [
        { id: 'each', type: 'loop', name: 'Each', ...mode },
        ...body,
        tag('after'),
        output(),
      ] as WorkflowDefinition['steps'],
      edges: [
        edge('e1', 'trigger', 'next', 'each'),
        edge('e2', 'each', 'body', first),
        ...ids.slice(1).map((to, index) => edge(`b${String(index)}`, ids[index] ?? '', 'next', to)),
        backEdge('e3', last, 'each'),
        edge('e4', 'each', 'done', 'after'),
        edge('e5', 'after', 'next', 'output'),
      ],
    });
  }

  it('holds the loop item inside the body only', () => {
    const definition = looped({ mode: 'for-each', items: 'trigger.tags' }, [
      tag('inner'),
      tag('next'),
    ]);
    const inside = scopeAt(definition, 'next');
    expect(inside('loop.item')).toMatchObject({ ok: true, type: { kind: 'string' } });
    expect(inside('loop.index')).toMatchObject(known);
    expect(inside('steps.inner.output')).toMatchObject(known);
    const after = scopeAt(definition, 'after');
    expect(after('loop.item')).toMatchObject(unknown);
    expect(after('steps.inner.output')).toMatchObject(unknown);
    expect(after('steps.each.output.iterations')).toMatchObject(known);
  });

  it('a while loop has an index and no item', () => {
    const definition = looped({ mode: 'while', condition: true, 'max-iterations': 3 }, [
      tag('inner'),
    ]);
    const inside = scopeAt(definition, 'inner');
    expect(inside('loop.index')).toMatchObject(known);
    expect(inside('loop.item')).toMatchObject(unknown);
  });

  it('a map loop collects the type of its array-map-output', () => {
    const collect = {
      id: 'collect',
      type: 'array-map-output',
      name: 'Collect',
      'map-of': 'each',
      value: '{{ loop.index }}',
    };
    const definition = looped({ mode: 'map', items: 'trigger.tags' }, [
      collect,
    ] as WorkflowDefinition['steps']);
    expect(scopeAt(definition, 'after')('steps.each.output.values')).toMatchObject({
      ok: true,
      type: { kind: 'list', of: { kind: 'integer' } },
    });
  });

  it('a map value built from text is tainted by what fed it (C115.6)', () => {
    const collect = {
      id: 'collect',
      type: 'array-map-output',
      name: 'Collect',
      'map-of': 'each',
      value: 'x {{ trigger.fields.name }}',
    };
    const definition = looped({ mode: 'map', items: 'trigger.tags' }, [
      collect,
    ] as WorkflowDefinition['steps']);
    expect(scopeAt(definition, 'after')('steps.each.output.values[0]')).toMatchObject({
      ok: true,
      pii: true,
    });
  });

  it('holds a wait output and a conditional output', () => {
    const wait = {
      id: 'held',
      type: 'wait',
      name: 'Wait',
      mode: 'events',
      subject: 'trigger.id',
      events: ['inquiry.approved'],
      'timeout-seconds': 60,
      'on-timeout': 'continue',
    };
    const read = scopeAt(chain([wait as WorkflowDefinition['steps'][number], tag('a')]), 'a');
    expect(read('steps.held.output.resolved-by')).toMatchObject(known);
    expect(read('steps.held.output.resolver-type')).toMatchObject({ ok: true, nullable: true });
  });

  it('holds an action it does not know as PII and untyped', () => {
    const odd = action('odd', 'no_such_action', {});
    expect(scopeAt(chain([odd, tag('a')]), 'a')('steps.odd.output.x')).toMatchObject({
      ok: true,
      pii: true,
    });
  });
});

describe('outputs a config decides (C123.2, C124.5, C127.10)', () => {
  const code = (properties: object, returnType: string) =>
    action('code', 'evaluate_code', {
      source: 'export default function (input) { return input.a; }',
      properties,
      'return-type': returnType,
    });

  it('types Evaluate Code by its return type and taints it by its properties (C115.6)', () => {
    const clean = scopeAt(chain([code({ a: '{{ trigger.status }}' }, 'boolean'), tag('a')]), 'a');
    expect(clean('steps.code.output.value')).toMatchObject({
      ok: true,
      type: { kind: 'boolean' },
      pii: false,
    });
    const tainted = scopeAt(
      chain([code({ a: '{{ trigger.fields.name }}' }, 'string'), tag('a')]),
      'a',
    );
    expect(tainted('steps.code.output.value')).toMatchObject({
      ok: true,
      type: { kind: 'string' },
      pii: true,
    });
  });

  it('reads inside an object Evaluate Code returns, as nullable', () => {
    const read = scopeAt(chain([code({}, 'object'), tag('a')]), 'a');
    expect(read('steps.code.output.value.score')).toMatchObject({ ok: true, nullable: true });
  });

  it('taints Calculate by its operands, and keeps the operation failure nullable', () => {
    const sum = (operands: readonly unknown[], extra: object = {}) =>
      action('sum', 'calculate', { operator: 'sum', operands, ...extra });
    const clean = scopeAt(chain([sum([1, 2], { default: 0 }), tag('a')]), 'a');
    expect(clean('steps.sum.output.value')).toMatchObject({
      ok: true,
      nullable: false,
      pii: false,
    });
    const tainted = scopeAt(chain([sum(['{{ trigger.fields.age }}', 2]), tag('a')]), 'a');
    expect(tainted('steps.sum.output.value')).toMatchObject({
      ok: true,
      nullable: true,
      pii: true,
    });
  });

  it('holds an HTTPS body opaque with no schema (C124.5)', () => {
    const https = action('call', 'make_https_request', {
      method: 'GET',
      url: 'https://api.example.com/a',
    });
    const read = scopeAt(chain([https, tag('a')]), 'a');
    expect(read('steps.call.output.body')).toMatchObject({ ok: true, pii: true });
    expect(read('steps.call.output.body.score')).toEqual({ ok: false, at: 4, reason: 'untyped' });
    expect(read('steps.call.output.status')).toMatchObject({ ok: true, pii: false });
  });

  it('reads an HTTPS body through its schema, with each mark', () => {
    const https = action('call', 'make_https_request', {
      method: 'GET',
      url: 'https://api.example.com/a',
      'response-schema': [
        { name: 'score', type: 'number', pii: false },
        { name: 'owner', type: 'string', pii: true },
      ],
    });
    const read = scopeAt(chain([https, tag('a')]), 'a');
    expect(read('steps.call.output.body.score')).toMatchObject({
      ok: true,
      nullable: true,
      pii: false,
    });
    expect(read('steps.call.output.body.owner')).toMatchObject({ ok: true, pii: true });
  });

  it('types a fetched object by its type', () => {
    const fetch = action('got', 'fetch_object', { 'object-type': 'account', 'object-id': 'x' });
    const read = scopeAt(chain([fetch, tag('a')]), 'a');
    expect(read('steps.got.output.object.reference-id')).toMatchObject(known);
  });
});

describe('modules (C119.8, C115.6)', () => {
  const module = chain([tag('a')], {
    outputs: [
      { name: 'plain', pii: false },
      { name: 'held', pii: true },
    ],
  });
  const step = (inputs: object) =>
    ({
      id: 'mod',
      type: 'module',
      name: 'Mod',
      'module-workflow-id': 'wfl_1',
      version: 'latest-published',
      inputs,
    }) as WorkflowDefinition['steps'][number];
  const modules = () => module;

  it('reads a module output with its declared mark', () => {
    const read = scopeAt(chain([step({}), tag('a')]), 'a', { modules });
    expect(read('steps.mod.output.plain')).toMatchObject({ ok: true, pii: false });
    expect(read('steps.mod.output.held')).toMatchObject({ ok: true, pii: true });
    expect(read('steps.mod.output.other')).toMatchObject(unknown);
  });

  it('taints every output when a tainted input feeds it', () => {
    const read = scopeAt(chain([step({ x: '{{ trigger.fields.name }}' }), tag('a')]), 'a', {
      modules,
    });
    expect(read('steps.mod.output.plain')).toMatchObject({ ok: true, pii: true });
  });

  it('holds an unresolved module as PII', () => {
    const read = scopeAt(chain([step({}), tag('a')]), 'a');
    expect(read('steps.mod.output.x')).toMatchObject({ ok: true, pii: true });
  });
});

it('answers null for a cycle, which the check refuses', () => {
  const definition = chain([tag('a')]);
  const cyclic = { ...definition, edges: [...definition.edges, edge('back', 'a', 'error', 'a')] };
  expect(buildNodeScopes(indexGraph(cyclic), context)).toBeNull();
});
