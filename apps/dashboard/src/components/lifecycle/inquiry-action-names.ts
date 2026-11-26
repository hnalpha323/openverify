/**
 * The inquiry page's action vocabulary, shared by its server actions and its client components
 * (a `'use server'` module may export only async functions).
 */
import {
  INQUIRY_SIMULATE_ACTIONS,
  SIMULATE_ACTION_TARGET_STATUS,
  type InquirySimulateAction,
} from '@openverify/contracts';
import { canTransitionInquiry, type InquiryStatus } from '@openverify/core';

/** C10's status actions, in the order the page offers them. */
export const INQUIRY_TRANSITION_ACTIONS = [
  'approve',
  'decline',
  'mark-for-review',
  'expire',
] as const;
export type InquiryTransitionAction = (typeof INQUIRY_TRANSITION_ACTIONS)[number];

/** The status each action moves an inquiry to. */
export const INQUIRY_ACTION_TARGET: Readonly<Record<InquiryTransitionAction, InquiryStatus>> = {
  approve: 'approved',
  decline: 'declined',
  'mark-for-review': 'needs_review',
  expire: 'expired',
};

/** The word an operator types to confirm a redaction. */
export const REDACT_PHRASE = 'redact';

/** The actions `INQUIRY_TRANSITIONS` (core) allows from `status`. */
export function inquiryActionsFor(status: InquiryStatus): InquiryTransitionAction[] {
  return INQUIRY_TRANSITION_ACTIONS.filter((action) =>
    canTransitionInquiry(status, INQUIRY_ACTION_TARGET[action]),
  );
}

/** The sandbox simulate actions whose transition C10 allows from `status`. */
export function simulateActionsFor(status: InquiryStatus): InquirySimulateAction[] {
  return INQUIRY_SIMULATE_ACTIONS.filter((action) =>
    canTransitionInquiry(status, SIMULATE_ACTION_TARGET_STATUS[action]),
  );
}
