/**
 * C55.11: `POST /api/v1/sandbox/sms-messages/search`, the sandbox SMS sink: the codes the sandbox
 * sender kept for a phone number, newest first, for a key holding `sandbox:read`. The number goes
 * in the body, never in a URL; the answer's member is `code`, which stored API logs redact. The
 * plugin is registered only when this process binds the sandbox SMS sender and is not in
 * production mode (`servesSandboxSmsSink`); a production environment's key gets 404.
 *
 * The schema is frozen (C54.2); the search over the sink is `services/otp/sandbox-sink.ts`.
 */
import { sandboxSmsSearchBodySchema, sandboxSmsSearchResponseSchema } from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../errors.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { AppMode } from '../../config.js';
import type { ProviderBindings } from '../../ports.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { searchSandboxSmsSink } from '../../services/otp/sandbox-sink.js';

/** Whether this process serves the sink: the sandbox sender bound, outside production mode. */
export function servesSandboxSmsSink(mode: AppMode, providers: ProviderBindings): boolean {
  return mode !== 'production' && providers.sandbox.sms?.sandbox === true;
}

export const sandboxSmsRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/sandbox/sms-messages/search',
    {
      config: { scopes: ['sandbox:read'] },
      schema: {
        summary: 'Read the codes the sandbox sent to a number',
        description:
          'C55.11: the codes the sandbox SMS sender kept for `phone-number` (in the body, never ' +
          'in a URL), newest first, at most 100 per environment for 15 minutes. Sandbox ' +
          'environments only: a production environment answers 404. Needs `sandbox:read`.',
        tags: ['sandbox'],
        body: sandboxSmsSearchBodySchema,
        response: {
          200: sandboxSmsSearchResponseSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => {
      const principal = requirePrincipal(request);
      if (principal.environmentKind !== 'sandbox') {
        throw new NotFoundError('The SMS sink exists in sandbox environments only.');
      }
      return searchSandboxSmsSink(deps, principal.environmentId, request.body['phone-number']);
    },
  );
  return Promise.resolve();
};
