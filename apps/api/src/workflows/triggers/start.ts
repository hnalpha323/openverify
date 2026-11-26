/**
 * What the routes that start a run share (C118.2, C118.5, C118.7, C121.3): the live target, the
 * checks a principal passes, and sealing a trigger's files. A run a principal starts needs
 * `workflows:trigger`, every scope of its version's grant and, when the grant's `pii` is true, PII
 * visibility; otherwise 403 naming what is missing. A paused or archived workflow, a module, and a
 * version no such trigger starts answer 409 `workflow_not_running`.
 */
import { createHash } from 'node:crypto';
import type { Permission, WorkflowTriggerType } from '@openverify/core';
import {
  createWorkflowRunFile,
  encryptBytes,
  getWorkflowLiveTarget,
  type Db,
  type WorkflowLiveTarget,
} from '@openverify/db';
import { canViewPii } from '../../auth/pii.js';
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  WorkflowProblemError,
} from '../../errors.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import type { Principal } from '../../ports.js';
import type { ApiDependencies } from '../../services/context.js';
import { newStorageKey } from '../../storage/index.js';
import type { WorkflowActing } from '../acting.js';
import { processActions } from '../engine/actions.js';
import type { EngineDeps } from '../engine/deps.js';
import type { TriggerFile } from './inputs.js';
import { chooseRolloutVersion } from './rollout.js';
import { readRunTarget, type RunTarget } from './start-target.js';

const NOT_RUNNING = 'This workflow is not running.';

/** The engine as the API process holds it. Without a producer the sweep takes the steps. */
export function engineOfApi(deps: ApiDependencies): EngineDeps {
  return {
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    events: deps.events,
    steps: deps.workflowSteps,
    inFlightCap: deps.workflowInFlightCap,
    queueInFlightCapMax: deps.queueInFlightCapMax,
    actions: processActions(),
  };
}

export const principalIdOf = (principal: Principal): string =>
  principal.kind === 'api-key' ? principal.apiKeyId : principal.userId;

export const creatorOf = (principal: Principal) =>
  ({
    type: principal.kind === 'api-key' ? 'api-key' : 'user',
    id: principalIdOf(principal),
  }) as const;

/**
 * C112.6: the column outlives the 24-hour store, so it holds a digest of the key and its principal,
 * and a client's text never sits in a plaintext column.
 */
export const idempotencyDigest = (principal: Principal, key: string): string =>
  createHash('sha256')
    .update(`${principalIdOf(principal)}\u0000${key}`)
    .digest('hex');

async function consume(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  policy: 'workflow-triggers' | 'workflow-triggers-key',
  subject: string,
): Promise<void> {
  let decision;
  try {
    decision = await deps.rateLimiter.consume(`${policy}:${subject}`, rateLimitRules()[policy]);
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError(
      'Too many workflow triggers; retry later.',
      decision.retryAfterSeconds,
    );
  }
}

/**
 * C143.3: the route policies, which follow C12, so a limiter that cannot answer lets a request by.
 * @throws {RateLimitedError} 429 with `Retry-After` beyond a limit.
 */
export async function consumeTriggerRate(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  acting: WorkflowActing,
): Promise<void> {
  await consume(deps, 'workflow-triggers-key', principalIdOf(acting.principal));
  await consume(deps, 'workflow-triggers', acting.ctx.environmentId);
}

const noTrigger = (trigger: WorkflowTriggerType) =>
  new WorkflowProblemError(
    'workflow_not_running',
    `This workflow’s live version has no ${trigger} trigger.`,
  );

/** The workflow and its live versions, or the problem it answers. */
export async function runningWorkflow(
  db: Db,
  environmentId: string,
  workflowId: string,
): Promise<WorkflowLiveTarget> {
  const live = await getWorkflowLiveTarget(db, environmentId, workflowId);
  if (live === null) {
    throw new NotFoundError(`Workflow ${workflowId} was not found.`);
  }
  if (live.workflow.status !== 'running' || live.workflow.kind !== 'workflow') {
    throw new WorkflowProblemError('workflow_not_running', NOT_RUNNING);
  }
  return live;
}

/** C116.3: the version this subject runs, when it is one `trigger` starts. */
export function targetFor(
  live: WorkflowLiveTarget,
  subjectKey: string,
  trigger: WorkflowTriggerType,
): RunTarget {
  const choice = chooseRolloutVersion(live.version, live.deployment, live.versions, subjectKey);
  const target =
    choice === null ? null : readRunTarget(choice.version, choice.deploymentId, choice.label);
  if (target?.definition.trigger?.type !== trigger) {
    throw noTrigger(trigger);
  }
  return target;
}

/**
 * C116.3, C121.3: a call that fans out over objects can land on either side of a rollout, so the
 * caller must be able to start both, and both must be versions this trigger starts.
 * @throws {WorkflowProblemError} `workflow_not_running`.
 * @throws {ForbiddenError} 403 naming what is missing.
 */
export function assertMayStartEverySide(
  principal: Principal,
  live: WorkflowLiveTarget,
  trigger: WorkflowTriggerType,
): void {
  const sides = live.deployment === null ? [live.version] : live.versions;
  for (const version of sides) {
    const target = version === null ? null : readRunTarget(version, null, null);
    if (target?.definition.trigger?.type !== trigger) {
      throw noTrigger(trigger);
    }
    assertMayStart(principal, target);
  }
}

/** What `principal` lacks to start `target`; `pii:view` names PII visibility. */
export function missingForStart(principal: Principal, target: RunTarget): string[] {
  const needed: Permission[] = ['workflows:trigger', ...target.grant.scopes];
  const missing: string[] = needed.filter((scope) => !principal.permissions.has(scope));
  return target.grant.pii && !canViewPii(principal) ? [...missing, 'pii:view'] : missing;
}

/** @throws {ForbiddenError} 403 naming what is missing (C121.3). */
export function assertMayStart(principal: Principal, target: RunTarget): void {
  const missing = missingForStart(principal, target);
  if (missing.length > 0) {
    throw new ForbiddenError('Starting this workflow needs more than you hold.', missing);
  }
}

export interface StoredTriggerFile extends TriggerFile {
  storageKey: string;
  wrappedDek: string;
}

/** C118.2: each file sealed with its id as its context, before the run's transaction. */
export async function storeTriggerFiles(
  deps: Pick<ApiDependencies, 'storage' | 'keyring'>,
  environmentId: string,
  files: readonly TriggerFile[],
): Promise<StoredTriggerFile[]> {
  const stored: StoredTriggerFile[] = [];
  for (const file of files) {
    const storageKey = newStorageKey(environmentId);
    const sealed = encryptBytes(file.bytes, deps.keyring, { context: file.id });
    await deps.storage.put(storageKey, sealed.ciphertext);
    stored.push({ ...file, storageKey, wrappedDek: sealed.wrappedDek });
  }
  return stored;
}

/** Best effort: an object no row names is never read, and a failed delete fails nothing. */
export async function removeTriggerFiles(
  deps: Pick<ApiDependencies, 'storage'>,
  files: readonly StoredTriggerFile[],
): Promise<void> {
  await Promise.allSettled(files.map(({ storageKey }) => deps.storage.delete(storageKey)));
}

export async function recordTriggerFiles(
  tx: Db,
  environmentId: string,
  runId: string,
  files: readonly StoredTriggerFile[],
): Promise<void> {
  for (const { id, storageKey, wrappedDek, filename, mimeType, bytes, sha256 } of files) {
    await createWorkflowRunFile(tx, environmentId, {
      id,
      runId,
      storageKey,
      wrappedDek,
      filename,
      mimeType,
      byteSize: bytes.byteLength,
      sha256,
    });
  }
}
