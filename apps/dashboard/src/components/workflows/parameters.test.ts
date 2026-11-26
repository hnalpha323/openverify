import { describe, expect, it } from 'vitest';
import {
  PARAMETER_PREFIX,
  PARAMETER_TYPE_PREFIX,
  ParameterInputError,
  parameterControlOf,
  parametersOf,
} from './parameters';

const form = (entries: Record<string, [type: string, value: string]>) => {
  const data = new FormData();
  for (const [name, [type, value]] of Object.entries(entries)) {
    data.set(`${PARAMETER_TYPE_PREFIX}${name}`, type);
    data.set(`${PARAMETER_PREFIX}${name}`, value);
  }
  return data;
};

describe('parameterControlOf (C115.3)', () => {
  it.each([
    ['string', 'text'],
    ['id<inq>', 'text'],
    ['enum<low,high>', 'text'],
    ['number', 'number'],
    ['integer', 'number'],
    ['boolean', 'boolean'],
    ['datetime', 'datetime'],
    ['list<string>', 'json'],
    ['object{a: string}', 'json'],
  ] as const)('enters %s as %s', (type, control) => {
    expect(parameterControlOf(type)).toBe(control);
  });
});

describe('parametersOf', () => {
  it('reads each control as its declared type, and leaves an empty one out', () => {
    expect(
      parametersOf(
        form({
          reason: ['string', ' a reason '],
          priority: ['integer', '3'],
          score: ['number', '0.5'],
          urgent: ['boolean', 'true'],
          quiet: ['boolean', 'false'],
          tags: ['list<string>', '["a","b"]'],
          note: ['string', ''],
          flag: ['boolean', ''],
        }),
      ),
    ).toEqual({
      reason: 'a reason',
      priority: 3,
      score: 0.5,
      urgent: true,
      quiet: false,
      tags: ['a', 'b'],
    });
  });

  it('refuses a value that does not hold its type, naming every such parameter', () => {
    expect(() =>
      parametersOf(
        form({
          priority: ['integer', '2.5'],
          score: ['number', 'many'],
          tags: ['list<string>', '[oops'],
          ok: ['string', 'fine'],
        }),
      ),
    ).toThrow(
      expect.objectContaining({ names: ['priority', 'score', 'tags'] }) as ParameterInputError,
    );
  });

  it('ignores every other form field', () => {
    const data = form({ reason: ['string', 'x'] });
    data.set('account-id', 'acc_1');

    expect(parametersOf(data)).toEqual({ reason: 'x' });
  });
});
