/** C61.2 (H12): the registry status table, value by value, per source. */
import { describe, expect, it } from 'vitest';
import type { BusinessRegistrySourceName } from './inputs.js';
import { businessRegistryStatus } from './status.js';
import { registryRecord } from './testing.js';

const read = (
  source: BusinessRegistrySourceName,
  status: string | null,
  statusDetail: string | null = null,
  failOnLapsedLei = false,
) => businessRegistryStatus(registryRecord({ source, status, statusDetail }), { failOnLapsedLei });

describe('businessRegistryStatus: GLEIF', () => {
  it('reads ISSUED with an ACTIVE entity as active', () => {
    expect(read('gleif', 'ISSUED', 'ACTIVE')).toEqual({ answer: 'active', flags: [] });
    expect(read('gleif', 'issued', 'active')).toEqual({ answer: 'active', flags: [] });
  });

  it.each(['LAPSED', 'PENDING_ARCHIVAL'])(
    'reads %s as not available, flagged, unless configured to fail',
    (status) => {
      expect(read('gleif', status, 'ACTIVE')).toEqual({
        answer: 'not_available',
        flags: ['lei-lapsed'],
      });
      expect(read('gleif', status, 'ACTIVE', true)).toEqual({
        answer: 'inactive',
        flags: ['lei-lapsed'],
      });
    },
  );

  it.each([
    ['RETIRED', 'ACTIVE'],
    ['MERGED', 'ACTIVE'],
    ['ISSUED', 'INACTIVE'],
    ['LAPSED', 'INACTIVE'],
  ])('reads %s with entity %s as inactive', (status, entity) => {
    expect(read('gleif', status, entity).answer).toBe('inactive');
  });

  it.each(['ANNULLED', 'DUPLICATE'])('reads %s as no record', (status) => {
    expect(read('gleif', status, 'ACTIVE')).toEqual({ answer: 'no_record', flags: [] });
  });

  it.each([
    ['PENDING_TRANSFER', 'ACTIVE'],
    ['ISSUED', null],
    [null, 'ACTIVE'],
  ])('reads anything else (%s, %s) as not available, never active', (status, entity) => {
    expect(read('gleif', status, entity)).toEqual({
      answer: 'not_available',
      flags: ['status-unmapped'],
    });
  });
});

describe('businessRegistryStatus: Companies House and the sandbox', () => {
  it.each(['active', 'open', 'registered', 'ACTIVE'])('reads %s as active', (status) => {
    expect(read('companies-house', status)).toEqual({ answer: 'active', flags: [] });
  });

  it('flags an active company with a proposal to strike it off', () => {
    expect(read('companies-house', 'active', 'active-proposal-to-strike-off')).toEqual({
      answer: 'active',
      flags: ['active-proposal-to-strike-off'],
    });
  });

  it.each([
    'dissolved',
    'liquidation',
    'receivership',
    'administration',
    'insolvency-proceedings',
    'voluntary-arrangement',
    'converted-closed',
    'closed',
    'removed',
  ])('reads %s as inactive', (status) => {
    expect(read('companies-house', status)).toEqual({ answer: 'inactive', flags: [] });
  });

  it('reads an unmapped value or none as not available', () => {
    expect(read('companies-house', 'converted')).toEqual({
      answer: 'not_available',
      flags: ['status-unmapped'],
    });
    expect(read('companies-house', null).answer).toBe('not_available');
  });

  it("reads the sandbox register by Companies House's values, and inactive", () => {
    expect(read('sandbox', 'active').answer).toBe('active');
    expect(read('sandbox', 'inactive').answer).toBe('inactive');
    expect(read('sandbox', 'dissolved').answer).toBe('inactive');
    expect(read('sandbox', 'unheard-of').answer).toBe('not_available');
  });
});

describe('businessRegistryStatus: SEC EDGAR', () => {
  it('reads every EDGAR record as not available: EDGAR keeps no legal status', () => {
    expect(read('sec-edgar', null)).toEqual({ answer: 'not_available', flags: [] });
    expect(read('sec-edgar', 'active')).toEqual({ answer: 'not_available', flags: [] });
  });
});
