/**
 * C82.3: the `address-lookup` report's R and H fields, as a pure function over the query. What a
 * licensed postal provider says (deliverability, the DPV, RDI, CMRA and vacancy analysis, the
 * carrier route and county) is the `addressVerification` adapter's, never computed here.
 *
 * - **R.** `resolved-*`: the components as entered, normalised (Unicode NFC, whitespace collapsed,
 *   the postal code in its country's form, the subdivision as its code when the C58 subdivision
 *   table knows it), labelled `normalised` in provenance, never postal-corrected;
 *   `postal-code-valid` against the country's libaddressinput pattern (C58.4); for the US,
 *   `zip-state-consistent` against libaddressinput's state ZIP prefixes; the PO box, military
 *   (APO/FPO/DPO, PSC, CMR) and private mailbox (PMB) designators of `id_po_box_detection`'s
 *   patterns (C59.3).
 * - **H (ours).** `cmra-hint`: a private mailbox designator, which a USPS commercial mail
 *   receiving agency's customers write before their box; never in a USPS-derived field such as
 *   `analysis-dpv-cmra` (H08). Its absence says nothing.
 * - **What the adapter may receive (P16).** Only US addresses, as their normalised components, and
 *   the addressee only when the template sets `send-addressee`; any other country's provider
 *   fields are `null` with `unsupported_country` and nothing is sent.
 */
import { z } from 'zod';
import { normalizeAddress, PO_BOX_PATTERNS } from '../../id-po-box-detection.js';
import { readMatchingData } from '../../matching/data-files.js';
import { capText } from '../../matching/limits.js';
import { isValidPostalCode } from '../../matching/postal-codes.js';
import { foldText } from '../../matching/text.js';
import { riskConstant, type RiskUnavailableReason, type UnavailableField } from '../constants.js';
import { usZipMatchesState, usZipStateCodes } from './us-zip.js';

/** The query, as `addressLookupQuerySchema` names it. */
export interface AddressLookupQuery {
  readonly addressee?: string | undefined;
  readonly 'address-street-1': string;
  readonly 'address-street-2'?: string | undefined;
  readonly 'address-city': string;
  readonly 'address-subdivision': string;
  readonly 'address-postal-code': string;
  readonly 'address-country-code': string;
}

/** `address-designators`. */
export const ADDRESS_DESIGNATORS = ['po_box', 'military', 'pmb', 'general_delivery'] as const;
export type AddressDesignator = (typeof ADDRESS_DESIGNATORS)[number];

/** The provider fields of the type (C82.3's A fields), `null` without an adapter's answer. */
export const ADDRESS_VERIFICATION_FIELDS = Object.freeze([
  'deliverability',
  'metadata-record-type',
  'metadata-zip-type',
  'metadata-county-fips',
  'metadata-county-name',
  'metadata-carrier-route',
  'metadata-latitude',
  'metadata-longitude',
  'metadata-precision',
  'metadata-residential-delivery-indicator',
  'analysis-dpv-match-code',
  'analysis-dpv-cmra',
  'analysis-dpv-vacant',
  'analysis-active',
  'analysis-lacs-link-code',
  'analysis-lacs-link-indicator',
  'analysis-suite-link-match',
  'analysis-dpv-footnotes',
  'analysis-footnotes',
] as const);

/** The R and H fields, as `addressLookupReportResourceSchema` names them. */
export interface AddressLookupReportFields {
  readonly 'resolved-street-1': string | null;
  readonly 'resolved-street-2': string | null;
  readonly 'resolved-city': string | null;
  readonly 'resolved-subdivision': string | null;
  readonly 'resolved-postal-code': string | null;
  readonly 'resolved-country-code': string | null;
  readonly 'postal-code-valid': boolean | null;
  readonly 'zip-state-consistent': boolean | null;
  readonly 'address-designators': readonly AddressDesignator[];
  readonly 'cmra-hint': boolean | null;
}

/** Non-personal provenance for the sealed result. */
export interface AddressLookupReportDetails {
  /** C82.3: `resolved-*` are normalised, never postal-corrected. */
  readonly resolution: 'normalised';
  /** The subdivision was read as this code from its name (C58's subdivision table). */
  readonly 'subdivision-resolved': boolean;
  /** Every `id_po_box_detection` pattern that matched, `general_delivery` included. */
  readonly 'designator-patterns': readonly string[];
  /** The hint's confidence when it is `true` (H, ours); `null` when no designator stands. */
  readonly 'cmra-hint-confidence': number | null;
}

export interface AddressLookupReportResult {
  readonly fields: AddressLookupReportFields;
  readonly unavailableFields: readonly UnavailableField[];
  readonly details: AddressLookupReportDetails;
}

/** What the `addressVerification` adapter may receive (P16), or why it may receive nothing. */
export type AddressVerificationRequest =
  | {
      readonly eligible: true;
      readonly request: {
        readonly addressee?: string | undefined;
        readonly street1: string;
        readonly street2?: string | undefined;
        readonly city: string;
        readonly subdivision: string;
        readonly postalCode: string;
        readonly countryCode: 'US';
      };
    }
  | { readonly eligible: false; readonly reason: 'unsupported_country' };

/** Evaluates the `address-lookup` report's R and H fields. */
export function evaluateAddressLookupReport(query: AddressLookupQuery): AddressLookupReportResult {
  const missing: UnavailableField[] = [];
  const unknown = (field: string, reason: RiskUnavailableReason) => missing.push({ field, reason });
  const address = normalisedAddress(query);
  const valid = isValidPostalCode(address.postalCode, address.countryCode);
  if (valid === null) {
    unknown('postal-code-valid', 'undetermined');
  }
  let consistent: boolean | null = null;
  if (address.countryCode !== 'US') {
    unknown('zip-state-consistent', 'unsupported_country');
  } else {
    consistent = valid === true ? usZipMatchesState(address.postalCode, address.subdivision) : null;
    if (consistent === null) {
      unknown('zip-state-consistent', 'undetermined');
    }
  }
  const patterns = designatorPatterns([
    address.street1,
    address.street2 ?? '',
    address.city,
    address.subdivision,
  ]);
  const designators = ADDRESS_DESIGNATORS.filter((designator) =>
    patterns.some((pattern) => designatorOf(pattern, patterns) === designator),
  );
  const cmraHint = designators.includes('pmb');
  return {
    fields: {
      'resolved-street-1': address.street1,
      'resolved-street-2': address.street2,
      'resolved-city': address.city,
      'resolved-subdivision': address.subdivision,
      'resolved-postal-code': address.postalCode,
      'resolved-country-code': address.countryCode,
      'postal-code-valid': valid,
      'zip-state-consistent': consistent,
      'address-designators': designators,
      'cmra-hint': cmraHint,
    },
    unavailableFields: missing,
    details: {
      resolution: 'normalised',
      'subdivision-resolved': address.subdivisionResolved,
      'designator-patterns': patterns,
      'cmra-hint-confidence': cmraHint ? riskConstant('address-cmra-hint-confidence') : null,
    },
  };
}

/**
 * What the adapter may receive: US addresses only, as normalised components, the addressee only
 * with `send-addressee`.
 */
export function addressVerificationRequestOf(
  query: AddressLookupQuery,
  options: { sendAddressee: boolean },
): AddressVerificationRequest {
  const address = normalisedAddress(query);
  if (address.countryCode !== 'US') {
    return { eligible: false, reason: 'unsupported_country' };
  }
  const addressee =
    options.sendAddressee && query.addressee !== undefined
      ? normalisedText(query.addressee, ADDRESSEE_MAX_LENGTH)
      : null;
  return {
    eligible: true,
    request: {
      ...(addressee === null ? {} : { addressee }),
      street1: address.street1,
      ...(address.street2 === null ? {} : { street2: address.street2 }),
      city: address.city,
      subdivision: address.subdivision,
      postalCode: address.postalCode,
      countryCode: 'US',
    },
  };
}

/** The contracts' caps on each resolved component (`REPORT_QUERY_LIMITS`). */
const STREET_MAX_LENGTH = 200;
const CITY_MAX_LENGTH = 100;
const SUBDIVISION_MAX_LENGTH = 100;
const POSTAL_CODE_MAX_LENGTH = 20;
const ADDRESSEE_MAX_LENGTH = 200;

interface NormalisedAddress {
  readonly street1: string;
  readonly street2: string | null;
  readonly city: string;
  readonly subdivision: string;
  readonly subdivisionResolved: boolean;
  readonly postalCode: string;
  readonly countryCode: string;
}

/** Unicode NFC, every run of whitespace one space, trimmed, capped in code points. */
function normalisedText(value: string, max: number): string {
  return capText(
    value
      .normalize('NFC')
      .split(/\s+/u)
      .filter((part) => part !== '')
      .join(' '),
    max,
  );
}

function normalisedAddress(query: AddressLookupQuery): NormalisedAddress {
  const countryCode = query['address-country-code'].trim().toUpperCase();
  const street2 =
    query['address-street-2'] === undefined
      ? ''
      : normalisedText(query['address-street-2'], STREET_MAX_LENGTH);
  const subdivision = subdivisionOf(
    normalisedText(query['address-subdivision'], SUBDIVISION_MAX_LENGTH),
    countryCode,
  );
  return {
    street1: normalisedText(query['address-street-1'], STREET_MAX_LENGTH),
    street2: street2 === '' ? null : street2,
    city: normalisedText(query['address-city'], CITY_MAX_LENGTH),
    subdivision: subdivision.text,
    subdivisionResolved: subdivision.resolved,
    postalCode: postalCodeOf(query['address-postal-code'], countryCode),
    countryCode,
  };
}

/** A US ZIP as five digits or ZIP+4 with its hyphen; elsewhere upper case, spaces collapsed. */
function postalCodeOf(value: string, countryCode: string): string {
  const text = normalisedText(value, POSTAL_CODE_MAX_LENGTH).toUpperCase();
  if (countryCode === 'US') {
    const digits = text.replace(/[\s-]/gu, '');
    if (/^\d{5}$/u.test(digits)) {
      return digits;
    }
    if (/^\d{9}$/u.test(digits)) {
      return `${digits.slice(0, 5)}-${digits.slice(5)}`;
    }
  }
  return text;
}

const subdivisionsSchema = z.object({
  countries: z.record(z.string(), z.array(z.array(z.string()).min(1))),
});
let subdivisions: Readonly<Record<string, readonly (readonly string[])[]>> | undefined;

/** The subdivision's code when C58's table (or, for the US, the ZIP table) knows it. */
function subdivisionOf(text: string, countryCode: string): { text: string; resolved: boolean } {
  subdivisions ??= subdivisionsSchema.parse(readMatchingData('subdivisions.json')).countries;
  const entries = subdivisions[countryCode] ?? [];
  const upper = text.toUpperCase();
  if (
    entries.some(([code]) => code === upper) ||
    (countryCode === 'US' && usZipStateCodes().includes(upper))
  ) {
    return { text: upper, resolved: false };
  }
  const { simplified, expanded } = foldText(text);
  const found = entries.find(
    ([, ...names]) => names.includes(simplified) || names.includes(expanded),
  );
  return found?.[0] === undefined ? { text, resolved: false } : { text: found[0], resolved: true };
}

/** The `id_po_box_detection` patterns an address's lines match (C59.3), in their order. */
function designatorPatterns(lines: readonly string[]): string[] {
  const address = normalizeAddress(lines);
  return [
    ...new Set(PO_BOX_PATTERNS.filter(([, pattern]) => pattern.test(address)).map(([id]) => id)),
  ];
}

/** The designator a pattern stands for; a box after a military unit is the unit's box. */
function designatorOf(pattern: string, patterns: readonly string[]): AddressDesignator | null {
  switch (pattern) {
    case 'military':
      return 'military';
    case 'private_mailbox':
      return 'pmb';
    case 'general_delivery':
      return 'general_delivery';
    case 'box_number':
      return patterns.includes('military') ? null : 'po_box';
    default:
      return 'po_box';
  }
}
