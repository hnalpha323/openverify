/**
 * Workflow 7A (S) stubs in the session paths (C91.1, C91.5, C93.2, C94.5; F28). Owner:
 * `api-signals`, which builds each one; `foundation-7a` (Stage 1b (S)) froze the signatures and
 * placed the calls:
 *
 * - {@link recordSessionDeviceInTx}: in `recordSessionStart` (`services/inquiry-sessions.ts`),
 *   after the network evaluation, in the start's transaction, for the call that won the start. It
 *   writes the session's parsed device fields from `signal-logic`'s mapper (C94.5). Until built it
 *   writes nothing: the fields stay `null` (not evaluated), never a guess.
 * - {@link assertSessionCapInTx}: in the session-creation paths (`resumeInquiry`,
 *   `redeemOneTimeLink`, and Workflow 7A (H)'s handoff redemption), under the inquiry's lock and
 *   after any token check (P28). It answers whether the template's `max-sessions` is reached, and
 *   with `expire-inquiry-on-session-limit` expires the inquiry in `tx` and returns the staged
 *   events and storage keys; the caller rolls back a plain refusal, commits an expiry, dispatches
 *   its events and deletes its objects, and answers 409 `session_limit_reached` either way. Until built it never limits, as Phase 6
 *   did not.
 * - {@link expireSessionsForInquiries} and {@link generateSessionOneTimeLink}: the frozen routes
 *   `POST /inquiry-sessions/expire-all` with `meta.inquiry-ids` and
 *   `POST /inquiry-sessions/:id/generate-one-time-link` (C91.5).
 *
 * `services/inquiries.ts`, `inquiry-sessions.ts` and `one-time-links.ts` import this module, so the
 * functions here load them when called, never when this module is evaluated: no import cycle.
 */
import { parseSessionDevice, type ParsedSessionDevice } from '@openverify/checks';
import type { ResolvedTemplateSettings } from '@openverify/contracts';
import {
  countInquirySessions,
  getInquiry,
  getInquirySession,
  listInquirySessions,
  recordSessionDeviceFields,
  type Db,
  type Inquiry,
  type InquirySession,
} from '@openverify/db';
import { auditEntryOf } from '../context.js';
import { NotFoundError, SignalProblemError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import type { ApiDependencies } from '../context.js';
import type { Acting, LifecycleDeps } from '../inquiries.js';

/** The session whose start is being recorded, as `markInquirySessionStarted` returned it. */
export type SessionDeviceTarget = Pick<InquirySession, 'id' | 'environmentId' | 'inquiryId'>;

/**
 * C93.2, C94.5: writes the session's parsed device fields in `tx` from its user agent (bowser, or
 * the exact SDK header `OpenVerify-Android/<version>`). Must never throw for an unparsable user
 * agent: a failure rolls the session start back.
 */
export const recordSessionDeviceInTx: (
  tx: Db,
  session: SessionDeviceTarget,
  client: { userAgent: string | null },
  at: Date,
) => Promise<void> = async (tx, session, client) => {
  let parsed: ParsedSessionDevice;
  try {
    parsed = parseSessionDevice(client.userAgent);
  } catch {
    // An unparsable user agent records nothing: the fields stay `null` (not evaluated).
    return;
  }
  if (Object.values(parsed).every((value) => value === null)) {
    return;
  }
  await recordSessionDeviceFields(tx, session.environmentId, session.id, { ...parsed });
};

/** The template settings the cap reads (C91.5). */
export type SessionCapSettings = Pick<
  ResolvedTemplateSettings,
  'max-sessions' | 'expire-inquiry-on-session-limit'
>;

/**
 * `limited: false` lets the caller create the session. `limited: true` refuses it with 409: with
 * `expired: false` the caller rolls `tx` back (the redeemed link stays unused); with
 * `expired: true` the setting expired the inquiry in `tx`, so the caller commits it, dispatches
 * `staged` (`inquiry.expired` and its kin) and deletes `storageKeys`, the objects of the capture
 * files the expiry deleted (C40.2), before answering 409.
 */
export type SessionCapOutcome =
  | { limited: false }
  | { limited: true; expired: false }
  | { limited: true; expired: true; staged: StagedEvent[]; storageKeys: string[] };

/**
 * C91.5: whether `inquiry` (locked in `tx`) may have one more session. Every session the inquiry
 * ever had counts, expired and canceled ones too, as the public cap does. At the cap, with
 * `expire-inquiry-on-session-limit`, the inquiry is expired in `tx` (`inquiry.expired`, its
 * sessions canceled and its initiated verifications canceled, as every expiry does).
 */
export async function assertSessionCapInTx(
  tx: Db,
  deps: LifecycleDeps,
  inquiry: Inquiry,
  settings: SessionCapSettings,
): Promise<SessionCapOutcome> {
  const sessions = await countInquirySessions(tx, inquiry.environmentId, inquiry.id);
  if (sessions < settings['max-sessions']) {
    return { limited: false };
  }
  if (!settings['expire-inquiry-on-session-limit']) {
    return { limited: true, expired: false };
  }
  const { transitionInquiryInTx } = await import('../inquiries.js');
  const expired = await transitionInquiryInTx(tx, deps, inquiry, 'expired');
  return expired === null
    ? { limited: true, expired: false }
    : { limited: true, expired: true, staged: expired.staged, storageKeys: expired.storageKeys };
}

/** The 409 of a refused session creation (C91.5). */
export function sessionLimitReached(): SignalProblemError {
  return new SignalProblemError(
    'session_limit_reached',
    'The inquiry has reached its maximum number of sessions.',
  );
}

/**
 * `POST /inquiry-sessions/expire-all` with `meta.inquiry-ids` (1-100): every active session of each
 * inquiry becomes `expired`, each with `inquiry-session.expired` and an audit entry, in one
 * transaction: when one inquiry is not in this environment, nothing is expired.
 * @throws {NotFoundError} when an inquiry is not in this environment.
 */
export async function expireSessionsForInquiries(
  deps: ApiDependencies,
  acting: Acting,
  inquiryIds: readonly string[],
): Promise<{ expiredCount: number }> {
  const { db, events, clock, audit } = deps;
  const { environmentId } = acting.ctx;
  const at = clock.now();
  const { expireSessions } = await import('../inquiry-sessions.js');
  const staged = await db.transaction(async (tx) => {
    for (const inquiryId of inquiryIds) {
      if ((await getInquiry(tx, environmentId, inquiryId)) === null) {
        throw new NotFoundError(`Inquiry ${inquiryId} was not found.`);
      }
    }
    const active = await activeSessionsOf(tx, environmentId, inquiryIds);
    const expired = await expireSessions(tx, events, active, at);
    for (const session of active) {
      await audit.record(
        tx,
        auditEntryOf(acting.ctx, acting.actor, {
          action: 'inquiry-session.expired',
          resourceType: 'inquiry-session',
          resourceId: session.id,
        }),
      );
    }
    return expired;
  });
  await events.dispatch(staged);
  return { expiredCount: staged.length };
}

/** The active sessions of `inquiryIds`, every page. */
async function activeSessionsOf(
  tx: Db,
  environmentId: string,
  inquiryIds: readonly string[],
): Promise<InquirySession[]> {
  const sessions: InquirySession[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await listInquirySessions(tx, environmentId, {
      inquiryId: [...inquiryIds],
      status: 'active',
      size: 100,
      after,
    });
    sessions.push(...page.items);
    if (page.next === null) {
      return sessions;
    }
    after = page.next;
  }
}

/**
 * `POST /inquiry-sessions/:id/generate-one-time-link`: a C10 link for the session's inquiry, with
 * C10's lifetime (`expiresInSeconds`, else the template's), revocation of older unused links and
 * audit entry.
 * @throws {NotFoundError} when the session is not in this environment.
 */
export async function generateSessionOneTimeLink(
  deps: ApiDependencies,
  acting: Acting,
  sessionId: string,
  expiresInSeconds: number | undefined,
): Promise<{ oneTimeLink: string; expiresAt: Date }> {
  const session = await getInquirySession(deps.db, acting.ctx.environmentId, sessionId);
  if (session === null) {
    throw new NotFoundError(`Inquiry session ${sessionId} was not found.`);
  }
  const { generateOneTimeLink } = await import('../one-time-links.js');
  const { meta } = await generateOneTimeLink(deps, acting, session.inquiryId, expiresInSeconds);
  return { oneTimeLink: meta['one-time-link'], expiresAt: new Date(meta['expires-at']) };
}
