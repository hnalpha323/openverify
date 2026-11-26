import { describe, expect, it } from 'vitest';
import { isCardLike, transactionTextProblems } from './engine.js';

/*
 * C104.4 (P20). The golden numbers are public processor test numbers and digit strings whose Luhn
 * result was worked out outside this code. None is a real card.
 */
const SIXTEEN = '4242424242424242';
const LUHN_FAILS = '4242424242424241';

function cpuMilliseconds(work: () => void): number {
  const start = process.cpuUsage();
  work();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}

describe('isCardLike on strings (C104.4)', () => {
  it.each([
    ['13 digits', '4222222222222'],
    ['14 digits', '30569309025904'],
    ['15 digits', '378282246310005'],
    ['16 digits', SIXTEEN],
    ['17 digits', '42424242424242426'],
    ['18 digits', '424242424242424242'],
    ['19 digits', '4242424242424242428'],
    ['single spaces', '4242 4242 4242 4242'],
    ['single hyphens', '4242-4242-4242-4242'],
    ['mixed separators', '4242-4242 4242-4242'],
    ['the American Express grouping', '3782 822463 10005'],
    ['surrounding text', 'card 4242 4242 4242 4242 exp 12/29'],
    ['a closing comma', `paid with ${SIXTEEN},`],
    ['a leading sign', `-${SIXTEEN}`],
    ['brackets', `(${SIXTEEN})`],
    ['an underscore prefix', `pan_${SIXTEEN}`],
    ['a date in the same run', `2026-10-31 ${SIXTEEN}`],
    ['full-width digits', '４２４２４２４２４２４２４２４２'],
  ])('refuses %s', (_name, value) => {
    expect(isCardLike(value)).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['text', 'no digits at all'],
    ['a failing check digit', LUHN_FAILS],
    ['12 digits that pass Luhn', '123456789015'],
    ['20 digits that pass Luhn', '12345678901234567894'],
    ['a double space', '4242  4242 4242 4242'],
    ['a double hyphen', '4242--4242-4242-4242'],
    ['dots', '4242.4242.4242.4242'],
    ['underscores', '4242_4242_4242_4242'],
    ['a run touching letters', `a${SIXTEEN}b`],
    ['a run inside a hex digest', `9f${SIXTEEN}c0d1e2f3a4b5`],
    ['a timestamp', '2026-10-31T12:00:00.000Z'],
    ['a phone number', '+1 415-555-0100'],
  ])('passes %s', (_name, value) => {
    expect(isCardLike(value)).toBe(false);
  });

  it('finds a card beside a run too long to be one', () => {
    expect(isCardLike(`12345678901234567894 ${SIXTEEN}`)).toBe(true);
  });

  it('stays linear on the longest text a json value can hold', () => {
    // CPU time grows under contention on shared cores, so the budget is the same bytes in small
    // pieces, read beside it: a quadratic scan costs a hundred times that, a linear one about once.
    const texts = (repeat: number) => ['1 '.repeat(repeat), `${'1'.repeat(repeat * 2 - 1)}a`];
    const cheapest = (run: () => void) =>
      Math.min(cpuMilliseconds(run), cpuMilliseconds(run), cpuMilliseconds(run));
    const [digits = '', untouched = ''] = texts(32_768);
    const [fewDigits = '', fewUntouched = ''] = texts(328);

    const whole = cheapest(() => {
      isCardLike(digits);
      isCardLike(untouched);
    });
    const pieces = cheapest(() => {
      for (let piece = 0; piece < 100; piece += 1) {
        isCardLike(fewDigits);
        isCardLike(fewUntouched);
      }
    });

    expect(whole).toBeLessThan(pieces * 10 + 50);
  });
});

describe('isCardLike on numbers (C104.4)', () => {
  it.each([
    ['13 digits', 4222222222222],
    ['16 digits', 4242424242424242],
    ['a negative number', -4242424242424242],
  ])('refuses %s', (_name, value) => {
    expect(isCardLike(value)).toBe(true);
  });

  it.each([
    ['12 digits', 123456789015],
    ['a failing check digit', 4242424242424241],
    ['a fraction', 4222222222222.5],
    ['no digits to speak of', 0],
    ['20 digits', 1e19],
    ['the exponent form', 1e21],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('passes %s', (_name, value) => {
    expect(isCardLike(value)).toBe(false);
  });

  it('refuses 16 to 19 digits past MAX_SAFE_INTEGER, whose digits JSON.parse has already changed', () => {
    const rounded = JSON.parse('6200000000000000005') as number;
    expect(String(rounded)).not.toBe('6200000000000000005');
    expect(isCardLike(rounded)).toBe(true);
    expect(isCardLike(-rounded)).toBe(true);
  });
});

describe('transactionTextProblems (C104.4: reference-id, tags and labels)', () => {
  it('answers each position, with a pointer and never the value', () => {
    const problems = transactionTextProblems({
      'reference-id': SIXTEEN,
      tags: ['vip', '4242 4242 4242 4242'],
      label: `chargeback ${SIXTEEN}`,
      'model-version': SIXTEEN,
    });
    expect(problems).toEqual([
      { code: 'card_number_refused', pointer: '/reference-id' },
      { code: 'card_number_refused', pointer: '/tags/1' },
      { code: 'card_number_refused', pointer: '/label' },
      { code: 'card_number_refused', pointer: '/model-version' },
    ]);
    expect(JSON.stringify(problems)).not.toContain('4242');
  });

  it('passes texts with no card in them, and a cleared reference-id', () => {
    expect(
      transactionTextProblems({
        'reference-id': null,
        tags: ['vip'],
        label: 'fraud',
        'model-version': 'model-7',
      }),
    ).toEqual([]);
    expect(transactionTextProblems({ 'reference-id': LUHN_FAILS })).toEqual([]);
    expect(transactionTextProblems({})).toEqual([]);
  });
});
