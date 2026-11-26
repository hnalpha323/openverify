'use server';

/**
 * The print audit of the inquiry, report and verification pages (C173.3): one server action that
 * writes the audit entry through `POST /dashboard/print-audits` before the browser's print dialog
 * opens. The API checks the object's own read permission and answers 404 writing nothing otherwise.
 */
import { createPrintAuditBodySchema } from '@openverify/contracts';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction } from '../../lib/api/action';
import { recordPrintAudit } from '../../lib/api/print-audits';

export async function recordObjectPrint(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: [] }, async () => {
    const body = parseInput(createPrintAuditBodySchema, {
      'object-id': formString(formData, 'object-id'),
    });
    await recordPrintAudit(body['object-id']);
    return undefined;
  });
}
