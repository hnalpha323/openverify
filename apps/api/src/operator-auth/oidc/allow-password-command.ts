/**
 * `pnpm --filter @openverify/api user:allow-password <email> [--organization <org_...>]` (C248.6;
 * review F11): the break-glass path of an organisation whose SSO provider is enforced. It grants the
 * user one password sign-in within 24 hours (`users.password_login_allowed_until`), which the next
 * password sign-in uses and clears, and records `user.password-login-allowed` in every environment
 * of the organisation as a system entry. Like `user:reset-mfa`, it is the self-hoster's way out of a
 * lockout (the identity provider down, misconfigured or gone) and runs as the runtime role (Stage 1a
 * amendment 15). Messages name the user and the organisation by id, never an email or a secret.
 */
import { idSchema } from '@openverify/contracts';
import {
  grantPasswordLogin,
  listEnvironments,
  normalizeEmail,
  organizationEnforcesSso,
  users,
  type Db,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Clock } from '../../ports.js';
import { appendSystemAuditEntry } from '../../services/audit-log.js';

/** C248.6: how long the grant lasts (the plan's 24 hours). */
export const PASSWORD_LOGIN_GRANT_SECONDS = 86_400;

export const ALLOW_PASSWORD_USAGE = [
  'Usage: pnpm --filter @openverify/api user:allow-password <email> [--organization <org_...>]',
  '',
  'Allows one password sign-in within 24 hours for a user of an organization whose single sign-on',
  'is enforced, for when its identity provider cannot be used. The next password sign-in uses it.',
  'Pass --organization when several organizations have a user with this email.',
  '',
].join('\n');

export interface AllowPasswordArgs {
  email: string;
  organizationId?: string;
}

const emailSchema = z.email().max(254);
const organizationIdSchema = idSchema('org');

/** The command's arguments, or `null` when they are not usable (print the usage). */
export function parseAllowPasswordArgs(argv: readonly string[]): AllowPasswordArgs | null {
  let email: string | undefined;
  let organizationId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--organization') {
      const value = argv[index + 1];
      if (value === undefined || !organizationIdSchema.safeParse(value).success) {
        return null;
      }
      organizationId = value;
      index += 1;
    } else if (argument.startsWith('-') || email !== undefined) {
      return null;
    } else {
      email = argument;
    }
  }
  if (email === undefined || !emailSchema.safeParse(email).success) {
    return null;
  }
  return organizationId === undefined ? { email } : { email, organizationId };
}

interface Writable {
  write(chunk: string): unknown;
}

export interface RunAllowPasswordOptions {
  db: Db;
  argv: readonly string[];
  stdout: Writable;
  stderr: Writable;
  clock: Clock;
}

/** Runs the command. Exit codes: 0 granted, 1 refused (nothing written), 2 bad arguments. */
export async function runAllowPassword(options: RunAllowPasswordOptions): Promise<number> {
  const { db, stdout, stderr, clock } = options;
  const args = parseAllowPasswordArgs(options.argv);
  if (args === null) {
    stderr.write(ALLOW_PASSWORD_USAGE);
    return 2;
  }
  const matches = (
    await db
      .select()
      .from(users)
      .where(and(eq(users.email, normalizeEmail(args.email)), eq(users.status, 'active')))
  ).filter(
    (user) => args.organizationId === undefined || user.organizationId === args.organizationId,
  );
  const [user] = matches;
  if (user === undefined) {
    stderr.write('No active user has this email.\n');
    return 1;
  }
  if (matches.length > 1) {
    const organizations = matches.map((match) => match.organizationId).join(', ');
    stderr.write(
      `Several organizations have an active user with this email (${organizations}); ` +
        'choose one with --organization.\n',
    );
    return 1;
  }
  if (!(await organizationEnforcesSso(db, user.organizationId))) {
    stderr.write(
      `The organization ${user.organizationId} does not enforce single sign-on: its users ` +
        'sign in with a password already.\n',
    );
    return 1;
  }
  const until = new Date(clock.now().getTime() + PASSWORD_LOGIN_GRANT_SECONDS * 1000);
  await grantPasswordLogin(db, user.organizationId, user.id, until);
  for (const environment of await listEnvironments(db, user.organizationId)) {
    await appendSystemAuditEntry(db, environment.id, {
      action: 'user.password-login-allowed',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { via: 'cli', 'allowed-until': until.toISOString() },
    });
  }
  stdout.write(
    `Allowed one password sign-in for ${user.id} in ${user.organizationId} until ` +
      `${until.toISOString()}.\n`,
  );
  return 0;
}
