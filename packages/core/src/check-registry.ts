import { z } from 'zod';
import {
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
  idNfcChipAuthenticationDetectionConfigSchema,
  idNfcExpiredDetectionConfigSchema,
  idNfcPassiveAuthenticationDetectionConfigSchema,
  idNfcRepeatDetectionConfigSchema,
  idNfcSelfieComparisonConfigSchema,
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
} from './check-config.js';
import {
  CHECK_INPUTS,
  checkCategorySchema,
  checkInputSchema,
  checkStageSchema,
  checkTierSchema,
  checkTypeSchema,
  verificationTypeSchema,
  type CheckCategory,
  type CheckInput,
  type CheckTier,
  type CheckType,
  type VerificationType,
} from './enums.js';

/** snake_case check identifier, e.g. `id_glare_detection`. */
export const checkNameSchema = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a snake_case check id');

export const checkDefinitionSchema = z.strictObject({
  id: checkNameSchema,
  verificationType: verificationTypeSchema,
  checkType: checkTypeSchema,
  /**
   * C50.8: what the check describes, as the public check object names it. The type's category
   * (`user_action_required` or `fraud`) unless {@link CHECK_CATEGORY_OVERRIDES} names a published
   * or decided one; the type, not the category, still drives retry hints.
   */
  category: checkCategorySchema,
  /** Primary implementation tier. */
  tier: checkTierSchema,
  /**
   * Secondary tier for checks PLAN §4 lists with two (`A/H`, `H/A`, `R+A`):
   * for example real matching logic over records from a provider adapter.
   */
  alternateTier: checkTierSchema.optional(),
  /**
   * `beta` for every H, A/H and H/A check and every model-based one (C29.1, ADR 0002 §3f: a
   * model-based check reaches `ga` only with a FAR/FRR calibration report); `ga` otherwise.
   */
  stage: checkStageSchema,
  /** Implementation version, 1 today. A change that can change a decision bumps it (C29.1). */
  version: z.int().min(1),
  /**
   * True when a learned model's output can decide the check: a face detector, landmarks, a face
   * recognizer, an anti-spoofing classifier, an age or deepfake estimator, or OCR reading a
   * text, zone or field. False for deterministic rules over values (check digits, dates,
   * grammars, keyword lists, source agreement, hashes), classical signal processing and
   * classical decoders such as zxing-cpp.
   */
  modelBased: z.boolean(),
  /**
   * The evidence the check needs, in {@link CHECK_INPUTS} order. The worker uses it to decide
   * which checks a failed vision or provider call leaves without evidence (C30.3).
   */
  inputs: z
    .array(checkInputSchema)
    .min(1)
    .refine((inputs) => new Set(inputs).size === inputs.length, 'must not repeat an input')
    .readonly(),
  defaultRequired: z.boolean(),
  defaultEnabled: z.boolean(),
  description: z.string().min(1),
  /**
   * Validates the optional per-template `config` of this check (C11). A check without one
   * takes no config.
   */
  configSchema: z.custom<z.ZodType>((value) => value instanceof z.ZodType).optional(),
});

export type CheckDefinition = z.infer<typeof checkDefinitionSchema>;

type TierSpec = CheckTier | 'A/H' | 'H/A' | 'R+A';

/** How a template's default treats a check (C51.1): required, advisory or disabled. */
export type CheckDefaultRequirement = 'required' | 'advisory' | 'disabled';

/**
 * C51.1: the explicit defaults of every §4.3 check, the seven new ids and the chip expiry check.
 * A check is required when it binds the evidence to the person or the document and needs no
 * unshipped provider; a check whose evidence often cannot be had is advisory; each type keeps an
 * enabled, required check. `defaultTemplateConfig(type)` gives this table, and the contracts'
 * `DEFAULT_<TYPE>_CHECKS` list it again.
 */
export const PHASE5_CHECK_DEFAULTS: Readonly<Record<string, CheckDefaultRequirement>> =
  Object.freeze({
    document_type_detection: 'required',
    document_extracted_properties_detection: 'required',
    document_expired_detection: 'required',
    document_recency_detection: 'required',
    document_fabrication_detection: 'advisory',
    // Decision 16 (H24, V12): a proof-of-address pass means the applicant's name.
    document_name_comparison: 'required',
    document_address_comparison: 'advisory',
    database_identity_comparison: 'required',
    database_name_comparison: 'advisory',
    database_address_comparison: 'advisory',
    database_birthdate_comparison: 'advisory',
    database_inquiry_comparison: 'advisory',
    database_po_box_detection: 'advisory',
    // Without a bound provider it answers provider_not_configured, so the type goes to review.
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
    // Decision 26 (H14): resolution is the website's factual core; domain age is advisory.
    business_website_resolution_detection: 'required',
    business_website_domain_age_detection: 'advisory',
    // The feed list ships empty and no backlink source ships: both need an operator's provider.
    business_website_malicious_website_detection: 'disabled',
    business_website_backlink_detection: 'disabled',
    // C62.6, decisions 33-35: the bindings that stop a copied chip are required.
    id_nfc_passive_authentication_detection: 'required',
    id_nfc_chip_authentication_detection: 'required',
    id_nfc_mrz_comparison: 'required',
    id_nfc_selfie_comparison: 'required',
    id_nfc_repeat_detection: 'advisory',
    id_nfc_expired_detection: 'required',
  });

/** C50.8: a published category that differs from the one the check type gives, with its source. */
export interface CheckCategoryOverride {
  readonly category: CheckCategory;
  readonly source: string;
}

function override(category: CheckCategory, source: string): CheckCategoryOverride {
  return Object.freeze({ category, source });
}

/**
 * C50.8: every check whose category is not its type's, with the research table or plan decision
 * it comes from. Every other check is `user_action_required` (user behaviour) or `fraud`.
 */
export const CHECK_CATEGORY_OVERRIDES: Readonly<Record<string, CheckCategoryOverride>> =
  Object.freeze({
    selfie_pose_detection: override(
      'fraud',
      'docs/research/phase4-selfie-behaviour.md §3: fraud in all 11 published examples',
    ),
    document_type_detection: override(
      'validity',
      'docs/research/phase5-behaviour.md §4.5 (D1): the document checks are validity',
    ),
    document_extracted_properties_detection: override(
      'validity',
      'docs/research/phase5-behaviour.md §4.5 (D2): the document checks are validity',
    ),
    document_expired_detection: override(
      'validity',
      'docs/research/phase5-behaviour.md §4.5 (D3): the document checks are validity',
    ),
    document_recency_detection: override(
      'validity',
      'C50.8: the recency window is a document validity check (its public category is not published)',
    ),
    document_name_comparison: override(
      'fraud',
      'decision 16 (V12): user behaviour so a bill in another name can be replaced, still a fraud signal',
    ),
    crypto_wallet_validity_detection: override(
      'fraud',
      'docs/research/phase5-behaviour.md §8 (W1): every crypto wallet check is fraud',
    ),
    crypto_wallet_address_comparison: override(
      'fraud',
      'docs/research/phase5-behaviour.md §8 and decision 21: user behaviour, since a retry still needs the key',
    ),
  });

const UB: CheckType = 'user_behavior';
const F: CheckType = 'fraud';

/**
 * Real-tier checks that stay advisory by default: the §4.1 checks that encode an operator policy
 * choice, and the selfie checks C39.1 and C45.1 keep advisory (glare, pose repeat until real
 * captures calibrate planarity, the account and repeat comparisons, and the background check).
 */
const OPTIONAL_BY_DEFAULT = new Set([
  'id_po_box_detection',
  'id_real_id_detection',
  'selfie_glare_detection',
  'selfie_pose_repeat_detection',
  'selfie_account_comparison',
  'selfie_repeat_detection',
  'selfie_similar_background_detection',
]);

/** What a registry entry declares beyond its id, type, tier and description. */
interface CheckSpec {
  /** The evidence the check needs (C29.1). */
  inputs: readonly CheckInput[];
  /** A learned model's output can decide the check (C29.1); defaults to false. */
  modelBased?: boolean;
  /** Defaults to 1. */
  version?: number;
  /** Validates the template's per-check `config` (C11, C29.5). */
  configSchema?: z.ZodType;
}

/**
 * The registry defaults of a check: the C51.1 table for Phase 5 checks; otherwise adapter-first
 * (A) checks are disabled until a provider is configured, and real (R) checks are required except
 * the policy-only ones.
 */
function defaultsOf(
  id: string,
  tier: CheckTier,
): Pick<CheckDefinition, 'defaultRequired' | 'defaultEnabled'> {
  if (Object.hasOwn(PHASE5_CHECK_DEFAULTS, id)) {
    const requirement = PHASE5_CHECK_DEFAULTS[id];
    return {
      defaultRequired: requirement === 'required',
      defaultEnabled: requirement !== 'disabled',
    };
  }
  return {
    defaultRequired: tier === 'R' && !OPTIONAL_BY_DEFAULT.has(id),
    defaultEnabled: tier !== 'A',
  };
}

/**
 * Builds a frozen definition. Defaults follow PLAN §4, CLAUDE.md and C29.1:
 * - stage is `beta` whenever a heuristic (H) is involved or the check is model-based,
 *   otherwise `ga`;
 * - adapter-first (A) checks are disabled until a provider is configured;
 * - heuristic-first (H) checks are enabled but advisory (not required);
 * - real (R) checks are enabled and required, except policy-only checks.
 */
function defineCheck<const Id extends string>(
  id: Id,
  verificationType: VerificationType,
  checkType: CheckType,
  tierSpec: TierSpec,
  description: string,
  spec: CheckSpec,
): Readonly<CheckDefinition & { id: Id }> {
  const [tier, alternateTier] = tierSpec.split(/[/+]/) as [CheckTier, CheckTier?];
  const heuristic = tier === 'H' || alternateTier === 'H';
  const modelBased = spec.modelBased ?? false;
  const definition: CheckDefinition & { id: Id } = {
    id,
    verificationType,
    checkType,
    category: Object.hasOwn(CHECK_CATEGORY_OVERRIDES, id)
      ? (CHECK_CATEGORY_OVERRIDES[id]?.category ?? 'fraud')
      : checkType === 'user_behavior'
        ? 'user_action_required'
        : 'fraud',
    tier,
    stage: heuristic || modelBased ? 'beta' : 'ga',
    version: spec.version ?? 1,
    modelBased,
    inputs: Object.freeze(CHECK_INPUTS.filter((input) => spec.inputs.includes(input))),
    ...defaultsOf(id, tier),
    description,
  };
  if (alternateTier) {
    definition.alternateTier = alternateTier;
  }
  if (spec.configSchema) {
    definition.configSchema = spec.configSchema;
  }
  return Object.freeze(definition);
}

// C29.1 inputs, shared by many entries.
const UPLOAD_VISION: readonly CheckInput[] = ['upload', 'vision'];
const VISION_EXTRACTION: readonly CheckInput[] = ['vision', 'extraction'];
const EXTRACTION: readonly CheckInput[] = ['extraction'];
const UPLOAD: readonly CheckInput[] = ['upload'];
const UPLOAD_PROVIDER: readonly CheckInput[] = ['upload', 'provider'];
const EXTRACTION_HISTORY: readonly CheckInput[] = ['extraction', 'history'];

const GOV = 'government_id';
const NFC = 'government_id_nfc';
const SELFIE = 'selfie';
const DOC = 'document';
const DB = 'database';
const AAMVA = 'aamva';
const BIZ = 'database_business';
const WEBSITE = 'business_website';
const CRYPTO = 'crypto_wallet';

/** Every check in PLAN §4.1, §4.2 and §4.3. Descriptions are OpenVerify's own. */
export const CHECK_REGISTRY = Object.freeze([
  // §4.1 Government ID
  defineCheck(
    'id_unprocessable_submission_detection',
    GOV,
    UB,
    'R',
    'Detects submissions that are not a readable identity document: no document outline, too little text or no portrait.',
    {
      inputs: UPLOAD_VISION,
      modelBased: true,
      configSchema: idUnprocessableSubmissionDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_blur_detection',
    GOV,
    UB,
    'R',
    'Detects ID images too blurry to read, using Laplacian variance and Tenengrad sharpness on the rectified crop.',
    { inputs: UPLOAD_VISION, configSchema: idBlurDetectionConfigSchema },
  ),
  defineCheck(
    'id_glare_detection',
    GOV,
    UB,
    'R',
    'Detects specular glare covering text or the portrait on the ID.',
    { inputs: UPLOAD_VISION, configSchema: idGlareDetectionConfigSchema },
  ),
  defineCheck(
    'id_double_side_detection',
    GOV,
    UB,
    'R',
    'Verifies the back image differs from the front and carries the expected barcode or MRZ.',
    {
      inputs: ['upload', 'vision', 'extraction'],
      modelBased: true,
      configSchema: idDoubleSideDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_portrait_detection',
    GOV,
    F,
    'R',
    'Verifies a face portrait is present on the front of the ID.',
    { inputs: UPLOAD_VISION, modelBased: true },
  ),
  defineCheck(
    'id_portrait_clarity_detection',
    GOV,
    UB,
    'R',
    'Verifies the ID portrait is large, sharp and unobstructed enough to compare.',
    {
      inputs: UPLOAD_VISION,
      modelBased: true,
      configSchema: idPortraitClarityDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_mrz_detection',
    GOV,
    UB,
    'R',
    'Locates and reads the machine-readable zone (TD1, TD2, TD3 or visa formats).',
    { inputs: ['upload', 'vision', 'extraction'], modelBased: true },
  ),
  defineCheck(
    'id_mrz_inconsistency_detection',
    GOV,
    F,
    'R',
    'Validates ICAO 9303 check digits and compares MRZ fields with the visual inspection zone.',
    { inputs: EXTRACTION },
  ),
  defineCheck('id_barcode_detection', GOV, UB, 'R', 'Locates and decodes the PDF417 barcode.', {
    inputs: ['upload', 'vision', 'extraction'],
  }),
  defineCheck(
    'id_barcode_inconsistency_detection',
    GOV,
    F,
    'R',
    'Validates the AAMVA barcode structure and compares barcode fields with the front of the ID.',
    { inputs: EXTRACTION },
  ),
  defineCheck(
    'id_extracted_properties_detection',
    GOV,
    UB,
    'R',
    'Verifies the configured required fields were extracted from the ID.',
    {
      inputs: EXTRACTION,
      modelBased: true,
      configSchema: idExtractedPropertiesDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_extraction_inconsistency_detection',
    GOV,
    F,
    'R',
    'Compares the same field across sources: visual zone, MRZ, barcode and NFC chip.',
    { inputs: EXTRACTION },
  ),
  defineCheck(
    'id_number_format_inconsistency_detection',
    GOV,
    F,
    'R',
    "Validates the ID number against the issuing jurisdiction's number format and checksum.",
    { inputs: EXTRACTION },
  ),
  defineCheck(
    'id_expired_detection',
    GOV,
    F,
    'R',
    'Flags IDs past their expiration date, with a configurable grace period.',
    { inputs: EXTRACTION, configSchema: idExpiredDetectionConfigSchema },
  ),
  defineCheck(
    'id_valid_dates_detection',
    GOV,
    F,
    'R',
    'Verifies birth, issue and expiration dates are real calendar dates in a plausible order.',
    { inputs: EXTRACTION, configSchema: idValidDatesDetectionConfigSchema },
  ),
  defineCheck(
    'id_age_comparison',
    GOV,
    F,
    'R',
    "Compares the holder's age, derived from the date of birth, with the template's minimum and maximum.",
    { inputs: EXTRACTION, configSchema: idAgeComparisonConfigSchema },
  ),
  defineCheck(
    'id_age_inconsistency_detection',
    GOV,
    F,
    'A/H',
    'Compares the apparent age of the portrait with the date of birth, using a pluggable age estimator.',
    {
      inputs: ['vision', 'extraction', 'provider'],
      modelBased: true,
      configSchema: idAgeInconsistencyDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_disallowed_country_detection',
    GOV,
    F,
    'R',
    'Flags IDs whose issuing country the template does not allow.',
    { inputs: EXTRACTION },
  ),
  defineCheck(
    'id_disallowed_type_detection',
    GOV,
    F,
    'R',
    'Flags ID classes the template does not allow.',
    { inputs: EXTRACTION },
  ),
  defineCheck(
    'id_po_box_detection',
    GOV,
    F,
    'R',
    'Flags addresses that are PO boxes, military mail or mail-drop addresses.',
    { inputs: EXTRACTION },
  ),
  defineCheck(
    'id_real_id_detection',
    GOV,
    F,
    'R',
    "Detects whether a US driver's license or ID card is REAL ID compliant.",
    { inputs: VISION_EXTRACTION, configSchema: idRealIdDetectionConfigSchema },
  ),
  defineCheck(
    'id_color_inconsistency_detection',
    GOV,
    F,
    'H',
    'Detects grayscale or photocopied IDs and abnormal regional colour casts.',
    { inputs: UPLOAD_VISION, configSchema: idColorInconsistencyDetectionConfigSchema },
  ),
  defineCheck(
    'id_electronic_replica_detection',
    GOV,
    F,
    'H',
    'Detects IDs photographed from a screen through moire, pixel-grid and bezel cues.',
    { inputs: UPLOAD_VISION, configSchema: idElectronicReplicaDetectionConfigSchema },
  ),
  defineCheck(
    'id_tamper_detection',
    GOV,
    F,
    'H',
    'Detects digital edits: editing-software metadata, error-level anomalies, double compression and copy-move regions.',
    { inputs: UPLOAD_VISION, configSchema: idTamperDetectionConfigSchema },
  ),
  defineCheck(
    'id_fabrication_detection',
    GOV,
    F,
    'H',
    'Scores how well layout, field positions and fonts conform to the expected document template.',
    {
      inputs: VISION_EXTRACTION,
      modelBased: true,
      configSchema: idFabricationDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_handwriting_detection',
    GOV,
    F,
    'H',
    'Detects handwritten alterations in printed fields.',
    {
      inputs: VISION_EXTRACTION,
      modelBased: true,
      configSchema: idHandwritingDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_compromised_detection',
    GOV,
    F,
    'R',
    'Flags specimen or sample documents and ID numbers on compromised lists.',
    { inputs: VISION_EXTRACTION },
  ),
  defineCheck(
    'id_entity_detection',
    GOV,
    F,
    'H',
    'Aggregates fraud signals into a composite confidence score, with reasons, that the ID is genuine.',
    { inputs: VISION_EXTRACTION, configSchema: idEntityDetectionConfigSchema },
  ),
  defineCheck(
    'id_repeat_detection',
    GOV,
    F,
    'R',
    'Flags an ID image or ID number already used by another account.',
    { inputs: ['extraction', 'history'], configSchema: idRepeatDetectionConfigSchema },
  ),
  defineCheck(
    'id_inconsistent_repeat_detection',
    GOV,
    F,
    'R',
    'Flags an ID number seen before with a different name, birth date or face.',
    {
      inputs: ['vision', 'extraction', 'history'],
      modelBased: true,
      configSchema: idInconsistentRepeatDetectionConfigSchema,
    },
  ),
  defineCheck(
    'id_account_comparison',
    GOV,
    F,
    'R',
    "Compares the identity extracted from the ID with the account's fields.",
    { inputs: EXTRACTION, configSchema: idAccountComparisonConfigSchema },
  ),
  defineCheck(
    'id_inquiry_comparison',
    GOV,
    F,
    'R',
    'Compares the identity extracted from the ID with the data the user entered.',
    { inputs: EXTRACTION, configSchema: idInquiryComparisonConfigSchema },
  ),
  defineCheck(
    'id_selfie_comparison',
    GOV,
    F,
    'R',
    'Compares the ID portrait with the selfie using calibrated face-embedding similarity.',
    {
      inputs: ['vision', 'history'],
      modelBased: true,
      // C39.1: Phase 4 changes the selfie it selects and where its threshold comes from.
      version: 2,
      configSchema: idSelfieComparisonConfigSchema,
    },
  ),
  defineCheck(
    'id_public_figure_detection',
    GOV,
    F,
    'A',
    'Matches the ID portrait against an operator-supplied gallery of public figures.',
    { inputs: ['vision', 'provider'], modelBased: true },
  ),
  defineCheck(
    'id_aamva_database_lookup',
    GOV,
    F,
    'A',
    "Validates US driver's license data against the AAMVA DLDV service through an adapter, with a sandbox provider.",
    { inputs: ['extraction', 'provider'] },
  ),
  defineCheck(
    'id_nfc_expired_detection',
    NFC,
    F,
    'R',
    'Flags documents whose expiration date, read from chip data group DG1, has passed.',
    { inputs: UPLOAD, configSchema: idNfcExpiredDetectionConfigSchema },
  ),

  // §4.2 Selfie. C39.1: version 2 for the four checks whose behaviour Phase 4 changes (image
  // quality, multiple faces, the ID comparison and face covering); version 1 for the eleven
  // first implemented in Phase 4.
  defineCheck(
    'selfie_image_quality_detection',
    SELFIE,
    UB,
    'R',
    'Checks selfie brightness, sharpness, face size and resolution.',
    {
      inputs: UPLOAD_VISION,
      modelBased: true,
      version: 2,
      configSchema: selfieImageQualityDetectionConfigSchema,
    },
  ),
  defineCheck(
    'selfie_glare_detection',
    SELFIE,
    UB,
    'R',
    'Detects glare on the face in the selfie.',
    { inputs: UPLOAD_VISION, modelBased: true, configSchema: selfieGlareDetectionConfigSchema },
  ),
  defineCheck(
    'selfie_pose_detection',
    SELFIE,
    UB,
    'R',
    'Verifies each requested head pose (center, left, right) was captured correctly.',
    { inputs: UPLOAD_VISION, modelBased: true, configSchema: selfiePoseDetectionConfigSchema },
  ),
  defineCheck(
    'selfie_multiple_faces_detection',
    SELFIE,
    F,
    'R',
    'Flags selfies containing more than one face.',
    {
      inputs: UPLOAD_VISION,
      modelBased: true,
      version: 2,
      configSchema: selfieMultipleFacesDetectionConfigSchema,
    },
  ),
  defineCheck(
    'selfie_liveness_detection',
    SELFIE,
    F,
    'R',
    'Detects presentation attacks with passive anti-spoofing, an active pose challenge and capture-integrity signals.',
    { inputs: UPLOAD_VISION, modelBased: true, configSchema: selfieLivenessDetectionConfigSchema },
  ),
  defineCheck(
    'selfie_pose_repeat_detection',
    SELFIE,
    F,
    'R',
    'Flags pose frames too similar to each other, which suggests a static replay.',
    {
      inputs: UPLOAD_VISION,
      modelBased: true,
      configSchema: selfiePoseRepeatDetectionConfigSchema,
    },
  ),
  defineCheck(
    'selfie_id_comparison',
    SELFIE,
    F,
    'R',
    'Compares the selfie with the ID portrait using face-embedding similarity.',
    {
      inputs: ['vision', 'history'],
      modelBased: true,
      version: 2,
      configSchema: selfieIdComparisonConfigSchema,
    },
  ),
  defineCheck(
    'selfie_account_comparison',
    SELFIE,
    F,
    'R',
    "Compares the selfie with the account's previous selfies.",
    {
      inputs: ['vision', 'history'],
      modelBased: true,
      configSchema: selfieAccountComparisonConfigSchema,
    },
  ),
  defineCheck(
    'selfie_repeat_detection',
    SELFIE,
    F,
    'R',
    'Flags the same face appearing on different accounts.',
    {
      inputs: ['vision', 'history'],
      modelBased: true,
      configSchema: selfieRepeatDetectionConfigSchema,
    },
  ),
  defineCheck(
    'selfie_similar_background_detection',
    SELFIE,
    F,
    'R',
    'Flags selfie backgrounds reused with different faces, a fraud-farm signal. Advisory only; do not require it: shared backdrops are common and virtual backgrounds defeat it.',
    {
      inputs: ['vision', 'history'],
      modelBased: true,
      configSchema: selfieSimilarBackgroundDetectionConfigSchema,
    },
  ),
  defineCheck(
    'selfie_face_covering_detection',
    SELFIE,
    // C39.1: user behaviour, since the user can remove a covering and should get a retry hint.
    UB,
    'H',
    'Detects masks or other coverings hiding the lower face.',
    {
      inputs: UPLOAD_VISION,
      modelBased: true,
      version: 2,
      configSchema: selfieFaceCoveringDetectionConfigSchema,
    },
  ),
  defineCheck(
    'selfie_glasses_detection',
    SELFIE,
    UB,
    'H',
    'Detects glasses that may hinder face comparison.',
    { inputs: UPLOAD_VISION, modelBased: true, configSchema: selfieGlassesDetectionConfigSchema },
  ),
  defineCheck(
    'selfie_age_comparison',
    SELFIE,
    F,
    'A/H',
    'Compares the apparent age in the selfie with the template limits, using a pluggable age estimator.',
    {
      inputs: ['upload', 'vision', 'provider'],
      modelBased: true,
      configSchema: selfieAgeComparisonConfigSchema,
    },
  ),
  defineCheck(
    'selfie_public_figure_detection',
    SELFIE,
    F,
    'A',
    'Matches the selfie against an operator-supplied gallery of public figures.',
    { inputs: ['vision', 'provider'], modelBased: true },
  ),
  defineCheck(
    'selfie_suspicious_entity_detection',
    SELFIE,
    F,
    'H/A',
    'Detects synthetic, deepfake or masked faces: a frequency-artifact heuristic by default, with an optional detector adapter.',
    {
      inputs: ['upload', 'vision', 'provider'],
      modelBased: true,
      configSchema: selfieSuspiciousEntityDetectionConfigSchema,
    },
  ),

  // §4.3 (C51.1). Every entry is at version 1: first implemented in Phase 5. Their defaults come
  // from PHASE5_CHECK_DEFAULTS, their categories from the type or CHECK_CATEGORY_OVERRIDES.

  // §4.3 Document and proof of address
  defineCheck(
    'document_type_detection',
    DOC,
    UB,
    'R',
    'Classifies the supporting document from its visible text and layout (utility bill, bank statement, lease, pay stub or tax document) and refuses a class the step does not accept; an unrecognised document goes to review.',
    { inputs: UPLOAD_VISION, modelBased: true, configSchema: documentTypeDetectionConfigSchema },
  ),
  defineCheck(
    'document_extracted_properties_detection',
    DOC,
    UB,
    'R',
    "Verifies the configured properties (name, address, issue date, issuer) were read from the document's visible text.",
    {
      inputs: VISION_EXTRACTION,
      modelBased: true,
      configSchema: documentExtractedPropertiesDetectionConfigSchema,
    },
  ),
  defineCheck(
    'document_expired_detection',
    DOC,
    UB,
    'R',
    'Flags a document whose printed expiry date or lease end date has passed; classes without an expiry are not applicable.',
    { inputs: EXTRACTION, configSchema: documentExpiredDetectionConfigSchema },
  ),
  defineCheck(
    'document_recency_detection',
    DOC,
    UB,
    'R',
    'Verifies the document is recent: issued within the configured window (90 days by default), a lease covering today, or a tax document issued within 18 months.',
    { inputs: EXTRACTION, configSchema: documentRecencyDetectionConfigSchema },
  ),
  defineCheck(
    'document_fabrication_detection',
    DOC,
    F,
    'H',
    'Scores signs of an edited or fabricated document from PDF structure (incremental edits, editor producers, hidden text, edits after a signature) and image forensics, with a confidence.',
    { inputs: UPLOAD_VISION, configSchema: documentFabricationDetectionConfigSchema },
  ),
  defineCheck(
    'document_name_comparison',
    DOC,
    UB,
    'R',
    "Compares the name on the document with the inquiry's fields, else its latest government ID, else the account; a document in another name can be replaced.",
    { inputs: EXTRACTION_HISTORY, configSchema: documentNameComparisonConfigSchema },
  ),
  defineCheck(
    'document_address_comparison',
    DOC,
    F,
    'R',
    "Compares the address on the document with the inquiry's fields, else its latest government ID, else the account.",
    { inputs: EXTRACTION_HISTORY, configSchema: documentAddressComparisonConfigSchema },
  ),

  // §4.3 Database
  defineCheck(
    'database_identity_comparison',
    DB,
    F,
    'R+A',
    'Matches the submitted identity with the database record through match groups: passes when any group is met, fails only when every group is unmet, and otherwise goes to review.',
    { inputs: UPLOAD_PROVIDER, configSchema: databaseIdentityComparisonConfigSchema },
  ),
  defineCheck(
    'database_name_comparison',
    DB,
    F,
    'R+A',
    'Compares the submitted name with the database record, allowing nicknames, initials and swapped name order at a partial level.',
    { inputs: UPLOAD_PROVIDER, configSchema: databaseNameComparisonConfigSchema },
  ),
  defineCheck(
    'database_address_comparison',
    DB,
    F,
    'R+A',
    'Compares the submitted address with the database record after normalising its components.',
    { inputs: UPLOAD_PROVIDER, configSchema: databaseAddressComparisonConfigSchema },
  ),
  defineCheck(
    'database_birthdate_comparison',
    DB,
    F,
    'R+A',
    'Compares the submitted birth date, including partial and transposed dates, with the database record.',
    { inputs: UPLOAD_PROVIDER, configSchema: databaseBirthdateComparisonConfigSchema },
  ),
  defineCheck(
    'database_inquiry_comparison',
    DB,
    F,
    'R',
    'Compares the values submitted to the database with the ones the inquiry already held.',
    { inputs: ['upload', 'history'], configSchema: databaseInquiryComparisonConfigSchema },
  ),
  defineCheck(
    'database_po_box_detection',
    DB,
    UB,
    'R',
    'Flags a submitted address that is a PO box, an APO/FPO address or a commercial mail receiving agency.',
    { inputs: UPLOAD },
  ),

  // §4.3 AAMVA
  defineCheck(
    'aamva_identity_comparison',
    AAMVA,
    F,
    'A',
    "Compares the licence or ID card details with the issuing jurisdiction's record through an AAMVA adapter, with a sandbox provider; any mismatched field fails it.",
    { inputs: UPLOAD_PROVIDER, configSchema: aamvaIdentityComparisonConfigSchema },
  ),
  defineCheck(
    'aamva_name_comparison',
    AAMVA,
    F,
    'A',
    "Compares the submitted first and last names with the jurisdiction's record through an AAMVA adapter, with a sandbox provider.",
    { inputs: UPLOAD_PROVIDER },
  ),
  defineCheck(
    'aamva_identification_number_comparison',
    AAMVA,
    F,
    'A',
    "Compares the submitted licence number with the jurisdiction's record through an AAMVA adapter, with a sandbox provider.",
    { inputs: UPLOAD_PROVIDER },
  ),

  // §4.3 Business registry
  defineCheck(
    'database_business_identity_comparison',
    BIZ,
    F,
    'R+A',
    'Matches the submitted business with business registry records (GLEIF, Companies House, SEC EDGAR) through match groups over the legal and other names, the registration number and the address.',
    { inputs: UPLOAD_PROVIDER, configSchema: databaseBusinessIdentityComparisonConfigSchema },
  ),
  defineCheck(
    'database_business_active_business_detection',
    BIZ,
    F,
    'R+A',
    'Verifies the registry record shows the business as active; a lapsed LEI goes to review unless configured to fail.',
    {
      inputs: UPLOAD_PROVIDER,
      configSchema: databaseBusinessActiveBusinessDetectionConfigSchema,
    },
  ),
  defineCheck(
    'database_business_associated_persons_comparison',
    BIZ,
    F,
    'R+A',
    'Verifies each submitted associated person matches an active officer or person with significant control on the registry record.',
    {
      inputs: UPLOAD_PROVIDER,
      configSchema: databaseBusinessAssociatedPersonsComparisonConfigSchema,
    },
  ),
  defineCheck(
    'database_business_enabled_country_detection',
    BIZ,
    UB,
    'R',
    "Verifies the business's country is one the template allows.",
    { inputs: UPLOAD },
  ),
  defineCheck(
    'database_business_service_available_detection',
    BIZ,
    UB,
    'R',
    "Verifies a configured registry covered the business's country and answered.",
    { inputs: UPLOAD_PROVIDER },
  ),

  // §4.3 Business website
  defineCheck(
    'business_website_resolution_detection',
    WEBSITE,
    UB,
    'R',
    "Verifies the website's host name resolves to a public address in DNS; the site itself is never fetched.",
    { inputs: UPLOAD_PROVIDER },
  ),
  defineCheck(
    'business_website_domain_age_detection',
    WEBSITE,
    F,
    'R',
    'Flags a website whose registered domain is younger than the configured age, from RDAP registration dates; subdomains of a platform are not aged.',
    { inputs: UPLOAD_PROVIDER, configSchema: businessWebsiteDomainAgeDetectionConfigSchema },
  ),
  defineCheck(
    'business_website_malicious_website_detection',
    WEBSITE,
    F,
    'A',
    'Flags a website listed for malware, phishing or spam on operator-configured threat feeds, through an adapter with a sandbox provider.',
    { inputs: UPLOAD_PROVIDER },
  ),
  defineCheck(
    'business_website_backlink_detection',
    WEBSITE,
    F,
    'A',
    "Assesses the website's backlink count against a threshold through an adapter, with a sandbox provider.",
    { inputs: UPLOAD_PROVIDER, configSchema: businessWebsiteBacklinkDetectionConfigSchema },
  ),

  // §4.3 Crypto wallet
  defineCheck(
    'crypto_wallet_validity_detection',
    CRYPTO,
    UB,
    'R',
    'Validates the wallet address format and checksum for its chain (base58check, bech32 and bech32m, EIP-55, Solana, TRON, XRP).',
    { inputs: UPLOAD, configSchema: cryptoWalletValidityDetectionConfigSchema },
  ),
  defineCheck(
    'crypto_wallet_disallowed_chain_detection',
    CRYPTO,
    F,
    'R',
    "Flags a wallet on a chain outside the template's allowed chains.",
    { inputs: UPLOAD },
  ),
  defineCheck(
    'crypto_wallet_address_comparison',
    CRYPTO,
    UB,
    'R+A',
    'Verifies the signature over our single-use challenge proves control of the claimed address; contract wallets are checked through an RPC adapter.',
    {
      inputs: UPLOAD_PROVIDER,
      configSchema: cryptoWalletAddressComparisonConfigSchema,
    },
  ),
  defineCheck(
    'crypto_wallet_statement_comparison',
    CRYPTO,
    F,
    'R',
    'Verifies the verified signature covers exactly the challenge text we issued.',
    { inputs: UPLOAD },
  ),

  // §4.3 Contact
  defineCheck(
    'phone_number_otp_comparison',
    'phone_number',
    UB,
    'R',
    'Verifies the one-time code sent by SMS to the phone number was entered, within the attempt, expiry and send limits.',
    { inputs: UPLOAD },
  ),
  defineCheck(
    'email_address_otp_comparison',
    'email_address',
    UB,
    'R',
    'Verifies the one-time code sent to the email address was entered, within the attempt, expiry and send limits.',
    { inputs: UPLOAD },
  ),
  defineCheck(
    'email_address_disposable_detection',
    'email_address',
    F,
    'R',
    'Flags an email address whose domain, or a parent of it, is on a disposable-email list.',
    { inputs: UPLOAD, configSchema: emailAddressDisposableDetectionConfigSchema },
  ),
  defineCheck(
    'email_address_mx_detection',
    'email_address',
    UB,
    'R',
    'Verifies the email domain exists and accepts mail: an MX record, or an address record when it has none.',
    { inputs: UPLOAD_PROVIDER },
  ),

  // §4.3 NFC chip (id_nfc_expired_detection is a §4.1 row)
  defineCheck(
    'id_nfc_passive_authentication_detection',
    NFC,
    F,
    'R',
    'Re-verifies on the server that the chip data was signed by its issuer: data-group hashes, the SOD signature and the document signer to CSCA chain against the trust store, with revocation.',
    { inputs: UPLOAD, configSchema: idNfcPassiveAuthenticationDetectionConfigSchema },
  ),
  defineCheck(
    'id_nfc_chip_authentication_detection',
    NFC,
    F,
    'R',
    'Verifies Active Authentication over a server nonce; chip authentication is not verifiable on the server.',
    { inputs: UPLOAD, configSchema: idNfcChipAuthenticationDetectionConfigSchema },
  ),
  defineCheck(
    'id_nfc_mrz_comparison',
    NFC,
    F,
    'R',
    'Compares chip data group DG1 with the MRZ printed on the photographed document.',
    { inputs: ['upload', 'history'] },
  ),
  defineCheck(
    'id_nfc_selfie_comparison',
    NFC,
    F,
    'R',
    "Compares the chip portrait (DG2) with the inquiry's live selfie.",
    {
      inputs: ['upload', 'vision', 'history'],
      modelBased: true,
      configSchema: idNfcSelfieComparisonConfigSchema,
    },
  ),
  defineCheck(
    'id_nfc_repeat_detection',
    NFC,
    F,
    'R',
    "Records earlier selfie-bound reads of the same chip's signed data on other accounts; review-level unless configured to fail.",
    { inputs: ['upload', 'history'], configSchema: idNfcRepeatDetectionConfigSchema },
  ),
]);

export type CheckId = (typeof CHECK_REGISTRY)[number]['id'];

export const CHECK_IDS: readonly CheckId[] = Object.freeze(CHECK_REGISTRY.map((check) => check.id));

export const checkIdSchema = z.enum(CHECK_IDS as [CheckId, ...CheckId[]]);

const BY_ID: ReadonlyMap<string, CheckDefinition> = new Map(
  CHECK_REGISTRY.map((check) => [check.id, check]),
);

export function isCheckId(id: string): id is CheckId {
  return BY_ID.has(id);
}

export function getCheckDefinition(id: string): CheckDefinition | undefined {
  return BY_ID.get(id);
}

/** Checks belonging to one verification type, in registry order. */
export function listChecks(verificationType: VerificationType): CheckDefinition[] {
  return CHECK_REGISTRY.filter((check) => check.verificationType === verificationType);
}

/**
 * C150.2 (review H03; Phase 9): the reasons a `not_applicable` result carries when the check could
 * not run: an execution error, a missing input, and an unbound provider. Every `*_unavailable`
 * reason (a list, a feed, a provider or a store that did not answer) is one too, matched by its
 * suffix so a new outage reason needs no change here. A flow route reads such a check as `null`,
 * never as "not failed", and analytics counts it as errored or not configured (C163.3).
 */
export const CHECK_ERROR_REASONS = Object.freeze([
  'execution_error',
  'input_missing',
  'provider_not_configured',
] as const);
export type CheckErrorReason = (typeof CHECK_ERROR_REASONS)[number];

/** Every reason ending in this is an outage (C150.2). */
export const CHECK_UNAVAILABLE_REASON_SUFFIX = '_unavailable';

/**
 * How a check result's reasons class it (C150.2, C163.3): `not_configured` when its only error
 * reason is `provider_not_configured`, `errored` for any other error reason, `null` for none.
 */
export function checkErrorClassOf(reasons: readonly string[]): 'errored' | 'not_configured' | null {
  const errors = reasons.filter(
    (reason) =>
      (CHECK_ERROR_REASONS as readonly string[]).includes(reason) ||
      reason.endsWith(CHECK_UNAVAILABLE_REASON_SUFFIX),
  );
  if (errors.length === 0) {
    return null;
  }
  return errors.every((reason) => reason === 'provider_not_configured')
    ? 'not_configured'
    : 'errored';
}
