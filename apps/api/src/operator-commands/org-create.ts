/**
 * `pnpm --filter @openverify/api org:create --name <name> --admin-email <email> [--slug <name>]
 * [--print-invitation]` (C250.5; Phase 11, Workflow 11B, platform-ops): the first organisation of a
 * production install, where `seed:dev` refuses to run.
 *
 * It creates the organisation with `require-mfa: true` (C168.2), its sandbox and production
 * environments, the built-in roles and the default inquiry template in each environment, and a
 * single-use invitation for the first admin that lives `ORG_CREATE.invitationTtlSeconds` (24
 * hours). The invitation goes by SMTP when the mailer is configured; its link is printed only on
 * an interactive terminal with `--print-invitation` (review P22: a Kubernetes Job's or CI's output
 * lands in a log store, where the link would let anyone claim the organisation). No demo user, no
 * API key. One system audit entry, `organization.created`, in each environment. Idempotent by name:
 * a second run with the same `--name` refuses and writes nothing.
 *
 * Output names ids only: never the email, the link or its token, except the link itself on an
 * interactive terminal when asked.
 */
import {
  newInvitationToken,
  ORG_CREATE,
  organizationSlugSchema,
  type CreateInquiryTemplateAttributes,
} from '@openverify/contracts';
import {
  createEnvironment,
  createInquiryTemplate,
  createInvitedUser,
  createOrganization,
  hashSessionToken,
  setUserRoles,
  type Db,
} from '@openverify/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { invitationAcceptUrl, invitationEmail } from '../mail/index.js';
import { ulidIdGenerator, type Clock, type IdGenerator, type Mailer } from '../ports.js';
import { DEFAULT_TEMPLATE_SETTINGS } from '../seed/dev-seed.js';
import { appendSystemAuditEntry } from '../services/audit-log.js';
import { syncOrganizationRoles } from '../services/roles.js';

export const ORG_CREATE_USAGE = [
  'Usage: pnpm --filter @openverify/api org:create --name <name> --admin-email <email>',
  '                                            [--slug <sign-in name>] [--print-invitation]',
  '',
  'Creates an organization with its sandbox and production environments, the default template',
  'and require-mfa on, and invites its first admin for 24 hours: by email when SMTP is set, and',
  'with --print-invitation the link is also printed, on an interactive terminal only.',
  '',
].join('\n');

export interface OrgCreateArgs {
  name: string;
  adminEmail: string;
  slug?: string;
  printInvitation: boolean;
}

/** An organisation's name: 1 to 200 characters, no control character. */
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/\p{Cc}/u.test(value));
const emailSchema = z.email().max(254);

/** The command's arguments, or `null` when they are not usable (print the usage). */
export function parseOrgCreateArgs(argv: readonly string[]): OrgCreateArgs | null {
  const values = new Map<string, string>();
  let printInvitation = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    if (flag === '--print-invitation') {
      printInvitation = true;
      continue;
    }
    const value = argv[index + 1];
    if (!['--name', '--admin-email', '--slug'].includes(flag) || value === undefined) {
      return null;
    }
    if (values.has(flag)) {
      return null;
    }
    values.set(flag, value);
    index += 1;
  }
  const name = nameSchema.safeParse(values.get('--name'));
  const adminEmail = emailSchema.safeParse(values.get('--admin-email'));
  const slugValue = values.get('--slug');
  const slug = slugValue === undefined ? undefined : organizationSlugSchema.safeParse(slugValue);
  if (!name.success || !adminEmail.success || slug?.success === false) {
    return null;
  }
  return {
    name: name.data,
    adminEmail: adminEmail.data,
    ...(slug?.data === undefined ? {} : { slug: slug.data }),
    printInvitation,
  };
}

interface Writable {
  write(chunk: string): unknown;
}

export interface RunOrgCreateOptions {
  db: Db;
  argv: readonly string[];
  stdout: Writable;
  stderr: Writable;
  /** Whether stdout is an interactive terminal (`process.stdout.isTTY`). */
  interactive: boolean;
  /** The configured mailer, or `null` without `OPENVERIFY_SMTP_URL`. */
  mailer: Mailer | null;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`, where the invitation link points. */
  dashboardPublicUrl: string | undefined;
  /** The default template (`contracts/fixtures/flows/default-gov-id-selfie.json`). */
  template: CreateInquiryTemplateAttributes;
  clock: Clock;
  ids?: IdGenerator;
}

/** A refusal that leaves the database as it was; its message names no value. */
class OrgCreateRefusal extends Error {
  override name = 'OrgCreateRefusal';
}

/** One run at a time, so two runs with one name cannot both pass the name check. */
const ORG_CREATE_LOCK = 'openverify:org-create';

const EXISTS =
  'An organization with this name or sign-in name already exists; org:create created nothing.';

interface Created {
  organizationId: string;
  sandboxId: string;
  productionId: string;
  adminId: string;
  acceptUrl: string;
  expiresAt: Date;
}

/**
 * Runs the command. Exit codes: 0 done, 1 refused (nothing written), 2 bad arguments.
 */
export async function runOrgCreate(options: RunOrgCreateOptions): Promise<number> {
  const { db, stdout, stderr, mailer, dashboardPublicUrl } = options;
  const args = parseOrgCreateArgs(options.argv);
  if (args === null) {
    stderr.write(ORG_CREATE_USAGE);
    return 2;
  }
  if (args.printInvitation && !options.interactive) {
    stderr.write(
      'org:create: --print-invitation prints the link on an interactive terminal only, never into ' +
        'a Job, a pipeline or anything else whose output is logged; nothing was created.\n',
    );
    return 2;
  }
  if (dashboardPublicUrl === undefined) {
    stderr.write(
      'org:create: set OPENVERIFY_DASHBOARD_PUBLIC_URL, where the invitation link points; ' +
        'nothing was created.\n',
    );
    return 1;
  }
  if (mailer === null && !args.printInvitation) {
    stderr.write(
      'org:create: the invitation could reach nobody: set OPENVERIFY_SMTP_URL, or run on an ' +
        'interactive terminal with --print-invitation; nothing was created.\n',
    );
    return 1;
  }
  const ids = options.ids ?? ulidIdGenerator;
  const token = newInvitationToken();
  const expiresAt = new Date(
    options.clock.now().getTime() + ORG_CREATE.invitationTtlSeconds * 1000,
  );
  const acceptUrl = invitationAcceptUrl(dashboardPublicUrl, token);
  let created: Created;
  try {
    created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ORG_CREATE_LOCK}))`);
      const taken: unknown = await tx.execute(
        sql`select exists (select 1 from organizations where name = ${args.name}) as taken`,
      );
      if ((taken as { rows: { taken: boolean }[] }).rows[0]?.taken === true) {
        throw new OrgCreateRefusal(EXISTS);
      }
      const organization = await createOrganization(tx, {
        id: ids.newId('org'),
        name: args.name,
        requireMfa: true,
      });
      if (args.slug !== undefined) {
        // Amendment 46: a taken sign-in name answers as a taken name does.
        const slugTaken: unknown = await tx.execute(
          sql`select exists (select 1 from organizations where slug = ${args.slug}) as taken`,
        );
        if ((slugTaken as { rows: { taken: boolean }[] }).rows[0]?.taken === true) {
          throw new OrgCreateRefusal(EXISTS);
        }
        await tx.execute(
          sql`update organizations set slug = ${args.slug} where id = ${organization.id}`,
        );
      }
      const environments = [];
      for (const kind of ['sandbox', 'production'] as const) {
        const environment = await createEnvironment(tx, {
          id: ids.newId('env'),
          organizationId: organization.id,
          kind,
        });
        await createInquiryTemplate(tx, environment.id, {
          id: ids.newId('itmpl'),
          name: options.template.name,
          version: {
            id: ids.newId('itmplv'),
            flow: options.template.flow,
            verificationConfig: options.template['verification-config'],
            settings: { ...DEFAULT_TEMPLATE_SETTINGS, ...options.template.settings },
          },
        });
        environments.push(environment);
      }
      const roles = await syncOrganizationRoles(tx, organization.id, ids);
      const adminRole = roles.find((role) => role.key === 'admin');
      /* v8 ignore next 3 -- the built-in roles always hold admin */
      if (adminRole === undefined) {
        throw new Error('org:create: the built-in roles have no admin role');
      }
      const admin = await createInvitedUser(tx, {
        id: ids.newId('usr'),
        organizationId: organization.id,
        email: args.adminEmail,
        invitationTokenHash: hashSessionToken(token),
        invitationExpiresAt: expiresAt,
      });
      await setUserRoles(tx, organization.id, admin.id, [adminRole.id]);
      for (const environment of environments) {
        await appendSystemAuditEntry(tx, environment.id, {
          action: 'organization.created',
          resourceType: 'organization',
          resourceId: organization.id,
          metadata: { via: 'cli', 'require-mfa': true, 'admin-user-id': admin.id },
        });
      }
      if (mailer !== null) {
        // As an invitation from the team page: committed only once SMTP has taken the message.
        try {
          await mailer.send(
            invitationEmail({
              to: admin.email,
              organizationName: organization.name,
              acceptUrl,
              expiresAt,
            }),
          );
        } catch {
          throw new OrgCreateRefusal(
            'The SMTP server did not take the invitation; org:create created nothing.',
          );
        }
      }
      const [sandbox, production] = environments;
      return {
        organizationId: organization.id,
        sandboxId: sandbox?.id ?? '',
        productionId: production?.id ?? '',
        adminId: admin.id,
        acceptUrl,
        expiresAt,
      };
    });
  } catch (error) {
    if (error instanceof OrgCreateRefusal) {
      stderr.write(`org:create: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  stdout.write(
    `Created organization ${created.organizationId} (require-mfa on) with environments ` +
      `${created.sandboxId} (sandbox) and ${created.productionId} (production), each with the ` +
      'default template.\n' +
      `Invited its first admin, ${created.adminId}: the invitation works once and expires at ` +
      `${created.expiresAt.toISOString()}.\n` +
      (mailer === null ? '' : 'The invitation was sent by email.\n'),
  );
  if (args.printInvitation) {
    stdout.write(
      `Invitation link (shown once; never paste it into a ticket or a log):\n${created.acceptUrl}\n`,
    );
  }
  return 0;
}
