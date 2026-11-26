/**
 * K8-20 (Workflow 8D; C133.7, C134.4, P38, decision 76): `case-notification-emails`, every 30
 * seconds in the worker: the link-only emails the case services queued beside each in-app
 * notification (assigned, mentioned, SLA breached) and for `notify-on-create`, from the
 * `case_notification_emails` outbox written in their transactions.
 *
 * - A message is a fixed sentence and the case's console link, never a comment, a field, a
 *   filename or the case's name; without the console's public URL it goes without its link and
 *   names no case (outcome 37).
 * - It goes only to a user who can still read the case: active, holding `cases:read` and able to
 *   see its template (P38, C129.4); a redacted case is skipped. A skipped email is deleted.
 * - Without an SMTP server nothing is sent, and what was queued is deleted (counted in the log).
 * - A send is tried at most three times in all, each claim held for a lease, so a worker that stops
 *   mid-send leaves it to the next run: at least once, at most three times.
 * - The log holds counts and error names, never an address.
 */
import {
  CASE_NOTIFICATION_EMAIL_ATTEMPTS,
  claimCaseNotificationEmails,
  deleteCaseNotificationEmails,
  getCaseRow,
  getEnvironment,
  hiddenCaseObjectIds,
  roles,
  userRoles,
  users,
  type CaseNotificationEmail,
  type Db,
  roleAssignmentReaches,
} from '@openverify/db';
import type { CaseNotificationEmailKind } from '@openverify/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Clock, Mailer, MailMessage } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';
import { fromEnvironment } from '../../mail/sender-name.js';

export interface CaseNotificationEmailDeps {
  db: Db;
  mailer: Mailer;
  clock: Clock;
  logger: WorkerLogger;
  /** The console's public URL; without it a message goes without its link (outcome 37). */
  dashboardPublicUrl?: string | undefined;
}

export interface CaseNotificationEmailRun {
  sent: number;
  skipped: number;
  failed: number;
}

/** Emails a run takes. Provisional: a review team's notifications of half a minute. */
export const CASE_NOTIFICATION_EMAIL_BATCH = 100;
/** How long a claim holds an email before another run may try it: past the SMTP timeouts. */
export const CASE_NOTIFICATION_EMAIL_LEASE_MS = 5 * 60_000;

const SUBJECTS: Readonly<Record<CaseNotificationEmailKind, string>> = {
  created: 'A new case is waiting in OpenVerify',
  assigned: 'A case was assigned to you in OpenVerify',
  mentioned: 'You were mentioned on a case in OpenVerify',
  'sla-breached': 'A case assigned to you passed its SLA in OpenVerify',
};

/** `url` with no `/` at its end, by a walk rather than a pattern. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') {
    end -= 1;
  }
  return url.slice(0, end);
}

/** The message: a sentence and a link, nothing of the case's content. */
export function caseNotificationMessage(
  address: string,
  email: Pick<CaseNotificationEmail, 'kind' | 'caseId'>,
  dashboardPublicUrl: string | undefined,
): MailMessage {
  const subject = SUBJECTS[email.kind];
  const where =
    dashboardPublicUrl === undefined
      ? 'Sign in to the OpenVerify console to see it.'
      : `Open the case: ${withoutTrailingSlashes(dashboardPublicUrl)}/cases/${email.caseId}`;
  return { to: { address }, subject, text: `${subject}.\n\n${where}\n` };
}

/** The user's address when the user may still read the case, else `null` (P38). */
async function recipientOf(db: Db, email: CaseNotificationEmail): Promise<string | null> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.id, email.userId),
        eq(users.status, 'active'),
        // C167.2 (Workflow 9B): a role reaching the case's environment.
        sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id
          where ur.user_id = ${users.id} and 'cases:read' = any(r.permissions)
            and ${roleAssignmentReaches(sql`ur`, email.environmentId)})`,
      ),
    )
    .limit(1);
  if (user === undefined) {
    return null;
  }
  const row = await getCaseRow(db, email.environmentId, email.caseId);
  if (row?.redactedAt !== null) {
    return null;
  }
  const hidden = await hiddenCaseObjectIds(
    db,
    email.environmentId,
    { kind: 'user', userId: email.userId },
    [email.caseId],
  );
  return hidden.has(email.caseId) ? null : user.email;
}

/** One run of `case-notification-emails`. */
export async function runCaseNotificationEmails(
  deps: CaseNotificationEmailDeps,
): Promise<CaseNotificationEmailRun> {
  const run: CaseNotificationEmailRun = { sent: 0, skipped: 0, failed: 0 };
  const claimed = await deps.db.transaction((tx) =>
    claimCaseNotificationEmails(tx, {
      now: deps.clock.now(),
      leaseMs: CASE_NOTIFICATION_EMAIL_LEASE_MS,
      limit: CASE_NOTIFICATION_EMAIL_BATCH,
    }),
  );
  if (claimed.length === 0) {
    return run;
  }
  if (!deps.mailer.configured) {
    await deleteCaseNotificationEmails(
      deps.db,
      claimed.map(({ id }) => id),
    );
    deps.logger.warn(
      { dropped: claimed.length },
      'case notification emails not sent: no SMTP server is set',
    );
    return { ...run, skipped: claimed.length };
  }
  const settings = new Map<string, Readonly<Record<string, unknown>> | null>();
  const settingsOf = async (environmentId: string) => {
    if (!settings.has(environmentId)) {
      const environment = await getEnvironment(deps.db, environmentId);
      settings.set(
        environmentId,
        (environment?.settings as Readonly<Record<string, unknown>> | undefined) ?? null,
      );
    }
    return settings.get(environmentId) ?? null;
  };
  const done: number[] = [];
  let givenUp = 0;
  for (const email of claimed) {
    const address = await recipientOf(deps.db, email);
    if (address === null) {
      run.skipped += 1;
      done.push(email.id);
      continue;
    }
    try {
      // K9-25 (C169.8): from the environment's sender name.
      await deps.mailer.send(
        fromEnvironment(
          caseNotificationMessage(address, email, deps.dashboardPublicUrl),
          await settingsOf(email.environmentId),
        ),
      );
      run.sent += 1;
      done.push(email.id);
    } catch (error) {
      run.failed += 1;
      deps.logger.warn(
        { attempt: email.attempts, error: error instanceof Error ? error.name : 'unknown' },
        'case notification email not sent',
      );
      if (email.attempts >= CASE_NOTIFICATION_EMAIL_ATTEMPTS) {
        givenUp += 1;
        done.push(email.id);
      }
    }
  }
  await deleteCaseNotificationEmails(deps.db, done);
  if (givenUp > 0) {
    deps.logger.error({ givenUp }, 'case notification emails given up after three attempts');
  }
  if (run.sent + run.skipped > 0) {
    deps.logger.info({ ...run }, 'case notification emails');
  }
  return run;
}
