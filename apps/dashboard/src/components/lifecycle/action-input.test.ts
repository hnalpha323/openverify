// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ActionInputError } from '../../lib/api/action';
import { idListOf, jsonDocumentsOf, jsonOf, optionalIntegerOf, tagNamesOf } from './action-input';

const ACCOUNT = 'acc_01JB0000000000000000000001';

const errorOf = (run: () => unknown): ActionInputError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ActionInputError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an ActionInputError');
};

describe('tagNamesOf', () => {
  it('reads tags one per line or separated by commas', () => {
    expect(tagNamesOf(' vip \n\nmanual review,gold')).toEqual(['vip', 'manual review', 'gold']);
    expect(tagNamesOf(undefined)).toEqual([]);
  });
});

describe('jsonDocumentsOf', () => {
  it('parses every document by its pointer', () => {
    expect(jsonDocumentsOf({ '/a': '{"x":1}', '/b': '[]' })).toEqual({ '/a': { x: 1 }, '/b': [] });
    expect(jsonOf('null', '/c')).toBeNull();
  });

  it('names every document that is not JSON', () => {
    const error = errorOf(() => jsonDocumentsOf({ '/a': '{', '/b': undefined, '/c': '1' }));

    expect(error.problem).toEqual({
      title: 'Check the values you entered',
      detail: 'Some documents are not valid JSON.',
      errors: [
        { pointer: '/a', detail: 'is not valid JSON' },
        { pointer: '/b', detail: 'is not valid JSON' },
      ],
    });
  });
});

describe('optionalIntegerOf', () => {
  it('reads whole numbers and leaves anything else for the schema to refuse', () => {
    expect(optionalIntegerOf(' 3600 ')).toBe(3600);
    expect(optionalIntegerOf('')).toBeUndefined();
    expect(optionalIntegerOf(undefined)).toBeUndefined();
    expect(optionalIntegerOf('1.5')).toBe('1.5');
  });
});

describe('idListOf', () => {
  const options = { prefix: 'acc', max: 2, pointer: '/meta/ids', noun: 'account' } as const;

  it('reads ids separated by commas, spaces or new lines', () => {
    expect(idListOf(`${ACCOUNT},\n${ACCOUNT}`, options)).toEqual([ACCOUNT, ACCOUNT]);
  });

  it('refuses none, too many or a malformed one, saying what to enter', () => {
    for (const text of [undefined, '', `${ACCOUNT} ${ACCOUNT} ${ACCOUNT}`, 'acc_x']) {
      expect(errorOf(() => idListOf(text, options)).problem.errors).toEqual([
        {
          pointer: '/meta/ids',
          detail: 'Enter 1 to 2 account IDs, such as acc_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
        },
      ]);
    }
  });
});
