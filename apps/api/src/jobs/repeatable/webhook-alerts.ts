/**
 * C169.6 (S6; Workflow 9B): one `webhook-failure-alerts` pass, every 60 seconds. Per webhook whose
 * failure alert is on (`webhooks.failure_alert_enabled`): when at least `threshold` first attempts
 * failed within `window_minutes`, and the last alert (`failure_alert_notified_at`) is older than the
 * window, it notifies the users who opted in (`notification_preferences`) and hold `webhooks:read` in
 * that environment: a console notification (`createWebhookFailureNotifications`) and, when the mailer
 * is configured and the user chose email, a link-only email through the `webhook_alert_emails` outbox
 * (plan outcome 21). An alert counts failed first attempts and says so (C169.10).
 *
 * - The window is `(now - window-minutes, now]`, over first attempts only: a delivery counts once,
 *   whatever its retries did. The scan reads deliveries created at most a day before the window
 *   (`WEBHOOK_ALERT_CREATED_SLACK_MS`, the retry schedule's span; provisional), so a first attempt
 *   delayed by more than a day after its delivery was written is not counted.
 * - The claim of an alert (`failure_alert_notified_at`), the notifications and the outbox rows are one
 *   transaction per webhook; the emails are sent after it commits, never inside it.
 * - An email is a fixed sentence and a link to the webhook's console page, never the webhook's URL,
 *   name or a count; without the console's public URL it names no webhook. It goes under the
 *   environment's `mail-sender-name` (C169.8), to a user still active, still holding `webhooks:read`
 *   there and still choosing email (read at send). Without an SMTP server nothing is queued, and what
 *   was queued is dropped (logged as a count). A send is tried at most three times, under a lease.
 * - The log holds counts and error names, never an address.
 *
 * Owner: `api-keys-webhooks`; `foundation-9b` (W) placed the signature and the worker's registration
 * (`webhookAlertRepeatableJobs`).
 */
import { newId, resolvePlatformSettings } from '@openverify/contracts';
import {
  claimWebhookAlertEmails,
  countFailedFirstAttempts,
  createWebhookFailureNotifications,
  deleteWebhookAlertEmails,
  getEnvironment,
  listWebhookAlertRecipients,
  listWebhookFailureAlertCandidates,
  markWebhookFailureAlertedInTx,
  queueWebhookAlertEmails,
  WEBHOOK_ALERT_EMAIL_ATTEMPTS,
  webhookAlertEmailAddress,
  type Db,
  type WebhookAlertEmail,
  type WebhookFailureAlertCandidate,
} from '@openverify/db';
import type { Clock, Mailer, MailMessage } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';
import { WEBHOOK_FAILURE_ALERTS_QUEUE } from '../webhook-alert-queues.js';

/** What one pass reads. */
export interface WebhookFailureAlertDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** The worker's mailer; without one (or unconfigured) no email is sent. */
  mailer?: Mailer | undefined;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`, resolved: the base of the email's link. */
  dashboardPublicUrl?: string | undefined;
}

/** What one pass did: counts only. */
export interface WebhookFailureAlertResult {
  /** Webhooks alerted about in this pass. */
  alerted: number;
  /** Console notifications written. */
  notifications: number;
  /** Emails queued in the outbox. */
  emailsQueued: number;
  /** Emails sent from the outbox in this pass. */
  emailsSent: number;
}

export type RunWebhookFailureAlerts = (
  deps: WebhookFailureAlertDeps,
) => Promise<WebhookFailureAlertResult>;

/** Candidates read per page. Provisional: alerts are set per webhook, a handful per environment. */
export const WEBHOOK_ALERT_PAGE = 500;
/** How far before the window a delivery may have been written (the retry schedule's 24 hours). */
export const WEBHOOK_ALERT_CREATED_SLACK_MS = 86_400_000;
/** Emails a pass sends at most. Provisional: one per watcher of a failing webhook. */
export const WEBHOOK_ALERT_EMAIL_BATCH = 100;
/** How long a claim holds an email: past the SMTP timeouts, as the case emails. */
export const WEBHOOK_ALERT_EMAIL_LEASE_MS = 5 * 60_000;

const SUBJECT = 'A webhook is failing in OpenVerify';
const SENTENCE =
  'First delivery attempts to one of your webhooks failed at or above its alert threshold ' +
  'within its alert window. The alert counts failed first attempts only, not retries.';

/** `url` with no `/` at its end, by a walk rather than a pattern. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') {
    end -= 1;
  }
  return url.slice(0, end);
}

/** The message: a fixed sentence and a link, nothing of the webhook's configuration. */
export function webhookAlertMessage(
  address: string,
  email: Pick<WebhookAlertEmail, 'webhookId'>,
  dashboardPublicUrl: string | undefined,
  senderName: string | null,
): MailMessage {
  const where =
    dashboardPublicUrl === undefined
      ? 'Sign in to the OpenVerify console to see it.'
      : `Open the webhook: ${withoutTrailingSlashes(dashboardPublicUrl)}/webhooks/${email.webhookId}`;
  return { to: { address }, subject: SUBJECT, text: `${SENTENCE}\n\n${where}\n`, senderName };
}

/** Alerts about one candidate when its failed first attempts reach the threshold. */
async function alertOne(
  deps: WebhookFailureAlertDeps,
  candidate: WebhookFailureAlertCandidate,
  now: Date,
  mailing: boolean,
): Promise<{ alerted: boolean; notifications: number; emailsQueued: number }> {
  const from = new Date(now.getTime() - candidate.windowMinutes * 60_000);
  const failed = await countFailedFirstAttempts(
    deps.db,
    candidate.environmentId,
    candidate.webhookId,
    { from, to: now, createdFrom: new Date(from.getTime() - WEBHOOK_ALERT_CREATED_SLACK_MS) },
  );
  if (failed < candidate.threshold) {
    return { alerted: false, notifications: 0, emailsQueued: 0 };
  }
  return deps.db.transaction(async (tx) => {
    const { environmentId, webhookId } = candidate;
    if (!(await markWebhookFailureAlertedInTx(tx, environmentId, webhookId, now))) {
      return { alerted: false, notifications: 0, emailsQueued: 0 };
    }
    const recipients = await listWebhookAlertRecipients(tx, environmentId);
    const written = await createWebhookFailureNotifications(
      tx,
      environmentId,
      recipients
        .filter((recipient) => recipient.console)
        .map(({ userId }) => ({ id: newId('unot'), userId, webhookId })),
    );
    const emailsQueued = mailing
      ? await queueWebhookAlertEmails(
          tx,
          environmentId,
          recipients
            .filter((recipient) => recipient.email)
            .map(({ userId }) => ({ userId, webhookId })),
        )
      : 0;
    return { alerted: true, notifications: written.length, emailsQueued };
  });
}

/** Sends the outbox's emails, after the alerts' transactions committed. */
async function sendEmails(deps: WebhookFailureAlertDeps, now: Date): Promise<number> {
  const claimed = await deps.db.transaction((tx) =>
    claimWebhookAlertEmails(tx, {
      now,
      leaseMs: WEBHOOK_ALERT_EMAIL_LEASE_MS,
      limit: WEBHOOK_ALERT_EMAIL_BATCH,
    }),
  );
  if (claimed.length === 0) {
    return 0;
  }
  const { mailer } = deps;
  if (mailer?.configured !== true) {
    await deleteWebhookAlertEmails(
      deps.db,
      claimed.map(({ id }) => id),
    );
    deps.logger.warn(
      { dropped: claimed.length },
      'webhook failure alert emails not sent: no SMTP server is set',
    );
    return 0;
  }
  const senderNames = new Map<string, string | null>();
  const senderNameOf = async (environmentId: string) => {
    if (!senderNames.has(environmentId)) {
      const environment = await getEnvironment(deps.db, environmentId);
      senderNames.set(
        environmentId,
        resolvePlatformSettings(environment?.settings ?? {})['mail-sender-name'],
      );
    }
    return senderNames.get(environmentId) ?? null;
  };
  const done: number[] = [];
  let sent = 0;
  let skipped = 0;
  let givenUp = 0;
  for (const email of claimed) {
    const address = await webhookAlertEmailAddress(deps.db, email);
    if (address === null) {
      skipped += 1;
      done.push(email.id);
      continue;
    }
    try {
      await mailer.send(
        webhookAlertMessage(
          address,
          email,
          deps.dashboardPublicUrl,
          await senderNameOf(email.environmentId),
        ),
      );
      sent += 1;
      done.push(email.id);
    } catch (error) {
      deps.logger.warn(
        { attempt: email.attempts, error: error instanceof Error ? error.name : 'unknown' },
        'webhook failure alert email not sent',
      );
      if (email.attempts >= WEBHOOK_ALERT_EMAIL_ATTEMPTS) {
        givenUp += 1;
        done.push(email.id);
      }
    }
  }
  await deleteWebhookAlertEmails(deps.db, done);
  if (givenUp > 0) {
    deps.logger.error({ givenUp }, 'webhook failure alert emails given up after three attempts');
  }
  if (sent + skipped > 0) {
    deps.logger.info({ sent, skipped }, 'webhook failure alert emails');
  }
  return sent;
}

export const runWebhookFailureAlerts: RunWebhookFailureAlerts = async (deps) => {
  const now = deps.clock.now();
  const mailing = deps.mailer?.configured === true;
  const result: WebhookFailureAlertResult = {
    alerted: 0,
    notifications: 0,
    emailsQueued: 0,
    emailsSent: 0,
  };
  let after: string | undefined;
  for (;;) {
    const page = await listWebhookFailureAlertCandidates(deps.db, {
      now,
      after,
      limit: WEBHOOK_ALERT_PAGE,
    });
    for (const candidate of page) {
      const outcome = await alertOne(deps, candidate, now, mailing);
      result.alerted += outcome.alerted ? 1 : 0;
      result.notifications += outcome.notifications;
      result.emailsQueued += outcome.emailsQueued;
    }
    if (page.length < WEBHOOK_ALERT_PAGE) {
      break;
    }
    after = page.at(-1)?.webhookId;
  }
  result.emailsSent = await sendEmails(deps, now);
  if (result.alerted > 0) {
    deps.logger.info({ queue: WEBHOOK_FAILURE_ALERTS_QUEUE, ...result }, 'webhook failure alerts');
  }
  return result;
};
