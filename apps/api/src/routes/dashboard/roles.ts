import {
  createRoleBodySchema,
  grantableDocumentSchema,
  idSchema,
  listRolesQuerySchema,
  roleDocumentSchema,
  roleListDocumentSchema,
  updateRoleBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import {
  createCustomRole,
  deleteCustomRole,
  getRoleResource,
  grantableDocument,
  listRolesDocument,
  updateCustomRole,
} from '../../services/roles.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

const roleParams = z.strictObject({ id: idSchema('role') });

/**
 * C15 roles: list and read (`roles:read`; one role since C25.2) and manage custom roles
 * (`roles:write`). Built-in roles cannot
 * be changed or deleted, nor can a role users still hold (409). A role can grant only
 * permissions its author holds, and only an operator holding them can remove a role's
 * permissions or delete it (Workflow 2D K002).
 */
export const roleRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  const { db, audit, ids } = context;

  app.get(
    '/roles',
    {
      config: { scopes: ['roles:read'] },
      schema: {
        summary: 'List roles',
        description: "The organization's built-in and custom roles, newest first.",
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        querystring: listRolesQuerySchema,
        response: { 200: roleListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) =>
      listRolesDocument(
        db,
        requireOperator(request).organizationId,
        request.query,
        request.routeOptions.url ?? '',
      ),
  );

  // C167.3 (Workflow 9B): frozen at 501 by `foundation-9b` (Stage 1b (U)), built by `api-access`.
  // Registered before `/roles/:id`, which a static segment wins over anyway.
  app.get(
    '/roles/grantable',
    {
      config: { scopes: ['roles:read'] },
      schema: {
        summary: 'List what I may grant',
        description:
          'C167.3, C167.4: per environment of the organisation, then organisation-wide, each ' +
          'permission and role with whether the operator may grant it and, when not, why ' +
          '(`not-held`, `organization-level`, `admin-organization-wide`).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: grantableDocumentSchema, ...problemResponses(401, 403) },
      },
    },
    async (request) => {
      const operator = requireOperator(request);
      return grantableDocument(db, operator.organizationId, operator.user.id);
    },
  );

  app.get(
    '/roles/:id',
    {
      config: { scopes: ['roles:read'] },
      schema: {
        summary: 'Get a role',
        description:
          'One built-in or custom role of the organization (C25.2). An unknown role, or a role ' +
          'of another organization, answers 404.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: roleParams,
        response: { 200: roleDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getRoleResource(db, requireOperator(request).organizationId, request.params.id),
    }),
  );

  app.post(
    '/roles',
    {
      config: { scopes: ['roles:write'] },
      schema: {
        summary: 'Create a custom role',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: createRoleBodySchema,
        response: { 201: roleDocumentSchema, ...problemResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const role = await createCustomRole(
        db,
        audit,
        ids,
        operatorChange(request, context),
        request.body.data.attributes,
      );
      return reply.code(201).send({ data: role });
    },
  );

  app.patch(
    '/roles/:id',
    {
      config: { scopes: ['roles:write'] },
      schema: {
        summary: 'Change a custom role',
        description:
          'Changing the permissions needs every new and every removed permission (403, ' +
          'Workflow 2D K002).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: roleParams,
        body: updateRoleBodySchema,
        response: { 200: roleDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      data: await updateCustomRole(
        db,
        audit,
        operatorChange(request, context),
        request.params.id,
        request.body.data.attributes,
      ),
    }),
  );

  app.delete(
    '/roles/:id',
    {
      config: { scopes: ['roles:write'] },
      schema: {
        summary: 'Delete a custom role',
        description: 'Needs every permission the role grants (403, Workflow 2D K002).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: roleParams,
        response: {
          204: z.null().describe('The role is deleted.'),
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      await deleteCustomRole(db, audit, operatorChange(request, context), request.params.id);
      return reply.code(204).send(null);
    },
  );
  return Promise.resolve();
};
