/**
 * Inquiry actions (contract C10): `POST /api/v1/inquiries/:id/<action>`, each answering with
 * the updated inquiry. Only the transitions in `INQUIRY_TRANSITIONS` (core) are allowed;
 * anything else answers 409 `invalid-transition`.
 */
import type { InquiryStatus } from '@openverify/core';
import { z } from 'zod';
import { actionBodySchema, emptyActionBodySchema, optionalActionBodySchema } from './actions.js';
import { decisionCommentSchema } from './decisions.js';
import { parseOneTimeLinkFragment, safeUrl } from './flow-url.js';
import { inquiryResourceSchema } from './inquiries.js';
import { timestampSchema } from './json-api.js';
import { MAX_EXPIRATION_SECONDS, MIN_EXPIRATION_SECONDS } from './template-settings.js';

/**
 * C128.1, C128.2: what an API decision declares. `solely-automated` is what the caller says of its
 * own process, `null` on the record when it says nothing; for a run it is computed, never declared.
 * `comment` is sealed in the decision record, never in audit metadata.
 */
const decisionActionMetaSchema = z.strictObject({
  'solely-automated': z.boolean().optional(),
  comment: decisionCommentSchema.optional(),
});

/** `completed`, `failed` or `needs_review` → `approved`. */
export const approveInquiryBodySchema = optionalActionBodySchema(decisionActionMetaSchema);
export type ApproveInquiryBody = z.infer<typeof approveInquiryBodySchema>;
/** `completed`, `failed` or `needs_review` → `declined`. */
export const declineInquiryBodySchema = optionalActionBodySchema(decisionActionMetaSchema);
export type DeclineInquiryBody = z.infer<typeof declineInquiryBodySchema>;
/** `completed` or `failed` → `needs_review`. Its comment has a home on a `review` row (V17). */
export const markInquiryForReviewBodySchema = optionalActionBodySchema(
  z.strictObject({ comment: decisionCommentSchema.optional() }),
);
export type MarkInquiryForReviewBody = z.infer<typeof markInquiryForReviewBodySchema>;
/** `created` or `pending` → `expired`; active sessions and initiated verifications are canceled. */
export const expireInquiryBodySchema = emptyActionBodySchema;
/** Irreversible and idempotent redaction (C16), scope `inquiries:redact`. */
export const redactInquiryBodySchema = emptyActionBodySchema;

/**
 * `POST /inquiries/:id/generate-one-time-link`, for `created` or `pending` inquiries. Revokes
 * older unused links. The lifetime defaults to the template's `one-time-link-expiration-seconds`
 * and never runs past the inquiry's `expires-at`.
 */
export const generateOneTimeLinkBodySchema = optionalActionBodySchema(
  z.strictObject({
    'expires-in-seconds': z
      .int()
      .min(MIN_EXPIRATION_SECONDS)
      .max(MAX_EXPIRATION_SECONDS)
      .optional(),
  }),
);
export type GenerateOneTimeLinkBody = z.infer<typeof generateOneTimeLinkBodySchema>;

/** The inquiry a one-time link names, or `null` when it is not a fragment-only link. */
function oneTimeLinkInquiryId(link: string): string | null {
  const url = safeUrl(link);
  return url?.search === '' ? (parseOneTimeLinkFragment(url.hash)?.inquiryId ?? null) : null;
}

/** `meta` of the generate-one-time-link response: the link carries its token in the fragment. */
export const oneTimeLinkMetaSchema = z
  .strictObject({
    'one-time-link': z.url({ protocol: /^https?$/ }),
    'expires-at': timestampSchema,
  })
  .refine((meta) => oneTimeLinkInquiryId(meta['one-time-link']) !== null, {
    message: 'the link must carry the inquiry id and one-time token in its fragment',
    path: ['one-time-link'],
  });
export type OneTimeLinkMeta = z.infer<typeof oneTimeLinkMetaSchema>;

export const generateOneTimeLinkDocumentSchema = z
  .strictObject({ data: inquiryResourceSchema, meta: oneTimeLinkMetaSchema })
  .refine(({ data, meta }) => oneTimeLinkInquiryId(meta['one-time-link']) === data.id, {
    message: 'the one-time link must name this inquiry',
    path: ['meta', 'one-time-link'],
  });
export type GenerateOneTimeLinkDocument = z.infer<typeof generateOneTimeLinkDocumentSchema>;

/**
 * `POST /inquiries/:id/reopen` (C128.6): `declined` → `needs_review`, with `inquiry.reopened`, for a
 * user holding `inquiries:write`, never an API key or a run. The comment is required and sealed in
 * the decision record, and human review stays pending until a user decides. A decline's biometric
 * deletion is not undone. A redacted inquiry answers 410 (outcome 6).
 */
export const reopenInquiryBodySchema = actionBodySchema(
  z.strictObject({ comment: decisionCommentSchema }),
);
export type ReopenInquiryBody = z.infer<typeof reopenInquiryBodySchema>;

/** Sandbox-only actions of `perform-simulate-actions`; production answers 403 `sandbox-only`. */
export const INQUIRY_SIMULATE_ACTIONS = [
  'start_inquiry',
  'complete_inquiry',
  'fail_inquiry',
  'expire_inquiry',
  'approve_inquiry',
  'decline_inquiry',
  'mark_for_review_inquiry',
] as const;
export const inquirySimulateActionSchema = z.enum(INQUIRY_SIMULATE_ACTIONS);
export type InquirySimulateAction = z.infer<typeof inquirySimulateActionSchema>;

/** The status each simulate action moves the inquiry to, through the normal transition rules. */
export const SIMULATE_ACTION_TARGET_STATUS = Object.freeze({
  start_inquiry: 'pending',
  complete_inquiry: 'completed',
  fail_inquiry: 'failed',
  expire_inquiry: 'expired',
  approve_inquiry: 'approved',
  decline_inquiry: 'declined',
  mark_for_review_inquiry: 'needs_review',
} as const satisfies Record<InquirySimulateAction, InquiryStatus>);

export const MAX_SIMULATE_ACTIONS = 20;

/** `POST /inquiries/:id/perform-simulate-actions`: actions run in order, each a valid transition. */
export const performSimulateActionsBodySchema = actionBodySchema(
  z.strictObject({
    actions: z
      .array(z.strictObject({ type: inquirySimulateActionSchema }))
      .min(1)
      .max(MAX_SIMULATE_ACTIONS),
  }),
);
export type PerformSimulateActionsBody = z.infer<typeof performSimulateActionsBodySchema>;
