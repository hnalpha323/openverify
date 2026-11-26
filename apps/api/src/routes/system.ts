import { notReadyResponseSchema, readyResponseSchema } from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkReadiness, NO_STORES, type ReadinessProbes } from '../http/readiness.js';

export const healthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

export interface SystemRoutesOptions {
  version: string;
  /** C250.1: the stores `/ready` asks; without them (an app with no `api`) it is never ready. */
  readiness?: ReadinessProbes | undefined;
}

/** Public operational routes: liveness and the OpenAPI document. */
export const systemRoutes: FastifyPluginCallbackZod<SystemRoutesOptions> = (app, options, done) => {
  app.get(
    '/health',
    {
      config: { public: true },
      schema: {
        summary: 'Liveness probe',
        tags: ['system'],
        security: [],
        response: { 200: healthResponse },
      },
    },
    () => ({ status: 'ok' as const, version: options.version }),
  );

  // C250.1 (Workflow 11B, platform-ops): readiness, never liveness. Public and outside every rate
  // limit (the limiter's hook counts only principals and flow routes); each store within
  // `READINESS_CHECK_TIMEOUT_MS`, and a 503 names the store, never an error's text.
  app.get(
    '/ready',
    {
      config: { public: true },
      schema: {
        summary: 'Readiness probe',
        description:
          'C250.1: 200 while this process reaches Postgres and Valkey now, else 503 with which ' +
          'check failed and no error text. It says nothing about the worker or the vision service.',
        tags: ['system'],
        security: [],
        response: { 200: readyResponseSchema, 503: notReadyResponseSchema },
      },
    },
    async (_request, reply) => {
      const answer = await checkReadiness(options.readiness ?? NO_STORES);
      return reply.code(answer.statusCode).send(answer.body);
    },
  );

  app.get('/openapi.json', { config: { public: true }, schema: { hide: true } }, () =>
    app.swagger(),
  );

  done();
};
