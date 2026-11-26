/**
 * The selfie checks' effective config (C39.3, C43): the template's `config`, else
 * `SELFIE_CHECK_CONFIG_DEFAULTS`. A result records each threshold it was judged against and, for a
 * default, its basis (`provenance['threshold-basis']`); a key the template sets has no basis, as
 * it is the operator's choice, not a default.
 */
import {
  getCheckDefinition,
  selfieConfigDefaults,
  selfieThresholdBasis,
  type CheckId,
  type ThresholdBasis,
  type ThresholdValue,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { parseCheckConfig, type CheckResultOptions } from '../result.js';

/** A selfie check's effective config: each key's value, and the basis of each default used. */
export interface SelfieCheckConfig {
  values: Readonly<Record<string, ThresholdValue>>;
  basis: Readonly<Record<string, ThresholdBasis>>;
}

/**
 * A selfie check's effective config: its `SELFIE_CHECK_CONFIG_DEFAULTS`, overridden by the
 * template's `config`, which the registry schema validates. A check without a schema has none.
 * @throws {InvalidCheckConfigError} when the template's config breaks the schema.
 */
export function selfieCheckConfig(
  template: VerificationTemplateConfig,
  checkId: CheckId,
): SelfieCheckConfig {
  const schema = getCheckDefinition(checkId)?.configSchema;
  if (schema === undefined) {
    return { values: {}, basis: {} };
  }
  const configured = template.checks[checkId]?.config;
  const parsed =
    configured === undefined
      ? {}
      : (parseCheckConfig(checkId, schema, configured) as Record<string, unknown>);
  const set = Object.entries(parsed).filter(([, value]) => value !== undefined);
  const operatorKeys = new Set(set.map(([key]) => key));
  return {
    values: {
      ...selfieConfigDefaults(checkId),
      ...(Object.fromEntries(set) as Record<string, ThresholdValue>),
    },
    basis: Object.fromEntries(
      Object.entries(selfieThresholdBasis(checkId)).filter(([key]) => !operatorKeys.has(key)),
    ),
  };
}

/** The thresholds of `keys` that are set, with the basis of those that are defaults. */
export function selfieResultOptions(
  config: SelfieCheckConfig,
  keys: readonly string[],
  extra: CheckResultOptions = {},
): CheckResultOptions {
  const judged = keys.flatMap((key) => {
    const value = config.values[key];
    return value === undefined ? [] : [[key, value] as const];
  });
  return {
    ...extra,
    thresholds: { ...Object.fromEntries(judged), ...extra.thresholds },
    thresholdBasis: {
      ...Object.fromEntries(
        judged.flatMap(([key]) => {
          const basis = config.basis[key];
          return basis === undefined ? [] : [[key, basis]];
        }),
      ),
      ...extra.thresholdBasis,
    },
  };
}

/** A numeric config value, or `undefined` when the key is not set. */
export function numberIn(config: SelfieCheckConfig, key: string): number | undefined {
  const value = config.values[key];
  return typeof value === 'number' ? value : undefined;
}
