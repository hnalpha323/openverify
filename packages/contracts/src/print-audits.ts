/**
 * C173.3 (Phase 9, Workflow 9B Stage 1a, (C); K12, decision 59): `POST /api/v1/dashboard/print-audits`
 * writes the audit entry before the browser's print dialog opens, for an inquiry, a report or a
 * verification page. It records use of the print button, not every print (a browser's menu or
 * shortcut writes nothing), which the print view and the docs say (review P36). The entry's metadata
 * names the object only, under a strict schema (Phase 8 C143.5). `api-cases-reports` builds it.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { singleDocumentSchema, timestampSchema } from './json-api.js';

/** The objects with a print view (C173.3). */
export const printAuditObjectIdSchema = z.union([
  idSchema('inq'),
  idSchema('rep'),
  idSchema('ver'),
]);

export const createPrintAuditBodySchema = z.strictObject({ 'object-id': printAuditObjectIdSchema });
export type CreatePrintAuditBody = z.infer<typeof createPrintAuditBodySchema>;

/** The answer: the audit entry written, and when. */
export const printAuditDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('print-audit'),
    id: idSchema('aud'),
    attributes: z.strictObject({
      'object-id': printAuditObjectIdSchema,
      'recorded-at': timestampSchema,
    }),
  }),
);
export type PrintAuditDocument = z.infer<typeof printAuditDocumentSchema>;
