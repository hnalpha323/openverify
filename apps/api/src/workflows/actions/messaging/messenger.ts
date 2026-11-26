/**
 * C126.8: the {@link WorkflowMessenger}. Every message any action sends comes through here, rendered,
 * and each is checked in the same order: who may receive it, what it may hold, the budgets (which fail
 * closed), and only then the send. So a refusal consumes no budget, and an audit entry written by
 * `beforeSend` always records a send.
 *
 * C126.5: nothing here says "sent". `accepted` means the provider took it, `recorded` that a sandbox
 * provider kept it, and `unknown` that the outcome is not known, which a resume stops at. A retry
 * follows proof of non-delivery alone: anything else is `unknown`. An adapter's failure holds a code,
 * and no address, URL or body reaches an error here (C53.8).
 *
 * The at-most-once effect itself is the engine's: an `at-most-once` step's effect row is claimed before
 * its handler runs and released on a `failed` answer (C117.5), so what this file owes it is the truth
 * about whether anything left. `effect` names the step for the sandbox record and is `null` only for a
 * message no run sends.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { validateEmailDestination, validatePhoneDestination } from '@openverify/checks';
import { OTP_LIMITS, OTP_SMS_PREFIX_DIGITS } from '@openverify/contracts';
import {
  getEnvironment,
  getWorkflowSecret,
  openWorkflowSecretValue,
  otpDestinationIndex,
  resolveOtpSmsMaxPerHour,
  resolveWorkflowSettings,
  type WorkflowSecret,
  type WorkflowSettings,
} from '@openverify/db';
import {
  MESSAGE_LIMITS,
  SLACK_WEBHOOK_HOST,
  SLACK_WEBHOOK_PATH,
  type MessageOutput,
} from '@openverify/workflow-engine/actions';
import { MailerNotConfiguredError } from '../../../mail/index.js';
import type { SandboxMailer, WorkflowMailBinding } from '../../../mail/sandbox.js';
import {
  SlackSendError,
  SmsSendError,
  type Clock,
  type KeyValueCache,
  type Mailer,
  type MailMessage,
  type ProviderBindings,
  type RateLimiter,
  type RateLimitRule,
} from '../../../ports.js';
import { SLACK_OUTCOME_UNKNOWN } from '../../../providers/slack/index.js';
import type { ApiDependencies } from '../../../services/context.js';
import { ActionStepError } from '../../engine/action-port.js';
import { consumeBudget, workflowPolicyRule } from '../https/budgets.js';
import { hostIsListed, normalizeHostOf } from '../https/hosts.js';
import { createScrubber } from '../https/scrub.js';
import { messageLinksAllowed } from './links.js';
import type {
  WorkflowEmailMessage,
  WorkflowMessage,
  WorkflowMessageContext,
  WorkflowMessageRecipientBasis,
  WorkflowMessenger,
  WorkflowSlackMessage,
  WorkflowSmsMessage,
} from './port.js';
import { SandboxSinkUnavailableError, recordSandboxMessage } from './sandbox-messages.js';
import { fromEnvironment } from '../../../mail/sender-name.js';

/** What a message reaches: the install's adapters and limits, never a service of the API process. */
export interface WorkflowMessengerDeps {
  db: ApiDependencies['db'];
  keyring: ApiDependencies['keyring'];
  blindIndexKey: ApiDependencies['blindIndexKey'];
  providers: ProviderBindings;
  mail: WorkflowMailBinding;
  rateLimiter: RateLimiter;
  cache: KeyValueCache;
  clock: Clock;
}

/** V12: an install-level key, so a limit keys one address across environments, and names none. */
const RECIPIENT_LABEL = 'openverify/workflow-recipient/v1';
/** C126.2: a workflow may use at most this share of the environment's SMS budget. */
const WORKFLOW_SMS_BUDGET_SHARE = 0.5;
/** C126.3: 1 a second with a burst of 3, which a window of 3 s for 3 holds. */
const SLACK_RULE: RateLimitRule = { name: 'workflow-slack', limit: 3, windowSeconds: 3 };

const SMTP_PROVIDER = 'smtp';
const SANDBOX_PROVIDER = 'sandbox';

const refused = (code: string): ActionStepError => new ActionStepError(code);
const tooLarge = (): ActionStepError => refused('payload_too_large');
const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

async function settingsOf(
  deps: WorkflowMessengerDeps,
  environmentId: string,
): Promise<{
  workflow: WorkflowSettings;
  smsPerHour: number;
  settings: Readonly<Record<string, unknown>>;
}> {
  const environment = await getEnvironment(deps.db, environmentId);
  if (environment === null) {
    throw refused('execution_error');
  }
  return {
    workflow: resolveWorkflowSettings(environment.settings),
    smsPerHour: resolveOtpSmsMaxPerHour(environment.settings),
    settings: environment.settings as Readonly<Record<string, unknown>>,
  };
}

const messageRefs = new WeakMap<WorkflowMessageContext, string>();

/** A deterministic reference for a run's message, so a sandbox provider stays deterministic. */
function messageRefOf(context: WorkflowMessageContext): string {
  const held = messageRefs.get(context);
  if (held !== undefined) {
    return held;
  }
  const seed = context.effect?.effectKey ?? randomUUID();
  const ref = `msg_${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
  messageRefs.set(context, ref);
  return ref;
}

function recordOriginOf(context: WorkflowMessageContext) {
  return {
    environmentId: context.environmentId,
    workflowRunId: context.effect?.runId ?? null,
    stepId: context.effect?.stepId ?? 'none',
    messageRef: messageRefOf(context),
  };
}

const recorded = (context: WorkflowMessageContext): MessageOutput => ({
  delivery: 'recorded',
  provider: SANDBOX_PROVIDER,
  sandbox: true,
  'message-ref': messageRefOf(context),
});

const unknown = (provider: string): MessageOutput => ({
  delivery: 'unknown',
  provider,
  sandbox: false,
  'message-ref': null,
});

const accepted = (provider: string, messageRef: string | null): MessageOutput => ({
  delivery: 'accepted',
  provider,
  sandbox: false,
  'message-ref': messageRef,
});

/** Nothing could be kept: nothing went out, and nothing reads as recorded. */
async function recordingOrRefused(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof SandboxSinkUnavailableError) {
      throw new ActionStepError('sandbox_sink_unavailable', { retryable: true });
    }
    throw error;
  }
}

/** C126.1, C126.2: an allowlisted recipient, a confirmed one, or an acknowledged unconfirmed field. */
function recipientAllowed(
  basis: WorkflowMessageRecipientBasis,
  allowUnconfirmed: boolean,
  listed: boolean,
): boolean {
  return listed || basis === 'confirmed' || (basis === 'unconfirmed' && allowUnconfirmed);
}

/** C126.1: an entry is an address, or a whole domain, compared through the one host normaliser. */
function emailListed(address: string, domain: string, list: readonly string[]): boolean {
  return list.some((entry) =>
    entry.includes('@') ? entry.toLowerCase() === address : hostIsListed(domain, [entry]),
  );
}

const installRecipientKey = (blindIndexKey: Uint8Array, address: string): string => {
  const subkey = createHmac('sha256', blindIndexKey).update(RECIPIENT_LABEL).digest();
  return createHmac('sha256', subkey).update(address).digest('hex');
};

const SUBJECT_BREAKS = /[\r\n]/g;

function emailBody(message: WorkflowEmailMessage): MailMessage & { to: { address: string } } {
  const subject = message.subject.replace(SUBJECT_BREAKS, '');
  if (
    subject.length > MESSAGE_LIMITS['email-subject-characters'].value ||
    utf8Bytes(message.text) > MESSAGE_LIMITS['email-text-bytes'].value ||
    utf8Bytes(message.html ?? '') > MESSAGE_LIMITS['email-html-bytes'].value
  ) {
    throw tooLarge();
  }
  return {
    to: { address: message.to },
    subject,
    text: message.text,
    ...(message.html === null ? {} : { html: message.html }),
  };
}

const flowHostOf = (flowLink: string | null): readonly string[] => {
  if (flowLink === null || !URL.canParse(flowLink)) {
    return [];
  }
  const host = normalizeHostOf(new URL(flowLink));
  return host === null ? [] : [host];
};

/** C126.5: SMTP says nothing was taken only before DATA. */
const BEFORE_DATA: ReadonlySet<string> = new Set(['MAIL FROM', 'RCPT TO']);

/** The failure of a send: a refusal when nothing went out, or `null` when that is not known. */
function mailRefusal(error: unknown): ActionStepError | null {
  if (error instanceof MailerNotConfiguredError) {
    return refused('provider_not_configured');
  }
  const { code, command, responseCode } = error as {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
  };
  if (code === 'ECONNREFUSED' || code === 'EDNS') {
    return new ActionStepError('smtp_unavailable', { retryable: true });
  }
  if (typeof command !== 'string' || !BEFORE_DATA.has(command)) {
    return null;
  }
  if (typeof responseCode === 'number' && responseCode >= 400 && responseCode <= 499) {
    return new ActionStepError('smtp_unavailable', { retryable: true });
  }
  return typeof responseCode === 'number' && responseCode >= 500 && responseCode <= 599
    ? refused('smtp_rejected')
    : null;
}

async function deliverMail(mailer: Mailer, message: MailMessage): Promise<MessageOutput> {
  try {
    await mailer.send(message);
  } catch (error) {
    const refusal = mailRefusal(error);
    if (refusal === null) {
      return unknown(SMTP_PROVIDER);
    }
    throw refusal;
  }
  return accepted(SMTP_PROVIDER, null);
}

async function consumeEmailBudgets(
  deps: WorkflowMessengerDeps,
  environmentId: string,
  address: string,
): Promise<void> {
  const hashed = installRecipientKey(deps.blindIndexKey, address);
  const scoped = `${environmentId}|${hashed}`;
  await consumeBudget(
    deps.rateLimiter,
    scoped,
    workflowPolicyRule('workflow-email-recipient-hour'),
  );
  await consumeBudget(deps.rateLimiter, scoped, workflowPolicyRule('workflow-email-recipient-day'));
  await consumeBudget(deps.rateLimiter, environmentId, workflowPolicyRule('workflow-email'));
  await consumeBudget(deps.rateLimiter, hashed, workflowPolicyRule('workflow-email-install'));
}

/** Decision 40: in a sandbox, only a listed address with an SMTP server goes out for real. */
function realMailerFor(
  mail: WorkflowMailBinding,
  context: WorkflowMessageContext,
  listed: boolean,
): Mailer | null {
  if (context.environmentKind === 'production') {
    return mail.production;
  }
  return listed && mail.production.configured ? mail.production : null;
}

async function recordMail(
  deps: WorkflowMessengerDeps,
  sandbox: SandboxMailer,
  context: WorkflowMessageContext,
  message: MailMessage,
  normalized: string,
): Promise<MessageOutput> {
  const { text: scrub } = createScrubber(context.scrub);
  const { environmentId, workflowRunId, stepId, messageRef } = recordOriginOf(context);
  await recordingOrRefused(() =>
    sandbox.send(
      {
        ...message,
        subject: scrub(message.subject),
        text: scrub(message.text),
        ...(message.html === undefined ? {} : { html: scrub(message.html) }),
      },
      {
        environmentId,
        workflowRunId,
        stepId,
        messageRef,
        recipientIndex: otpDestinationIndex(deps.blindIndexKey, {
          environmentId,
          channel: 'email',
          destination: normalized,
        }),
      },
    ),
  );
  return recorded(context);
}

async function sendEmail(
  deps: WorkflowMessengerDeps,
  message: WorkflowEmailMessage,
  context: WorkflowMessageContext,
): Promise<MessageOutput> {
  const { workflow, settings } = await settingsOf(deps, context.environmentId);
  const destination = validateEmailDestination(message.to);
  if (!destination.ok) {
    throw refused('recipient_not_allowed');
  }
  const { address, domain, normalized } = destination;
  const listed = emailListed(normalized, domain, workflow['workflow-email-recipients']);
  if (!recipientAllowed(message.basis, message.allowUnconfirmed, listed)) {
    throw refused('recipient_not_allowed');
  }
  const mail = { ...emailBody(message), to: { address } };
  const rules = {
    hosts: [...workflow['workflow-link-hosts'], ...flowHostOf(context.flowLink)],
    exact: context.flowLink === null ? [] : [context.flowLink],
  };
  const parts = [mail.subject, mail.text, ...(mail.html === undefined ? [] : [mail.html])];
  if (!parts.every((part) => messageLinksAllowed(part, rules))) {
    throw refused('message_link_refused');
  }
  await consumeEmailBudgets(deps, context.environmentId, normalized);
  const real = realMailerFor(deps.mail, context, listed);
  if (real !== null && !real.configured) {
    throw refused('provider_not_configured');
  }
  await context.beforeSend?.();
  return real === null
    ? recordMail(deps, deps.mail.sandbox, context, mail, normalized)
    : // K9-25 (C169.8): from the environment's sender name.
      deliverMail(real, fromEnvironment(mail, settings));
}

/** C126.2: what a number may be sent to. `null` countries follow the inquiry template. */
function smsCountriesOf(
  workflow: WorkflowSettings,
  message: WorkflowSmsMessage,
): readonly string[] {
  return workflow['workflow-sms-countries'] ?? message.templateCountries ?? [];
}

async function consumeSmsBudgets(
  deps: WorkflowMessengerDeps,
  environmentId: string,
  destination: { e164: string; country: string },
  index: string,
  perHour: number,
): Promise<void> {
  const { rateLimiter } = deps;
  const rule = (name: keyof typeof OTP_LIMITS, limit: number, windowSeconds: number) => ({
    name,
    limit,
    windowSeconds,
  });
  const keyed = `${environmentId}|destination|${index}`;
  const hour = OTP_LIMITS['otp-destination-hour'];
  const day = OTP_LIMITS['otp-destination-day'];
  const prefix = OTP_LIMITS['otp-sms-prefix-hour'];
  const country = OTP_LIMITS['otp-sms-country-hour'];
  const budget = OTP_LIMITS['otp-sms-max-per-hour'];
  const share = (fraction: number) => Math.max(1, Math.floor(perHour * fraction));
  await consumeBudget(
    rateLimiter,
    keyed,
    rule('otp-destination-hour', hour.limit, hour.windowSeconds),
  );
  await consumeBudget(
    rateLimiter,
    keyed,
    rule('otp-destination-day', day.limit, day.windowSeconds),
  );
  await consumeBudget(
    rateLimiter,
    `${environmentId}|prefix|${destination.e164.slice(1, 1 + OTP_SMS_PREFIX_DIGITS)}`,
    rule('otp-sms-prefix-hour', prefix.limit, prefix.windowSeconds),
  );
  await consumeBudget(
    rateLimiter,
    `${environmentId}|country|${destination.country}`,
    rule('otp-sms-country-hour', share(country.budgetShare), country.windowSeconds),
  );
  await consumeBudget(
    rateLimiter,
    `${environmentId}|workflow-budget`,
    rule('otp-sms-max-per-hour', share(WORKFLOW_SMS_BUDGET_SHARE), budget.windowSeconds),
  );
  await consumeBudget(
    rateLimiter,
    `${environmentId}|budget`,
    rule('otp-sms-max-per-hour', share(budget.budgetShare), budget.windowSeconds),
  );
}

const SMS_NOT_SENT: ReadonlySet<string> = new Set(['twilio_rate_limited', 'twilio_dns']);
const SMS_REFUSED: ReadonlySet<string> = new Set([
  'twilio_rejected',
  'twilio_blocked',
  'twilio_invalid_url',
  'twilio_redirect',
  'twilio_not_configured',
]);

function smsRefusal(error: unknown): ActionStepError | null {
  if (!(error instanceof SmsSendError)) {
    return null;
  }
  if (SMS_NOT_SENT.has(error.code)) {
    return new ActionStepError(error.code, { retryable: true });
  }
  return SMS_REFUSED.has(error.code) ? refused(error.code) : null;
}

async function sendSms(
  deps: WorkflowMessengerDeps,
  message: WorkflowSmsMessage,
  context: WorkflowMessageContext,
): Promise<MessageOutput> {
  const { environmentId, environmentKind } = context;
  const { workflow, smsPerHour } = await settingsOf(deps, environmentId);
  const destination = validatePhoneDestination(message.to, {
    allowedCountries: smsCountriesOf(workflow, message),
    allowVoip: true,
  });
  if (!destination.ok) {
    throw refused('recipient_not_allowed');
  }
  const listed = workflow['workflow-sms-recipients'].includes(destination.e164);
  if (!recipientAllowed(message.basis, message.allowUnconfirmed, listed)) {
    throw refused('recipient_not_allowed');
  }
  if (message.text.length > MESSAGE_LIMITS['sms-characters'].value) {
    throw tooLarge();
  }
  const rules = {
    hosts: workflow['workflow-link-hosts'],
    exact: context.flowLink === null ? [] : [context.flowLink],
  };
  if (!messageLinksAllowed(message.text, rules)) {
    throw refused('message_link_refused');
  }
  const sender = deps.providers[environmentKind].sms;
  if (sender === undefined) {
    throw refused('provider_not_configured');
  }
  const index = otpDestinationIndex(deps.blindIndexKey, {
    environmentId,
    channel: 'sms',
    destination: destination.e164,
  });
  await consumeSmsBudgets(deps, environmentId, destination, index, smsPerHour);
  await context.beforeSend?.();
  if (sender.sandbox) {
    const { text: scrub } = createScrubber(context.scrub);
    await recordingOrRefused(() =>
      recordSandboxMessage(deps, 'workflow-sms', {
        ...recordOriginOf(context),
        recipientIndex: index,
        secretId: null,
        message: { text: scrub(message.text) },
      }),
    );
    return recorded(context);
  }
  try {
    const { providerMessageId } = await sender.send({ to: destination.e164, body: message.text });
    return accepted(sender.id, providerMessageId ?? null);
  } catch (error) {
    const refusal = smsRefusal(error);
    if (refusal === null) {
      return unknown(sender.id);
    }
    throw refusal;
  }
}

const secretRefused = (): ActionStepError => refused('secret_placement_refused');

/** C126.3: a parsed URL on `hooks.slack.com`, in the incoming-webhook shape, and nothing else. */
function isSlackWebhookUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.search === '' &&
    url.hash === '' &&
    normalizeHostOf(url) === SLACK_WEBHOOK_HOST &&
    SLACK_WEBHOOK_PATH.test(url.pathname)
  );
}

async function slackSecretOf(
  deps: WorkflowMessengerDeps,
  context: WorkflowMessageContext,
  key: string,
): Promise<WorkflowSecret> {
  const secret = await getWorkflowSecret(deps.db, context.organizationId, key);
  if (secret === null || !hostIsListed(SLACK_WEBHOOK_HOST, secret.allowedHosts)) {
    throw secretRefused();
  }
  return secret;
}

function slackRefusal(error: unknown): ActionStepError | null {
  if (!(error instanceof SlackSendError) || error.code === SLACK_OUTCOME_UNKNOWN) {
    return null;
  }
  if (!error.retryable) {
    return refused(error.code);
  }
  return new ActionStepError(error.code, {
    retryable: true,
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: error.retryAfterSeconds }),
  });
}

async function sendSlack(
  deps: WorkflowMessengerDeps,
  message: WorkflowSlackMessage,
  context: WorkflowMessageContext,
): Promise<MessageOutput> {
  const { environmentId, environmentKind } = context;
  if (message.text.length > MESSAGE_LIMITS['slack-characters'].value) {
    throw tooLarge();
  }
  const sender = deps.providers[environmentKind].slack;
  if (sender === undefined) {
    throw refused('provider_not_configured');
  }
  const secret = await slackSecretOf(deps, context, message.secretKey);
  await consumeBudget(deps.rateLimiter, `${environmentId}|${secret.id}`, SLACK_RULE);
  // Resolved last (C125.5), and read in a sandbox too, so a run there refuses what production would.
  const opened = await openWorkflowSecretValue(deps.db, environmentId, secret.id, deps.clock.now());
  if (opened === null || !isSlackWebhookUrl(opened.value)) {
    throw secretRefused();
  }
  await context.beforeSend?.();
  if (sender.sandbox) {
    const { text: scrub } = createScrubber(context.scrub);
    const { workflowRunId, stepId, messageRef } = recordOriginOf(context);
    await recordingOrRefused(async () => {
      await sender.send(
        { text: scrub(message.text) },
        {
          environmentId,
          secretId: secret.id,
          workflowRunId: workflowRunId ?? '',
          stepId,
          messageRef,
        },
      );
    });
    return recorded(context);
  }
  try {
    await sender.send({ webhookUrl: opened.value, text: message.text });
    return accepted(sender.id, null);
  } catch (error) {
    const refusal = slackRefusal(error);
    if (refusal === null) {
      return unknown(sender.id);
    }
    throw refusal;
  }
}

export function createWorkflowMessenger(deps: WorkflowMessengerDeps): WorkflowMessenger {
  return {
    send(message: WorkflowMessage, context) {
      switch (message.kind) {
        case 'email':
          return sendEmail(deps, message, context);
        case 'sms':
          return sendSms(deps, message, context);
        case 'slack':
          return sendSlack(deps, message, context);
      }
    },
  };
}
