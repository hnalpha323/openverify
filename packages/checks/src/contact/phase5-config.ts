/**
 * What the contact and crypto wallet evaluators share (C51.3, C56, C57): a Phase 5 check's
 * effective config (its `PHASE5_CHECK_CONFIG_DEFAULTS`, overridden by the template's `config`,
 * which the registry schema validates), the thresholds and their basis a result records, and the
 * enabled checks of one verification type in configuration order.
 *
 * A key the template sets has no basis: it is the operator's choice, not a default (C39.3).
 */
import {
  getCheckDefinition,
  phase5ConfigDefaults,
  phase5ThresholdBasis,
  type CheckId,
  type ThresholdBasis,
  type ThresholdValue,
  type VerificationTemplateConfig,
  type VerificationType,
} from '@openverify/core';
import { InvalidCheckConfigError, parseCheckConfig, type CheckResultOptions } from '../result.js';

/** A Phase 5 check's effective config: each key's value, and the basis of each default used. */
export interface Phase5CheckConfig {
  values: Readonly<Record<string, ThresholdValue>>;
  basis: Readonly<Record<string, ThresholdBasis>>;
}

/**
 * A Phase 5 check's effective config. A check without a registry schema has none.
 * @throws {InvalidCheckConfigError} when the template's config breaks the schema.
 */
export function phase5CheckConfig(
  template: VerificationTemplateConfig,
  checkId: CheckId,
): Phase5CheckConfig {
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
      ...(phase5ConfigDefaults(checkId) as Readonly<Record<string, ThresholdValue>>),
      ...(Object.fromEntries(set) as Record<string, ThresholdValue>),
    },
    basis: Object.fromEntries(
      Object.entries(phase5ThresholdBasis(checkId)).filter(([key]) => !operatorKeys.has(key)),
    ),
  };
}

/** The thresholds of `keys` that are set, with the basis of those that are defaults. */
export function phase5ResultOptions(
  config: Phase5CheckConfig,
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

/** A boolean config value, or `fallback` when the key is not set. */
export function booleanIn(config: Phase5CheckConfig, key: string, fallback: boolean): boolean {
  const value = config.values[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** A string list config value, or an empty list when the key is not set. */
export function stringListIn(config: Phase5CheckConfig, key: string): readonly string[] {
  const value = config.values[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

/**
 * The enabled checks of `verificationType` in a template's configuration, in configuration order.
 * @throws {InvalidCheckConfigError} for an unknown check or one of another verification type.
 */
export function enabledChecksOf(
  verificationType: VerificationType,
  config: VerificationTemplateConfig,
): CheckId[] {
  const enabled: CheckId[] = [];
  for (const [name, check] of Object.entries(config.checks)) {
    const definition = getCheckDefinition(name);
    if (definition?.verificationType !== verificationType) {
      throw new InvalidCheckConfigError(name as CheckId, [
        {
          path: `checks.${name}`,
          message:
            definition === undefined
              ? 'unknown check'
              : `belongs to ${definition.verificationType} verifications`,
        },
      ]);
    }
    if (check.enabled) {
      enabled.push(definition.id as CheckId);
    }
  }
  return enabled;
}
