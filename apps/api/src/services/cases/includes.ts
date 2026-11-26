/**
 * K8-19 (Workflow 8D; C143.6, plan items 68 and 102): what `GET /cases/:id?include=` adds beside
 * the template and the comments: the case's queue and each held kind.
 *
 * - Each resource is what its own route serves to the same reader, through the same function, so
 *   it is masked as that route masks it (the account, inquiry, report, verification, transaction,
 *   graph-query and queue documents; a report run as the report's history serves it).
 * - A kind needs its own route's read scope beside `cases:read`. Without it the kind is left out,
 *   never refused: holding an object grants nothing (C136.3), and a case page asks for every kind.
 * - A held kind includes what the case's relationship names (its newest 50, C129.2). An object its
 *   own route would not serve (gone, or answering 404 or 410) is left out the same way.
 */
import { missingPermissions, type Permission } from '@openverify/core';
import type { CaseIncludeDocument, CaseResource } from '@openverify/contracts';
import { getReportRun } from '@openverify/db';
import { AppError, NotFoundError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { accountResource, getAccountView } from '../accounts.js';
import { getGraphQueryDocument } from '../graph/queries.js';
import { getInquiryDocument } from '../inquiries.js';
import { findStoredReport, getReportResource } from '../reports/reports.js';
import { reportRunResource } from '../reports/resources.js';
import { getTransactionDocument } from '../transactions/transactions.js';
import { getVerificationDocument } from '../verifications.js';
import { getCaseQueue } from './queues/service.js';
import type { CaseActing } from './service.js';

type Included = NonNullable<CaseIncludeDocument['included']>[number];

/** The includes this module serves, with the scope each one's own route asks. */
export const HELD_INCLUDE_SCOPES = {
  'case-queue': ['case-queues:read'],
  accounts: ['accounts:read'],
  inquiries: ['inquiries:read'],
  reports: ['reports:read'],
  verifications: ['verifications:read'],
  txns: ['transactions:read'],
  'report-runs': ['reports:read'],
  'graph-queries': ['graph:read'],
} as const satisfies Record<string, readonly Permission[]>;

export type HeldInclude = keyof typeof HELD_INCLUDE_SCOPES;

export const isHeldInclude = (name: string): name is HeldInclude =>
  Object.hasOwn(HELD_INCLUDE_SCOPES, name);

/** A route's own refusal of one object (404, 410): the object is left out of `included`. */
const notServed = (error: unknown) =>
  error instanceof AppError && (error.status === 404 || error.status === 410);

async function served(read: () => Promise<Included>): Promise<Included[]> {
  try {
    return [await read()];
  } catch (error) {
    if (notServed(error)) {
      return [];
    }
    throw error;
  }
}

/** The ids a relationship of the case names. */
function idsOf(resource: CaseResource, name: Exclude<HeldInclude, 'case-queue'>): string[] {
  const data = resource.relationships[name].data as readonly { id: string }[];
  return data.map(({ id }) => id);
}

/** One included resource, as its own route serves it to `acting`. */
function readerOf(
  deps: ApiDependencies,
  acting: CaseActing,
  name: Exclude<HeldInclude, 'case-queue'>,
): (id: string) => Promise<Included> {
  const { environmentId } = acting.ctx;
  switch (name) {
    case 'accounts':
      return async (id) =>
        accountResource(await getAccountView(deps, environmentId, id), acting.mask);
    case 'inquiries':
      return async (id) => (await getInquiryDocument(deps, acting, id)).data;
    case 'reports':
      return (id) => getReportResource(deps, environmentId, id, acting.mask);
    case 'verifications':
      return async (id) =>
        (await getVerificationDocument(deps, environmentId, id, acting.mask)).data;
    case 'txns':
      return async (id) => (await getTransactionDocument(deps, acting, id, {})).data;
    case 'report-runs':
      return async (id) => {
        const run = await getReportRun(deps.db, environmentId, id);
        if (run === null) {
          throw new NotFoundError(`Report run ${id} was not found.`);
        }
        return reportRunResource(await findStoredReport(deps.db, environmentId, run.reportId), run);
      };
    case 'graph-queries':
      return async (id) => (await getGraphQueryDocument(deps, acting, id)).data;
  }
}

/** The included resources of `names` for the case `resource`, each under its own scope. */
export async function heldIncludes(
  deps: ApiDependencies,
  acting: CaseActing,
  resource: CaseResource,
  names: readonly HeldInclude[],
): Promise<Included[]> {
  const included: Included[] = [];
  for (const name of names) {
    if (missingPermissions(acting.principal.permissions, HELD_INCLUDE_SCOPES[name]).length > 0) {
      continue;
    }
    if (name === 'case-queue') {
      const queue = resource.relationships['case-queue'].data;
      if (queue !== null) {
        included.push(...(await served(async () => (await getCaseQueue(deps, acting, queue.id)).data)));
      }
      continue;
    }
    const read = readerOf(deps, acting, name);
    for (const id of idsOf(resource, name)) {
      included.push(...(await served(() => read(id))));
    }
  }
  return included;
}
