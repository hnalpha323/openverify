/**
 * C52.3: what the inputs service keeps of a value (C0 controls and bidirectional characters
 * removed, surrounding space trimmed, nested values too), and the business inputs a body must
 * carry because every configured match group names them.
 */
import { defaultTemplateConfig } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { businessRequiredInputs, cleanInputValues, INPUT_VERIFICATION_TYPES } from './index.js';

describe('cleanInputValues (C52.3)', () => {
  it('removes C0 controls and bidirectional characters, then trims', () => {
    expect(cleanInputValues('  Syn\u0000thia\u0007 ')).toBe('Synthia');
    expect(cleanInputValues('\u202eTesterton\u202c')).toBe('Testerton');
    expect(cleanInputValues('\u2066Main\u2069 \u200eStreet\u200f\u061c')).toBe('Main Street');
    expect(cleanInputValues('\t\n')).toBe('');
  });

  it('keeps letters of every script and inner spaces', () => {
    expect(cleanInputValues('María José  Ñúñez')).toBe('María José  Ñúñez');
    expect(cleanInputValues('山田 太郎')).toBe('山田 太郎');
  });

  it('cleans every value of an object and of an array, and leaves other values alone', () => {
    expect(
      cleanInputValues({
        'business-name': ' Example\u0000 Ltd ',
        'associated-persons': [{ 'name-first': '\u202aAda ', 'name-last': 'Example' }],
        count: 3,
        flag: true,
        nothing: null,
      }),
    ).toEqual({
      'business-name': 'Example Ltd',
      'associated-persons': [{ 'name-first': 'Ada', 'name-last': 'Example' }],
      count: 3,
      flag: true,
      nothing: null,
    });
  });
});

describe('businessRequiredInputs (C52.3)', () => {
  const withGroups = (groups: Record<string, string>[]) => {
    const config = defaultTemplateConfig('database_business');
    return {
      ...config,
      checks: {
        ...config.checks,
        database_business_identity_comparison: {
          enabled: true,
          required: true,
          config: { 'match-groups': groups },
        },
      },
    };
  };

  it('requires the business name under the default groups', () => {
    expect(businessRequiredInputs(defaultTemplateConfig('database_business'))).toEqual([
      'business-name',
    ]);
    expect(businessRequiredInputs(undefined)).toEqual(['business-name']);
  });

  it('requires what every configured group names, as body members', () => {
    expect(
      businessRequiredInputs(withGroups([{ name: 'partial', 'registration-number': 'full' }])),
    ).toEqual(['business-name', 'registration-number']);
    expect(
      businessRequiredInputs(
        withGroups([
          { name: 'partial', address: 'partial' },
          { address: 'full', 'registration-number': 'full' },
        ]),
      ),
    ).toEqual(['address-street-1']);
  });

  it('requires nothing more when the identity check is disabled', () => {
    const config = defaultTemplateConfig('database_business');
    expect(
      businessRequiredInputs({
        ...config,
        checks: {
          ...config.checks,
          database_business_identity_comparison: { enabled: false, required: false },
        },
      }),
    ).toEqual([]);
  });
});

describe('INPUT_VERIFICATION_TYPES (C52.3)', () => {
  it('are the four form types', () => {
    expect(INPUT_VERIFICATION_TYPES).toEqual([
      'database',
      'aamva',
      'database_business',
      'business_website',
    ]);
  });
});
