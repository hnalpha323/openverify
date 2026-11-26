/** C128.2-C128.4: the static analyses publish and the editor read. None of them decides a run. */
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { analyzeAdverseSteps, boundTemplateIds, conditionalsReading } from './analysis.js';
import { conditional, listMatch, routed, waitEvents } from './golden-invalid.js';
import { LIST_ID, action, chain, edge, output, registry, tag } from './testing.js';

const TEMPLATE = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6';
const OTHER = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X7';

const decline = (id = 'decline'): WorkflowStep =>
  action(id, 'decline_inquiry', { 'inquiry-id': '{{ trigger.id }}' });

const trigger = (config: object, type = 'trigger-event'): WorkflowDefinition['trigger'] =>
  ({ type, config }) as WorkflowDefinition['trigger'];

const bounded = trigger({
  events: ['inquiry.completed'],
  criteria: { in: [{ var: 'trigger.template.id' }, [TEMPLATE]] },
});

const analyze = (
  definition: WorkflowDefinition,
  over: Partial<Parameters<typeof analyzeAdverseSteps>[1]> = {},
) => analyzeAdverseSteps(definition, { registry, ...over });

const first = (definition: WorkflowDefinition, over: Parameters<typeof analyze>[1] = {}) => {
  const [analysis] = analyze(definition, over);
  if (analysis === undefined) {
    throw new Error('no adverse step');
  }
  return analysis;
};

const clean = () => false;

describe('which steps it reads (C122.1)', () => {
  it('holds every adverse step, and no other', () => {
    const definition = chain([tag('a'), decline()]);
    expect(analyze(definition).map(({ stepId, adverse }) => [stepId, adverse])).toEqual([
      ['decline', 'always'],
    ]);
  });

  it('holds a by-config step, which publish then reads against its target', () => {
    const add = action('add', 'add_list_item', {
      'list-id': LIST_ID,
      item: { kind: 'string', value: 'x' },
    });
    expect(analyze(chain([add])).map(({ adverse }) => adverse)).toEqual(['by-config']);
  });

  it('holds nothing for a definition with no adverse step', () => {
    expect(analyze(chain([tag('a')]))).toEqual([]);
  });

  it('lists what the path read, the step itself included', () => {
    const definition = routed({ condition: { '===': [{ var: 'trigger.status' }, 'completed'] } });
    const steps = [definition.steps[0], decline(), output()] as WorkflowDefinition['steps'];
    const edges = [
      edge('e0', 'trigger', 'next', 'a'),
      edge('e1', 'a', 'route:one', 'decline'),
      edge('e2', 'a', 'else', 'output'),
      edge('e3', 'decline', 'next', 'output'),
    ];
    const { reads } = first({ ...definition, steps, edges });
    expect(reads).toEqual(['trigger.id', 'trigger.status']);
  });

  it('keeps out what no path to the step read', () => {
    const definition = chain([decline(), tag('after', '{{ trigger.reference-id }}')]);
    expect(first(definition).reads).toEqual(['trigger.id']);
  });
});

describe('the wording: does a person review this path (C128.2)', () => {
  const wait = waitEvents('review', { events: ['inquiry.approved'] });
  const held = waitEvents('review', { events: ['case.resolved'] });

  function reviewed(waitStep: WorkflowStep, condition: unknown): WorkflowDefinition {
    return chain([], {
      steps: [
        waitStep,
        conditional('resolution', [{ key: 'yes', label: 'Yes', condition }]),
        decline(),
        output(),
      ],
      edges: [
        edge('e1', 'trigger', 'next', 'review'),
        edge('e2', 'review', 'next', 'resolution'),
        edge('e3', 'resolution', 'route:yes', 'decline'),
        edge('e4', 'resolution', 'else', 'output'),
        edge('e5', 'decline', 'next', 'output'),
      ],
    });
  }

  const readsWait = { '===': [{ var: 'steps.review.output.resolved-by' }, 'event'] };

  it('says yes when a wait for a person stands on every path, and a route reads it', () => {
    expect(first(reviewed(held, readsWait)).personReviews).toBe(true);
  });

  it('says no with no such wait', () => {
    expect(first(chain([decline()])).personReviews).toBe(false);
    expect(first(reviewed(wait, readsWait)).personReviews).toBe(false);
  });

  it('says no when the route does not read the wait', () => {
    const blind = { '===': [{ var: 'trigger.status' }, 'completed'] };
    expect(first(reviewed(held, blind)).personReviews).toBe(false);
  });

  it('says no when a path goes round the wait', () => {
    const definition = reviewed(held, readsWait);
    const around = {
      ...definition,
      steps: [
        conditional('fork', [{ key: 'skip', label: 'Skip', condition: true }]),
        ...definition.steps,
      ],
      edges: [
        edge('e0', 'trigger', 'next', 'fork'),
        edge('e9', 'fork', 'route:skip', 'decline'),
        edge('e8', 'fork', 'else', 'review'),
        ...definition.edges.slice(1),
      ],
    };
    expect(first(around).personReviews).toBe(false);
  });

  it('names the conditionals that read a wait, which the run-time rule checks', () => {
    expect(conditionalsReading(reviewed(held, readsWait), 'review')).toEqual(['resolution']);
    expect(conditionalsReading(chain([decline()]), 'review')).toEqual([]);
  });
});

describe('the biometric rule (C128.4)', () => {
  const reasons = (definition: WorkflowDefinition, over: Parameters<typeof analyze>[1] = {}) =>
    first(definition, over).biometricReasons;

  it('an unbounded inquiry trigger counts as biometric (i)', () => {
    expect(reasons(chain([decline()]))).toContain('trigger-unbounded');
  });

  it('a bounded trigger admitting a biometric template counts (i)', () => {
    const definition = chain([decline()], { trigger: bounded });
    expect(reasons(definition, { templateIsBiometric: () => true })).toContain(
      'trigger-admits-biometric',
    );
  });

  it('a template it cannot read counts, failing closed (i)', () => {
    const definition = chain([decline()], { trigger: bounded });
    expect(reasons(definition)).toContain('trigger-admits-biometric');
    expect(reasons(definition, { templateIsBiometric: () => undefined })).toContain(
      'trigger-admits-biometric',
    );
  });

  it('a bounded trigger on non-biometric templates does not', () => {
    const definition = chain([decline()], { trigger: bounded });
    expect(first(definition, { templateIsBiometric: clean })).toMatchObject({
      biometric: false,
      biometricReasons: [],
    });
  });

  it('a verification or a list match trigger counts (i)', () => {
    for (const events of [['verification.passed'], ['list-match.created']]) {
      const definition = chain([decline()], { trigger: trigger({ events }) });
      expect(reasons(definition)).toContain('trigger-unbounded');
    }
  });

  it('reading a selfie result counts (ii)', () => {
    const definition = routed({
      condition: { '===': [{ var: 'trigger.verification_selfie.status' }, 'failed'] },
      'on-null': 'error',
    });
    const steps = [definition.steps[0], decline(), output()] as WorkflowDefinition['steps'];
    const edges = [
      edge('e0', 'trigger', 'next', 'a'),
      edge('e1', 'a', 'route:one', 'decline'),
      edge('e2', 'a', 'else', 'output'),
      edge('e3', 'decline', 'next', 'output'),
    ];
    const bound = { ...definition, steps, edges, trigger: bounded };
    expect(reasons(bound, { templateIsBiometric: clean })).toContain('reads-biometric-result');
  });

  it('a compute step fed by one counts (ii)', () => {
    const code = action('code', 'evaluate_code', {
      source: 'export default function (input) { return input.a; }',
      properties: { a: '{{ trigger.verification_selfie.status }}' },
      'return-type': 'string',
    });
    const definition = chain([code, decline()], { trigger: bounded });
    expect(reasons(definition, { templateIsBiometric: clean })).toContain('reads-biometric-result');
  });

  it('a face-list step on the path counts (ii)', () => {
    const face = action('face', 'add_face_list_item', {
      'list-id': LIST_ID,
      'inquiry-id': '{{ trigger.id }}',
    });
    const definition = chain([face, tag('a', '{{ steps.face.output.status }}'), decline()], {
      trigger: bounded,
    });
    const found = analyze(definition, { templateIsBiometric: clean }).find(
      ({ stepId }) => stepId === 'decline',
    );
    expect(found?.biometricReasons).toContain('reads-biometric-result');
  });

  it('add_face_list_item is always biometric', () => {
    const face = action('face', 'add_face_list_item', {
      'list-id': LIST_ID,
      'inquiry-id': '{{ trigger.id }}',
    });
    const definition = chain([face], { trigger: bounded });
    expect(reasons(definition, { templateIsBiometric: clean })).toEqual(['action-is-biometric']);
  });

  const readingStatus = (triggerValue: WorkflowDefinition['trigger'], condition: unknown) => {
    const definition = routed({ condition });
    return {
      ...definition,
      trigger: triggerValue,
      steps: [definition.steps[0], decline(), output()] as WorkflowDefinition['steps'],
      edges: [
        edge('e0', 'trigger', 'next', 'a'),
        edge('e1', 'a', 'route:one', 'decline'),
        edge('e2', 'a', 'else', 'output'),
        edge('e3', 'decline', 'next', 'output'),
      ],
    };
  };

  it('under another trigger, reading an inquiry status counts unless bounded (iii)', () => {
    const fetchThen = chain(
      [
        action('got', 'fetch_object', { 'object-type': 'inquiry', 'object-id': '{{ inputs.id }}' }),
        tag('a', '{{ steps.got.output.object.status }}'),
        action('decline', 'decline_inquiry', { 'inquiry-id': '{{ inputs.id }}' }),
      ],
      {
        trigger: trigger({}, 'trigger-api'),
        inputs: [{ name: 'id', type: 'id<inq>', required: true }],
      },
    );
    expect(reasons(fetchThen)).toContain('reads-status-unbounded');
  });

  it('reading a status of a bounded biometric template counts (iii)', () => {
    const definition = readingStatus(bounded, { '===': [{ var: 'trigger.status' }, 'failed'] });
    expect(reasons(definition, { templateIsBiometric: () => true })).toContain(
      'reads-status-of-biometric-template',
    );
  });

  it('reading a status of a bounded non-biometric template does not (iii)', () => {
    const definition = readingStatus(bounded, { '===': [{ var: 'trigger.status' }, 'failed'] });
    expect(reasons(definition, { templateIsBiometric: clean })).toEqual([]);
  });

  it('a route that bounds the template bounds the status it guards (iii)', () => {
    const condition = {
      and: [
        { in: [{ var: 'trigger.template.id' }, [TEMPLATE]] },
        { '===': [{ var: 'trigger.status' }, 'failed'] },
      ],
    };
    const event = trigger({ events: ['report/watchlist.matched'] });
    const definition = readingStatus(event, condition);
    expect(reasons(definition, { templateIsBiometric: clean })).not.toContain(
      'reads-status-unbounded',
    );
  });

  it('a report trigger with no status read is no biometric path', () => {
    const definition = chain([action('decline', 'decline_inquiry', { 'inquiry-id': 'x' })], {
      trigger: trigger({ events: ['report/watchlist.matched'] }),
    });
    expect(first(definition).biometric).toBe(false);
  });
});

describe('an H-tier value on the path (C128.3, H10)', () => {
  it('names a beta step whose output the path reads', () => {
    const definition = routed(
      { condition: { '===': [{ var: 'steps.match.output.matched' }, true] }, 'on-null': 'error' },
      listMatch(),
    );
    const steps = [
      definition.steps[0],
      definition.steps[1],
      decline(),
      output(),
    ] as WorkflowDefinition['steps'];
    const edges = [
      edge('e0', 'trigger', 'next', 'match'),
      edge('e1', 'match', 'next', 'a'),
      edge('e2', 'a', 'route:one', 'decline'),
      edge('e3', 'a', 'else', 'output'),
      edge('e4', 'decline', 'next', 'output'),
    ];
    expect(first({ ...definition, steps, edges }).heuristicSteps).toEqual(['match']);
  });

  it('names none when the output is not read', () => {
    expect(first(chain([listMatch(), decline()])).heuristicSteps).toEqual([]);
  });
});

describe('boundTemplateIds (C128.4)', () => {
  const template = { var: 'trigger.template.id' };

  it.each<[string, unknown, readonly string[] | null]>([
    ['in a list', { in: [template, [TEMPLATE, OTHER]] }, [TEMPLATE, OTHER]],
    ['equality', { '===': [template, TEMPLATE] }, [TEMPLATE]],
    ['equality, reversed', { '===': [TEMPLATE, template] }, [TEMPLATE]],
    ['the loose alias', { '==': [template, TEMPLATE] }, [TEMPLATE]],
    ['the public token', { '===': [{ var: 'trigger.template.token' }, TEMPLATE] }, [TEMPLATE]],
    [
      'inside an and',
      { and: [{ '===': [{ var: 'trigger.status' }, 'x'] }, { in: [template, [TEMPLATE]] }] },
      [TEMPLATE],
    ],
    [
      'the narrower of two',
      { and: [{ in: [template, [TEMPLATE, OTHER]] }, { '===': [template, OTHER] }] },
      [OTHER],
    ],
    ['no template', { '===': [{ var: 'trigger.status' }, 'x'] }, null],
    ['an or, which bounds nothing', { or: [{ '===': [template, TEMPLATE] }, true] }, null],
    ['a negation', { '!': [{ '===': [template, TEMPLATE] }] }, null],
    ['a list read from a path', { in: [template, { var: 'vars.ids' }] }, null],
    ['nothing', undefined, null],
    ['a malformed condition', { a: 1, b: 2 }, null],
  ])('%s', (_label, condition, expected) => {
    expect(boundTemplateIds(condition)).toEqual(expected);
  });
});
