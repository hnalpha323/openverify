/**
 * C55.6: `POST /api/v1/flow/verifications/:id/otp`, a code sent to the destination the body names,
 * after the C52.1 preconditions, in the P11 order:
 *
 * 1. validate: the body's member for the channel, a sender bound for the channel (422
 *    `otp_channel_not_configured`), the destination (C55.8, 422 `otp_destination_invalid` or
 *    `otp_destination_not_allowed`);
 * 2. read the verification's sends and cooldown without a lock: a send after the fifth submits the
 *    verification (409 `otp_not_confirmed`, no dead end), a send inside the cooldown is 429
 *    `otp_resend_too_soon`;
 * 3. consume the fail-closed limits (C55.7; the destination's guess budget first);
 * 4. under the C40.6 locks, re-check, count the send, store the code's HMAC as the open code
 *    (superseding the earlier one) and commit;
 * 5. send it (SMS through the bound sender, email through the mailer, C55.9 texts);
 * 6. under the locks again, record the provider's message id, or mark the code `errored` and
 *    release the send (an errored send does not count), answering 502 `otp_delivery_failed`.
 *
 * The answer is the verification's flow view with `guidance.otp`, never the code.
 */
import { validateEmailDestination, validatePhoneDestination } from '@openverify/checks';
import {
  OTP_CODE_TTL_SECONDS,
  OTP_MAX_SENDS,
  type FlowOtpSendBody,
  type FlowVerificationResource,
} from '@openverify/contracts';
import {
  getOtpVerificationState,
  insertOtpChallenge,
  listOtpChallenges,
  lockInquiry,
  lockVerification,
  markOtpChallengeErrored,
  otpDestinationIndex,
  otpKey,
  recordOtpDelivery,
  releaseOtpSend,
  reserveOtpSend,
  resolveOtpSmsMaxPerHour,
} from '@openverify/db';
import type { FlowSession } from '../../auth/flow-session.js';
import { ConflictError, UnprocessableContentError } from '../../errors.js';
import { SmsSendError, type SandboxSmsSender, type SmsSender } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import {
  requireFlowVerificationUnderLock,
  type FlowVerificationTarget,
} from '../flow-preconditions.js';
import { findVerification } from '../verifications.js';
import { otpCodeHmac, newOtpCode } from './codes.js';
import {
  messageLocaleOf,
  organizationNameOf,
  otpContextOf,
  otpFlowView,
  type OtpContext,
} from './context.js';
import { consumeOtpSendLimits, guessBudgetOutcome, type OtpRuleOverrides } from './limits.js';
import { flowHostOf, otpEmailMessage, otpSmsBody } from './messages.js';
import {
  alreadyConfirmed,
  channelNotConfigured,
  deliveryFailed,
  destinationRefused,
  notConfirmed,
  resendTooSoon,
} from './problems.js';
import {
  afterServerSubmit,
  recordBudgetTrip,
  refuseUnlessAllowed,
  submitByServerInTx,
} from './records.js';
import { resendAvailableAt } from './state.js';
import { fromEnvironment } from '../../mail/sender-name.js';

/** Where an OTP request comes from, and where its failures are logged (ids and codes only). */
export interface OtpRequestContext {
  /** `request.ip`, which honours the trust-proxy setting (C55.7). */
  ip: string;
  log: { warn(details: Record<string, unknown>, message: string): void };
}

/** Options tests use: shorter limit rules. */
export interface OtpServiceOptions {
  limits?: OtpRuleOverrides | undefined;
}

/** The statuses an OTP request acts on; a confirmed one answers `otp_already_confirmed`. */
export const OTP_REQUEST_STATUSES = ['initiated', 'confirmed'] as const;

/** A validated destination (C55.8). */
interface Destination {
  /** E.164, or the address with its ASCII domain: what the sender gets, sealed to the code. */
  deliverTo: string;
  /** The HMAC and blind-index value: E.164, or the lower-cased address. */
  normalized: string;
  /** The number's region, for SMS. */
  country: string | null;
}

/**
 * The destination the body names for the context's channel.
 * @throws {UnprocessableContentError} for the other channel's member.
 * @throws {Phase5ProblemError} `otp_destination_invalid` or `otp_destination_not_allowed`.
 */
function destinationOf(context: OtpContext, body: FlowOtpSendBody): Destination {
  const { step } = context;
  if (step.type === 'phone_otp') {
    if (!('phone-number' in body)) {
      throw new UnprocessableContentError('A phone-number verification takes a phone-number.');
    }
    const phone = validatePhoneDestination(body['phone-number'], {
      allowedCountries: step.allowedCountries,
      allowVoip: step.allowVoip,
    });
    if (!phone.ok) {
      throw destinationRefused(phone.problem);
    }
    return { deliverTo: phone.e164, normalized: phone.e164, country: phone.country };
  }
  if (!('email-address' in body)) {
    throw new UnprocessableContentError('An email-address verification takes an email-address.');
  }
  const email = validateEmailDestination(body['email-address']);
  if (!email.ok) {
    throw destinationRefused(email.problem);
  }
  return { deliverTo: email.address, normalized: email.normalized, country: null };
}

/** The sender of the channel in the environment, or `null` when none is bound or configured. */
function senderOf(
  deps: ApiDependencies,
  context: OtpContext,
): { id: string; sms: SmsSender | SandboxSmsSender | null } | null {
  if (context.channel === 'email') {
    return deps.mailer.configured ? { id: 'smtp', sms: null } : null;
  }
  const sms = deps.providers[context.environment.kind].sms;
  return sms === undefined ? null : { id: sms.id, sms };
}

type Stored =
  | { kind: 'stored' }
  | { kind: 'already_confirmed' }
  | { kind: 'too_soon'; availableAt: Date }
  | { kind: 'submitted'; staged: Awaited<ReturnType<typeof submitByServerInTx>> };

/** The outcome of a delivery: the provider's message id, or the failure's code. */
type Delivery = { ok: true; providerMessageId: string | null } | { ok: false; errorCode: string };

/** C55.6: sends a code (see the file header). */
export async function sendOtp(
  deps: ApiDependencies,
  session: FlowSession,
  target: FlowVerificationTarget,
  body: FlowOtpSendBody,
  request: OtpRequestContext,
  options: OtpServiceOptions = {},
): Promise<FlowVerificationResource> {
  const { inquiry, verification } = target;
  const { environmentId } = session;
  if (verification.status === 'confirmed') {
    throw alreadyConfirmed();
  }
  const context = await otpContextOf(deps, inquiry, verification);
  const destination = destinationOf(context, body);
  const sender = senderOf(deps, context);
  if (sender === null) {
    throw channelNotConfigured();
  }
  const { channel } = context;
  const destinationIndex = otpDestinationIndex(deps.blindIndexKey, {
    environmentId,
    channel,
    destination: destination.normalized,
  });
  const now = deps.clock.now();

  // 2. Without a lock (P11).
  const state = await getOtpVerificationState(deps.db, environmentId, verification.id);
  const sends = state?.sends ?? 0;
  if (sends >= OTP_MAX_SENDS) {
    return submitOutOfSends(deps, session, target, now);
  }
  const availableAt = resendAvailableAt(
    await listOtpChallenges(deps.db, environmentId, verification.id),
    sends,
    now,
  );
  if (availableAt !== null && availableAt.getTime() > now.getTime()) {
    throw resendTooSoon(availableAt, now);
  }

  // 3. The fail-closed limits, the destination's guess budget first.
  await refuseUnlessAllowed(
    deps,
    target,
    await guessBudgetOutcome(deps.cache, destinationIndex, now),
  );
  const budgetPerHour = Math.min(
    resolveOtpSmsMaxPerHour(context.environment.settings),
    deps.otpSmsMaxPerHourCeiling,
  );
  const limited = await consumeOtpSendLimits(
    deps.rateLimiter,
    {
      environmentId,
      inquiryId: inquiry.id,
      channel,
      destinationIndex,
      clientIp: request.ip,
      ...(context.step.type === 'phone_otp'
        ? {
            sms: {
              e164: destination.normalized,
              country: destination.country ?? '',
              multipleCountries: context.step.allowedCountries.length > 1,
              budgetPerHour,
            },
          }
        : {}),
    },
    options.limits,
  );
  if (!limited.allowed && 'limit' in limited && limited.limit === 'otp-sms-max-per-hour') {
    await recordBudgetTrip(deps, environmentId, budgetPerHour, request);
  }
  await refuseUnlessAllowed(deps, target, limited);

  // 4. Under the locks: re-check, count the send, store the code's HMAC.
  const code = newOtpCode(context.codeLength);
  const keyId = deps.keyring.currentKeyId;
  const key = otpKey(deps.keyring, keyId);
  if (key === null) {
    throw new Error('The current KEK has no code key');
  }
  const challengeId = deps.ids.newId('otpc');
  const stored = await deps.db.transaction(async (tx): Promise<Stored> => {
    const { verification: locked } = await requireFlowVerificationUnderLock(
      tx,
      session,
      verification.id,
      OTP_REQUEST_STATUSES,
    );
    if (locked.status === 'confirmed') {
      return { kind: 'already_confirmed' };
    }
    const lockedState = await getOtpVerificationState(tx, environmentId, verification.id);
    const lockedSends = lockedState?.sends ?? 0;
    if (lockedSends < OTP_MAX_SENDS) {
      const due = resendAvailableAt(
        await listOtpChallenges(tx, environmentId, verification.id),
        lockedSends,
        now,
      );
      if (due !== null && due.getTime() > now.getTime()) {
        return { kind: 'too_soon', availableAt: due };
      }
    }
    const counted =
      lockedSends >= OTP_MAX_SENDS
        ? null
        : await reserveOtpSend(
            tx,
            environmentId,
            { verificationId: verification.id, inquiryId: inquiry.id },
            OTP_MAX_SENDS,
          );
    if (counted === null) {
      return {
        kind: 'submitted',
        staged: await submitByServerInTx(tx, deps, locked, verification.checks, now),
      };
    }
    await insertOtpChallenge(tx, environmentId, {
      id: challengeId,
      verificationId: verification.id,
      inquiryId: inquiry.id,
      channel,
      destination: destination.deliverTo,
      destinationIndex,
      codeHmac: otpCodeHmac(
        key,
        { verificationId: verification.id, channel, destination: destination.normalized },
        code,
      ),
      codeKeyId: keyId,
      provider: sender.id,
      sentAt: now,
      expiresAt: new Date(now.getTime() + OTP_CODE_TTL_SECONDS * 1000),
    });
    return { kind: 'stored' };
  });
  if (stored.kind === 'already_confirmed') {
    throw alreadyConfirmed();
  }
  if (stored.kind === 'too_soon') {
    throw resendTooSoon(stored.availableAt, now);
  }
  if (stored.kind === 'submitted') {
    return answerSubmitted(deps, target, stored.staged);
  }

  // 5. Send, outside any transaction.
  const delivery = await deliver(deps, context, sender.sms, {
    inquiry,
    sessionId: session.id,
    destination,
    destinationIndex,
    code,
  });

  // 6. Record the delivery or its failure under the locks.
  await deps.db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, inquiry.id);
    await lockVerification(tx, environmentId, verification.id);
    if (delivery.ok) {
      await recordOtpDelivery(tx, environmentId, challengeId, delivery.providerMessageId);
    } else if (await markOtpChallengeErrored(tx, environmentId, challengeId, delivery.errorCode)) {
      await releaseOtpSend(tx, environmentId, verification.id);
    }
  });
  if (!delivery.ok) {
    request.log.warn(
      { verificationId: verification.id, channel, error: delivery.errorCode },
      'one-time code not delivered',
    );
    throw deliveryFailed();
  }
  return otpFlowView(
    deps,
    deps.db,
    context,
    await findVerification(deps.db, environmentId, verification.id),
  );
}

/** Sends the code by the context's channel; a failure is a code, never a message or a number. */
async function deliver(
  deps: ApiDependencies,
  context: OtpContext,
  sms: SmsSender | SandboxSmsSender | null,
  input: {
    inquiry: FlowVerificationTarget['inquiry'];
    /** The flow session that asked for the code (C94.6, V03). */
    sessionId: string;
    destination: Destination;
    destinationIndex: string;
    code: string;
  },
): Promise<Delivery> {
  const organizationName = await organizationNameOf(deps, context.environment);
  const locale = await messageLocaleOf(deps, {
    environmentId: input.inquiry.environmentId,
    inquiryId: input.inquiry.id,
    sessionId: input.sessionId,
  });
  try {
    if (sms === null) {
      const message = otpEmailMessage({ organizationName, code: input.code, locale });
      // K9-25 (C169.8): from the environment's sender name.
      await deps.mailer.send(
        fromEnvironment(
          { to: { address: input.destination.deliverTo }, ...message },
          context.environment.settings as Readonly<Record<string, unknown>>,
        ),
      );
      return { ok: true, providerMessageId: null };
    }
    const message = {
      to: input.destination.deliverTo,
      body: otpSmsBody({
        organizationName,
        code: input.code,
        locale,
        flowHost: flowHostOf(deps.flowPublicUrl),
      }),
    };
    const result = sms.sandbox
      ? await sms.send(message, {
          environmentId: context.environment.id,
          destinationIndex: input.destinationIndex,
          code: input.code,
        })
      : await sms.send(message);
    return { ok: true, providerMessageId: result.providerMessageId ?? null };
  } catch (error) {
    return {
      ok: false,
      errorCode:
        error instanceof SmsSendError ? error.code : sms === null ? 'mail_failed' : 'sms_failed',
    };
  }
}

/** C55.6: a send after the fifth submits the verification, under the locks. */
async function submitOutOfSends(
  deps: ApiDependencies,
  session: FlowSession,
  target: FlowVerificationTarget,
  now: Date,
): Promise<never> {
  const staged = await deps.db.transaction(async (tx) => {
    const { verification: locked } = await requireFlowVerificationUnderLock(
      tx,
      session,
      target.verification.id,
      OTP_REQUEST_STATUSES,
    );
    if (locked.status === 'confirmed') {
      throw alreadyConfirmed();
    }
    const state = await getOtpVerificationState(tx, session.environmentId, locked.id);
    if ((state?.sends ?? 0) < OTP_MAX_SENDS) {
      throw new ConflictError('The verification changed meanwhile; try again.');
    }
    return submitByServerInTx(tx, deps, locked, target.verification.checks, now);
  });
  return answerSubmitted(deps, target, staged);
}

/** After a server submit committed: dispatch, enqueue and answer `otp_not_confirmed`. */
async function answerSubmitted(
  deps: ApiDependencies,
  target: FlowVerificationTarget,
  staged: Awaited<ReturnType<typeof submitByServerInTx>>,
): Promise<never> {
  if (staged === null) {
    throw new ConflictError('The verification is no longer open.');
  }
  await afterServerSubmit(deps, target.verification, staged);
  throw notConfirmed();
}
