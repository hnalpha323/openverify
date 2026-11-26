/**
 * C105.5 (Workflow 7B): the service half of a transaction's redaction, in the caller's transaction.
 * `RedactionService.redactTransaction` (`services/redaction.ts`) runs it, records the audit entry
 * and deletes the files it returns after the commit; `DELETE /transactions/:id` and the C16 pass
 * both go through that.
 *
 * Owner: `api-transactions`; `foundation-7b` (Stage 1b (T)) built the database part,
 * `redactTransactionRecords` in `@openverify/db`, which locks the row. This hook reads the pinned
 * version and passes the keys of its top-level `redaction-policy: never` fields as `keepFieldKeys`,
 * or `[]` with `includeNever` (P21), then stages `transaction.redacted` once, on a first redaction
 * only, with `fields: null` in its resource (C107.5).
 */
import type { FieldSchema } from '@openverify/core';
import {
  getTransaction,
  getTransactionTypeVersion,
  redactTransactionRecords,
  type Db,
  type TransactionFile,
} from '@openverify/db';
import { UNMASKED } from '../../auth/pii.js';
import { transactionResource } from './resources.js';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type { Clock } from '../../ports.js';
import { redactTransactionChildrenInTx } from '../../workflows/actions/transactions/children.js';
import { redactRunsForSubjectsInTx } from '../../workflows/runs/redaction.js';
import { redactDecisionCommentsInTx } from '../decisions/redaction.js';
import { connectRedactionHooks } from '../connect/redaction-hooks.js';

export interface TransactionRedactionDeps {
  events: TransactionalEventPublisher;
  clock: Clock;
}

export interface RedactTransactionInTxOptions {
  at: Date;
  /** `meta.include-never`: the `never` fields go too (P21). */
  includeNever: boolean;
}

export interface RedactedTransaction {
  redactedAt: Date;
  alreadyRedacted: boolean;
  /** Delete these objects after the commit. */
  files: readonly TransactionFile[];
  /** C127.7: what a cascade to a run's children left to delete after the commit. */
  storageKeys: readonly string[];
  staged: readonly StagedEvent[];
  stubbedEvents: number;
}

export type RedactTransactionInTx = (
  tx: Db,
  deps: TransactionRedactionDeps,
  environmentId: string,
  transactionId: string,
  options: RedactTransactionInTxOptions,
) => Promise<RedactedTransaction | null>;

/** The keys a redaction keeps: the version's top-level `never` fields (C104.2, P21). */
export function neverFieldKeys(fieldSchemas: readonly FieldSchema[]): string[] {
  return fieldSchemas
    .filter((field) => field.config?.['redaction-policy'] === 'never')
    .map((field) => field.key);
}

/** `null` when the transaction is not in this environment. */
export const redactTransactionInTx: RedactTransactionInTx = async (
  tx,
  deps,
  environmentId,
  transactionId,
  options,
) => {
  const current = await getTransaction(tx, environmentId, transactionId);
  if (current === null) {
    return null;
  }
  const version = await getTransactionTypeVersion(
    tx,
    environmentId,
    current.transactionTypeVersionId,
  );
  const keep = options.includeNever
    ? []
    : neverFieldKeys((version?.fieldSchemas ?? []) as readonly FieldSchema[]);
  const redacted = await redactTransactionRecords(tx, environmentId, transactionId, {
    at: options.at,
    keepFieldKeys: keep,
  });
  if (redacted === null) {
    return null;
  }
  // C120.9 (F35): the runs that recorded the transaction (`api-engine`); also on a re-run.
  await redactRunsForSubjectsInTx(tx, {
    environmentId,
    subjectIds: [transactionId],
    at: options.at,
  });
  // C128.1 (V25): its decisions stay, and only their comments go (`api-actions`).
  await redactDecisionCommentsInTx(tx, {
    environmentId,
    subjectIds: [transactionId],
    at: options.at,
  });
  // C241.1-C241.3 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook; Stage 1a amendment 18):
  // Connect's tokens and consent records of the transaction, reached by the inquiry and account
  // cascades too (`api-consent`'s redaction-hooks.ts).
  await connectRedactionHooks.transactionRedactedInTx(tx, {
    environmentId,
    id: transactionId,
    at: options.at,
  });
  // C127.7 (F35): the objects a run created, never its `transaction_objects` (`api-actions`); also
  // on a re-run, for a child created since.
  const children = await redactTransactionChildrenInTx(tx, deps, {
    environmentId,
    transactionId,
    at: options.at,
  });
  const staged: StagedEvent[] = [...children.staged];
  if (!redacted.alreadyRedacted) {
    staged.push(
      await deps.events.stage(tx, {
        environmentId,
        name: 'transaction.redacted',
        payload: {
          data: await transactionResource(tx, environmentId, redacted.transaction, {
            mask: UNMASKED,
            forEvent: true,
          }),
        },
      }),
    );
  }
  return {
    redactedAt: redacted.transaction.redactedAt ?? options.at,
    alreadyRedacted: redacted.alreadyRedacted,
    files: redacted.files,
    storageKeys: children.storageKeys,
    staged,
    stubbedEvents: redacted.stubbedEvents,
  };
};
