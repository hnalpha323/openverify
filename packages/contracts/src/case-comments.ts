/**
 * Case comments (plan C134, decision 61): plain text, sealed with row-bound AAD, append-only. There is
 * no edit and no delete route: `POST /case-comments/:id/redact` nulls the message and keeps the ids,
 * the author and the times, as the public object does after redaction. A mention is an `@[usr_…]`
 * token inside the message, checked against the organisation and the case's read permission, and kept
 * in `mentions`.
 *
 * `message` is PII: masked without `pii:view`, `null` once redacted, and `null` in every event's
 * payload, so a webhook carries no comment's words.
 *
 * Routes (frozen by `foundation-8b`, built by `api-cases`): `GET /cases/:id/comments` and
 * `POST /case-comments/:id/redact`. `POST /cases/:id/add-comment` is in `cases.ts`.
 */
import { caseCommenterTypeSchema, type CaseCommenterType } from '@openverify/core';
import { z } from 'zod';
import { emptyActionBodySchema } from './actions.js';
import { caseLimit } from './case-templates.js';
import { caseIdentifierSchema } from './identifiers.js';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';

/** C134.1: 1 to 10,000 characters. */
export const caseCommentMessageSchema = z.string().min(1).max(caseLimit('comment-characters'));

const COMMENTER_PREFIX: Readonly<Record<CaseCommenterType, string>> = {
  user: 'usr',
  'api-key': 'key',
  'workflow-run': 'wfr',
};

export const caseCommentAttributesSchema = z
  .strictObject({
    /** Masked without PII visibility; `null` once redacted, and in every event's payload. */
    message: caseCommentMessageSchema.nullable().meta({ pii: true }),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
    'redacted-at': timestampSchema.nullable(),
    'commenter-id': z.string().min(1).max(64),
    'commenter-type': caseCommenterTypeSchema,
    /** Who the message names, by id, checked when it was written (C134.3). */
    mentions: z.array(idSchema('usr')).max(caseLimit('mentions-per-comment')),
  })
  .refine(
    (attributes) =>
      attributes['commenter-id'].startsWith(`${COMMENTER_PREFIX[attributes['commenter-type']]}_`),
    { message: 'the id does not belong to the commenter type', path: ['commenter-id'] },
  );

export const caseCommentRelationshipsSchema = z.strictObject({
  case: toOneRelationshipSchema(caseIdentifierSchema),
});

export const caseCommentResourceSchema = resourceWithRelationshipsSchema(
  'case-comment',
  'cscm',
  caseCommentAttributesSchema,
  caseCommentRelationshipsSchema,
);
export type CaseCommentResource = z.infer<typeof caseCommentResourceSchema>;
export const caseCommentDocumentSchema = singleDocumentSchema(caseCommentResourceSchema);
export type CaseCommentDocument = z.infer<typeof caseCommentDocumentSchema>;
export const caseCommentListDocumentSchema = listDocumentSchema(caseCommentResourceSchema);
export type CaseCommentListDocument = z.infer<typeof caseCommentListDocumentSchema>;

/** `GET /api/v1/cases/:id/comments` (C134.1): newest first, by C1's order. */
export const listCaseCommentsQuerySchema = listQuerySchema('cscm', {});

/** `POST /api/v1/case-comments/:id/redact`: the author, or a holder of `cases:redact` (C134.2). */
export const redactCaseCommentBodySchema = emptyActionBodySchema;

/** C143.5: the PII name of a comment, joined to the masking lists by `foundation-8b`. */
export const PII_CASE_COMMENT_ATTRIBUTES: readonly string[] = Object.freeze(['message']);

export interface CaseCommentRecord {
  id: string;
  caseId: string;
  /** As the principal may see it; `null` when redacted, and in an event's payload. */
  message: string | null;
  commenterType: CaseCommenterType;
  commenterId: string;
  mentions: readonly string[];
  createdAt: Date;
  updatedAt: Date;
  redactedAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseCommentResource(record: CaseCommentRecord): CaseCommentResource {
  return caseCommentResourceSchema.parse({
    type: 'case-comment',
    id: record.id,
    attributes: {
      message: record.message,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'redacted-at': toNullableTimestamp(record.redactedAt),
      'commenter-id': record.commenterId,
      'commenter-type': record.commenterType,
      mentions: record.mentions,
    },
    relationships: { case: { data: { type: 'case', id: record.caseId } } },
  });
}
