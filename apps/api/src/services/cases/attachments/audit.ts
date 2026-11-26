/**
 * C143.5 (P19; Workflow 8B, `api-case-files`): the audit entries of attachments, renditions, exports
 * and print. Each action's metadata is a strict schema of ids, enumerated names, member names, counts
 * and pages, so a filename, a field's value or a search value can never reach `audit_logs.metadata`.
 * An export's filter is recorded by its shape alone: the attribute names and operators, never a value.
 */
import { idSchema } from '@openverify/contracts';
import {
  CASE_ATTACHMENT_TYPES,
  CASE_EXPORT_FORMATS,
  CASE_LIMITS,
  CASE_SEARCH_OPERATORS,
} from '@openverify/core';
import { z } from 'zod';
import type { AuditedAction } from '../../context.js';

const count = z.int().min(0);
const page = z.int().min(1).max(CASE_LIMITS['rendition-pages'].value);
/** A member or attribute name: `status`, `case-template-id`, `fields.<key>`; never a value. */
const memberName = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);

/** P19: what an export selects, by its shape. */
export const caseExportShapeSchema = z.union([
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('filter'), members: z.array(memberName).max(20) }),
  z.strictObject({
    kind: z.literal('search'),
    leaves: z
      .array(z.strictObject({ attribute: memberName, operator: z.enum(CASE_SEARCH_OPERATORS) }))
      .max(400),
    sort: memberName.nullable(),
  }),
]);
export type CaseExportShape = z.infer<typeof caseExportShapeSchema>;

const SCHEMAS = {
  'case-attachment.uploaded': z.strictObject({
    'case-id': idSchema('case'),
    'attachment-type': z.enum(CASE_ATTACHMENT_TYPES),
    'byte-size': count,
  }),
  'case-attachment.viewed': z.strictObject({ 'case-id': idSchema('case'), page }),
  'case-attachment.original-viewed': z.strictObject({ 'case-id': idSchema('case') }),
  'file.viewed': z.strictObject({
    kind: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    verificationId: idSchema('ver'),
    page,
    rendition: z.literal(true),
  }),
  'case-export.created': z.strictObject({
    format: z.enum(CASE_EXPORT_FORMATS),
    'include-personal-data': z.boolean(),
    shape: caseExportShapeSchema,
  }),
  'case-export.downloaded': z.strictObject({
    format: z.enum(CASE_EXPORT_FORMATS),
    'include-personal-data': z.boolean(),
    'case-count': count,
  }),
  'case.print-initiated': z.strictObject({}),
} as const;

export type CaseFileAuditAction = keyof typeof SCHEMAS;

export const CASE_FILE_AUDIT_ACTIONS = Object.keys(SCHEMAS) as readonly CaseFileAuditAction[];

const RESOURCE_TYPES: Record<CaseFileAuditAction, string> = {
  'case-attachment.uploaded': 'case-attachment',
  'case-attachment.viewed': 'case-attachment',
  'case-attachment.original-viewed': 'case-attachment',
  'file.viewed': 'file',
  'case-export.created': 'case-export',
  'case-export.downloaded': 'case-export',
  'case.print-initiated': 'case',
};

/**
 * The audited action, its metadata held to the action's schema.
 * @throws {z.ZodError} for metadata outside the action's schema, which is a bug here.
 */
export function caseFileAudit<Action extends CaseFileAuditAction>(
  action: Action,
  resourceId: string,
  metadata: z.input<(typeof SCHEMAS)[Action]>,
): AuditedAction & { metadata: Record<string, unknown> } {
  return {
    action,
    resourceType: RESOURCE_TYPES[action],
    resourceId,
    metadata: SCHEMAS[action].parse(metadata),
  };
}
