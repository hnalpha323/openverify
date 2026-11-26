/**
 * C129-C137 (Workflow 8B, `api-cases`): what the case services share.
 *
 * - One change runs in one database transaction with its history rows, its staged events and its
 *   audit entries, and the events are dispatched after the commit (C5, C131.2).
 * - Every change takes the case row `FOR UPDATE`, refuses a case the reader may not see (404, P14) or
 *   one that was redacted (410 `case_redacted`), and checks `lock-version` when one is sent (409
 *   `case_version_conflict`, which names the current one and nothing else).
 * - The reader of a query: a user through their roles, a key through its `case-template-ids`.
 */
import {
  CASE_TRANSITION_REFUSALS,
  DEFAULT_CASE_RESOLUTIONS,
  DEFAULT_CASE_STATUSES,
  defaultCaseTransitions,
  type CaseStatusCategory,
  type CaseStatusDefinition,
  type CaseStatusMachine,
} from '@openverify/core';
import type { AuditActor, EventName, EventPayload } from '@openverify/contracts';
import {
  appendCaseHistory,
  getCaseRows,
  lockCaseRow,
  hiddenCaseObjectIds,
  type Case,
  type CaseReader,
  type CaseTemplateVersionRow,
  type Db,
  type NewCaseHistoryRow,
} from '@openverify/db';
import { NotFoundError } from '../../errors.js';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type { AuditLogger, Clock, Principal, ServiceContext } from '../../ports.js';
import type { PiiMask } from '../../auth/pii.js';
import { auditEntryOf, type AuditedAction } from '../context.js';
import { CaseProblemError } from './problems.js';

export const CASES_PATH = '/api/v1/cases';

/** A C9 filter's comma-separated values, already validated by the route's schema. */
export const filterList = (value: string | undefined): string[] | undefined =>
  value === undefined ? undefined : value.split(',');

/** The C9 created-at range a list query carries (the route validated both). */
export function createdAtOf(query: object): { start: string | undefined; end: string | undefined } {
  const range = query as { 'filter[created-at-start]'?: string; 'filter[created-at-end]'?: string };
  return { start: range['filter[created-at-start]'], end: range['filter[created-at-end]'] };
}

/** A C9 timestamp filter as a date. */
export const dateOf = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

/** What a case write needs: the API's dependencies have it, and so does the bulk job. */
export interface CaseWriteDeps {
  db: Db;
  events: TransactionalEventPublisher;
  audit: AuditLogger;
  clock: Clock;
}

/** Who acts on a case: the request's principal, or the bulk job acting as the action's creator. */
export interface CaseActor {
  ctx: ServiceContext;
  actor: AuditActor;
  mask: PiiMask;
  /** `null` for the system acting as a principal it read back (the bulk job). */
  principal: Principal | null;
}

/** C129.4: a principal as a case reader; the system reads every template. */
export function readerOf(principal: Principal | null): CaseReader {
  if (principal === null) {
    return { kind: 'system' };
  }
  return principal.kind === 'user'
    ? { kind: 'user', userId: principal.userId }
    : { kind: 'api-key', apiKeyId: principal.apiKeyId };
}

/** The reader an actor stands for: the principal, or the actor it acts as. */
export function readerOfActor(acting: CaseActor): CaseReader {
  if (acting.principal !== null) {
    return readerOf(acting.principal);
  }
  switch (acting.actor.type) {
    case 'user':
      return { kind: 'user', userId: acting.actor.id };
    case 'api-key':
      return { kind: 'api-key', apiKeyId: acting.actor.id };
    case 'workflow-run':
      return { kind: 'system' };
  }
}

/** A case actor pair (C129.2): the audit actor's type and id. */
export const actorPair = (actor: AuditActor) => ({ type: actor.type, id: actor.id });

/** One change of a case: its transaction, staged events, history and audit. */
export interface CaseUnit {
  tx: Db;
  deps: CaseWriteDeps;
  acting: CaseActor;
  at: Date;
  staged: StagedEvent[];
  emit: (name: EventName, payload: EventPayload) => Promise<void>;
  history: (rows: readonly NewCaseHistoryRow[]) => Promise<void>;
  audit: (action: AuditedAction) => Promise<void>;
}

/** A unit in the caller's transaction, whose events land in `staged`. */
export function caseUnitIn(
  tx: Db,
  deps: CaseWriteDeps,
  acting: CaseActor,
  staged: StagedEvent[],
  at: Date = deps.clock.now(),
): CaseUnit {
  const { environmentId } = acting.ctx;
  return {
    tx,
    deps,
    acting,
    at,
    staged,
    emit: async (name, payload) => {
      staged.push(await deps.events.stage(tx, { environmentId, name, payload }));
    },
    history: async (rows) => {
      await appendCaseHistory(tx, environmentId, rows);
    },
    audit: (action) => deps.audit.record(tx, auditEntryOf(acting.ctx, acting.actor, action)),
  };
}

/**
 * K8-35 (plan item 77): how often a case transaction is run in all when Postgres aborts it as a
 * deadlock (`40P01`) or a serialisation failure (`40001`). A queue's members change and archiving
 * lock the queue and then its cases, while an entry, the pull and the reassign sweep lock a case and
 * then its queue; the one Postgres aborts runs again from the start, so a known race is never a 500.
 */
export const CASE_TRANSACTION_ATTEMPTS = 3;

const RETRYABLE_SQLSTATE: ReadonlySet<string> = new Set(['40001', '40P01']);

/** A deadlock or serialisation failure, anywhere in the error's causes. */
export function isRetryableTransactionError(error: unknown): boolean {
  for (let current = error; typeof current === 'object' && current !== null;) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && RETRYABLE_SQLSTATE.has(code)) {
      return true;
    }
    current = cause;
  }
  return false;
}

/**
 * Runs `work` in one transaction and dispatches its staged events after the commit. A transaction
 * Postgres aborted as a deadlock or a serialisation failure runs again, at most
 * {@link CASE_TRANSACTION_ATTEMPTS} times in all, with nothing of the aborted one kept.
 */
export async function caseChange<T>(
  deps: CaseWriteDeps,
  acting: CaseActor,
  work: (unit: CaseUnit) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const staged: StagedEvent[] = [];
    let result: T;
    try {
      result = await deps.db.transaction((tx) => work(caseUnitIn(tx, deps, acting, staged)));
    } catch (error) {
      if (attempt >= CASE_TRANSACTION_ATTEMPTS || !isRetryableTransactionError(error)) {
        throw error;
      }
      continue;
    }
    await deps.events.dispatch(staged);
    return result;
  }
}

/** The history row's actor: the unit's. */
export function historyActor(acting: CaseActor): Pick<NewCaseHistoryRow, 'actorType' | 'actorId'> {
  return { actorType: acting.actor.type, actorId: acting.actor.id };
}

/** C129.4: whether the reader may see the case or comment ids. */
export async function assertCaseVisible(db: Db, acting: CaseActor, caseId: string): Promise<void> {
  const hidden = await hiddenCaseObjectIds(db, acting.ctx.environmentId, readerOfActor(acting), [
    caseId,
  ]);
  if (hidden.has(caseId)) {
    throw new NotFoundError(`Case ${caseId} was not found.`);
  }
}

/** The case the reader may see, or 404 (P14: a hidden case reads as one that does not exist). */
export async function requireVisibleCase(db: Db, acting: CaseActor, id: string): Promise<Case> {
  const [found] = await getCaseRows(db, acting.ctx.environmentId, readerOfActor(acting), [id]);
  if (found === undefined) {
    throw new NotFoundError(`Case ${id} was not found.`);
  }
  return found;
}

/**
 * C131.2: the case under its lock, visible, unredacted, and at `lockVersion` when one was sent.
 * @throws {NotFoundError} for a case the reader may not see.
 * @throws {CaseProblemError} `case_redacted` or `case_version_conflict`.
 */
export async function lockWritableCase(
  unit: CaseUnit,
  id: string,
  lockVersion?: number,
): Promise<Case> {
  const found = await lockCaseRow(unit.tx, unit.acting.ctx.environmentId, id);
  if (found === null) {
    throw new NotFoundError(`Case ${id} was not found.`);
  }
  await assertCaseVisible(unit.tx, unit.acting, id);
  if (found.redactedAt !== null) {
    throw new CaseProblemError('case_redacted', `Case ${id} was redacted; it takes no change.`);
  }
  if (lockVersion !== undefined && lockVersion !== found.lockVersion) {
    throw new CaseProblemError(
      'case_version_conflict',
      'The case changed since that lock-version; read it again.',
      { members: { 'lock-version': found.lockVersion } },
    );
  }
  return found;
}

/** A stored status, with C130.2's defaults for the flags a seed or an older writer left out. */
export function statusDefinitionOf(value: unknown): CaseStatusDefinition {
  const status = value as Partial<CaseStatusDefinition> & {
    key: string;
    label: string;
    category: CaseStatusCategory;
  };
  return {
    key: status.key,
    label: status.label,
    category: status.category,
    'pauses-sla': status['pauses-sla'] ?? false,
    'required-comment': status['required-comment'] ?? false,
    'status-tags': status['status-tags'] ?? [],
    'status-tag-required': status['status-tag-required'] ?? false,
  };
}

/** C130.2: a pinned version as the status machine reads it; a version with no map allows every move. */
export function statusMachineOf(version: CaseTemplateVersionRow): CaseStatusMachine {
  const statuses = version.statuses.map(statusDefinitionOf);
  return {
    statuses,
    resolutions: version.resolutions,
    transitions: version.transitions ?? defaultCaseTransitions(statuses),
  };
}

/** The defaults a first draft holds (C130.2, decision 54). */
export const DEFAULT_VERSION_STATUSES = DEFAULT_CASE_STATUSES;
export const DEFAULT_VERSION_RESOLUTIONS = DEFAULT_CASE_RESOLUTIONS;

/** The status machine's refusals are case problems of the same names (C129.7). */
export function isTransitionRefusal(
  code: string,
): code is (typeof CASE_TRANSITION_REFUSALS)[number] {
  return (CASE_TRANSITION_REFUSALS as readonly string[]).includes(code);
}
