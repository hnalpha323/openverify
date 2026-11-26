/**
 * C96.3 (Workflow 7A): the flow handoff routes, which move a desktop flow to a phone. The schemas
 * are frozen by `foundation-7a` (Stage 1b (H)); `flow-handoff` owns this file and builds the
 * services (`services/handoff/flow-handoffs.ts`), which answer 501 until then.
 *
 * - The issuing (desktop) session's routes take its session token: `POST /flow/handoffs` (the C12
 *   policies `flow-handoffs` per session and `flow-handoffs-ip` per address,
 *   `plugins/rate-limit.ts`), `POST /flow/handoffs/continue-here`, `GET /flow/handoffs/current` and
 *   `POST /flow/handoffs/current/reject`. They stay open while the session is handed off (F13).
 * - The phone's routes take no session (`config.public`): the `ovh_` token in the body is the
 *   credential, every failure answers the one uniform 410 `handoff_token_invalid`, and each is
 *   limited per address under `one-time-link-redeem`. `preview` consumes nothing (P15), `decline`
 *   revokes the token (V04), and `redeem` answers a new session token, which the phone keeps in
 *   memory only.
 *
 * The destination of an email or SMS handoff is PII: it is masked in the stored API logs
 * (`PII_HANDOFF_ATTRIBUTES`), and nothing here logs it.
 */
import {
  continueHandoffHereBodySchema,
  createHandoffBodySchema,
  createHandoffResponseSchema,
  currentHandoffResponseSchema,
  declineHandoffBodySchema,
  previewHandoffBodySchema,
  previewHandoffResponseSchema,
  redeemHandoffBodySchema,
  redeemHandoffResponseSchema,
  rejectHandoffBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import {
  continueHandoffHere,
  declineHandoff,
  getCurrentHandoff,
  issueHandoff,
  previewHandoff,
  redeemHandoff,
  rejectCurrentHandoff,
} from '../../services/handoff/flow-handoffs.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

export const handoffRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);

  app.post(
    '/handoffs',
    {
      schema: {
        summary: 'Issue a device handoff',
        description:
          'C96.3: a single-use `ovh_` token for the waiting `device_handoff` step, bound to this ' +
          'session; a new one revokes the previous. `qr` answers the fragment the flow draws the ' +
          'QR from; `email` and `sms` send a link to the inquiry’s confirmed destination of that ' +
          'channel (422 `destination_not_confirmed`, unless the step asks for a confirmation ' +
          'code) and answer no token. With `confirmationCode`, the answer carries the six ' +
          'digits the phone types. 5 an hour per session (`flow-handoffs`), 10 an hour per ' +
          'address (`flow-handoffs-ip`); the per-environment send budget fails closed (429 or ' +
          '503 `handoff_send_limited`).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: createHandoffBodySchema,
        response: {
          201: createHandoffResponseSchema,
          ...problemResponses(400, 401, 409, 422, 429, 501, 503),
        },
      },
    },
    async (request, reply) => {
      const answer = await issueHandoff(deps, requireFlowSession(request), request.body, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.code(201).send(answer);
    },
  );

  app.post(
    '/handoffs/continue-here',
    {
      schema: {
        summary: 'Continue on this device',
        description:
          'C96.3 (F01): records `continued_here` for the waiting handoff step where the step ' +
          'allows it (409 `continue_here_not_allowed` otherwise).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: continueHandoffHereBodySchema,
        response: {
          200: currentHandoffResponseSchema.describe('The handoff, now `continued_here`.'),
          ...problemResponses(400, 401, 409, 501),
        },
      },
    },
    (request) => continueHandoffHere(deps, requireFlowSession(request)),
  );

  app.get(
    '/handoffs/current',
    {
      schema: {
        summary: 'Read the current handoff',
        description:
          'C96.3: the state of this session’s handoff and, after redemption, when and the ' +
          'phone’s OS and browser names only.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        response: { 200: currentHandoffResponseSchema, ...problemResponses(401, 409, 501) },
      },
    },
    (request) => getCurrentHandoff(deps, requireFlowSession(request)),
  );

  app.post(
    '/handoffs/current/reject',
    {
      schema: {
        summary: 'Reject the redeemed handoff',
        description:
          'C96.3 (P15, V02): "this was not me". Ends the phone session, cancels the ' +
          'verifications it created that are not submitted and redacts their files, marks the ' +
          'rest `from-rejected-handoff` and routes the inquiry to review, and shows the step ' +
          'again (409 `handoff_not_redeemed` when nothing was redeemed).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: rejectHandoffBodySchema,
        response: {
          200: currentHandoffResponseSchema.describe('The handoff, now `rejected`.'),
          ...problemResponses(400, 401, 409, 501),
        },
      },
    },
    (request) => rejectCurrentHandoff(deps, requireFlowSession(request)),
  );

  app.post(
    '/handoffs/preview',
    {
      config: { public: true },
      schema: {
        summary: 'Preview a handoff on the phone',
        description:
          'C96.3 (P15, V16): no credentials; the `ovh_` token is the credential, and nothing is ' +
          'consumed. Answers the organisation’s display name, the method and whether a code is ' +
          'asked; the context (steps, start, issuing country) follows a confirmed destination or ' +
          'a correct code. Any failure answers 410 `handoff_token_invalid`. Rate-limited per ' +
          'client address (`one-time-link-redeem`).',
        tags: FLOW_TAGS,
        security: [],
        body: previewHandoffBodySchema,
        response: {
          200: previewHandoffResponseSchema,
          ...problemResponses(400, 410, 429, 501),
        },
      },
    },
    (request) => previewHandoff(deps, request.body),
  );

  app.post(
    '/handoffs/decline',
    {
      config: { public: true },
      schema: {
        summary: 'Decline a handoff on the phone',
        description:
          'C96.3 (V04): no credentials. Revokes the token before redemption and shows the step ' +
          'again on the desktop (`declined`). Any failure answers 410 `handoff_token_invalid`. ' +
          'Rate-limited per client address (`one-time-link-redeem`).',
        tags: FLOW_TAGS,
        security: [],
        body: declineHandoffBodySchema,
        response: {
          200: z.null().describe('The handoff is declined.'),
          ...problemResponses(400, 410, 429, 501),
        },
      },
    },
    async (request) => {
      await declineHandoff(deps, request.body);
      return null;
    },
  );

  app.post(
    '/handoffs/redeem',
    {
      config: { public: true },
      schema: {
        summary: 'Redeem a handoff on the phone',
        description:
          'C96.3 (P28): no credentials; sent on Continue, never at boot. The token is checked ' +
          'first, in constant time, and every failure answers 410 `handoff_token_invalid` ' +
          '(after 5 wrong codes the token is revoked); only then does the session cap apply ' +
          '(409 `session_limit_reached`). Answers a new session token, which the phone keeps in ' +
          'memory only; the new session starts at the step after the handoff, once it consents. ' +
          'Rate-limited per client address (`one-time-link-redeem`).',
        tags: FLOW_TAGS,
        security: [],
        body: redeemHandoffBodySchema,
        response: {
          200: redeemHandoffResponseSchema,
          ...problemResponses(400, 409, 410, 429, 501),
        },
      },
    },
    (request) =>
      redeemHandoff(deps, request.body, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }),
  );

  return Promise.resolve();
};
