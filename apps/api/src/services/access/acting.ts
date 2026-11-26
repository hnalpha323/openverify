/**
 * C168.1 (Phase 9, Workflow 9B; decision 70, reviews P02 and V05): the rules for acting on another
 * user (a reactivation, a deactivation, the console MFA reset, an invitation resent).
 *
 * - {@link assertActorHoldsSupersetOf}: the actor holds, at C167.2's levels, a superset of the
 *   target's effective permissions in every environment the target can enter (403
 *   `user_more_privileged`).
 * - {@link assertSteppedUp}: the actor's session verified a second factor within
 *   `STEP_UP_WINDOW_SECONDS` (403 `step_up_required`); `mfa_verified_at` is set on every factor check
 *   (the MFA sign-in, the step-up, an enrolment). An operator with no factor never has one.
 * - {@link actorHasFactor}: deactivation needs the step-up only from an actor with an enrolled
 *   factor, so it stays the emergency control where no operator has one (`seed:dev`, organisations
 *   without `require-mfa`).
 */
import { STEP_UP_WINDOW_SECONDS } from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import {
  getUserSession,
  listEnvironments,
  listMfaFactors,
  listUserRoleAssignments,
  type Db,
} from '@openverify/db';
import { environmentsEntered, permissionsForEnvironment } from './permissions.js';
import { AccessProblemError } from './problems.js';

/**
 * @throws {AccessProblemError} 403 `user_more_privileged` when the target holds, in an environment
 *   it can enter, a permission the actor does not hold there. The detail names no permission.
 */
export async function assertActorHoldsSupersetOf(
  db: Db,
  organizationId: string,
  actorId: string,
  targetId: string,
): Promise<void> {
  const [environments, actor, target] = await Promise.all([
    listEnvironments(db, organizationId),
    listUserRoleAssignments(db, organizationId, actorId),
    listUserRoleAssignments(db, organizationId, targetId),
  ]);
  for (const environment of environmentsEntered(target, environments)) {
    const held = permissionsForEnvironment(actor, environment.id);
    const theirs = permissionsForEnvironment(target, environment.id);
    if (PERMISSIONS.some((permission) => theirs.has(permission) && !held.has(permission))) {
      throw new AccessProblemError(
        'user_more_privileged',
        'That user holds permissions you do not hold in an environment they can enter.',
      );
    }
  }
}

/**
 * @throws {AccessProblemError} 403 `step_up_required` unless the session `sessionId` verified a
 *   second factor within `STEP_UP_WINDOW_SECONDS` before `now`.
 */
export async function assertSteppedUp(
  db: Db,
  sessionId: string | undefined,
  now: Date,
): Promise<void> {
  const session = sessionId === undefined ? null : await getUserSession(db, sessionId);
  const verifiedAt = session?.mfaVerifiedAt ?? null;
  const age = verifiedAt === null ? Infinity : now.getTime() - verifiedAt.getTime();
  if (!(age >= 0 && age <= STEP_UP_WINDOW_SECONDS * 1000)) {
    throw new AccessProblemError(
      'step_up_required',
      'Verify your second factor again before acting on another user.',
    );
  }
}

/** Whether the actor has an enrolled (confirmed) second factor. */
export async function actorHasFactor(
  db: Db,
  organizationId: string,
  actorId: string,
): Promise<boolean> {
  return (await listMfaFactors(db, organizationId, actorId, { confirmedOnly: true })).length > 0;
}
