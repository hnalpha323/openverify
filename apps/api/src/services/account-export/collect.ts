/**
 * C253.2 (Workflow 11B, `dsar-export`): everything this install holds about one account through its
 * links, read with `pii:view` semantics through the routes' own resource builders, so each record is
 * what the API serves for it. What it reaches, by the account's links:
 *
 * - **subject:** the account; its inquiries (`signals` and `signal-details` moved to the operator
 *   part); each inquiry's sessions (time, consent, address and user agent, the parsed device, the
 *   handoff facts, the collected tiers) and each session's network evaluation with its sealed address
 *   and location (Workflow 7A); every verification with its extracted data and checks; the decision
 *   records of the inquiries (C128); the reports of the account and its inquiries with their matches
 *   and their actions (the dispositions); the sessions' devices; every transaction linked through
 *   `transaction_objects` to the account, an inquiry or a verification, or through
 *   `transaction_relations` to the account (K7B-1), with its fields, status history and labels (a
 *   redacted label is never read); the environment's own consent records about these objects or
 *   citing their shares, and the Connect shares on either side (`crossTenant.listSharesTouching`,
 *   C240.5; amendment 23); the face templates counted.
 * - **operator review** (review P16, "review before disclosure"): the cases holding any of the
 *   objects with their comments and attachments, and the workflow runs whose subjects include them
 *   (C112.5; typed `workflow-run` in the cases list, the manifest having no list of its own); the
 *   list matches of the account and its inquiries with the list's name, and the face and background
 *   items whose source is an inquiry, as present with their list and time (never the template or the
 *   masked image); the inquiries' signals as `expose-signals` serves them, the sessions' collector
 *   bodies retention has not nulled, the graph's pseudonymous keys as a count per kind (never a value
 *   key), the account's graph component size, and the stored graph queries whose result names the
 *   account (their status and time only: a result also names other people); the inquiries' decoded
 *   integrity verdicts (orchestrator decision 7). A challenge's token is never read.
 * - **files:** every live verification file and transaction file, by id, with its kind, media type,
 *   size and SHA-256; the files route serves the live object.
 */
import { GRAPH_KIND_REGISTRY, GRAPH_KINDS } from '@openverify/core';
import {
  getEnvironment,
  getInquiryIntegrityVerdict,
  getListItem,
  getLists,
  getReports,
  getTransaction,
  listBiometricItemsBySource,
  listCaseCommentRows,
  listCasesHolding,
  getCaseRows,
  listDecisionsForSubjects,
  listInquiryIdsOfAccount,
  listInquirySessions,
  listInquiryVerifications,
  listListMatches,
  listAccountReportIds,
  listInquiryReportIds,
  listReportActions,
  listSessionSignalBodies,
  listTransactionFiles,
  listVerificationFiles,
  listWorkflowRunsForSubjects,
  type Db,
  type Page,
  type PageRequest,
} from '@openverify/db';
import { sql } from 'drizzle-orm';
import { UNMASKED } from '../../auth/pii.js';
import { NotFoundError } from '../../errors.js';
import type { Clock } from '../../ports.js';
import { resourceFor as workflowRunResource } from '../../workflows/runs/service.js';
import { accountResource, getAccountView } from '../accounts.js';
import { caseCommentResource, caseResources } from '../cases/resources.js';
import { crossTenant } from '../connect/cross-tenant.js';
import { consentRecordResource, servedConsentRecord } from '../connect/consent.js';
import type { ApiDependencies } from '../context.js';
import { decisionResourceOf } from '../decisions/resources.js';
import { getInquiryDocument } from '../inquiries.js';
import { getInquirySessionDocument } from '../inquiry-sessions.js';
import { listMatchResource } from '../lists/resources.js';
import { reportActionResource } from '../reports/resources.js';
import { reportResourceOf } from '../reports/reports.js';
import {
  listTransactionLabelsDocument,
  listTransactionStatusChanges,
} from '../transactions/history.js';
import type { TransactionActing } from '../transactions/acting.js';
import { transactionResource } from '../transactions/resources.js';
import { getVerificationDocument } from '../verifications.js';
import type { PageQuery } from '../pagination.js';
import type {
  AccountExportFile,
  AccountExportShare,
  CollectedAccountExport,
  ExportRecord,
} from './manifest.js';

/** What the collector reads. */
export interface CollectDeps {
  db: Db;
  clock: Clock;
}

/** The account was not found in the environment (the caller answers the generic 404). */
export class AccountExportAccountMissingError extends Error {
  override name = 'AccountExportAccountMissingError';
}

const PAGE = 100;
const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows;
const asRecord = (resource: unknown): ExportRecord => resource as ExportRecord;

/** Every page of a repository list. */
async function allPages<T>(read: (page: PageRequest) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await read({ after, size: PAGE });
    items.push(...page.items);
    if (page.next === null) {
      return items;
    }
    after = page.next;
  }
}

/** Every page of a route's list document, following its `links.next`. */
async function allDocumentPages<T>(
  read: (query: PageQuery) => Promise<{ data: T[]; links: { next: string | null } }>,
): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  for (;;) {
    const document = await read({ 'page[size]': PAGE, 'page[after]': after });
    items.push(...document.data);
    const next = document.links.next;
    if (next === null) {
      return items;
    }
    after = new URLSearchParams(next.slice(next.indexOf('?') + 1)).get('page[after]') ?? undefined;
    if (after === undefined) {
      return items;
    }
  }
}

/** The transactions linked to the objects (K7B-1's links, and C107.6's account columns). */
async function linkedTransactionIds(
  db: Db,
  environmentId: string,
  accountId: string,
  objectIds: readonly string[],
): Promise<string[]> {
  const ids = sql.join(
    objectIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await db.execute(sql`
    select t.id from transactions t
    where t.environment_id = ${environmentId}
      and (exists (select 1 from transaction_objects o
                   where o.environment_id = t.environment_id and o.transaction_id = t.id
                     and (o.object_id in (${ids}) or o.account_id = ${accountId}))
        or exists (select 1 from transaction_relations r
                   where r.environment_id = t.environment_id and r.transaction_id = t.id
                     and (r.target_id = ${accountId} or r.account_id = ${accountId})))
    order by t.created_at, t.id`);
  return rowsOf<{ id: string }>(result).map(({ id }) => id);
}

/** C253.3: the face templates of the inquiries, counted. */
async function faceTemplateCount(
  db: Db,
  environmentId: string,
  inquiryIds: readonly string[],
): Promise<number> {
  if (inquiryIds.length === 0) {
    return 0;
  }
  const ids = sql.join(
    inquiryIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await db.execute(sql`select count(*)::int as count from face_templates
    where environment_id = ${environmentId} and inquiry_id in (${ids})`);
  return rowsOf<{ count: number }>(result)[0]?.count ?? 0;
}

/** The graph's pseudonymous keys of the account, a count per kind; never a value key. */
async function graphAttributesRecord(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<ExportRecord | null> {
  const result = await db.execute(sql`select kind, count(*)::int as count from graph_attributes
    where environment_id = ${environmentId} and account_id = ${accountId}
    group by kind order by kind`);
  const rows = rowsOf<{ kind: number; count: number }>(result);
  if (rows.length === 0) {
    return null;
  }
  const names = new Map<number, string>(
    GRAPH_KINDS.map((kind) => [GRAPH_KIND_REGISTRY[kind].code, kind]),
  );
  return {
    type: 'graph-attributes',
    id: accountId,
    attributes: {
      present: true,
      kinds: rows.map((row) => ({
        kind: names.get(row.kind) ?? String(row.kind),
        count: row.count,
      })),
      detail:
        'Pseudonymous keys of the values the graph links accounts by (HMACs, never a value); listed as present by kind.',
    },
  };
}

/** The account's component size, as `GET /accounts/:id/graph-component` serves it once computed. */
async function graphComponentRecord(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<ExportRecord | null> {
  const result = await db.execute(sql`select size, computed_at from graph_components
    where environment_id = ${environmentId} and account_id = ${accountId}`);
  const [row] = rowsOf<{ size: number; computed_at: Date | string }>(result);
  if (row === undefined) {
    return null;
  }
  return {
    type: 'account-graph-component',
    id: accountId,
    attributes: {
      state: 'computed',
      size: row.size,
      'computed-at': new Date(row.computed_at).toISOString(),
    },
  };
}

/** The stored graph queries whose result names the account: their status and time only. */
async function graphQueryRecords(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<ExportRecord[]> {
  const result = await db.execute(sql`select id, status, created_at from graph_queries
    where environment_id = ${environmentId} and ${accountId} = any(account_ids)
    order by created_at, id`);
  return rowsOf<{ id: string; status: string; created_at: Date | string }>(result).map((row) => ({
    type: 'graph-query',
    id: row.id,
    attributes: {
      status: row.status,
      'names-account': true,
      'created-at': new Date(row.created_at).toISOString(),
    },
  }));
}

/** Finds the source organisation's name a copy's provenance names for a token. */
function sourceNameOf(records: readonly ExportRecord[], tokenId: string): string | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | null => {
    if (value === null || typeof value !== 'object' || seen.has(value)) {
      return null;
    }
    seen.add(value);
    const object = value as Record<string, unknown>;
    if (
      object['share-token-id'] === tokenId &&
      typeof object['source-organization-name'] === 'string'
    ) {
      return object['source-organization-name'];
    }
    for (const member of Object.values(object)) {
      const found = visit(member);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };
  for (const record of records) {
    const found = visit(record.attributes);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** Reads the account's records for its manifest. */
export async function collectAccountExport(
  deps: CollectDeps,
  environmentId: string,
  accountId: string,
): Promise<CollectedAccountExport> {
  const { db, clock } = deps;
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    throw new AccountExportAccountMissingError('The account was not found.');
  }
  const api = { db, clock } as ApiDependencies;
  const acting = {
    ctx: { organizationId: environment.organizationId, environmentId },
    mask: UNMASKED,
  };
  // The transaction list reads audit nothing, so they need no actor of their own.
  const reader = acting as TransactionActing;
  let account: ExportRecord;
  try {
    account = asRecord(accountResource(await getAccountView(api, environmentId, accountId)));
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new AccountExportAccountMissingError('The account was not found.');
    }
    throw error;
  }

  // Inquiries, with their signals moved to the operator part.
  const inquiryIds = await listInquiryIdsOfAccount(db, environmentId, accountId);
  const inquiries: ExportRecord[] = [];
  const signals: ExportRecord[] = [];
  for (const id of inquiryIds) {
    const { data } = await getInquiryDocument(api, acting, id);
    const { signals: values, 'signal-details': details, ...attributes } = data.attributes;
    inquiries.push({ ...asRecord(data), attributes });
    if (values !== undefined || details !== undefined) {
      signals.push({
        type: 'inquiry-signals',
        id,
        attributes: { signals: values ?? null, 'signal-details': details ?? null },
      });
    }
  }

  // Sessions with their networks; their devices; their collector bodies.
  const inquirySessions: ExportRecord[] = [];
  const devices = new Map<string, ExportRecord>();
  const sessionIds: string[] = [];
  for (const inquiryId of inquiryIds) {
    const sessions = await allPages((page) =>
      listInquirySessions(db, environmentId, { inquiryId, ...page }),
    );
    for (const session of sessions) {
      sessionIds.push(session.id);
      const document = await getInquirySessionDocument(api, acting, session.id, [
        'device',
        'network',
      ]);
      inquirySessions.push(asRecord(document.data));
      for (const included of document.included ?? []) {
        if (included.type === 'device') {
          devices.set(included.id, asRecord(included));
        } else {
          inquirySessions.push(asRecord(included));
        }
      }
    }
  }
  for (const body of await listSessionSignalBodies(db, environmentId, sessionIds)) {
    if (body.components === null && body.behaviour === null) {
      continue;
    }
    signals.push({
      type: 'inquiry-session-signals',
      id: `${body.inquirySessionId}:${String(body.sequence)}`,
      attributes: {
        'inquiry-session-id': body.inquirySessionId,
        screen: body.screen,
        platform: body.platform,
        components: body.components,
        behaviour: body.behaviour,
        'created-at': body.createdAt.toISOString(),
      },
    });
  }

  // Verifications, with their files.
  const verifications: ExportRecord[] = [];
  const verificationIds: string[] = [];
  for (const inquiryId of inquiryIds) {
    for (const row of await listInquiryVerifications(db, environmentId, inquiryId)) {
      verificationIds.push(row.id);
      const { data } = await getVerificationDocument(api, environmentId, row.id, UNMASKED);
      verifications.push(asRecord(data));
    }
  }
  const files: AccountExportFile[] = [];
  for (const file of await listVerificationFiles(db, environmentId, verificationIds)) {
    if (file.deletedAt === null) {
      files.push({
        id: file.id,
        kind: 'verification-file',
        'media-type': file.mimeType,
        size: file.byteSize,
        sha256: file.sha256,
        'belongs-to': file.verificationId,
      });
    }
  }

  // Decisions (C128).
  const decisions = (await listDecisionsForSubjects(db, environmentId, inquiryIds)).map(
    (decision) => asRecord(decisionResourceOf(decision, UNMASKED)),
  );

  // Reports, with their actions (the dispositions).
  const reportIds = new Set(await listAccountReportIds(db, environmentId, accountId));
  for (const inquiryId of inquiryIds) {
    for (const id of await listInquiryReportIds(db, environmentId, inquiryId)) {
      reportIds.add(id);
    }
  }
  const reports: ExportRecord[] = [];
  for (const report of await getReports(db, environmentId, [...reportIds].sort())) {
    reports.push(asRecord(await reportResourceOf(db, report, UNMASKED)));
    for (const action of await listReportActions(db, environmentId, report.id)) {
      reports.push(asRecord(reportActionResource(report, action, UNMASKED)));
    }
  }

  // Transactions, with their history, labels and files.
  const transactions: ExportRecord[] = [];
  const transactionIds = await linkedTransactionIds(db, environmentId, accountId, [
    accountId,
    ...inquiryIds,
    ...verificationIds,
  ]);
  for (const id of transactionIds) {
    const row = await getTransaction(db, environmentId, id);
    if (row === null) {
      continue;
    }
    transactions.push(
      asRecord(await transactionResource(db, environmentId, row, { mask: UNMASKED })),
    );
    transactions.push(
      ...(
        await allDocumentPages((query) => listTransactionStatusChanges(api, reader, id, query))
      ).map(asRecord),
      ...(
        await allDocumentPages((query) => listTransactionLabelsDocument(api, reader, id, query))
      ).map(asRecord),
    );
    for (const file of await listTransactionFiles(db, environmentId, id)) {
      files.push({
        id: file.id,
        kind: 'transaction-file',
        'media-type': file.mimeType,
        size: file.byteSize,
        sha256: file.sha256,
        'belongs-to': id,
      });
    }
  }

  // Connect (C240.5, amendment 23): the shares on either side, the environment's own records.
  const objectIds = [accountId, ...inquiryIds, ...verificationIds, ...transactionIds];
  const touching = await crossTenant.listSharesTouching(db, environmentId, objectIds);
  const now = clock.now();
  const consentRecords: ExportRecord[] = [];
  for (const record of touching.consentRecords) {
    consentRecords.push(
      asRecord(
        consentRecordResource(await servedConsentRecord(db, record, true), { pii: true, now }),
      ),
    );
  }
  const subjectRecords = [account, ...inquiries, ...verifications, ...transactions];
  const connectShares: AccountExportShare[] = touching.tokens.map((token) => {
    const outbound = token.environmentId === environmentId;
    const cited = outbound
      ? touching.consentRecords.find((record) => record.id === token.consentRecordId)
      : undefined;
    const sourceName = outbound ? null : sourceNameOf(subjectRecords, token.id);
    return {
      'share-token-id': token.id,
      direction: outbound ? 'outbound' : 'inbound',
      status: token.status,
      'data-categories': [...token.dataCategories],
      'created-at': token.createdAt.toISOString(),
      'redeemed-at': token.redeemedAt?.toISOString() ?? null,
      recipient:
        cited === undefined
          ? null
          : {
              'organization-id': cited.recipientOrganizationId,
              'organization-name': cited.recipientName,
            },
      source: sourceName === null ? null : { 'organization-name': sourceName },
    };
  });

  // Operator review: cases with comments, workflow runs, list memberships, the graph, verdicts.
  const cases: ExportRecord[] = [];
  const caseIds = await listCasesHolding(db, environmentId, objectIds);
  if (caseIds.length > 0) {
    const rows = await getCaseRows(db, environmentId, { kind: 'system' }, caseIds);
    for (const resource of await caseResources(db, environmentId, rows, UNMASKED)) {
      cases.push(asRecord(resource));
      const comments = await allPages((page) =>
        listCaseCommentRows(db, environmentId, resource.id, page),
      );
      cases.push(...comments.map((comment) => asRecord(caseCommentResource(comment, UNMASKED))));
    }
  }
  for (const run of await listWorkflowRunsForSubjects(db, environmentId, [
    accountId,
    ...inquiryIds,
  ])) {
    cases.push(asRecord(await workflowRunResource(db, run, true)));
  }

  const listMemberships: ExportRecord[] = [];
  const matches = [
    ...(await allPages((page) =>
      listListMatches(db, environmentId, { accountIds: [accountId] }, page),
    )),
    ...(inquiryIds.length === 0
      ? []
      : await allPages((page) => listListMatches(db, environmentId, { inquiryIds }, page))),
  ];
  const items: { itemId: string; kind: string }[] = [];
  for (const inquiryId of inquiryIds) {
    items.push(...(await listBiometricItemsBySource(db, environmentId, inquiryId)));
  }
  const itemRows = new Map(
    (await Promise.all(items.map(({ itemId }) => getListItem(db, environmentId, itemId)))).flatMap(
      (item) => (item === null ? [] : [[item.id, item] as const]),
    ),
  );
  const lists = new Map(
    (
      await getLists(db, environmentId, [
        ...new Set([
          ...matches.map((match) => match.listId),
          ...[...itemRows.values()].map((item) => item.listId),
        ]),
      ])
    ).map((list) => [list.id, list]),
  );
  const seenMatches = new Set<string>();
  for (const match of matches) {
    const list = lists.get(match.listId);
    if (seenMatches.has(match.id) || list === undefined) {
      continue;
    }
    seenMatches.add(match.id);
    const resource = listMatchResource(match, list.type, UNMASKED);
    listMemberships.push({
      ...asRecord(resource),
      attributes: { ...resource.attributes, 'list-name': list.name },
    });
  }
  for (const { itemId, kind } of items) {
    const item = itemRows.get(itemId);
    const list = item === undefined ? undefined : lists.get(item.listId);
    if (item === undefined || list === undefined) {
      continue;
    }
    listMemberships.push({
      type: 'list-item',
      id: itemId,
      attributes: {
        kind,
        present: true,
        'list-id': list.id,
        'list-name': list.name,
        'created-at': item.createdAt.toISOString(),
      },
    });
  }

  const graphAttributes = await graphAttributesRecord(db, environmentId, accountId);
  const graphComponent = await graphComponentRecord(db, environmentId, accountId);
  signals.push(
    ...(graphAttributes === null ? [] : [graphAttributes]),
    ...(graphComponent === null ? [] : [graphComponent]),
    ...(await graphQueryRecords(db, environmentId, accountId)),
  );

  const integrityVerdicts: ExportRecord[] = [];
  for (const inquiryId of inquiryIds) {
    const verdict = await getInquiryIntegrityVerdict(db, environmentId, inquiryId);
    if (verdict !== null) {
      integrityVerdicts.push({
        type: 'inquiry-integrity-verdict',
        id: inquiryId,
        attributes: {
          provider: verdict.provider,
          verdict: verdict.verdict,
          'decoded-at': verdict.decodedAt.toISOString(),
        },
      });
    }
  }

  return {
    account,
    inquiries,
    inquirySessions,
    verifications,
    decisions,
    reports,
    devices: [...devices.values()],
    transactions,
    consentRecords,
    connectShares,
    faceTemplateCount: await faceTemplateCount(db, environmentId, inquiryIds),
    cases,
    listMemberships,
    signals,
    integrityVerdicts,
    files,
  };
}
