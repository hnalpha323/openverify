/**
 * Per-check configuration (contracts C11 and C29.5): optional thresholds and options a template
 * sets on a check, validated by the check's registry `configSchema`. Keys are kebab-case; values
 * are in the units of the vision service's raw scores. A key a template leaves out takes the
 * default of {@link GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS}, or, for the Phase 1 whole-image keys
 * (`min-blur-score`, `max-glare-ratio`), the vision service's own verdict.
 *
 * The defaults come from the C36 calibration report, `docs/calibration/government-id-phase3.md`
 * (written by `packages/checks/scripts/calibration-report.ts`): each calibrated key is the midpoint
 * between the genuine synthetic cards and the variant built to trip it. They are calibrated on
 * synthetic fixtures only, so every heuristic stays beta (ADR 0002 §3f).
 */
import { z } from 'zod';
import {
  FACE_MATCH_DEFAULTS,
  type CheckConfigDefault,
  type ConfigDefault,
  type ThresholdBasis,
} from './check-config/basis.js';
import { BUSINESS_CHECK_CONFIG_DEFAULTS } from './check-config/business.js';
import { CONTACT_CHECK_CONFIG_DEFAULTS } from './check-config/contact.js';
import { CRYPTO_WALLET_CHECK_CONFIG_DEFAULTS } from './check-config/crypto-wallet.js';
import { DATABASE_CHECK_CONFIG_DEFAULTS } from './check-config/database.js';
import { DOCUMENT_CHECK_CONFIG_DEFAULTS } from './check-config/document.js';
import { NFC_CHECK_CONFIG_DEFAULTS } from './check-config/nfc.js';
import { extractionFieldSchema } from './extraction.js';

export {
  FACE_MATCH_DEFAULTS,
  THRESHOLD_BASES,
  thresholdBasisSchema,
  type CheckConfigDefault,
  type ConfigDefault,
  type ThresholdBasis,
} from './check-config/basis.js';

/** Laplacian variance below which an image counts as blurry (vision default 100). */
const blurScore = z.number().min(10).max(1000);
/** Mean luminance on the 0-1 scale (vision defaults 0.15 and 0.9). */
const brightness = z.number().min(0).max(1);

export const idBlurDetectionConfigSchema = z.strictObject({
  /** Whole image, as in Phase 1: Laplacian variance (vision default 100). */
  'min-blur-score': blurScore.optional(),
  /** Laplacian variance of the rectified document (C32.1 `document_quality.blur_score`). */
  'min-document-blur-score': z.number().min(1).max(5000).optional(),
  /** Mean squared Sobel gradient of the rectified document (`document_quality.tenengrad`). */
  'min-document-tenengrad': z.number().min(1).max(100_000).optional(),
  /** Width of the rectified document in pixels (`document_quality.width_px`). */
  'min-document-width-px': z.int().min(100).max(4000).optional(),
  /**
   * Phase 12A C9: the OCR median confidence at which a side the document measure calls blurry
   * (within half of each threshold) is still legible (default 0.9).
   */
  'legible-text-min-confidence': z.number().min(0).max(1).optional(),
  /** Phase 12A C9: the fewest OCR lines that legibility needs (default 8). */
  'legible-text-min-lines': z.int().min(1).max(100).optional(),
});
export type IdBlurDetectionConfig = z.infer<typeof idBlurDetectionConfigSchema>;

export const idGlareDetectionConfigSchema = z.strictObject({
  /** Largest share of glare pixels allowed in the whole image (vision default 0.05). */
  'max-glare-ratio': z.number().min(0.001).max(0.5).optional(),
  /** Largest share of glare in the text and portrait regions of the rectified document. */
  'max-document-glare-ratio': z.number().min(0.001).max(0.5).optional(),
});
export type IdGlareDetectionConfig = z.infer<typeof idGlareDetectionConfigSchema>;

export const selfieImageQualityDetectionConfigSchema = z
  .strictObject({
    /** Phase 1, on the centre's whole image (vision's verdict applies when unset). */
    'min-blur-score': blurScore.optional(),
    'min-brightness': brightness.optional(),
    'max-brightness': brightness.optional(),
    /** C39.3, every pose: Laplacian variance of the face region resized to 112 pixels wide. */
    'min-face-blur-score': z.number().min(1).max(10_000).optional(),
    /** C39.3, centre: the face box width in image pixels. */
    'min-face-width-px': z.int().min(16).max(1000).optional(),
    /** C39.3, centre: the face box height over the image height. */
    'min-face-height-ratio': z.number().min(0.01).max(1).optional(),
    /** C39.3, centre: the image's short side in EXIF-upright pixels. */
    'min-image-short-side-px': z.int().min(120).max(4000).optional(),
  })
  .refine(
    (config) =>
      config['min-brightness'] === undefined ||
      config['max-brightness'] === undefined ||
      config['min-brightness'] < config['max-brightness'],
    { message: 'max-brightness must be above min-brightness', path: ['max-brightness'] },
  );
export type SelfieImageQualityDetectionConfig = z.infer<
  typeof selfieImageQualityDetectionConfigSchema
>;

/** Cosine similarity at or above which two SFace embeddings match ({@link FACE_MATCH_DEFAULTS}). */
const faceThreshold = z.number().min(0.25).max(0.6);

export const selfieIdComparisonConfigSchema = z.strictObject({
  /** Cosine similarity at or above which the faces match ({@link FACE_MATCH_DEFAULTS}). */
  threshold: faceThreshold.optional(),
});
export type SelfieIdComparisonConfig = z.infer<typeof selfieIdComparisonConfigSchema>;

// Phase 3 government ID checks (C29.5) ---------------------------------------------------------

const unit = z.number().min(0).max(1);
const graceDays = z.int().min(0).max(365);

function distinct<Item extends z.ZodType>(item: Item) {
  return z
    .array(item)
    .min(1)
    .refine((values) => new Set(values).size === values.length, 'must not contain duplicates');
}

/** A heuristic (H-tier) check's decision threshold: the score above which it fails. */
const heuristic = (key: string) => z.strictObject({ [key]: unit.optional() });

export const idUnprocessableSubmissionDetectionConfigSchema = z.strictObject({
  /** OCR lines the front must show, unless it carries an MRZ or a barcode. */
  'min-text-lines': z.int().min(0).max(50).optional(),
});

export const idDoubleSideDetectionConfigSchema = z.strictObject({
  /** Fewest differing pHash bits between front and back; closer means the front reused (C32.2). */
  'min-front-back-phash-distance': z.int().min(1).max(32).optional(),
});

export const idPortraitClarityDetectionConfigSchema = z.strictObject({
  /** Face box width in upload pixels. */
  'min-face-width-px': z.number().min(16).max(1000).optional(),
  /** Laplacian variance of the grey face crop at SFace width. */
  'min-sharpness': z.number().min(1).max(10_000).optional(),
  /** The face landmark score, low when the face is partly hidden. */
  'min-landmarks-score': unit.optional(),
});

/** What a missing required field does (Phase 12A C6): fail the check, or send it to review. */
export const MISSING_FIELDS_OUTCOMES = ['fail', 'review'] as const;

export const idExtractedPropertiesDetectionConfigSchema = z.strictObject({
  /** C31.5 fields the extraction must hold. */
  'required-fields': distinct(extractionFieldSchema).optional(),
  /**
   * `fail` (the default): a missing required field fails the check, retryable. `review`: the check
   * answers `not_applicable` with `required_fields_missing`, which the decision engine sends to
   * manual review (C30.1), so the inquiry is not failed for a field OCR could not read.
   */
  'missing-fields-outcome': z.enum(MISSING_FIELDS_OUTCOMES).optional(),
});

export const idExpiredDetectionConfigSchema = z.strictObject({
  /** Days after expiry during which the document is still accepted. */
  'grace-days': graceDays.optional(),
});

export const idValidDatesDetectionConfigSchema = z.strictObject({
  /** Longest plausible span from issue to expiry. */
  'max-validity-years': z.int().min(1).max(20).optional(),
});

/** At least one limit when the check is enabled with config (C29.5). */
export const idAgeComparisonConfigSchema = z
  .strictObject({
    'min-age': z.int().min(0).max(150).optional(),
    'max-age': z.int().min(0).max(150).optional(),
  })
  .refine((value) => value['min-age'] !== undefined || value['max-age'] !== undefined, {
    message: 'set min-age, max-age or both',
  })
  .refine(
    (value) =>
      value['min-age'] === undefined ||
      value['max-age'] === undefined ||
      value['min-age'] <= value['max-age'],
    { message: 'min-age must not exceed max-age', path: ['min-age'] },
  );

export const idAgeInconsistencyDetectionConfigSchema = z.strictObject({
  /** Largest gap between the apparent age and the age from the birth date. */
  'max-age-difference-years': z.int().min(1).max(50).optional(),
});

export const idRealIdDetectionConfigSchema = z.strictObject({
  /** Score of the REAL ID star template match at or above which the star counts as found. */
  'min-star-glyph-score': unit.optional(),
});

export const idColorInconsistencyDetectionConfigSchema = heuristic('max-color-inconsistency-score');
export const idElectronicReplicaDetectionConfigSchema = heuristic('max-electronic-replica-score');
export const idTamperDetectionConfigSchema = heuristic('max-tamper-score');
export const idFabricationDetectionConfigSchema = heuristic('max-fabrication-score');
export const idHandwritingDetectionConfigSchema = heuristic('max-handwriting-score');
export const idEntityDetectionConfigSchema = heuristic('max-entity-score');

export const idRepeatDetectionConfigSchema = z.strictObject({
  /** Most differing pHash bits for two fronts to count as one image (C34); unset disables it. */
  'max-phash-distance': z.int().min(0).max(7).optional(),
});

export const idInconsistentRepeatDetectionConfigSchema = z.strictObject({
  /** Cosine similarity at or above which an earlier portrait shows the same face. */
  'face-threshold': faceThreshold.optional(),
});

/** What the inquiry and account comparisons compare (C34). */
export const COMPARISON_FIELDS = ['name', 'birthdate', 'address', 'identification-number'] as const;

const comparison = () =>
  z.strictObject({
    /** Jaro-Winkler per name token at or above which two names agree. */
    'name-threshold': z.number().min(0.5).max(1).optional(),
    fields: distinct(z.enum(COMPARISON_FIELDS)).optional(),
  });
export const idAccountComparisonConfigSchema = comparison();
export const idInquiryComparisonConfigSchema = comparison();

export const idSelfieComparisonConfigSchema = z.strictObject({
  threshold: faceThreshold.optional(),
});

const frozen = <T extends Record<string, CheckConfigDefault>>(value: T): Readonly<T> =>
  Object.freeze(value);

/**
 * The defaults of the Phase 3 government ID check keys, by check (C29.5). A key without a default
 * here is applied only when a template sets it: `min-blur-score` and `max-glare-ratio` (vision's
 * verdict applies instead; the calibration report judges vision's 100 and 0.05 too),
 * `min-document-tenengrad` (the blur score already separates the blurred card, and one synthetic
 * design does not establish the scale of this contrast-dependent measure; the Phase 3 report
 * proposes 5471, docs/calibration/blur-phase12a.md 8583.33 on its own scale), the age limits,
 * and `max-phash-distance` (the pHash half of `id_repeat_detection` ships disabled: no distance
 * separates re-encodings of one card from distinct cards of the design, C34).
 *
 * Calibrated (Workflow 3A Stage 4, generator version 5): `min-document-width-px`,
 * `max-document-glare-ratio`, `min-front-back-phash-distance`, `max-color-inconsistency-score`,
 * `max-electronic-replica-score` and `max-handwriting-score`. `max-tamper-score` keeps its initial
 * 0.5: no tampered variant lies beyond the genuine cards. The other keys have no variant built to
 * trip them, so they keep their initial values; the report shows the genuine range of each.
 *
 * Phase 12A: vision measures document blur on the rectified card at 1,000 px over its OCR text
 * boxes, so `min-document-blur-score` takes docs/calibration/blur-phase12a.md (67.1: synthetic
 * Quebec-format phone captures; a beta value).
 */
export const GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS: Readonly<
  Record<string, Readonly<Record<string, CheckConfigDefault>>>
> = Object.freeze({
  id_unprocessable_submission_detection: frozen({ 'min-text-lines': 3 }),
  id_blur_detection: frozen({
    'min-document-blur-score': 67.1,
    'min-document-width-px': 616,
  }),
  id_glare_detection: frozen({ 'max-document-glare-ratio': 0.055 }),
  id_double_side_detection: frozen({ 'min-front-back-phash-distance': 13 }),
  id_portrait_clarity_detection: frozen({
    'min-face-width-px': 64,
    'min-sharpness': 15,
    'min-landmarks-score': 0.5,
  }),
  id_extracted_properties_detection: frozen({
    'required-fields': Object.freeze([
      'name-first',
      'name-last',
      'birthdate',
      'identification-number',
      'expiration-date',
    ]),
    'missing-fields-outcome': 'fail',
  }),
  id_expired_detection: frozen({ 'grace-days': 0 }),
  // The NFC module owns the value (C51.3); kept here for the government ID readers.
  id_nfc_expired_detection: frozen({
    'grace-days': NFC_CHECK_CONFIG_DEFAULTS.id_nfc_expired_detection?.['grace-days']?.value ?? 0,
  }),
  id_valid_dates_detection: frozen({ 'max-validity-years': 15 }),
  id_age_inconsistency_detection: frozen({ 'max-age-difference-years': 10 }),
  id_real_id_detection: frozen({ 'min-star-glyph-score': 0.5 }),
  id_color_inconsistency_detection: frozen({ 'max-color-inconsistency-score': 0.622 }),
  id_electronic_replica_detection: frozen({ 'max-electronic-replica-score': 0.418 }),
  id_tamper_detection: frozen({ 'max-tamper-score': 0.5 }),
  id_fabrication_detection: frozen({ 'max-fabrication-score': 0.5 }),
  id_handwriting_detection: frozen({ 'max-handwriting-score': 0.383 }),
  id_entity_detection: frozen({ 'max-entity-score': 0.5 }),
  id_repeat_detection: frozen({}),
  id_inconsistent_repeat_detection: frozen({ 'face-threshold': FACE_MATCH_DEFAULTS.threshold }),
  id_account_comparison: frozen({
    'name-threshold': 0.88,
    fields: Object.freeze([...COMPARISON_FIELDS]),
  }),
  id_inquiry_comparison: frozen({
    'name-threshold': 0.88,
    fields: Object.freeze([...COMPARISON_FIELDS]),
  }),
  id_selfie_comparison: frozen({ threshold: FACE_MATCH_DEFAULTS.threshold }),
});

// Phase 4 selfie checks (C39.3) -------------------------------------------------------------------

const unitScore = z.number().min(0).max(1);
/** A 1:1 cosine threshold (SFace). */
const oneToOneThreshold = z.number().min(0.25).max(0.6);

export const selfieGlareDetectionConfigSchema = z.strictObject({
  /** Largest share of saturated pixels in the centre face region without the eyes (C41.1). */
  'max-face-glare-ratio': z.number().min(0.001).max(0.5).optional(),
});

export const selfiePoseDetectionConfigSchema = z.strictObject({
  /** Largest `|yaw_ratio|` of a frontal centre pose (C40.11). */
  'max-center-yaw-ratio': z.number().min(0.01).max(1).optional(),
  /** Smallest change of `yaw_ratio` from the centre pose for a side pose, in its direction. */
  'min-side-yaw-ratio-change': z.number().min(0.01).max(2).optional(),
});

export const selfieMultipleFacesDetectionConfigSchema = z.strictObject({
  /** Smallest box area of a second face, as a share of the primary face's, that counts. */
  'min-secondary-face-area-ratio': unitScore.optional(),
});

export const selfieLivenessDetectionConfigSchema = z.strictObject({
  /** The centre's mean P(real) of the MiniFASNet ensemble at or above which it passes. */
  'min-passive-score': unitScore.optional(),
  /** Smallest SFace cosine of a side pose to the centre (the same person throughout). */
  'min-side-identity-cosine': unitScore.optional(),
});

export const selfiePoseRepeatDetectionConfigSchema = z.strictObject({
  /** Median homography residual, as a share of face width, below which motion is planar. */
  'min-planarity-residual': z.number().min(0).max(0.1).optional(),
  /** Fewest tracked face points for planarity to count. */
  'min-tracked-points': z.int().min(4).max(500).optional(),
  /** SFace cosine of a side pose to the centre at or above which the frames are the same. */
  'max-pose-cosine': z.number().min(0.5).max(1).optional(),
});

export const selfieAccountComparisonConfigSchema = z.strictObject({
  threshold: oneToOneThreshold.optional(),
});

export const selfieRepeatDetectionConfigSchema = z.strictObject({
  /** A 1:N cosine threshold, never below the 1:1 one; false matches grow with the gallery. */
  threshold: z.number().min(FACE_MATCH_DEFAULTS.threshold).max(0.95).optional(),
});

export const selfieSimilarBackgroundDetectionConfigSchema = z.strictObject({
  /** Fewest ORB + RANSAC inliers on background pixels for a candidate to match. */
  'min-orb-inliers': z.int().min(4).max(5000).optional(),
  /** Smallest share of good ORB matches that are RANSAC inliers. */
  'min-inlier-ratio': unitScore.optional(),
  /** How far back candidates are searched. */
  'window-days': z.int().min(1).max(365).optional(),
  /** Fewest distinct verified faces seen with the same background. */
  'min-distinct-faces': z.int().min(1).max(50).optional(),
  /** Smallest share of valid background cells for the check to be measured. */
  'min-coverage': unitScore.optional(),
});

export const selfieFaceCoveringDetectionConfigSchema = heuristic('max-face-covering-score');
export const selfieGlassesDetectionConfigSchema = heuristic('max-glasses-score');
export const selfieSuspiciousEntityDetectionConfigSchema = heuristic('max-synthetic-face-score');

/** The provider's age estimate against the limits and the compared ID's birthdate (C43). */
export const selfieAgeComparisonConfigSchema = z
  .strictObject({
    'min-age': z.int().min(0).max(150).optional(),
    'max-age': z.int().min(0).max(150).optional(),
    /** Years the estimate may lie beyond a limit or the birthdate age before it fails. */
    'buffer-years': z.int().min(0).max(10).optional(),
  })
  .refine(
    (value) =>
      value['min-age'] === undefined ||
      value['max-age'] === undefined ||
      value['min-age'] <= value['max-age'],
    { message: 'min-age must not exceed max-age', path: ['min-age'] },
  );

const provisional = (value: CheckConfigDefault, source: string): ConfigDefault =>
  Object.freeze({ value, basis: 'provisional', source });

const faceMatch: ConfigDefault = Object.freeze({
  value: FACE_MATCH_DEFAULTS.threshold,
  basis: FACE_MATCH_DEFAULTS.basis,
  source: FACE_MATCH_DEFAULTS.source,
});

const MIDPOINT =
  'the midpoint of the 0-1 score, as the Phase 3 H-tier initial values; not fitted to fixtures';

/**
 * The defaults of the §4.2 selfie check keys, each with its basis and source (C39.3). Every one
 * is `provisional`: principled, from the research or an upstream decision point, never fitted
 * to our fixtures (if a fixture fails one, the generator changes, never the threshold). Only
 * the shared face-match threshold may become `calibrated` in Phase 4 (C49). A key without a
 * default here applies only when a template sets it: the Phase 1 whole-image keys (vision's
 * verdict applies instead) and the age limits. The pose keys come from the C40.11 measurement
 * (`contracts/fixtures/flow/selfie-capture.json`).
 */
export const SELFIE_CHECK_CONFIG_DEFAULTS: Readonly<
  Record<string, Readonly<Record<string, ConfigDefault>>>
> = Object.freeze({
  selfie_image_quality_detection: Object.freeze({
    'min-face-blur-score': provisional(
      15,
      "the same measure and default as id_portrait_clarity_detection's min-sharpness: Laplacian variance of the face at SFace's 112 px width (C29.5)",
    ),
    'min-face-width-px': provisional(
      64,
      'the face width id_portrait_clarity_detection requires of a face embedded with the same model (C29.5)',
    ),
    'min-face-height-ratio': provisional(
      0.2,
      'half the normal selfie framing, where the face is about 40% of the frame height (research §3)',
    ),
    'min-image-short-side-px': provisional(
      480,
      'VGA, the smallest frame the C40.11 capture protocol uses (640x480)',
    ),
  }),
  selfie_glare_detection: Object.freeze({
    'max-face-glare-ratio': provisional(
      0.05,
      "the vision service's whole-image glare default (0.05), applied to the face region without the eyes",
    ),
  }),
  // C40.11: measured on re-posed public-domain faces (contracts/fixtures/flow/selfie-capture.json).
  selfie_pose_detection: Object.freeze({
    'max-center-yaw-ratio': provisional(
      0.021,
      'C40.11 anchor: the median |yaw_ratio| YuNet reads for a 5 degree re-posed turn of the public-domain faces (selfie-capture.json)',
    ),
    'min-side-yaw-ratio-change': provisional(
      0.077,
      'C40.11 anchor: the median yaw-ratio change YuNet reads for a 12 degree re-posed turn of the public-domain faces (selfie-capture.json)',
    ),
  }),
  selfie_multiple_faces_detection: Object.freeze({
    'min-secondary-face-area-ratio': provisional(
      0.25,
      'C39.3: a quarter of the primary face area, so distant bystanders and posters do not count',
    ),
  }),
  selfie_liveness_detection: Object.freeze({
    'min-passive-score': provisional(
      0.5,
      "the upstream MiniFASNet ensemble's own decision point: argmax of the mean softmax (research §3)",
    ),
    'min-side-identity-cosine': provisional(
      0.4,
      'generous: research §7 measured an SFace cosine of 0.83 for a 30 degree re-posed turn',
    ),
  }),
  selfie_pose_repeat_detection: Object.freeze({
    'min-planarity-residual': provisional(
      0.0045,
      'between research §7 planar motion (0.05-0.33% of face width) and 3-D re-poses (0.62-2.2%)',
    ),
    'min-tracked-points': provisional(
      20,
      'research §7 tracked 38-67 points per pair; fewer than 20 leaves the homography fit unreliable',
    ),
    'max-pose-cosine': provisional(
      0.99,
      'research §7: genuine turns of 10-30 degrees score 0.83-0.97, a replayed frame 1.000',
    ),
  }),
  selfie_id_comparison: Object.freeze({ threshold: faceMatch }),
  selfie_account_comparison: Object.freeze({ threshold: faceMatch }),
  selfie_repeat_detection: Object.freeze({
    threshold: provisional(
      0.5,
      'a 1:N threshold above the 1:1 face-match threshold, since false matches grow with the gallery size (research §9); gallery-size dependent',
    ),
  }),
  selfie_similar_background_detection: Object.freeze({
    'min-orb-inliers': provisional(
      100,
      'research §8: the same backdrop re-framed gave 701 inliers, different backdrops 0-31',
    ),
    'min-inlier-ratio': provisional(
      0.5,
      'research §8: the same backdrop 0.98, different backdrops 0-0.74; secondary to the inlier count',
    ),
    'window-days': provisional(30, 'C39.3: a fraud farm reuses its room within weeks'),
    'min-distinct-faces': provisional(
      3,
      'C39.3: shared backdrops are common (studios, kiosks, a family home), so two faces are not enough',
    ),
    'min-coverage': provisional(
      0.25,
      'a quarter of the 48 layout cells left visible by the person mask (research §8)',
    ),
  }),
  selfie_face_covering_detection: Object.freeze({
    'max-face-covering-score': provisional(0.5, MIDPOINT),
  }),
  selfie_glasses_detection: Object.freeze({ 'max-glasses-score': provisional(0.5, MIDPOINT) }),
  selfie_age_comparison: Object.freeze({
    'buffer-years': provisional(
      3,
      'C39.3: apparent-age estimators err by several years, so a small buffer avoids failing on noise',
    ),
  }),
  selfie_suspicious_entity_detection: Object.freeze({
    'max-synthetic-face-score': provisional(0.5, MIDPOINT),
  }),
});

/** The default values of one selfie check's keys, as the worker merges them. */
export function selfieConfigDefaults(
  checkId: string,
): Readonly<Record<string, CheckConfigDefault>> {
  return Object.fromEntries(
    Object.entries(SELFIE_CHECK_CONFIG_DEFAULTS[checkId] ?? {}).map(([key, entry]) => [
      key,
      entry.value,
    ]),
  );
}

/** The basis of each default key of one selfie check, for `provenance['threshold-basis']`. */
export function selfieThresholdBasis(checkId: string): Readonly<Record<string, ThresholdBasis>> {
  return Object.fromEntries(
    Object.entries(SELFIE_CHECK_CONFIG_DEFAULTS[checkId] ?? {}).map(([key, entry]) => [
      key,
      entry.basis,
    ]),
  );
}

// Phase 5 checks (C51.3), one module per area so parallel check agents own disjoint files (V09).
export * from './check-config/business.js';
export * from './check-config/contact.js';
export * from './check-config/crypto-wallet.js';
export * from './check-config/database.js';
export * from './check-config/document.js';
export * from './check-config/match-groups.js';
export * from './check-config/nfc.js';

/**
 * C51.3: the defaults of every Phase 5 check key with a default, by check, each with its basis
 * and source: the per-area tables merged. Every value is `provisional`; none is fitted to our
 * fixtures, and "ours" in a source means no external basis. A key without a default here applies
 * only when a template sets it. Results record the basis per key (`provenance['threshold-basis']`).
 */
export const PHASE5_CHECK_CONFIG_DEFAULTS: Readonly<
  Record<string, Readonly<Record<string, ConfigDefault>>>
> = Object.freeze({
  ...DOCUMENT_CHECK_CONFIG_DEFAULTS,
  ...DATABASE_CHECK_CONFIG_DEFAULTS,
  ...CONTACT_CHECK_CONFIG_DEFAULTS,
  ...CRYPTO_WALLET_CHECK_CONFIG_DEFAULTS,
  ...BUSINESS_CHECK_CONFIG_DEFAULTS,
  ...NFC_CHECK_CONFIG_DEFAULTS,
});

/** The default values of one Phase 5 check's keys, as the worker merges them. */
export function phase5ConfigDefaults(
  checkId: string,
): Readonly<Record<string, CheckConfigDefault>> {
  const entries = Object.hasOwn(PHASE5_CHECK_CONFIG_DEFAULTS, checkId)
    ? Object.entries(PHASE5_CHECK_CONFIG_DEFAULTS[checkId] ?? {})
    : [];
  return Object.fromEntries(entries.map(([key, entry]) => [key, entry.value]));
}

/** The basis of each default key of one Phase 5 check, for `provenance['threshold-basis']`. */
export function phase5ThresholdBasis(checkId: string): Readonly<Record<string, ThresholdBasis>> {
  const entries = Object.hasOwn(PHASE5_CHECK_CONFIG_DEFAULTS, checkId)
    ? Object.entries(PHASE5_CHECK_CONFIG_DEFAULTS[checkId] ?? {})
    : [];
  return Object.fromEntries(entries.map(([key, entry]) => [key, entry.basis]));
}
