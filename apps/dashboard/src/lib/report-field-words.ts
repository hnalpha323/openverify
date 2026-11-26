/**
 * The results of each report type in words (C79-C82, C86): the label of every field of the
 * email, phone and address reports, and the words of the values a result can hold (reputation
 * and risk reasons, media categories, PEP and list entry values). Each test iterates the
 * contract's list first; a value without words shows as its code.
 */
import type { EMAIL_REPUTATION_REASONS, PHONE_RISK_REASONS } from '@openverify/contracts';
import type { AdverseMediaCategory } from '@openverify/core';
import { CLIENT_ADDRESS_SOURCE_WORDS } from './network-words';
import { REPORT_ERROR_WORDS } from './report-words';

/** The report types whose result is a set of fields, without review (C82). */
export type FieldReportType = 'email-address' | 'phone-number' | 'address-lookup' | 'ip-address';
export type EmailReputationReason = (typeof EMAIL_REPUTATION_REASONS)[number];
export type PhoneRiskReason = (typeof PHONE_RISK_REASONS)[number];

/** C82.1: why the email band is what it is (`docs/reports/email-address.md`). */
export const EMAIL_REPUTATION_REASON_WORDS: Readonly<Record<EmailReputationReason, string>> =
  Object.freeze({
    syntax_invalid: 'The address is not valid syntax',
    domain_not_found: 'The domain does not exist',
    domain_rejects_mail: 'The domain refuses mail (a null MX)',
    no_mail_server: 'The domain has no mail server',
    disposable_domain: 'A disposable domain',
    domain_recently_registered: 'A custom domain registered recently',
    mx_of_disposable_service: 'Served by a disposable service’s mail servers',
    domain_typo_of_major_provider: 'One edit from a major provider’s domain',
    role_account: 'A role mailbox, not a person’s',
    young_domain: 'A young custom domain',
    recent_breach: 'A breach in the last 12 months',
    accepts_mail: 'None of the above, and the domain accepts mail',
    privacy_relay: 'A privacy relay hides the real address',
    execution_error: 'A check that could reach a worse band failed',
  });

/** C82.2: why the phone risk level is what it is (`docs/reports/phone-number.md`). */
export const PHONE_RISK_REASON_WORDS: Readonly<Record<PhoneRiskReason, string>> = Object.freeze({
  invalid_number: 'Not a valid number',
  high_risk_type: 'A line type refused for one-time codes (premium, toll-free, pager, voicemail)',
  voip: 'A VoIP line',
  prepaid: 'A prepaid line, as the provider reports it',
  payphone: 'A payphone, as the provider reports it',
  personal_number: 'A personal number',
  low_risk_type: 'A mobile or fixed line',
  line_type_undetermined: 'The numbering plan cannot tell a fixed line from a mobile',
  other_line_type: 'Another line type the provider names, which sets no level',
  sim_swap_24h: 'A SIM swap in the last 24 hours',
  sim_swap_7d: 'A SIM swap in the last 7 days',
  ported_30d: 'Ported in the last 30 days',
});

/** C81.3: the adverse-media categories (ours, `ADVERSE_MEDIA_CATEGORIES`). */
export const ADVERSE_MEDIA_CATEGORY_LABELS: Readonly<Record<AdverseMediaCategory, string>> =
  Object.freeze({
    financial_crime: 'Financial crime',
    fraud: 'Fraud',
    corruption: 'Corruption',
    money_laundering: 'Money laundering',
    terrorism: 'Terrorism',
    organised_crime: 'Organised crime',
    narcotics: 'Narcotics',
    violent_crime: 'Violent crime',
    cybercrime: 'Cybercrime',
    property_crime: 'Property crime',
    regulatory: 'Regulatory action',
    financial_difficulty: 'Financial difficulty',
  });

/** C82: every field of the three fields reports, as its row on the report page. */
const FIELD_LABELS: Readonly<Record<FieldReportType, Readonly<Record<string, string>>>> =
  Object.freeze({
    'email-address': {
      'email-domain': 'Domain',
      'email-domain-kind': 'Domain kind',
      'email-domain-exists': 'Domain exists',
      'email-is-valid-mx': 'Domain accepts mail',
      'email-is-disposable': 'Disposable domain',
      'email-domain-age-days': 'Domain age (days)',
      'email-is-free-provider': 'Free mail provider',
      'email-is-relay': 'Privacy relay',
      'email-is-role-account': 'Role mailbox',
      'email-mx-provider': 'Mail provider',
      'email-spf-policy': 'SPF policy',
      'email-dmarc-policy': 'DMARC policy',
      'email-is-deliverable': 'Deliverable',
      'email-domain-typo-suggestion': 'Typo of a major provider',
      'email-reputation': 'Reputation',
      'email-is-suspicious': 'Suspicious',
      'email-reputation-confidence': 'Reputation confidence',
      'email-reputation-reasons': 'Reputation reasons',
      'email-credentials-leaked-recent': 'Credentials leaked recently',
      'email-breach-count': 'Breaches',
      'email-is-spam': 'Spam',
      'email-malicious-activity-detected-recent': 'Malicious activity recently',
      'email-estimated-age-days': 'Estimated age (days)',
      'age-estimated-13-plus': 'Estimated 13 or older',
      'age-estimated-16-plus': 'Estimated 16 or older',
      'age-estimated-18-plus': 'Estimated 18 or older',
    },
    'phone-number': {
      'phone-country-code': 'Country',
      'phone-is-possible': 'Possible number',
      'phone-is-valid': 'Valid number',
      'phone-type': 'Line type',
      'phone-type-numbering-plan': 'Numbering plan type',
      'phone-network-line-type': 'Network line type',
      'phone-carrier': 'Carrier',
      'phone-risk-level': 'Risk level',
      'phone-risk-recommendation': 'Recommendation',
      'phone-risk-confidence': 'Risk confidence',
      'phone-risk-reasons': 'Risk reasons',
      'phone-risk-score': 'Risk score',
      'phone-risk-sim-swap': 'SIM swap',
      'phone-ported-recently': 'Ported recently',
      'phone-reachable-at-otp': 'Reachable at the one-time code',
    },
    'address-lookup': {
      'resolved-street-1': 'Street address',
      'resolved-street-2': 'Street address, line 2',
      'resolved-city': 'City',
      'resolved-subdivision': 'State or region',
      'resolved-postal-code': 'Postal code',
      'resolved-country-code': 'Country',
      'postal-code-valid': 'Postal code valid',
      'zip-state-consistent': 'ZIP code matches the state',
      'address-designators': 'Designators',
      'cmra-hint': 'Mail receiving agency hint',
      deliverability: 'Deliverability',
      'metadata-record-type': 'Record type',
      'metadata-zip-type': 'ZIP code type',
      'metadata-county-fips': 'County FIPS code',
      'metadata-county-name': 'County',
      'metadata-carrier-route': 'Carrier route',
      'metadata-latitude': 'Latitude',
      'metadata-longitude': 'Longitude',
      'metadata-precision': 'Precision',
      'metadata-residential-delivery-indicator': 'Residential or commercial',
      'analysis-dpv-match-code': 'DPV match code',
      'analysis-dpv-cmra': 'Mail receiving agency (DPV)',
      'analysis-dpv-vacant': 'Vacant (DPV)',
      'analysis-active': 'Active',
      'analysis-lacs-link-code': 'LACSLink code',
      'analysis-lacs-link-indicator': 'LACSLink indicator',
      'analysis-suite-link-match': 'SuiteLink match',
      'analysis-dpv-footnotes': 'DPV footnotes',
      'analysis-footnotes': 'Footnotes',
    },
    // C106.1 (Phase 7).
    'ip-address': {
      'tor-exit-node': 'Tor exit node',
      'datacenter-ip': 'Datacenter address (provider ranges)',
      'service-type': 'Service type',
      'vpn-detected': 'VPN network',
      'proxy-detected': 'Proxy',
      isp: 'Network provider',
      'mobile-ip': 'Mobile address',
      'country-code': 'Country',
      'country-name': 'Country name',
      city: 'City',
      region: 'Region',
      latitude: 'Latitude',
      longitude: 'Longitude',
      error: 'Error',
      flagged: 'Flagged',
      'hosting-asn': 'Hosting network',
      'client-address-source': 'How the address was resolved',
    },
  });

/** The label of a field of a fields report, or `undefined` for one without words. */
export function reportFieldLabel(type: FieldReportType, field: string): string | undefined {
  const labels = FIELD_LABELS[type];
  return Object.hasOwn(labels, field) ? labels[field] : undefined;
}

const LINE_TYPES: Readonly<Record<string, string>> = {
  FIXED_LINE: 'Fixed line',
  MOBILE: 'Mobile',
  FIXED_LINE_OR_MOBILE: 'Fixed line or mobile',
  PREPAID: 'Prepaid',
  TOLL_FREE: 'Toll-free',
  VOIP: 'VoIP',
  PAGER: 'Pager',
  PAYPHONE: 'Payphone',
  INVALID: 'Invalid',
  RESTRICTED_PREMIUM: 'Restricted or premium',
  PERSONAL: 'Personal',
  VOICEMAIL: 'Voicemail',
  OTHER: 'Other (from a carrier)',
  PREMIUM_RATE: 'Premium rate',
  SHARED_COST: 'Shared cost',
  PERSONAL_NUMBER: 'Personal number',
  UAN: 'Universal access number',
};

/** The coded values of a result, by the member that holds them. */
const VALUE_WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'email-domain-kind': {
    free_mail: 'Free mail',
    relay: 'Privacy relay',
    disposable: 'Disposable',
    custom: 'Custom domain',
  },
  'email-spf-policy': {
    pass: 'Pass all (+all)',
    neutral: 'Neutral (?all)',
    softfail: 'Soft fail (~all)',
    fail: 'Fail (-all)',
    no_all: 'No all mechanism',
    no_record: 'No SPF record',
    invalid: 'Invalid record',
  },
  'email-dmarc-policy': {
    none: 'None (monitor only)',
    quarantine: 'Quarantine',
    reject: 'Reject',
    no_record: 'No DMARC record',
    invalid: 'Invalid record',
  },
  'email-reputation': { high: 'High', medium: 'Medium', low: 'Low' },
  'phone-type': LINE_TYPES,
  'phone-type-numbering-plan': LINE_TYPES,
  'phone-risk-level': {
    low: 'Low',
    'medium-low': 'Medium-low',
    medium: 'Medium',
    'medium-high': 'Medium-high',
    high: 'High',
  },
  'phone-risk-recommendation': { allow: 'Allow', flag: 'Flag', block: 'Block' },
  'phone-risk-sim-swap': {
    'very-low': 'Very low (older than 30 days)',
    low: 'Low (within 30 days)',
    medium: 'Medium (within 7 days)',
    high: 'High (within 24 hours)',
    'N/A': 'Not checked',
  },
  deliverability: {
    confirmed: 'Confirmed',
    confirmed_missing_secondary: 'Confirmed, secondary number missing',
    confirmed_secondary_invalid: 'Confirmed, secondary number invalid',
    not_confirmed: 'Not confirmed',
    unknown: 'Unknown',
  },
  'address-designators': {
    po_box: 'PO box',
    military: 'Military (APO, FPO, DPO)',
    pmb: 'Private mailbox (PMB)',
    general_delivery: 'General delivery (held at a post office)',
  },
  'metadata-zip-type': {
    unique: 'Unique',
    military: 'Military',
    po_box: 'PO box',
    standard: 'Standard',
  },
  'metadata-residential-delivery-indicator': {
    residential: 'Residential',
    commercial: 'Commercial',
  },
  // C106.1 (ADR 0006): what the run read, never a verdict. A boolean goes by its text.
  'tor-exit-node': {
    MATCHED: 'Listed as a Tor exit',
    CLEARED: 'Checked against a fresh exit list: not found',
  },
  'service-type': { DATACENTER: 'Datacenter (a provider’s published ranges)' },
  'proxy-detected': { false: 'Checked: not found' },
  flagged: { false: 'Nothing found; an unavailable field is still unknown' },
  'client-address-source': CLIENT_ADDRESS_SOURCE_WORDS,
  error: Object.fromEntries(
    Object.entries(REPORT_ERROR_WORDS).map(([code, words]) => [code, words.title]),
  ),
  'in-office': { yes: 'Yes', no: 'No', unknown: 'Unknown' },
  relationship: { spouse: 'Spouse', child: 'Child', parent: 'Parent', sibling: 'Sibling' },
  'pep-type': {
    pep: 'Politically exposed person',
    relative: 'Relative of a politically exposed person',
  },
  sex: { female: 'Female', male: 'Male' },
  'alias-type': { primary_name: 'Primary name', aka: 'Alias', weak_aka: 'Weak alias' },
  'list-type': { sanction: 'Sanctions', pep: 'Politically exposed persons', warning: 'Warning' },
  kind: { entity: 'Entity', vessel: 'Vessel', aircraft: 'Aircraft' },
  identifier: {
    passport: 'Passport',
    national_id: 'National ID',
    tax_id: 'Tax ID',
    registration_number: 'Registration number',
    lei: 'LEI',
    swift_bic: 'SWIFT/BIC',
    imo: 'IMO',
    mmsi: 'MMSI',
    aircraft_serial: 'Aircraft serial',
    aircraft_tail: 'Aircraft tail',
    website: 'Website',
    email: 'Email',
    other: 'Identifier',
  },
  'crypto-address-format': {
    evm: 'EVM',
    bitcoin: 'Bitcoin',
    cashaddr: 'Bitcoin Cash CashAddr',
    base58: 'Base58',
    raw: 'Compared as its trimmed text',
    unclassified: 'Unclassified (compared as its trimmed text)',
  },
};

/** The words of a coded value of `field`, or `undefined` for one without words. */
export function fieldValueWords(field: string, value: string): string | undefined {
  if (!Object.hasOwn(VALUE_WORDS, field)) {
    return undefined;
  }
  const words = VALUE_WORDS[field] ?? {};
  return Object.hasOwn(words, value) ? words[value] : undefined;
}

/** Owner decision 9 after 6B: a list an entry is on beside its source's main list. */
export interface ListMembership {
  readonly list: string;
  readonly program: string | null;
}

/**
 * One of an entry's other lists in words. The publisher may tie no programme to a list (OFAC's
 * file names an entry's lists and programmes side by side), so `null` says just that.
 */
export function listMembershipText({ list, program }: ListMembership): string {
  return program === null
    ? `${list} (no programme tied to this list)`
    : `${list} (programme ${program})`;
}

/**
 * What "Other lists" means (owner decision 9): a sectoral or other non-blocking listing is never
 * read as an SDN-level block (`docs/reports/README.md`, `list_memberships`).
 */
export const LIST_MEMBERSHIPS_NOTE =
  'Other lists names each list of the publisher other than its main one (for OFAC, the lists other than the SDN List) that holds the entry, with the programme tied to it where the publisher ties one. A listing on those lists alone is not an SDN-level block: its measures are those of the list named.';

/**
 * Owner decision 9: on a PEP relative, the class of the PEP it relates to, as the PEP build
 * derived it on the relative's own record; a relative synced before that member was stored has
 * none until the next `pep:sync`.
 */
export function relativeClassText(relativeOfClass: number | undefined): string {
  return relativeOfClass === undefined
    ? 'Not recorded: the list was synced before relatives carried their class'
    : `Class ${String(relativeOfClass)}: the most senior class of the PEPs this relative relates to`;
}
