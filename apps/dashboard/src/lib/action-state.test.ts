import { describe, expect, it } from 'vitest';
import { fieldErrorOf, type DisplayProblem } from './action-state';

const PROBLEM: DisplayProblem = {
  title: 'Check the values you entered',
  errors: [
    { pointer: '/data/attributes/name', detail: 'is required' },
    { pointer: '/data/attributes/name', detail: 'is too short' },
    { pointer: '/email', detail: 'Invalid email address' },
  ],
};

describe('fieldErrorOf', () => {
  it('joins the errors at any of the given pointers', () => {
    expect(fieldErrorOf(PROBLEM, '/data/attributes/name')).toBe('is required. is too short');
    expect(fieldErrorOf(PROBLEM, '/name', '/email')).toBe('Invalid email address');
  });

  it('is undefined when there is no error there, or no problem', () => {
    expect(fieldErrorOf(PROBLEM, '/password')).toBeUndefined();
    expect(fieldErrorOf(undefined, '/email')).toBeUndefined();
    expect(fieldErrorOf({ title: 'x' }, '/email')).toBeUndefined();
  });
});
