import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from './result.js';
import { idDisallowedCountryDetection } from './id-disallowed-country-detection.js';

describe('idDisallowedCountryDetection', () => {
  it('passes a country on the allowlist, whichever code length is used', () => {
    const result = idDisallowedCountryDetection(
      { issuingCountry: 'USA' },
      { allowedCountries: ['US', 'CA'] },
    );
    expect(result).toEqual({
      name: 'id_disallowed_country_detection',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: {},
      stage: 'ga',
      confidence: null,
      provenance: {
        'implementation-version': 1,
        thresholds: { 'allowed-countries': ['US', 'CA'] },
      },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
    expect(
      idDisallowedCountryDetection({ issuingCountry: 'ca' }, { allowedCountries: ['CAN'] }).status,
    ).toBe('passed');
  });

  it('fails a country missing from the allowlist', () => {
    expect(
      idDisallowedCountryDetection({ issuingCountry: 'FR' }, { allowedCountries: ['US'] }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['issuing_country_not_allowed'],
      metadata: {},
    });
  });

  it('fails a country on the denylist', () => {
    expect(
      idDisallowedCountryDetection({ issuingCountry: 'FRA' }, { disallowedCountries: ['FR'] }),
    ).toMatchObject({ status: 'failed', reasons: ['issuing_country_disallowed'] });
    expect(
      idDisallowedCountryDetection({ issuingCountry: 'DE' }, { disallowedCountries: ['FR'] })
        .status,
    ).toBe('passed');
  });

  it('applies both lists together', () => {
    const config = { allowedCountries: ['US', 'GB'], disallowedCountries: ['GB'] };
    expect(idDisallowedCountryDetection({ issuingCountry: 'GB' }, config).reasons).toEqual([
      'issuing_country_disallowed',
    ]);
    expect(idDisallowedCountryDetection({ issuingCountry: 'US' }, config).status).toBe('passed');
  });

  it('understands ICAO MRZ codes such as D for Germany', () => {
    expect(
      idDisallowedCountryDetection({ issuingCountry: 'D<<' }, { allowedCountries: ['DE'] }).status,
    ).toBe('passed');
  });

  it('fails the ICAO specimen state against a real-country allowlist', () => {
    expect(
      idDisallowedCountryDetection({ issuingCountry: 'UTO' }, { allowedCountries: ['US'] }).status,
    ).toBe('failed');
  });

  it('passes an established country without a country policy (C29.6)', () => {
    expect(idDisallowedCountryDetection({ issuingCountry: 'US' }, {})).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {},
    });
    expect(idDisallowedCountryDetection({ issuingCountry: 'UTO' }, {}).status).toBe('passed');
  });

  it.each([
    ['missing', undefined],
    ['blank', ' '],
    ['not a country code', 'XYZW'],
    ['an unassigned alpha-2 code', 'ZZ'],
  ])('answers input_missing when the issuing country is %s (C29.6)', (_label, issuingCountry) => {
    expect(
      idDisallowedCountryDetection({ issuingCountry }, { allowedCountries: ['US'] }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'], metadata: {} });
  });

  it('answers input_missing for a country the document did not establish (C30.2)', () => {
    expect(
      idDisallowedCountryDetection({ issuingCountry: 'US', established: false }, {}),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
  });

  it.each([
    ['an empty allowlist', { allowedCountries: [] }],
    ['an invalid code', { allowedCountries: ['ZZ'] }],
    ['an unknown option', { countries: ['US'] }],
  ])('rejects %s', (_label, config) => {
    expect(() => idDisallowedCountryDetection({ issuingCountry: 'US' }, config as never)).toThrow(
      InvalidCheckConfigError,
    );
  });
});
