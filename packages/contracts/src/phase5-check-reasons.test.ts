/**
 * C51.2: the reasons of every Phase 5 check, one file per area, from the plan's table. Every check
 * may also answer with the C29.4 shared reasons its evidence calls for: `input_missing` always,
 * `execution_error` with a vision or provider input, `provider_not_configured` with a provider
 * input. The user-behaviour failure reasons are frozen in Stage 1a (retry hints, both clients);
 * later stages may add fraud reasons only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  NON_BLOCKING_NOT_APPLICABLE_REASONS,
  getCheckDefinition,
  listChecks,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CHECK_IDS,
  BUSINESS_CHECK_OUTCOMES,
  BUSINESS_CHECK_REASONS,
} from './business-check-reasons.js';
import {
  CONTACT_CHECK_IDS,
  CONTACT_CHECK_OUTCOMES,
  CONTACT_CHECK_REASONS,
} from './contact-check-reasons.js';
import {
  CRYPTO_WALLET_CHECK_IDS,
  CRYPTO_WALLET_CHECK_OUTCOMES,
  CRYPTO_WALLET_CHECK_REASONS,
} from './crypto-wallet-check-reasons.js';
import {
  DATABASE_CHECK_IDS,
  DATABASE_CHECK_OUTCOMES,
  DATABASE_CHECK_REASONS,
} from './database-check-reasons.js';
import {
  DOCUMENT_CHECK_IDS,
  DOCUMENT_CHECK_OUTCOMES,
  DOCUMENT_CHECK_REASONS,
} from './document-check-reasons.js';
import {
  AAMVA_JURISDICTION_NOT_PARTICIPATING_REASON,
  GOVERNMENT_ID_CHECK_IDS,
  GOVERNMENT_ID_CHECK_REASONS,
} from './government-id-check-reasons.js';
import { NFC_CHECK_IDS, NFC_CHECK_OUTCOMES, NFC_CHECK_REASONS } from './nfc-check-reasons.js';
import { PHASE5_CHECK_REASONS, PHASE5_RETRY_HINT_REASONS } from './phase5-check-reasons.js';
import { FIXTURES_DIR } from './test-support.js';

type Row = readonly [failed: readonly string[], notApplicable: readonly string[]];

const MATCHING_NA = ['not_requested', 'no_reference_data', 'no_matching_record'] as const;
const AAMVA_NA = ['jurisdiction_not_participating', 'input_missing'] as const;

/** The C51.2 table: each check's failure reasons and `not_applicable` reasons. */
const AREAS: Readonly<
  Record<
    string,
    {
      ids: readonly string[];
      outcomes: Readonly<
        Record<string, { failed: readonly string[]; notApplicable: readonly string[] }>
      >;
      reasons: Readonly<Record<string, readonly string[]>>;
      table: Readonly<Record<string, Row>>;
    }
  >
> = {
  document: {
    ids: DOCUMENT_CHECK_IDS,
    outcomes: DOCUMENT_CHECK_OUTCOMES,
    reasons: DOCUMENT_CHECK_REASONS,
    table: {
      document_type_detection: [
        [
          'document_type_not_accepted',
          'document_unreadable',
          'document_password_protected',
          'document_too_large',
          'document_too_many_pages',
        ],
        ['document_type_unknown'],
      ],
      document_extracted_properties_detection: [
        ['name_not_found', 'address_not_found', 'issue_date_not_found', 'issuer_not_found'],
        ['input_missing'],
      ],
      document_expired_detection: [['document_expired'], ['feature_absent', 'input_missing']],
      document_recency_detection: [['document_too_old'], ['input_missing']],
      document_fabrication_detection: [
        [
          'pdf_incremental_update',
          'pdf_editor_producer',
          'pdf_created_before_issue_date',
          'pdf_metadata_inconsistent',
          'pdf_font_inconsistent',
          'pdf_hidden_text',
          'pdf_text_layer_mismatch',
          'pdf_signature_invalidated',
          'pdf_active_content',
          'image_editor_software',
          'image_tampered',
        ],
        ['input_missing'],
      ],
      document_name_comparison: [
        ['document_name_mismatch'],
        ['no_reference_data', 'input_missing'],
      ],
      document_address_comparison: [
        ['address_mismatch', 'postal_code_mismatch'],
        ['no_reference_data', 'input_missing'],
      ],
    },
  },
  database: {
    ids: DATABASE_CHECK_IDS,
    outcomes: DATABASE_CHECK_OUTCOMES,
    reasons: DATABASE_CHECK_REASONS,
    table: {
      database_identity_comparison: [
        ['low_confidence_match', 'record_not_found'],
        ['no_matching_record', 'insufficient_data', 'unsupported_country'],
      ],
      database_name_comparison: [['name_mismatch'], [...MATCHING_NA]],
      database_address_comparison: [['address_mismatch'], [...MATCHING_NA]],
      database_birthdate_comparison: [
        ['birthdate_mismatch'],
        [...MATCHING_NA, 'birthdate_ambiguous'],
      ],
      database_inquiry_comparison: [
        ['inquiry_field_mismatch'],
        ['not_requested', 'no_reference_data'],
      ],
      database_po_box_detection: [['po_box_detected'], ['not_requested']],
      aamva_identity_comparison: [['record_mismatch', 'record_not_found'], [...AAMVA_NA]],
      aamva_name_comparison: [['name_mismatch', 'record_not_found'], [...AAMVA_NA]],
      aamva_identification_number_comparison: [
        ['identification_number_mismatch', 'record_not_found'],
        [...AAMVA_NA],
      ],
    },
  },
  contact: {
    ids: CONTACT_CHECK_IDS,
    outcomes: CONTACT_CHECK_OUTCOMES,
    reasons: CONTACT_CHECK_REASONS,
    table: {
      phone_number_otp_comparison: [
        ['otp_attempts_exhausted', 'otp_not_confirmed'],
        ['otp_delivery_unavailable'],
      ],
      email_address_otp_comparison: [
        ['otp_attempts_exhausted', 'otp_not_confirmed'],
        ['otp_delivery_unavailable'],
      ],
      email_address_disposable_detection: [['disposable_domain'], ['list_unavailable']],
      email_address_mx_detection: [
        ['domain_not_found', 'domain_rejects_mail', 'no_mail_server'],
        ['execution_error'],
      ],
    },
  },
  'crypto wallet': {
    ids: CRYPTO_WALLET_CHECK_IDS,
    outcomes: CRYPTO_WALLET_CHECK_OUTCOMES,
    reasons: CRYPTO_WALLET_CHECK_REASONS,
    table: {
      crypto_wallet_validity_detection: [['address_invalid', 'address_checksum_invalid'], []],
      crypto_wallet_disallowed_chain_detection: [['chain_not_allowed'], ['no_allowlist']],
      crypto_wallet_statement_comparison: [['statement_mismatch'], ['input_missing']],
      crypto_wallet_address_comparison: [
        ['signature_invalid', 'signature_address_mismatch', 'expected_address_mismatch'],
        ['signature_inconclusive', 'ownership_proof_unsupported', 'contract_wallet_not_allowed'],
      ],
    },
  },
  business: {
    ids: BUSINESS_CHECK_IDS,
    outcomes: BUSINESS_CHECK_OUTCOMES,
    reasons: BUSINESS_CHECK_REASONS,
    table: {
      database_business_identity_comparison: [
        ['low_confidence_match'],
        ['registration_number_not_found', 'no_registry_record', 'insufficient_data'],
      ],
      database_business_active_business_detection: [
        ['business_inactive'],
        ['no_registry_record', 'status_not_available'],
      ],
      database_business_associated_persons_comparison: [
        ['associated_person_not_on_register'],
        ['not_requested', 'source_has_no_persons', 'no_registry_record'],
      ],
      database_business_enabled_country_detection: [['country_not_enabled'], ['no_allowlist']],
      database_business_service_available_detection: [
        [],
        ['provider_not_configured', 'execution_error'],
      ],
      business_website_resolution_detection: [['domain_not_resolving'], ['execution_error']],
      business_website_domain_age_detection: [
        ['domain_recently_registered'],
        ['domain_age_unavailable'],
      ],
      business_website_malicious_website_detection: [
        ['malware', 'phishing', 'spam_source'],
        ['provider_not_configured', 'execution_error'],
      ],
      business_website_backlink_detection: [['backlinks_below_threshold'], []],
    },
  },
  NFC: {
    ids: NFC_CHECK_IDS,
    outcomes: NFC_CHECK_OUTCOMES,
    reasons: NFC_CHECK_REASONS,
    table: {
      id_nfc_passive_authentication_detection: [
        ['dg_hash_mismatch', 'sod_signature_invalid', 'dsc_revoked', 'specimen_issuer'],
        [
          'trust_anchor_unavailable',
          'trust_anchor_withdrawn',
          'dsc_missing',
          'crl_unavailable',
          'certificate_expired',
          'certificate_profile_invalid',
          'issuer_country_inconsistent',
          'algorithm_unsupported',
          'chip_data_malformed',
          'input_missing',
        ],
      ],
      id_nfc_chip_authentication_detection: [
        ['active_authentication_failed'],
        [
          'chip_auth_not_server_verifiable',
          'active_authentication_withheld',
          'active_authentication_unavailable',
          'chip_data_malformed',
          'integrity_not_established',
        ],
      ],
      id_nfc_mrz_comparison: [
        [
          'document_number_mismatch',
          'birthdate_mismatch',
          'expiration_date_mismatch',
          'name_mismatch',
          'nationality_mismatch',
          'issuer_mismatch',
        ],
        ['not_requested', 'no_reference_data', 'integrity_not_established'],
      ],
      id_nfc_selfie_comparison: [
        ['face_mismatch'],
        ['no_reference_data', 'input_missing', 'integrity_not_established'],
      ],
      id_nfc_repeat_detection: [
        ['chip_seen_on_other_account'],
        ['chip_seen_on_other_account', 'integrity_not_established'],
      ],
      id_nfc_expired_detection: [
        ['expired', 'expired_within_grace_period', 'expiration_date_invalid'],
        ['input_missing', 'integrity_not_established'],
      ],
    },
  },
};

/** The C29.4 shared reasons a check's evidence calls for (C51.2). */
function sharedReasons(id: string): string[] {
  const inputs = getCheckDefinition(id)?.inputs ?? [];
  return [
    'input_missing',
    ...(inputs.includes('vision') || inputs.includes('provider') ? ['execution_error'] : []),
    ...(inputs.includes('provider') ? ['provider_not_configured'] : []),
  ];
}

/** C51.2, frozen in Stage 1a: the failure reasons of the Phase 5 user-behaviour checks. */
const FROZEN_USER_BEHAVIOUR_REASONS = [
  'document_type_not_accepted',
  'document_unreadable',
  'document_password_protected',
  'document_too_large',
  'document_too_many_pages',
  'name_not_found',
  'address_not_found',
  'issue_date_not_found',
  'issuer_not_found',
  'document_expired',
  'document_too_old',
  'po_box_detected',
  'otp_attempts_exhausted',
  'otp_not_confirmed',
  'domain_not_found',
  'domain_rejects_mail',
  'no_mail_server',
  'address_invalid',
  'address_checksum_invalid',
  'signature_invalid',
  'signature_address_mismatch',
  'expected_address_mismatch',
  'country_not_enabled',
  'domain_not_resolving',
  'document_name_mismatch',
].sort();

describe.each(Object.entries(AREAS))('the %s reasons file (C51.2)', (_area, area) => {
  it('lists its checks in the C51.2 order, each a registered check', () => {
    expect(area.ids).toEqual(Object.keys(area.table));
    for (const id of area.ids) {
      expect(getCheckDefinition(id), id).toBeDefined();
    }
    expect(Object.isFrozen(area.ids)).toBe(true);
  });

  it('states the C51.2 table, row by row', () => {
    expect(
      Object.fromEntries(
        Object.entries(area.outcomes).map(([id, row]) => [id, [row.failed, row.notApplicable]]),
      ),
    ).toEqual(area.table);
  });

  it('lets each check emit its row and the shared reasons its evidence calls for, nothing else', () => {
    for (const [id, [failed, notApplicable]] of Object.entries(area.table)) {
      expect([...(area.reasons[id] ?? [])].sort(), id).toEqual(
        [...new Set([...sharedReasons(id), ...failed, ...notApplicable])].sort(),
      );
    }
    expect(Object.keys(area.reasons)).toEqual(area.ids);
  });

  it('uses snake_case codes only', () => {
    for (const reasons of Object.values(area.reasons)) {
      for (const reason of reasons) {
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        expect(reason).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      }
    }
  });

  it('lets every check with a provider input answer provider_not_configured and execution_error', () => {
    for (const id of area.ids) {
      if (getCheckDefinition(id)?.inputs.includes('provider')) {
        expect(area.reasons[id], id).toEqual(
          expect.arrayContaining(['provider_not_configured', 'execution_error']),
        );
      }
    }
  });
});

describe('every Phase 5 check (C51.2)', () => {
  const PHASE5_TYPES = [
    'document',
    'database',
    'aamva',
    'phone_number',
    'email_address',
    'government_id_nfc',
    'crypto_wallet',
    'database_business',
    'business_website',
  ] as const;

  it('has a reasons entry, and no other check does', () => {
    const registered = PHASE5_TYPES.flatMap((type) => listChecks(type).map((check) => check.id));
    expect(Object.keys(PHASE5_CHECK_REASONS).sort()).toEqual([...registered].sort());
    const fromAreas = Object.values(AREAS).flatMap((area) => [...area.ids]);
    expect(new Set(fromAreas).size).toBe(fromAreas.length);
    expect([...fromAreas].sort()).toEqual([...registered].sort());
  });

  it('takes id_nfc_expired_detection from the government ID file to the NFC one', () => {
    expect(GOVERNMENT_ID_CHECK_IDS).not.toContain('id_nfc_expired_detection');
    expect(Object.keys(GOVERNMENT_ID_CHECK_REASONS)).not.toContain('id_nfc_expired_detection');
    expect(NFC_CHECK_IDS).toContain('id_nfc_expired_detection');
  });

  it('freezes the failure reasons of its user-behaviour checks, which retry hints carry', () => {
    expect(PHASE5_RETRY_HINT_REASONS).toEqual(FROZEN_USER_BEHAVIOUR_REASONS);
    const derived = Object.values(AREAS).flatMap((area) =>
      Object.entries(area.table)
        .filter(([id]) => getCheckDefinition(id)?.checkType === 'user_behavior')
        .flatMap(([, [failed]]) => failed),
    );
    expect([...new Set(derived)].sort()).toEqual(FROZEN_USER_BEHAVIOUR_REASONS);
    expect(Object.isFrozen(PHASE5_RETRY_HINT_REASONS)).toBe(true);
  });

  it('are in the retry-hint fixture the clients translate', () => {
    const fixture = JSON.parse(
      readFileSync(path.join(FIXTURES_DIR, 'flow/retry-hint-reasons.json'), 'utf8'),
    ) as { reasons: string[] };
    expect(fixture.reasons).toEqual(expect.arrayContaining(FROZEN_USER_BEHAVIOUR_REASONS));
    expect(fixture.reasons).toEqual([...fixture.reasons].sort());
  });

  it('answers non-blocking only with the decision engine reasons', () => {
    const nonBlocking: readonly string[] = NON_BLOCKING_NOT_APPLICABLE_REASONS;
    for (const area of Object.values(AREAS)) {
      for (const [id, [, notApplicable]] of Object.entries(area.table)) {
        for (const reason of notApplicable.filter((code) => nonBlocking.includes(code))) {
          expect(
            ['feature_absent', 'not_requested', 'no_allowlist', 'chip_auth_not_server_verifiable'],
            id,
          ).toContain(reason);
        }
      }
    }
  });
});

describe('the AAMVA lookup on a government ID (C59.4, a C35 amendment)', () => {
  it('answers not_applicable when the jurisdiction does not take part', () => {
    expect(AAMVA_JURISDICTION_NOT_PARTICIPATING_REASON).toBe(
      'aamva_jurisdiction_not_participating',
    );
    expect(GOVERNMENT_ID_CHECK_REASONS.id_aamva_database_lookup).toContain(
      'aamva_jurisdiction_not_participating',
    );
  });
});
