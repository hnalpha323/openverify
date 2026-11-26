import { describe, expect, it } from 'vitest';
import type { DraftDefinition } from './document-model';
import type { CatalogueAction } from './palette-model';
import {
  declaredPath,
  egressOf,
  pathsOfSchema,
  referencesOf,
  scopeAt,
  type ScopePath,
} from './variable-scope';

/** Output schemas as the catalogue serves them (C122.4): each member with its PII mark. */
const LIST_MATCH_OUTPUT = {
  type: 'object',
  properties: {
    matched: { type: ['boolean', 'null'], pii: false },
    'null-reason': { anyOf: [{ type: 'string' }, { type: 'null' }], pii: false },
    matches: { type: 'array', items: { type: 'object' }, pii: false },
  },
};
const CODE_OUTPUT = {
  type: 'object',
  properties: {
    value: { pii: true, $ref: '#/$defs/__schema0' },
    'source-sha256': { type: 'string', pattern: '^[0-9a-f]{64}$', pii: false },
  },
};
const HTTPS_OUTPUT = {
  type: 'object',
  properties: {
    status: { type: 'integer', pii: false },
    headers: {
      type: 'object',
      properties: { 'content-type': { type: 'string' } },
      pii: false,
    },
  },
};
const DECLINE_OUTPUT = {
  type: 'object',
  properties: {
    'decision-id': { anyOf: [{ type: 'string', pattern: '^idec_' }, { type: 'null' }], pii: false },
    outcome: { type: 'string', enum: ['applied', 'no_change'], pii: false },
  },
};

const row = (key: string, kind: string, outputSchema: unknown): CatalogueAction => ({
  key,
  version: 1,
  kind,
  stage: 'ga',
  delivery: 'pure',
  adverse: 'never',
  triggers: null,
  available: true,
  reason: null,
  outputSchema,
});

const ACTIONS = [
  row('get_list_match', 'internal', LIST_MATCH_OUTPUT),
  row('evaluate_code', 'compute', CODE_OUTPUT),
  row('send_email', 'egress', { type: 'object', properties: {} }),
  row('tag_object', 'internal', { type: 'object', properties: {} }),
];

const pathOf = (paths: readonly ScopePath[], path: string) =>
  paths.find((candidate) => candidate.path === path);

describe('pathsOfSchema (C115.3, C120.6): each output member with its type and marks', () => {
  it('marks a member nullable when its schema allows null, and PII by its mark', () => {
    const paths = pathsOfSchema(LIST_MATCH_OUTPUT, 'steps.check.output', 'Step Check');

    expect(pathOf(paths, 'steps.check.output.matched')).toEqual({
      path: 'steps.check.output.matched',
      type: 'boolean',
      options: [],
      nullable: true,
      pii: false,
      source: 'Step Check',
    });
    expect(pathOf(paths, 'steps.check.output.null-reason')).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(pathOf(paths, 'steps.check.output.matches')).toMatchObject({ type: 'list' });
  });

  it('types an untyped value as any and keeps its PII mark, and reads ids and enums', () => {
    expect(
      pathOf(pathsOfSchema(CODE_OUTPUT, 'steps.code.output', 'Step'), 'steps.code.output.value'),
    ).toMatchObject({ type: 'any', pii: true, nullable: false });
    const decline = pathsOfSchema(DECLINE_OUTPUT, 'steps.decline.output', 'Step');
    expect(pathOf(decline, 'steps.decline.output.decision-id')).toMatchObject({
      type: 'id',
      nullable: true,
    });
    expect(pathOf(decline, 'steps.decline.output.outcome')).toMatchObject({
      type: 'enum',
      options: ['applied', 'no_change'],
    });
  });

  it('walks into an object’s members, and marks all nullable for a step that continues on error', () => {
    const paths = pathsOfSchema(HTTPS_OUTPUT, 'steps.call.output', 'Step', { nullable: true });

    expect(paths.map((path) => [path.path, path.nullable])).toEqual([
      ['steps.call.output.status', true],
      ['steps.call.output.headers.content-type', true],
    ]);
  });
});

describe('declaredPath (C115.3): a declared input, variable or output with its marks', () => {
  it('reads the type DSL, its enum values and its pii suffix', () => {
    expect(declaredPath('inputs.email', 'string pii', 'Input')).toMatchObject({
      type: 'string',
      pii: true,
      nullable: false,
    });
    expect(declaredPath('vars.level', 'enum<low,high>', 'Variable')).toMatchObject({
      type: 'enum',
      options: ['low', 'high'],
    });
    expect(declaredPath('inputs.ref', 'id<inq>', 'Input', { nullable: true })).toMatchObject({
      type: 'id',
      nullable: true,
    });
    expect(declaredPath('vars.n', 'integer', 'Variable', { pii: true })).toMatchObject({
      type: 'integer',
      pii: true,
    });
    expect(declaredPath('vars.list', 'list<string>', 'Variable')).toMatchObject({ type: 'list' });
  });
});

const definition = (overrides: Partial<DraftDefinition> = {}): DraftDefinition => ({
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [
    { name: 'email', type: 'string pii', required: true },
    { name: 'note', type: 'string', required: false },
  ],
  variables: [{ name: 'risk', type: 'number' }],
  steps: [
    {
      id: 'check',
      name: 'Check',
      type: 'action',
      'action-key': 'get_list_match',
      'action-version': 1,
      config: {},
    },
    { id: 'route', name: 'Route', type: 'conditional', routes: [{ key: 'hit', label: 'Hit' }] },
    {
      id: 'code',
      name: 'Code',
      type: 'action',
      'action-key': 'evaluate_code',
      'action-version': 1,
      config: {},
      'continue-on-error': true,
    },
    {
      id: 'mail',
      name: 'Mail',
      type: 'action',
      'action-key': 'send_email',
      'action-version': 1,
      config: { subject: 'Review {{ inputs.email }}', text: 'Risk {{ vars.risk }}' },
    },
    { id: 'output', name: 'Output', type: 'output', mappings: {} },
  ],
  edges: [
    { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'check' },
    { id: 'e1', from: 'check', 'from-port': 'next', to: 'route' },
    { id: 'e2', from: 'route', 'from-port': 'route:hit', to: 'code' },
    { id: 'e3', from: 'route', 'from-port': 'else', to: 'mail' },
    { id: 'e4', from: 'code', 'from-port': 'next', to: 'output' },
    { id: 'e5', from: 'mail', 'from-port': 'next', to: 'output' },
  ],
  outputs: [{ name: 'decision', pii: false }],
  layout: {},
  ...overrides,
});

const TRIGGER: readonly ScopePath[] = [
  { path: 'trigger.id', type: 'id', options: [], nullable: false, pii: false, source: 'Trigger' },
];

describe('scopeAt (C115.3): what a step can read where it stands', () => {
  it('offers the trigger, the inputs, the variables, the run and the steps that always come before', () => {
    const paths = scopeAt(definition(), 'route', ACTIONS, TRIGGER).map((path) => path.path);

    expect(paths).toContain('trigger.id');
    expect(paths).toContain('inputs.email');
    expect(paths).toContain('vars.risk');
    expect(paths).toContain('current_run.id');
    expect(paths).toContain('steps.check.output.matched');
    expect(paths.some((path) => path.startsWith('steps.route'))).toBe(false);
  });

  it('marks an optional input nullable, and a PII input PII', () => {
    const paths = scopeAt(definition(), 'route', ACTIONS, TRIGGER);

    expect(pathOf(paths, 'inputs.note')).toMatchObject({ nullable: true, pii: false });
    expect(pathOf(paths, 'inputs.email')).toMatchObject({ nullable: false, pii: true });
  });

  it('offers no step’s output at the step itself, nor on another route of a conditional', () => {
    const atCheck = scopeAt(definition(), 'check', ACTIONS, TRIGGER).map((path) => path.path);
    const atMail = scopeAt(definition(), 'mail', ACTIONS, TRIGGER).map((path) => path.path);
    const atOutput = scopeAt(definition(), 'output', ACTIONS, TRIGGER);

    expect(atCheck.some((path) => path.startsWith('steps.check'))).toBe(false);
    expect(atMail.some((path) => path.startsWith('steps.code'))).toBe(false);
    expect(atMail).toContain('steps.check.output.matched');
    expect(atOutput.some((path) => path.path.startsWith('steps.code'))).toBe(false);
  });

  it('marks every output of a step that continues on error nullable (C114.6)', () => {
    const shaped = definition({
      edges: [
        { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'code' },
        { id: 'e1', from: 'code', 'from-port': 'next', to: 'output' },
      ],
    });

    expect(
      pathOf(scopeAt(shaped, 'output', ACTIONS, TRIGGER), 'steps.code.output.value'),
    ).toMatchObject({ nullable: true, pii: true });
  });
});

describe('referencesOf and egressOf (C115.6, C121.4)', () => {
  it('finds every {{ path }} in a value’s string leaves', () => {
    expect(
      referencesOf({ a: 'Hello {{ inputs.email }} and {{vars.risk}}', b: ['{{ trigger.id }}', 3] }),
    ).toEqual(['inputs.email', 'vars.risk', 'trigger.id']);
    expect(referencesOf(null)).toEqual([]);
  });

  it('marks an egress step whose rendered values read personal data, naming the paths', () => {
    const shaped = definition();
    const scope = scopeAt(shaped, 'mail', ACTIONS, TRIGGER);
    const mail = shaped.steps.find((step) => step.id === 'mail');
    const check = shaped.steps.find((step) => step.id === 'check');
    if (mail === undefined || check === undefined) {
      throw new Error('fixture');
    }

    expect(egressOf(mail, ACTIONS[2], scope)).toEqual(['inputs.email']);
    expect(
      egressOf({ ...mail, config: { text: 'Risk {{ vars.risk }}' } }, ACTIONS[2], scope),
    ).toEqual([]);
    expect(
      egressOf({ ...check, config: { value: '{{ inputs.email }}' } }, ACTIONS[0], scope),
    ).toEqual([]);
  });

  it('counts a PII-tainted member below a path, such as a value read from its object', () => {
    const scope: ScopePath[] = [
      {
        path: 'trigger.fields',
        type: 'object',
        options: [],
        nullable: false,
        pii: true,
        source: 'Trigger',
      },
    ];
    const step = {
      id: 'mail',
      name: 'Mail',
      type: 'action',
      'action-key': 'send_email',
      config: { text: '{{ trigger.fields.name }}' },
    };

    expect(egressOf(step, ACTIONS[2], scope)).toEqual(['trigger.fields.name']);
  });
});
