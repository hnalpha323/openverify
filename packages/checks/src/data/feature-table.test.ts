import { describe, expect, it } from 'vitest';
import {
  EU_MEMBER_STATES,
  SANDBOX_TEST_ISSUER,
  documentFeatures,
  type DocumentIssuer,
} from './feature-table.js';

const icao = (code: string, country: string | null = null): DocumentIssuer => ({
  scheme: 'icao',
  code,
  country,
  jurisdiction: null,
});
const aamva = (code: string, jurisdiction: string, country = 'US'): DocumentIssuer => ({
  scheme: 'aamva',
  code,
  country,
  jurisdiction,
});

describe('the feature table (C33, C30.7)', () => {
  it('lists the 27 EU member states', () => {
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(EU_MEMBER_STATES).toContain('DEU');
    expect(EU_MEMBER_STATES).not.toContain('GBR');
  });

  it('gives every ICAO passport an MRZ on its one data page and no PDF417', () => {
    for (const issuer of [icao('GBR', 'GB'), icao('DEU', 'DE'), icao('XXA'), null]) {
      expect(documentFeatures(issuer, 'passport', 'production')).toMatchObject({
        mrz: true,
        pdf417: false,
        expiry: true,
        sides: 1,
        mrzSide: 'front',
        pdf417Side: null,
        layouts: ['TD3'],
      });
    }
  });

  it('gives every visa an MRZ and no PDF417', () => {
    expect(documentFeatures(icao('FRA', 'FR'), 'visa', 'production')).toMatchObject({
      mrz: true,
      pdf417: false,
      expiry: true,
      sides: 1,
      layouts: ['MRVA', 'MRVB'],
    });
  });

  it('gives AAMVA driver licences and ID cards a PDF417 on the back and no MRZ', () => {
    for (const idClass of ['drivers_license', 'national_id'] as const) {
      expect(documentFeatures(aamva('636014', 'CA'), idClass, 'production')).toMatchObject({
        mrz: false,
        pdf417: true,
        expiry: true,
        sides: 2,
        mrzSide: null,
        pdf417Side: 'back',
      });
    }
    expect(documentFeatures(aamva('636014', 'CA'), 'passport', 'production')).toBeNull();
    expect(documentFeatures(aamva('999999', 'ZZ'), 'drivers_license', 'production')).toBeNull();
  });

  it('gives EU national ID cards and residence permits a TD1 MRZ on the back', () => {
    for (const idClass of ['national_id', 'residence_permit'] as const) {
      expect(documentFeatures(icao('DEU', 'DE'), idClass, 'production')).toMatchObject({
        mrz: true,
        pdf417: false,
        expiry: true,
        sides: 2,
        mrzSide: 'back',
        layouts: ['TD1'],
      });
    }
  });

  it('has no row for an unlisted issuer and class, or without a class', () => {
    expect(documentFeatures(icao('USA', 'US'), 'national_id', 'production')).toBeNull();
    expect(documentFeatures(icao('GBR', 'GB'), 'drivers_license', 'production')).toBeNull();
    expect(documentFeatures(null, 'national_id', 'production')).toBeNull();
    expect(documentFeatures(icao('DEU', 'DE'), null, 'production')).toBeNull();
  });

  it('treats Utopia as the sandbox test issuer: TD1, TD3 and MRV-A rows in a sandbox only', () => {
    expect(SANDBOX_TEST_ISSUER).toBe('UTO');
    const uto = icao('UTO');
    expect(documentFeatures(uto, 'national_id', 'sandbox')).toMatchObject({
      mrz: true,
      pdf417: false,
      expiry: true,
      sides: 2,
      mrzSide: 'back',
      layouts: ['TD1'],
    });
    expect(documentFeatures(uto, 'passport', 'sandbox')).toMatchObject({
      mrz: true,
      pdf417: false,
      layouts: ['TD3'],
    });
    expect(documentFeatures(uto, 'visa', 'sandbox')).toMatchObject({ mrz: true, layouts: ['MRVA'] });
    expect(documentFeatures(uto, 'drivers_license', 'sandbox')).toBeNull();
    for (const idClass of ['national_id', 'passport', 'visa'] as const) {
      expect(documentFeatures(uto, idClass, 'production'), idClass).toBeNull();
    }
  });

  it('names the row and its source', () => {
    const row = documentFeatures(icao('DEU', 'DE'), 'national_id', 'production');
    expect(row?.row).toBe('eu-national-id');
    expect(row?.source).toMatch(/2019\/1157/);
  });
});
