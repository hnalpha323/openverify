import { describe, expect, it } from 'vitest';
import { fieldsOf, fieldText, parseFieldText, type FormField } from './schema-form-model';

/** The shape `z.toJSONSchema()` gives a decline's config (C122.4), with synthetic members added. */
const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    'inquiry-id': { type: 'string', minLength: 1, maxLength: 512 },
    'decision-basis': { type: 'string', enum: ['contract', 'law', 'explicit-consent'] },
    'contest-route': { type: 'object', properties: { url: { type: 'string' } } },
    'timeout-seconds': { default: 10, type: 'integer', minimum: 1, maximum: 30 },
    ratio: { type: 'number' },
    'capture-error-body': { type: 'boolean' },
    'webhook-secret': {
      type: 'string',
      pattern: '^\\{\\{\\s*secrets\\.[a-z][a-z0-9_]{0,63}\\s*\\}\\}$',
    },
    body: { $ref: '#/$defs/__schema0' },
    kind: { type: 'string', const: 'country' },
  },
  required: ['inquiry-id', 'timeout-seconds'],
  additionalProperties: false,
};

const field = (name: string): FormField => {
  const found = fieldsOf(SCHEMA).find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no field ${name}`);
  }
  return found;
};

describe('fieldsOf (C141.4): a form field per config member, in the schema’s order', () => {
  it('types each member by its schema, and keeps the rest as JSON', () => {
    expect(fieldsOf(SCHEMA).map(({ name, kind, required }) => [name, kind, required])).toEqual([
      ['inquiry-id', 'text', true],
      ['decision-basis', 'enum', false],
      ['contest-route', 'json', false],
      ['timeout-seconds', 'integer', true],
      ['ratio', 'number', false],
      ['capture-error-body', 'boolean', false],
      ['webhook-secret', 'text', false],
      ['body', 'json', false],
      ['kind', 'enum', false],
    ]);
  });

  it('lists an enum’s options, says a range and a default, and marks a secret reference', () => {
    expect(field('decision-basis').options).toEqual(['contract', 'law', 'explicit-consent']);
    expect(field('kind').options).toEqual(['country']);
    expect(field('timeout-seconds').hint).toBe('A whole number from 1 to 30; 10 when left out.');
    expect(field('inquiry-id').hint).toBe('Text, or one {{ path }}, at most 512 characters.');
    expect(field('webhook-secret').secret).toBe(true);
    expect(field('webhook-secret').hint).toMatch(/\{\{ secrets\.<key> \}\}/);
    expect(field('inquiry-id').secret).toBe(false);
  });

  it('has no field for a schema that is not an object with members', () => {
    expect(fieldsOf({ type: 'object' })).toEqual([]);
    expect(fieldsOf(null)).toEqual([]);
  });
});

describe('fieldText and parseFieldText (C115.1): a value as typed, and back', () => {
  it('leaves an empty control out, rather than sending an empty value', () => {
    expect(parseFieldText(field('inquiry-id'), '')).toEqual({ ok: true, value: undefined });
    expect(parseFieldText(field('capture-error-body'), '')).toEqual({ ok: true, value: undefined });
  });

  it('keeps text and templates as text', () => {
    expect(parseFieldText(field('inquiry-id'), '{{ trigger.id }}')).toEqual({
      ok: true,
      value: '{{ trigger.id }}',
    });
  });

  it('reads a number, refuses a fraction for a whole number, and takes one reference instead', () => {
    expect(parseFieldText(field('timeout-seconds'), '12')).toEqual({ ok: true, value: 12 });
    expect(parseFieldText(field('ratio'), '0.5')).toEqual({ ok: true, value: 0.5 });
    expect(parseFieldText(field('timeout-seconds'), '1.5')).toEqual({
      ok: false,
      problem: 'Enter a whole number, or one {{ path }}.',
    });
    expect(parseFieldText(field('ratio'), 'many')).toEqual({
      ok: false,
      problem: 'Enter a number, or one {{ path }}.',
    });
    expect(parseFieldText(field('timeout-seconds'), '{{ vars.wait }}')).toEqual({
      ok: true,
      value: '{{ vars.wait }}',
    });
  });

  it('reads a boolean and an enum only from their choices', () => {
    expect(parseFieldText(field('capture-error-body'), 'true')).toEqual({ ok: true, value: true });
    expect(parseFieldText(field('capture-error-body'), 'false')).toEqual({
      ok: true,
      value: false,
    });
    expect(parseFieldText(field('decision-basis'), 'law')).toEqual({ ok: true, value: 'law' });
    expect(parseFieldText(field('decision-basis'), 'whim')).toEqual({
      ok: false,
      problem: 'Choose one of the listed values.',
    });
  });

  it('reads JSON, and says when it is not JSON', () => {
    expect(parseFieldText(field('body'), '{"a": ["{{ inputs.x }}"]}')).toEqual({
      ok: true,
      value: { a: ['{{ inputs.x }}'] },
    });
    expect(parseFieldText(field('body'), '{"a":')).toEqual({
      ok: false,
      problem: 'Enter JSON.',
    });
  });

  it('shows a stored value as its control holds it', () => {
    expect(fieldText(field('timeout-seconds'), 12)).toBe('12');
    expect(fieldText(field('capture-error-body'), false)).toBe('false');
    expect(fieldText(field('inquiry-id'), undefined)).toBe('');
    expect(fieldText(field('contest-route'), { url: 'https://example.org/contest' })).toBe(
      '{\n  "url": "https://example.org/contest"\n}',
    );
    expect(fieldText(field('inquiry-id'), 42)).toBe('42');
  });
});

describe('a form outside a workflow (C153.1, C153.5; requested by dashboard-template-forms R3)', () => {
  const plain = (name: string): FormField => {
    const found = fieldsOf(SCHEMA, { references: false }).find(
      (candidate) => candidate.name === name,
    );
    if (found === undefined) {
      throw new Error(`no field ${name}`);
    }
    return found;
  };

  it('never mentions a {{ path }} in a hint, since a template member is no C115 template', () => {
    for (const formField of fieldsOf(SCHEMA, { references: false })) {
      expect(formField.hint).not.toContain('{{');
    }
    expect(plain('inquiry-id').hint).toBe('Text, at most 512 characters.');
    expect(plain('contest-route').hint).toBe('JSON.');
  });

  it('refuses a {{ path }} in a number, saying what it takes', () => {
    expect(
      parseFieldText(plain('timeout-seconds'), '{{ inputs.n }}', { references: false }),
    ).toEqual({
      ok: false,
      problem: 'Enter a whole number.',
    });
    expect(parseFieldText(plain('ratio'), '{{ inputs.n }}', { references: false })).toEqual({
      ok: false,
      problem: 'Enter a number.',
    });
    expect(parseFieldText(plain('timeout-seconds'), '12', { references: false })).toEqual({
      ok: true,
      value: 12,
    });
  });

  it('keeps the workflow’s behaviour by default', () => {
    expect(field('inquiry-id').hint).toContain('{{ path }}');
    expect(parseFieldText(field('timeout-seconds'), '{{ inputs.n }}')).toEqual({
      ok: true,
      value: '{{ inputs.n }}',
    });
  });
});
