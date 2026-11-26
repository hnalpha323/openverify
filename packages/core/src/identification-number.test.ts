import { describe, expect, it } from 'vitest';
import { normalizeIdentificationNumber } from './identification-number.js';

/** C31.8, C98.2: the rule the blind index and the list keys share (owner decision 13 after 7A). */
describe('normalizeIdentificationNumber', () => {
  it.each([
    ['l898 902-c3', 'L898902C3'],
    ['L898902C3<<', 'L898902C3'],
    ['  ab.12/cd ', 'AB12CD'],
    ['---', ''],
    ['', ''],
  ])('reads %j as %j: upper case, only A-Z and 0-9 kept', (input, expected) => {
    expect(normalizeIdentificationNumber(input)).toBe(expected);
  });
});
