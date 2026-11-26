/**
 * C128.1: a decision as a resource, served by `GET /decisions` and the `decisions` include of an
 * inquiry (C143.6). A comment reads `null` without PII visibility (P19).
 */
import {
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  toListItemResourceType,
  type DecisionSubjectType,
} from '@openverify/core';
import { buildDecisionResource, type DecisionResource } from '@openverify/contracts';
import { listDecisionsForSubjects, type Db, type InquiryDecision } from '@openverify/db';
import type { PiiMask } from '../../auth/pii.js';

/** C128: a list item's identifier names its kind, which its id's prefix holds. */
function subjectOf(type: DecisionSubjectType, id: string): { type: string; id: string } {
  if (type !== 'list-item') {
    return { type, id };
  }
  const kind = LIST_KINDS.find((name) => id.startsWith(`${LIST_KIND_REGISTRY[name].itemPrefix}_`));
  if (kind === undefined) {
    throw new Error('a list item decision names no kind');
  }
  return { type: toListItemResourceType(kind), id };
}

/** One decision for a reader with `mask`. */
export function decisionResourceOf(decision: InquiryDecision, mask: PiiMask): DecisionResource {
  return buildDecisionResource({
    ...decision,
    subject: subjectOf(decision.subjectType, decision.subjectId),
    actor: { type: decision.actorType, id: decision.actorId },
    comment: mask.visible ? decision.comment : null,
  });
}

/** The `decisions` include: every decision of the inquiry, newest first. */
export async function includedDecisionsFor(
  db: Db,
  environmentId: string,
  inquiryId: string,
  mask: PiiMask,
): Promise<DecisionResource[]> {
  const decisions = await listDecisionsForSubjects(db, environmentId, [inquiryId]);
  return decisions.map((decision) => decisionResourceOf(decision, mask));
}
