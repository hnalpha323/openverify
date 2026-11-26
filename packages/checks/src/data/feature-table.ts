/**
 * The document feature table (C33): which (issuer, class) pairs carry an MRZ, a PDF417 barcode
 * and an expiry date, on how many sides, and where. A feature check answers `feature_absent` only
 * for an established class with a row here (C30.2); an issuer and class without a row answer
 * `input_missing`.
 *
 * Rows, each with its source:
 * - every ICAO passport (TD3) and visa (MRV-A, MRV-B): an MRZ on the data page, no PDF417, an
 *   expiry date, one side;
 * - the driver licences and ID cards of AAMVA jurisdictions: a PDF417 on the back, no MRZ;
 * - EU national ID cards and residence permits: a TD1 MRZ on the back, no PDF417;
 * - the sandbox test issuer Utopia (`UTO`, C30.7): TD1, TD3 and MRV-A rows, in a sandbox only.
 *
 * Written by OpenVerify; no standard's text is copied.
 */
import type { IdClass } from '@openverify/core';
import { isIcaoIssuerCode } from '../country-codes.js';
import { aamvaIssuerOf } from './aamva-iins.js';

export type DocumentLayout = 'TD1' | 'TD2' | 'TD3' | 'MRVA' | 'MRVB' | 'ID1';
export type EnvironmentKind = 'sandbox' | 'production';
export type DocumentSide = 'front' | 'back';

export interface DocumentFeatures {
  mrz: boolean;
  pdf417: boolean;
  expiry: boolean;
  /** 1 for a passport data page or a visa, 2 for a card. */
  sides: 1 | 2;
  mrzSide: DocumentSide | null;
  pdf417Side: DocumentSide | null;
  layouts: readonly DocumentLayout[];
  /** The row's id. */
  row: string;
  /** Where the row's facts come from. */
  source: string;
}

/** The issuer established from the document: an ICAO code (MRZ) or an AAMVA IIN (barcode). */
export interface DocumentIssuer {
  scheme: 'icao' | 'aamva';
  /** ICAO three-letter code (`D` normalized to `DEU`), or the six-digit IIN. */
  code: string;
  /** ISO alpha-2 country, or `null` for an issuer without one (Utopia, organisations). */
  country: string | null;
  /** The AAMVA jurisdiction's two-letter code; `null` for an ICAO issuer. */
  jurisdiction: string | null;
}

/** The specimen state of ICAO Doc 9303, OpenVerify's documented sandbox test issuer (C30.7). */
export const SANDBOX_TEST_ISSUER = 'UTO';

/** The 27 member states of the European Union, as ICAO three-letter codes. */
export const EU_MEMBER_STATES: readonly string[] = Object.freeze([
  'AUT',
  'BEL',
  'BGR',
  'HRV',
  'CYP',
  'CZE',
  'DNK',
  'EST',
  'FIN',
  'FRA',
  'DEU',
  'GRC',
  'HUN',
  'IRL',
  'ITA',
  'LVA',
  'LTU',
  'LUX',
  'MLT',
  'NLD',
  'POL',
  'PRT',
  'ROU',
  'SVK',
  'SVN',
  'ESP',
  'SWE',
]);

const features = (value: DocumentFeatures): DocumentFeatures =>
  Object.freeze({ ...value, layouts: Object.freeze([...value.layouts]) });

const ICAO_PASSPORT = features({
  mrz: true,
  pdf417: false,
  expiry: true,
  sides: 1,
  mrzSide: 'front',
  pdf417Side: null,
  layouts: ['TD3'],
  row: 'icao-passport',
  source: 'ICAO Doc 9303 Part 4 (TD3 machine readable passports)',
});

const ICAO_VISA = features({
  mrz: true,
  pdf417: false,
  expiry: true,
  sides: 1,
  mrzSide: 'front',
  pdf417Side: null,
  layouts: ['MRVA', 'MRVB'],
  row: 'icao-visa',
  source: 'ICAO Doc 9303 Part 7 (machine readable visas)',
});

const AAMVA_CARD = features({
  mrz: false,
  pdf417: true,
  expiry: true,
  sides: 2,
  mrzSide: null,
  pdf417Side: 'back',
  layouts: ['ID1'],
  row: 'aamva-card',
  source: 'AAMVA DL/ID Card Design Standard (2020), Annex D: the mandatory PDF417 bar code',
});

const EU_NATIONAL_ID = features({
  mrz: true,
  pdf417: false,
  expiry: true,
  sides: 2,
  mrzSide: 'back',
  pdf417Side: null,
  layouts: ['TD1'],
  row: 'eu-national-id',
  source:
    'Regulation (EU) 2019/1157, Art. 3 and 5: ID-1 cards with an ICAO 9303 MRZ; cards without a functional MRZ ceased to be valid by 3 August 2026',
});

const EU_RESIDENCE_PERMIT = features({
  ...EU_NATIONAL_ID,
  row: 'eu-residence-permit',
  source:
    'Council Regulation (EC) No 1030/2002 as amended by Regulation (EU) 2017/1954: the uniform residence permit, an ID-1 card with an ICAO 9303 MRZ',
});

const SANDBOX_TD1 = features({
  ...EU_NATIONAL_ID,
  row: 'sandbox-utopia-td1',
  source: 'OpenVerify sandbox test issuer Utopia (C30.7): the ICAO 9303 Part 5 TD1 card',
});
const SANDBOX_TD3 = features({
  ...ICAO_PASSPORT,
  row: 'sandbox-utopia-td3',
  source: 'OpenVerify sandbox test issuer Utopia (C30.7): the ICAO 9303 Part 4 TD3 passport',
});
const SANDBOX_MRVA = features({
  ...ICAO_VISA,
  layouts: ['MRVA'],
  row: 'sandbox-utopia-mrva',
  source: 'OpenVerify sandbox test issuer Utopia (C30.7): the ICAO 9303 Part 7 MRV-A visa',
});

const SANDBOX_ROWS: Partial<Record<IdClass, DocumentFeatures>> = {
  national_id: SANDBOX_TD1,
  passport: SANDBOX_TD3,
  visa: SANDBOX_MRVA,
};

/**
 * The features of an established document class from an issuer, or `null` when the table has no
 * row for the pair. A passport or visa whose issuer could not be read still has its row: every
 * ICAO passport and visa carries an MRZ.
 */
export function documentFeatures(
  issuer: DocumentIssuer | null,
  idClass: IdClass | null,
  environment: EnvironmentKind,
): DocumentFeatures | null {
  if (idClass === null) {
    return null;
  }
  if (issuer?.scheme === 'aamva') {
    const known = aamvaIssuerOf(issuer.code) !== null;
    return known && (idClass === 'drivers_license' || idClass === 'national_id')
      ? AAMVA_CARD
      : null;
  }
  if (issuer?.code === SANDBOX_TEST_ISSUER) {
    return environment === 'sandbox' ? (SANDBOX_ROWS[idClass] ?? null) : null;
  }
  if (issuer !== null && !isIcaoIssuerCode(issuer.code)) {
    return null;
  }
  if (idClass === 'passport') {
    return ICAO_PASSPORT;
  }
  if (idClass === 'visa') {
    return ICAO_VISA;
  }
  if (issuer !== null && EU_MEMBER_STATES.includes(issuer.code)) {
    if (idClass === 'national_id') {
      return EU_NATIONAL_ID;
    }
    if (idClass === 'residence_permit') {
      return EU_RESIDENCE_PERMIT;
    }
  }
  return null;
}
