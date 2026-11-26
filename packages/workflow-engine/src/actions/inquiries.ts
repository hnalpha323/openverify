/**
 * C127.1, C126.8, C128: the inquiry actions. `meta.comment` is sealed in the decision record. The
 * output says what the step did as a code (H24), so a read of `status` alone never hides that another
 * actor decided first. A transition the state machine refuses is the step error `invalid_transition`.
 */
import { inquiryStatusSchema } from '@openverify/core';
import { z } from 'zod';
import {
  actionOutcomeSchema,
  actionReferenceSchema,
  actionValueMapSchema,
  adverseConfigShape,
  decisionCommentTemplateSchema,
  decisionFollowsOutcome,
  decisionIdSchema,
  plain,
} from './common.js';
import { messageOutputShape } from './messages.js';

const decisionConfigShape = {
  'inquiry-id': actionReferenceSchema,
  comment: decisionCommentTemplateSchema.optional(),
};

const decisionOutputShape = {
  'inquiry-id': plain(z.string().regex(/^inq_/)),
  status: plain(inquiryStatusSchema),
  outcome: plain(actionOutcomeSchema),
  'decision-id': plain(decisionIdSchema),
};

const DECISION_RULE = { message: 'a step that changed nothing made no decision' };

export const approveInquiryConfigSchema = z.strictObject(decisionConfigShape);
export type ApproveInquiryConfig = z.infer<typeof approveInquiryConfigSchema>;

export const approveInquiryOutputSchema = z
  .strictObject(decisionOutputShape)
  .refine(decisionFollowsOutcome, DECISION_RULE);
export type ApproveInquiryOutput = z.infer<typeof approveInquiryOutputSchema>;

export const declineInquiryConfigSchema = z.strictObject({
  ...decisionConfigShape,
  ...adverseConfigShape,
});
export type DeclineInquiryConfig = z.infer<typeof declineInquiryConfigSchema>;

export const declineInquiryOutputSchema = z
  .strictObject({
    ...decisionOutputShape,
    /** C128.2: computed at run time; `null` when no decision was made. */
    'solely-automated': plain(z.boolean().nullable()),
  })
  .refine(decisionFollowsOutcome, DECISION_RULE);
export type DeclineInquiryOutput = z.infer<typeof declineInquiryOutputSchema>;

export const markInquiryForReviewConfigSchema = z.strictObject(decisionConfigShape);
export type MarkInquiryForReviewConfig = z.infer<typeof markInquiryForReviewConfigSchema>;

export const markInquiryForReviewOutputSchema = z
  .strictObject(decisionOutputShape)
  .refine(decisionFollowsOutcome, DECISION_RULE);
export type MarkInquiryForReviewOutput = z.infer<typeof markInquiryForReviewOutputSchema>;

export const createInquiryConfigSchema = z.strictObject({
  'inquiry-template-id': actionReferenceSchema,
  'account-id': actionReferenceSchema.optional(),
  'reference-id': actionReferenceSchema.optional(),
  fields: actionValueMapSchema.optional(),
});
export type CreateInquiryConfig = z.infer<typeof createInquiryConfigSchema>;

export const createInquiryOutputSchema = z.strictObject({
  'inquiry-id': plain(z.string().regex(/^inq_/)),
  status: plain(inquiryStatusSchema),
  'account-id': plain(z.string().regex(/^acc_/).nullable()),
});
export type CreateInquiryOutput = z.infer<typeof createInquiryOutputSchema>;

/**
 * C126.1, C126.2, P32, V23: a one-time link goes only to a destination the person confirmed, so this
 * config has no `allow-unconfirmed` and no recipient: the action reads the inquiry's confirmed email
 * or number. The link's token exists only in the outgoing message.
 */
export const sendInquiryLinkConfigSchema = z.strictObject({
  'inquiry-id': actionReferenceSchema,
  'expires-in-seconds': z.int().min(60).max(2_592_000).optional(),
});
export type SendInquiryLinkConfig = z.infer<typeof sendInquiryLinkConfigSchema>;

export const sendInquiryLinkOutputSchema = z.strictObject({
  'one-time-link-id': plain(z.string().min(1).max(64)),
  'expires-at': plain(z.iso.datetime({ offset: true })),
  ...messageOutputShape,
});
export type SendInquiryLinkOutput = z.infer<typeof sendInquiryLinkOutputSchema>;
