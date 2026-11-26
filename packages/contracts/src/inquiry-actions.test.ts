import { describe, expect, it } from 'vitest';
import { buildInquiryResource } from './inquiries.js';
import {
  INQUIRY_SIMULATE_ACTIONS,
  SIMULATE_ACTION_TARGET_STATUS,
  approveInquiryBodySchema,
  declineInquiryBodySchema,
  expireInquiryBodySchema,
  generateOneTimeLinkBodySchema,
  generateOneTimeLinkDocumentSchema,
  markInquiryForReviewBodySchema,
  oneTimeLinkMetaSchema,
  performSimulateActionsBodySchema,
  redactInquiryBodySchema,
} from './inquiry-actions.js';
import { AT, IDS, LATER_ISO, TOKENS } from './test-support.js';

const inquiry = buildInquiryResource({
  id: IDS.inquiry,
  status: 'created',
  referenceId: null,
  fields: {},
  inquiryTemplateId: IDS.template,
  verifications: [],
  createdAt: AT,
  updatedAt: AT,
});

const link = `https://flow.example.test/#inquiry-id=${IDS.inquiry}&one-time-token=${TOKENS.oneTimeLink}`;

describe('plain inquiry actions (C10)', () => {
  it.each([
    ['approve', approveInquiryBodySchema],
    ['decline', declineInquiryBodySchema],
    ['mark-for-review', markInquiryForReviewBodySchema],
    ['expire', expireInquiryBodySchema],
    ['redact', redactInquiryBodySchema],
  ])('%s takes no parameters', (_name, schema) => {
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse({ meta: {} })).toEqual({ meta: {} });
    expect(schema.safeParse({ meta: { status: 'approved' } }).success).toBe(false);
  });
});

describe('POST /inquiries/:id/generate-one-time-link (C10)', () => {
  it('takes an optional lifetime of 5 minutes to 30 days', () => {
    expect(generateOneTimeLinkBodySchema.parse(undefined)).toBeUndefined();
    expect(generateOneTimeLinkBodySchema.parse({ meta: { 'expires-in-seconds': 300 } })).toEqual({
      meta: { 'expires-in-seconds': 300 },
    });
    for (const seconds of [299, 2_592_001, 600.5]) {
      expect(
        generateOneTimeLinkBodySchema.safeParse({ meta: { 'expires-in-seconds': seconds } })
          .success,
      ).toBe(false);
    }
  });

  it('returns the inquiry with the link and its expiry', () => {
    const document = { data: inquiry, meta: { 'one-time-link': link, 'expires-at': LATER_ISO } };
    expect(generateOneTimeLinkDocumentSchema.parse(document)).toEqual(document);
  });

  it('keeps the token in the fragment of a link naming this inquiry', () => {
    expect(
      oneTimeLinkMetaSchema.safeParse({
        'one-time-link': link.replace('/#', '/?'),
        'expires-at': LATER_ISO,
      }).success,
    ).toBe(false);
    expect(
      oneTimeLinkMetaSchema.safeParse({
        'one-time-link': link.replace(TOKENS.oneTimeLink, TOKENS.session),
        'expires-at': LATER_ISO,
      }).success,
    ).toBe(false);
    expect(
      oneTimeLinkMetaSchema.safeParse({ 'one-time-link': 'not a url', 'expires-at': LATER_ISO })
        .success,
    ).toBe(false);
    const other = { ...inquiry, id: IDS.otherInquiry };
    expect(
      generateOneTimeLinkDocumentSchema.safeParse({
        data: other,
        meta: { 'one-time-link': link, 'expires-at': LATER_ISO },
      }).success,
    ).toBe(false);
  });
});

describe('POST /inquiries/:id/perform-simulate-actions (C10)', () => {
  it('lists the seven simulate actions and the status each one targets', () => {
    expect(INQUIRY_SIMULATE_ACTIONS).toEqual([
      'start_inquiry',
      'complete_inquiry',
      'fail_inquiry',
      'expire_inquiry',
      'approve_inquiry',
      'decline_inquiry',
      'mark_for_review_inquiry',
    ]);
    expect(SIMULATE_ACTION_TARGET_STATUS).toEqual({
      start_inquiry: 'pending',
      complete_inquiry: 'completed',
      fail_inquiry: 'failed',
      expire_inquiry: 'expired',
      approve_inquiry: 'approved',
      decline_inquiry: 'declined',
      mark_for_review_inquiry: 'needs_review',
    });
  });

  it('takes 1 to 20 actions, run in order', () => {
    const body = {
      meta: { actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }] },
    };
    expect(performSimulateActionsBodySchema.parse(body)).toEqual(body);
    expect(performSimulateActionsBodySchema.safeParse({ meta: { actions: [] } }).success).toBe(
      false,
    );
    expect(
      performSimulateActionsBodySchema.safeParse({
        meta: { actions: Array.from({ length: 21 }, () => ({ type: 'start_inquiry' })) },
      }).success,
    ).toBe(false);
    expect(
      performSimulateActionsBodySchema.safeParse({
        meta: { actions: [{ type: 'redact_inquiry' }] },
      }).success,
    ).toBe(false);
  });
});
