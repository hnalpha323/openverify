/**
 * C39.3: the selfie checks' config schemas, their provisional defaults with a basis, and the one
 * shared face-match threshold.
 */
import { describe, expect, it } from 'vitest';
import {
  FACE_MATCH_DEFAULTS,
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  SELFIE_CHECK_CONFIG_DEFAULTS,
  THRESHOLD_BASES,
  idSelfieComparisonConfigSchema,
  selfieAccountComparisonConfigSchema,
  selfieAgeComparisonConfigSchema,
  selfieConfigDefaults,
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
  selfieThresholdBasis,
  thresholdBasisSchema,
} from './check-config.js';
import { getCheckDefinition } from './check-registry.js';

interface Schema {
  safeParse: (value: unknown) => { success: boolean };
}
const accepts = (schema: Schema, value: unknown) => schema.safeParse(value).success;

/** C39.3: every §4.2 check with a threshold, its registry schema and its keys. */
const SELFIE_SCHEMAS: Readonly<Record<string, readonly [Schema, readonly string[]]>> = {
  selfie_image_quality_detection: [
    selfieImageQualityDetectionConfigSchema,
    [
      'min-blur-score',
      'min-brightness',
      'max-brightness',
      'min-face-blur-score',
      'min-face-width-px',
      'min-face-height-ratio',
      'min-image-short-side-px',
    ],
  ],
  selfie_glare_detection: [selfieGlareDetectionConfigSchema, ['max-face-glare-ratio']],
  selfie_pose_detection: [
    selfiePoseDetectionConfigSchema,
    ['max-center-yaw-ratio', 'min-side-yaw-ratio-change'],
  ],
  selfie_multiple_faces_detection: [
    selfieMultipleFacesDetectionConfigSchema,
    ['min-secondary-face-area-ratio'],
  ],
  selfie_liveness_detection: [
    selfieLivenessDetectionConfigSchema,
    ['min-passive-score', 'min-side-identity-cosine'],
  ],
  selfie_pose_repeat_detection: [
    selfiePoseRepeatDetectionConfigSchema,
    ['min-planarity-residual', 'min-tracked-points', 'max-pose-cosine'],
  ],
  selfie_id_comparison: [selfieIdComparisonConfigSchema, ['threshold']],
  selfie_account_comparison: [selfieAccountComparisonConfigSchema, ['threshold']],
  selfie_repeat_detection: [selfieRepeatDetectionConfigSchema, ['threshold']],
  selfie_similar_background_detection: [
    selfieSimilarBackgroundDetectionConfigSchema,
    ['min-orb-inliers', 'min-inlier-ratio', 'window-days', 'min-distinct-faces', 'min-coverage'],
  ],
  selfie_face_covering_detection: [
    selfieFaceCoveringDetectionConfigSchema,
    ['max-face-covering-score'],
  ],
  selfie_glasses_detection: [selfieGlassesDetectionConfigSchema, ['max-glasses-score']],
  selfie_age_comparison: [selfieAgeComparisonConfigSchema, ['min-age', 'max-age', 'buffer-years']],
  selfie_suspicious_entity_detection: [
    selfieSuspiciousEntityDetectionConfigSchema,
    ['max-synthetic-face-score'],
  ],
};

describe('the selfie config schemas (C39.3)', () => {
  it('are the registry schemas of every selfie check with a threshold', () => {
    for (const [id, [schema]] of Object.entries(SELFIE_SCHEMAS)) {
      expect(getCheckDefinition(id)?.configSchema, id).toBe(schema);
    }
    expect(getCheckDefinition('selfie_public_figure_detection')?.configSchema).toBeUndefined();
  });

  it('accept an empty config and refuse unknown or camelCase keys', () => {
    for (const [id, [schema]] of Object.entries(SELFIE_SCHEMAS)) {
      expect(accepts(schema, {}), id).toBe(true);
      expect(accepts(schema, { 'made-up-key': 1 }), id).toBe(false);
      expect(accepts(schema, { minPassiveScore: 0.5 }), id).toBe(false);
    }
  });

  it.each([
    ['selfie_image_quality_detection', 'min-face-blur-score', 1, 10_000, 0, 10_001],
    ['selfie_image_quality_detection', 'min-face-width-px', 16, 1000, 15, 1001],
    ['selfie_image_quality_detection', 'min-face-height-ratio', 0.01, 1, 0, 1.01],
    ['selfie_image_quality_detection', 'min-image-short-side-px', 120, 4000, 119, 4001],
    ['selfie_glare_detection', 'max-face-glare-ratio', 0.001, 0.5, 0, 0.51],
    ['selfie_pose_detection', 'max-center-yaw-ratio', 0.01, 1, 0, 1.01],
    ['selfie_pose_detection', 'min-side-yaw-ratio-change', 0.01, 2, 0, 2.01],
    ['selfie_multiple_faces_detection', 'min-secondary-face-area-ratio', 0, 1, -0.01, 1.01],
    ['selfie_liveness_detection', 'min-passive-score', 0, 1, -0.01, 1.01],
    ['selfie_liveness_detection', 'min-side-identity-cosine', 0, 1, -0.01, 1.01],
    ['selfie_pose_repeat_detection', 'min-planarity-residual', 0, 0.1, -0.001, 0.11],
    ['selfie_pose_repeat_detection', 'min-tracked-points', 4, 500, 3, 501],
    ['selfie_pose_repeat_detection', 'max-pose-cosine', 0.5, 1, 0.49, 1.01],
    ['selfie_id_comparison', 'threshold', 0.25, 0.6, 0.24, 0.61],
    ['selfie_account_comparison', 'threshold', 0.25, 0.6, 0.24, 0.61],
    // A 1:N threshold is never below the 1:1 one.
    ['selfie_repeat_detection', 'threshold', 0.394, 0.95, 0.393, 0.96],
    ['selfie_similar_background_detection', 'min-orb-inliers', 4, 5000, 3, 5001],
    ['selfie_similar_background_detection', 'min-inlier-ratio', 0, 1, -0.01, 1.01],
    ['selfie_similar_background_detection', 'window-days', 1, 365, 0, 366],
    ['selfie_similar_background_detection', 'min-distinct-faces', 1, 50, 0, 51],
    ['selfie_similar_background_detection', 'min-coverage', 0, 1, -0.01, 1.01],
    ['selfie_face_covering_detection', 'max-face-covering-score', 0, 1, -0.01, 1.01],
    ['selfie_glasses_detection', 'max-glasses-score', 0, 1, -0.01, 1.01],
    ['selfie_suspicious_entity_detection', 'max-synthetic-face-score', 0, 1, -0.01, 1.01],
    ['selfie_age_comparison', 'buffer-years', 0, 10, -1, 11],
  ] as const)('bound %s %s to %s-%s', (id, key, min, max, below, above) => {
    const schema = SELFIE_SCHEMAS[id]?.[0];
    if (schema === undefined) {
      throw new Error(`no schema for ${id}`);
    }
    expect(accepts(schema, { [key]: min }), `${key} ${String(min)}`).toBe(true);
    expect(accepts(schema, { [key]: max }), `${key} ${String(max)}`).toBe(true);
    expect(accepts(schema, { [key]: below }), `${key} ${String(below)}`).toBe(false);
    expect(accepts(schema, { [key]: above }), `${key} ${String(above)}`).toBe(false);
  });

  it('take whole numbers for pixel sizes, counts and days', () => {
    expect(accepts(selfieImageQualityDetectionConfigSchema, { 'min-face-width-px': 64.5 })).toBe(
      false,
    );
    expect(accepts(selfiePoseRepeatDetectionConfigSchema, { 'min-tracked-points': 20.5 })).toBe(
      false,
    );
    expect(accepts(selfieSimilarBackgroundDetectionConfigSchema, { 'window-days': 1.5 })).toBe(
      false,
    );
  });

  it('take the age limits as whole years 0-150, min not above max', () => {
    expect(accepts(selfieAgeComparisonConfigSchema, { 'min-age': 18, 'max-age': 150 })).toBe(true);
    expect(accepts(selfieAgeComparisonConfigSchema, { 'min-age': 0 })).toBe(true);
    expect(accepts(selfieAgeComparisonConfigSchema, { 'min-age': 151 })).toBe(false);
    expect(accepts(selfieAgeComparisonConfigSchema, { 'min-age': 30, 'max-age': 20 })).toBe(false);
  });

  it('keep the Phase 1 whole-image brightness rule: min below max', () => {
    expect(
      accepts(selfieImageQualityDetectionConfigSchema, {
        'min-brightness': 0.6,
        'max-brightness': 0.4,
      }),
    ).toBe(false);
  });
});

describe('the selfie defaults and their basis (C39.3)', () => {
  it('names two bases: calibrated and provisional', () => {
    expect(THRESHOLD_BASES).toEqual(['calibrated', 'provisional']);
    expect(thresholdBasisSchema.safeParse('fitted').success).toBe(false);
  });

  it('give every default a basis and a source, and only the face match may be calibrated', () => {
    for (const [id, keys] of Object.entries(SELFIE_CHECK_CONFIG_DEFAULTS)) {
      for (const [key, entry] of Object.entries(keys)) {
        expect(THRESHOLD_BASES, `${id} ${key}`).toContain(entry.basis);
        expect(entry.source.length, `${id} ${key}`).toBeGreaterThan(20);
        if (key !== 'threshold' || id === 'selfie_repeat_detection') {
          expect(entry.basis, `${id} ${key}`).toBe('provisional');
        }
      }
    }
  });

  it('give defaults that their own schema accepts', () => {
    for (const id of Object.keys(SELFIE_CHECK_CONFIG_DEFAULTS)) {
      const schema = getCheckDefinition(id)?.configSchema;
      expect(schema, id).toBeDefined();
      expect(schema?.safeParse(selfieConfigDefaults(id)).success, id).toBe(true);
    }
  });

  it('take the plan provisional values', () => {
    expect(selfieConfigDefaults('selfie_multiple_faces_detection')).toEqual({
      'min-secondary-face-area-ratio': 0.25,
    });
    expect(selfieConfigDefaults('selfie_liveness_detection')).toEqual({
      'min-passive-score': 0.5,
      'min-side-identity-cosine': 0.4,
    });
    expect(selfieConfigDefaults('selfie_pose_repeat_detection')).toEqual({
      'min-planarity-residual': 0.0045,
      'min-tracked-points': 20,
      'max-pose-cosine': 0.99,
    });
    expect(selfieConfigDefaults('selfie_repeat_detection')).toEqual({ threshold: 0.5 });
    expect(selfieConfigDefaults('selfie_similar_background_detection')).toMatchObject({
      'window-days': 30,
      'min-distinct-faces': 3,
    });
    expect(selfieConfigDefaults('selfie_age_comparison')).toEqual({ 'buffer-years': 3 });
    for (const [id, key] of [
      ['selfie_face_covering_detection', 'max-face-covering-score'],
      ['selfie_glasses_detection', 'max-glasses-score'],
      ['selfie_suspicious_entity_detection', 'max-synthetic-face-score'],
    ] as const) {
      expect(selfieConfigDefaults(id)[key], id).toBeTypeOf('number');
    }
    for (const key of [
      'min-face-blur-score',
      'min-face-width-px',
      'min-face-height-ratio',
      'min-image-short-side-px',
    ]) {
      expect(selfieConfigDefaults('selfie_image_quality_detection')[key], key).toBeTypeOf('number');
    }
    expect(selfieConfigDefaults('selfie_glare_detection')['max-face-glare-ratio']).toBeTypeOf(
      'number',
    );
  });

  it('leave the whole-image Phase 1 keys and the age limits without a default', () => {
    for (const key of ['min-blur-score', 'min-brightness', 'max-brightness']) {
      expect(selfieConfigDefaults('selfie_image_quality_detection'), key).not.toHaveProperty(key);
    }
    expect(selfieConfigDefaults('selfie_age_comparison')).not.toHaveProperty('min-age');
  });

  it('report each default key basis for provenance', () => {
    expect(selfieThresholdBasis('selfie_liveness_detection')).toEqual({
      'min-passive-score': 'provisional',
      'min-side-identity-cosine': 'provisional',
    });
    expect(selfieThresholdBasis('selfie_public_figure_detection')).toEqual({});
  });
});

describe('the shared face-match threshold (C39.3)', () => {
  it('is 0.394, calibrated by the C49 report on studio portrait pairs: FAR 1e-3 with its interval as the margin', () => {
    expect(FACE_MATCH_DEFAULTS.threshold).toBe(0.394);
    expect(FACE_MATCH_DEFAULTS.basis).toBe('calibrated');
    expect(FACE_MATCH_DEFAULTS.source).toMatch(/docs\/calibration\/selfie-phase4\.md/);
    expect(FACE_MATCH_DEFAULTS.source).toMatch(/studio portrait pairs/);
    expect(FACE_MATCH_DEFAULTS.source).toMatch(/0\.363/);
  });

  it('is the default of every 1:1 face comparison', () => {
    for (const id of ['selfie_id_comparison', 'selfie_account_comparison']) {
      expect(SELFIE_CHECK_CONFIG_DEFAULTS[id]?.threshold, id).toEqual({
        value: FACE_MATCH_DEFAULTS.threshold,
        basis: FACE_MATCH_DEFAULTS.basis,
        source: FACE_MATCH_DEFAULTS.source,
      });
    }
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_selfie_comparison).toEqual({
      threshold: FACE_MATCH_DEFAULTS.threshold,
    });
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_inconsistent_repeat_detection).toEqual({
      'face-threshold': FACE_MATCH_DEFAULTS.threshold,
    });
    expect(getCheckDefinition('id_selfie_comparison')?.configSchema).toBe(
      idSelfieComparisonConfigSchema,
    );
  });

  it('puts the repeat threshold at or above it', () => {
    const repeat = selfieConfigDefaults('selfie_repeat_detection').threshold;
    expect(repeat).toBeGreaterThanOrEqual(FACE_MATCH_DEFAULTS.threshold);
  });
});
