/**
 * The shared evaluation context of the §4.2 selfie checks (C43): the input, the template config,
 * the environment kind, the evaluation instant, the capture and the cascade, built once per
 * verification by `evaluateSelfieChecks`.
 */
import type { CheckModel, VerificationTemplateConfig } from '@openverify/core';
import type { PoseConsistencyInput, SelfiePoseAnalysisInput } from '../phase1/inputs.js';
import { selfieCascade, type SelfieCascade } from './cascade.js';
import type {
  EnvironmentKind,
  SelfieCaptureInput,
  SelfieCheckInput,
  SelfieModels,
  SelfiePose,
  SidePose,
} from './inputs.js';

export {
  numberIn,
  selfieCheckConfig,
  selfieResultOptions,
  type SelfieCheckConfig,
} from './config.js';

export interface SelfieContext {
  input: SelfieCheckInput;
  template: VerificationTemplateConfig;
  environment: EnvironmentKind;
  now: Date;
  /** The newest submitted capture, or `null` without one. */
  capture: SelfieCaptureInput | null;
  cascade: SelfieCascade;
}

/**
 * Builds the context of one verification's evaluation: `production` and now unless given.
 * @throws {InvalidCheckConfigError} when the pose or image quality check's config breaks its
 * schema (the cascade reads both).
 */
export function selfieContext(
  input: SelfieCheckInput,
  template: VerificationTemplateConfig,
): SelfieContext {
  const capture = input.capture ?? null;
  return {
    input,
    template,
    environment: input.environment ?? 'production',
    now: input.now ?? new Date(),
    capture,
    cascade: selfieCascade(input.analysis, capture, template),
  };
}

/** The pinned models of the kinds asked, in that order; `undefined` when the worker named none. */
export function selfieModelsOf(
  context: SelfieContext,
  kinds: readonly (keyof SelfieModels)[],
): readonly CheckModel[] | undefined {
  const models = kinds.flatMap((kind) => {
    const model = context.input.models?.[kind];
    return model === undefined ? [] : [model];
  });
  return models.length === 0 ? undefined : models;
}

/** The analysis of `pose`, or `null` when its file was not analysed. */
export function poseAnalysisOf(
  context: SelfieContext,
  pose: SelfiePose,
): SelfiePoseAnalysisInput | null {
  return context.input.analysis.poses[pose] ?? null;
}

/** The `consistency` entry of a side pose, or `null` when vision measured none. */
export function consistencyOf(context: SelfieContext, pose: SidePose): PoseConsistencyInput | null {
  return context.input.analysis.consistency?.find((entry) => entry.pose === pose) ?? null;
}
