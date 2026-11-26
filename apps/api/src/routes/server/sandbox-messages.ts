/**
 * C126.4 (Workflow 8A): what a sandbox provider recorded of a workflow's messages, searched with
 * `sandbox:read` beside the SMS search. The schemas and scopes are frozen (Stage 1b (X),
 * `foundation-8a`); `api-egress` owns this file and builds the searches (`workflows/actions/messaging/
 * sandbox-messages.ts`), which answer 501 until then. An address goes in the body, never in a URL.
 *
 * Unlike the OTP sink, these are served in a production-mode install: a sandbox environment there has
 * test runs too, whose panel shows what they recorded, and a record holds no code. A production
 * environment's key answers 404 here, before anything is read.
 */
import {
  sandboxEmailSearchBodySchema,
  sandboxEmailSearchResponseSchema,
  sandboxSlackSearchBodySchema,
  sandboxSlackSearchResponseSchema,
  sandboxWorkflowSmsSearchBodySchema,
  sandboxWorkflowSmsSearchResponseSchema,
} from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  searchSandboxEmailMessages,
  searchSandboxSlackMessages,
  searchSandboxWorkflowSmsMessages,
} from '../../workflows/actions/messaging/sandbox-messages.js';

const TAGS = ['sandbox'];

/** The caller's environment, which must be a sandbox. */
function sandboxEnvironmentOf(request: FastifyRequest): string {
  const principal = requirePrincipal(request);
  if (principal.environmentKind !== 'sandbox') {
    throw new NotFoundError('The message lists exist in sandbox environments only.');
  }
  return principal.environmentId;
}

/** C126.4 routes, under `/api/v1`. */
export const sandboxMessageRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/sandbox/email-messages/search',
    {
      config: { scopes: ['sandbox:read'] },
      schema: {
        summary: 'Read the email a sandbox workflow recorded',
        description:
          'C126.4: what the sandbox mailer recorded for `email-address` (in the body, never in a ' +
          'URL), newest first, at most 500 per environment for 24 hours. Sandbox environments only.',
        tags: TAGS,
        body: sandboxEmailSearchBodySchema,
        response: {
          200: sandboxEmailSearchResponseSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => searchSandboxEmailMessages(deps, sandboxEnvironmentOf(request), request.body),
  );

  app.post(
    '/sandbox/slack-messages/search',
    {
      config: { scopes: ['sandbox:read'] },
      schema: {
        summary: 'Read the Slack messages a sandbox workflow recorded',
        description:
          'C126.4: by secret id. A record names its secret, never the URL. Sandbox environments only.',
        tags: TAGS,
        body: sandboxSlackSearchBodySchema,
        response: {
          200: sandboxSlackSearchResponseSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => searchSandboxSlackMessages(deps, sandboxEnvironmentOf(request), request.body),
  );

  app.post(
    '/sandbox/workflow-sms-messages/search',
    {
      config: { scopes: ['sandbox:read'] },
      schema: {
        summary: 'Read the SMS a sandbox workflow recorded',
        description:
          'C126.4: for `phone-number`, in the body, never in a URL. The OTP list has its own route. ' +
          'Sandbox environments only.',
        tags: TAGS,
        body: sandboxWorkflowSmsSearchBodySchema,
        response: {
          200: sandboxWorkflowSmsSearchResponseSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      searchSandboxWorkflowSmsMessages(deps, sandboxEnvironmentOf(request), request.body),
  );

  done();
};
