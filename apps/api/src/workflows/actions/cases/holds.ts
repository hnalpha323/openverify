/**
 * C128.2 (Workflow 8B): whether the case a `case.resolved` wait read holds the decision's subject (or
 * a report of it, the review recipe's shape), from the case's held objects. `CASE_HOLDS_SUBJECT`
 * (`workflows/actions/decisions/case-holds.ts`) calls it. Owner `api-case-workflows`;
 * `foundation-8b` made the join.
 *
 * The case is the one the wait's event names, read from the stored event, never from the run's
 * values. An event that is gone, is not about a case, or names a case that holds neither the subject
 * nor a report of it answers false: no resolution counts as a person then, the side that fails closed.
 */
import { caseHoldsAnyOf, caseHoldsReportOfInquiry, getEventCause, type Db } from '@openverify/db';
import type { CaseHoldsInput } from '../decisions/case-holds.js';

const CASE_EVENT = 'case.';
const INQUIRY_ID = 'inq_';

/** The case a stored event's payload is about, or `null`. */
function caseIdOf(payload: unknown): string | null {
  const data = (payload as { data?: { type?: unknown; id?: unknown } } | null)?.data;
  return data?.type === 'case' && typeof data.id === 'string' ? data.id : null;
}

export async function caseHoldsSubject(tx: Db, input: CaseHoldsInput): Promise<boolean> {
  const { environmentId, eventId, subjectId } = input;
  const event = await getEventCause(tx, environmentId, eventId);
  const caseId = event?.name.startsWith(CASE_EVENT) === true ? caseIdOf(event.payload) : null;
  if (caseId === null) {
    return false;
  }
  if (await caseHoldsAnyOf(tx, environmentId, caseId, [subjectId])) {
    return true;
  }
  return (
    subjectId.startsWith(INQUIRY_ID) &&
    (await caseHoldsReportOfInquiry(tx, environmentId, caseId, subjectId))
  );
}
