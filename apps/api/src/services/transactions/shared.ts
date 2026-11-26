/**
 * C104, C105 (Workflow 7B): what the transaction services share: one change runs in one database
 * transaction with its staged events and audit entries, dispatched after the commit (C5, C15); the
 * lookups that answer 404 outside the environment; and the engine's problems as a problem document,
 * whose pointers name a position and never a value (C107.5).
 */
import type { EventName, EventPayload } from '@openverify/contracts';
import type { FieldProblem, FieldSchema, RelationSchema } from '@openverify/core';
import {
  getTransactionType,
  getTransactionTypeVersion,
  type Db,
  type TransactionType,
  type TransactionTypeVersion,
} from '@openverify/db';
import { NotFoundError, TransactionProblemError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from '../context.js';
import { fieldError } from '../lists/field-error.js';
import type { TransactionActing } from './acting.js';

export const TRANSACTION_TYPES_PATH = '/api/v1/transaction-types';
export const TRANSACTIONS_PATH = '/api/v1/transactions';

export interface TransactionChange {
  tx: Db;
  emit: (name: EventName, payload: EventPayload) => Promise<void>;
  audit: (action: AuditedAction) => Promise<void>;
  /** Events another service staged in this transaction, to dispatch with these. */
  adopt: (events: readonly StagedEvent[]) => void;
}

/** Runs `work` in one transaction and dispatches its staged events after the commit. */
export async function change<T>(
  deps: ApiDependencies,
  acting: TransactionActing,
  work: (change: TransactionChange) => Promise<T>,
): Promise<T> {
  const staged: StagedEvent[] = [];
  const result = await deps.db.transaction((tx) =>
    work(transactionChangeIn(tx, deps, acting, staged)),
  );
  await deps.events.dispatch(staged);
  return result;
}

/** C117.5: a change in the caller's transaction, whose events land in `staged`. */
export function transactionChangeIn(
  tx: Db,
  deps: Pick<ApiDependencies, 'events' | 'audit'>,
  acting: Pick<TransactionActing, 'ctx' | 'actor'>,
  staged: StagedEvent[],
): TransactionChange {
  const { environmentId } = acting.ctx;
  return {
    tx,
    emit: async (name, payload) => {
      staged.push(await deps.events.stage(tx, { environmentId, name, payload }));
    },
    audit: (action) => deps.audit.record(tx, auditEntryOf(acting.ctx, acting.actor, action)),
    adopt: (events) => {
      staged.push(...events);
    },
  };
}

/** @throws {NotFoundError} for a type this environment does not hold. */
export async function requireTransactionType(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TransactionType> {
  const type = await getTransactionType(db, environmentId, id);
  if (type === null) {
    throw new NotFoundError(`Transaction type ${id} was not found.`);
  }
  return type;
}

/** @throws {NotFoundError} for a version this environment does not hold. */
export async function requireTransactionTypeVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TransactionTypeVersion> {
  const version = await getTransactionTypeVersion(db, environmentId, id);
  if (version === null) {
    throw new NotFoundError(`Transaction type version ${id} was not found.`);
  }
  return version;
}

/** A stored version as the engine reads it. Stored versions passed the route's meta-schema. */
export function versionContent(version: TransactionTypeVersion) {
  return {
    id: version.id,
    fieldSchemas: version.fieldSchemas as readonly FieldSchema[],
    statuses: version.statuses,
    relationSchemas: version.relationSchemas as readonly RelationSchema[],
    allowCardLikeStrings: version.allowCardLikeStrings,
  };
}

/** The code a set of problems answers: the card guard first, then the first problem's own. */
function codeOf(problems: readonly FieldProblem[]): FieldProblem['code'] {
  if (problems.some((problem) => problem.code === 'card_number_refused')) {
    return 'card_number_refused';
  }
  return problems[0]?.code ?? 'field_schema_invalid';
}

const DETAILS: Readonly<Record<FieldProblem['code'], string>> = {
  card_number_refused: 'Looks like a card number; send a processor’s token instead.',
  field_schema_invalid: 'Does not fit its field schema.',
  relation_schema_unknown: 'The type declares no such relation for this object.',
  relation_target_unsupported: 'No producer of this relation target exists.',
  status_does_not_exist: 'The type has no such status.',
};

/**
 * The engine's problems as one problem document; each pointer is `prefix` plus the problem's own.
 * @throws {TransactionProblemError} always.
 */
export function throwFieldProblems(
  problems: readonly FieldProblem[],
  prefix: string,
  detail: string,
): never {
  throw new TransactionProblemError(codeOf(problems), detail, {
    errors: problems.map((problem) =>
      fieldError(`${prefix}${problem.pointer}`, DETAILS[problem.code]),
    ),
  });
}
