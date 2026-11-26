import type { FastifyRequest } from 'fastify';
import type { NfcSettings } from '../../config.js';
import type { TransactionalEventPublisher } from '../../events/index.js';
import type { AuditLogger, Clock, IdGenerator, Mailer, RateLimiter } from '../../ports.js';
import type { OperatorChange } from '../../services/users.js';
import { dashboardContextOf, requireOperator, userActor } from './authenticate.js';
import type { DashboardContext } from './context.js';

/** What every C15 dashboard route plugin receives, with the defaults already applied. */
export interface AdminRouteContext extends DashboardContext {
  audit: AuditLogger;
  mailer: Mailer;
  clock: Clock;
  ids: IdGenerator;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`, the base of invitation links. */
  dashboardPublicUrl: string | undefined;
  /** C55.7: `OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`, the most any environment's budget may be. */
  otpSmsMaxPerHourCeiling: number;
  /** C251.2 (Workflow 11B): `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`, the most any queue cap may be. */
  queueInFlightCapMax: number;
  /** C127.12: where a settings change stages `list.updated`; left out, its rows wait for sweeps. */
  events?: TransactionalEventPublisher | undefined;
  /** C62.7: the trust-store settings the console reports (Workflow 5C review K13). */
  nfc: NfcSettings;
  /**
   * C174.4 (Workflow 9B Stage 1b (U)): the route policies' limiter (`invitations-resend`, 5 an hour
   * per invitation). Left out (Phase 1 tests), a route policy is not counted: C12 fails open.
   */
  rateLimiter?: RateLimiter | undefined;
}

/** The tenant, actor, request metadata and permissions of a signed-in operator's change. */
export function operatorChange(
  request: FastifyRequest,
  context: Pick<AdminRouteContext, 'operatorAuth'>,
): OperatorChange {
  const operator = requireOperator(request);
  return {
    ctx: dashboardContextOf(request, context.operatorAuth, operator),
    actor: userActor(operator.user.id),
    permissions: operator.permissions,
  };
}
