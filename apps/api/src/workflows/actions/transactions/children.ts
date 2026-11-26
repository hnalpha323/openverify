/**
 * C127.7 (the Phase 7 deferral; C105 amended; F35): a transaction's redaction reaches the objects a
 * run created (`transaction_children`), never its `transaction_objects` (C105.5).
 *
 * It follows outcome 28. Transactions lock before objects, so a child inquiry's own transactions are
 * locked before its row. The transaction was redacted before this hook runs, so `lockInquiryTransactions`
 * skips it and nothing loops back to what started the pass, and each object reached again reads
 * `alreadyRedacted`, a no-change with no event and no second audit entry. A cascade's entry is a
 * system entry naming the transaction. Object deletes are left to the C16 purge, so a failed one
 * fails nothing.
 *
 * A verification has no redaction of its own (it is read-only in the object-type table), so a child
 * verification is reached through the inquiry that holds it. (Default, on the owner's review list.)
 */
import {
  getVerification,
  listTransactionChildren,
  lockInquiryTransactions,
  redactInquiryRecords,
  revokeOneTimeLinks,
  type Db,
} from '@openverify/db';
import type { StagedEvent } from '../../../events/index.js';
import { appendSystemAuditEntry } from '../../../services/audit-log.js';
import { redactDecisionCommentsInTx } from '../../../services/decisions/redaction.js';
import { redactInquiryGraphInTx } from '../../../services/graph/redaction.js';
import { inquiryResourceOf } from '../../../services/inquiries.js';
import { cancelActiveSessions } from '../../../services/inquiry-sessions.js';
import { biometricItemRedactor } from '../../../services/lists/biometric/index.js';
import { afterListItemsRedactedInTx } from '../../../services/lists/list-writes.js';
import {
  redactInquiryReportsInTx,
  redactReportInTx,
  type ReportRedactionActor,
} from '../../../services/reports/redaction.js';
import {
  redactTransactionInTx,
  type TransactionRedactionDeps,
} from '../../../services/transactions/redaction.js';
import { redactRunsForSubjectsInTx } from '../../runs/redaction.js';
import { deleteRenditionsForFilesInTx } from '../../../services/cases/attachments/renditions.js';
import { redactCasesInTx } from '../../../services/cases/redaction.js';

export interface TransactionChildrenRedaction {
  environmentId: string;
  transactionId: string;
  at: Date;
}

/** Outcome 28: a cascade redacts as the system. */
const SYSTEM_ACTOR: ReportRedactionActor = Object.freeze({ actorType: 'system', actorId: null });

/** One child inquiry, as `RedactionService.redactInquiry` does it, in the caller's transaction. */
/** What a cascade leaves to do after its commit: the events, and objects no row still names. */
export interface RedactedChildren {
  staged: readonly StagedEvent[];
  storageKeys: readonly string[];
}

const NOTHING: RedactedChildren = { staged: [], storageKeys: [] };

async function redactChildInquiryInTx(
  tx: Db,
  deps: TransactionRedactionDeps,
  environmentId: string,
  inquiryId: string,
  { transactionId, at }: Pick<TransactionChildrenRedaction, 'transactionId' | 'at'>,
): Promise<RedactedChildren> {
  // Before the inquiry's row: a transaction always comes first (outcome 28).
  const linked = await lockInquiryTransactions(tx, environmentId, inquiryId);
  const redacted = await redactInquiryRecords(tx, environmentId, inquiryId, { at });
  if (redacted === null || redacted.alreadyRedacted) {
    return NOTHING;
  }
  // C135.3 (V19, Workflow 8B (F); `api-case-files`): the renditions of the child's files.
  const renditionKeys = await deleteRenditionsForFilesInTx(tx, {
    environmentId,
    fileIds: redacted.files.map((file) => file.id),
  });
  const staged: StagedEvent[] = [
    ...(await cancelActiveSessions(tx, deps.events, environmentId, inquiryId, at)),
  ];
  await revokeOneTimeLinks(tx, environmentId, inquiryId, at);
  staged.push(
    ...(await redactInquiryReportsInTx(tx, deps, {
      environmentId,
      inquiryId,
      at,
      actor: SYSTEM_ACTOR,
    })),
  );
  const biometric = await biometricItemRedactor.redactBySource(tx, {
    environmentId,
    inquiryId,
    at,
  });
  const storageKeys = [...biometric.storageKeys, ...renditionKeys];
  staged.push(
    ...(await afterListItemsRedactedInTx(
      tx,
      { events: deps.events },
      environmentId,
      biometric,
      at,
    )),
  );
  await redactInquiryGraphInTx(tx, { environmentId, inquiryId, at });
  await redactRunsForSubjectsInTx(tx, { environmentId, subjectIds: [inquiryId], at });
  await redactDecisionCommentsInTx(tx, { environmentId, subjectIds: [inquiryId], at });
  for (const id of linked) {
    const other = await redactTransactionInTx(tx, deps, environmentId, id, {
      at,
      includeNever: false,
    });
    if (other !== null && !other.alreadyRedacted) {
      staged.push(...other.staged);
      storageKeys.push(...other.storageKeys);
      await appendSystemAuditEntry(tx, environmentId, {
        action: 'transaction.redacted',
        resourceType: 'transaction',
        resourceId: id,
        metadata: {
          'inquiry-id': inquiryId,
          'include-never': false,
          'file-count': other.files.length,
          'stubbed-event-count': other.stubbedEvents,
        },
      });
    }
  }
  staged.push(
    await deps.events.stage(tx, {
      environmentId,
      name: 'inquiry.redacted',
      payload: { data: await inquiryResourceOf(tx, environmentId, redacted.inquiry) },
    }),
  );
  await appendSystemAuditEntry(tx, environmentId, {
    action: 'inquiry.redacted',
    resourceType: 'inquiry',
    resourceId: inquiryId,
    metadata: {
      'transaction-id': transactionId,
      'file-count': redacted.files.length,
      'stubbed-event-count': redacted.stubbedEvents,
    },
  });
  return { staged, storageKeys };
}

async function redactChildReportInTx(
  tx: Db,
  deps: TransactionRedactionDeps,
  environmentId: string,
  reportId: string,
  { transactionId, at }: Pick<TransactionChildrenRedaction, 'transactionId' | 'at'>,
): Promise<StagedEvent[]> {
  const outcome = await redactReportInTx(tx, deps, environmentId, reportId, {
    at,
    actor: SYSTEM_ACTOR,
  });
  if (outcome === null || outcome.alreadyRedacted) {
    return [];
  }
  await appendSystemAuditEntry(tx, environmentId, {
    action: 'report.redacted',
    resourceType: 'report',
    resourceId: reportId,
    metadata: { 'transaction-id': transactionId },
  });
  return [...outcome.staged];
}

export async function redactTransactionChildrenInTx(
  tx: Db,
  deps: TransactionRedactionDeps,
  { environmentId, transactionId, at }: TransactionChildrenRedaction,
): Promise<RedactedChildren> {
  const pass = { transactionId, at };
  const staged: StagedEvent[] = [];
  const storageKeys: string[] = [];
  const add = (child: RedactedChildren): void => {
    staged.push(...child.staged);
    storageKeys.push(...child.storageKeys);
  };
  for (const { childType, childId } of await listTransactionChildren(
    tx,
    environmentId,
    transactionId,
  )) {
    if (childType === 'inquiry') {
      add(await redactChildInquiryInTx(tx, deps, environmentId, childId, pass));
    } else if (childType === 'report') {
      staged.push(...(await redactChildReportInTx(tx, deps, environmentId, childId, pass)));
    } else if (childType === 'verification') {
      const verification = await getVerification(tx, environmentId, childId);
      if (verification !== null) {
        add(await redactChildInquiryInTx(tx, deps, environmentId, verification.inquiryId, pass));
      }
    } else {
      // C127.7, C139.1 (Workflow 8B): a case a run created goes with its transaction (outcome 28).
      const redacted = await redactCasesInTx(tx, deps, {
        environmentId,
        caseIds: [childId],
        at,
        actor: null,
        cause: { 'transaction-id': transactionId },
      });
      add({ staged: redacted.staged, storageKeys: redacted.storageKeys });
    }
  }
  return { staged, storageKeys };
}
