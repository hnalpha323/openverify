import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from './result.js';
import { idDisallowedTypeDetection } from './id-disallowed-type-detection.js';

describe('idDisallowedTypeDetection', () => {
  it('passes an allowed ID class', () => {
    const result = idDisallowedTypeDetection(
      { idClass: 'passport' },
      { allowedIdClasses: ['passport', 'drivers_license'] },
    );
    expect(result).toEqual({
      name: 'id_disallowed_type_detection',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { idClass: 'passport' },
      stage: 'ga',
      confidence: null,
      provenance: {
        'implementation-version': 1,
        thresholds: { 'allowed-id-classes': ['passport', 'drivers_license'] },
      },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('fails an ID class missing from the allowlist', () => {
    expect(
      idDisallowedTypeDetection({ idClass: 'visa' }, { allowedIdClasses: ['passport'] }),
    ).toMatchObject({ status: 'failed', reasons: ['id_class_not_allowed'] });
  });

  it('fails an ID class on the denylist', () => {
    expect(
      idDisallowedTypeDetection({ idClass: 'voter_id' }, { disallowedIdClasses: ['voter_id'] }),
    ).toMatchObject({ status: 'failed', reasons: ['id_class_disallowed'] });
    expect(
      idDisallowedTypeDetection({ idClass: 'national_id' }, { disallowedIdClasses: ['voter_id'] })
        .status,
    ).toBe('passed');
  });

  it('applies both lists together', () => {
    expect(
      idDisallowedTypeDetection(
        { idClass: 'passport' },
        { allowedIdClasses: ['passport'], disallowedIdClasses: ['passport'] },
      ).reasons,
    ).toEqual(['id_class_disallowed']);
  });

  it('passes an established class without a type policy (C29.6)', () => {
    expect(idDisallowedTypeDetection({ idClass: 'passport' }, {})).toMatchObject({
      status: 'passed',
      reasons: [],
    });
  });

  it.each([
    ['missing', undefined],
    ['blank', ''],
    ['not a known class', 'library_card'],
  ])('answers input_missing when the ID class is %s (C29.6)', (_label, idClass) => {
    expect(idDisallowedTypeDetection({ idClass }, { disallowedIdClasses: ['visa'] })).toMatchObject(
      { status: 'not_applicable', reasons: ['input_missing'], metadata: {} },
    );
  });

  it('answers input_missing for a class the document did not establish (C30.2)', () => {
    expect(
      idDisallowedTypeDetection({ idClass: 'passport', established: false }, {}),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
  });

  it.each([
    ['an empty allowlist', { allowedIdClasses: [] }],
    ['an unknown class', { allowedIdClasses: ['library_card'] }],
    ['an unknown option', { allowed: ['passport'] }],
  ])('rejects %s', (_label, config) => {
    expect(() => idDisallowedTypeDetection({ idClass: 'passport' }, config as never)).toThrow(
      InvalidCheckConfigError,
    );
  });
});
