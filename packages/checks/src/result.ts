import {
  DomainError,
  checkResultSchema,
  getCheckDefinition,
  type CheckId,
  type CheckModel,
  type CheckProvider,
  type CheckResult,
  type CheckStatus,
  type ThresholdBasis,
  type ThresholdValue,
} from '@openverify/core';
import type { z } from 'zod';

/** What a check passes to {@link checkResult} besides its status, reasons and metadata (C29.2). */
export interface CheckResultOptions {
  /** In [0, 1]; required for a `passed` or `failed` H-tier result. Defaults to `null`. */
  confidence?: number | null;
  /** Every threshold the result was judged against, kebab-case, after template config. */
  thresholds?: Readonly<Record<string, ThresholdValue>>;
  /** The models the result rests on; omit when none was used. */
  models?: readonly CheckModel[];
  /** The provider an A-tier result came from; omit when none was used. */
  provider?: CheckProvider;
  /**
   * C39.3: the basis of each threshold whose value is a default (`calibrated` or `provisional`),
   * recorded as `provenance['threshold-basis']`; omitted when empty.
   */
  thresholdBasis?: Readonly<Record<string, ThresholdBasis>>;
}

/**
 * Builds a check result. The check type, stage and implementation version come from the core
 * registry, so a result can never disagree with its catalog entry; thresholds default to `{}`
 * and the confidence to `null`.
 * @throws {Error} for a check missing from the registry, or a `passed` or `failed` H-tier result
 * without a confidence (ADR 0002 §3c).
 * @throws {z.ZodError} for a confidence outside [0, 1] or a malformed provenance.
 */
export function checkResult(
  name: CheckId,
  status: CheckStatus,
  reasons: readonly string[] = [],
  metadata: Record<string, unknown> = {},
  options: CheckResultOptions = {},
): CheckResult {
  const definition = getCheckDefinition(name);
  if (!definition) {
    throw new Error(`Unknown check ${name}`);
  }
  const confidence = options.confidence ?? null;
  if (
    definition.tier === 'H' &&
    confidence === null &&
    (status === 'passed' || status === 'failed')
  ) {
    throw new Error(`${name} is a heuristic check: a ${status} result needs a confidence`);
  }
  return checkResultSchema.parse({
    name,
    status,
    type: definition.checkType,
    reasons: [...reasons],
    metadata,
    stage: definition.stage,
    confidence,
    provenance: {
      'implementation-version': definition.version,
      ...(options.models === undefined ? {} : { models: options.models }),
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      thresholds: { ...options.thresholds },
      ...(options.thresholdBasis === undefined || Object.keys(options.thresholdBasis).length === 0
        ? {}
        : { 'threshold-basis': { ...options.thresholdBasis } }),
    },
  });
}

export interface CheckConfigIssue {
  path: string;
  message: string;
}

/** A check was called with an invalid configuration (a programming or template error). */
export class InvalidCheckConfigError extends DomainError {
  readonly checkId: CheckId;
  readonly issues: readonly CheckConfigIssue[];

  constructor(checkId: CheckId, issues: readonly CheckConfigIssue[]) {
    super('invalid_check_config', `Invalid configuration for ${checkId}`);
    this.checkId = checkId;
    this.issues = issues;
  }
}

export function parseCheckConfig<Schema extends z.ZodType>(
  checkId: CheckId,
  schema: Schema,
  config: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    throw new InvalidCheckConfigError(
      checkId,
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/** Trimmed text, or `null` when the value is missing, blank or not a string. */
export function presentText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
