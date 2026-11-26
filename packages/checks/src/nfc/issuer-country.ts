/**
 * The ISO 3166-1 alpha-2 country of an ICAO issuer code, for `verifyPassiveAuthentication`'s
 * `issuerCountry` option (C62.2): the ISO alpha-3 codes and `D`, `RKS` through `alpha3ToAlpha2`
 * (C33), and the specimen state Utopia `UTO` as `UT`, the country of its synthetic certificates
 * (C62.8). Organisations and statuses (`UNO`, `XXA`, ...) have none.
 */
import { alpha3ToAlpha2 } from '../country-codes.js';
import { SANDBOX_TEST_ISSUER } from '../data/feature-table.js';

/** The synthetic Utopia certificates' country (`@openverify/emrtd/testing`). */
const UTOPIA_COUNTRY = 'UT';

export function nfcIssuerCountry(code: string): string | null {
  const cleaned = code.trim().toUpperCase();
  const end = cleaned.indexOf('<');
  const issuer = end === -1 ? cleaned : cleaned.slice(0, end);
  if (issuer === '') {
    return null;
  }
  return issuer === SANDBOX_TEST_ISSUER ? UTOPIA_COUNTRY : alpha3ToAlpha2(issuer);
}
