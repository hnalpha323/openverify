/** C113.5, C113.6: every rule refuses its golden invalid definition with a JSON Pointer. */
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { readWorkflowFixture } from '../definition/testing.js';
import { scalarType, objectType } from '../variables/types.js';
import { checkDefinition, validateDefinition, type DefinitionCheckContext } from './check.js';
import {
  GOLDEN_INVALID,
  MODULE_DEFINITION,
  forEach,
  listMatch,
  looped,
  moduleStep,
  parallel,
  routed,
  waitEvents,
  whileLoop,
} from './golden-invalid.js';
import { action, chain, output, registry, tag } from './testing.js';

const context = (over: Partial<DefinitionCheckContext> = {}): DefinitionCheckContext => ({
  kind: 'workflow',
  mode: 'publish',
  registry,
  ...over,
});

const check = (definition: WorkflowDefinition, over: Partial<DefinitionCheckContext> = {}) =>
  checkDefinition(definition, context(over));

const codes = (definition: WorkflowDefinition, over: Partial<DefinitionCheckContext> = {}) =>
  check(definition, over).errors.map(({ code }) => code);

const warnings = (definition: WorkflowDefinition, over: Partial<DefinitionCheckContext> = {}) =>
  check(definition, over).warnings.map(({ code }) => code);

describe('the golden invalid definitions (C113.5, C146.1)', () => {
  it.each(GOLDEN_INVALID.map((row, index) => [row.code, index, row] as const))(
    '%s (%i)',
    (code, _index, { pointer, definition, context: over }) => {
      const { errors } = check(definition, over);
      expect(errors).toContainEqual(expect.objectContaining({ code, pointer }));
    },
  );

  it('states a detail that quotes nothing of the definition', () => {
    for (const { definition, context: over } of GOLDEN_INVALID) {
      for (const { detail } of check(definition, over).errors) {
        expect(detail.length).toBeGreaterThan(0);
        expect(detail).not.toContain('Ada');
        expect(detail).not.toContain('{{');
      }
    }
  });
});

describe('what the check admits (C113.5)', () => {
  it.each<[string, WorkflowDefinition]>([
    ['a chain', chain([tag('a')])],
    ['an empty workflow', chain([])],
    ['a parallel', parallel()],
    ['a loop', looped(forEach('each'))],
    ['a while loop', looped(whileLoop('each', { '<': [{ var: 'loop.index' }, 2] }))],
    ['a route', routed({ condition: { '===': [{ var: 'trigger.status' }, 'completed'] } })],
    ['a catch-all route', routed({})],
    [
      'an explicit null test needs no on-null',
      routed({ condition: { '===': [{ var: 'steps.match.output.matched' }, null] } }, listMatch()),
    ],
    ['a wait', chain([waitEvents('a')])],
    [
      'a wait filter on its event',
      chain([waitEvents('a', { filter: { '===': [{ var: 'event.status' }, 'approved'] } })]),
    ],
    [
      'a nullable wait filter with its on-null',
      chain([
        waitEvents('a', {
          filter: { '===': [{ var: 'event.account.id' }, 'x'] },
          'on-null': 'keep-waiting',
        }),
      ]),
    ],
    [
      'a nullable route with its on-null',
      routed(
        { condition: { '===': [{ var: 'steps.match.output.matched' }, true] }, 'on-null': 'error' },
        listMatch(),
      ),
    ],
    [
      'a route on-null naming a route',
      routed(
        {
          condition: { '===': [{ var: 'steps.match.output.matched' }, true] },
          'on-null': 'route:one',
        },
        listMatch(),
      ),
    ],
  ])('%s', (_label, definition) => {
    expect(check(definition).errors).toEqual([]);
  });

  it('admits a condition with no trigger yet in a draft', () => {
    const definition = { ...chain([]), trigger: null, edges: [] };
    expect(check(definition, { mode: 'draft' }).errors).toEqual([]);
  });

  it('admits a module', () => {
    expect(check(MODULE_DEFINITION, { kind: 'module' }).errors).toEqual([]);
  });

  it('admits a module step with its required input', () => {
    const definition = chain([moduleStep('mod', { needed: '{{ trigger.id }}' })]);
    expect(check(definition, { modules: () => MODULE_DEFINITION }).errors).toEqual([]);
  });

  it('leaves module references alone with no resolver', () => {
    expect(codes(chain([moduleStep('mod')]))).toEqual([]);
  });

  it('reads current_case once 8B gives it a type (C140.2)', () => {
    const definition = routed({ condition: { '===': [{ var: 'current_case.status' }, 'open'] } });
    const currentCase = objectType({ status: scalarType('string') });
    expect(check(definition, { currentCase }).errors).toEqual([]);
  });

  it('holds three levels of nesting', () => {
    const definition = looped(forEach('each'));
    expect(check(definition).errors).toEqual([]);
  });

  it('measures the config cap without the members with caps of their own (Stage 1a amendment 21)', () => {
    const code = action('code', 'evaluate_code', {
      source: `export default function (input) { return ${'1 + '.repeat(5_000)}1; }`,
      properties: {},
      'return-type': 'number',
    });
    expect(codes(chain([code]))).toEqual([]);
  });
});

describe('members with caps of their own (Stage 1a amendment 21)', () => {
  const post = (body: unknown) =>
    action('send', 'make_https_request', {
      method: 'POST',
      url: 'https://api.example.com/a',
      body,
    });

  it('reads an Evaluate Code source as code, never as a template (C123.2)', () => {
    const code = action('code', 'evaluate_code', {
      source: 'export default function (input) { return "{{ not a template | x }}"; }',
      properties: {},
      'return-type': 'string',
    });
    expect(codes(chain([code]))).toEqual([]);
  });

  it('holds an Evaluate Code source past the template cap', () => {
    const code = action('code', 'evaluate_code', {
      source: `export default function (input) { return "${'a'.repeat(40_000)}"; }`,
      properties: {},
      'return-type': 'string',
    });
    expect(codes(chain([code]))).toEqual([]);
  });

  it('holds an HTTPS body to its own cap, not a template cap (C124.1)', () => {
    expect(codes(chain([post({ text: 'a'.repeat(100_000) })]))).toEqual([]);
  });

  it('still refuses a bad reference in a large body', () => {
    expect(codes(chain([post({ text: 'a'.repeat(100_000), who: '{{ trigger.nope }}' })]))).toEqual([
      'path_unknown',
    ]);
  });

  it('holds an email HTML to its own cap (C126.1)', () => {
    const email = action('send', 'send_email', {
      recipient: 'a@example.com',
      subject: 'Hi',
      text: 'Hi',
      html: `<p>${'a'.repeat(50_000)}</p>`,
    });
    expect(codes(chain([email]))).toEqual([]);
  });

  it('holds a template with no cap of its own to 32 KiB (C115.2)', () => {
    const definition = {
      ...chain([]),
      outputs: [{ name: 'text', pii: false }],
      steps: [output({ text: 'a'.repeat(32_769) })],
    };
    expect(codes(definition)).toEqual(['template_too_large']);
  });

  it('marks a tainted body in a large template as egress', () => {
    const { egress } = check(
      chain([post({ text: 'a'.repeat(100_000), who: '{{ trigger.fields.name }}' })]),
    );
    expect(egress).toMatchObject([{ paths: ['trigger.fields.name'] }]);
  });
});

describe('trigger-flow (C152.2, Workflow 9A Stage 1a amendment 3)', () => {
  const flowTriggered = (steps: readonly WorkflowStep[]) =>
    chain(steps, {
      trigger: { type: 'trigger-flow', config: {} } as unknown as WorkflowDefinition['trigger'],
    });

  it('refuses an action that lists no trigger: null serves every type but trigger-flow', () => {
    expect(codes(flowTriggered([tag('labelled')]))).toContain('action_trigger_refused');
    expect(codes(chain([tag('labelled')]))).not.toContain('action_trigger_refused');
  });

  it('lists trigger-flow on no catalogue action yet (none until listed)', () => {
    expect(
      registry
        .list()
        .filter((entry) => (entry.triggers as readonly string[] | null)?.includes('trigger-flow')),
    ).toEqual([]);
  });
});

describe('the modes (C113.5)', () => {
  const tainted = chain([tag('a', '{{ trigger.fields.name }}')]);
  const scheduled = chain([], {
    trigger: {
      type: 'trigger-recurring',
      config: { cron: 'H 9 * * *', 'time-zone': 'UTC', 'object-type': 'inquiry' },
    } as WorkflowDefinition['trigger'],
  });

  it('holds the publish rules back from a draft', () => {
    expect(check(tainted, { mode: 'draft' }).errors).toEqual([]);
    expect(check(scheduled, { mode: 'draft' }).errors).toEqual([]);
    expect(check(tainted, { mode: 'draft' }).egress).toEqual([]);
  });

  it('applies them on publish', () => {
    expect(codes(tainted)).toEqual(['pii_into_plain_sink']);
    expect(codes(scheduled)).toEqual(['schedule_invalid']);
  });

  it('types nothing over a graph whose structure fails', () => {
    const broken = { ...chain([tag('a', '{{ trigger.nope }}')]), edges: [] };
    expect(codes(broken)).not.toContain('path_unknown');
    expect(check(broken).egress).toEqual([]);
  });
});

describe('warnings never block (C113.6)', () => {
  it('names a variable nothing reads', () => {
    expect(warnings(chain([], { variables: [{ name: 'risk', type: 'number' }] }))).toContain(
      'variable_unused',
    );
  });

  it('is quiet about a variable something reads', () => {
    const definition = routed({ condition: { '<': [{ var: 'vars.risk' }, 1] } });
    expect(
      warnings({ ...definition, variables: [{ name: 'risk', type: 'number' }] }),
    ).not.toContain('variable_unused');
  });

  it('names a step output nothing reads', () => {
    expect(warnings(chain([tag('a')]))).toContain('output_unread');
  });

  it('is quiet about one something reads', () => {
    const definition = chain([tag('a'), tag('b', '{{ steps.a.output.outcome }}')]);
    expect(check(definition).warnings).not.toContainEqual(
      expect.objectContaining({ code: 'output_unread', pointer: '/steps/0' }),
    );
  });

  it('names a step that emits its own trigger event (C118.8)', () => {
    const step = action('mark', 'mark_inquiry_for_review', { 'inquiry-id': '{{ trigger.id }}' });
    const definition = chain([step], {
      trigger: {
        type: 'trigger-event',
        config: { events: ['inquiry.marked-for-review'] },
      } as WorkflowDefinition['trigger'],
    });
    expect(warnings(definition)).toContain('trigger_self_emitted');
  });

  it('warns when an answer is read without what qualifies it (C127.2, C127.5, C127.10)', () => {
    const sum = action('sum', 'calculate', { operator: 'sum', operands: [1, 2], default: 0 });
    const reading = routed({ condition: { '<': [{ var: 'steps.sum.output.value' }, 1] } }, sum);
    expect(warnings(reading)).toContain('read_without_companion');
    const honest = routed(
      {
        condition: {
          and: [
            { '===': [{ var: 'steps.sum.output.defaulted' }, false] },
            { '<': [{ var: 'steps.sum.output.value' }, 1] },
          ],
        },
      },
      sum,
    );
    expect(warnings(honest)).not.toContain('read_without_companion');
  });

  it('returns warnings beside a clean check', () => {
    expect(check(chain([tag('a')])).errors).toEqual([]);
  });
});

describe('taint (C115.6: golden routes into Slack and into a tag)', () => {
  const slack = (text: string): WorkflowStep =>
    action('notify', 'send_slack_message', { 'webhook-secret': '{{secrets.slack_url}}', text });
  const tagged = (value: string): WorkflowStep => tag('labelled', value);

  const code = action('code', 'evaluate_code', {
    source: 'export default function (input) { return input.name; }',
    properties: { name: '{{ trigger.fields.name }}' },
    'return-type': 'string',
  });
  const sum = action('sum', 'calculate', {
    operator: 'sum',
    operands: ['{{ trigger.fields.age }}', 1],
    default: 0,
  });
  const https = action('call', 'make_https_request', {
    method: 'GET',
    url: 'https://api.example.com/a',
  });
  const piiVariable = [{ name: 'held', type: 'string', pii: true }];
  const assign = action('assign', 'update_variable', {
    name: 'held',
    operator: 'set',
    value: '{{ trigger.fields.name }}',
  });

  const routes: readonly (readonly [
    string,
    readonly WorkflowStep[],
    string,
    Partial<WorkflowDefinition>,
  ])[] = [
    ['Evaluate Code', [code], '{{ steps.code.output.value }}', {}],
    ['a variable', [assign], '{{ vars.held }}', { variables: piiVariable }],
    ['Calculate', [sum], '{{ steps.sum.output.value }}', {}],
    ['an HTTPS body', [https], '{{ steps.call.output.body }}', {}],
  ];

  it.each(routes)('%s into Slack is an egress mark', (_label, before, reference, over) => {
    const { egress, errors } = check(chain([...before, slack(reference)], over));
    expect(errors).toEqual([]);
    expect(egress).toEqual([
      { stepId: 'notify', paths: [reference.slice(3, -3)], destination: 'slack' },
    ]);
  });

  it.each(routes)('%s into a tag is refused', (_label, before, reference, over) => {
    expect(codes(chain([...before, tagged(reference)], over))).toContain('pii_into_plain_sink');
  });

  const overTags = (inner: WorkflowStep): WorkflowDefinition => {
    const definition = looped(forEach('each', 'trigger.verifications'), inner);
    return definition;
  };

  it('a loop item over a tainted list into Slack is an egress mark', () => {
    const list = forEach('each', 'trigger.fields.people');
    const body = action('inner', 'send_slack_message', {
      'webhook-secret': '{{secrets.slack_url}}',
      text: '{{ loop.item }}',
    });
    const { egress } = check(looped(list, body));
    expect(egress).toEqual([{ stepId: 'inner', paths: ['loop.item'], destination: 'slack' }]);
  });

  it('a loop item over a tainted list into a tag is refused', () => {
    const body = tag('inner', '{{ loop.item }}');
    expect(codes(looped(forEach('each', 'trigger.fields.people'), body))).toContain(
      'pii_into_plain_sink',
    );
  });

  it('leaves a clean loop item alone', () => {
    expect(check(overTags(tag('inner', '{{ loop.item.id }}'))).errors).toEqual([]);
  });

  it('marks an email and an SMS with their channel, and HTTPS with its literal host', () => {
    const email = action('send', 'send_email', {
      recipient: 'a@example.com',
      subject: 'Hi',
      text: '{{ trigger.fields.name }}',
    });
    const sms = action('send', 'send_sms', {
      recipient: '+15550100',
      text: '{{ trigger.fields.name }}',
    });
    const post = action('send', 'make_https_request', {
      method: 'POST',
      url: 'https://API.example.com/a',
      body: { name: '{{ trigger.fields.name }}' },
    });
    expect(check(chain([email])).egress).toMatchObject([{ destination: 'email' }]);
    expect(check(chain([sms])).egress).toMatchObject([{ destination: 'sms' }]);
    expect(check(chain([post])).egress).toMatchObject([{ destination: 'api.example.com' }]);
  });

  it('marks no egress for a clean message', () => {
    expect(check(chain([slack('{{ trigger.id }}')])).egress).toEqual([]);
  });

  it('refuses a tainted value into a variable not declared PII', () => {
    const definition = chain([assign], { variables: [{ name: 'held', type: 'string' }] });
    expect(check(definition).errors).toContainEqual(
      expect.objectContaining({ code: 'pii_into_plain_sink', pointer: '/steps/0/config/value' }),
    );
  });

  it('refuses a tainted value into a run output not declared PII', () => {
    const declared = (pii: boolean) => ({
      ...chain([]),
      outputs: [{ name: 'who', pii }],
      steps: [output({ who: '{{ trigger.fields.name }}' })],
    });
    expect(check(declared(false)).errors).toContainEqual(
      expect.objectContaining({ code: 'pii_into_plain_sink', pointer: '/steps/0/mappings/who' }),
    );
    expect(check(declared(true)).errors).toEqual([]);
  });

  it('refuses taint into a status set through update_object', () => {
    const update = action('set', 'update_object', {
      'object-type': 'account',
      'object-id': '{{ trigger.account.id }}',
      field: 'status',
      operator: 'set',
      value: '{{ trigger.fields.name }}',
    });
    expect(codes(chain([update]))).toContain('pii_into_plain_sink');
  });

  it('allows a PII-to-PII copy into a field (C115.6)', () => {
    const update = action('set', 'update_object', {
      'object-type': 'account',
      'object-id': '{{ trigger.account.id }}',
      field: 'first_name',
      operator: 'set',
      value: '{{ trigger.fields.name }}',
    });
    expect(check(chain([update])).errors).toEqual([]);
  });

  it('allows a secret in a header, and a body', () => {
    const post = action('send', 'make_https_request', {
      method: 'POST',
      url: 'https://api.example.com/a',
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.partner_token}}' }],
      body: { key: '{{secrets.partner_token}}' },
    });
    expect(check(chain([post])).errors).toEqual([]);
  });

  it('refuses a templated host through the URL check', () => {
    const get = action('send', 'make_https_request', {
      method: 'GET',
      url: 'https://{{ trigger.id }}.example.com/',
    });
    expect(codes(chain([get]))).toEqual(expect.arrayContaining(['config_invalid']));
  });
});

describe('reads a step can only make once it holds (C127.2, C127.5)', () => {
  const report = action('a', 'run_report', {
    'report-template-id': 'rptp_1',
    'inquiry-id': '{{ trigger.id }}',
  });
  const reading = tag('b', '{{ steps.a.output.has-match }}');

  it('admits has-match on a type with review', () => {
    const definition = chain([report, reading]);
    expect(codes(definition, { reportReviewModel: () => 'matches' })).toEqual([]);
  });

  it('admits it when the type is not known yet, which the run reads as null', () => {
    expect(codes(chain([report, reading]))).toEqual([]);
  });

  it('leaves a template that is a template alone', () => {
    const templated = action('a', 'run_report', {
      'report-template-id': '{{ trigger.id }}',
      'inquiry-id': '{{ trigger.id }}',
    });
    expect(codes(chain([templated, reading]), { reportReviewModel: () => 'none' })).toEqual([]);
  });

  const query = (mode: string) =>
    action('q', 'run_graph_query', {
      'graph-query-template-id': 'grqt_1',
      'account-id': '{{ trigger.account.id }}',
      mode,
    });
  const count = tag('b', '{{ steps.q.output.account-count }}');

  it('admits the count of a synchronous query', () => {
    expect(codes(chain([query('synchronous'), count]))).toEqual([]);
  });

  it('admits the count after a wait on that query dominates the read', () => {
    const wait = waitEvents('held', {
      subject: 'steps.q.output.graph-query-id',
      events: ['graph-query.completed'],
    });
    expect(codes(chain([query('asynchronous'), wait, count]))).toEqual([]);
  });

  it('refuses a wait on something else', () => {
    expect(codes(chain([query('asynchronous'), waitEvents('held'), count]))).toEqual([
      'account_count_refused',
    ]);
  });
});

describe('validateDefinition', () => {
  it('reports a shape the schema refuses, by pointer, quoting nothing', () => {
    const canary = 'change-me-canary-shape';
    const { errors } = validateDefinition({ 'schema-version': 1, trigger: canary }, context());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every(({ code }) => code === 'definition_shape_invalid')).toBe(true);
    expect(errors.map(({ pointer }) => pointer)).toContain('/trigger');
    expect(JSON.stringify(errors)).not.toContain(canary);
  });

  it('passes what the schema reads on to the check', () => {
    expect(validateDefinition(chain([tag('a')]), context()).errors).toEqual([]);
  });
});

describe('the contracts golden definitions (C113, Stage 1a followup)', () => {
  const module = validateDefinition(
    readWorkflowFixture('definition-module.json'),
    context({ kind: 'module' }),
  );

  it('holds the module valid', () => {
    expect(module.errors).toEqual([]);
  });

  it('holds the workflow with every node type valid', () => {
    const modules = () => readDefinitionFixture('definition-module.json');
    const { errors } = validateDefinition(
      readWorkflowFixture('definition-every-node.json'),
      context({ modules }),
    );
    expect(errors).toEqual([]);
  });

  function readDefinitionFixture(name: string): WorkflowDefinition {
    return workflowDefinitionSchema.parse(readWorkflowFixture(name));
  }
});
