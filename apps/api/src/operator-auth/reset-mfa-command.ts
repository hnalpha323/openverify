/**
 * `pnpm --filter @openverify/api user:reset-mfa <email>`: the self-hoster's way out of an MFA
 * lockout (Phase 2 risks). It removes the user's MFA factors and recovery codes, ends their
 * sessions, and records `user.mfa-reset` in every environment of the organization. The user
 * then signs in with the password alone and can enrol again (or must, under required MFA).
 */
import { idSchema } from '@openverify/contracts';
import { listEnvironments, normalizeEmail, users, type Db, type User } from '@openverify/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendSystemAuditEntry } from '../services/audit-log.js';
import { createMfaService } from '../services/mfa.js';
import { createArgon2idHasher } from './password-hasher.js';

export const RESET_MFA_USAGE = [
  'Usage: pnpm --filter @openverify/api user:reset-mfa <email> [--organization <org_...>]',
  '',
  "Removes the operator's MFA factors and recovery codes and ends their sessions. Pass",
  '--organization when several organizations have an operator with this email.',
  '',
].join('\n');

export interface ResetMfaArgs {
  email: string;
  organizationId?: string;
}

const emailSchema = z.email().max(254);
const organizationIdSchema = idSchema('org');

/** The command's arguments, or `null` when they are not usable (print the usage). */
export function parseResetMfaArgs(argv: readonly string[]): ResetMfaArgs | null {
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

export interface RunResetMfaOptions {
  db: Db;
  argv: readonly string[];
  stdout: Writable;
  stderr: Writable;
}

/** Every user with this email, across organizations and statuses. */
function usersWithEmail(db: Db, email: string): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)));
}

/**
 * Runs the command. Exit codes: 0 done, 1 no single user matched, 2 bad arguments. Messages
 * name the user by id and the organizations by id; they never print a secret.
 */
export async function runResetMfa(options: RunResetMfaOptions): Promise<number> {
  const { db, stdout, stderr } = options;
  const args = parseResetMfaArgs(options.argv);
  if (args === null) {
    stderr.write(RESET_MFA_USAGE);
    return 2;
  }
  const matches = (await usersWithEmail(db, args.email)).filter(
    (user) => args.organizationId === undefined || user.organizationId === args.organizationId,
  );
  if (matches.length === 0) {
    stderr.write(`No user has the email ${normalizeEmail(args.email)}.\n`);
    return 1;
  }
  const [user] = matches;
  if (user === undefined || matches.length > 1) {
    const organizations = matches.map((match) => match.organizationId).join(', ');
    stderr.write(
      `Several organizations have a user with this email (${organizations}); ` +
        'choose one with --organization.\n',
    );
    return 1;
  }
  // Only deletions and system audit entries: no password or recovery code is hashed.
  const mfa = createMfaService({ db, hasher: createArgon2idHasher() });
  const reset = await mfa.resetUserMfa(user.organizationId, user.id);
  for (const environment of await listEnvironments(db, user.organizationId)) {
    await appendSystemAuditEntry(db, environment.id, {
      action: 'user.mfa-reset',
      resourceType: 'user',
      resourceId: user.id,
      metadata: {
        via: 'cli',
        'factors-removed': reset.factorsRemoved,
        'sessions-revoked': reset.sessionsRevoked,
      },
    });
  }
  stdout.write(
    `Reset MFA for ${user.id} in ${user.organizationId}: removed ${String(reset.factorsRemoved)} ` +
      `factor(s), ended ${String(reset.sessionsRevoked)} session(s).\n`,
  );
  return 0;
}
