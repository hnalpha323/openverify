/**
 * C235.1, C237.6 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 3): the provenance
 * builders. Their output is checked against `provenanceSchema` by `api-redeem`'s tests (this package
 * cannot import the contracts); here every member, the least disclosure and the withdrawal mark.
 */
import { describe, expect, it } from 'vitest';
import {
  cloneProvenance,
  hydrateProvenance,
  withConsentWithdrawn,
  type CloneProvenanceInput,
  type HydrateProvenanceInput,
} from './provenance.js';

const CLONE: CloneProvenanceInput = {
  shareTokenId: 'cnst_01M5CN0000000000000011A200',
  sourceOrganizationName: 'Example Source',
  sourceEnvironmentKind: 'sandbox',
  sourceCreatedAt: new Date('2026-10-20T11:00:00.000Z'),
  sourceStatus: 'approved',
  clonedAt: new Date('2026-11-12T09:00:00.000Z'),
};

const HYDRATE: HydrateProvenanceInput = {
  shareTokenId: 'cnst_01M5CN0000000000000011A200',
  sourceOrganizationName: 'Example Source',
  hydratedAt: new Date('2026-11-12T09:00:00.000Z'),
  fields: ['name_last', 'person.given_name', 'name_last', 'birthdate'],
};

describe('a clone’s provenance (C235.1)', () => {
  it('names the token, the source organisation and environment kind, and the source’s times and status', () => {
    expect(cloneProvenance(CLONE)).toEqual({
      kind: 'connect-clone',
      'share-token-id': 'cnst_01M5CN0000000000000011A200',
      'source-organization-name': 'Example Source',
      'source-environment-kind': 'sandbox',
      'source-created-at': '2026-10-20T11:00:00.000Z',
      'source-status': 'approved',
      'cloned-at': '2026-11-12T09:00:00.000Z',
    });
  });

  it('serves the name as NFC', () => {
    const decomposed = 'Exámple Source';
    const record = cloneProvenance({ ...CLONE, sourceOrganizationName: decomposed });
    expect(record['source-organization-name']).toBe(decomposed.normalize('NFC'));
    expect(record['source-organization-name']).not.toBe(decomposed);
  });

  it.each([
    ['an empty name', { sourceOrganizationName: '' }],
    ['a name over 255 characters', { sourceOrganizationName: 'x'.repeat(256) }],
    ['an empty status', { sourceStatus: '' }],
    ['a status over 64 characters', { sourceStatus: 'x'.repeat(65) }],
    ['a token id that is not one', { shareTokenId: 'inq_01M5CN0000000000000011A200' }],
    ['an invalid time', { clonedAt: new Date(Number.NaN) }],
  ] as [string, Partial<CloneProvenanceInput>][])('refuses %s', (_name, patch) => {
    expect(() => cloneProvenance({ ...CLONE, ...patch })).toThrow(RangeError);
  });
});

describe('a hydrate’s provenance (C235.1)', () => {
  it('names the token, the organisation, the time and the filled keys, distinct and sorted', () => {
    expect(hydrateProvenance(HYDRATE)).toEqual({
      kind: 'connect-hydrate',
      'share-token-id': 'cnst_01M5CN0000000000000011A200',
      'source-organization-name': 'Example Source',
      'hydrated-at': '2026-11-12T09:00:00.000Z',
      fields: ['birthdate', 'name_last', 'person.given_name'],
    });
  });

  it.each([
    ['a key that is not a field name', ['Name']],
    ['a key over 128 characters', [`a${'b'.repeat(128)}`]],
    ['more than 1000 keys', Array.from({ length: 1001 }, (_, index) => `f${String(index)}`)],
  ])('refuses %s', (_name, fields) => {
    expect(() => hydrateProvenance({ ...HYDRATE, fields })).toThrow(RangeError);
  });
});

describe('least disclosure (C235.1: no source object id)', () => {
  it('has no member beyond the contract’s, and no value but the token’s that is an id', () => {
    const records = [cloneProvenance(CLONE), hydrateProvenance(HYDRATE)];
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(
      [
        'kind',
        'share-token-id',
        'source-organization-name',
        'source-environment-kind',
        'source-created-at',
        'source-status',
        'cloned-at',
      ].sort(),
    );
    for (const record of records) {
      const values = Object.entries(record)
        .filter(([name]) => name !== 'share-token-id')
        .flatMap(([, value]): unknown[] =>
          Array.isArray(value) ? [...(value as unknown[])] : [value],
        );
      for (const value of values) {
        expect(String(value)).not.toMatch(/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/);
      }
    }
  });
});

describe('a withdrawn destination consent (C237.6 (2))', () => {
  it('marks a clone and a hydrate, keeps the first withdrawal, and never changes its input', () => {
    const clone = cloneProvenance(CLONE);
    const first = withConsentWithdrawn(clone, new Date('2026-11-13T00:00:00.000Z'));
    expect(first).toEqual({ ...clone, 'consent-withdrawn-at': '2026-11-13T00:00:00.000Z' });
    expect(clone).not.toHaveProperty('consent-withdrawn-at');
    const second = withConsentWithdrawn(first, new Date('2026-11-14T00:00:00.000Z'));
    expect(second['consent-withdrawn-at']).toBe('2026-11-13T00:00:00.000Z');
    const hydrate = withConsentWithdrawn(
      hydrateProvenance(HYDRATE),
      new Date('2026-11-13T00:00:00.000Z'),
    );
    expect(hydrate.kind).toBe('connect-hydrate');
    expect(hydrate['consent-withdrawn-at']).toBe('2026-11-13T00:00:00.000Z');
    expect(
      withConsentWithdrawn({ ...clone, 'consent-withdrawn-at': null }, new Date(0))[
        'consent-withdrawn-at'
      ],
    ).toBe('1970-01-01T00:00:00.000Z');
  });
});
