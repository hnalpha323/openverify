/**
 * `dashboard-cases-reports`' mock routes (Workflow 9C; C172, C173), registered on a `routeApi()`
 * the test made, standing alone as the other areas' route modules do: the case checklist read and
 * write and the print audit. Paths are after `/api/v1`; every value is synthetic.
 */
import {
  caseChecklistStateDocumentSchema,
  printAuditDocumentSchema,
  type CaseChecklistStateDocument,
  type PrintAuditDocument,
} from '@openverify/contracts';
import type { RouteApi } from '../api-routes';
import { REVIEWER_IDS } from '../reviewer-fixtures';

export const PRINT_AUDITS_PATH = '/dashboard/print-audits';
export const checklistPath = (caseId: string = REVIEWER_IDS.case) => `/cases/${caseId}/checklist`;

/** A synthetic audit entry id and time for the print audit's answer. */
export const PRINT_AUDIT_ID = 'aud_01JE00000000000000000000PA';
export const PRINT_RECORDED_AT = '2026-11-02T09:30:00.000Z';
export const CHECKED_AT = '2026-11-02T08:45:00.000Z';

export interface ChecklistItemState {
  readonly checklist: string;
  readonly item: string;
  /** Who checked it, or nobody. */
  readonly by?: string | null;
}

/** The checklist state document: `items` checked by whom they name, the rest unchecked. */
export function checklistState(
  items: readonly ChecklistItemState[],
  lockVersion = 3,
  caseId: string = REVIEWER_IDS.case,
): CaseChecklistStateDocument {
  return caseChecklistStateDocumentSchema.parse({
    data: {
      type: 'case-checklist-state',
      id: caseId,
      attributes: {
        items: items.map(({ checklist, item, by = null }) => ({
          'checklist-key': checklist,
          'item-key': item,
          checked: by !== null,
          'checked-by': by,
          'checked-at': by === null ? null : CHECKED_AT,
        })),
        'lock-version': lockVersion,
      },
    },
  });
}

/** The print audit's answer for `objectId`. */
export function printAudit(objectId: string): PrintAuditDocument {
  return printAuditDocumentSchema.parse({
    data: {
      type: 'print-audit',
      id: PRINT_AUDIT_ID,
      attributes: { 'object-id': objectId, 'recorded-at': PRINT_RECORDED_AT },
    },
  });
}

/** `GET /cases/:id/checklist` answering `state`. */
export function serveChecklist(
  api: RouteApi,
  state: CaseChecklistStateDocument,
  caseId: string = REVIEWER_IDS.case,
): RouteApi {
  return api.on('GET', checklistPath(caseId), 200, state);
}

/** `POST /dashboard/print-audits` recording whatever object it is given. */
export function servePrintAudits(api: RouteApi): RouteApi {
  return api.handle('POST', PRINT_AUDITS_PATH, (request) => {
    const objectId = (request.body as { 'object-id': string })['object-id'];
    return { status: 201, body: printAudit(objectId) };
  });
}
