import { templateSettingsSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  jsonSchemaOf,
  parseTemplateFieldText,
  problemsOf,
  templateFieldText,
  templateFieldsOf,
  type TemplateField,
} from './model';

const SCHEMA = jsonSchemaOf(
  z.strictObject({
    name: z.string().max(40).optional(),
    seconds: z.int().min(300).max(2_592_000).optional(),
    ratio: z.number().optional(),
    days: z.int().min(1).max(3650).nullable().optional(),
    on: z.boolean().optional(),
    mode: z.enum(['all', 'none']),
    lists: z.array(z.string()).optional(),
  }),
);

const field = (name: string): TemplateField => {
  const found = templateFieldsOf(SCHEMA).find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no field ${name}`);
  }
  return found;
};

describe('templateFieldsOf (C153.1): the editor’s form model, for a template member', () => {
  it('types each member as the workflow editor’s model does, in the schema’s order', () => {
    expect(
      templateFieldsOf(SCHEMA).map(({ name, kind, required, nullable }) => [
        name,
        kind,
        required,
        nullable,
      ]),
    ).toEqual([
      ['name', 'text', false, false],
      ['seconds', 'integer', false, false],
      ['ratio', 'number', false, false],
      ['days', 'integer', false, true],
      ['on', 'boolean', false, false],
      ['mode', 'enum', true, false],
      ['lists', 'json', false, false],
    ]);
  });

  it('types a nullable member by its value’s schema, and keeps its bounds', () => {
    expect(field('days').hint).toBe('A whole number from 1 to 3650.');
    expect(field('days').schema).toEqual({ type: 'integer', minimum: 1, maximum: 3650 });
  });

  it('never mentions a workflow variable: a template member is not a C115 template', () => {
    for (const each of templateFieldsOf(SCHEMA)) {
      expect(each.hint).not.toMatch(/\{\{|path|variable/);
    }
    expect(field('name').hint).toBe('Text, at most 40 characters.');
    expect(field('lists').hint).toBe('JSON.');
  });

  it('has no field for a schema that is not an object with members', () => {
    expect(templateFieldsOf({ type: 'string' })).toEqual([]);
  });
});

describe('parseTemplateFieldText', () => {
  it('reads a number, a choice and JSON as the model does, and empty as left out', () => {
    expect(parseTemplateFieldText(field('seconds'), ' 3600 ')).toEqual({ ok: true, value: 3600 });
    expect(parseTemplateFieldText(field('on'), 'false')).toEqual({ ok: true, value: false });
    expect(parseTemplateFieldText(field('lists'), '["a"]')).toEqual({ ok: true, value: ['a'] });
    expect(parseTemplateFieldText(field('seconds'), '')).toEqual({ ok: true, value: undefined });
  });

  it('refuses a variable where a number belongs', () => {
    expect(parseTemplateFieldText(field('seconds'), '{{ inquiry.id }}')).toEqual({
      ok: false,
      problem: 'Enter a whole number.',
    });
    expect(parseTemplateFieldText(field('ratio'), '{{ x }}')).toEqual({
      ok: false,
      problem: 'Enter a number.',
    });
    expect(parseTemplateFieldText(field('seconds'), '1.5')).toEqual({
      ok: false,
      problem: 'Enter a whole number.',
    });
  });

  it('shows a stored value in its control, null as empty', () => {
    expect(templateFieldText(field('days'), null)).toBe('');
    expect(templateFieldText(field('seconds'), 3600)).toBe('3600');
    expect(templateFieldText(field('lists'), ['a'])).toBe('[\n  "a"\n]');
  });
});

describe('problemsOf: the contract’s own refusals, by pointer inside the member', () => {
  it('answers none for a value the contract takes', () => {
    expect(problemsOf(templateSettingsSchema, { 'max-sessions': 25 })).toEqual([]);
  });

  it('answers each refusal at its member, in words', () => {
    const problems = problemsOf(templateSettingsSchema, {
      'max-sessions': 0,
      'inquiry-expiration-seconds': 60,
    });

    expect(problems.map(({ pointer }) => pointer)).toEqual([
      '/inquiry-expiration-seconds',
      '/max-sessions',
    ]);
    expect(problems[0]?.detail).toMatch(/300/);
    expect(problems[1]?.detail).toMatch(/1/);
  });

  it('answers a member the contract does not know', () => {
    const problems = problemsOf(templateSettingsSchema, { extra: 1 });

    expect(problems.map(({ pointer }) => pointer)).toEqual(['']);
    expect(problems[0]?.detail).toMatch(/extra/);
  });
});
