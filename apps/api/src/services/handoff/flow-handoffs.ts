/**
 * C96.3 (Workflow 7A): the services of the flow handoff routes (`routes/flow/handoffs.ts`). Owner:
 * `flow-handoff`; the signatures were frozen by `foundation-7a` (Stage 1b (H)), `issueHandoff`
 * taking the request's address as well for the SMS-pumping guards.
 *
 * - Session-authenticated (the issuing, desktop session): `issueHandoff` (`POST /flow/handoffs`,
 *   under the `flow-handoffs` and `flow-handoffs-ip` policies; an email or SMS send also under the
 *   per-environment budget of `OPENVERIFY_HANDOFF_SENDS_PER_HOUR`, which fails closed, and an SMS
 *   under the Phase 5 SMS-pumping guards), `continueHandoffHere`, `getCurrentHandoff` and
 *   `rejectCurrentHandoff`.
 * - Unauthenticated (the phone, before it has a session; `one-time-link-redeem` per address):
 *   `previewHandoff` (consumes nothing, P15), `declineHandoff` (V04) and `redeemHandoff` (on
 *   Continue). Each checks the token first, its digest compared in constant time, and answers every
 *   failure with the one uniform 410 `handoff_token_invalid`: unknown, used, revoked, expired,
 *   another inquiry's, a closed inquiry's, or a wrong code. Only then does the redemption ask the
 *   session cap (`assertSessionCapInTx`, under the inquiry's row lock; P28).
 *
 * Locks are taken in one order everywhere: the inquiry, then the token. The destination of an
 * email or SMS handoff is used only to send: it is never stored, logged or audited. Every handoff
 * act writes a system audit entry (no principal acts in the flow): `handoff.issued`,
 * `handoff.previewed`, `handoff.redeemed`, `handoff.declined`, `handoff.continued-here` and
 * `handoff.rejected`, with ids, the method and counts only.
 */
import {
  handoffDistanceFacts,
  validateEmailDestination,
  validatePhoneDestination,
} from '@openverify/checks';
import {
  handoffUrlFragment,
  newHandoffToken,
  newSessionToken,
  toTimestamp,
  type CreateHandoffBody,
  type CreateHandoffResponse,
  type CurrentHandoffResponse,
  type HandoffState,
  type PreviewHandoffResponse,
} from '@openverify/contracts';
import type {
  declineHandoffBodySchema,
  previewHandoffBodySchema,
  redeemHandoffBodySchema,
  redeemHandoffResponseSchema,
} from '@openverify/contracts';
import {
  createHandoffSession,
  findHandoffTokenByHash,
  getEnvironment,
  getInquiry,
  getInquirySession,
  getInquiryTemplateVersion,
  hasConfirmedOtpDestination,
  hashSessionToken,
  issueHandoffToken,
  latestHandoffToken,
  listInquiryHandoffSteps,
  listInquiryVerifications,
  listSessionNetworks,
  listVerificationFiles,
  lockHandoffToken,
  lockInquiry,
  markFilesDeleted,
  markHandoffTokenRedeemed,
  markVerificationsFromRejectedHandoff,
  otpDestinationIndex,
  recordHandoffCodeAttempt,
  recordHandoffDistanceFacts,
  rejectHandoffSession,
  revokeHandoffToken,
  setInquiryHandoffStepState,
  type Db,
  type Environment,
  type HandoffToken,
  type Inquiry,
  type InquirySession,
} from '@openverify/db';
import type { Flow, FlowStep } from '@openverify/flow-spec';
import type { z } from 'zod';
import type { FlowSession } from '../../auth/flow-session.js';
import { DEFAULT_HANDOFF_SENDS_PER_HOUR } from '../../config.js';
import { SignalProblemError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { appendSystemAuditEntry } from '../audit-log.js';
import { deleteRenditionsForFilesInTx } from '../cases/attachments/renditions.js';
import type { ApiDependencies } from '../context.js';
import { consentHolderOf } from '../flow.js';
import { findInquiry, isInquiryOpen, transitionInquiryInTx } from '../inquiries.js';
import {
  recordSessionStart,
  stageSessionEvents,
} from '../inquiry-sessions.js';
import { pinnedSettings } from '../inquiry-templates.js';
import { messageLocaleOf } from '../otp/context.js';
import { consumeOtpSendLimits } from '../otp/limits.js';
import { storedFlowView } from '../stored-flow.js';
import { advanceFlowInTx, runFlowAfterCommit } from '../../flow-engine/advance.js';
import { assertCurrentStepInTx } from '../../flow-engine/current-step.js';
import { deleteObjects as deleteCapExpiryObjects } from '../selfie-captures.js';
import { assertSessionCapInTx, sessionLimitReached } from '../signals/sessions.js';
import { cancelSubResources } from '../sub-resources/index.js';
import {
  fileIdsByVerification,
  moveVerification,
  stageVerificationEvent,
} from '../verifications.js';
import { handoffEmailMessage, handoffSmsBody } from './messages.js';
import { HANDOFF_REVIEW_AUDIT_ACTION } from './review.js';
import {
  HANDOFF_CODE_ATTEMPTS,
  currentHandoffStep,
  handoffCodeHash,
  handoffContextOf,
  handoffOptionsOf,
  handoffStepsOf,
  newConfirmationCode,
  organizationDisplayNameOf,
  sameDigest,
  servedHandoffState,
  type CurrentHandoffStep,
} from './steps.js';
import { extendExpiryOnResumeInTx } from '../../flow-engine/expiry.js';
import { fromEnvironment } from '../../mail/sender-name.js';
import { createWorkerLogger } from '../../jobs/logger.js';
import { metrics, type MetricLogger } from '../../metrics-registry.js';

export type PreviewHandoffBody = z.infer<typeof previewHandoffBodySchema>;
export type DeclineHandoffBody = z.infer<typeof declineHandoffBodySchema>;
export type RedeemHandoffBody = z.infer<typeof redeemHandoffBodySchema>;
export type RedeemHandoffResponse = z.infer<typeof redeemHandoffResponseSchema>;

/** The request's own facts the routes record (the new session's first call, the SMS limits). */
export interface HandoffClient {
  /** `request.ip`, under the API's trust mode (C93.1). */
  ip: string;
  userAgent: string | undefined;
}

/** The window of the per-environment send budget (C96.3). */
const SEND_BUDGET_WINDOW_SECONDS = 3600;

const invalidToken = () =>
  new SignalProblemError('handoff_token_invalid', 'The handoff link is not valid or has expired.');
const notAvailable = () =>
  new SignalProblemError('handoff_not_available', 'No device handoff step is waiting here.');
const notRedeemed = () =>
  new SignalProblemError('handoff_not_redeemed', 'No handoff to another device was redeemed.');
const destinationNotConfirmed = () =>
  new SignalProblemError(
    'destination_not_confirmed',
    'A handoff link is sent only to a destination this verification confirmed with a code.',
  );

/** What the issuing session's routes read. */
interface IssuingContext {
  inquiry: Inquiry;
  flow: Flow;
  environment: Environment;
  session: InquirySession;
  current: CurrentHandoffStep | null;
}

async function pinnedFlowOf(db: Db, inquiry: Inquiry): Promise<Flow> {
  const version = await getInquiryTemplateVersion(
    db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    throw new Error(`Inquiry ${inquiry.id} has no template version`);
  }
  return storedFlowView(version.flow);
}

async function environmentOf(db: Db, environmentId: string): Promise<Environment> {
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    throw new Error(`Environment ${environmentId} of a flow session is missing`);
  }
  return environment;
}

async function issuingContextOf(db: Db, flowSession: FlowSession): Promise<IssuingContext> {
  const { environmentId, inquiryId, id } = flowSession;
  const inquiry = await findInquiry(db, environmentId, inquiryId);
  const flow = await pinnedFlowOf(db, inquiry);
  const session = await getInquirySession(db, environmentId, id);
  if (session === null) {
    throw new Error(`Flow session ${id} is missing`);
  }
  const stored = await listInquiryHandoffSteps(db, environmentId, inquiryId);
  return {
    inquiry,
    flow,
    environment: await environmentOf(db, environmentId),
    session,
    current: currentHandoffStep(flow, stored),
  };
}

/**
 * The handoff step a desktop session may act on: one not done, for a session no handoff created,
 * of an open inquiry. A phone (or SDK) session reads it `skipped`, so it has none.
 */
function waitingStep(context: IssuingContext): CurrentHandoffStep {
  const { current, session, inquiry } = context;
  if (
    current === null ||
    session.handoffFromSessionId !== null ||
    !isInquiryOpen(inquiry) ||
    inquiry.redactedAt !== null
  ) {
    throw notAvailable();
  }
  const state = servedHandoffState(current, session);
  if (state === 'redeemed' || state === 'continued_here' || state === 'skipped') {
    throw notAvailable();
  }
  return current;
}

/** Re-reads the inquiry under its row lock: open and unredacted, or nothing waits. */
async function lockOpenInquiry(tx: Db, environmentId: string, inquiryId: string): Promise<Inquiry> {
  await lockInquiry(tx, environmentId, inquiryId);
  const inquiry = await getInquiry(tx, environmentId, inquiryId);
  if (inquiry === null || !isInquiryOpen(inquiry) || inquiry.redactedAt !== null) {
    throw notAvailable();
  }
  return inquiry;
}

/**
 * Re-reads the step's state under the inquiry's lock: a redemption, a continue-here or a decline
 * that committed after the unlocked read wins, and this call finds nothing waiting.
 */
async function assertStepWaiting(
  tx: Db,
  environmentId: string,
  step: { inquiryId: string; stepId: string },
): Promise<void> {
  const stored = await listInquiryHandoffSteps(tx, environmentId, step.inquiryId);
  const state = stored.find((row) => row.stepId === step.stepId)?.state ?? 'pending';
  if (state === 'redeemed' || state === 'continued_here' || state === 'skipped') {
    throw notAvailable();
  }
}

const currentAnswer = (status: HandoffState): CurrentHandoffResponse => ({
  status,
  'redeemed-at': null,
  'os-name': null,
  'browser-name': null,
});

/** The link a phone opens: the flow's public URL with the handoff fragment. */
export function handoffLink(flowPublicUrl: string, inquiryId: string, token: string): string {
  return `${flowPublicUrl.replace(/\/+$/, '')}/${handoffUrlFragment(inquiryId, token)}`;
}

/** A validated email or SMS destination, used only to send. */
interface Destination {
  channel: 'email' | 'sms';
  deliverTo: string;
  /** The blind index of the normalised destination (`otpDestinationIndex`). */
  index: string;
  e164: string | null;
  country: string | null;
  confirmed: boolean;
}

type PhoneOtpStep = Extract<FlowStep, { type: 'phone_otp' }>;

/**
 * Validates an email or SMS destination and reads whether the inquiry confirmed it (C96.3, P02).
 * An SMS destination must suit the flow's `phone_otp` step (its countries and VoIP rule), which
 * confirms SMS destinations; a flow without one sends no handoff SMS.
 */
async function destinationOf(
  deps: ApiDependencies,
  context: IssuingContext,
  body: CreateHandoffBody,
): Promise<Destination> {
  const destination = body.destination ?? '';
  const { environment, inquiry } = context;
  let channel: 'email' | 'sms';
  let deliverTo: string;
  let normalized: string;
  let e164: string | null = null;
  let country: string | null = null;
  if (body.method === 'email') {
    if (!deps.mailer.configured) {
      throw new SignalProblemError(
        'handoff_method_not_allowed',
        'No mail server is configured, so no handoff email can be sent.',
      );
    }
    const email = validateEmailDestination(destination);
    if (!email.ok) {
      throw destinationNotConfirmed();
    }
    channel = 'email';
    deliverTo = email.address;
    normalized = email.normalized;
  } else {
    if (deps.providers[environment.kind].sms === undefined) {
      throw new SignalProblemError(
        'sms_not_configured',
        'A handoff by SMS needs an SMS adapter bound in this environment.',
      );
    }
    const step = context.flow.steps.find((each): each is PhoneOtpStep => each.type === 'phone_otp');
    const phone =
      step === undefined
        ? null
        : validatePhoneDestination(destination, {
            allowedCountries: step.allowedCountries,
            allowVoip: step.allowVoip,
          });
    if (!phone?.ok) {
      throw destinationNotConfirmed();
    }
    channel = 'sms';
    deliverTo = phone.e164;
    normalized = phone.e164;
    e164 = phone.e164;
    country = phone.country;
  }
  const index = otpDestinationIndex(deps.blindIndexKey, {
    environmentId: environment.id,
    channel,
    destination: normalized,
  });
  const confirmed = await hasConfirmedOtpDestination(deps.db, environment.id, {
    inquiryId: inquiry.id,
    channel,
    destinationIndex: index,
  });
  return { channel, deliverTo, index, e164, country, confirmed };
}

/** The API's log for the counter below; the handoff service has no logger of its own. */
let budgetMetricLogger: MetricLogger | undefined;

/**
 * C250.7 (Workflow 11B, platform-ops): a send refused because the budget's store did not answer
 * is counted as `handoff_send_budget_unavailable`, labelled by the environment only.
 */
function sendBudgetUnavailable(environmentId: string): SignalProblemError {
  budgetMetricLogger ??= createWorkerLogger({ name: 'openverify-api' });
  metrics.emit(budgetMetricLogger, 'handoff_send_budget_unavailable', 1, { environmentId });
  return new SignalProblemError(
    'handoff_send_limited',
    'Handoff links cannot be sent right now; try again later.',
    { storeUnavailable: true },
  );
}

/** C96.3 (F09): the environment's email and SMS send budget; it fails closed. */
async function consumeSendBudget(deps: ApiDependencies, environmentId: string): Promise<void> {
  const limit = deps.handoffSendsPerHour ?? DEFAULT_HANDOFF_SENDS_PER_HOUR;
  let allowed: boolean;
  let retryAfterSeconds: number;
  try {
    const decision = await deps.rateLimiter.consume(`${environmentId}|handoff-sends`, {
      name: 'flow-handoffs',
      limit,
      windowSeconds: SEND_BUDGET_WINDOW_SECONDS,
    });
    allowed = decision.allowed;
    retryAfterSeconds = decision.retryAfterSeconds;
  } catch {
    throw sendBudgetUnavailable(environmentId);
  }
  if (!allowed) {
    throw new SignalProblemError(
      'handoff_send_limited',
      'Too many handoff links were sent; try again later.',
      { headers: { 'retry-after': String(Math.max(1, retryAfterSeconds)) } },
    );
  }
}

/** C96.3: an SMS stays under the Phase 5 SMS-pumping guards (C55.7); they fail closed too. */
async function consumeSmsGuards(
  deps: ApiDependencies,
  context: IssuingContext,
  destination: Destination,
  client: HandoffClient,
): Promise<void> {
  const budgetPerHour = deps.otpSmsMaxPerHourCeiling;
  const outcome = await consumeOtpSendLimits(deps.rateLimiter, {
    environmentId: context.environment.id,
    inquiryId: context.inquiry.id,
    channel: 'sms',
    destinationIndex: destination.index,
    clientIp: client.ip,
    sms: {
      e164: destination.e164 ?? '',
      country: destination.country ?? '',
      multipleCountries: true,
      budgetPerHour,
    },
  });
  if (outcome.allowed) {
    return;
  }
  if ('storeUnavailable' in outcome) {
    throw sendBudgetUnavailable(context.environment.id);
  }
  throw new SignalProblemError(
    'handoff_send_limited',
    'Too many messages were sent; try again later.',
    {
      headers: { 'retry-after': String(Math.max(1, outcome.retryAfterSeconds)) },
    },
  );
}

/** Sends the link; `false` when the mailer or the SMS adapter refused it. */
async function deliver(
  deps: ApiDependencies,
  context: IssuingContext,
  flowSession: FlowSession,
  destination: Destination,
  input: { link: string; minutes: number },
): Promise<boolean> {
  const message = {
    organizationName: await organizationDisplayNameOf(deps.db, context.environment),
    link: input.link,
    minutes: input.minutes,
    locale: await messageLocaleOf(deps, consentHolderOf(flowSession)),
  };
  try {
    if (destination.channel === 'email') {
      // K9-25 (C169.8): from the environment's sender name.
      await deps.mailer.send(
        fromEnvironment(
          { to: { address: destination.deliverTo }, ...handoffEmailMessage(message) },
          context.environment.settings as Readonly<Record<string, unknown>>,
        ),
      );
      return true;
    }
    const sms = deps.providers[context.environment.kind].sms;
    if (sms === undefined) {
      return false;
    }
    const text = { to: destination.deliverTo, body: handoffSmsBody(message) };
    await (sms.sandbox
      ? sms.send(text, {
          environmentId: context.environment.id,
          destinationIndex: destination.index,
          code: '',
        })
      : sms.send(text));
    return true;
  } catch {
    // A refused send is a code to the caller (`SmsSendError`, a mail failure), never a message.
    return false;
  }
}

/** `POST /flow/handoffs`: issues a token for the session's waiting handoff step. */
export async function issueHandoff(
  deps: ApiDependencies,
  flowSession: FlowSession,
  body: CreateHandoffBody,
  client: HandoffClient,
): Promise<CreateHandoffResponse> {
  const { db, clock, ids } = deps;
  const context = await issuingContextOf(db, flowSession);
  const { step } = waitingStep(context);
  const options = handoffOptionsOf(step);
  if (!options.methods.includes(body.method)) {
    throw new SignalProblemError(
      'handoff_method_not_allowed',
      `This step does not offer a handoff by ${body.method}.`,
    );
  }
  if (typeof context.environment.settings['organization-display-name'] !== 'string') {
    throw new SignalProblemError(
      'display_name_required',
      'A handoff needs the organization display name the phone shows.',
    );
  }
  let destination: Destination | null = null;
  if (body.method !== 'qr') {
    destination = await destinationOf(deps, context, body);
    if (!destination.confirmed && !options.confirmationCode) {
      throw destinationNotConfirmed();
    }
    await consumeSendBudget(deps, context.environment.id);
    if (destination.channel === 'sms') {
      await consumeSmsGuards(deps, context, destination, client);
    }
  }
  const now = clock.now();
  const token = newHandoffToken();
  const code = options.confirmationCode ? newConfirmationCode() : null;
  const ttlSeconds = body.method === 'qr' ? options.qrTtlSeconds : options.linkTtlSeconds;
  const expiresAt = new Date(
    Math.min(now.getTime() + ttlSeconds * 1000, context.inquiry.expiresAt.getTime()),
  );
  if (expiresAt.getTime() <= now.getTime()) {
    throw notAvailable();
  }
  const id = ids.newId('hnd');
  const { environmentId, inquiryId } = flowSession;
  await db.transaction(async (tx) => {
    await lockOpenInquiry(tx, environmentId, inquiryId);
    // C151.4 (Workflow 9A Stage 1b (S)): only while the handoff step is the current step.
    await assertCurrentStepInTx(
      tx,
      { environmentId, inquiryId },
      { kind: 'handoff', action: 'issue' },
    );
    await assertStepWaiting(tx, environmentId, { inquiryId, stepId: step.id });
    await issueHandoffToken(tx, environmentId, {
      id,
      inquiryId,
      issuingSessionId: flowSession.id,
      stepId: step.id,
      method: body.method,
      tokenHash: hashSessionToken(token),
      confirmationCodeHash: code === null ? null : handoffCodeHash(token, code),
      destinationConfirmed: destination?.confirmed ?? true,
      expiresAt,
      at: now,
    });
    await setInquiryHandoffStepState(tx, environmentId, {
      inquiryId,
      stepId: step.id,
      state: 'issued',
      at: now,
    });
    await appendSystemAuditEntry(tx, environmentId, {
      action: 'handoff.issued',
      resourceType: 'handoff',
      resourceId: id,
      metadata: {
        method: body.method,
        'inquiry-id': inquiryId,
        'inquiry-session-id': flowSession.id,
        'step-id': step.id,
        'expires-at': toTimestamp(expiresAt),
        'confirmation-code': code !== null,
        ...(destination === null ? {} : { 'destination-confirmed': destination.confirmed }),
      },
    });
  });
  if (destination !== null) {
    const minutes = Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 60_000));
    const sent = await deliver(deps, context, flowSession, destination, {
      link: handoffLink(deps.flowPublicUrl, inquiryId, token),
      minutes,
    });
    if (!sent) {
      await db.transaction(async (tx) => {
        await revokeHandoffToken(tx, environmentId, id, { at: clock.now() });
      });
      throw new SignalProblemError(
        'handoff_send_limited',
        'The handoff link could not be sent; try again later.',
        { storeUnavailable: true },
      );
    }
  }
  return {
    id,
    method: body.method,
    'expires-at': toTimestamp(expiresAt),
    ...(body.method === 'qr' ? { 'url-fragment': handoffUrlFragment(inquiryId, token) } : {}),
    ...(code === null ? {} : { 'confirmation-code': code }),
  };
}

/** Revokes the step's newest token while it is live (a continue-here leaves no way in). */
async function revokeLiveToken(
  tx: Db,
  environmentId: string,
  step: { inquiryId: string; stepId: string },
  at: Date,
): Promise<void> {
  const token = await latestHandoffToken(tx, environmentId, step);
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token !== null) {
    await revokeHandoffToken(tx, environmentId, token.id, { at });
  }
}

/** `POST /flow/handoffs/continue-here`: records `continued_here` where it is allowed. */
export async function continueHandoffHere(
  deps: ApiDependencies,
  flowSession: FlowSession,
): Promise<CurrentHandoffResponse> {
  const { db, clock } = deps;
  const context = await issuingContextOf(db, flowSession);
  const { step } = waitingStep(context);
  if (!handoffOptionsOf(step).allowContinueHere) {
    throw new SignalProblemError(
      'continue_here_not_allowed',
      'This step asks to continue on another device.',
    );
  }
  const now = clock.now();
  const { environmentId, inquiryId } = flowSession;
  const advanced = await db.transaction(async (tx) => {
    await lockOpenInquiry(tx, environmentId, inquiryId);
    // C151.4 (Workflow 9A Stage 1b (S)): only while the handoff step is the current step.
    await assertCurrentStepInTx(
      tx,
      { environmentId, inquiryId },
      { kind: 'handoff', action: 'continue-here' },
    );
    await assertStepWaiting(tx, environmentId, { inquiryId, stepId: step.id });
    await revokeLiveToken(tx, environmentId, { inquiryId, stepId: step.id }, now);
    await setInquiryHandoffStepState(tx, environmentId, {
      inquiryId,
      stepId: step.id,
      state: 'continued_here',
      at: now,
    });
    await appendSystemAuditEntry(tx, environmentId, {
      action: 'handoff.continued-here',
      resourceType: 'inquiry-session',
      resourceId: flowSession.id,
      metadata: { 'inquiry-id': inquiryId, 'step-id': step.id },
    });
    // C151.2 (Workflow 9A Stage 1b (S)): the handoff resolved is its step's exit.
    return advanceFlowInTx(
      tx,
      deps,
      { environmentId, inquiryId },
      { kind: 'handoff-resolved', resolution: 'continued-here' },
    );
  });
  await deps.events.dispatch(advanced.staged);
  await runFlowAfterCommit(advanced);
  return currentAnswer('continued_here');
}

/** `GET /flow/handoffs/current`: the handoff state, and after redemption when and on what. */
export async function getCurrentHandoff(
  deps: ApiDependencies,
  flowSession: FlowSession,
): Promise<CurrentHandoffResponse> {
  const { db } = deps;
  const context = await issuingContextOf(db, flowSession);
  if (context.current === null) {
    throw notAvailable();
  }
  const status = servedHandoffState(context.current, context.session);
  if (status !== 'redeemed') {
    return currentAnswer(status);
  }
  const token = await latestHandoffToken(db, flowSession.environmentId, {
    inquiryId: flowSession.inquiryId,
    stepId: context.current.step.id,
  });
  const phone =
    token?.redeemedSessionId == null
      ? null
      : await getInquirySession(db, flowSession.environmentId, token.redeemedSessionId);
  return {
    status,
    'redeemed-at': token?.redeemedAt == null ? null : toTimestamp(token.redeemedAt),
    'os-name': phone?.osName ?? null,
    'browser-name': phone?.browserName ?? null,
  };
}

const OPEN_VERIFICATION_STATUSES: ReadonlySet<string> = new Set(['initiated', 'confirmed']);

/**
 * `POST /flow/handoffs/current/reject`: "this was not me" (P15, V02). Ends the phone's session
 * (`inquiry-session.canceled`), cancels the verifications it created that are still `initiated` or
 * `confirmed` and deletes their files, marks the ones it submitted `from-rejected-handoff` (an
 * inquiry already `completed` goes to `needs_review` now; otherwise `review.ts` sends it there when
 * it completes), and shows the step again (`rejected`).
 */
export async function rejectCurrentHandoff(
  deps: ApiDependencies,
  flowSession: FlowSession,
): Promise<CurrentHandoffResponse> {
  const { db, clock, events } = deps;
  const { environmentId, inquiryId } = flowSession;
  const caller = await getInquirySession(db, environmentId, flowSession.id);
  // A phone (a session a handoff created) never rejects; only a desktop session does.
  if (caller?.handoffFromSessionId !== null) {
    throw notRedeemed();
  }
  const now = clock.now();
  const result = await db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, inquiryId);
    // C151.4 (Workflow 9A Stage 1b (S)): a rejection reaches the flow's handoff step only.
    await assertCurrentStepInTx(
      tx,
      { environmentId, inquiryId },
      { kind: 'handoff', action: 'reject' },
    );
    const inquiry = await findInquiry(tx, environmentId, inquiryId);
    const flow = await pinnedFlowOf(tx, inquiry);
    const stored = await listInquiryHandoffSteps(tx, environmentId, inquiryId);
    const step = handoffStepsOf(flow).find(
      (each) => stored.find((row) => row.stepId === each.id)?.state === 'redeemed',
    );
    if (step === undefined) {
      throw notRedeemed();
    }
    const token = await latestHandoffToken(tx, environmentId, { inquiryId, stepId: step.id });
    const phoneId = token?.redeemedSessionId ?? null;
    const rejected =
      phoneId === null ? null : await rejectHandoffSession(tx, environmentId, phoneId, now);
    if (phoneId === null || rejected === null) {
      throw notRedeemed();
    }
    const staged: StagedEvent[] = [];
    const storageKeys: string[] = [];
    if (rejected.canceled) {
      staged.push(
        ...(await stageSessionEvents(
          tx,
          events,
          'inquiry-session.canceled',
          [rejected.session],
          now,
        )),
      );
    }
    const created = (await listInquiryVerifications(tx, environmentId, inquiryId)).filter(
      (verification) => verification.createdBySessionId === phoneId,
    );
    const open = created.filter((verification) =>
      OPEN_VERIFICATION_STATUSES.has(verification.status),
    );
    const files = await listVerificationFiles(
      tx,
      environmentId,
      open.map((verification) => verification.id),
    );
    const fileIds = await fileIdsByVerification(
      tx,
      environmentId,
      open.map((verification) => verification.id),
    );
    for (const verification of open) {
      const canceled = await cancelSubResources(tx, events, verification);
      staged.push(...canceled.staged);
      storageKeys.push(...canceled.storageKeys);
      const moved = await moveVerification(tx, verification, 'canceled', now);
      if (moved?.event != null) {
        staged.push(
          await stageVerificationEvent(
            tx,
            events,
            moved.event,
            { ...moved.verification, checks: verification.checks },
            fileIds.get(verification.id) ?? [],
          ),
        );
      }
    }
    const finished = created.filter(
      (verification) =>
        !OPEN_VERIFICATION_STATUSES.has(verification.status) && verification.status !== 'canceled',
    );
    const marked = await markVerificationsFromRejectedHandoff(
      tx,
      environmentId,
      finished.map((verification) => verification.id),
    );
    let reviewed = false;
    if (marked.length > 0 && inquiry.status === 'completed') {
      const moved = await transitionInquiryInTx(tx, deps, inquiry, 'needs_review');
      if (moved !== null) {
        staged.push(...moved.staged);
        storageKeys.push(...moved.storageKeys);
        reviewed = true;
        await appendSystemAuditEntry(tx, environmentId, {
          action: HANDOFF_REVIEW_AUDIT_ACTION,
          resourceType: 'inquiry',
          resourceId: inquiryId,
          metadata: { cause: 'handoff_rejected' },
        });
      }
    }
    await setInquiryHandoffStepState(tx, environmentId, {
      inquiryId,
      stepId: step.id,
      state: 'rejected',
      at: now,
    });
    await appendSystemAuditEntry(tx, environmentId, {
      action: 'handoff.rejected',
      resourceType: 'inquiry-session',
      resourceId: phoneId,
      metadata: {
        'inquiry-id': inquiryId,
        'issuing-session-id': flowSession.id,
        'step-id': step.id,
        'canceled-verifications': open.length,
        'marked-verifications': marked.length,
        review: reviewed,
      },
    });
    // C135.3 (V19, Workflow 8B (F); `api-case-files`): the canceled files' rendition pages, whose
    // objects go after the commit with the files'.
    storageKeys.push(
      ...(await deleteRenditionsForFilesInTx(tx, {
        environmentId,
        fileIds: files.map((file) => file.id),
      })),
    );
    // C151.2 (Workflow 9A Stage 1b (S)): the rejection resolves the handoff step.
    const advanced = await advanceFlowInTx(
      tx,
      deps,
      { environmentId, inquiryId },
      { kind: 'handoff-resolved', resolution: 'rejected' },
    );
    staged.push(...advanced.staged);
    return { staged, storageKeys, files, advanced };
  });
  await events.dispatch(result.staged);
  await runFlowAfterCommit(result.advanced);
  await deleteObjects(deps, environmentId, result, now);
  return currentAnswer('rejected');
}

/** Deletes the objects of the canceled verifications' files and captures, best effort. */
async function deleteObjects(
  deps: ApiDependencies,
  environmentId: string,
  result: { storageKeys: string[]; files: { id: string; storageKey: string }[] },
  at: Date,
): Promise<void> {
  for (const key of result.storageKeys) {
    try {
      await deps.storage.delete(key);
    } catch {
      // A capture's object left behind is swept with its inquiry (C16).
    }
  }
  const deleted: string[] = [];
  for (const file of result.files) {
    try {
      await deps.storage.delete(file.storageKey);
      deleted.push(file.id);
    } catch {
      // Left unmarked, so the C16 purge deletes it later.
    }
  }
  await markFilesDeleted(deps.db, environmentId, deleted, at);
}

/** A live token and its open inquiry, or `null`: every failure is the same to the caller (P28). */
interface LiveToken {
  token: HandoffToken;
  inquiry: Inquiry;
}

function isLive(token: HandoffToken, now: Date): boolean {
  return (
    token.redeemedAt === null &&
    token.revokedAt === null &&
    token.expiresAt.getTime() > now.getTime()
  );
}

async function liveTokenOf(
  db: Db,
  body: { 'inquiry-id': string; 'handoff-token': string },
  now: Date,
): Promise<LiveToken | null> {
  const digest = hashSessionToken(body['handoff-token']);
  const token = await findHandoffTokenByHash(db, digest);
  if (
    token === null ||
    !sameDigest(token.tokenHash, digest) ||
    token.inquiryId !== body['inquiry-id'] ||
    !isLive(token, now)
  ) {
    return null;
  }
  const inquiry = await getInquiry(db, token.environmentId, token.inquiryId);
  if (
    inquiry === null ||
    !isInquiryOpen(inquiry) ||
    inquiry.redactedAt !== null ||
    inquiry.expiresAt.getTime() <= now.getTime()
  ) {
    return null;
  }
  return { token, inquiry };
}

/** Whether `code` is the token's confirmation code; always true for a token without one. */
function codeMatches(token: HandoffToken, rawToken: string, code: string | undefined): boolean {
  if (token.confirmationCodeHash === null) {
    return true;
  }
  return (
    code !== undefined && sameDigest(handoffCodeHash(rawToken, code), token.confirmationCodeHash)
  );
}

/** C96.5: counts a wrong code; the fifth revokes the token. */
async function countWrongCode(
  deps: ApiDependencies,
  token: HandoffToken,
  now: Date,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const attempts = await recordHandoffCodeAttempt(tx, token.environmentId, token.id);
    if (attempts >= HANDOFF_CODE_ATTEMPTS) {
      await revokeHandoffToken(tx, token.environmentId, token.id, { at: now });
    }
  });
}

/** `POST /flow/handoffs/preview`: the context screen's facts, consuming nothing (P15, V16). */
export async function previewHandoff(
  deps: ApiDependencies,
  body: PreviewHandoffBody,
): Promise<PreviewHandoffResponse> {
  const { db, clock } = deps;
  const now = clock.now();
  const live = await liveTokenOf(db, body, now);
  if (live === null) {
    throw invalidToken();
  }
  const { token, inquiry } = live;
  const code = body['confirmation-code'];
  const codeRequired = token.confirmationCodeHash !== null;
  let codeAccepted = false;
  if (codeRequired && code !== undefined) {
    if (!codeMatches(token, body['handoff-token'], code)) {
      await countWrongCode(deps, token, now);
      throw invalidToken();
    }
    codeAccepted = true;
  }
  const environment = await environmentOf(db, token.environmentId);
  const flow = await pinnedFlowOf(db, inquiry);
  let context: PreviewHandoffResponse['context'] = null;
  if (token.destinationConfirmed || codeAccepted) {
    const full = await handoffContextOf(db, {
      environment,
      flow,
      stepId: token.stepId,
      environmentId: token.environmentId,
      issuingSessionId: token.issuingSessionId,
    });
    context = {
      steps: full.steps,
      'started-at': full['started-at'],
      'issuing-country-code': full['issuing-country-code'],
      attribution: full.attribution,
    };
  }
  await appendSystemAuditEntry(db, token.environmentId, {
    action: 'handoff.previewed',
    resourceType: 'handoff',
    resourceId: token.id,
    metadata: { 'inquiry-id': token.inquiryId, method: token.method },
  });
  return {
    'organization-display-name': await organizationDisplayNameOf(db, environment),
    method: token.method,
    'confirmation-code-required': codeRequired,
    context,
  };
}

/** The token re-read under its lock, still live, or the uniform 410. */
async function lockLiveToken(tx: Db, token: HandoffToken, now: Date): Promise<HandoffToken> {
  const locked = await lockHandoffToken(tx, token.environmentId, token.id);
  if (locked === null || !isLive(locked, now)) {
    throw invalidToken();
  }
  return locked;
}

/** Re-reads the inquiry of a token under its lock: open, unredacted, unexpired, or the 410. */
async function lockTokenInquiry(tx: Db, token: HandoffToken, now: Date): Promise<Inquiry> {
  await lockInquiry(tx, token.environmentId, token.inquiryId);
  const inquiry = await getInquiry(tx, token.environmentId, token.inquiryId);
  if (
    inquiry === null ||
    !isInquiryOpen(inquiry) ||
    inquiry.redactedAt !== null ||
    inquiry.expiresAt.getTime() <= now.getTime()
  ) {
    throw invalidToken();
  }
  return inquiry;
}

/** `POST /flow/handoffs/decline`: the phone's decline before redemption (V04). */
export async function declineHandoff(
  deps: ApiDependencies,
  body: DeclineHandoffBody,
): Promise<void> {
  const { db, clock } = deps;
  const now = clock.now();
  const live = await liveTokenOf(db, body, now);
  if (live === null) {
    throw invalidToken();
  }
  const { token } = live;
  const advanced = await db.transaction(async (tx) => {
    await lockTokenInquiry(tx, token, now);
    const ref = { environmentId: token.environmentId, inquiryId: token.inquiryId };
    // C151.4 (Workflow 9A Stage 1b (S)): a decline reaches the flow's handoff step only.
    await assertCurrentStepInTx(tx, ref, { kind: 'handoff', action: 'decline' });
    await lockLiveToken(tx, token, now);
    if (
      (await revokeHandoffToken(tx, token.environmentId, token.id, { at: now, declined: true })) ===
      null
    ) {
      throw invalidToken();
    }
    await setInquiryHandoffStepState(tx, token.environmentId, {
      inquiryId: token.inquiryId,
      stepId: token.stepId,
      state: 'declined',
      at: now,
    });
    await appendSystemAuditEntry(tx, token.environmentId, {
      action: 'handoff.declined',
      resourceType: 'handoff',
      resourceId: token.id,
      metadata: { 'inquiry-id': token.inquiryId, method: token.method },
    });
    // C151.2 (Workflow 9A Stage 1b (S)): the decline resolves the handoff step.
    return advanceFlowInTx(tx, deps, ref, { kind: 'handoff-resolved', resolution: 'declined' });
  });
  await deps.events.dispatch(advanced.staged);
  await runFlowAfterCommit(advanced);
}

/** C96.7: the phone's distance facts against the issuing session, from both evaluations. */
export async function recordDistanceFacts(
  db: Db,
  environmentId: string,
  phoneId: string,
  issuingId: string,
): Promise<void> {
  const networks = await listSessionNetworks(db, environmentId, [issuingId, phoneId]);
  const side = (sessionId: string) => {
    const network = networks.find((each) => each.inquirySessionId === sessionId);
    return network === undefined
      ? null
      : {
          countryCode: network.countryCode,
          asn: network.asn,
          latitude: network.location?.latitude ?? null,
          longitude: network.location?.longitude ?? null,
        };
  };
  await recordHandoffDistanceFacts(
    db,
    environmentId,
    phoneId,
    handoffDistanceFacts(side(issuingId), side(phoneId)),
  );
}

/**
 * `POST /flow/handoffs/redeem`: a new session for the phone, on Continue. The token is checked
 * first; then, under the inquiry's lock and the token's, the session cap (C91.5, P28); then the
 * session is created with its handoff fields and the token marked redeemed, so of two racing
 * redemptions one wins. After the commit the session's start is recorded with the phone's address
 * and agent (C93.2: its network facts and parsed device) and its distance facts (C96.7); either
 * failing leaves the start to the phone's first flow call, so the redemption still answers.
 */
export async function redeemHandoff(
  deps: ApiDependencies,
  body: RedeemHandoffBody,
  client: HandoffClient,
): Promise<RedeemHandoffResponse> {
  const { db, clock, ids } = deps;
  const now = clock.now();
  const live = await liveTokenOf(db, body, now);
  if (live === null) {
    throw invalidToken();
  }
  const { token } = live;
  if (!codeMatches(token, body['handoff-token'], body['confirmation-code'])) {
    await countWrongCode(deps, token, now);
    throw invalidToken();
  }
  const sessionToken = newSessionToken();
  const outcome = await db.transaction(async (tx) => {
    const inquiry = await lockTokenInquiry(tx, token, now);
    const ref = { environmentId: token.environmentId, inquiryId: token.inquiryId };
    // C151.4 (Workflow 9A Stage 1b (S)): a redemption reaches the flow's handoff step only.
    await assertCurrentStepInTx(tx, ref, { kind: 'handoff', action: 'redeem' });
    await lockLiveToken(tx, token, now);
    const settings = await pinnedSettings(tx, inquiry);
    const cap = await assertSessionCapInTx(tx, deps, inquiry, settings);
    if (cap.limited) {
      if (!cap.expired) {
        // Rolls back: the token stays unused.
        throw sessionLimitReached();
      }
      return { limited: cap };
    }
    const until = new Date(now.getTime() + settings['session-expiration-seconds'] * 1000);
    const session = await createHandoffSession(tx, token.environmentId, {
      id: ids.newId('iqse'),
      inquiryId: token.inquiryId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: until,
      method: token.method,
      fromSessionId: token.issuingSessionId,
      redeemedAt: now,
    });
    // FE2 (K9-28): a redemption resumes the inquiry, as a one-time link's does (C151.10).
    await extendExpiryOnResumeInTx(tx, inquiry, now);
    const redeemed = await markHandoffTokenRedeemed(tx, token.environmentId, {
      tokenId: token.id,
      redeemedSessionId: session.id,
      at: now,
    });
    if (redeemed === null) {
      throw invalidToken();
    }
    await setInquiryHandoffStepState(tx, token.environmentId, {
      inquiryId: token.inquiryId,
      stepId: token.stepId,
      state: 'redeemed',
      at: now,
    });
    await appendSystemAuditEntry(tx, token.environmentId, {
      action: 'handoff.redeemed',
      resourceType: 'handoff',
      resourceId: token.id,
      metadata: {
        'inquiry-id': token.inquiryId,
        method: token.method,
        'inquiry-session-id': session.id,
        'issuing-session-id': token.issuingSessionId,
      },
    });
    // C151.2 (Workflow 9A Stage 1b (S)): the redemption resolves the handoff step.
    const advanced = await advanceFlowInTx(tx, deps, ref, {
      kind: 'handoff-resolved',
      resolution: 'redeemed',
    });
    return { session, until, advanced };
  });
  if ('limited' in outcome) {
    await deps.events.dispatch(outcome.limited.staged);
    await deleteCapExpiryObjects(deps.storage, outcome.limited.storageKeys);
    throw sessionLimitReached();
  }
  await deps.events.dispatch(outcome.advanced.staged);
  await runFlowAfterCommit(outcome.advanced);
  const { session } = outcome;
  try {
    await recordSessionStart(deps, session, client);
    await recordDistanceFacts(db, token.environmentId, session.id, token.issuingSessionId);
  } catch {
    // The phone's first flow call records the start (`auth/flow-session.ts`).
  }
  return { 'session-token': sessionToken, 'expires-at': toTimestamp(outcome.until) };
}
