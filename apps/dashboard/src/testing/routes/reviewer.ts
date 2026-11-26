/**
 * `dashboard-reviewer`'s own mock routes (C142.2 to C142.6), registered on a `routeApi()` the test
 * made, standing alone as the Phase 6 route modules do: the case, its template and version, its
 * timeline, comments, held objects, queue and available actions, and the live reads of the objects
 * it holds, each through its own route. Paths are after `/api/v1`; every value is synthetic.
 */
import type {
  CaseCommentResource,
  CaseHistoryEntryResource,
  CaseResource,
  CaseTemplateVersionResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { RouteApi } from '../api-routes';
import { accountGraphComponent } from '../graph-fixtures';
import { account, inquiryDocument } from '../lifecycle-fixtures';
import { REPORT_IDS, report } from '../report-fixtures';
import {
  REVIEWER_IDS as IDS,
  availableActions,
  caseQueue,
  caseResource,
  caseTemplate,
  caseTemplateVersion,
  comment,
  heldObjects,
  history,
  listOf,
  single,
} from '../reviewer-fixtures';
import { listMatch, matchList } from '../signals-fixtures';
import {
  TRANSACTION_IDS,
  pageOf,
  statusChange,
  transaction,
  transactionRelation,
} from '../transactions-fixtures';

export const CASE_PATH = `/cases/${IDS.case}`;

/** The built-in reviewer (C129.4, decision 68): no `cases:redact`, no `cases:export`. */
export const CASE_REVIEWER: readonly Permission[] = [
  'cases:read',
  'cases:write',
  'cases:assign',
  'case-templates:read',
  'case-queues:read',
  'inquiries:read',
  'inquiries:write',
  'inquiry-sessions:read',
  'verifications:read',
  'accounts:read',
  'reports:read',
  'lists:read',
  'lists:write',
  'graph:read',
  'transactions:read',
  'workflows:read',
  'workflows:trigger',
  'workflow-runs:read',
  'pii:view',
];

/** A developer reads and redacts cases, with no `pii:view` (C129.4). */
export const CASE_DEVELOPER: readonly Permission[] = [
  'cases:read',
  'cases:write',
  'cases:assign',
  'cases:redact',
  'case-templates:read',
  'case-queues:read',
  'inquiries:read',
  'accounts:read',
  'workflows:trigger',
];

/** Reads cases and nothing else they hold. */
export const CASE_READER: readonly Permission[] = ['cases:read'];

export interface ServeCaseOptions {
  readonly resource?: CaseResource;
  readonly version?: CaseTemplateVersionResource;
  readonly history?: readonly CaseHistoryEntryResource[];
  readonly comments?: readonly CaseCommentResource[];
}

/**
 * Every read of the case page for `IDS.case`: the case with its template, the pinned version, the
 * timeline, the comments, the held objects and the queue, with no next page.
 */
export function serveCase(api: RouteApi, options: ServeCaseOptions = {}): RouteApi {
  const resource = options.resource ?? caseResource();
  return api
    .on('GET', CASE_PATH, 200, { data: resource, included: [caseTemplate()] })
    .on(
      'GET',
      `/case-template-versions/${IDS.version}`,
      200,
      single(options.version ?? caseTemplateVersion()),
    )
    .on('GET', `${CASE_PATH}/history`, 200, listOf(options.history ?? history()))
    .on('GET', `${CASE_PATH}/comments`, 200, listOf(options.comments ?? [comment()]))
    .on('GET', `${CASE_PATH}/objects`, 200, heldObjects())
    .on('GET', `/case-queues/${IDS.queue}`, 200, single(caseQueue()))
    .on('GET', '/case-queues', 200, listOf([caseQueue()]))
    .on('GET', `${CASE_PATH}/available-actions`, 200, availableActions());
}

/** The live reads of what the case holds, each through its own route (C136.3). */
export function serveHeldObjects(api: RouteApi): RouteApi {
  return api
    .on(
      'GET',
      `/dashboard/inquiries/${IDS.inquiry}`,
      200,
      inquiryDocument({ status: 'needs_review' }),
    )
    .on('GET', `/accounts/${IDS.account}`, 200, single(account()))
    .on('GET', `/reports/${REPORT_IDS.report}`, 200, single(report('watchlist')))
    .on('GET', `/transactions/${TRANSACTION_IDS.transaction}`, 200, single(transaction()));
}

/** The modules Phase 7 deferred and the transaction module, for the held inquiry and account. */
export function serveModules(api: RouteApi): RouteApi {
  return api
    .on('GET', '/list-matches', 200, matchList([listMatch()]))
    .on('GET', `/accounts/${IDS.account}/graph-component`, 200, accountGraphComponent())
    .on('GET', '/inquiry-sessions', 200, listOf([]))
    .on(
      'GET',
      `/transactions/${TRANSACTION_IDS.transaction}/status-changes`,
      200,
      pageOf([statusChange('2')]),
    )
    .on('GET', `/transactions/${TRANSACTION_IDS.transaction}/labels`, 200, pageOf([]))
    .on(
      'GET',
      `/transactions/${TRANSACTION_IDS.transaction}/relations`,
      200,
      pageOf([transactionRelation('payer', { type: 'account', id: IDS.account })]),
    );
}
