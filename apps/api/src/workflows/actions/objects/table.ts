/**
 * C122.1 (F33): how the generic actions reach each object type. A row answers for one type, so 8B
 * adds `case` with a row of its own and edits no action. Everything is scoped by the environment, so
 * an id of another one reads as not found (C121.6), and a redacted object is `subject_redacted`.
 */
import {
  getAccount,
  getInquiry,
  getReport,
  getTransaction,
  getVerification,
  type Db,
} from '@openverify/db';
import {
  buildTriggerView,
  type JsonValue,
  type TriggerDocument,
} from '@openverify/workflow-engine';
import type { StagedEvent } from '../../../events/index.js';
import {
  accountChangeIn,
  accountResource,
  changeAccountTagsInTx,
  getAccountView,
  updateAccountInTx,
} from '../../../services/accounts.js';
import {
  changeInquiryTagsInTx,
  findInquiry,
  inquiryResourceOf,
  updateInquiryInTx,
} from '../../../services/inquiries.js';
import {
  changeReportTagsInTx,
  findStoredReport,
  reportResourceOf,
} from '../../../services/reports/reports.js';
import { verificationResource } from '../../../services/resources.js';
import { loadVerificationAttributes } from '../../../services/attributes/index.js';
import { fileIdsByVerification } from '../../../services/verifications.js';
import { transactionChangeIn } from '../../../services/transactions/shared.js';
import {
  changeTransactionTagsInTx,
  getTransactionDocument,
  updateTransactionInTx,
} from '../../../services/transactions/transactions.js';
import type { ActionContext } from '../../engine/action-port.js';
import { apiDepsOf } from '../shared.js';
import { CASE_OBJECT_ROWS } from '../cases/object-rows.js';
import { verificationCountsInWorkflows } from '../../../services/connect/cloned-results.js';

export type TagChange =
  | { kind: 'add'; tag: string }
  | { kind: 'remove'; tag: string }
  | { kind: 'set'; tags: readonly string[] };

export interface ObjectState {
  tags: readonly string[];
  redacted: boolean;
}

export type UpdateAttributes = Readonly<Record<string, unknown>>;

export interface ObjectRow {
  /** Its tags and whether it was redacted; `null` when the environment does not hold it. */
  read(tx: Db, context: ActionContext, id: string): Promise<ObjectState | null>;
  /**
   * The object as an API client reads it, under the run's mask, as its flattened view (C114.4):
   * the shape the check types `steps.<id>.output.object` by (`triggerViewType`).
   */
  fetch(context: ActionContext, id: string): Promise<JsonValue>;
  tag?(
    tx: Db,
    context: ActionContext,
    id: string,
    change: TagChange,
    staged: StagedEvent[],
  ): Promise<void>;
  update?(
    tx: Db,
    context: ActionContext,
    id: string,
    attributes: UpdateAttributes,
    staged: StagedEvent[],
  ): Promise<void>;
}

/** The masked document's flattened view, so `steps.<id>.output.object.status` reads what it names. */
const viewOf = (document: {
  data: unknown;
  included?: readonly unknown[] | undefined;
}): JsonValue => buildTriggerView(document as TriggerDocument);

const inquiryRow: ObjectRow = {
  async read(tx, { environmentId }, id) {
    const inquiry = await getInquiry(tx, environmentId, id);
    return inquiry === null ? null : { tags: inquiry.tags, redacted: inquiry.redactedAt !== null };
  },
  async fetch(context, id) {
    const { db } = apiDepsOf(context);
    const inquiry = await findInquiry(db, context.environmentId, id);
    return viewOf({
      data: await inquiryResourceOf(db, context.environmentId, inquiry, context.acting.mask),
    });
  },
  async tag(tx, context, id, change, staged) {
    const result = await changeInquiryTagsInTx(tx, apiDepsOf(context), context.acting, id, change);
    staged.push(...result.staged);
  },
  async update(tx, context, id, attributes) {
    await updateInquiryInTx(tx, apiDepsOf(context), context.acting, id, attributes);
  },
};

const accountRow: ObjectRow = {
  async read(tx, { environmentId }, id) {
    const account = await getAccount(tx, environmentId, id);
    return account === null ? null : { tags: account.tags, redacted: account.redactedAt !== null };
  },
  async fetch(context, id) {
    const view = await getAccountView(apiDepsOf(context), context.environmentId, id);
    return viewOf({ data: accountResource(view, context.acting.mask) });
  },
  async tag(tx, context, id, change, staged) {
    const { ctx, actor } = context.acting;
    await changeAccountTagsInTx(
      accountChangeIn(tx, apiDepsOf(context), ctx, actor, staged),
      id,
      change,
    );
  },
  async update(tx, context, id, attributes, staged) {
    const { ctx, actor } = context.acting;
    await updateAccountInTx(
      accountChangeIn(tx, apiDepsOf(context), ctx, actor, staged),
      id,
      attributes,
    );
  },
};

const reportRow: ObjectRow = {
  async read(tx, { environmentId }, id) {
    const report = await getReport(tx, environmentId, id);
    return report === null ? null : { tags: report.tags, redacted: report.redactedAt !== null };
  },
  async fetch(context, id) {
    const { db } = apiDepsOf(context);
    const report = await findStoredReport(db, context.environmentId, id);
    return viewOf({ data: await reportResourceOf(db, report, context.acting.mask) });
  },
  async tag(tx, context, id, change) {
    await changeReportTagsInTx(tx, apiDepsOf(context), context.acting, id, change);
  },
};

const transactionRow: ObjectRow = {
  async read(tx, { environmentId }, id) {
    const transaction = await getTransaction(tx, environmentId, id);
    return transaction === null
      ? null
      : { tags: transaction.tags, redacted: transaction.redactedAt !== null };
  },
  async fetch(context, id) {
    return viewOf(await getTransactionDocument(apiDepsOf(context), context.acting, id, {}));
  },
  async tag(tx, context, id, change, staged) {
    const { acting } = context;
    await changeTransactionTagsInTx(
      transactionChangeIn(tx, apiDepsOf(context), acting, staged),
      acting,
      id,
      change,
    );
  },
  async update(tx, context, id, attributes, staged) {
    const deps = apiDepsOf(context);
    const { acting } = context;
    await updateTransactionInTx(
      deps,
      transactionChangeIn(tx, deps, acting, staged),
      acting,
      id,
      attributes,
    );
  },
};

const verificationRow: ObjectRow = {
  async read(tx, { environmentId }, id) {
    const verification = await getVerification(tx, environmentId, id);
    return verification === null ? null : { tags: [], redacted: false };
  },
  async fetch(context, id) {
    const { db, clock } = apiDepsOf(context);
    const { environmentId } = context;
    const row = await getVerification(db, environmentId, id);
    // C235.7(b) (Workflow 11A Stage 1b (R), `foundation-11a`'s hook): a clone C235.4 does not count
    // is absent to a workflow, so no condition approves on it (`api-redeem`'s cloned-results.ts).
    if (row === null || !(await verificationCountsInWorkflows(db, row, clock.now()))) {
      throw new Error('object_not_found');
    }
    const files = await fileIdsByVerification(db, environmentId, [id]);
    return viewOf({
      data: verificationResource(row, files.get(id) ?? [], {
        mask: context.acting.mask,
        attributes: await loadVerificationAttributes(db, row),
      }),
    });
  },
};

/** 8A's rows; `workflows/definitions/registry.ts` names what each may do. */
export const OBJECT_ROWS: Readonly<Record<string, ObjectRow>> = {
  inquiry: inquiryRow,
  account: accountRow,
  report: reportRow,
  transaction: transactionRow,
  verification: verificationRow,
  // Workflow 8B (C140.3, F33): `api-case-workflows`' case row.
  ...CASE_OBJECT_ROWS,
};
