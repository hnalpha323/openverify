import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { STEP_TYPES, parseFlow } from './flow.js';
import { FLOW_SCHEMA_ID, flowJsonSchema } from './json-schema.js';
import { mutateFlow, stepIndex, validFlow } from './test-fixtures.js';

const committedSchemaPath = path.resolve(import.meta.dirname, '../schema/flow.schema.json');

function compile(): ReturnType<Ajv2020['compile']> {
  // strict mode makes ajv reject unknown keywords, so the schema must be clean JSON Schema.
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  return ajv.compile(flowJsonSchema());
}

describe('flowJsonSchema', () => {
  it('is a draft 2020-12 schema with a stable id and title', () => {
    expect(flowJsonSchema()).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: FLOW_SCHEMA_ID,
      title: 'OpenVerify verification flow',
    });
  });

  it('compiles under ajv strict mode', () => {
    expect(() => compile()).not.toThrow();
  });

  it('accepts the flow that parseFlow accepts', () => {
    const validate = compile();
    expect(validate(validFlow()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('describes every step type', () => {
    const serialized = JSON.stringify(flowJsonSchema());
    for (const type of STEP_TYPES) {
      expect(serialized).toContain(`"const":"${type}"`);
    }
  });

  it.each([
    ['empty steps', mutateFlow((flow) => (flow.steps = []))],
    [
      'an unknown step type',
      mutateFlow((flow) => (flow.steps[0] = { id: 'x', type: 'video_call' })),
    ],
    ['a missing required property', mutateFlow((flow) => delete flow.metadata)],
    ['an unknown property', mutateFlow((flow) => (flow.extra = true))],
    [
      'NFC not marked Android-only',
      mutateFlow(
        (flow) =>
          (flow.steps[stepIndex('nfc_chip')] = { id: 'n', type: 'nfc', androidOnly: false }),
      ),
    ],
    [
      'too many attempts',
      mutateFlow(
        (flow) => ((flow.steps[stepIndex('gov_id')] as Record<string, unknown>).maxAttempts = 11),
      ),
    ],
    [
      'an array condition',
      mutateFlow((flow) => (flow.transitions[0] = { from: 'gov_id', to: 'selfie', condition: [] })),
    ],
    [
      'a lowercase country',
      mutateFlow(
        (flow) =>
          ((flow.steps[stepIndex('gov_id')] as Record<string, unknown>).allowedCountries = ['us']),
      ),
    ],
    [
      'duplicate capture methods',
      mutateFlow(
        (flow) =>
          ((flow.steps[stepIndex('gov_id')] as Record<string, unknown>).captureMethods = [
            'camera',
            'camera',
          ]),
      ),
    ],
  ])('rejects %s, like parseFlow', (_label, flow) => {
    expect(compile()(flow)).toBe(false);
    expect(() => parseFlow(flow)).toThrow();
  });

  it('cannot express cross-references, which only parseFlow enforces', () => {
    const unknownTarget = mutateFlow((flow) =>
      flow.transitions.push({ from: 'consent', to: 'ghost' }),
    );
    const duplicateIds = mutateFlow((flow) => flow.steps.push({ id: 'done', type: 'completion' }));
    for (const flow of [unknownTarget, duplicateIds]) {
      expect(compile()(flow)).toBe(true);
      expect(() => parseFlow(flow)).toThrow();
    }
  });

  it('matches the committed schema/flow.schema.json (run `pnpm schema:export` after changes)', () => {
    const committed = JSON.parse(readFileSync(committedSchemaPath, 'utf8')) as unknown;
    expect(committed).toEqual(flowJsonSchema());
  });
});
