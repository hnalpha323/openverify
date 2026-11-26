/**
 * Ours (docs-catalog, C280.1): for each source-API identifier the surface index lists and the
 * automatic rules of `mapping.ts` do not map, its OpenVerify counterpart in another shape, or
 * "not available" with one of C280.1's four reason codes and a short reason. Factual only: a row
 * says where behaviour corresponds or why it does not, never that results are equivalent (C280.7).
 * A test fails on an entry the automatic rules now map (stale) and on one the index no longer
 * lists, so neither side changes without this table.
 */

export const REASON_CODES = [
  'next-release',
  'not-planned',
  'licensed-data',
  'vendor-retiring',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** A counterpart in another shape, or "not available" with its reason. */
export type MappingOverride =
  | { readonly counterpart: string; readonly note: string }
  | { readonly reason: ReasonCode; readonly note: string };

export const MAPPING_SECTIONS = [
  'checks',
  'verification-types',
  'report-types',
  'list-item-types',
  'webhook-events',
  'paths',
] as const;
export type MappingSection = (typeof MAPPING_SECTIONS)[number];

const no = (reason: ReasonCode, note: string): MappingOverride => Object.freeze({ reason, note });
const as = (counterpart: string, note: string): MappingOverride =>
  Object.freeze({ counterpart, note });

const LICENSED =
  'needs a licensed data source or a contract with its operator; no adapter is built';
const DIGITAL_ID = no(
  'licensed-data',
  'a national or bank digital-ID scheme needs a relying-party agreement with its operator; none is built',
);
const PROVIDER_REPORT = no('licensed-data', `a third-party data report: ${LICENSED}`);
const BUSINESS_REPORT = no(
  'licensed-data',
  `a business data report: ${LICENSED} (the registry checks of \`database_business\` read open registers, C57)`,
);

/** Prefix rules, tried after the exact entries (the longest prefix first). */
export const MAPPING_PREFIXES: Readonly<
  Record<MappingSection, Readonly<Record<string, MappingOverride>>>
> = Object.freeze({
  checks: {},
  'verification-types': { 'digital-id-': DIGITAL_ID },
  'report-types': {},
  'list-item-types': {},
  'webhook-events': {
    'batch-job.': no(
      'not-planned',
      'no batch-job resource; bulk report creation is a report-bulk job without events (docs/reports/bulk.md)',
    ),
    'document.': no(
      'not-planned',
      'no separate document resource: a document verification emits `verification.*` events',
    ),
    'importer-pipeline-run.': no(
      'not-planned',
      'importers load list items in one job and emit no pipeline-run events (docs/lists/importers.md)',
    ),
  },
  paths: {
    'batch-jobs': no(
      'not-planned',
      'no batch-job resource; bulk report creation is `POST /api/v1/reports/bulk` (docs/reports/bulk.md)',
    ),
    relays: no('not-planned', 'no relay resource'),
  },
});

/** Exact entries, by section and identifier. */
export const MAPPING_OVERRIDES: Readonly<
  Record<MappingSection, Readonly<Record<string, MappingOverride>>>
> = Object.freeze({
  checks: {
    database_address_deliverable_detection: no(
      'licensed-data',
      `postal deliverability needs a licensed postal source; the \`address-lookup\` report reads it only from a bound provider`,
    ),
    database_address_residential_detection: no(
      'licensed-data',
      'a residential indicator needs a licensed postal source; no adapter is built',
    ),
    database_attribute_comparison: no(
      'not-planned',
      'the database checks compare name, birth date and address by match group (C58); no free-form attribute comparison is built',
    ),
    database_business_ai_identity_comparison: no(
      'vendor-retiring',
      'marked sunset by the source; `database_business_identity_comparison` compares a business by match group',
    ),
  },
  'verification-types': {
    'bank-pennydrop': no(
      'licensed-data',
      'a bank account micro-deposit check needs bank rails; none is built',
    ),
    'brand-asset': no('not-planned', 'no brand-asset verification is built'),
    'certificate-korea': no(
      'licensed-data',
      'a national certificate scheme needs an agreement with its operator',
    ),
    'credit-card': no('licensed-data', 'a card check needs a payment processor'),
    'database-aadhaar': no('licensed-data', LICENSED),
    'database-business-footprint': no('licensed-data', LICENSED),
    'database-ecbsv': no('licensed-data', LICENSED),
    'database-ecbsvs': no('licensed-data', LICENSED),
    'database-phone-carrier': no(
      'licensed-data',
      `${LICENSED}; the \`phone-number\` report reads a carrier from a bound provider`,
    ),
    'database-phone-carriers': no('licensed-data', LICENSED),
    'database-serpro': no('licensed-data', LICENSED),
    'database-serpros': no('licensed-data', LICENSED),
    'database-standard': no(
      'licensed-data',
      `a provider-specific database product: ${LICENSED}; the \`database\` type is the adapter port`,
    ),
    'database-standards': no('licensed-data', LICENSED),
    'database-tin': no('licensed-data', LICENSED),
    'database-tins': no('licensed-data', LICENSED),
    'database-uk-dvla': no('licensed-data', LICENSED),
    'database-vat-number': no('licensed-data', LICENSED),
    'jp-my-number-nfc-scan': no(
      'not-planned',
      'the chip reader reads ICAO 9303 documents (government_id_nfc); a national card scheme outside it is not built',
    ),
    mdoc: no(
      'next-release',
      'mobile documents and wallet credentials wait for the wallet work (Phase 5 C68, Phase 11 C286)',
    ),
    'persona-fff-inquiry': no('not-planned', 'a source-internal type with no published behaviour'),
    'phone-number-silent-network-authentication': no(
      'licensed-data',
      'needs a mobile carrier agreement',
    ),
    'qes-infocert': no(
      'licensed-data',
      'a qualified-signature provider needs a contract with its operator',
    ),
    'verifiable-credential': no(
      'next-release',
      'wallet credentials wait for the wallet work (C286)',
    ),
    'document/generic': as(
      '`document` (verification type)',
      'a generic document is a `document` verification of an accepted class (C60)',
    ),
    'document/government-id-nfc': as(
      '`government_id_nfc` (verification type)',
      'the chip read is its own verification type (C62)',
    ),
    'document/mdoc': no('next-release', 'mobile documents wait for the wallet work (C286)'),
  },
  'report-types': {
    'background-check': no('licensed-data', `a background report: ${LICENSED}`),
    'better-business-bureau': BUSINESS_REPORT,
    'business-associated-persons': BUSINESS_REPORT,
    'business-classification': BUSINESS_REPORT,
    'business-enforcement-action': BUSINESS_REPORT,
    'business-industry-classification': BUSINESS_REPORT,
    'business-legal-history': BUSINESS_REPORT,
    'business-liens-lookup': BUSINESS_REPORT,
    'business-lookup': BUSINESS_REPORT,
    'business-lookup-eu': BUSINESS_REPORT,
    'business-media-coverage': no(
      'licensed-data',
      'a business media report needs a licensed source; `business-adverse-media` reads titles from a bound `adverseMedia` provider',
    ),
    'business-nonprofit': BUSINESS_REPORT,
    'business-online-presence': BUSINESS_REPORT,
    'business-personnel-insights': BUSINESS_REPORT,
    'business-registrations-lookup': BUSINESS_REPORT,
    'business-search': BUSINESS_REPORT,
    'business-social-media': BUSINESS_REPORT,
    'business-website': as(
      '`business_website` (verification type)',
      'website checks run as a verification type (C57), not as a report',
    ),
    'chainalysis-address-screening': PROVIDER_REPORT,
    'clearbit-business-lookup': PROVIDER_REPORT,
    'coinbase-check-crypto-risk': PROVIDER_REPORT,
    'community-safety': PROVIDER_REPORT,
    'comply-advantage-search': PROVIDER_REPORT,
    'comprehensive-profile': PROVIDER_REPORT,
    'employer-lookup': PROVIDER_REPORT,
    'equifax-oneview': PROVIDER_REPORT,
    'finra-broker-check': PROVIDER_REPORT,
    integration: no(
      'not-planned',
      "a container for the source's third-party report integrations; OpenVerify binds providers through its own adapter ports",
    ),
    'kyckr-business-lookup': PROVIDER_REPORT,
    middesk: PROVIDER_REPORT,
    'mx-account': PROVIDER_REPORT,
    nces: PROVIDER_REPORT,
    'novacredit-cash-atlas': PROVIDER_REPORT,
    'novacredit-credit-passport': PROVIDER_REPORT,
    profile: PROVIDER_REPORT,
    'profile-non-authoritative': PROVIDER_REPORT,
    screening: no(
      'not-planned',
      'a generic screening report; the `watchlist`, `business-watchlist`, `politically-exposed-person` and `custom-list` reports screen by list kind',
    ),
    'sec-action-lookup': PROVIDER_REPORT,
    'sentilink-application-risk': PROVIDER_REPORT,
    'sentilink-scores': PROVIDER_REPORT,
    'social-media': PROVIDER_REPORT,
    synthetic: PROVIDER_REPORT,
    'trm-wallet-screening': PROVIDER_REPORT,
  },
  'list-item-types': {},
  'webhook-events': {
    'inquiry.reusable-persona-created': no(
      'vendor-retiring',
      'reusable personas are not built: the source is retiring them (C286, R28)',
    ),
    'inquiry.reusable-persona-used': no(
      'vendor-retiring',
      'reusable personas are not built: the source is retiring them (C286, R28)',
    ),
    'report/address-lookup.submitted': no(
      'not-planned',
      'a report emits `.ready`, `.errored` and `.redacted` (C70.4); no `.submitted` event',
    ),
    'transaction.sentinel-session-processed': no(
      'not-planned',
      'no sentinel-session processing for transactions',
    ),
    'verification.escalated': no('not-planned', "not a state of OpenVerify's verification machine"),
    'verification.requires-retry': no(
      'not-planned',
      'a retry is a hint on a failed check (`retry-hint`), not an event',
    ),
    'verification.tentatively-failed': no(
      'not-planned',
      "not a state of OpenVerify's verification machine",
    ),
    'verification.tentatively-passed': no(
      'not-planned',
      "not a state of OpenVerify's verification machine",
    ),
    'verification.updated-tags': no('not-planned', 'verifications carry no tags'),
  },
  paths: {
    'accounts/search': as(
      '`GET /api/v1/accounts` with filters',
      'search is a list with `filter[...]` parameters',
    ),
    'inquiries/search': as(
      '`GET /api/v1/inquiries` with filters',
      'search is a list with `filter[...]` parameters',
    ),
    'webhook-events/search': as(
      '`GET /api/v1/events` with filters',
      'events are listed with `filter[...]` parameters',
    ),
    'document/generics/{document-id}': no(
      'not-planned',
      'no separate document resource; a document verification is read at `GET /api/v1/verifications/{id}`',
    ),
    'document/government-ids/{document-id}': no(
      'not-planned',
      'no separate document resource; a verification is read at `GET /api/v1/verifications/{id}`',
    ),
    'documents/{document-id}': no(
      'not-planned',
      'no separate document resource; a verification is read at `GET /api/v1/verifications/{id}`',
    ),
    'importer/accounts': no(
      'not-planned',
      'importers load list items only (docs/lists/importers.md)',
    ),
    'importer/list-item/faces': no(
      'not-planned',
      "face items are added from an inquiry's selfie only, never imported (C99.7)",
    ),
    'importer/list-item/field': as(
      '`/api/v1/importer/list-item/fields`',
      'the kind is written in the plural here',
    ),
    'inquiries/{inquiry-id}/print': no(
      'next-release',
      "the public print routes are the next release's (C286)",
    ),
    'reports/{report-id}/print': no(
      'next-release',
      "the public print routes are the next release's (C286)",
    ),
    'verifications/{verification-id}/print': no(
      'next-release',
      "the public print routes are the next release's (C286)",
    ),
    'oauth/authorize': no(
      'not-planned',
      'OAuth object grants are not built (C286, R30); API keys authenticate',
    ),
    'oauth/token': no(
      'not-planned',
      'OAuth object grants are not built (C286, R30); API keys authenticate',
    ),
    'privacy-passes': no(
      'not-planned',
      'claim-only results with Privacy Pass are not built (C286, R31)',
    ),
    'verifications/{verification-id}/investigation-lock': no(
      'not-planned',
      'no investigation lock; a case holds its objects (docs/cases/)',
    ),
    'verifications/{verification-id}/investigation-unlock': no(
      'not-planned',
      'no investigation lock; a case holds its objects (docs/cases/)',
    ),
    'verification/selfies/{verification-id}': as(
      '`GET /api/v1/selfies/{id}` and `GET /api/v1/verifications/{id}`',
      'a selfie verification has its own read route beside the generic one',
    ),
  },
});
