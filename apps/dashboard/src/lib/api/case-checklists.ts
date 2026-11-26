/**
 * The case checklist calls of the case console (C172.2, C172.7): `GET /cases/:id/checklist` reads
 * every item of the case's pinned version with who checked it and when, and
 * `POST /cases/:id/checklist` checks or unchecks one item as the signed-in operator. Nothing here
 * checks an item on a person's behalf: only an operator's own submission calls the write.
 */
import 'server-only';
import {
  caseChecklistStateDocumentSchema,
  type CaseChecklistStateDocument,
  type SetCaseChecklistItemBody,
} from '@openverify/contracts';
import { apiRequest } from './client';

const checklistPath = (caseId: string) => `/cases/${encodeURIComponent(caseId)}/checklist`;

/** `GET /cases/:id/checklist` (`cases:read`). */
export function getCaseChecklist(caseId: string): Promise<CaseChecklistStateDocument> {
  return apiRequest({
    method: 'GET',
    path: checklistPath(caseId),
    schema: caseChecklistStateDocumentSchema,
  });
}

/** `POST /cases/:id/checklist` (`cases:write`): one item, checked or not. */
export function setCaseChecklistItem(
  caseId: string,
  meta: SetCaseChecklistItemBody['meta'],
): Promise<CaseChecklistStateDocument> {
  return apiRequest({
    method: 'POST',
    path: checklistPath(caseId),
    body: { meta },
    schema: caseChecklistStateDocumentSchema,
  });
}
