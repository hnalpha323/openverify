/**
 * A report's query in words (C72.1, C79-C82, C84.2, C86): the label of every query member of
 * every type, for the report page and the create form. Its test iterates `REPORT_QUERY_FIELDS`
 * first, so a member added to a type's query without a label fails it.
 */
import { REPORT_QUERY_FIELDS } from '@openverify/contracts';
import type { ReportType } from '@openverify/core';

/** The members every type that names them calls the same. */
const SHARED: Readonly<Record<string, string>> = Object.freeze({
  'name-first': 'First name',
  'name-middle': 'Middle name',
  'name-last': 'Last name',
  term: 'Full name',
  birthdate: 'Date of birth',
  gender: 'Gender',
  'address-country-code': 'Country of address',
  'country-code': 'Country',
  'identification-number': 'Identification number',
  'identification-type': 'Identification type',
  'identification-country-code': 'Identification country',
  'additional-names': 'Additional names',
  'registration-number': 'Registration number',
  lei: 'LEI',
  website: 'Website',
  'swift-bic': 'SWIFT/BIC',
  'imo-number': 'IMO number',
  mmsi: 'MMSI',
  'aircraft-serial': 'Aircraft serial number',
  'aircraft-tail': 'Aircraft tail number',
  'crypto-address': 'Crypto address',
  'chain-id': 'Chain (CAIP-2)',
  'email-address': 'Email address',
  'phone-number': 'Phone number (E.164)',
  // C106.1 (Phase 7).
  'ip-address': 'IP address',
  // C106.2 (Workflow 7B).
  'government-id-number': 'Government ID number',
  'government-id-class': 'Government ID class',
  string: 'Text value',
  'list-ids': 'Lists',
  addressee: 'Addressee',
  'address-street-1': 'Street address',
  'address-street-2': 'Street address, line 2',
  'address-city': 'City',
  'address-subdivision': 'State or region',
  'address-postal-code': 'Postal code',
});

/** A business type's `term` is the company's name (C79.2, C81.5). */
const BUSINESS_TYPES: ReadonlySet<ReportType> = new Set([
  'business-watchlist',
  'business-adverse-media',
]);

/** The label of `field` in a query of `type`, or `undefined` for one without words. */
export function queryFieldLabel(type: ReportType, field: string): string | undefined {
  if (!REPORT_QUERY_FIELDS[type].includes(field) || !Object.hasOwn(SHARED, field)) {
    return undefined;
  }
  return field === 'term' && BUSINESS_TYPES.has(type) ? 'Company name' : SHARED[field];
}
