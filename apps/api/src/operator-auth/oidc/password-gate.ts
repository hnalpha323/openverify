/**
 * C248.6 and C248.8 (Phase 11, Workflow 11B, `sso-oidc`): what the C4 password sign-in asks of SSO.
 *
 * - **The organisation hint** (C248.8): a sign-in name narrows the accounts the password is checked
 *   against to that organisation's; an unknown name leaves none, so the login answers the generic
 *   401 after the same dummy hash as an unknown email.
 * - **Enforcement** (C248.6): once the password is right, a user of an organisation whose provider
 *   is enforced is refused (403 `sso_password_disabled`) unless the break-glass grant of
 *   `user:allow-password` is live, which this sign-in uses and clears. The refusal comes only after
 *   the password matched, so it tells nothing to someone without it.
 */
import { SSO_PROBLEM_STATUSES } from '@openverify/contracts';
import {
  findOrganizationIdBySlug,
  organizationEnforcesSso,
  takePasswordLoginGrant,
  type Db,
  type User,
} from '@openverify/db';
import { AppError } from '../../errors.js';
import { SSO_PROBLEM_DETAILS } from './failures.js';

/** 403 `sso_password_disabled`: the organisation signs in with single sign-on only. */
export class SsoPasswordDisabledError extends AppError {
  override name = 'SsoPasswordDisabledError';

  constructor() {
    super({
      status: SSO_PROBLEM_STATUSES.sso_password_disabled,
      detail: SSO_PROBLEM_DETAILS.sso_password_disabled,
      code: 'sso_password_disabled',
    });
  }
}

/** C248.8: the candidates of the organisation named by `organizationSlug`, or all without one. */
export async function narrowLoginCandidates<Candidate extends Pick<User, 'organizationId'>>(
  db: Db,
  candidates: readonly Candidate[],
  organizationSlug: string | undefined,
): Promise<Candidate[]> {
  if (organizationSlug === undefined) {
    return [...candidates];
  }
  const organizationId = await findOrganizationIdBySlug(db, organizationSlug);
  return candidates.filter((candidate) => candidate.organizationId === organizationId);
}

/**
 * C248.6: refuses a password sign-in of `user` when its organisation enforces SSO and no live
 * break-glass grant is left; uses (clears) a live grant.
 * @throws {SsoPasswordDisabledError}
 */
export async function assertPasswordSignInAllowed(db: Db, user: User, now: Date): Promise<void> {
  if (!(await organizationEnforcesSso(db, user.organizationId))) {
    return;
  }
  if (!(await takePasswordLoginGrant(db, user.organizationId, user.id, now))) {
    throw new SsoPasswordDisabledError();
  }
}
