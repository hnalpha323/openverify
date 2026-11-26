/**
 * The C14 filter subject of an event: the attributes webhook `filters` compare. An inquiry
 * carries its template and an account its account type (core `webhookFilterSubject`). A
 * verification or an inquiry session carries neither, so its subject is its inquiry's
 * template, read from the inquiry row of the same environment. A subject that cannot be
 * resolved (an unknown inquiry, a redacted stub) leaves the attribute out, and an event without
 * the attribute is not filtered.
 */
import { webhookFilterSubject, type WebhookFilterSubject } from '@openverify/core';
import { inquiries, type Db, type EventSubject } from '@openverify/db';
import { and, eq, inArray } from 'drizzle-orm';
import { resolveCaseFilterSubjects } from '../services/cases/filter-subjects.js';
import { resolveGraphQueryFilterSubjects } from '../services/graph/filter-subjects.js';
import { resolveListMatchFilterSubjects } from '../services/lists/filter-subjects.js';
import { resolveReportFilterSubjects } from '../services/reports/filter-subjects.js';
import { resolveTransactionFilterSubjects } from '../services/transactions/filter-subjects.js';
import { resolveWorkflowFilterSubjects } from '../workflows/triggers/filter-subjects.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether the payload's `data` is a report (`report/<type>`). */
function isReport(payload: unknown): boolean {
  const data = isObject(payload) ? payload.data : undefined;
  return isObject(data) && typeof data.type === 'string' && data.type.startsWith('report/');
}

/** The resource type of the payload's `data`. */
function dataType(payload: unknown): unknown {
  const data = isObject(payload) ? payload.data : undefined;
  return isObject(data) ? data.type : undefined;
}

/** Whether the payload's `data` is a list match (C107.4, V14). */
const isListMatch = (payload: unknown): boolean => dataType(payload) === 'list-match';

/** Whether the payload's `data` is a transaction (C107.4). */
const isTransaction = (payload: unknown): boolean => dataType(payload) === 'transaction';

/** Whether the payload's `data` is a transaction type (C107.4). */
const isTransactionType = (payload: unknown): boolean => dataType(payload) === 'transaction-type';

/** Whether the payload's `data` is a graph query (C107.4). */
const isGraphQuery = (payload: unknown): boolean => dataType(payload) === 'graph-query';

const isTemplateSubject = (payload: unknown): boolean => {
  const type = dataType(payload);
  return type === 'inquiry-template-version' || type === 'deployment';
};

/**
 * C239.2 (Workflow 11A): a connection, a share token or a consent record links to no template and
 * no account type, so its subject is strict with nothing resolved: it never reaches a webhook
 * filtered on a template or an account type.
 */
const isConnectSubject = (payload: unknown): boolean => {
  const type = dataType(payload);
  return (
    type === 'connect/connection' || type === 'connect/share-token' || type === 'consent-record'
  );
};

/** C143.4 (Workflow 8A): a workflow, a version, a run or a list: each resolves through its owner. */
function isWorkflowSubject(payload: unknown): boolean {
  const type = dataType(payload);
  return (
    type === 'workflow' ||
    type === 'workflow-version' ||
    type === 'workflow-run' ||
    (typeof type === 'string' && type.startsWith('list/'))
  );
}

/** C143.4 (Workflow 8B): a case or a case comment, which resolve through `api-cases`. */
function isCaseSubject(payload: unknown): boolean {
  const type = dataType(payload);
  return type === 'case' || type === 'case-comment';
}

/** `payload.data.relationships.inquiry.data.id`: the inquiry of a verification or session. */
function linkedInquiryId(payload: unknown): string | undefined {
  const data = isObject(payload) ? payload.data : undefined;
  const relationships = isObject(data) ? data.relationships : undefined;
  const inquiry = isObject(relationships) ? relationships.inquiry : undefined;
  const linkage = isObject(inquiry) ? inquiry.data : undefined;
  return isObject(linkage) && typeof linkage.id === 'string' ? linkage.id : undefined;
}

/**
 * The filter subject of each payload, in order, with one query for the inquiries that
 * verifications and sessions point at. Every read is scoped to `environmentId`.
 */
export async function eventFilterSubjects(
  db: Db,
  environmentId: string,
  payloads: readonly unknown[],
): Promise<WebhookFilterSubject[]> {
  const subjects = payloads.map((payload) => webhookFilterSubject(payload));
  // C70.4 (F10): report subjects are resolved by their owner's hook and are strict.
  const reportIndexes = payloads.flatMap((payload, index) => (isReport(payload) ? [index] : []));
  if (reportIndexes.length > 0) {
    const resolved = await resolveReportFilterSubjects(
      db,
      environmentId,
      reportIndexes.map((index) => payloads[index]),
    );
    reportIndexes.forEach((index, position) => {
      subjects[index] = { ...resolved[position], strict: true };
    });
  }
  // C107.4 (Workflow 7B; P03, V14): list-match subjects are resolved by their owner's hook and are
  // strict too, so a list match never reaches a webhook filtered on another template.
  const listMatchIndexes = payloads.flatMap((payload, index) =>
    isListMatch(payload) ? [index] : [],
  );
  if (listMatchIndexes.length > 0) {
    const resolved = await resolveListMatchFilterSubjects(
      db,
      environmentId,
      listMatchIndexes.map((index) => payloads[index]),
    );
    listMatchIndexes.forEach((index, position) => {
      subjects[index] = { ...resolved[position], strict: true };
    });
  }
  // C107.4 (Workflow 7B; P03): a transaction resolves through its accounts and inquiries, and is
  // strict; a transaction type links to neither, so it fails any filter that is present.
  const transactionIndexes = payloads.flatMap((payload, index) =>
    isTransaction(payload) ? [index] : [],
  );
  if (transactionIndexes.length > 0) {
    const resolved = await resolveTransactionFilterSubjects(
      db,
      environmentId,
      transactionIndexes.map((index) => payloads[index]),
    );
    transactionIndexes.forEach((index, position) => {
      subjects[index] = { ...resolved[position], strict: true };
    });
  }
  payloads.forEach((payload, index) => {
    if (isTransactionType(payload)) {
      subjects[index] = { strict: true };
    }
    // C154.8 (Workflow 9A): a template version and a deployment resolve through their template (the
    // payload's `inquiry-template` link) and are strict, so neither reaches a webhook filtered on
    // another template or on an account type.
    if (isTemplateSubject(payload)) {
      subjects[index] = { ...subjects[index], strict: true };
    }
    if (isConnectSubject(payload)) {
      subjects[index] = { strict: true };
    }
  });
  // C107.4 (Workflow 7B; P03, V14): a graph query links to no template or account type, so its
  // subject is strict with nothing resolved (`api-graph`'s resolver), failing any present filter.
  const graphQueryIndexes = payloads.flatMap((payload, index) =>
    isGraphQuery(payload) ? [index] : [],
  );
  if (graphQueryIndexes.length > 0) {
    const resolved = await resolveGraphQueryFilterSubjects(
      db,
      environmentId,
      graphQueryIndexes.map((index) => payloads[index]),
    );
    graphQueryIndexes.forEach((index, position) => {
      subjects[index] = { ...resolved[position], strict: true };
    });
  }
  // C143.4 (Workflow 8A; F14): strict, so one of these never reaches a webhook filtered on anything
  // it cannot show, whatever its owner's resolver found.
  const workflowIndexes = payloads.flatMap((payload, index) =>
    isWorkflowSubject(payload) ? [index] : [],
  );
  if (workflowIndexes.length > 0) {
    const resolved = await resolveWorkflowFilterSubjects(
      db,
      environmentId,
      workflowIndexes.map((index) => payloads[index]),
    );
    workflowIndexes.forEach((index, position) => {
      subjects[index] = { ...resolved[position], strict: true };
    });
  }
  // C143.4 (Workflow 8B; F14): a case and a case comment resolve through `api-cases`' resolver and
  // are strict, so a case never reaches a webhook filtered on a template it cannot show.
  const caseIndexes = payloads.flatMap((payload, index) => (isCaseSubject(payload) ? [index] : []));
  if (caseIndexes.length > 0) {
    const resolved = await resolveCaseFilterSubjects(
      db,
      environmentId,
      caseIndexes.map((index) => payloads[index]),
    );
    caseIndexes.forEach((index, position) => {
      subjects[index] = { ...resolved[position], strict: true };
    });
  }
  const wanted = new Map<number, string>();
  payloads.forEach((payload, index) => {
    const inquiryId = linkedInquiryId(payload);
    if (
      subjects[index]?.strict !== true &&
      subjects[index]?.inquiryTemplateId == null &&
      inquiryId !== undefined
    ) {
      wanted.set(index, inquiryId);
    }
  });
  if (wanted.size === 0) {
    return subjects;
  }
  const rows = await db
    .select({ id: inquiries.id, inquiryTemplateId: inquiries.inquiryTemplateId })
    .from(inquiries)
    .where(
      and(
        eq(inquiries.environmentId, environmentId),
        inArray(inquiries.id, [...new Set(wanted.values())]),
      ),
    );
  const templates = new Map(rows.map((row) => [row.id, row.inquiryTemplateId]));
  for (const [index, inquiryId] of wanted) {
    const inquiryTemplateId = templates.get(inquiryId);
    if (inquiryTemplateId !== undefined) {
      subjects[index] = { ...subjects[index], inquiryTemplateId };
    }
  }
  return subjects;
}

/** The subject in the shape `listWebhooksForEvent` takes: unknown attributes left out. */
export function toEventSubject(subject: WebhookFilterSubject | undefined): EventSubject {
  return {
    ...(subject?.inquiryTemplateId == null ? {} : { inquiryTemplateId: subject.inquiryTemplateId }),
    ...(subject?.accountTypeId == null ? {} : { accountTypeId: subject.accountTypeId }),
    ...(subject?.inquiryTemplateIds === undefined
      ? {}
      : { inquiryTemplateIds: subject.inquiryTemplateIds }),
    ...(subject?.accountTypeIds === undefined ? {} : { accountTypeIds: subject.accountTypeIds }),
    ...(subject?.workflowId == null ? {} : { workflowId: subject.workflowId }),
    ...(subject?.listId == null ? {} : { listId: subject.listId }),
    // C143.4 (Workflow 8B): a case by its template, and by every inquiry it holds.
    ...(subject?.caseTemplateId == null ? {} : { caseTemplateId: subject.caseTemplateId }),
    ...(subject?.heldInquiryTemplateIds === undefined
      ? {}
      : { heldInquiryTemplateIds: subject.heldInquiryTemplateIds }),
    ...(subject?.strict === true ? { strict: true } : {}),
  };
}
