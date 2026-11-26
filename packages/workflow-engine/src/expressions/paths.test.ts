/** C114.2, C114.4: own-property paths over plain JSON, `[n]` for array indexes, seven roots. */
import { describe, expect, it } from 'vitest';
import type { JsonValue } from './json.js';
import { isPathRoot, isSecretPath, parsePath, readSegments } from './paths.js';

describe('parsePath (C114.4)', () => {
  it.each([
    ['trigger.status', ['trigger', 'status']],
    [
      'trigger.verification_government_id.country_code',
      ['trigger', 'verification_government_id', 'country_code'],
    ],
    ['steps.run_watchlist.output.has-match', ['steps', 'run_watchlist', 'output', 'has-match']],
    ['loop.item', ['loop', 'item']],
    ['vars.list[0]', ['vars', 'list', 0]],
    ['vars.grid[2][13].x', ['vars', 'grid', 2, 13, 'x']],
    ['', []],
    ['amount', ['amount']],
  ])('reads %s', (text, segments) => {
    expect(parsePath(text)?.segments).toEqual(segments);
    expect(parsePath(text)?.text).toBe(text);
  });

  it.each([
    'a..b',
    '.a',
    'a.',
    'a b',
    'a[',
    'a[x]',
    'a[]',
    'a[1',
    '[1]',
    'a]1',
    'a.__proto__',
    '__proto__',
    'a.constructor.name',
    'a.prototype',
    'a[-1]',
    'a/b',
    'é',
    `a[${'9'.repeat(20)}]`,
    ['a'].concat(Array.from({ length: 40 }, () => 'b')).join('.'),
  ])('refuses %s', (text) => {
    expect(parsePath(text)).toBeNull();
  });
});

describe('the roots (C114.4)', () => {
  it.each(['trigger', 'inputs', 'vars', 'steps', 'loop', 'current_case', 'current_run', 'event'])(
    'knows %s',
    (root) => {
      expect(isPathRoot(root)).toBe(true);
    },
  );

  it.each(['secrets', 'process', 'constructor', 0, undefined])('does not know %s', (root) => {
    expect(isPathRoot(root)).toBe(false);
  });

  it('says a path reads a secret, in both spellings (C125.3)', () => {
    const secret = (text: string) => isSecretPath(parsePath(text) ?? { text: '', segments: [] });
    expect(secret('secrets.api_key')).toBe(true);
    expect(secret('current_run.environment.secrets.api_key')).toBe(true);
    expect(secret('current_run.environment.kind')).toBe(false);
    expect(secret('vars.secrets')).toBe(false);
  });
});

describe('readSegments (C114.2)', () => {
  const data: JsonValue = { a: { b: [10, { c: null }] }, list: [1, 2] };

  it('reads members and indexes', () => {
    expect(readSegments(data, ['a', 'b', 0])).toBe(10);
    expect(readSegments(data, ['a', 'b', 1, 'c'])).toBeNull();
    expect(readSegments(data, [])).toBe(data);
  });

  it('answers undefined for what is not there', () => {
    expect(readSegments(data, ['a', 'z'])).toBeUndefined();
    expect(readSegments(data, ['list', 5])).toBeUndefined();
    expect(readSegments(data, ['list', 'length'])).toBeUndefined();
    expect(readSegments(data, ['a', 0])).toBeUndefined();
    expect(readSegments(null, ['a'])).toBeUndefined();
    expect(readSegments('text', ['length'])).toBeUndefined();
    expect(readSegments(undefined, ['a'])).toBeUndefined();
  });

  it.each(['constructor', 'toString', 'hasOwnProperty'])(
    'never reads %s off the prototype',
    (name) => {
      expect(readSegments({ a: {} }, ['a', name])).toBeUndefined();
    },
  );

  it('reads an own member even when its name is a prototype name', () => {
    const own = JSON.parse('{"__proto__": 1}') as JsonValue;
    expect(readSegments(own, ['__proto__'])).toBe(1);
  });
});
