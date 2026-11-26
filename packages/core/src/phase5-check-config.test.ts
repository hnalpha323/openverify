import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AAMVA_COMPARISON_FIELDS,
  AAMVA_IGNORABLE_FIELDS,
  BUSINESS_CHECK_CONFIG_DEFAULTS,
  BUSINESS_MATCH_FIELDS,
  CONTACT_CHECK_CONFIG_DEFAULTS,
  CRYPTO_WALLET_CHECK_CONFIG_DEFAULTS,
  DATABASE_CHECK_CONFIG_DEFAULTS,
  DATABASE_MATCH_FIELDS,
  DOCUMENT_CHECK_CONFIG_DEFAULTS,
  DOCUMENT_PROPERTIES,
  FACE_MATCH_DEFAULTS,
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  MATCH_LEVELS,
  MATCH_REQUIREMENTS,
  MAX_EMAIL_DOMAIN_LIST,
  MAX_MATCH_GROUPS,
  NFC_CHECK_CONFIG_DEFAULTS,
  PHASE5_CHECK_CONFIG_DEFAULTS,
  aamvaIdentityComparisonConfigSchema,
  businessWebsiteBacklinkDetectionConfigSchema,
  businessWebsiteDomainAgeDetectionConfigSchema,
  cryptoWalletAddressComparisonConfigSchema,
  cryptoWalletValidityDetectionConfigSchema,
  databaseAddressComparisonConfigSchema,
  databaseBirthdateComparisonConfigSchema,
  databaseBusinessActiveBusinessDetectionConfigSchema,
  databaseBusinessAssociatedPersonsComparisonConfigSchema,
  databaseBusinessIdentityComparisonConfigSchema,
  databaseIdentityComparisonConfigSchema,
  databaseInquiryComparisonConfigSchema,
  databaseNameComparisonConfigSchema,
  documentAddressComparisonConfigSchema,
  documentExpiredDetectionConfigSchema,
  documentExtractedPropertiesDetectionConfigSchema,
  documentFabricationDetectionConfigSchema,
  documentNameComparisonConfigSchema,
  documentRecencyDetectionConfigSchema,
  documentTypeDetectionConfigSchema,
  emailAddressDisposableDetectionConfigSchema,
  idNfcChipAuthenticationDetectionConfigSchema,
  idNfcExpiredDetectionConfigSchema,
  idNfcPassiveAuthenticationDetectionConfigSchema,
  idNfcRepeatDetectionConfigSchema,
  idNfcSelfieComparisonConfigSchema,
  matchGroupsSchema,
  phase5ConfigDefaults,
  phase5ThresholdBasis,
} from './check-config.js';

/**
 * C51.3: every Phase 5 check key with a default, by check and in the plan's table. Each value is
 * provisional, none is fitted to our fixtures, and "ours" means no external basis.
 */
const EXPECTED_DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  document_type_detection: { 'min-confidence': 0.5 },
  document_extracted_properties_detection: {
    'required-properties': ['name', 'address', 'issue-date'],
  },
  document_expired_detection: { 'grace-days': 0 },
  document_recency_detection: { 'max-age-days': 90 },
  document_fabrication_detection: { 'max-fabrication-score': 0.5 },
  document_name_comparison: { 'min-match-level': 'partial' },
  document_address_comparison: { 'min-match-level': 'partial' },
  database_identity_comparison: {
    'match-groups': [{ name: 'partial', birthdate: 'partial', address: 'partial' }],
    'accept-precision-limited-birthdate': true,
    'accept-transposed-birthdate': false,
  },
  database_name_comparison: { 'min-match-level': 'partial' },
  database_address_comparison: { 'min-match-level': 'partial' },
  database_birthdate_comparison: { 'min-match-level': 'partial' },
  database_inquiry_comparison: { 'min-match-level': 'partial' },
  aamva_identity_comparison: {
    'ignored-fields': [],
    'on-jurisdiction-not-participating': 'review',
  },
  email_address_disposable_detection: { 'allow-domains': [], 'deny-domains': [] },
  crypto_wallet_validity_detection: { 'require-evm-checksum': false },
  crypto_wallet_address_comparison: {
    'bip137-mode': 'loose',
    'allow-high-s': true,
    'allow-contract-wallets': false,
  },
  database_business_identity_comparison: {
    'match-groups': [
      { name: 'partial', 'registration-number': 'full' },
      { name: 'partial', address: 'partial' },
    ],
  },
  database_business_active_business_detection: { 'fail-on-lapsed-lei': false },
  database_business_associated_persons_comparison: { 'min-match-level': 'partial' },
  business_website_domain_age_detection: { 'min-domain-age-days': 90 },
  business_website_backlink_detection: { 'min-backlinks': 10 },
  id_nfc_passive_authentication_detection: { revocation: 'strict', 'accept-sha1': true },
  id_nfc_chip_authentication_detection: { 'require-active-authentication': false },
  id_nfc_repeat_detection: { 'sighting-outcome': 'review' },
  id_nfc_selfie_comparison: { threshold: FACE_MATCH_DEFAULTS.threshold },
  id_nfc_expired_detection: { 'grace-days': 0 },
};

/** Each configured Phase 5 check's registry schema, by check. */
const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  document_type_detection: documentTypeDetectionConfigSchema,
  document_extracted_properties_detection: documentExtractedPropertiesDetectionConfigSchema,
  document_expired_detection: documentExpiredDetectionConfigSchema,
  document_recency_detection: documentRecencyDetectionConfigSchema,
  document_fabrication_detection: documentFabricationDetectionConfigSchema,
  document_name_comparison: documentNameComparisonConfigSchema,
  document_address_comparison: documentAddressComparisonConfigSchema,
  database_identity_comparison: databaseIdentityComparisonConfigSchema,
  database_name_comparison: databaseNameComparisonConfigSchema,
  database_address_comparison: databaseAddressComparisonConfigSchema,
  database_birthdate_comparison: databaseBirthdateComparisonConfigSchema,
  database_inquiry_comparison: databaseInquiryComparisonConfigSchema,
  aamva_identity_comparison: aamvaIdentityComparisonConfigSchema,
  email_address_disposable_detection: emailAddressDisposableDetectionConfigSchema,
  crypto_wallet_validity_detection: cryptoWalletValidityDetectionConfigSchema,
  crypto_wallet_address_comparison: cryptoWalletAddressComparisonConfigSchema,
  database_business_identity_comparison: databaseBusinessIdentityComparisonConfigSchema,
  database_business_active_business_detection: databaseBusinessActiveBusinessDetectionConfigSchema,
  database_business_associated_persons_comparison:
    databaseBusinessAssociatedPersonsComparisonConfigSchema,
  business_website_domain_age_detection: businessWebsiteDomainAgeDetectionConfigSchema,
  business_website_backlink_detection: businessWebsiteBacklinkDetectionConfigSchema,
  id_nfc_passive_authentication_detection: idNfcPassiveAuthenticationDetectionConfigSchema,
  id_nfc_chip_authentication_detection: idNfcChipAuthenticationDetectionConfigSchema,
  id_nfc_repeat_detection: idNfcRepeatDetectionConfigSchema,
  id_nfc_selfie_comparison: idNfcSelfieComparisonConfigSchema,
  id_nfc_expired_detection: idNfcExpiredDetectionConfigSchema,
};

const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('PHASE5_CHECK_CONFIG_DEFAULTS (C51.3)', () => {
  it('holds exactly the plan table, every value provisional with a source', () => {
    const values = Object.fromEntries(
      Object.entries(PHASE5_CHECK_CONFIG_DEFAULTS).map(([check, keys]) => [
        check,
        Object.fromEntries(Object.entries(keys).map(([key, entry]) => [key, entry.value])),
      ]),
    );
    expect(values).toEqual(EXPECTED_DEFAULTS);
    for (const [check, keys] of Object.entries(PHASE5_CHECK_CONFIG_DEFAULTS)) {
      for (const [key, entry] of Object.entries(keys)) {
        expect(entry.basis, `${check} ${key}`).toBe('provisional');
        expect(entry.source.length, `${check} ${key}`).toBeGreaterThan(10);
        expect(entry.source, `${check} ${key}`).not.toMatch(/persona/i);
      }
    }
  });

  it('is the union of the per-area tables, each owning disjoint checks (V09)', () => {
    const areas = [
      DOCUMENT_CHECK_CONFIG_DEFAULTS,
      DATABASE_CHECK_CONFIG_DEFAULTS,
      CONTACT_CHECK_CONFIG_DEFAULTS,
      CRYPTO_WALLET_CHECK_CONFIG_DEFAULTS,
      BUSINESS_CHECK_CONFIG_DEFAULTS,
      NFC_CHECK_CONFIG_DEFAULTS,
    ];
    const checks = areas.flatMap((area) => Object.keys(area));
    expect(new Set(checks).size).toBe(checks.length);
    expect(Object.assign({}, ...areas)).toEqual(PHASE5_CHECK_CONFIG_DEFAULTS);
    expect(Object.isFrozen(PHASE5_CHECK_CONFIG_DEFAULTS)).toBe(true);
  });

  it('says "ours" where no external basis exists', () => {
    const ours = [
      ['document_type_detection', 'min-confidence'],
      ['document_expired_detection', 'grace-days'],
      ['document_fabrication_detection', 'max-fabrication-score'],
      ['document_name_comparison', 'min-match-level'],
      ['document_address_comparison', 'min-match-level'],
      ['database_name_comparison', 'min-match-level'],
      ['aamva_identity_comparison', 'ignored-fields'],
      ['aamva_identity_comparison', 'on-jurisdiction-not-participating'],
      ['crypto_wallet_address_comparison', 'allow-contract-wallets'],
      ['database_business_identity_comparison', 'match-groups'],
      ['database_business_active_business_detection', 'fail-on-lapsed-lei'],
      ['business_website_domain_age_detection', 'min-domain-age-days'],
      ['business_website_backlink_detection', 'min-backlinks'],
    ] as const;
    for (const [check, key] of ours) {
      expect(PHASE5_CHECK_CONFIG_DEFAULTS[check]?.[key]?.source, `${check} ${key}`).toMatch(
        /\bours\b/,
      );
    }
  });

  it('cites the public, research or decision basis of the others', () => {
    const cited = {
      'document_recency_detection max-age-days': /public default/,
      'document_extracted_properties_detection required-properties': /public/,
      'database_identity_comparison match-groups': /public module default/,
      'database_identity_comparison accept-precision-limited-birthdate': /R2/,
      'database_identity_comparison accept-transposed-birthdate': /R4/,
      'crypto_wallet_validity_detection require-evm-checksum': /C5/,
      'crypto_wallet_address_comparison bip137-mode': /C5/,
      'crypto_wallet_address_comparison allow-high-s': /EIP-2/,
      'id_nfc_passive_authentication_detection revocation': /9303-12/,
      'id_nfc_passive_authentication_detection accept-sha1': /SHA-1/,
      'id_nfc_chip_authentication_detection require-active-authentication': /decision 33/,
      'id_nfc_repeat_detection sighting-outcome': /decision 35/,
    };
    for (const [label, pattern] of Object.entries(cited)) {
      const [check = '', key = ''] = label.split(' ');
      expect(PHASE5_CHECK_CONFIG_DEFAULTS[check]?.[key]?.source, label).toMatch(pattern);
    }
  });

  it('keeps the shared face-match value for the chip portrait, but as provisional: not calibrated for chip portraits', () => {
    const entry = PHASE5_CHECK_CONFIG_DEFAULTS.id_nfc_selfie_comparison?.threshold;
    expect(entry?.value).toBe(FACE_MATCH_DEFAULTS.threshold);
    expect(entry?.basis).toBe('provisional');
    expect(entry?.source).toMatch(/chip portraits/);
  });

  it('keeps the government ID table and the NFC table in step for id_nfc_expired_detection', () => {
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_nfc_expired_detection).toEqual({
      'grace-days': PHASE5_CHECK_CONFIG_DEFAULTS.id_nfc_expired_detection?.['grace-days']?.value,
    });
  });

  it.each(Object.entries(EXPECTED_DEFAULTS))('validates the defaults of %s', (check, values) => {
    const schema = SCHEMAS[check];
    expect(schema, check).toBeDefined();
    expect(schema?.safeParse(values).success, check).toBe(true);
  });

  it('gives the worker the default values and their basis, nothing for an unknown check', () => {
    expect(phase5ConfigDefaults('business_website_domain_age_detection')).toEqual({
      'min-domain-age-days': 90,
    });
    expect(phase5ThresholdBasis('business_website_domain_age_detection')).toEqual({
      'min-domain-age-days': 'provisional',
    });
    expect(phase5ConfigDefaults('crypto_wallet_statement_comparison')).toEqual({});
    expect(phase5ThresholdBasis('toString')).toEqual({});
  });
});

describe('Phase 5 config schemas (C51.3)', () => {
  it.each([
    [documentTypeDetectionConfigSchema, { 'min-confidence': 0 }, { 'min-confidence': 1.01 }],
    [documentTypeDetectionConfigSchema, { 'min-confidence': 1 }, { 'min-confidence': -0.1 }],
    [documentExpiredDetectionConfigSchema, { 'grace-days': 365 }, { 'grace-days': 366 }],
    [documentRecencyDetectionConfigSchema, { 'max-age-days': 1 }, { 'max-age-days': 0 }],
    [documentRecencyDetectionConfigSchema, { 'max-age-days': 3650 }, { 'max-age-days': 3651 }],
    [documentRecencyDetectionConfigSchema, { 'max-age-days': 365 }, { 'max-age-days': 30.5 }],
    [
      documentFabricationDetectionConfigSchema,
      { 'max-fabrication-score': 0.45 },
      { 'max-fabrication-score': 2 },
    ],
    [
      documentExtractedPropertiesDetectionConfigSchema,
      { 'required-properties': ['issuer'] },
      { 'required-properties': [] },
    ],
    [
      documentExtractedPropertiesDetectionConfigSchema,
      { 'required-properties': [...DOCUMENT_PROPERTIES] },
      { 'required-properties': ['name', 'name'] },
    ],
    [
      documentExtractedPropertiesDetectionConfigSchema,
      { 'required-properties': ['address'] },
      { 'required-properties': ['birthdate'] },
    ],
    [
      documentNameComparisonConfigSchema,
      { 'min-match-level': 'full' },
      { 'min-match-level': 'none' },
    ],
    [
      documentAddressComparisonConfigSchema,
      { 'min-match-level': 'partial' },
      { 'min-match-level': 'missing' },
    ],
    [databaseNameComparisonConfigSchema, { 'min-match-level': 'full' }, { threshold: 0.9 }],
    [
      databaseAddressComparisonConfigSchema,
      { 'min-match-level': 'full' },
      { 'min-match-level': 1 },
    ],
    [databaseBirthdateComparisonConfigSchema, {}, { 'min-match-level': 'exact' }],
    [databaseInquiryComparisonConfigSchema, { 'min-match-level': 'partial' }, { fields: ['name'] }],
    [
      databaseIdentityComparisonConfigSchema,
      { 'accept-precision-limited-birthdate': false, 'accept-transposed-birthdate': true },
      { 'accept-transposed-birthdate': 'yes' },
    ],
    [
      aamvaIdentityComparisonConfigSchema,
      { 'ignored-fields': ['birthdate', 'address-postal-code'] },
      { 'ignored-fields': ['identification-number'] },
    ],
    [
      aamvaIdentityComparisonConfigSchema,
      { 'on-jurisdiction-not-participating': 'skip' },
      { 'on-jurisdiction-not-participating': 'fail' },
    ],
    [
      aamvaIdentityComparisonConfigSchema,
      { 'ignored-fields': [] },
      { 'ignored-fields': ['name-last'] },
    ],
    [
      aamvaIdentityComparisonConfigSchema,
      { 'ignored-fields': ['name-first'] },
      { 'ignored-fields': ['birthdate', 'birthdate'] },
    ],
    [cryptoWalletValidityDetectionConfigSchema, { 'require-evm-checksum': true }, { strict: true }],
    [
      cryptoWalletAddressComparisonConfigSchema,
      { 'bip137-mode': 'strict', 'allow-high-s': false, 'allow-contract-wallets': true },
      { 'bip137-mode': 'any' },
    ],
    [
      databaseBusinessActiveBusinessDetectionConfigSchema,
      { 'fail-on-lapsed-lei': true },
      { 'fail-on-lapsed-lei': 1 },
    ],
    [
      databaseBusinessAssociatedPersonsComparisonConfigSchema,
      { 'min-match-level': 'full' },
      { 'min-match-level': 'none' },
    ],
    [
      businessWebsiteDomainAgeDetectionConfigSchema,
      { 'min-domain-age-days': 3650 },
      { 'min-domain-age-days': 0 },
    ],
    [
      businessWebsiteBacklinkDetectionConfigSchema,
      { 'min-backlinks': 0 },
      { 'min-backlinks': 100_001 },
    ],
    [
      businessWebsiteBacklinkDetectionConfigSchema,
      { 'min-backlinks': 100_000 },
      { 'min-backlinks': -1 },
    ],
    [
      idNfcPassiveAuthenticationDetectionConfigSchema,
      { revocation: 'best-effort', 'accept-sha1': false },
      { revocation: 'none' },
    ],
    [
      idNfcChipAuthenticationDetectionConfigSchema,
      { 'require-active-authentication': true },
      { 'require-chip-authentication': true },
    ],
    [
      idNfcRepeatDetectionConfigSchema,
      { 'sighting-outcome': 'fail' },
      { 'sighting-outcome': 'skip' },
    ],
    [idNfcSelfieComparisonConfigSchema, { threshold: 0.25 }, { threshold: 0.61 }],
    [idNfcExpiredDetectionConfigSchema, { 'grace-days': 0 }, { 'grace-days': -1 }],
  ] as const)('%# accepts its bound and refuses one past it', (schema, valid, invalid) => {
    expect(accepts(schema, valid)).toBe(true);
    expect(accepts(schema, invalid)).toBe(false);
  });

  it('never lets AAMVA ignore the surname or the licence number, so the identity rests on them', () => {
    expect(AAMVA_IGNORABLE_FIELDS).toEqual([
      'name-first',
      'birthdate',
      'issue-date',
      'expiration-date',
      'address-postal-code',
    ]);
    for (const field of AAMVA_IGNORABLE_FIELDS) {
      expect(AAMVA_COMPARISON_FIELDS).toContain(field);
    }
  });

  it('bounds the disposable allow and deny lists, refuses a domain on both, and lower-case hostnames only', () => {
    const domains = (count: number) =>
      Array.from({ length: count }, (_, index) => `d${String(index)}.example`);
    const schema = emailAddressDisposableDetectionConfigSchema;
    expect(MAX_EMAIL_DOMAIN_LIST).toBe(500);
    expect(accepts(schema, { 'allow-domains': domains(500), 'deny-domains': domains(1) })).toBe(
      false,
    );
    expect(accepts(schema, { 'allow-domains': domains(500) })).toBe(true);
    expect(accepts(schema, { 'deny-domains': domains(501) })).toBe(false);
    expect(accepts(schema, { 'deny-domains': ['a.example', 'a.example'] })).toBe(false);
    expect(accepts(schema, { 'deny-domains': ['disposable.test', 'mail.co.uk'] })).toBe(true);
    for (const bad of ['UPPER.example', 'no-dot', '-lead.example', 'a..b', 'user@a.example', '']) {
      expect(accepts(schema, { 'deny-domains': [bad] }), bad).toBe(false);
    }
  });
});

describe('match groups (C58.1)', () => {
  const database = matchGroupsSchema(DATABASE_MATCH_FIELDS);
  const business = matchGroupsSchema(BUSINESS_MATCH_FIELDS);

  it('names the four levels and the two a requirement may ask for', () => {
    expect(MATCH_LEVELS).toEqual(['full', 'partial', 'none', 'missing']);
    expect(MATCH_REQUIREMENTS).toEqual(['partial', 'full']);
    expect(MAX_MATCH_GROUPS).toBe(5);
  });

  it('takes one to five groups, each mapping at least one of its fields to partial or full', () => {
    expect(accepts(database, [{ name: 'full' }])).toBe(true);
    expect(
      accepts(
        database,
        Array.from({ length: 5 }, () => ({ name: 'partial', 'phone-number': 'full' })),
      ),
    ).toBe(true);
    expect(accepts(database, [])).toBe(false);
    expect(
      accepts(
        database,
        Array.from({ length: 6 }, () => ({ name: 'partial' })),
      ),
    ).toBe(false);
    expect(accepts(database, [{}])).toBe(false);
    expect(accepts(database, [{ name: 'none' }])).toBe(false);
    expect(accepts(database, [{ name: 'partial', 'registration-number': 'full' }])).toBe(false);
    expect(accepts(business, [{ 'registration-number': 'full' }])).toBe(true);
    expect(accepts(business, [{ birthdate: 'full' }])).toBe(false);
  });

  it('is the identity checks schema member', () => {
    expect(
      accepts(databaseIdentityComparisonConfigSchema, {
        'match-groups': [{ 'email-address': 'full' }],
      }),
    ).toBe(true);
    expect(
      accepts(databaseBusinessIdentityComparisonConfigSchema, {
        'match-groups': [{ 'email-address': 'full' }],
      }),
    ).toBe(false);
  });
});
