import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { baseFlow } from './golden/graph-cases.js';
import { FLOW_V2_SCHEMA_ID, flowV2JsonSchema } from './json-schema.js';
import { fieldReferences } from './references.js';
import { FLOW_SCOPE_PATHS } from './schemas/scope.js';
import { flowV2Schema } from './schemas/flow.js';
import { scopeJsonSchema } from './scope-schema.js';
import {
  action,
  branch,
  completion,
  consent,
  database,
  flowOf,
  governmentId,
  phone,
  route,
  screen,
  submit,
  textInput,
  v,
} from './test-flows.js';

describe('fieldReferences (C149.6)', () => {
  const flow = flowOf(
    [
      consent(),
      screen('details', [
        textInput('nickname', 'nickname'),
        { id: 'has_phone', kind: 'checkbox', field: 'has_phone', labelKey: 'has_phone.label' },
        textInput('mobile', 'mobile', { visibleWhen: { '!!': [v('screen.has_phone')] } }),
        {
          id: 'home',
          kind: 'address',
          labelKey: 'home.label',
          fields: { street1: 'street', city: 'city', postalCode: 'postcode', country: 'country' },
        },
        submit(),
      ]),
      governmentId(),
      phone('phone', { prefillFrom: 'mobile' }),
      database('database', { prefillFrom: { name_first: 'nickname' } }),
      branch('route_it', [route('local', { '===': [v('inquiry.fields.country'), 'US'] }, 'else')]),
      action('copy', {
        kind: 'copy_extractions',
        fromStep: 'id_card',
        mapping: { country: 'country-code' },
      }),
      action('push', {
        kind: 'run_workflow',
        workflowId: 'wfl_01HZZZZZZZZZZZZZZZZZZZZZZZ',
        version: 'latest-published',
        inputs: { name: { path: 'inquiry.fields.nickname' }, fixed: { literal: 'x' } },
      }),
      action('account', {
        kind: 'update_account_fields',
        mapping: { nick: { path: 'inquiry.fields.nickname' } },
      }),
      completion(),
    ],
    [
      ['consent', 'next', 'details'],
      ['details', 'next', 'id_card'],
      ['id_card', 'next', 'phone'],
      ['phone', 'next', 'database'],
      ['database', 'next', 'route_it'],
      ['route_it', 'route:local', 'copy'],
      ['route_it', 'else', 'copy'],
      ['copy', 'next', 'push'],
      ['copy', 'error', 'done'],
      ['push', 'next', 'account'],
      ['push', 'error', 'done'],
      ['account', 'next', 'done'],
      ['account', 'error', 'done'],
    ],
  );
  const copy = {
    messages: {
      en: {
        'details.nickname.hint': 'Shown to {nickname} only',
        'flow.completion': 'Thanks {organization}',
      },
      fr: { 'details.nickname.hint': 'Pour {nickname}' },
    },
  };

  it('lists every component, condition, copy placeholder, action and prefill per field, by pointer', () => {
    const references = fieldReferences({ flow, copy });
    expect(references.nickname).toEqual([
      { pointer: '/flow/steps/1/components/0/field', kind: 'component', mode: 'write' },
      { pointer: '/flow/steps/4/prefillFrom/name_first', kind: 'prefill', mode: 'read' },
      { pointer: '/flow/steps/7/action/inputs/name/path', kind: 'action', mode: 'read' },
      { pointer: '/flow/steps/8/action/mapping/nick/path', kind: 'action', mode: 'read' },
      { pointer: '/copy/messages/en/details.nickname.hint', kind: 'copy', mode: 'read' },
      { pointer: '/copy/messages/fr/details.nickname.hint', kind: 'copy', mode: 'read' },
    ]);
    expect(references.has_phone).toEqual([
      { pointer: '/flow/steps/1/components/1/field', kind: 'component', mode: 'write' },
      {
        pointer: '/flow/steps/1/components/2/visibleWhen/!!/0/var',
        kind: 'condition',
        mode: 'read',
      },
    ]);
    expect(references.mobile).toEqual([
      { pointer: '/flow/steps/1/components/2/field', kind: 'component', mode: 'write' },
      { pointer: '/flow/steps/3/prefillFrom', kind: 'prefill', mode: 'read' },
    ]);
    expect(references.country).toEqual([
      { pointer: '/flow/steps/1/components/3/fields/country', kind: 'component', mode: 'write' },
      { pointer: '/flow/steps/5/routes/0/condition/===/0/var', kind: 'condition', mode: 'read' },
      { pointer: '/flow/steps/6/action/mapping/country', kind: 'action', mode: 'write' },
    ]);
    expect(references.street).toHaveLength(1);
    expect(references).not.toHaveProperty('organization');
  });

  it('answers no reference for a flow that names no field', () => {
    expect(
      fieldReferences({ flow: flowOf([consent(), completion()], [['consent', 'next', 'done']]) }),
    ).toEqual({});
  });
});

describe('scopeJsonSchema (C150.2, C150.10)', () => {
  it('nests each path, marks it nullable, and carries its source, tier, stage, PII and availability', () => {
    const schema = scopeJsonSchema({
      paths: [
        {
          path: 'verifications.id_card.age-years',
          type: 'integer',
          nullable: true,
          pii: true,
          tier: 'R/H',
          stage: 'beta',
          source: 'verification',
          outcome: false,
          availableInFlow: true,
        },
        {
          path: 'inquiry.status',
          type: 'enum',
          options: ['pending', 'completed'],
          nullable: false,
          pii: false,
          tier: 'R',
          stage: 'ga',
          source: 'server',
          outcome: false,
          availableInFlow: true,
        },
      ],
    });
    expect(schema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        verifications: {
          type: 'object',
          properties: {
            id_card: {
              type: 'object',
              properties: {
                'age-years': {
                  type: ['integer', 'null'],
                  'x-openverify': {
                    source: 'verification',
                    tier: 'R/H',
                    stage: 'beta',
                    pii: true,
                    outcome: false,
                    availableInFlow: true,
                  },
                },
              },
            },
          },
        },
        inquiry: {
          type: 'object',
          properties: {
            status: {
              enum: ['pending', 'completed'],
              'x-openverify': {
                source: 'server',
                tier: 'R',
                stage: 'ga',
                pii: false,
                outcome: false,
                availableInFlow: true,
              },
            },
          },
        },
      },
    });
  });

  it('describes the template paths with additionalProperties, and every value type', () => {
    const schema = scopeJsonSchema({ paths: FLOW_SCOPE_PATHS });
    const text = JSON.stringify(schema);
    expect(text).not.toContain('<');
    expect(schema).toMatchObject({
      properties: {
        verifications: {
          additionalProperties: {
            properties: { status: { enum: expect.arrayContaining([null, 'passed']) as unknown } },
          },
        },
        inquiry: {
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
            'created-at': { type: 'string', format: 'date-time' },
          },
        },
      },
    });
    for (const source of ['verification', 'server', 'person', 'client', 'operator']) {
      expect(text).toContain(`"source":"${source}"`);
    }
  });
});

describe('flowV2JsonSchema (C147.1)', () => {
  it('is a draft 2020-12 schema with its own id, compiled by ajv in strict mode', () => {
    const schema = flowV2JsonSchema();
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: FLOW_V2_SCHEMA_ID,
      title: 'OpenVerify verification flow, spec 2',
    });
    const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
    const validate = ajv.compile(schema);
    for (const flow of [
      baseFlow(),
      JSON.parse(
        readFileSync(
          new URL('../../../../contracts/fixtures/flows/v2/every-step.json', import.meta.url),
          'utf8',
        ),
      ) as unknown,
    ]) {
      expect(flowV2Schema.safeParse(flow).success).toBe(true);
      expect(validate(flow), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(
      validate({ ...baseFlow(), metadata: { specVersion: 1, id: 'x', version: 1, name: 'x' } }),
    ).toBe(false);
  });

  it('is the committed schema/flow.v2.schema.json (schema:export writes it)', () => {
    const schema = flowV2JsonSchema();
    const committed = JSON.parse(
      readFileSync(new URL('../../schema/flow.v2.schema.json', import.meta.url), 'utf8'),
    ) as unknown;
    expect(committed).toEqual(schema);
  });
});
