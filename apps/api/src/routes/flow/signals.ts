/**
 * C94.2 (Workflow 7A): `POST /api/v1/flow/signals`, a signal body of the collector or the Android
 * SDK, under session authentication, with a body cap of 8 KiB and the C12 policy `flow-signals`
 * per session (`plugins/rate-limit.ts`). It answers 202 with no body. The schema is frozen
 * (Workflow 7A Stage 1b (S), `foundation-7a`); `api-signals` owns this file and builds the service
 * (`services/signals/flow-signals.ts`), which answers 501 until then.
 *
 * The route hands the service the request's own bounded header facts (V13): the primary
 * `Accept-Language` tags (at most 5) and the low-entropy client hints, each at most 128
 * characters. Nothing here logs.
 */
import { FLOW_SIGNALS_MAX_BODY_BYTES, flowSignalsSchema } from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { recordFlowSignals, type FlowSignalsRequest } from '../../services/signals/flow-signals.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

/** The low-entropy client hints the route records (C94.8, V13). */
const CLIENT_HINTS = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'] as const;
const MAX_HINT_LENGTH = 128;
const MAX_LANGUAGES = 5;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** The request's bounded header facts. */
export function signalsRequestOf(request: Pick<FastifyRequest, 'headers'>): FlowSignalsRequest {
  const header = (name: string): string | undefined => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const acceptLanguages = (header('accept-language') ?? '')
    .split(',')
    .map((part) => part.split(';')[0]?.trim() ?? '')
    .filter((tag) => LANGUAGE_TAG.test(tag))
    .slice(0, MAX_LANGUAGES);
  const clientHints: Record<string, string> = {};
  for (const name of CLIENT_HINTS) {
    const value = header(name);
    if (value !== undefined) {
      clientHints[name] = value.slice(0, MAX_HINT_LENGTH);
    }
  }
  return { acceptLanguages, clientHints };
}

export const signalRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/signals',
    {
      bodyLimit: FLOW_SIGNALS_MAX_BODY_BYTES,
      schema: {
        summary: 'Send a signal body',
        description:
          'C94.2: one screen of the collector (or the Android SDK), aggregates and closed ' +
          'vocabularies only. 409 `consent_required` until the session may collect; ' +
          '`recognition` is dropped without its tier; a repeated `sequence` and bodies beyond ' +
          'the 200th answer 202 and are not stored. 60 a minute per session (`flow-signals`).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: flowSignalsSchema,
        response: {
          202: z.null().describe('The body is recorded, ignored as a repeat, or counted.'),
          ...problemResponses(400, 401, 409, 413, 422, 429),
        },
      },
    },
    async (request, reply) => {
      await recordFlowSignals(
        deps,
        requireFlowSession(request),
        request.body,
        signalsRequestOf(request),
      );
      return reply.code(202).send(null);
    },
  );
  return Promise.resolve();
};
