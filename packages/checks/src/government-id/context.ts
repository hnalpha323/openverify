/**
 * The shared evaluation context of the government ID checks: the input, the template config, the
 * C31 extraction (the worker's, or derived from the analysis), the environment kind (C30.7), the
 * evaluation instant and the feature row of the established class (C33). Built once per
 * verification by `evaluateGovernmentIdChecks`.
 */
import {
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  getCheckDefinition,
  type CheckId,
  type CheckModel,
  type ThresholdValue,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  documentFeatures,
  type DocumentFeatures,
  type EnvironmentKind,
} from '../data/feature-table.js';
import { extractGovernmentId, type GovernmentIdExtraction } from '../extraction/extract.js';
import { parseCheckConfig } from '../result.js';
import type { GovernmentIdCheckInput, GovernmentIdModels } from './inputs.js';

export interface GovernmentIdContext {
  input: GovernmentIdCheckInput;
  template: VerificationTemplateConfig;
  extraction: GovernmentIdExtraction;
  environment: EnvironmentKind;
  now: Date;
  /** The feature row of the established class and issuer, or `null` without one (C30.2). */
  features: DocumentFeatures | null;
}

/** Builds the context of one verification's evaluation. */
export function governmentIdContext(
  input: GovernmentIdCheckInput,
  template: VerificationTemplateConfig,
): GovernmentIdContext {
  const now = input.now ?? new Date();
  const environment = input.environment ?? 'production';
  const extraction = input.extraction ?? extractGovernmentId(input.analysis, { now });
  const { idClass, issuer } = extraction.document;
  return {
    input,
    template,
    extraction,
    environment,
    now,
    features: documentFeatures(issuer, idClass, environment),
  };
}

export type CheckConfigValues = Readonly<Record<string, ThresholdValue>>;

/**
 * A check's effective config: its C29.5 defaults, overridden by the template's `config`, which
 * its registry schema validates. A check without a schema has none.
 * @throws {InvalidCheckConfigError} when the template's config breaks the schema.
 */
export function checkConfigOf(context: GovernmentIdContext, checkId: CheckId): CheckConfigValues {
  const schema = getCheckDefinition(checkId)?.configSchema;
  if (schema === undefined) {
    return {};
  }
  const configured = context.template.checks[checkId]?.config;
  const parsed =
    configured === undefined
      ? {}
      : (parseCheckConfig(checkId, schema, configured) as Record<string, unknown>);
  const values: Record<string, ThresholdValue> = {
    ...(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS[checkId] ?? {}),
  };
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      values[key] = value as ThresholdValue;
    }
  }
  return values;
}

export type ModelKind = keyof GovernmentIdModels;

/** The pinned models of the kinds asked, in that order; `undefined` when the worker named none. */
export function modelsOf(
  context: GovernmentIdContext,
  kinds: readonly ModelKind[],
): readonly CheckModel[] | undefined {
  const models = kinds.flatMap((kind) => {
    const model = context.input.models?.[kind];
    return model === undefined ? [] : [model];
  });
  return models.length === 0 ? undefined : models;
}
