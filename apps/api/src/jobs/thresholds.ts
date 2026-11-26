/**
 * C11 thresholds a template version sets on the Phase 2 image quality checks, applied to vision's
 * raw scores (the same comparisons vision makes with its defaults) and recorded on the results.
 * Moved out of `process-verification.ts` unchanged, for the government ID and selfie jobs.
 */
import {
  idBlurDetectionConfigSchema,
  idGlareDetectionConfigSchema,
  selfieImageQualityDetectionConfigSchema,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import type { GovernmentIdAnalysis, VisionQuality } from '../ports.js';

/** Thresholds a template sets on the image quality checks, in the units of vision's scores. */
export interface QualityThresholds {
  minBlurScore?: number | undefined;
  maxGlareRatio?: number | undefined;
  minBrightness?: number | undefined;
  maxBrightness?: number | undefined;
}

/** The `config` a template version sets on `check`, or `{}`. */
const checkConfig = (config: VerificationTemplateConfig, check: string): unknown =>
  config.checks[check]?.config ?? {};

/**
 * Vision's verdicts recomputed from its raw scores with the configured thresholds (the same
 * comparisons vision makes with its defaults); a verdict without a threshold stays as it is.
 */
export function withThresholds(
  quality: VisionQuality,
  thresholds: QualityThresholds,
): VisionQuality {
  const { minBlurScore, maxGlareRatio, minBrightness, maxBrightness } = thresholds;
  return {
    ...quality,
    ...(minBlurScore === undefined ? {} : { is_blurry: quality.blur_score < minBlurScore }),
    ...(maxGlareRatio === undefined ? {} : { has_glare: quality.glare_ratio > maxGlareRatio }),
    ...(minBrightness === undefined ? {} : { is_too_dark: quality.brightness < minBrightness }),
    ...(maxBrightness === undefined ? {} : { is_too_bright: quality.brightness > maxBrightness }),
  };
}

/** The configured thresholds as check metadata (snake_case, like the scores), set ones only. */
function thresholdMetadata(thresholds: QualityThresholds): Record<string, number> {
  const entries: [string, number | undefined][] = [
    ['min_blur_score', thresholds.minBlurScore],
    ['max_glare_ratio', thresholds.maxGlareRatio],
    ['min_brightness', thresholds.minBrightness],
    ['max_brightness', thresholds.maxBrightness],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
}

/** The configured thresholds under their C11 config keys (kebab-case), set ones only. */
function provenanceThresholds(thresholds: QualityThresholds): Record<string, number> {
  const entries: [string, number | undefined][] = [
    ['min-blur-score', thresholds.minBlurScore],
    ['max-glare-ratio', thresholds.maxGlareRatio],
    ['min-brightness', thresholds.minBrightness],
    ['max-brightness', thresholds.maxBrightness],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
}

/**
 * Adds each check's configured thresholds to its result's metadata and to its provenance
 * (C29.2). A threshold left to vision's default is not known here, so it is not listed.
 */
export function recordThresholds(
  results: readonly CheckResult[],
  byCheck: Readonly<Record<string, QualityThresholds>>,
): CheckResult[] {
  return results.map((result) => {
    const thresholds = Object.hasOwn(byCheck, result.name) ? byCheck[result.name] : undefined;
    const metadata = thresholds === undefined ? {} : thresholdMetadata(thresholds);
    return Object.keys(metadata).length === 0 || thresholds === undefined
      ? result
      : {
          ...result,
          metadata: { ...result.metadata, ...metadata },
          provenance: {
            ...result.provenance,
            thresholds: { ...result.provenance.thresholds, ...provenanceThresholds(thresholds) },
          },
        };
  });
}

/** C11 thresholds of the government ID image checks. */
export function governmentIdThresholds(config: VerificationTemplateConfig) {
  const blur = idBlurDetectionConfigSchema.parse(checkConfig(config, 'id_blur_detection'));
  const glare = idGlareDetectionConfigSchema.parse(checkConfig(config, 'id_glare_detection'));
  return {
    id_blur_detection: { minBlurScore: blur['min-blur-score'] },
    id_glare_detection: { maxGlareRatio: glare['max-glare-ratio'] },
  } satisfies Record<string, QualityThresholds>;
}

export function governmentIdWithThresholds(
  analysis: GovernmentIdAnalysis,
  thresholds: QualityThresholds,
): GovernmentIdAnalysis {
  const { front, back } = analysis.sides;
  return {
    ...analysis,
    sides: {
      front: { ...front, quality: withThresholds(front.quality, thresholds) },
      back: back === null ? null : { ...back, quality: withThresholds(back.quality, thresholds) },
    },
  };
}

/** C11 thresholds of the selfie quality check. */
export function selfieThresholds(config: VerificationTemplateConfig): QualityThresholds {
  const quality = selfieImageQualityDetectionConfigSchema.parse(
    checkConfig(config, 'selfie_image_quality_detection'),
  );
  return {
    minBlurScore: quality['min-blur-score'],
    minBrightness: quality['min-brightness'],
    maxBrightness: quality['max-brightness'],
  };
}
