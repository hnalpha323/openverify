/**
 * One-time links (contract C10): `${OPENVERIFY_FLOW_PUBLIC_URL}/#inquiry-id=<id>&one-time-token=ovo_...`.
 *
 * - `generate-one-time-link` stores only the token's SHA-256, revokes the inquiry's older
 *   unused links, and never lets a link outlive its inquiry;
 * - the flow redeems the token once for a session token (`POST /flow/one-time-links/redeem`),
 *   without auth. Every failure answers the same 401, so a caller learns nothing about which
 *   part was wrong. The rate-limit plugin limits the route per client IP (C12
 *   `one-time-link-redeem`) before anything else runs.
 */
import {
  buildOneTimeLinkUrl,
  newOneTimeLinkToken,
  newSessionToken,
  toTimestamp,
  type FlowRedeemOneTimeLinkBody,
  type FlowRedeemOneTimeLinkResponse,
  type GenerateOneTimeLinkDocument,
} from '@openverify/contracts';
import {
  createInquirySession,
  createOneTimeLink,
  getInquiry,
  type Db,
  type Inquiry,
  hashSessionToken,
  lockInquiry,
  redeemOneTimeLink as redeemLink,
} from '@openverify/db';
import {
  InvalidTransitionError,
  NotFoundError,
  RedactedError,
  UnauthorizedError,
} from '../errors.js';
import { extendExpiryOnResumeInTx, oneTimeLinkLifetimeSeconds } from '../flow-engine/expiry.js';
import { auditEntryOf, type ApiDependencies } from './context.js';
import { findInquiry, inquiryResourceOf, isInquiryOpen, type Acting } from './inquiries.js';
import { pinnedSettings } from './inquiry-templates.js';
import { deleteObjects } from './selfie-captures.js';
import { assertSessionCapInTx, sessionLimitReached } from './signals/sessions.js';

/**
 * `POST /inquiries/:id/generate-one-time-link` for a `created` or `pending` inquiry. The link
 * lives `expiresInSeconds`, else the inquiry's own `one-time-link-expiration-seconds` (C151.10),
 * else the pinned version's, and
 * never past the inquiry's `expires-at`. Older unused links are revoked. Audited without the
 * token.
 * @throws {NotFoundError} when the inquiry is not in this environment.
 * @throws {RedactedError} when the inquiry was redacted (Workflow 2B F018).
 * @throws {InvalidTransitionError} when the inquiry is finished or already past its expiry.
 */
export async function generateOneTimeLink(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  expiresInSeconds: number | undefined,
): Promise<GenerateOneTimeLinkDocument> {
  const { db, flowPublicUrl } = deps;
  const { environmentId } = acting.ctx;
  const token = newOneTimeLinkToken();
  const { inquiry, expiresAt } = await db.transaction((tx) =>
    generateOneTimeLinkInTx(tx, deps, acting, id, expiresInSeconds, token),
  );
  return {
    data: await inquiryResourceOf(db, environmentId, inquiry, acting.mask),
    meta: {
      'one-time-link': buildOneTimeLinkUrl(flowPublicUrl, id, token),
      'expires-at': toTimestamp(expiresAt),
    },
  };
}

/**
 * {@link generateOneTimeLink} in the caller's transaction, for a token the caller made and places
 * only in its outgoing message (C122.2, P32).
 */
export async function generateOneTimeLinkInTx(
  tx: Db,
  { clock, audit }: Pick<ApiDependencies, 'clock' | 'audit'>,
  acting: Pick<Acting, 'ctx' | 'actor'>,
  id: string,
  expiresInSeconds: number | undefined,
  token: string,
): Promise<{ inquiry: Inquiry; expiresAt: Date; linkId: number }> {
  const { environmentId } = acting.ctx;
    if ((await lockInquiry(tx, environmentId, id)) === null) {
      throw new NotFoundError(`Inquiry ${id} was not found.`);
    }
    const current = await findInquiry(tx, environmentId, id);
    if (current.redactedAt !== null) {
      throw new RedactedError(`Inquiry ${id} was redacted; it gets no one-time links.`);
    }
    if (!isInquiryOpen(current)) {
      throw new InvalidTransitionError(
        `The inquiry is ${current.status}; one-time links are only for created or pending inquiries.`,
      );
    }
    const now = clock.now();
    const lifetime = oneTimeLinkLifetimeSeconds(
      current,
      await pinnedSettings(tx, current),
      expiresInSeconds,
    );
    const until = new Date(Math.min(now.getTime() + lifetime * 1000, current.expiresAt.getTime()));
    if (until.getTime() <= now.getTime()) {
      throw new InvalidTransitionError('The inquiry is past its expiry.');
    }
    const { link } = await createOneTimeLink(tx, environmentId, {
      inquiryId: id,
      tokenHash: hashSessionToken(token),
      expiresAt: until,
      at: now,
    });
    await audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'inquiry.one-time-link-generated',
        resourceType: 'inquiry',
        resourceId: id,
        metadata: { 'expires-at': toTimestamp(until) },
      }),
    );
    return { inquiry: current, expiresAt: until, linkId: link.id };
}

/** The one 401 every refused redeem answers (C10). */
const refusal = () => new UnauthorizedError('The one-time link is not valid or has expired.');

/**
 * `POST /flow/one-time-links/redeem` (C10): marks the link used, exactly once, and opens a
 * flow session living the pinned version's `session-expiration-seconds`, in one transaction,
 * so a failure leaves the link unused.
 * @throws {UnauthorizedError} the same generic 401 for an unknown, used, revoked or expired
 * token, another inquiry's token, and an inquiry that is no longer `created` or `pending`.
 */
export async function redeemOneTimeLink(
  deps: ApiDependencies,
  body: FlowRedeemOneTimeLinkBody,
): Promise<FlowRedeemOneTimeLinkResponse> {
  const { db, clock, ids } = deps;
  const now = clock.now();
  const sessionToken = newSessionToken();
  const redeemed = await db.transaction(async (tx) => {
    const link = await redeemLink(tx, {
      inquiryId: body['inquiry-id'],
      tokenHash: hashSessionToken(body['one-time-token']),
      now,
    });
    if (link === null) {
      throw refusal();
    }
    // C91.5 (Workflow 7A): the cap comes after the token (P28), under the inquiry's lock.
    await lockInquiry(tx, link.environmentId, link.inquiryId);
    const inquiry = await getInquiry(tx, link.environmentId, link.inquiryId);
    if (inquiry === null) {
      throw refusal();
    }
    const settings = await pinnedSettings(tx, inquiry);
    const cap = await assertSessionCapInTx(tx, deps, inquiry, settings);
    if (cap.limited) {
      if (!cap.expired) {
        // Rolls the redemption back: the link stays unused.
        throw sessionLimitReached();
      }
      return { limited: cap };
    }
    const until = new Date(now.getTime() + settings['session-expiration-seconds'] * 1000);
    await createInquirySession(tx, link.environmentId, {
      id: ids.newId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: until,
    });
    // C151.10 (Workflow 9B): a redemption resumes the inquiry, so its expiry moves to
    // `max(expires-at, now + after-resume window)` in this transaction.
    await extendExpiryOnResumeInTx(tx, inquiry, now);
    return { until };
  });
  if ('limited' in redeemed) {
    await deps.events.dispatch(redeemed.limited.staged);
    await deleteObjects(deps.storage, redeemed.limited.storageKeys);
    throw sessionLimitReached();
  }
  return { 'session-token': sessionToken, 'expires-at': toTimestamp(redeemed.until) };
}
