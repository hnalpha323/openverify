/**
 * C248.7 (Phase 11, Workflow 11B, `sso-oidc`): why an SSO sign-in, step-up or start failed. The
 * browser sees one generic problem per page (`SSO_PROBLEM_STATUSES`, the details of the goldens in
 * `contracts/fixtures/problems/sso/`); the precise failure is a code from {@link SSO_FAILURE_CODES},
 * kept only for the audit entry, the logs and the metric `sso_sign_in_refused`, and never carries a
 * value from the identity provider (no email, subject, claim, code, state, nonce or token; rule 11).
 */
import { SSO_PROBLEM_STATUSES, type SsoProblemCode } from '@openverify/contracts';
import { AppError } from '../../errors.js';

/** Each refusal's own code (ours), grouped by the problem the browser is answered. */
export const SSO_FAILURE_PROBLEMS = Object.freeze({
  // sso_not_configured (404): nothing to sign in with.
  organization_unknown: 'sso_not_configured',
  provider_unknown: 'sso_not_configured',
  redirect_uri_unset: 'sso_not_configured',
  discovery_failed: 'sso_not_configured',
  issuer_mismatch: 'sso_not_configured',
  tenant_pin_missing: 'sso_not_configured',
  algorithms_unsupported: 'sso_not_configured',
  client_auth_unsupported: 'sso_not_configured',
  // sso_state_invalid (400): the callback does not match a live attempt, or the provider failed it.
  binding_missing: 'sso_state_invalid',
  binding_unknown: 'sso_state_invalid',
  provider_mismatch: 'sso_state_invalid',
  state_mismatch: 'sso_state_invalid',
  provider_error: 'sso_state_invalid',
  token_exchange_failed: 'sso_state_invalid',
  session_gone: 'sso_state_invalid',
  // sso_email_unverified (403): a first link needs a verified email.
  email_missing: 'sso_email_unverified',
  email_unverified: 'sso_email_unverified',
  // sso_user_unknown (403): no one to sign in as.
  tenant_pin_mismatch: 'sso_user_unknown',
  email_domain_not_allowed: 'sso_user_unknown',
  user_unknown: 'sso_user_unknown',
  user_inactive: 'sso_user_unknown',
  identity_linked_elsewhere: 'sso_user_unknown',
  jit_role_refused: 'sso_user_unknown',
  step_up_identity_mismatch: 'sso_user_unknown',
  step_up_stale: 'sso_user_unknown',
  step_up_requirement_unmet: 'sso_user_unknown',
} as const satisfies Record<string, SsoProblemCode>);

export type SsoFailureCode = keyof typeof SSO_FAILURE_PROBLEMS;
export const SSO_FAILURE_CODES = Object.freeze(
  Object.keys(SSO_FAILURE_PROBLEMS) as SsoFailureCode[],
);

/** The one detail each problem carries (the goldens' words). */
export const SSO_PROBLEM_DETAILS: Readonly<Record<SsoProblemCode, string>> = Object.freeze({
  sso_not_configured: 'Single sign-on is not available for this organization.',
  sso_state_invalid: 'The sign-in attempt could not be matched. Start signing in again.',
  sso_email_unverified: 'The identity provider did not confirm a verified email address.',
  sso_user_unknown: 'No user of this organization matches the identity provider’s account.',
  sso_password_disabled: 'This organization signs in with single sign-on only.',
  organization_slug_taken: 'Another organization already uses this sign-in name.',
});

/** A generic SSO problem toward the browser, carrying its precise failure for the audit and logs. */
export class SsoFlowError extends AppError {
  override name = 'SsoFlowError';
  readonly failure: SsoFailureCode;

  constructor(failure: SsoFailureCode) {
    const code = SSO_FAILURE_PROBLEMS[failure];
    super({ status: SSO_PROBLEM_STATUSES[code], detail: SSO_PROBLEM_DETAILS[code], code });
    this.failure = failure;
  }
}

/** C248.8: 409 `organization_slug_taken`: another organisation holds the sign-in name. */
export class OrganizationSlugTakenError extends AppError {
  override name = 'OrganizationSlugTakenError';

  constructor() {
    super({
      status: SSO_PROBLEM_STATUSES.organization_slug_taken,
      detail: SSO_PROBLEM_DETAILS.organization_slug_taken,
      code: 'organization_slug_taken',
    });
  }
}
