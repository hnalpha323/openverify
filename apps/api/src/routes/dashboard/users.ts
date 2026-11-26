import {
  dashboardInvitationResponseSchema,
  dashboardInviteUserBodySchema,
  idSchema,
  listUsersQuerySchema,
  reactivateUserBodySchema,
  resetUserMfaBodySchema,
  setUserRolesBodySchema,
  toTimestamp,
  updateUserBodySchema,
  userDocumentSchema,
  userEffectivePermissionsDocumentSchema,
  userListDocumentSchema,
  userRoleAssignmentsDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import {
  inviteUser,
  listUsersDocument,
  reactivateUser,
  resetUserMfaByOperator,
  setUserRoleAssignmentsOf,
  updateOperator,
  userEffectivePermissionsOf,
  userRoleAssignmentsOf,
} from '../../services/users.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

const userParams = z.strictObject({ id: idSchema('usr') });

/**
 * C15 users: list (`users:read`), invite and change roles or status (`users:write`). C167.3, C168.1
 * and C168.3 (Workflow 9B): the roles per environment, reactivation and the console MFA reset,
 * frozen at 501 by `foundation-9b` (Stage 1b (U)) and built by `api-access`.
 */
export const userRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.get(
    '/users',
    {
      config: { scopes: ['users:read'] },
      schema: {
        summary: 'List users',
        description: "The organization's users, newest first, with their roles.",
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        querystring: listUsersQuerySchema,
        response: { 200: userListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => {
      const operator = requireOperator(request);
      return listUsersDocument(
        context.db,
        operator.organizationId,
        request.query,
        request.routeOptions.url ?? '',
        // C168.5 (review P20): MFA status and last sign-in only for users:write.
        { mfaStatus: operator.permissions.has('users:write') },
      );
    },
  );

  app.post(
    '/users/invitations',
    {
      config: { scopes: ['users:write'] },
      schema: {
        summary: 'Invite a user',
        description:
          'Emails a link to `/accept-invitation#token=ovi_...` on the dashboard, valid 7 days. ' +
          'The token is never returned. Inviting someone still invited sends a fresh link and ' +
          'replaces their roles. A user can grant, or replace, only roles whose permissions it ' +
          'holds (Workflow 2D K002).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: dashboardInviteUserBodySchema,
        response: {
          201: dashboardInvitationResponseSchema,
          ...problemResponses(400, 401, 403, 409, 422, 502, 503),
        },
      },
    },
    async (request, reply) => {
      const invitation = await inviteUser(context, operatorChange(request, context), {
        email: request.body.email,
        roleIds: request.body['role-ids'],
      });
      return reply
        .code(201)
        .header('cache-control', NO_STORE)
        .send({
          email: invitation.email,
          'role-ids': invitation.roleIds,
          'expires-at': toTimestamp(invitation.expiresAt),
        });
    },
  );

  app.patch(
    '/users/:id',
    {
      config: { scopes: ['users:write'] },
      schema: {
        summary: 'Change a user’s roles or status',
        description:
          'Replaces the roles and/or deactivates (`status: deactivated` revokes the user’s ' +
          'sessions). `status: active` on a deactivated user is refused with 422 ' +
          '`user_reactivation_required` at `/data/attributes/status`: reactivation goes through ' +
          "`POST /dashboard/users/:id/reactivate`. The organization's last active admin can be neither " +
          'demoted nor deactivated (409). The operator must hold every permission of the roles ' +
          'it grants or removes and, to change the status, every permission of the user (403, ' +
          'Workflow 2D K002).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.strictObject({ id: idSchema('usr') }),
        body: updateUserBodySchema,
        response: { 200: userDocumentSchema, ...problemResponses(400, 401, 403, 404, 409, 422) },
      },
    },
    async (request) => ({
      data: await updateOperator(
        context,
        operatorChange(request, context),
        request.params.id,
        request.body.data.attributes,
        { sessionId: requireOperator(request).sessionId },
      ),
    }),
  );

  app.get(
    '/users/:id/roles',
    {
      config: { scopes: ['users:read'] },
      schema: {
        summary: 'Read a user’s role assignments',
        description:
          'K9-22 (DS8; C167.2): the user’s assignments as `PUT /dashboard/users/:id/roles` stored ' +
          'them, each a role and the environments it is granted in, or `null` for every current ' +
          'and future environment.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: userParams,
        response: {
          200: userRoleAssignmentsDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const result = await userRoleAssignmentsOf(
        context.db,
        requireOperator(request).organizationId,
        request.params.id,
      );
      return {
        data: {
          type: 'user-role-assignments' as const,
          id: result.userId,
          attributes: { assignments: result.assignments },
        },
      };
    },
  );

  app.get(
    '/users/:id/permissions',
    {
      config: { scopes: ['users:read'] },
      schema: {
        summary: 'Read a user’s effective permissions',
        description:
          'K9-22 (DS8; C167.2): what the user’s assignments give. The organisation-level ' +
          'permissions (`users:*`, `roles:*`) count only through an organisation-wide assignment ' +
          'and are named once; per environment, the environment-level permissions held there and ' +
          'whether the user may enter it (a role there and, in production, ' +
          '`environments:production` held there).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: userParams,
        response: {
          200: userEffectivePermissionsDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const result = await userEffectivePermissionsOf(
        context.db,
        requireOperator(request).organizationId,
        request.params.id,
      );
      return {
        data: {
          type: 'user-effective-permissions' as const,
          id: result.userId,
          attributes: {
            organization: result.organization,
            environments: result.environments.map((environment) => ({
              'environment-id': environment.environmentId,
              'may-enter': environment.mayEnter,
              permissions: environment.permissions,
            })),
          },
        },
      };
    },
  );

  app.put(
    '/users/:id/roles',
    {
      config: { scopes: ['users:write'] },
      schema: {
        summary: 'Set a user’s role assignments',
        description:
          'C167.2, C167.3: replaces the user’s assignments, each a role and the environments it is ' +
          'granted in, or `null` for every current and future environment. An organisation-level ' +
          'permission or the built-in admin role in a narrower assignment is 422 ' +
          '`role_scope_invalid`; the operator must hold every permission it grants in each ' +
          'environment named (403).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: userParams,
        body: setUserRolesBodySchema,
        response: {
          200: userRoleAssignmentsDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) => {
      const result = await setUserRoleAssignmentsOf(
        context,
        operatorChange(request, context),
        request.params.id,
        request.body,
      );
      return {
        data: {
          type: 'user-role-assignments' as const,
          id: result.userId,
          attributes: { assignments: result.assignments },
        },
      };
    },
  );

  app.post(
    '/users/:id/reactivate',
    {
      config: { scopes: ['users:write'] },
      schema: {
        summary: 'Reactivate a user',
        description:
          'C168.1: a deactivated user gets a new invitation and keeps their history, with no role ' +
          'back. The operator holds a superset of the user’s permissions in every environment the ' +
          'user can enter (403 `user_more_privileged`) and verified a second factor within ten ' +
          'minutes (403 `step_up_required`).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: userParams,
        body: reactivateUserBodySchema,
        response: {
          200: userDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 502, 503),
        },
      },
    },
    async (request) => ({
      data: await reactivateUser(context, operatorChange(request, context), request.params.id, {
        sessionId: requireOperator(request).sessionId,
      }),
    }),
  );

  app.post(
    '/users/:id/reset-mfa',
    {
      config: { scopes: ['users:write'] },
      schema: {
        summary: 'Reset a user’s MFA',
        description:
          'C168.3: removes the user’s factors and recovery codes and revokes every session of the ' +
          'user; never on oneself. The superset and step-up rules of the reactivation apply.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: userParams,
        body: resetUserMfaBodySchema,
        response: {
          200: userDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request) => ({
      data: await resetUserMfaByOperator(
        context,
        operatorChange(request, context),
        request.params.id,
        { sessionId: requireOperator(request).sessionId },
      ),
    }),
  );
  return Promise.resolve();
};
