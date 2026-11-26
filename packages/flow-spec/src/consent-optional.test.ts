/** C42.3: the consent step's optional texts, each with its own checkbox. */
import { describe, expect, it } from 'vitest';
import { consentStepSchema } from './flow.js';

const step = {
  id: 'consent',
  type: 'consent',
  textKeys: ['consent.biometric', 'consent.processing'],
  required: true,
};

describe('consentStepSchema optionalTextKeys (C42.3)', () => {
  it('stays optional, so stored flows still parse', () => {
    expect(consentStepSchema.safeParse(step).success).toBe(true);
  });

  it('takes distinct translation keys, each shown with its own checkbox', () => {
    expect(
      consentStepSchema.parse({ ...step, optionalTextKeys: ['consent.biometric-matching'] }),
    ).toEqual({ ...step, optionalTextKeys: ['consent.biometric-matching'] });
  });

  it.each([
    ['an invalid key', ['has space']],
    ['a repeated key', ['consent.biometric-matching', 'consent.biometric-matching']],
    ['a key the step already requires', ['consent.processing']],
    ['an empty list', []],
    [
      'more than 20 keys',
      Array.from({ length: 21 }, (_, index) => `consent.optional-${String(index)}`),
    ],
  ])('refuses %s', (_label, optionalTextKeys) => {
    expect(consentStepSchema.safeParse({ ...step, optionalTextKeys }).success).toBe(false);
  });
});
