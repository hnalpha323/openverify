/**
 * C153.1 (review H07): the check panels' model, every fact from the registry and the contracts:
 *
 * - `checkRowsOf`: every check of a verification type in registry order, with its tier, type
 *   (`user_behavior` or `fraud`), stage and default requirement, and what the draft sets (a check
 *   the config does not list is not run: the map is complete, C11);
 * - `branchesReadingChecks`: the branch routes of a flow-spec 2 draft whose condition reads
 *   `verifications.<step>.checks.<check>.status` of a step of that type (C150.2);
 * - `checkDecision`: whether the check decides the verification (required), runs without deciding
 *   (ADR 0002 section 3c), is read by a branch, or does not run;
 * - `typeOptionsSchema`: only the type-level options the contract lets the type set (C153.5),
 *   derived at run time from `verificationConfigSchema`'s own refusals, never a list kept here.
 */
import {
  toApiVerificationType,
  fromApiVerificationType,
  verificationConfigSchema,
  verificationTypeForStep,
  type ApiVerificationType,
  type VerificationConfig,
} from '@openverify/contracts';
import {
  getCheckDefinition,
  listChecks,
  verificationTemplateConfigSchema,
  type CheckStage,
  type CheckTier,
  type CheckType,
} from '@openverify/core';
import type { AnyFlow, FlowStepType } from '@openverify/flow-spec';
import { z } from 'zod';

export type TypeConfig = NonNullable<VerificationConfig['government-id']>;

export type DefaultRequirement = 'required' | 'advisory' | 'disabled';

export interface CheckRow {
  readonly id: string;
  readonly description: string;
  readonly tier: CheckTier;
  readonly alternateTier: CheckTier | null;
  readonly checkType: CheckType;
  readonly stage: CheckStage;
  readonly defaultRequirement: DefaultRequirement;
  readonly enabled: boolean;
  readonly required: boolean;
  readonly config: Readonly<Record<string, unknown>> | undefined;
  /** The registry's schema of the check's per-template config; none when it takes none. */
  readonly configSchema: z.ZodType | undefined;
}

/** One branch route of the draft that reads a check. */
export interface BranchRead {
  readonly stepId: string;
  readonly stepName: string;
  readonly routeKey: string;
  readonly routeLabel: string;
}

export type CheckDecision = 'decides' | 'runs-not-deciding' | 'read-by-branch' | 'not-run';

/** Every check of `apiType`, in registry order, as `config` sets it. */
export function checkRowsOf(
  apiType: ApiVerificationType,
  config: TypeConfig | undefined,
): readonly CheckRow[] {
  return listChecks(fromApiVerificationType(apiType)).map((check) => {
    const set = config?.checks[check.id];
    return {
      id: check.id,
      description: check.description,
      tier: check.tier,
      alternateTier: check.alternateTier ?? null,
      checkType: check.checkType,
      stage: check.stage,
      defaultRequirement: !check.defaultEnabled
        ? 'disabled'
        : check.defaultRequired
          ? 'required'
          : 'advisory',
      enabled: set?.enabled ?? false,
      required: set?.required ?? false,
      config: set?.config,
      configSchema: check.configSchema,
    };
  });
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every `var` path a JSONLogic condition reads, in the order written. */
function varsOf(condition: unknown): string[] {
  if (Array.isArray(condition)) {
    return condition.flatMap(varsOf);
  }
  if (!isRecord(condition)) {
    return [];
  }
  return Object.entries(condition).flatMap(([operator, operand]) => {
    if (operator !== 'var') {
      return varsOf(operand);
    }
    const path: unknown = Array.isArray(operand) ? operand[0] : operand;
    return typeof path === 'string' ? [path] : [];
  });
}

const CHECK_PATH = /^verifications\.([^.]+)\.checks\.([^.]+)\.status$/;

/** The branch routes of a v2 draft that read each check of `apiType`, by check id. */
export function branchesReadingChecks(
  flow: AnyFlow,
  apiType: ApiVerificationType,
): ReadonlyMap<string, readonly BranchRead[]> {
  const reads = new Map<string, BranchRead[]>();
  if (flow.metadata.specVersion !== 2) {
    return reads;
  }
  const stepsOfType = new Set(
    flow.steps.filter((step) => apiTypeOfStep(step.type) === apiType).map((step) => step.id),
  );
  for (const step of flow.steps) {
    if (step.type !== 'branch') continue;
    for (const route of step.routes) {
      const checks = new Set(
        varsOf(route.condition).flatMap((path) => {
          const match = CHECK_PATH.exec(path);
          return match?.[1] !== undefined && match[2] !== undefined && stepsOfType.has(match[1])
            ? [match[2]]
            : [];
        }),
      );
      for (const check of checks) {
        reads.set(check, [
          ...(reads.get(check) ?? []),
          {
            stepId: step.id,
            stepName: step.name ?? step.id,
            routeKey: route.key,
            routeLabel: route.label,
          },
        ]);
      }
    }
  }
  return reads;
}

/** ADR 0002 section 3c: what the check's result does. */
export function checkDecision(row: CheckRow, reads: readonly BranchRead[]): CheckDecision {
  if (!row.enabled) return 'not-run';
  if (row.required) return 'decides';
  return reads.length > 0 ? 'read-by-branch' : 'runs-not-deciding';
}

const OPTION_SHAPE = (
  verificationTemplateConfigSchema as unknown as { shape: Record<string, z.ZodType> }
).shape;

/** Whether the contract refuses `option` on `apiType` for the type itself (never for its value). */
function typeTakes(apiType: ApiVerificationType, option: string): boolean {
  const probe = option === 'accept-review-without-provider' ? false : [];
  const issues =
    verificationConfigSchema.safeParse({ [apiType]: { checks: {}, [option]: probe } }).error
      ?.issues ?? [];
  return !issues.some(
    (issue) => issue.code === 'custom' && issue.path[0] === apiType && issue.path[1] === option,
  );
}

/** The type-level options `apiType` may set, as the contract's own member schemas. */
export function typeOptionsSchema(apiType: ApiVerificationType): z.ZodType {
  return z.strictObject(
    Object.fromEntries(
      Object.entries(OPTION_SHAPE).filter(
        ([option]) => option !== 'checks' && typeTakes(apiType, option),
      ),
    ),
  );
}

/** `config` with one check changed; `config: undefined` leaves the check's config out. */
export function withCheck(
  config: TypeConfig,
  checkId: string,
  patch: Partial<{
    enabled: boolean;
    required: boolean;
    config: Record<string, unknown> | undefined;
  }>,
): TypeConfig {
  const current = config.checks[checkId] ?? { enabled: false, required: false };
  const merged = { ...current, ...patch };
  const { config: checkConfig, ...switches } = merged;
  return {
    ...config,
    checks: {
      ...config.checks,
      [checkId]: checkConfig === undefined ? switches : { ...switches, config: checkConfig },
    },
  };
}

/** The API verification type a flow step creates, or `null` for a step that creates none. */
export function apiTypeOfStep(stepType: string): ApiVerificationType | null {
  const type = verificationTypeForStep(stepType as FlowStepType);
  return type === null ? null : toApiVerificationType(type);
}

/** The registry definition's words for a check id, for a heading's description. */
export const describeCheck = (checkId: string): string =>
  getCheckDefinition(checkId)?.description ?? checkId;
