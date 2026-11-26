/**
 * C245.3 (Phase 11, Workflow 11B; Stage 1a amendment 40): `POST /api/v1/dashboard/users/:id/end-sessions`,
 * an admin ending every live session of another user (`users:write`, C168.1's superset rule; never
 * on oneself, who uses `POST /sessions/revoke-others`), audited as `user.sessions-ended` in every
 * environment.
 *
 * Frozen by `foundation-11b` (Workflow 11B Stage 1b (A)) with `contracts-11b`'s schemas; built by
 * `auth-sessions` over `endUserSessions` (`operator-auth/session-policy.ts`). Ending a session
 * revokes it as Phase 9 does (amendment 3): the user's next request answers 401 and the row is
 * deleted later by the C16 pass, its audit entries kept.
 */
import {
  ACCESS_11B_AUDIT_ACTIONS,
  endUserSessionsBodySchema,
  endUserSessionsResponseSchema,
  idSchema,
  type EndUserSessionsResponse,
} from '@openverify/contracts';
import { getUser } from '@openverify/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../errors.js';
import { endUserSessions } from '../../operator-auth/session-policy.js';
import { problemResponses } from '../../plugins/openapi.js';
import { assertActorHoldsSupersetOf } from '../../services/access/acting.js';
import { recordInEveryEnvironment } from '../../services/access/audit.js';
import type { OperatorChange } from '../../services/users.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

const userParams = z.strictObject({ id: idSchema('usr') });

/**
 * Revokes every live session of `userId` and audits it in every environment, in one transaction.
 * @throws {ConflictError} on oneself.
 * @throws {NotFoundError} for a user of another organisation, or none.
 * @throws {AccessProblemError} 403 `user_more_privileged` (C168.1's superset rule).
 */
export async function endSessionsOfUser(
  deps: Pick<AdminRouteContext, 'db' | 'audit' | 'clock'>,
  change: OperatorChange,
  userId: string,
): Promise<EndUserSessionsResponse> {
  if (userId === change.actor.id) {
    throw new ConflictError(
      'You cannot end your own sessions here; end your other sessions from your account.',
    );
  }
  const { organizationId } = change.ctx;
  return deps.db.transaction(async (tx) => {
    if ((await getUser(tx, organizationId, userId)) === null) {
      throw new NotFoundError('No user with this id exists.');
    }
    await assertActorHoldsSupersetOf(tx, organizationId, change.actor.id, userId);
    const ended = await endUserSessions(tx, {
      organizationId,
      userId,
      now: deps.clock.now(),
      cause: 'admin',
    });
    await recordInEveryEnvironment(tx, deps.audit, change.ctx, change.actor, {
      action: ACCESS_11B_AUDIT_ACTIONS.sessionsEnded,
      resourceType: 'user',
      resourceId: userId,
      metadata: { 'sessions-ended': ended },
    });
    return { 'sessions-ended': ended };
  });
}

/** C245.3: end one user's sessions. */
export const endSessionsRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.post(
    '/users/:id/end-sessions',
    {
      config: { scopes: ['users:write'] },
      schema: {
        summary: 'End a user’s sessions',
        description:
          'C245.3: revokes every live console session of the user, audited as ' +
          '`user.sessions-ended`; never on oneself (409; use `POST /sessions/revoke-others`).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: userParams,
        body: endUserSessionsBodySchema,
        response: {
          200: endUserSessionsResponseSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) => endSessionsOfUser(context, operatorChange(request, context), request.params.id),
  );
  return Promise.resolve();
};
