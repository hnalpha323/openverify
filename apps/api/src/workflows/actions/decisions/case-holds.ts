/**
 * C128.2: whether the case a `case.resolved` wait read holds the decision's subject. No case exists
 * until Workflow 8B, so nothing holds anything, and no resolution counts as a person: the side that
 * fails closed. 8B answers this from its held objects.
 */
import type { Db } from '@openverify/db';
import { caseHoldsSubject } from '../cases/holds.js';

export interface CaseHoldsInput {
  environmentId: string;
  eventId: string;
  subjectId: string;
}

export type CaseHoldsSubject = (tx: Db, input: CaseHoldsInput) => Promise<boolean>;

/** Workflow 8B: the held objects are `api-case-workflows`' to read (`actions/cases/holds.ts`). */
export const CASE_HOLDS_SUBJECT: CaseHoldsSubject = (tx, input) => caseHoldsSubject(tx, input);
