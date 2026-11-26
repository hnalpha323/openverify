/**
 * C55: `POST /api/v1/flow/verifications/:id/otp` (send a code) and `.../otp/confirm` (enter it),
 * for phone-number and email-address verifications. The schemas are frozen (C54.2). Each handler
 * runs the C52.1 preconditions first, then `services/otp/`. The code is never returned, logged or
 * put in a problem; a problem carries `attempts-remaining` or `resend-available-at` where C52.7
 * says.
 */
import {
  flowOtpConfirmBodySchema,
  flowOtpSendBodySchema,
  flowVerificationDocumentSchema,
  idSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { requireFlowVerification } from '../../services/flow-preconditions.js';
import { confirmOtp } from '../../services/otp/confirm.js';
import { sendOtp } from '../../services/otp/send.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

/** The types that confirm a destination with a code (C55). */
export const OTP_VERIFICATION_TYPES = ['phone_number', 'email_address'] as const;
/** A send or confirm after `confirmed` answers `otp_already_confirmed`, so both are taken here. */
const OTP_STATUSES = ['initiated', 'confirmed'] as const;

const params = z.object({ id: idSchema('ver') });

export const otpRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/verifications/:id/otp',
    {
      schema: {
        summary: 'Send a one-time code',
        description:
          'C55: sends a code to the `phone-number` (a phone verification) or `email-address` (an ' +
          'email verification), validated first (422 `otp_destination_invalid`, ' +
          '`otp_destination_not_allowed`). A send to another destination supersedes the open ' +
          'code. Cooldowns answer 429 `otp_resend_too_soon` with `resend-available-at`; a limit ' +
          'answers 429 `otp_rate_limited` with `Retry-After`, or 503 while the limit store is ' +
          'down; a failed delivery 502 `otp_delivery_failed`; a send after confirmation 409 ' +
          '`otp_already_confirmed`. Requires consent. The answer is the verification with its ' +
          '`guidance.otp` state, never the code.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params,
        body: flowOtpSendBodySchema,
        response: {
          200: flowVerificationDocumentSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422, 429, 502, 503),
        },
      },
    },
    async (request) => {
      const session = requireFlowSession(request);
      const target = await requireFlowVerification(deps, session, request.params.id, {
        types: OTP_VERIFICATION_TYPES,
        statuses: OTP_STATUSES,
      });
      return {
        data: await sendOtp(deps, session, target, request.body, {
          ip: request.ip,
          log: request.log,
        }),
      };
    },
  );

  app.post(
    '/verifications/:id/otp/confirm',
    {
      schema: {
        summary: 'Confirm a one-time code',
        description:
          'C55: a correct code moves the verification to `confirmed`. A wrong one answers 422 ' +
          '`otp_incorrect` with `attempts-remaining`; 409 `otp_not_sent`, `otp_expired`, ' +
          '`otp_code_exhausted`, `otp_attempts_exhausted` (the verification was submitted) or ' +
          '`otp_already_confirmed`; 429 `otp_rate_limited` once the destination guess budget ' +
          'tripped, 503 while the limit store is down. Requires consent.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params,
        body: flowOtpConfirmBodySchema,
        response: {
          200: flowVerificationDocumentSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422, 429, 503),
        },
      },
    },
    async (request) => {
      const session = requireFlowSession(request);
      const target = await requireFlowVerification(deps, session, request.params.id, {
        types: OTP_VERIFICATION_TYPES,
        statuses: OTP_STATUSES,
      });
      return {
        data: await confirmOtp(deps, session, target, request.body, {
          ip: request.ip,
          log: request.log,
        }),
      };
    },
  );
  return Promise.resolve();
};
