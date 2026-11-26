/**
 * The print audit of the inquiry, report and verification pages (C173.3, decision 59):
 * `POST /dashboard/print-audits` writes the audit entry before the browser's print dialog opens. It
 * records use of the Print button, not every print: a browser's own menu or shortcut writes nothing.
 */
import 'server-only';
import { printAuditDocumentSchema, type PrintAuditDocument } from '@openverify/contracts';
import { apiRequest } from './client';

/** `POST /dashboard/print-audits` with `{ object-id }`: an `inq_`, `rep_` or `ver_` id. */
export function recordPrintAudit(objectId: string): Promise<PrintAuditDocument> {
  return apiRequest({
    method: 'POST',
    path: '/dashboard/print-audits',
    body: { 'object-id': objectId },
    schema: printAuditDocumentSchema,
  });
}
