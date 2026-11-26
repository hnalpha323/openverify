import { describe, expect, it } from 'vitest';
import {
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  idAccountComparisonConfigSchema,
  idAgeComparisonConfigSchema,
  idAgeInconsistencyDetectionConfigSchema,
  idBlurDetectionConfigSchema,
  idColorInconsistencyDetectionConfigSchema,
  idDoubleSideDetectionConfigSchema,
  idElectronicReplicaDetectionConfigSchema,
  idEntityDetectionConfigSchema,
  idExpiredDetectionConfigSchema,
  idExtractedPropertiesDetectionConfigSchema,
  idFabricationDetectionConfigSchema,
  idGlareDetectionConfigSchema,
  idHandwritingDetectionConfigSchema,
  idInconsistentRepeatDetectionConfigSchema,
  idInquiryComparisonConfigSchema,
  idNfcExpiredDetectionConfigSchema,
  idPortraitClarityDetectionConfigSchema,
  idRealIdDetectionConfigSchema,
  idRepeatDetectionConfigSchema,
  idSelfieComparisonConfigSchema,
  idTamperDetectionConfigSchema,
  idUnprocessableSubmissionDetectionConfigSchema,
  idValidDatesDetectionConfigSchema,
  selfieAccountComparisonConfigSchema,
  selfieAgeComparisonConfigSchema,
  selfieFaceCoveringDetectionConfigSchema,
  selfieGlareDetectionConfigSchema,
  selfieGlassesDetectionConfigSchema,
  selfieIdComparisonConfigSchema,
  selfieImageQualityDetectionConfigSchema,
  selfieLivenessDetectionConfigSchema,
  selfieMultipleFacesDetectionConfigSchema,
  selfiePoseDetectionConfigSchema,
  selfiePoseRepeatDetectionConfigSchema,
  selfieRepeatDetectionConfigSchema,
  selfieSimilarBackgroundDetectionConfigSchema,
  selfieSuspiciousEntityDetectionConfigSchema,
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
  idNfcPassiveAuthenticationDetectionConfigSchema,
  idNfcRepeatDetectionConfigSchema,
  idNfcSelfieComparisonConfigSchema,
} from './check-config.js';
import { CHECK_REGISTRY, checkDefinitionSchema, getCheckDefinition } from './check-registry.js';
import type { CheckResult } from './check-result.js';
import {
  decideVerification,
  verificationTemplateConfigSchema,
  type VerificationTemplateConfig,
} from './decision-engine.js';

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

/** C29.5: every check with a threshold or an option, and its registry schema. */
const SCHEMAS = {
  id_unprocessable_submission_detection: idUnprocessableSubmissionDetectionConfigSchema,
  id_blur_detection: idBlurDetectionConfigSchema,
  id_glare_detection: idGlareDetectionConfigSchema,
  id_double_side_detection: idDoubleSideDetectionConfigSchema,
  id_portrait_clarity_detection: idPortraitClarityDetectionConfigSchema,
  id_extracted_properties_detection: idExtractedPropertiesDetectionConfigSchema,
  id_expired_detection: idExpiredDetectionConfigSchema,
  id_valid_dates_detection: idValidDatesDetectionConfigSchema,
  id_age_comparison: idAgeComparisonConfigSchema,
  id_age_inconsistency_detection: idAgeInconsistencyDetectionConfigSchema,
  id_real_id_detection: idRealIdDetectionConfigSchema,
  id_color_inconsistency_detection: idColorInconsistencyDetectionConfigSchema,
  id_electronic_replica_detection: idElectronicReplicaDetectionConfigSchema,
  id_tamper_detection: idTamperDetectionConfigSchema,
  id_fabrication_detection: idFabricationDetectionConfigSchema,
  id_handwriting_detection: idHandwritingDetectionConfigSchema,
  id_entity_detection: idEntityDetectionConfigSchema,
  id_repeat_detection: idRepeatDetectionConfigSchema,
  id_inconsistent_repeat_detection: idInconsistentRepeatDetectionConfigSchema,
  id_account_comparison: idAccountComparisonConfigSchema,
  id_inquiry_comparison: idInquiryComparisonConfigSchema,
  id_selfie_comparison: idSelfieComparisonConfigSchema,
  id_nfc_expired_detection: idNfcExpiredDetectionConfigSchema,
  selfie_image_quality_detection: selfieImageQualityDetectionConfigSchema,
  // C39.3: every selfie check with a threshold.
  selfie_glare_detection: selfieGlareDetectionConfigSchema,
  selfie_pose_detection: selfiePoseDetectionConfigSchema,
  selfie_multiple_faces_detection: selfieMultipleFacesDetectionConfigSchema,
  selfie_liveness_detection: selfieLivenessDetectionConfigSchema,
  selfie_pose_repeat_detection: selfiePoseRepeatDetectionConfigSchema,
  selfie_id_comparison: selfieIdComparisonConfigSchema,
  selfie_account_comparison: selfieAccountComparisonConfigSchema,
  selfie_repeat_detection: selfieRepeatDetectionConfigSchema,
  selfie_similar_background_detection: selfieSimilarBackgroundDetectionConfigSchema,
  selfie_face_covering_detection: selfieFaceCoveringDetectionConfigSchema,
  selfie_glasses_detection: selfieGlassesDetectionConfigSchema,
  selfie_age_comparison: selfieAgeComparisonConfigSchema,
  selfie_suspicious_entity_detection: selfieSuspiciousEntityDetectionConfigSchema,
  // C51.3: the Phase 5 checks with a threshold or an option, from their area modules.
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
  database_business_identity_comparison: databaseBusinessIdentityComparisonConfigSchema,
  database_business_active_business_detection: databaseBusinessActiveBusinessDetectionConfigSchema,
  database_business_associated_persons_comparison:
    databaseBusinessAssociatedPersonsComparisonConfigSchema,
  business_website_domain_age_detection: businessWebsiteDomainAgeDetectionConfigSchema,
  business_website_backlink_detection: businessWebsiteBacklinkDetectionConfigSchema,
  crypto_wallet_validity_detection: cryptoWalletValidityDetectionConfigSchema,
  crypto_wallet_address_comparison: cryptoWalletAddressComparisonConfigSchema,
  email_address_disposable_detection: emailAddressDisposableDetectionConfigSchema,
  id_nfc_passive_authentication_detection: idNfcPassiveAuthenticationDetectionConfigSchema,
  id_nfc_chip_authentication_detection: idNfcChipAuthenticationDetectionConfigSchema,
  id_nfc_selfie_comparison: idNfcSelfieComparisonConfigSchema,
  id_nfc_repeat_detection: idNfcRepeatDetectionConfigSchema,
} as const;

const H_TIER_KEYS = {
  id_color_inconsistency_detection: 'max-color-inconsistency-score',
  id_electronic_replica_detection: 'max-electronic-replica-score',
  id_tamper_detection: 'max-tamper-score',
  id_fabrication_detection: 'max-fabrication-score',
  id_handwriting_detection: 'max-handwriting-score',
  id_entity_detection: 'max-entity-score',
} as const;

describe('per-check config schemas (C11, C29.5)', () => {
  it('exist for exactly the checks with a threshold or an option, in registry order', () => {
    expect(
      CHECK_REGISTRY.filter((check) => check.configSchema !== undefined).map((check) => check.id),
    ).toEqual(Object.keys(SCHEMAS));
    for (const [id, schema] of Object.entries(SCHEMAS)) {
      expect(getCheckDefinition(id)?.configSchema, id).toBe(schema);
    }
    expect(getCheckDefinition('id_blur_detection')?.configSchema).toBe(idBlurDetectionConfigSchema);
    expect(getCheckDefinition('id_glare_detection')?.configSchema).toBe(
      idGlareDetectionConfigSchema,
    );
    expect(getCheckDefinition('selfie_image_quality_detection')?.configSchema).toBe(
      selfieImageQualityDetectionConfigSchema,
    );
    expect(getCheckDefinition('selfie_id_comparison')?.configSchema).toBe(
      selfieIdComparisonConfigSchema,
    );
  });

  it('leave the checks without a threshold or an option without config', () => {
    for (const id of [
      'id_portrait_detection',
      'id_mrz_detection',
      'id_mrz_inconsistency_detection',
      'id_disallowed_country_detection',
      'id_compromised_detection',
      'selfie_public_figure_detection',
    ]) {
      expect(getCheckDefinition(id)?.configSchema, id).toBeUndefined();
    }
  });

  it('keep every definition valid against the definition schema', () => {
    for (const check of CHECK_REGISTRY) {
      expect(checkDefinitionSchema.safeParse(check).success, check.id).toBe(true);
    }
    const blur = getCheckDefinition('id_blur_detection');
    expect(checkDefinitionSchema.safeParse({ ...blur, configSchema: 'nope' }).success).toBe(false);
  });

  it('bound id_blur_detection min-blur-score to 10-1000', () => {
    expect(accepts(idBlurDetectionConfigSchema, { 'min-blur-score': 10 })).toBe(true);
    expect(accepts(idBlurDetectionConfigSchema, { 'min-blur-score': 1000 })).toBe(true);
    expect(accepts(idBlurDetectionConfigSchema, { 'min-blur-score': 9.99 })).toBe(false);
    expect(accepts(idBlurDetectionConfigSchema, { 'min-blur-score': 1000.5 })).toBe(false);
    expect(accepts(idBlurDetectionConfigSchema, { 'min-blur-score': '100' })).toBe(false);
    expect(accepts(idBlurDetectionConfigSchema, { minBlurScore: 100 })).toBe(false);
    expect(accepts(idBlurDetectionConfigSchema, {})).toBe(true);
  });

  it('bound id_glare_detection max-glare-ratio to 0.001-0.5', () => {
    expect(accepts(idGlareDetectionConfigSchema, { 'max-glare-ratio': 0.001 })).toBe(true);
    expect(accepts(idGlareDetectionConfigSchema, { 'max-glare-ratio': 0.5 })).toBe(true);
    expect(accepts(idGlareDetectionConfigSchema, { 'max-glare-ratio': 0 })).toBe(false);
    expect(accepts(idGlareDetectionConfigSchema, { 'max-glare-ratio': 0.51 })).toBe(false);
    expect(accepts(idGlareDetectionConfigSchema, { 'max-glare-ratio': Number.NaN })).toBe(false);
  });

  it('bound selfie_image_quality_detection blur and brightness, with min below max', () => {
    const schema = selfieImageQualityDetectionConfigSchema;
    expect(
      accepts(schema, { 'min-blur-score': 50, 'min-brightness': 0.2, 'max-brightness': 0.8 }),
    ).toBe(true);
    expect(accepts(schema, { 'min-brightness': 0 })).toBe(true);
    expect(accepts(schema, { 'max-brightness': 1 })).toBe(true);
    expect(accepts(schema, { 'min-blur-score': 5 })).toBe(false);
    expect(accepts(schema, { 'min-brightness': -0.1 })).toBe(false);
    expect(accepts(schema, { 'max-brightness': 1.1 })).toBe(false);
    const inverted = schema.safeParse({ 'min-brightness': 0.8, 'max-brightness': 0.8 });
    expect(inverted.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['max-brightness']);
  });

  it('bound selfie_id_comparison threshold to 0.25-0.6', () => {
    expect(accepts(selfieIdComparisonConfigSchema, { threshold: 0.25 })).toBe(true);
    expect(accepts(selfieIdComparisonConfigSchema, { threshold: 0.6 })).toBe(true);
    expect(accepts(selfieIdComparisonConfigSchema, { threshold: 0.2 })).toBe(false);
    expect(accepts(selfieIdComparisonConfigSchema, { threshold: 0.61 })).toBe(false);
  });
});

describe('the Phase 3 government ID config keys (C29.5)', () => {
  it('accept an empty config and refuse unknown or camelCase keys', () => {
    for (const [id, schema] of Object.entries(SCHEMAS)) {
      if (id !== 'id_age_comparison') {
        expect(accepts(schema, {}), id).toBe(true);
      }
      expect(accepts(schema, { 'not-a-key': 1 }), id).toBe(false);
    }
    expect(accepts(idExpiredDetectionConfigSchema, { graceDays: 1 })).toBe(false);
  });

  it.each([
    ['min-text-lines', 0, 50, [-1, 51, 2.5], idUnprocessableSubmissionDetectionConfigSchema],
    ['min-document-blur-score', 1, 5000, [0, 5001], idBlurDetectionConfigSchema],
    ['min-document-tenengrad', 1, 100_000, [0, 100_001], idBlurDetectionConfigSchema],
    ['min-document-width-px', 100, 4000, [99, 4001, 500.5], idBlurDetectionConfigSchema],
    ['max-document-glare-ratio', 0.001, 0.5, [0, 0.51], idGlareDetectionConfigSchema],
    ['min-front-back-phash-distance', 1, 32, [0, 33, 1.5], idDoubleSideDetectionConfigSchema],
    ['min-face-width-px', 16, 1000, [15, 1001], idPortraitClarityDetectionConfigSchema],
    ['min-sharpness', 1, 10_000, [0, 10_001], idPortraitClarityDetectionConfigSchema],
    ['min-landmarks-score', 0, 1, [-0.1, 1.1], idPortraitClarityDetectionConfigSchema],
    ['grace-days', 0, 365, [-1, 366, 1.5], idExpiredDetectionConfigSchema],
    ['grace-days', 0, 365, [-1, 366], idNfcExpiredDetectionConfigSchema],
    ['max-validity-years', 1, 20, [0, 21, 1.5], idValidDatesDetectionConfigSchema],
    ['max-age-difference-years', 1, 50, [0, 51], idAgeInconsistencyDetectionConfigSchema],
    ['min-star-glyph-score', 0, 1, [-0.1, 1.1], idRealIdDetectionConfigSchema],
    ['max-phash-distance', 0, 7, [-1, 8, 2.5], idRepeatDetectionConfigSchema],
    ['face-threshold', 0.25, 0.6, [0.2, 0.61], idInconsistentRepeatDetectionConfigSchema],
    ['name-threshold', 0.5, 1, [0.49, 1.01], idAccountComparisonConfigSchema],
    ['name-threshold', 0.5, 1, [0.49, 1.01], idInquiryComparisonConfigSchema],
    ['threshold', 0.25, 0.6, [0.2, 0.61], idSelfieComparisonConfigSchema],
    ...Object.entries(H_TIER_KEYS).map(
      ([id, key]) => [key, 0, 1, [-0.01, 1.01], SCHEMAS[id as keyof typeof H_TIER_KEYS]] as const,
    ),
  ] as const)('bounds %s to [%d, %d]', (key, min, max, refused, schema) => {
    expect(accepts(schema, { [key]: min })).toBe(true);
    expect(accepts(schema, { [key]: max })).toBe(true);
    for (const value of [...refused, '1', Number.NaN]) {
      expect(accepts(schema, { [key]: value }), `${key}=${String(value)}`).toBe(false);
    }
  });

  it('bound id_age_comparison min-age and max-age to 0-150, at least one, min not above max', () => {
    const schema = idAgeComparisonConfigSchema;
    expect(accepts(schema, { 'min-age': 18 })).toBe(true);
    expect(accepts(schema, { 'max-age': 150 })).toBe(true);
    expect(accepts(schema, { 'min-age': 0, 'max-age': 0 })).toBe(true);
    expect(accepts(schema, {})).toBe(false);
    expect(accepts(schema, { 'min-age': -1 })).toBe(false);
    expect(accepts(schema, { 'max-age': 151 })).toBe(false);
    expect(accepts(schema, { 'min-age': 17.5 })).toBe(false);
    const inverted = schema.safeParse({ 'min-age': 30, 'max-age': 20 });
    expect(inverted.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['min-age']);
  });

  it('take required-fields as a list of distinct C31.5 field names', () => {
    const schema = idExtractedPropertiesDetectionConfigSchema;
    expect(accepts(schema, { 'required-fields': ['birthdate'] })).toBe(true);
    expect(accepts(schema, { 'required-fields': ['name-first', 'address-city'] })).toBe(true);
    expect(accepts(schema, { 'required-fields': [] })).toBe(false);
    expect(accepts(schema, { 'required-fields': ['birthdate', 'birthdate'] })).toBe(false);
    expect(accepts(schema, { 'required-fields': ['date_of_birth'] })).toBe(false);
  });

  it('take the comparison fields as a list of name, birthdate, address and identification-number', () => {
    for (const schema of [idAccountComparisonConfigSchema, idInquiryComparisonConfigSchema]) {
      expect(
        accepts(schema, { fields: ['name', 'birthdate', 'address', 'identification-number'] }),
      ).toBe(true);
      expect(accepts(schema, { fields: ['name'] })).toBe(true);
      expect(accepts(schema, { fields: [] })).toBe(false);
      expect(accepts(schema, { fields: ['name', 'name'] })).toBe(false);
      expect(accepts(schema, { fields: ['email'] })).toBe(false);
    }
  });

  it('give defaults that their own schema accepts, for the checks the plan sets them for', () => {
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS).toMatchObject({
      id_unprocessable_submission_detection: { 'min-text-lines': 3 },
      id_expired_detection: { 'grace-days': 0 },
      id_nfc_expired_detection: { 'grace-days': 0 },
      id_valid_dates_detection: { 'max-validity-years': 15 },
      id_extracted_properties_detection: {
        'required-fields': [
          'name-first',
          'name-last',
          'birthdate',
          'identification-number',
          'expiration-date',
        ],
      },
      id_inquiry_comparison: {
        'name-threshold': 0.88,
        fields: ['name', 'birthdate', 'address', 'identification-number'],
      },
      id_account_comparison: {
        'name-threshold': 0.88,
        fields: ['name', 'birthdate', 'address', 'identification-number'],
      },
      id_selfie_comparison: { threshold: 0.394 },
    });
    for (const [id, key] of Object.entries(H_TIER_KEYS)) {
      expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS[id]?.[key], id).toBeTypeOf('number');
    }
    expect(Object.isFrozen(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS)).toBe(true);
    for (const [id, defaults] of Object.entries(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS)) {
      expect(Object.isFrozen(defaults), id).toBe(true);
      const schema = getCheckDefinition(id)?.configSchema;
      expect(schema, id).toBeDefined();
      if (id !== 'id_age_comparison') {
        expect(schema?.safeParse(defaults).success, id).toBe(true);
      }
    }
  });

  it('take the C36 calibration of docs/calibration/government-id-phase3.md (Workflow 3A Stage 4)', () => {
    // Each is the midpoint between the genuine synthetic cards and the variant built to trip it.
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS).toMatchObject({
      id_glare_detection: { 'max-document-glare-ratio': 0.055 },
      id_double_side_detection: { 'min-front-back-phash-distance': 13 },
      id_color_inconsistency_detection: { 'max-color-inconsistency-score': 0.622 },
      id_electronic_replica_detection: { 'max-electronic-replica-score': 0.418 },
      id_handwriting_detection: { 'max-handwriting-score': 0.383 },
      // No variant lies beyond the genuine cards: the initial value stays, the report says so.
      id_tamper_detection: { 'max-tamper-score': 0.5 },
    });
    // Phase 12A: vision measures the rectified card at 1,000 px over its OCR text boxes, so the
    // document blur score takes docs/calibration/blur-phase12a.md (the geometric mean of the lowest
    // legible and the highest blurred synthetic phone capture). Tenengrad stays template-only: one
    // synthetic design still does not establish the scale of this contrast-dependent measure, and
    // its proposed 8583.33 fails a genuine card of the Phase 3 report.
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection).toEqual({
      'min-document-blur-score': 67.1,
      'min-document-width-px': 616,
    });
    // The whole-image keys keep vision's verdict (shared with the selfie checks, C11).
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection).not.toHaveProperty(
      'min-blur-score',
    );
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_glare_detection).not.toHaveProperty(
      'max-glare-ratio',
    );
  });

  it('leave the pHash half of id_repeat_detection without a default until calibration sets one (C34)', () => {
    expect(
      GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_repeat_detection?.['max-phash-distance'],
    ).toBeUndefined();
  });
});

describe('verificationTemplateConfigSchema v2 (C11)', () => {
  const v1: VerificationTemplateConfig = {
    checks: {
      id_blur_detection: { enabled: true, required: true },
      id_portrait_detection: { enabled: true, required: true },
    },
  };

  function issues(value: unknown): string[] {
    const result = verificationTemplateConfigSchema.safeParse(value);
    return result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  }

  it('still accepts a v1 document unchanged', () => {
    expect(verificationTemplateConfigSchema.parse(v1)).toEqual(v1);
  });

  it('accepts per-check config validated by the check config schema', () => {
    const value = {
      checks: {
        id_blur_detection: { enabled: true, required: true, config: { 'min-blur-score': 150 } },
      },
    };
    expect(verificationTemplateConfigSchema.parse(value)).toEqual(value);
  });

  it('reports an out-of-range config value at its path', () => {
    expect(
      issues({
        checks: {
          id_glare_detection: { enabled: true, required: true, config: { 'max-glare-ratio': 2 } },
        },
      }),
    ).toEqual([expect.stringMatching(/^checks\.id_glare_detection\.config\.max-glare-ratio: /)]);
  });

  it('rejects config for a check that takes none', () => {
    expect(
      issues({
        checks: { id_portrait_detection: { enabled: true, required: true, config: {} } },
      }),
    ).toEqual([
      'checks.id_portrait_detection.config: check "id_portrait_detection" takes no config',
    ]);
    expect(
      issues({ checks: { id_made_up_detection: { enabled: true, required: true, config: {} } } }),
    ).toEqual(['checks.id_made_up_detection.config: check "id_made_up_detection" takes no config']);
  });

  it('rejects a config that is not an object', () => {
    expect(
      issues({ checks: { id_blur_detection: { enabled: true, required: true, config: 5 } } }),
    ).toHaveLength(1);
  });

  it('accepts optional allowed countries and ID classes', () => {
    const value = { ...v1, 'allowed-countries': ['US', 'MX'], 'allowed-id-classes': ['passport'] };
    expect(verificationTemplateConfigSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['a lowercase country', { 'allowed-countries': ['us'] }],
    ['an alpha-3 country', { 'allowed-countries': ['USA'] }],
    ['an empty country list', { 'allowed-countries': [] }],
    ['a duplicate country', { 'allowed-countries': ['US', 'US'] }],
    ['an unknown ID class', { 'allowed-id-classes': ['library_card'] }],
    ['a duplicate ID class', { 'allowed-id-classes': ['visa', 'visa'] }],
    ['an empty ID class list', { 'allowed-id-classes': [] }],
    ['an unknown key', { 'blocked-countries': ['US'] }],
  ])('rejects %s', (_name, change) => {
    expect(verificationTemplateConfigSchema.safeParse({ ...v1, ...change }).success).toBe(false);
  });

  it('lets decideVerification read a v2 config', () => {
    const results: CheckResult[] = [
      {
        name: 'id_blur_detection',
        status: 'passed',
        type: 'user_behavior',
        reasons: [],
        metadata: {},
        stage: 'ga',
        confidence: null,
        provenance: { 'implementation-version': 1, thresholds: { 'min-blur-score': 150 } },
      },
    ];
    const decision = decideVerification(results, {
      checks: {
        id_blur_detection: { enabled: true, required: true, config: { 'min-blur-score': 150 } },
      },
      'allowed-countries': ['US'],
      'allowed-id-classes': ['drivers_license'],
    });
    expect(decision.status).toBe('passed');
  });
});
