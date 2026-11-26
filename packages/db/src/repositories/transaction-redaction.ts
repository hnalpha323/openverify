/**
 * C105.5, C16 (Workflow 7B): the database part of a transaction's redaction, in one transaction with
 * the row locked. `api-transactions`' hook (`services/transactions/redaction.ts`) names the fields
 * that stay and emits `transaction.redacted`; `RedactionService.redactTransaction` audits the
 * request and deletes the storage objects after the commit.
 *
 * | Table | What happens |
 * |---|---|
 * | `transactions` | `fields` -> the kept fields, sealed again, or null; `redacted_at` set (the first time stays) |
 * | `transaction_field_keys` | deleted, but for the kept fields |
 * | `transaction_filter_values` | deleted, but for the kept fields (Workflow 9B Stage 1b (X), C165.3) |
 * | `transaction_files` | `filename` -> null, `redacted_at` set; returned until marked `deleted_at` |
 * | `transaction_labels` | `label`, `model_version` -> null, `redacted_at` set; the score stays |
 * | `transaction_status_history` | `from_status`, `to_status` -> null, `redacted_at` set; who and when stay |
 * | `transaction_objects`, `transaction_relations` | nothing: independent objects, ids only (C105.5) |
 * | `events` | payloads of the transaction, its files and labels -> the C16 stub (P04) |
 * | `api_logs`, `idempotency_keys` | stored copies about or mentioning them forgotten (P04) |
 *
 * The current `status`, `reference_id` and tags stay: the resource serves them, and C105.8 says none
 * is PII. Every step is idempotent, and a later run can take a field an earlier run kept: that is
 * the audited legal-erasure override of `meta.include-never` (P21).
 */
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, sealJson } from '../sealed.js';
import {
  faceTemplates,
  files,
  inquiries,
  selfieBackgrounds,
  transactionFieldKeys,
  transactionFilterValues,
  transactionObjects,
  transactionFiles,
  transactionLabels,
  transactionRelations,
  transactionStatusHistory,
  transactions,
  verifications,
  type StoredFile,
} from '../schema.js';
import { forgetStoredResponses, stubEventPayloads, type RedactOptions } from './redaction.js';
import { firstOrNull, inserted } from './rows.js';
import { toTransactionFile, type TransactionFile } from './transaction-files.js';
import { toTransaction, type Transaction } from './transactions.js';

export interface TransactionRedactionOptions extends RedactOptions {
  /**
   * The fields that stay: the pinned version's `never` fields, `[]` with `meta.include-never`
   * (C105.5, P21). Their field keys stay with them.
   */
  keepFieldKeys?: readonly string[];
}

export interface TransactionRedaction {
  transaction: Transaction;
  /** The transaction was already redacted; `redactedAt` keeps the first time. */
  alreadyRedacted: boolean;
  /**
   * Files not yet marked deleted: delete their objects from storage, then call
   * `markTransactionFilesDeleted`. A re-run returns those a failed run left behind.
   */
  files: TransactionFile[];
  /** Event payloads replaced by the C16 stub in this call. */
  stubbedEvents: number;
}

/** Locks the environment's transactions among `ids` not yet redacted, by id; answers their ids. */
async function lockUnredactedTransactions(
  tx: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.environmentId, environmentId),
        inArray(transactions.id, [...ids]),
        isNull(transactions.redactedAt),
      ),
    )
    .orderBy(asc(transactions.id))
    .for('update');
  return rows.map((row) => row.id);
}

/**
 * K7B-1 (owner decision 1 after Workflow 7B): locks the transactions a redaction of the inquiry
 * reaches, those whose `transaction_objects` names it or one of its verifications, and answers
 * their ids; one already redacted is left out, so a pass redacts each at most once.
 *
 * Call it before locking the inquiry. `add-objects` holds the transaction's row while its foreign
 * key share-locks the inquiry's, so a transaction always comes first and the two cannot deadlock.
 */
export async function lockInquiryTransactions(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<string[]> {
  const ofInquiry = await tx
    .select({ id: verifications.id })
    .from(verifications)
    .where(
      and(eq(verifications.environmentId, environmentId), eq(verifications.inquiryId, inquiryId)),
    );
  const linked = await tx
    .select({ id: transactionObjects.transactionId })
    .from(transactionObjects)
    .where(
      and(
        eq(transactionObjects.environmentId, environmentId),
        inArray(transactionObjects.objectId, [inquiryId, ...ofInquiry.map((row) => row.id)]),
      ),
    );
  return lockUnredactedTransactions(
    tx,
    environmentId,
    linked.map((row) => row.id),
  );
}

/**
 * K7B-1: as {@link lockInquiryTransactions}, for an account: the transactions linked through
 * `transaction_objects.account_id` or `transaction_relations.account_id`. Those of its inquiries
 * follow from redacting the inquiries.
 */
export async function lockAccountTransactions(
  tx: Db,
  environmentId: string,
  accountId: string,
): Promise<string[]> {
  const attached = await tx
    .select({ id: transactionObjects.transactionId })
    .from(transactionObjects)
    .where(
      and(
        eq(transactionObjects.environmentId, environmentId),
        eq(transactionObjects.objectId, accountId),
      ),
    );
  const related = await tx
    .select({ id: transactionRelations.transactionId })
    .from(transactionRelations)
    .where(
      and(
        eq(transactionRelations.environmentId, environmentId),
        eq(transactionRelations.targetId, accountId),
      ),
    );
  return lockUnredactedTransactions(
    tx,
    environmentId,
    [...attached, ...related].map((row) => row.id),
  );
}

/** The sealed `fields` holding only the kept keys; `null` when none of them is there. */
function retainedFields(row: typeof transactions.$inferSelect, keep: readonly string[]) {
  if (row.fieldsSealed === null) {
    return null;
  }
  const fields = openJson(SEALED.transactionFields, row.id, row.fieldsSealed) as Readonly<
    Record<string, unknown>
  >;
  const kept = Object.entries(fields).filter(([key]) => keep.includes(key));
  return kept.length === 0
    ? null
    : sealJson(SEALED.transactionFields, row.id, Object.fromEntries(kept));
}

/**
 * Redacts the transaction's own data; `null` when it is not in this environment. See the module
 * comment for what each table keeps.
 */
export async function redactTransactionRecords(
  db: Db,
  environmentId: string,
  transactionId: string,
  options: TransactionRedactionOptions = {},
): Promise<TransactionRedaction | null> {
  return db.transaction(async (tx) => {
    const isThis = and(
      eq(transactions.id, transactionId),
      eq(transactions.environmentId, environmentId),
    );
    const current = firstOrNull(await tx.select().from(transactions).where(isThis).for('update'));
    if (current === null) {
      return null;
    }
    const at = current.redactedAt ?? options.at ?? new Date();
    const keep = options.keepFieldKeys ?? [];
    const transaction = toTransaction(
      inserted(
        await tx
          .update(transactions)
          .set({ fieldsSealed: retainedFields(current, keep), redactedAt: at })
          .where(isThis)
          .returning(),
        'redactTransactionRecords',
      ),
    );
    await tx
      .delete(transactionFieldKeys)
      .where(
        and(
          eq(transactionFieldKeys.environmentId, environmentId),
          eq(transactionFieldKeys.transactionId, transactionId),
          keep.length === 0 ? undefined : notInArray(transactionFieldKeys.fieldKey, [...keep]),
        ),
      );
    // C165.3: the plaintext projection of the filterable fields goes with the fields it projects.
    await tx
      .delete(transactionFilterValues)
      .where(
        and(
          eq(transactionFilterValues.environmentId, environmentId),
          eq(transactionFilterValues.transactionId, transactionId),
          keep.length === 0 ? undefined : notInArray(transactionFilterValues.fieldKey, [...keep]),
        ),
      );
    const files = await tx
      .update(transactionFiles)
      .set({
        filenameSealed: null,
        redactedAt: sql`coalesce(${transactionFiles.redactedAt}, ${at.toISOString()}::timestamptz)`,
      })
      .where(
        and(
          eq(transactionFiles.environmentId, environmentId),
          eq(transactionFiles.transactionId, transactionId),
        ),
      )
      .returning();
    const labels = await tx
      .select({ id: transactionLabels.id })
      .from(transactionLabels)
      .where(
        and(
          eq(transactionLabels.environmentId, environmentId),
          eq(transactionLabels.transactionId, transactionId),
        ),
      );
    // C105.4: the one update the append-only trigger lets through, local to this transaction.
    await tx.execute(sql`select set_config('openverify.transaction_redaction', 'on', true)`);
    await tx
      .update(transactionLabels)
      .set({ label: null, modelVersion: null, redactedAt: at })
      .where(
        and(
          eq(transactionLabels.environmentId, environmentId),
          eq(transactionLabels.transactionId, transactionId),
          isNull(transactionLabels.redactedAt),
        ),
      );
    await tx
      .update(transactionStatusHistory)
      .set({ fromStatus: null, toStatus: null, redactedAt: at })
      .where(
        and(
          eq(transactionStatusHistory.environmentId, environmentId),
          eq(transactionStatusHistory.transactionId, transactionId),
          isNull(transactionStatusHistory.redactedAt),
        ),
      );
    await tx.execute(sql`select set_config('openverify.transaction_redaction', 'off', true)`);
    const objectIds = [
      transactionId,
      ...files.map((file) => file.id),
      ...labels.map((label) => label.id),
    ];
    const stubbedEvents = await stubEventPayloads(tx, environmentId, objectIds, at);
    await forgetStoredResponses(tx, environmentId, objectIds);
    return {
      transaction,
      alreadyRedacted: current.redactedAt !== null,
      files: files.filter((file) => file.deletedAt === null).map(toTransactionFile),
      stubbedEvents,
    };
  });
}

// C105.6: the database part of `POST /transactions/:id/redact-biometrics`, run by the service in
// one transaction under the Phase 4 lock order (the inquiries first, by id), with
// `BiometricItemRedactor` for the list items; the returned objects go after the commit.

/** The objects whose biometric data a transaction's redaction reaches. */
export interface TransactionBiometricScope {
  /** Attached inquiries, the attached accounts' inquiries and the inquiries of the verifications. */
  inquiryIds: string[];
  /** Attached verifications, those named by field values, and the verifications of the inquiries. */
  verificationIds: string[];
}

export async function listTransactionBiometricScope(
  tx: Db,
  environmentId: string,
  transactionId: string,
  namedVerificationIds: readonly string[],
): Promise<TransactionBiometricScope> {
  const objects = await tx
    .select({
      accountId: transactionObjects.accountId,
      inquiryId: transactionObjects.inquiryId,
      verificationId: transactionObjects.verificationId,
    })
    .from(transactionObjects)
    .where(
      and(
        eq(transactionObjects.environmentId, environmentId),
        eq(transactionObjects.transactionId, transactionId),
      ),
    );
  const present = (values: (string | null)[]) =>
    values.filter((value): value is string => value !== null);
  const accountIds = present(objects.map((row) => row.accountId));
  const attachedInquiries = present(objects.map((row) => row.inquiryId));
  const ownVerifications = [
    ...present(objects.map((row) => row.verificationId)),
    ...namedVerificationIds,
  ];
  const ofAccounts =
    accountIds.length === 0
      ? []
      : await tx
          .select({ id: inquiries.id })
          .from(inquiries)
          .where(
            and(
              eq(inquiries.environmentId, environmentId),
              inArray(inquiries.accountId, accountIds),
            ),
          );
  const whole = [...attachedInquiries, ...ofAccounts.map((row) => row.id)];
  const verificationRows =
    whole.length === 0 && ownVerifications.length === 0
      ? []
      : await tx
          .select({ id: verifications.id, inquiryId: verifications.inquiryId })
          .from(verifications)
          .where(
            and(
              eq(verifications.environmentId, environmentId),
              or(
                whole.length === 0 ? undefined : inArray(verifications.inquiryId, whole),
                ownVerifications.length === 0
                  ? undefined
                  : inArray(verifications.id, ownVerifications),
              ),
            ),
          );
  return {
    inquiryIds: [...new Set([...whole, ...verificationRows.map((row) => row.inquiryId)])].sort(),
    verificationIds: [...new Set(verificationRows.map((row) => row.id))].sort(),
  };
}

/** C105.6: the file kinds that hold a face: selfie poses, ID portrait crops, chip portraits. */
const BIOMETRIC_FILE_KINDS = [
  'selfie-center',
  'selfie-left',
  'selfie-right',
  'portrait',
  'chip-dg2',
  'chip-portrait',
] as const;

export interface TransactionBiometricRedaction {
  faceTemplates: number;
  selfieBackgrounds: number;
  /** Biometric files not yet deleted: delete their objects, then `markFilesDeleted`. */
  files: StoredFile[];
  /** The first time stays. */
  biometricsRedactedAt: Date;
}

/**
 * Locks the inquiries (by id, the Phase 4 order), deletes the verifications' face templates and
 * background rows, reads their biometric files and stamps `biometrics_redacted_at` (the first time
 * stays); `null` when the transaction is not in this environment.
 */
export async function redactTransactionBiometricRows(
  tx: Db,
  environmentId: string,
  transactionId: string,
  input: TransactionBiometricScope & { at: Date },
): Promise<TransactionBiometricRedaction | null> {
  const stamped = firstOrNull(
    await tx
      .update(transactions)
      .set({
        biometricsRedactedAt: sql`coalesce(${transactions.biometricsRedactedAt}, ${input.at.toISOString()}::timestamptz)`,
      })
      .where(and(eq(transactions.environmentId, environmentId), eq(transactions.id, transactionId)))
      .returning({ at: transactions.biometricsRedactedAt }),
  );
  if (stamped?.at == null) {
    return null;
  }
  if (input.inquiryIds.length > 0) {
    await tx
      .select({ id: inquiries.id })
      .from(inquiries)
      .where(
        and(eq(inquiries.environmentId, environmentId), inArray(inquiries.id, input.inquiryIds)),
      )
      .orderBy(asc(inquiries.id))
      .for('update');
  }
  if (input.verificationIds.length === 0) {
    return { faceTemplates: 0, selfieBackgrounds: 0, files: [], biometricsRedactedAt: stamped.at };
  }
  const backgrounds = await tx
    .delete(selfieBackgrounds)
    .where(
      and(
        eq(selfieBackgrounds.environmentId, environmentId),
        inArray(selfieBackgrounds.verificationId, input.verificationIds),
      ),
    )
    .returning({ id: selfieBackgrounds.id });
  const templates = await tx
    .delete(faceTemplates)
    .where(
      and(
        eq(faceTemplates.environmentId, environmentId),
        inArray(faceTemplates.verificationId, input.verificationIds),
      ),
    )
    .returning({ id: faceTemplates.id });
  const biometricFiles = await tx
    .select()
    .from(files)
    .where(
      and(
        eq(files.environmentId, environmentId),
        inArray(files.verificationId, input.verificationIds),
        inArray(files.kind, [...BIOMETRIC_FILE_KINDS]),
        isNull(files.deletedAt),
      ),
    )
    .orderBy(asc(files.id));
  return {
    faceTemplates: templates.length,
    selfieBackgrounds: backgrounds.length,
    files: biometricFiles,
    biometricsRedactedAt: stamped.at,
  };
}
