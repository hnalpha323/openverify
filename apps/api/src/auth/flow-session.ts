/**
 * Session-token authentication for the flow API (contracts C3 and C10). The hosted flow and
 * Android send the `ovs_` token from `POST /inquiries/:id/resume` or a redeemed one-time link
 * as `Authorization: Bearer`. Only its SHA-256 is stored, and it binds every request to one
 * inquiry in one environment.
 *
 * - An unknown or malformed token answers a generic 401 (`invalid_token`).
 * - An inactive session answers 401 with `code: session_expired` (its TTL passed, or it was
 *   expired) or `session_canceled` (its inquiry left `created`/`pending`, or was redacted), so the
 *   flow can show the right screen without a retry. `session_canceled` carries `reason` (C25.8),
 *   derived from the inquiry when the call is made: `inquiry_redacted`, `inquiry_expired` or
 *   `inquiry_finished`.
 * - One exception keeps the end user's last screen working: a session canceled because its
 *   inquiry finished (completed, failed, or decided after that) still answers the read-only
 *   calls (`GET`) for {@link FINISHED_INQUIRY_READ_GRACE_SECONDS} after the cancellation, so the
 *   flow that is polling for the outcome sees it. Writes are refused at once.
 * - The first call of an active session records its time, client address and user agent and
 *   emits `inquiry-session.started`.
 */
import { sessionTokenSchema, type SessionCanceledReason } from '@openverify/contracts';
import {
  findInquirySessionByTokenHash,
  getInquiry,
  hashSessionToken,
  type Db,
  type Inquiry,
  type InquirySession,
} from '@openverify/db';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { TransactionalEventPublisher } from '../events/index.js';
import { SessionInactiveError, SignalProblemError, UnauthorizedError } from '../errors.js';
import { inquirySessionStatusAt } from '../jobs/records.js';
import { parseBearerToken } from '../plugins/principal-auth.js';
import { FLOW_HANDOFFS_ROUTE } from '../plugins/rate-limit.js';
import type { Clock } from '../ports.js';
import type { SessionNetworkDeps } from '../network/evaluate.js';
import { isSessionHandedOff } from '../services/handoff/guard.js';
import { recordSessionStart } from '../services/inquiry-sessions.js';

/**
 * How long a session canceled because its inquiry finished keeps answering read-only flow
 * calls: long enough for a flow that is polling to learn the outcome and show its last screen.
 */
export const FINISHED_INQUIRY_READ_GRACE_SECONDS = 15 * 60;

/** Inquiry statuses the end user's own part ended in, before or after a review. */
const FINISHED_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'approved',
  'declined',
  'needs_review',
]);

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** The authenticated flow session, exposed to handlers as `request.flowSession`. */
export interface FlowSession {
  id: string;
  environmentId: string;
  inquiryId: string;
}

export interface FlowSessionAuthOptions {
  db: Db;
  clock: Clock;
  events: TransactionalEventPublisher;
  /** C93.2 (Workflow 7A): the session start's network evaluation; none without it. */
  network?: SessionNetworkDeps | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The flow session; `null` outside the flow API and on public routes. */
    flowSession: FlowSession | null;
  }
}

const invalidToken = () =>
  new UnauthorizedError('The session token is not valid or has expired.', {
    error: 'invalid_token',
  });

/**
 * The session that authenticated the request. Only call it from flow routes: the hook has then
 * either set it or refused the request.
 * @throws {UnauthorizedError} when the request carries no flow session.
 */
export function requireFlowSession(request: FastifyRequest): FlowSession {
  if (request.flowSession === null) {
    throw new UnauthorizedError('A session token is required.');
  }
  return request.flowSession;
}

/**
 * Whether a canceled session may still read: its inquiry (`null` when missing) finished within
 * the grace period.
 */
function inReadGrace(session: InquirySession, inquiry: Inquiry | null, now: Date): boolean {
  if (session.canceledAt === null || inquiry === null) {
    return false;
  }
  const graceEnds = session.canceledAt.getTime() + FINISHED_INQUIRY_READ_GRACE_SECONDS * 1000;
  return now.getTime() < graceEnds && FINISHED_STATUSES.has(inquiry.status);
}

/** Why a session was canceled (C25.8), from its inquiry as it is now. */
function canceledReason(inquiry: Inquiry | null): SessionCanceledReason {
  if (inquiry?.redactedAt != null) {
    return 'inquiry_redacted';
  }
  return inquiry?.status === 'expired' ? 'inquiry_expired' : 'inquiry_finished';
}

/**
 * C96.3 (Workflow 7A; F13): one capturing device at a time. A non-GET flow call of a session that
 * handed off to a redeemed session still active is refused with 409 `session_handed_off`, except
 * the handoff routes (the desktop's state, continue-here and "this was not me"). Whether the
 * session is handed off is `flow-handoff`'s (`isSessionHandedOff`, `services/handoff/guard.ts`).
 * @throws {SignalProblemError} `session_handed_off`.
 */
export async function assertSessionNotHandedOff(
  db: Db,
  request: Pick<FastifyRequest, 'method' | 'routeOptions'>,
  session: FlowSession,
  now: Date,
): Promise<void> {
  const url = request.routeOptions.url ?? '';
  if (
    READ_METHODS.has(request.method) ||
    url === FLOW_HANDOFFS_ROUTE ||
    url.startsWith(`${FLOW_HANDOFFS_ROUTE}/`)
  ) {
    return;
  }
  if (await isSessionHandedOff(db, session, now)) {
    throw new SignalProblemError(
      'session_handed_off',
      'This verification continues on the other device. Finish it there, or say it was not you.',
    );
  }
}

const flowSessionAuth: FastifyPluginCallback<FlowSessionAuthOptions> = (app, options, done) => {
  const { db, clock } = options;

  app.decorateRequest('flowSession', null);

  app.addHook('onRequest', async (request) => {
    if (request.routeOptions.config.public === true) {
      return;
    }
    const token = parseBearerToken(request.headers.authorization);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token === undefined) {
      throw new UnauthorizedError(
        'A session token is required. Send it as "Authorization: Bearer <token>".',
      );
    }
    if (!sessionTokenSchema.safeParse(token).success) {
      throw invalidToken();
    }
    const session = await findInquirySessionByTokenHash(db, hashSessionToken(token));
    if (session === null) {
      throw invalidToken();
    }
    const now = clock.now();
    const status = inquirySessionStatusAt(session, now);
    if (status === 'expired') {
      throw new SessionInactiveError('session_expired');
    }
    if (status === 'canceled') {
      const inquiry = await getInquiry(db, session.environmentId, session.inquiryId);
      if (!READ_METHODS.has(request.method) || !inReadGrace(session, inquiry, now)) {
        throw new SessionInactiveError('session_canceled', canceledReason(inquiry));
      }
    }
    request.flowSession = {
      id: session.id,
      environmentId: session.environmentId,
      inquiryId: session.inquiryId,
    };
    // C96.3 (Workflow 7A; F13): the desktop is locked while the phone captures.
    await assertSessionNotHandedOff(db, request, request.flowSession, now);
    if (status === 'active' && session.startedAt === null) {
      await recordSessionStart(options, session, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
    }
  });

  done();
};

/**
 * Authenticates every route of the scope it is registered in with a flow session token,
 * except routes marked `config: { public: true }` (the CORS preflight and the one-time link
 * redeem).
 */
export default fp(flowSessionAuth, { name: 'openverify-flow-session-auth', fastify: '5.x' });
