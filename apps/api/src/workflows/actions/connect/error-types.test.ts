/**
 * C120.2, C243.1 (Phase 11, Workflow 11A, `workflow-connect`): a Connect step's error is the code the
 * route would answer, and its public type says what kind of refusal it is, as every other action's
 * does. None reads as `unknown-error`, which says the platform failed: a share token's state, a
 * consent record that does not cover the share, a policy that does not share the source and a
 * conflicting redeem body are each the author's or the resource's, never unknown. Every code here
 * is one `CONNECT_PROBLEM_STATUSES` holds, so the list cannot name a code the services never answer.
 */
import { CONNECT_PROBLEM_STATUSES } from '@openverify/contracts';
import { workflowErrorTypeOf } from '@openverify/workflow-engine';
import { describe, expect, it } from 'vitest';

/** What the three actions' services answer, and the type each is (ours, by its cause). */
const CONNECT_STEP_ERRORS = {
  // create_share_token (C232.1)
  connection_not_active: 'resource-error',
  environment_kind_mismatch: 'configuration-error',
  source_redacted: 'resource-error',
  source_not_decided: 'resource-error',
  source_is_copy: 'resource-error',
  share_source_not_allowed: 'configuration-error',
  share_source_not_supported: 'configuration-error',
  consent_required: 'resource-error',
  share_token_outlives_consent: 'invalid-input-error',
  // expire_share_token (C232.4)
  share_token_not_expirable: 'resource-error',
  // redeem_share_token (C234.1)
  share_token_already_redeemed: 'resource-error',
  share_token_expired: 'resource-error',
  share_token_not_redeemable: 'resource-error',
  destination_not_found: 'resource-error',
  share_redeem_mode_invalid: 'invalid-input-error',
  share_redeem_meta_conflict: 'invalid-input-error',
  destination_inquiry_not_open: 'resource-error',
  consent_declined_in_flow: 'resource-error',
} as const;

describe('the public type of a Connect step error (C120.2, C243.1)', () => {
  it.each(Object.entries(CONNECT_STEP_ERRORS))('%s is a %s', (code, type) => {
    expect(Object.keys(CONNECT_PROBLEM_STATUSES)).toContain(code);
    expect(workflowErrorTypeOf(code)).toBe(type);
  });
});
