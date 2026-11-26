/**
 * Workflow 8C review K8-22 (P19, C143.5, plan item 114): the audit entries of cases, comments,
 * templates and their versions, case actions, bulk actions and review requests. Each action's metadata
 * is a strict schema of ids, member names, keys, enumerated values and counts, as the queue
 * (`queues/audit.ts`) and file (`attachments/audit.ts`) actions already are, so a comment, a field
 * value, a name or a statement can never reach `audit_logs.metadata`. `auditEntryOf`
 * (`services/context.ts`) holds every case unit's and route's entry to it, and the case redaction its
 * own; `audit.test.ts` fails an audited case action that has none.
 */
import {
  CASE_LIMITS,
  CASE_STATUS_KEY_PATTERN,
  FIELD_KEY_PATTERN,
  caseBulkActionSchema,
} from '@openverify/core';
import { z } from 'zod';

const count = z.int().min(0);
/** An id of any object (`<prefix>_<ULID>`): never a value. */
const objectId = z.string().regex(/^[a-z][a-z0-9]{1,15}_[0-9A-Z]{26}$/);
const attributeNames = z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(20);
const fieldKeys = z.array(z.string().max(128).regex(FIELD_KEY_PATTERN)).max(1_000);
const statusKey = z.string().max(64).regex(CASE_STATUS_KEY_PATTERN);
const objectIds = z.array(objectId).max(CASE_LIMITS['object-ids'].value);
const none = z.strictObject({});

const SCHEMAS = {
  'case.created': z.strictObject({ 'case-template-id': objectId, 'held-object-count': count }),
  'case.updated': z.strictObject({
    attributes: attributeNames,
    'field-keys': fieldKeys.optional(),
  }),
  'case.status-changed': z.strictObject({ from: statusKey, to: statusKey }),
  'case.comment-added': z.strictObject({ 'comment-id': objectId, 'mention-count': count }),
  'case.objects-added': z.strictObject({ 'object-ids': objectIds }),
  'case.objects-removed': z.strictObject({ 'object-ids': objectIds }),
  'case.tags-changed': z.strictObject({ added: count, removed: count }),
  // The cause a cascade or retention names (`redactCasesInTx`'s `cause`).
  'case.redacted': z.strictObject({
    'comment-count': count,
    'transaction-id': objectId.optional(),
    retention: z.literal('case-retention-days').optional(),
  }),
  'case-comment.redacted': z.strictObject({ 'case-id': objectId }),
  // K8-21 (P22): an image attachment redacted with a held selfie inquiry's biometric data.
  'case-attachment.redacted': z.strictObject({
    'case-id': objectId,
    'inquiry-id': objectId,
    retention: z.literal('biometric'),
  }),
  'case-template.created': none,
  'case-template.updated': z.strictObject({ attributes: attributeNames }),
  'case-template.archived': none,
  'case-template-version.created': none,
  'case-template-version.updated': z.strictObject({ attributes: attributeNames }),
  'case-template-version.published': z.strictObject({
    'case-template-id': objectId,
    'version-number': z.int().min(1),
  }),
  'case-action.created': z.strictObject({
    'workflow-id': objectId,
    'case-template-ids': z.array(objectId).max(1_000),
  }),
  'case-action.updated': none,
  'case-action.run': z.strictObject({ 'workflow-run-id': objectId, 'case-id': objectId }),
  'case-bulk-action.created': z.strictObject({ action: caseBulkActionSchema, 'case-count': count }),
  'inquiry.review-requested': z.strictObject({ 'case-id': objectId, 'case-template-id': objectId }),
} as const;

export type CaseAuditAction = keyof typeof SCHEMAS;

export const CASE_AUDIT_ACTIONS = Object.keys(SCHEMAS) as readonly CaseAuditAction[];

const isCaseAuditAction = (action: string): action is CaseAuditAction =>
  Object.hasOwn(SCHEMAS, action);

/**
 * The metadata of `action`, held to its schema when it is a case action; any other action's as given.
 * @throws {z.ZodError} for metadata outside the action's schema, which is a bug where it was written.
 */
export function checkedCaseAuditMetadata(
  action: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (isCaseAuditAction(action)) {
    SCHEMAS[action].parse(metadata ?? {});
  }
  return metadata === undefined ? undefined : { ...metadata };
}
