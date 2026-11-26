/**
 * C128.1, C128.6: the services of `POST /inquiries/:id/reopen` and `GET /decisions`. The reopen itself
 * is the `reopen` option of `applyInquiryAction`, which refuses anyone but a user and a redacted
 * inquiry, and opens human review pending through its decision record.
 */
import {
  type DecisionListDocument,
  type InquiryResource,
  type ListDecisionsQuery,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { listInquiryDecisions } from '@openverify/db';
import { SignalProblemError } from '../../errors.js';
import { authorizePrincipal } from '../../plugins/principal-auth.js';
import type { Principal } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import { applyInquiryAction, inquiryResourceOf, lockedInquiry, type Acting } from '../inquiries.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { deleteObjects } from '../selfie-captures.js';
import { decisionResourceOf } from './resources.js';

export const DECISIONS_PATH = '/api/v1/decisions';

/** C128.6: a user, with a required comment; opens human review pending. */
export async function reopenInquiry(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  comment: string,
): Promise<InquiryResource> {
  const { db, events } = deps;
  const { environmentId } = acting.ctx;
  const result = await db.transaction(async (tx) =>
    applyInquiryAction(
      tx,
      deps,
      acting,
      await lockedInquiry(tx, environmentId, id),
      'needs_review',
      {
        reopen: true,
        decision: { comment },
      },
    ),
  );
  await events.dispatch(result.staged);
  await deleteObjects(deps.storage, result.storageKeys);
  return inquiryResourceOf(db, environmentId, result.inquiry, acting.mask);
}

/** V10: a subject's decisions are read under its own read scope, by its id's prefix. */
function readScopeOf(subjectId: string): Permission {
  if (subjectId.startsWith('inq_')) {
    return 'inquiries:read';
  }
  if (subjectId.startsWith('txn_')) {
    return 'transactions:read';
  }
  return subjectId.startsWith('acc_') ? 'accounts:read' : 'lists:read';
}

/** C128.1 (V10): `principal` needs the subject's read scope. */
export async function listDecisions(
  deps: ApiDependencies,
  acting: Acting,
  principal: Principal,
  query: ListDecisionsQuery,
): Promise<DecisionListDocument> {
  const subjectId = query['filter[subject-id]'];
  if (subjectId === undefined) {
    throw new SignalProblemError(
      'filter_required',
      'Decisions are listed per subject: give filter[subject-id].',
    );
  }
  authorizePrincipal(principal, [readScopeOf(subjectId)]);
  const page = await withCursor(() =>
    listInquiryDecisions(deps.db, acting.ctx.environmentId, subjectId, pageRequest(query)),
  );
  return {
    data: page.items.map((decision) => decisionResourceOf(decision, acting.mask)),
    links: {
      next: nextLink(DECISIONS_PATH, { 'filter[subject-id]': subjectId }, query, page.next),
    },
  };
}
