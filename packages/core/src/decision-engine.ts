import { z } from 'zod';
import { checkNameSchema, getCheckDefinition, listChecks } from './check-registry.js';
import { checkResultSchema, type CheckResult } from './check-result.js';
import { cryptoChainIdSchema } from './crypto-chains.js';
import { idClassSchema, type CheckStatus, type VerificationType } from './enums.js';
import { DomainError } from './errors.js';

/** Per-check switches of a verification template, plus the optional thresholds (C11). */
export const checkConfigSchema = z.strictObject({
  enabled: z.boolean(),
  /** Only meaningful when `enabled`; a disabled check is ignored entirely. */
  required: z.boolean(),
  /** Validated by the check's registry `configSchema`; a check without one takes no config. */
  config: z.record(z.string(), z.unknown()).optional(),
});
export type CheckConfig = z.infer<typeof checkConfigSchema>;

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code');

function uniqueList<Item extends z.ZodType>(item: Item) {
  return z
    .array(item)
    .min(1)
    .refine((values) => new Set(values).size === values.length, 'must not contain duplicates');
}

/**
 * One verification type's configuration in a template version (C11, v2). A v1 document (only
 * `checks` with `enabled` and `required`) is still valid. `allowed-countries` and
 * `allowed-id-classes` are validated here and enforced by the Phase 3 checks.
 *
 * C50.4 adds two type-level options: `allowed-chains` (crypto wallets) and
 * `accept-review-without-provider` (database, AAMVA, government ID NFC; in production a step
 * whose provider is unbound is published only with it). Which type may set which option is
 * `verificationConfigSchema`'s rule in the contracts.
 */
export const verificationTemplateConfigSchema = z
  .strictObject({
    checks: z.record(checkNameSchema, checkConfigSchema),
    'allowed-countries': uniqueList(countryCodeSchema).optional(),
    'allowed-id-classes': uniqueList(idClassSchema).optional(),
    'allowed-chains': uniqueList(cryptoChainIdSchema).optional(),
    'accept-review-without-provider': z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    for (const [checkId, { config }] of Object.entries(value.checks)) {
      if (config === undefined) {
        continue;
      }
      const path = ['checks', checkId, 'config'];
      const schema = getCheckDefinition(checkId)?.configSchema;
      if (schema === undefined) {
        ctx.addIssue({ code: 'custom', message: `check "${checkId}" takes no config`, path });
        continue;
      }
      for (const issue of schema.safeParse(config).error?.issues ?? []) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: [...path, ...issue.path] });
      }
    }
  });
export type VerificationTemplateConfig = z.infer<typeof verificationTemplateConfigSchema>;

/**
 * Outcomes of {@link decideVerification} (C30.1): `needs_review` when a required check has no
 * evidence, `pending` only while more results are expected.
 */
export const VERIFICATION_DECISION_STATUSES = [
  'passed',
  'failed',
  'needs_review',
  'pending',
] as const;

/**
 * Reasons a required check may be `not_applicable` without blocking the decision (C30.2, the
 * ADR 0002 §3b clarification): the established document class has no such feature, the flow did
 * not ask for the input, and (C51.2, a C30.2 amendment) the template asked for no allowlist, or the
 * signed SOD proves the chip has no Active Authentication key. Any other `not_applicable` result
 * of a required check, including one without a reason, sends the verification to review. A
 * non-blocking answer is no evidence, so a verification with no required check `passed` still
 * goes to review (the C30.1 amendment in {@link decideVerification}).
 */
export const NON_BLOCKING_NOT_APPLICABLE_REASONS = Object.freeze([
  'feature_absent',
  'not_requested',
  'no_allowlist',
  'chip_auth_not_server_verifiable',
] as const);

export interface DecideVerificationOptions {
  /**
   * More results will come for this verification (an asynchronous provider): a pending or
   * missing required check then keeps it `pending` instead of sending it to review. No
   * provider is asynchronous in Phase 3.
   */
  moreResultsExpected?: boolean;
}
export const verificationDecisionStatusSchema = z.enum(VERIFICATION_DECISION_STATUSES);
export type VerificationDecisionStatus = z.infer<typeof verificationDecisionStatusSchema>;

/** Retry guidance for a failing `user_behavior` check. */
export interface UserBehaviorHint {
  checkId: string;
  reasons: string[];
}

export interface VerificationDecision {
  status: VerificationDecisionStatus;
  /** Required, enabled checks that failed. */
  failingCheckIds: string[];
  /** Required, enabled checks that are pending or have no result yet. */
  pendingCheckIds: string[];
  /**
   * Required, enabled checks that are `not_applicable` for a reason outside
   * {@link NON_BLOCKING_NOT_APPLICABLE_REASONS} (or for no reason): checks without evidence. When
   * no required check passed (C30.1 amendment), every required `not_applicable` check, since a
   * non-blocking answer is no evidence either.
   */
  reviewCheckIds: string[];
  /** Enabled but optional checks that failed; informational only. */
  advisoryFailedCheckIds: string[];
  /** Hints for the failing checks of type `user_behavior`, in failing order. */
  hints: UserBehaviorHint[];
  /** True when the verification failed only because of `user_behavior` checks. */
  retryable: boolean;
}

export interface DecisionInputIssue {
  path: string;
  message: string;
}

export class InvalidDecisionInputError extends DomainError {
  readonly issues: readonly DecisionInputIssue[];

  constructor(issues: readonly DecisionInputIssue[]) {
    super('invalid_decision_input', 'Check results or template configuration are invalid');
    this.issues = issues;
  }
}

/** Higher wins when one check reports several results. */
const SEVERITY: Readonly<Record<CheckStatus, number>> = {
  not_applicable: 0,
  passed: 1,
  pending: 2,
  failed: 3,
};

function toIssues(prefix: string, error: z.ZodError): DecisionInputIssue[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

/** Collapses duplicate results per check, keeping the most severe status. */
function mergeResults(results: readonly CheckResult[]): Map<string, CheckResult> {
  const merged = new Map<string, CheckResult>();
  for (const current of results) {
    const previous = merged.get(current.name);
    if (!previous) {
      merged.set(current.name, { ...current, reasons: [...new Set(current.reasons)] });
    } else if (current.status === previous.status) {
      merged.set(current.name, {
        ...previous,
        reasons: [...new Set([...previous.reasons, ...current.reasons])],
      });
    } else if (SEVERITY[current.status] > SEVERITY[previous.status]) {
      merged.set(current.name, { ...current, reasons: [...new Set(current.reasons)] });
    }
  }
  return merged;
}

/** Whether a required `not_applicable` result leaves the check without evidence (C30.1). */
function blocksDecision(outcome: CheckResult): boolean {
  const nonBlocking: readonly string[] = NON_BLOCKING_NOT_APPLICABLE_REASONS;
  return (
    outcome.reasons.length === 0 || outcome.reasons.some((reason) => !nonBlocking.includes(reason))
  );
}

/**
 * Decides a verification's outcome from its check results (C30.1, ADR 0002 §3a, §3b). Over the
 * enabled, required checks:
 * 1. any `failed` → `failed` (retryable when every failing check is `user_behavior`);
 * 2. else any `pending` or missing result → `pending` when `moreResultsExpected`, otherwise
 *    `needs_review`;
 * 3. else any `not_applicable` with a reason outside {@link NON_BLOCKING_NOT_APPLICABLE_REASONS},
 *    or with no reason → `needs_review`;
 * 4. else, when no required check `passed` (a template requiring nothing, or only non-blocking
 *    answers), `needs_review`: a non-blocking answer is no evidence (the C30.1 amendment of
 *    Phase 5, V17, decision 49);
 * 5. else `passed`.
 *
 * Enabled checks that are not required are advisory and never change the decision. Disabled
 * checks and results for unconfigured checks are ignored. Duplicate results for one check are
 * merged conservatively (failed > pending > passed > not_applicable).
 *
 * @throws {InvalidDecisionInputError} when the results or configuration are malformed.
 */
export function decideVerification(
  results: readonly CheckResult[],
  templateConfig: VerificationTemplateConfig,
  options: DecideVerificationOptions = {},
): VerificationDecision {
  const parsedResults = z.array(checkResultSchema).safeParse(results);
  const parsedConfig = verificationTemplateConfigSchema.safeParse(templateConfig);
  if (!parsedResults.success || !parsedConfig.success) {
    throw new InvalidDecisionInputError([
      ...(parsedResults.success ? [] : toIssues('results', parsedResults.error)),
      ...(parsedConfig.success ? [] : toIssues('templateConfig', parsedConfig.error)),
    ]);
  }

  const byCheck = mergeResults(parsedResults.data);
  const failing: CheckResult[] = [];
  const pendingCheckIds: string[] = [];
  const reviewCheckIds: string[] = [];
  const advisoryFailedCheckIds: string[] = [];
  /** Required checks that answered `not_applicable` for a non-blocking reason. */
  const nonBlockingCheckIds: string[] = [];
  let anyRequiredPassed = false;

  for (const [checkId, { enabled, required }] of Object.entries(parsedConfig.data.checks)) {
    if (!enabled) {
      continue;
    }
    const outcome = byCheck.get(checkId);
    if (!required) {
      if (outcome?.status === 'failed') {
        advisoryFailedCheckIds.push(checkId);
      }
    } else if (!outcome || outcome.status === 'pending') {
      pendingCheckIds.push(checkId);
    } else if (outcome.status === 'failed') {
      failing.push(outcome);
    } else if (outcome.status === 'passed') {
      anyRequiredPassed = true;
    } else if (blocksDecision(outcome)) {
      reviewCheckIds.push(checkId);
    } else {
      nonBlockingCheckIds.push(checkId);
    }
  }

  let status: VerificationDecisionStatus = 'passed';
  if (failing.length > 0) {
    status = 'failed';
  } else if (pendingCheckIds.length > 0) {
    status = options.moreResultsExpected === true ? 'pending' : 'needs_review';
  } else if (reviewCheckIds.length > 0) {
    status = 'needs_review';
  } else if (!anyRequiredPassed) {
    status = 'needs_review';
    reviewCheckIds.push(...nonBlockingCheckIds);
  }

  return {
    status,
    failingCheckIds: failing.map((outcome) => outcome.name),
    pendingCheckIds,
    reviewCheckIds,
    advisoryFailedCheckIds,
    hints: failing
      .filter((outcome) => outcome.type === 'user_behavior')
      .map((outcome) => ({ checkId: outcome.name, reasons: outcome.reasons })),
    retryable: failing.length > 0 && failing.every((outcome) => outcome.type === 'user_behavior'),
  };
}

/** Template configuration that applies the registry defaults of one verification type. */
export function defaultTemplateConfig(
  verificationType: VerificationType,
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      listChecks(verificationType).map((check) => [
        check.id,
        { enabled: check.defaultEnabled, required: check.defaultRequired },
      ]),
    ),
  };
}
