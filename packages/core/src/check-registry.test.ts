import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHASE5_CHECK_CONFIG_DEFAULTS, phase5ConfigDefaults } from './check-config.js';
import {
  CHECK_CATEGORY_OVERRIDES,
  CHECK_IDS,
  CHECK_REGISTRY,
  PHASE5_CHECK_DEFAULTS,
  checkDefinitionSchema,
  checkIdSchema,
  getCheckDefinition,
  isCheckId,
  listChecks,
  type CheckDefinition,
} from './check-registry.js';
import {
  CHECK_INPUTS,
  VERIFICATION_TYPES,
  type CheckInput,
  type CheckTier,
  type CheckType,
  type VerificationType,
} from './enums.js';

interface PlanRow {
  id: string;
  tier: CheckTier;
  alternateTier: CheckTier | undefined;
  checkType: CheckType;
}

const plan = readFileSync(path.resolve(import.meta.dirname, '../../../docs/PLAN.md'), 'utf8');

/** Returns the body of a `### <heading>` section of PLAN.md. */
function planSection(heading: string): string {
  const start = plan.indexOf(`### ${heading}`);
  if (start === -1) {
    throw new Error(`PLAN.md has no section "${heading}"`);
  }
  const rest = plan.slice(start + 4);
  const end = rest.search(/^#{2,3} /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Parses `| check | T | Type | … |` rows of a PLAN §4 table. */
function planRows(heading: string): PlanRow[] {
  return planSection(heading)
    .split('\n')
    .filter((line) => /^\| [a-z]/.test(line))
    .map((line) => {
      const [checkCell = '', tierCell = '', typeCell = ''] = line
        .split('|')
        .slice(1)
        .map((cell) => cell.trim());
      const id = /^[a-z0-9_]+/.exec(checkCell)?.[0] ?? '';
      const [tier, alternateTier] = tierCell.split(/[/+]/) as [CheckTier, CheckTier?];
      const checkType: CheckType = typeCell === 'UB' ? 'user_behavior' : 'fraud';
      return { id, tier, alternateTier, checkType };
    });
}

/** PLAN §4.3 rows: `| check | T | Type | Verification type | Approach |`. */
function section43Rows() {
  return planSection('4.3 Document, database, business, crypto, contact, NFC')
    .split('\n')
    .filter((line) => /^\| [a-z]/.test(line))
    .map((line) => {
      const [checkCell = '', tierCell = '', typeCell = '', verificationCell = ''] = line
        .split('|')
        .slice(1)
        .map((cell) => cell.trim());
      const [tier, alternateTier] = tierCell.split(/[/+]/) as [CheckTier, CheckTier?];
      return {
        id: /^[a-z0-9_]+/.exec(checkCell)?.[0] ?? '',
        verificationType: verificationCell.replaceAll('`', ''),
        tier,
        alternateTier,
        checkType: typeCell === 'UB' ? 'user_behavior' : 'fraud',
      };
    });
}

const governmentIdRows = planRows('4.1 Government ID');
const selfieRows = planRows('4.2 Selfie');

/**
 * PLAN §4.3, one row per check since Phase 5 rewrote it (C51.1): the 31 checks of the first
 * catalogue and the seven new ids (`document_recency_detection`, `database_identity_comparison`,
 * `database_inquiry_comparison`, `database_po_box_detection`, `aamva_identity_comparison`,
 * `business_website_resolution_detection`, `id_nfc_repeat_detection`), with the type split of
 * C50.1. `id_nfc_expired_detection` stays a §4.1 row.
 */
const SECTION_4_3: readonly (readonly [
  string,
  VerificationType,
  CheckTier,
  CheckTier | undefined,
  CheckType,
])[] = [
  ['document_type_detection', 'document', 'R', undefined, 'user_behavior'],
  ['document_extracted_properties_detection', 'document', 'R', undefined, 'user_behavior'],
  ['document_expired_detection', 'document', 'R', undefined, 'user_behavior'],
  ['document_recency_detection', 'document', 'R', undefined, 'user_behavior'],
  ['document_fabrication_detection', 'document', 'H', undefined, 'fraud'],
  ['document_name_comparison', 'document', 'R', undefined, 'user_behavior'],
  ['document_address_comparison', 'document', 'R', undefined, 'fraud'],
  ['database_identity_comparison', 'database', 'R', 'A', 'fraud'],
  ['database_name_comparison', 'database', 'R', 'A', 'fraud'],
  ['database_address_comparison', 'database', 'R', 'A', 'fraud'],
  ['database_birthdate_comparison', 'database', 'R', 'A', 'fraud'],
  ['database_inquiry_comparison', 'database', 'R', undefined, 'fraud'],
  ['database_po_box_detection', 'database', 'R', undefined, 'user_behavior'],
  ['aamva_identity_comparison', 'aamva', 'A', undefined, 'fraud'],
  ['aamva_name_comparison', 'aamva', 'A', undefined, 'fraud'],
  ['aamva_identification_number_comparison', 'aamva', 'A', undefined, 'fraud'],
  ['database_business_identity_comparison', 'database_business', 'R', 'A', 'fraud'],
  ['database_business_active_business_detection', 'database_business', 'R', 'A', 'fraud'],
  ['database_business_associated_persons_comparison', 'database_business', 'R', 'A', 'fraud'],
  [
    'database_business_enabled_country_detection',
    'database_business',
    'R',
    undefined,
    'user_behavior',
  ],
  [
    'database_business_service_available_detection',
    'database_business',
    'R',
    undefined,
    'user_behavior',
  ],
  ['business_website_resolution_detection', 'business_website', 'R', undefined, 'user_behavior'],
  ['business_website_domain_age_detection', 'business_website', 'R', undefined, 'fraud'],
  ['business_website_malicious_website_detection', 'business_website', 'A', undefined, 'fraud'],
  ['business_website_backlink_detection', 'business_website', 'A', undefined, 'fraud'],
  ['crypto_wallet_validity_detection', 'crypto_wallet', 'R', undefined, 'user_behavior'],
  ['crypto_wallet_disallowed_chain_detection', 'crypto_wallet', 'R', undefined, 'fraud'],
  ['crypto_wallet_address_comparison', 'crypto_wallet', 'R', 'A', 'user_behavior'],
  ['crypto_wallet_statement_comparison', 'crypto_wallet', 'R', undefined, 'fraud'],
  ['phone_number_otp_comparison', 'phone_number', 'R', undefined, 'user_behavior'],
  ['email_address_otp_comparison', 'email_address', 'R', undefined, 'user_behavior'],
  ['email_address_disposable_detection', 'email_address', 'R', undefined, 'fraud'],
  ['email_address_mx_detection', 'email_address', 'R', undefined, 'user_behavior'],
  ['id_nfc_passive_authentication_detection', 'government_id_nfc', 'R', undefined, 'fraud'],
  ['id_nfc_chip_authentication_detection', 'government_id_nfc', 'R', undefined, 'fraud'],
  ['id_nfc_mrz_comparison', 'government_id_nfc', 'R', undefined, 'fraud'],
  ['id_nfc_selfie_comparison', 'government_id_nfc', 'R', undefined, 'fraud'],
  ['id_nfc_repeat_detection', 'government_id_nfc', 'R', undefined, 'fraud'],
];

/** The C51.1 `inputs` of every §4.3 check and of `id_nfc_expired_detection`. */
const PHASE5_INPUTS: Readonly<Record<string, readonly CheckInput[]>> = {
  document_type_detection: ['upload', 'vision'],
  document_extracted_properties_detection: ['vision', 'extraction'],
  document_expired_detection: ['extraction'],
  document_recency_detection: ['extraction'],
  document_fabrication_detection: ['upload', 'vision'],
  document_name_comparison: ['extraction', 'history'],
  document_address_comparison: ['extraction', 'history'],
  database_identity_comparison: ['upload', 'provider'],
  database_name_comparison: ['upload', 'provider'],
  database_address_comparison: ['upload', 'provider'],
  database_birthdate_comparison: ['upload', 'provider'],
  database_inquiry_comparison: ['upload', 'history'],
  database_po_box_detection: ['upload'],
  aamva_identity_comparison: ['upload', 'provider'],
  aamva_name_comparison: ['upload', 'provider'],
  aamva_identification_number_comparison: ['upload', 'provider'],
  phone_number_otp_comparison: ['upload'],
  email_address_otp_comparison: ['upload'],
  email_address_disposable_detection: ['upload'],
  email_address_mx_detection: ['upload', 'provider'],
  crypto_wallet_validity_detection: ['upload'],
  crypto_wallet_disallowed_chain_detection: ['upload'],
  crypto_wallet_statement_comparison: ['upload'],
  crypto_wallet_address_comparison: ['upload', 'provider'],
  database_business_identity_comparison: ['upload', 'provider'],
  database_business_active_business_detection: ['upload', 'provider'],
  database_business_associated_persons_comparison: ['upload', 'provider'],
  database_business_enabled_country_detection: ['upload'],
  database_business_service_available_detection: ['upload', 'provider'],
  business_website_resolution_detection: ['upload', 'provider'],
  business_website_domain_age_detection: ['upload', 'provider'],
  business_website_malicious_website_detection: ['upload', 'provider'],
  business_website_backlink_detection: ['upload', 'provider'],
  id_nfc_passive_authentication_detection: ['upload'],
  id_nfc_chip_authentication_detection: ['upload'],
  id_nfc_mrz_comparison: ['upload', 'history'],
  id_nfc_selfie_comparison: ['upload', 'vision', 'history'],
  id_nfc_repeat_detection: ['upload', 'history'],
  id_nfc_expired_detection: ['upload'],
};

/** C51.1: the explicit defaults table, by check. */
const PHASE5_DEFAULTS: Readonly<Record<string, 'required' | 'advisory' | 'disabled'>> = {
  document_type_detection: 'required',
  document_extracted_properties_detection: 'required',
  document_expired_detection: 'required',
  document_recency_detection: 'required',
  document_fabrication_detection: 'advisory',
  // Decision 16 (H24, V12).
  document_name_comparison: 'required',
  document_address_comparison: 'advisory',
  database_identity_comparison: 'required',
  database_name_comparison: 'advisory',
  database_address_comparison: 'advisory',
  database_birthdate_comparison: 'advisory',
  database_inquiry_comparison: 'advisory',
  database_po_box_detection: 'advisory',
  aamva_identity_comparison: 'required',
  aamva_name_comparison: 'advisory',
  aamva_identification_number_comparison: 'advisory',
  phone_number_otp_comparison: 'required',
  email_address_otp_comparison: 'required',
  email_address_disposable_detection: 'advisory',
  email_address_mx_detection: 'advisory',
  crypto_wallet_validity_detection: 'required',
  crypto_wallet_disallowed_chain_detection: 'required',
  crypto_wallet_statement_comparison: 'required',
  crypto_wallet_address_comparison: 'required',
  database_business_identity_comparison: 'required',
  database_business_active_business_detection: 'required',
  database_business_associated_persons_comparison: 'advisory',
  database_business_enabled_country_detection: 'required',
  database_business_service_available_detection: 'required',
  // Decision 26 (H14).
  business_website_resolution_detection: 'required',
  business_website_domain_age_detection: 'advisory',
  business_website_malicious_website_detection: 'disabled',
  business_website_backlink_detection: 'disabled',
  id_nfc_passive_authentication_detection: 'required',
  // C62.6, decisions 33-35.
  id_nfc_chip_authentication_detection: 'required',
  id_nfc_mrz_comparison: 'required',
  id_nfc_selfie_comparison: 'required',
  id_nfc_repeat_detection: 'advisory',
  id_nfc_expired_detection: 'required',
};

/**
 * C50.8: the checks whose category is not the one their type gives (user behaviour ->
 * `user_action_required`, fraud -> `fraud`), each with the research or decision behind it.
 */
const CATEGORY_OVERRIDES: Readonly<Record<string, readonly [string, RegExp]>> = {
  selfie_pose_detection: ['fraud', /phase4-selfie-behaviour\.md/],
  document_type_detection: ['validity', /phase5-behaviour\.md/],
  document_extracted_properties_detection: ['validity', /phase5-behaviour\.md/],
  document_expired_detection: ['validity', /phase5-behaviour\.md/],
  document_recency_detection: ['validity', /C50\.8/],
  document_name_comparison: ['fraud', /decision 16/],
  crypto_wallet_validity_detection: ['fraud', /phase5-behaviour\.md/],
  crypto_wallet_address_comparison: ['fraud', /decision 21/],
};

/**
 * C29.1: checks whose decision a learned model's output can decide (a face detector, landmarks,
 * a face recognizer, an anti-spoofing classifier, an age or deepfake estimator, or OCR reading a
 * text, zone or field). Checks applying deterministic rules to values, classical signal
 * processing or a classical decoder (zxing-cpp) are not model-based.
 */
const MODEL_BASED: ReadonlySet<string> = new Set([
  // §4.1
  'id_unprocessable_submission_detection',
  'id_double_side_detection',
  'id_portrait_detection',
  'id_portrait_clarity_detection',
  'id_mrz_detection',
  'id_extracted_properties_detection',
  'id_age_inconsistency_detection',
  'id_fabrication_detection',
  'id_handwriting_detection',
  'id_inconsistent_repeat_detection',
  'id_selfie_comparison',
  'id_public_figure_detection',
  // §4.2: every selfie check rests on the face detector
  'selfie_image_quality_detection',
  'selfie_glare_detection',
  'selfie_pose_detection',
  'selfie_multiple_faces_detection',
  'selfie_liveness_detection',
  'selfie_pose_repeat_detection',
  'selfie_id_comparison',
  'selfie_account_comparison',
  'selfie_repeat_detection',
  'selfie_similar_background_detection',
  'selfie_face_covering_detection',
  'selfie_glasses_detection',
  'selfie_age_comparison',
  'selfie_public_figure_detection',
  'selfie_suspicious_entity_detection',
  // §4.3
  'document_type_detection',
  'document_extracted_properties_detection',
  'id_nfc_selfie_comparison',
]);

/** C29.1: H, A/H, H/A and model-based checks are `beta`; everything else ships `ga`. */
function expectedStage(id: string, tier: CheckTier, alternateTier: CheckTier | undefined): string {
  return tier === 'H' || alternateTier === 'H' || MODEL_BASED.has(id) ? 'beta' : 'ga';
}

/** C29.1 `inputs` of every §4.1 check, from its approach in PLAN §4.1 and the Phase 3 plan. */
const GOVERNMENT_ID_INPUTS: Readonly<Record<string, readonly CheckInput[]>> = {
  id_unprocessable_submission_detection: ['upload', 'vision'],
  id_blur_detection: ['upload', 'vision'],
  id_glare_detection: ['upload', 'vision'],
  id_double_side_detection: ['upload', 'vision', 'extraction'],
  id_portrait_detection: ['upload', 'vision'],
  id_portrait_clarity_detection: ['upload', 'vision'],
  id_mrz_detection: ['upload', 'vision', 'extraction'],
  id_mrz_inconsistency_detection: ['extraction'],
  id_barcode_detection: ['upload', 'vision', 'extraction'],
  id_barcode_inconsistency_detection: ['extraction'],
  id_extracted_properties_detection: ['extraction'],
  id_extraction_inconsistency_detection: ['extraction'],
  id_number_format_inconsistency_detection: ['extraction'],
  id_expired_detection: ['extraction'],
  id_valid_dates_detection: ['extraction'],
  id_age_comparison: ['extraction'],
  id_age_inconsistency_detection: ['vision', 'extraction', 'provider'],
  id_disallowed_country_detection: ['extraction'],
  id_disallowed_type_detection: ['extraction'],
  id_po_box_detection: ['extraction'],
  id_real_id_detection: ['vision', 'extraction'],
  id_color_inconsistency_detection: ['upload', 'vision'],
  id_electronic_replica_detection: ['upload', 'vision'],
  id_tamper_detection: ['upload', 'vision'],
  id_fabrication_detection: ['vision', 'extraction'],
  id_handwriting_detection: ['vision', 'extraction'],
  id_compromised_detection: ['vision', 'extraction'],
  id_entity_detection: ['vision', 'extraction'],
  id_repeat_detection: ['extraction', 'history'],
  id_inconsistent_repeat_detection: ['vision', 'extraction', 'history'],
  id_account_comparison: ['extraction'],
  id_inquiry_comparison: ['extraction'],
  id_selfie_comparison: ['vision', 'history'],
  id_public_figure_detection: ['vision', 'provider'],
  id_aamva_database_lookup: ['extraction', 'provider'],
  // C51.1: read from the uploaded DG1 (Phase 5).
  id_nfc_expired_detection: ['upload'],
};

/** C39.1 `inputs` of every §4.2 check. */
const SELFIE_INPUTS: Readonly<Record<string, readonly CheckInput[]>> = {
  selfie_image_quality_detection: ['upload', 'vision'],
  selfie_glare_detection: ['upload', 'vision'],
  selfie_pose_detection: ['upload', 'vision'],
  selfie_multiple_faces_detection: ['upload', 'vision'],
  selfie_liveness_detection: ['upload', 'vision'],
  selfie_pose_repeat_detection: ['upload', 'vision'],
  selfie_id_comparison: ['vision', 'history'],
  selfie_account_comparison: ['vision', 'history'],
  selfie_repeat_detection: ['vision', 'history'],
  selfie_similar_background_detection: ['vision', 'history'],
  selfie_face_covering_detection: ['upload', 'vision'],
  selfie_glasses_detection: ['upload', 'vision'],
  selfie_age_comparison: ['upload', 'vision', 'provider'],
  selfie_public_figure_detection: ['vision', 'provider'],
  selfie_suspicious_entity_detection: ['upload', 'vision', 'provider'],
};

/**
 * C39.1: the checks whose behaviour Phase 4 changes are at implementation version 2; every other
 * check (the eleven selfie checks first implemented in Phase 4 among them) is at 1.
 */
const VERSION_2: ReadonlySet<string> = new Set([
  'selfie_image_quality_detection',
  'selfie_multiple_faces_detection',
  'selfie_id_comparison',
  'selfie_face_covering_detection',
  'id_selfie_comparison',
]);

/**
 * Real-tier checks the registry leaves advisory: the policy-only §4.1 checks, and the selfie
 * checks C39.1 and C45.1 keep advisory (glare, pose repeat until real captures calibrate
 * planarity, the account and repeat comparisons, and the background check).
 */
const OPTIONAL_REAL_CHECKS: readonly string[] = [
  'id_po_box_detection',
  'id_real_id_detection',
  'selfie_glare_detection',
  'selfie_pose_repeat_detection',
  'selfie_account_comparison',
  'selfie_repeat_detection',
  'selfie_similar_background_detection',
];

function definition(id: string): CheckDefinition {
  const found = getCheckDefinition(id);
  if (!found) {
    throw new Error(`check ${id} is not registered`);
  }
  return found;
}

describe('PLAN §4 parsing (test fixture sanity)', () => {
  it('reads every row of the §4.1 and §4.2 tables', () => {
    expect(governmentIdRows).toHaveLength(36);
    expect(selfieRows).toHaveLength(15);
    for (const row of [...governmentIdRows, ...selfieRows]) {
      expect(row.id).toMatch(/^(id|selfie)_[a-z0-9_]+$/);
      expect(['R', 'H', 'A']).toContain(row.tier);
    }
  });
});

describe('CHECK_REGISTRY', () => {
  it('registers every §4.1 government ID check with its tier, type and stage', () => {
    for (const row of governmentIdRows) {
      const check = definition(row.id);
      expect(check, row.id).toMatchObject({
        tier: row.tier,
        checkType: row.checkType,
        stage: expectedStage(row.id, row.tier, row.alternateTier),
      });
      expect(check.alternateTier, row.id).toBe(row.alternateTier);
    }
  });

  it('assigns §4.1 checks to government_id, except chip-read checks to government_id_nfc', () => {
    for (const row of governmentIdRows) {
      expect(definition(row.id).verificationType, row.id).toBe(
        row.id.startsWith('id_nfc_') ? 'government_id_nfc' : 'government_id',
      );
    }
  });

  it('registers every §4.2 selfie check with its tier, type and stage', () => {
    for (const row of selfieRows) {
      const check = definition(row.id);
      expect(check, row.id).toMatchObject({
        verificationType: 'selfie',
        tier: row.tier,
        checkType: row.checkType,
        stage: expectedStage(row.id, row.tier, row.alternateTier),
      });
      expect(check.alternateTier, row.id).toBe(row.alternateTier);
    }
  });

  it.each(SECTION_4_3)(
    'registers §4.3 check %s',
    (id, verificationType, tier, alternateTier, checkType) => {
      const check = definition(id);
      expect(check).toMatchObject({
        verificationType,
        tier,
        checkType,
        stage: expectedStage(id, tier, alternateTier),
      });
      expect(check.alternateTier).toBe(alternateTier);
    },
  );

  it('contains exactly the §4.1, §4.2 and §4.3 checks, without duplicates', () => {
    const expected = [
      ...governmentIdRows.map((row) => row.id),
      ...selfieRows.map((row) => row.id),
      ...SECTION_4_3.map(([id]) => id),
    ];
    const ids = CHECK_REGISTRY.map((check) => check.id);

    expect(new Set(expected).size).toBe(expected.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(CHECK_IDS).toEqual(ids);
  });

  it('ships every heuristic and model-based check as beta and nothing as sunset yet', () => {
    for (const check of CHECK_REGISTRY) {
      const heuristic = check.tier === 'H' || check.alternateTier === 'H';
      expect(check.stage, check.id).toBe(heuristic || check.modelBased ? 'beta' : 'ga');
    }
  });

  it('enables real and heuristic §4.1 and §4.2 checks by default but leaves adapter checks off', () => {
    for (const check of CHECK_REGISTRY.filter(({ id }) => !(id in PHASE5_DEFAULTS))) {
      expect(check.defaultEnabled, check.id).toBe(check.tier !== 'A');
    }
  });

  it('requires only real-tier §4.1 and §4.2 checks by default, except the optional ones (C39.1)', () => {
    for (const check of CHECK_REGISTRY.filter(({ id }) => !(id in PHASE5_DEFAULTS))) {
      const required = check.tier === 'R' && !OPTIONAL_REAL_CHECKS.includes(check.id);
      expect(check.defaultRequired, check.id).toBe(required);
    }
  });

  it('takes the defaults of every §4.3 check and the new ids from one explicit table (C51.1)', () => {
    expect(PHASE5_CHECK_DEFAULTS).toEqual(PHASE5_DEFAULTS);
    expect(Object.keys(PHASE5_CHECK_DEFAULTS).sort()).toEqual(
      [...SECTION_4_3.map(([id]) => id), 'id_nfc_expired_detection'].sort(),
    );
    for (const [id, requirement] of Object.entries(PHASE5_DEFAULTS)) {
      expect(definition(id), id).toMatchObject({
        defaultEnabled: requirement !== 'disabled',
        defaultRequired: requirement === 'required',
      });
    }
  });

  it('keeps an enabled, required check by default in every Phase 5 type (C51.1)', () => {
    for (const type of VERIFICATION_TYPES) {
      expect(
        listChecks(type).some((check) => check.defaultEnabled && check.defaultRequired),
        type,
      ).toBe(true);
    }
  });

  it('gives every check the category of its type, except the published or decided overrides (C50.8)', () => {
    expect(Object.keys(CHECK_CATEGORY_OVERRIDES).sort()).toEqual(
      Object.keys(CATEGORY_OVERRIDES).sort(),
    );
    for (const check of CHECK_REGISTRY) {
      const override = CATEGORY_OVERRIDES[check.id];
      const derived = check.checkType === 'user_behavior' ? 'user_action_required' : 'fraud';
      expect(check.category, check.id).toBe(override?.[0] ?? derived);
      if (override !== undefined) {
        expect(CHECK_CATEGORY_OVERRIDES[check.id]?.source, check.id).toMatch(override[1]);
      }
    }
    // The type still drives retry hints: a user-behaviour check may be categorised fraud.
    expect(definition('crypto_wallet_address_comparison')).toMatchObject({
      checkType: 'user_behavior',
      category: 'fraud',
    });
  });

  it('validates each Phase 5 check config with its area module schema, and only those (C51.3)', () => {
    for (const [id, keys] of Object.entries(PHASE5_CHECK_CONFIG_DEFAULTS)) {
      const schema = definition(id).configSchema;
      expect(schema, id).toBeDefined();
      expect(schema?.safeParse(phase5ConfigDefaults(id)).success, id).toBe(true);
      expect(Object.keys(keys).length, id).toBeGreaterThan(0);
    }
    for (const id of [
      'database_po_box_detection',
      'aamva_name_comparison',
      'phone_number_otp_comparison',
      'email_address_mx_detection',
      'crypto_wallet_statement_comparison',
      'database_business_enabled_country_detection',
      'business_website_resolution_detection',
      'business_website_malicious_website_detection',
      'id_nfc_passive_authentication_detection',
    ]) {
      const schema = definition(id).configSchema;
      if (id in PHASE5_CHECK_CONFIG_DEFAULTS) {
        expect(schema, id).toBeDefined();
      } else {
        expect(schema, id).toBeUndefined();
      }
    }
  });

  it('describes chip authentication as what the server can verify (C51.1)', () => {
    expect(definition('id_nfc_chip_authentication_detection').description).toBe(
      'Verifies Active Authentication over a server nonce; chip authentication is not verifiable on the server.',
    );
    expect(definition('business_website_malicious_website_detection').description).not.toMatch(
      /CC0|URLhaus|Safe Browsing/,
    );
  });

  it('keeps PLAN §4.3 in step with the registry, one row per check (C51.1)', () => {
    const rows = section43Rows();
    expect(rows.map((row) => row.id)).toEqual(SECTION_4_3.map(([id]) => id));
    for (const [id, verificationType, tier, alternateTier, checkType] of SECTION_4_3) {
      expect(
        rows.find((row) => row.id === id),
        id,
      ).toEqual({ id, verificationType, tier, alternateTier, checkType });
    }
  });

  it('makes face covering a user behaviour check, so the user gets a retry hint (C39.1)', () => {
    expect(definition('selfie_face_covering_detection')).toMatchObject({
      checkType: 'user_behavior',
      tier: 'H',
      stage: 'beta',
    });
  });

  it('says in its description that the background check is advisory only (C39.1)', () => {
    expect(definition('selfie_similar_background_detection').description).toMatch(
      /advisory only; do not require it/i,
    );
  });

  it('never requires a check that is disabled by default', () => {
    for (const check of CHECK_REGISTRY) {
      if (check.defaultRequired) {
        expect(check.defaultEnabled, check.id).toBe(true);
      }
    }
  });

  it('validates every definition against the schema', () => {
    for (const check of CHECK_REGISTRY) {
      expect(checkDefinitionSchema.safeParse(check).success, check.id).toBe(true);
    }
  });

  it('describes every check in its own words, without third-party branding', () => {
    for (const check of CHECK_REGISTRY) {
      expect(check.description.length, check.id).toBeGreaterThan(10);
      expect(check.description, check.id).not.toMatch(/persona/i);
    }
  });

  it('is immutable', () => {
    expect(Object.isFrozen(CHECK_REGISTRY)).toBe(true);
    for (const check of CHECK_REGISTRY) {
      expect(Object.isFrozen(check), check.id).toBe(true);
    }
  });

  it('has checks for every verification type', () => {
    for (const verificationType of VERIFICATION_TYPES) {
      expect(listChecks(verificationType).length, verificationType).toBeGreaterThan(0);
    }
  });
});

describe('honesty metadata of every §4 check (C29.1, ADR 0002 §2)', () => {
  const allIds = () => [
    ...governmentIdRows.map((row) => row.id),
    ...selfieRows.map((row) => row.id),
    ...SECTION_4_3.map(([id]) => id),
  ];

  it('gives every §4 check an id, tier, type, stage, version, modelBased and inputs', () => {
    for (const id of allIds()) {
      const check = definition(id);
      expect(check.id).toBe(id);
      expect(['R', 'H', 'A'], id).toContain(check.tier);
      expect(['user_behavior', 'fraud'], id).toContain(check.checkType);
      expect(['ga', 'beta'], id).toContain(check.stage);
      expect(check.version, id).toBe(VERSION_2.has(id) ? 2 : 1);
      expect(typeof check.modelBased, id).toBe('boolean');
      expect(check.inputs.length, id).toBeGreaterThan(0);
    }
  });

  it('marks exactly the checks a learned model can decide as model-based', () => {
    const modelBased = CHECK_REGISTRY.filter((check) => check.modelBased).map((check) => check.id);
    expect([...modelBased].sort()).toEqual([...MODEL_BASED].sort());
  });

  it('derives beta for H, A/H, H/A and model-based checks', () => {
    for (const check of CHECK_REGISTRY) {
      if (check.tier === 'H' || check.alternateTier === 'H' || check.modelBased) {
        expect(check.stage, check.id).toBe('beta');
      }
    }
    // Four Phase 1 checks that were ga are model-based, so beta until a calibration report.
    for (const id of [
      'id_portrait_detection',
      'selfie_image_quality_detection',
      'selfie_multiple_faces_detection',
      'selfie_id_comparison',
    ]) {
      expect(definition(id).stage, id).toBe('beta');
    }
  });

  it('lists the inputs of every §4.1 check, in CHECK_INPUTS order', () => {
    expect(Object.keys(GOVERNMENT_ID_INPUTS).sort()).toEqual(
      governmentIdRows.map((row) => row.id).sort(),
    );
    for (const [id, inputs] of Object.entries(GOVERNMENT_ID_INPUTS)) {
      expect(definition(id).inputs, id).toEqual(inputs);
    }
  });

  it('lists the inputs of every §4.3 check (C51.1)', () => {
    expect(Object.keys(PHASE5_INPUTS).sort()).toEqual(Object.keys(PHASE5_DEFAULTS).sort());
    for (const [id, inputs] of Object.entries(PHASE5_INPUTS)) {
      expect(definition(id).inputs, id).toEqual(inputs);
    }
  });

  it('lists the inputs of every §4.2 check (C39.1)', () => {
    expect(Object.keys(SELFIE_INPUTS).sort()).toEqual(selfieRows.map((row) => row.id).sort());
    for (const [id, inputs] of Object.entries(SELFIE_INPUTS)) {
      expect(definition(id).inputs, id).toEqual(inputs);
    }
  });

  it('lists every input once, from CHECK_INPUTS, in its order', () => {
    for (const check of CHECK_REGISTRY) {
      const { inputs } = check;
      expect(new Set(inputs).size, check.id).toBe(inputs.length);
      const positions = inputs.map((input) => CHECK_INPUTS.indexOf(input));
      expect(
        positions.every((position) => position >= 0),
        check.id,
      ).toBe(true);
      expect(positions, check.id).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('names the provider input for every check with an adapter tier', () => {
    for (const check of CHECK_REGISTRY) {
      if (check.tier === 'A' || check.alternateTier === 'A') {
        expect(check.inputs, check.id).toContain('provider');
      }
    }
  });

  it('refuses a definition without version, modelBased or inputs, or with bad values', () => {
    const valid = definition('id_blur_detection');
    for (const field of ['version', 'modelBased', 'inputs'] as const) {
      const rest: Record<string, unknown> = { ...valid };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the field under test
      delete rest[field];
      expect(checkDefinitionSchema.safeParse(rest).success, field).toBe(false);
    }
    for (const patch of [
      { version: 0 },
      { version: 1.5 },
      { modelBased: 'yes' },
      { inputs: [] },
      { inputs: ['camera'] },
      { inputs: ['vision', 'vision'] },
    ]) {
      expect(checkDefinitionSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });
});

describe('registry lookups', () => {
  it('finds a definition by id', () => {
    expect(getCheckDefinition('id_mrz_inconsistency_detection')).toMatchObject({
      id: 'id_mrz_inconsistency_detection',
      verificationType: 'government_id',
      checkType: 'fraud',
      tier: 'R',
    });
  });

  it('returns undefined for unknown ids, including prototype keys', () => {
    expect(getCheckDefinition('id_made_up_detection')).toBeUndefined();
    expect(getCheckDefinition('constructor')).toBeUndefined();
    expect(getCheckDefinition('__proto__')).toBeUndefined();
  });

  it('narrows known ids with isCheckId', () => {
    expect(isCheckId('selfie_liveness_detection')).toBe(true);
    expect(isCheckId('selfie_unknown_detection')).toBe(false);
    expect(isCheckId('toString')).toBe(false);
  });

  it('validates check ids with a schema', () => {
    expect(checkIdSchema.parse('id_expired_detection')).toBe('id_expired_detection');
    expect(checkIdSchema.safeParse('id_unknown').success).toBe(false);
  });

  it('lists the checks of one verification type in registry order', () => {
    const selfie = listChecks('selfie');
    expect(selfie.map((check) => check.id)).toEqual(selfieRows.map((row) => row.id));
    expect(selfie.every((check) => check.verificationType === 'selfie')).toBe(true);
  });

  it('rejects malformed definitions', () => {
    const valid = definition('id_blur_detection');
    expect(checkDefinitionSchema.safeParse({ ...valid, id: 'Id-Blur' }).success).toBe(false);
    expect(checkDefinitionSchema.safeParse({ ...valid, tier: 'X' }).success).toBe(false);
    expect(checkDefinitionSchema.safeParse({ ...valid, description: '' }).success).toBe(false);
    expect(checkDefinitionSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});
