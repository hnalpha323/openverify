import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import {
  matchEmailAddresses,
  matchIdentificationNumbers,
  matchPhoneNumbers,
} from './identifiers.js';

describe('matchPhoneNumbers', () => {
  it.each([
    ['+15550100100', '+1 555 010 0100', 'full', []],
    ['+15550100100', '(555) 010-0100', 'partial', ['substring']],
    ['+15550100100', '+15550100199', 'none', []],
    ['+15550100100', '0100', 'none', []],
    [null, '+15550100100', 'missing', []],
  ] as const)('%j and %j: %s', (a, b, level, methods) => {
    expect(matchPhoneNumbers(a, b)).toEqual({ level, methods, flags: [] });
  });
});

describe('matchEmailAddresses', () => {
  it.each([
    ['Ada@Example.test', ' ada@example.test ', 'full'],
    ['ada@example.test', 'adb@example.test', 'none'],
    ['ada@example.test', '', 'missing'],
  ] as const)('%j and %j: %s', (a, b, level) => {
    expect(matchEmailAddresses(a, b).level).toBe(level);
  });
});

describe('matchIdentificationNumbers', () => {
  it.each([
    ['AB-123 456', 'ab123456', 'full'],
    ['AB123456', 'AB123457', 'none'],
    [undefined, 'AB123456', 'missing'],
  ] as const)('%j and %j: %s', (a, b, level) => {
    expect(matchIdentificationNumbers(a, b).level).toBe(level);
  });

  it('reads 100 KB in bounded time (C58.7)', () => {
    expect(
      cpuMilliseconds(() => {
        matchIdentificationNumbers('9'.repeat(100_000), '9'.repeat(100_000));
        matchPhoneNumbers('9'.repeat(100_000), '9'.repeat(100_000));
      }),
    ).toBeLessThan(100);
  });
});
