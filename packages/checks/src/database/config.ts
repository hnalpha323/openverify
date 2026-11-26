/**
 * A Phase 5 check's effective config (C51.3): the template's `config` over
 * `PHASE5_CHECK_CONFIG_DEFAULTS`. A result records each threshold it was judged against and, for a
 * default, its basis (`provenance['threshold-basis']`); a key the template sets has none, as the
 * operator chose it.
 */
import {
  getCheckDefinition,
  phase5ConfigDefaults,
  phase5ThresholdBasis,
  type CheckId,
  type ThresholdBasis,
  type ThresholdValue,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { parseCheckConfig, type CheckResultOptions } from '../result.js';

export interface DatabaseCheckConfig {
  readonly values: Readonly<Record<string, ThresholdValue>>;
  readonly basis: Readonly<Record<string, ThresholdBasis>>;
}

/**
 * A Phase 5 check's effective config.
 * @throws {InvalidCheckConfigError} when the template's config breaks the registry schema.
 */
export function databaseCheckConfig(
  template: VerificationTemplateConfig,
  checkId: CheckId,
): DatabaseCheckConfig {
  const schema = getCheckDefinition(checkId)?.configSchema;
  const configured = template.checks[checkId]?.config;
  const parsed =
    schema === undefined || configured === undefined
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

/** The thresholds of `keys`, with the basis of those that are defaults, merged into `extra`. */
export function databaseResultOptions(
  config: DatabaseCheckConfig,
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
    thresholdBasis: Object.fromEntries(
      judged.flatMap(([key]) => {
        const basis = config.basis[key];
        return basis === undefined ? [] : [[key, basis]];
      }),
    ),
  };
}
