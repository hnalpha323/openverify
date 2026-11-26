/**
 * C250.5 (Phase 11, Workflow 11B, platform-ops): `org:create`, the first organisation of a
 * production install. It creates the organisation with require-mfa on, both environments, the
 * built-in roles and the default template in each, and a single-use 24-hour invitation for the
 * first admin; it sends the invitation by SMTP when the mailer is configured and prints the link
 * only on an interactive terminal with `--print-invitation` (review P22); no demo user, no API key;
 * one system audit entry per environment; a second run with the same name refuses and writes
 * nothing. Every value is synthetic.
 */
import { ORG_CREATE } from '@openverify/contracts';
import { hashSessionToken, type Db } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invitationTokenFromUrl } from '../mail/index.js';
import type { MailMessage, Mailer } from '../ports.js';
import { DEFAULT_TEMPLATE_PATH, loadTemplateAttributes } from '../seed/dev-seed.js';
import { runOrgCreate, type RunOrgCreateOptions } from './org-create.js';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const NAME = 'Example Synthetic Bank';
const EMAIL = 'first.admin@example.com';
const CONSOLE = 'https://console.example.org';

let template: RunOrgCreateOptions['template'];
let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  template = await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH);
});

beforeEach(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterEach(async () => {
  await database.close();
});

function recordingMailer(fail = false) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    configured: true,
    send: (message) => {
      if (fail) {
        return Promise.reject(new Error('SMTP refused the message'));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
  return { mailer, sent };
}

async function run(argv: readonly string[], overrides: Partial<RunOrgCreateOptions> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runOrgCreate({
    db,
    argv,
    stdout: { write: (chunk: string) => stdout.push(chunk) },
    stderr: { write: (chunk: string) => stderr.push(chunk) },
    interactive: false,
    mailer: recordingMailer().mailer,
    dashboardPublicUrl: CONSOLE,
    template,
    clock: { now: () => NOW },
    ...overrides,
  });
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

async function rows<Row>(statement: ReturnType<typeof sql>): Promise<Row[]> {
  const result: unknown = await db.execute(statement);
  return (result as { rows: Row[] }).rows;
}

const counts = () =>
  rows<{ organizations: number; users: number; keys: number; templates: number }>(sql`
    select (select count(*)::int from organizations) as organizations,
           (select count(*)::int from users) as users,
           (select count(*)::int from api_keys) as keys,
           (select count(*)::int from inquiry_templates) as templates`);

describe('org:create (C250.5)', () => {
  it('creates the organisation, both environments, the template and an invited admin, and mails the invitation', async () => {
    const { mailer, sent } = recordingMailer();

    const result = await run(['--name', NAME, '--admin-email', EMAIL], { mailer });

    expect(result.code).toBe(0);
    const [organization] = await rows<{ id: string; require_mfa: boolean }>(
      sql`select id, require_mfa from organizations where name = ${NAME}`,
    );
    expect(organization?.require_mfa).toBe(true);
    const organizationId = organization?.id ?? '';
    const environments = await rows<{ id: string; kind: string }>(
      sql`select id, kind from environments where organization_id = ${organizationId} order by kind::text`,
    );
    expect(environments.map((environment) => environment.kind)).toEqual(['production', 'sandbox']);
    for (const environment of environments) {
      expect(
        await rows<{ name: string }>(
          sql`select name from inquiry_templates where environment_id = ${environment.id}`,
        ),
      ).toEqual([{ name: template.name }]);
      expect(
        await rows<{ action: string; actor_type: string; resource_id: string }>(
          sql`select action, actor_type, resource_id from audit_logs where environment_id = ${environment.id}`,
        ),
      ).toEqual([
        { action: 'organization.created', actor_type: 'system', resource_id: organizationId },
      ]);
    }
    const users = await rows<{
      id: string;
      email: string;
      status: string;
      invitation_token_hash: string;
      invitation_expires_at: Date;
    }>(sql`select id, email, status, invitation_token_hash, invitation_expires_at from users
           where organization_id = ${organizationId}`);
    expect(users).toHaveLength(1);
    const [admin] = users;
    expect(admin).toMatchObject({ email: EMAIL, status: 'invited' });
    expect(new Date(admin?.invitation_expires_at ?? 0).getTime()).toBe(
      NOW.getTime() + ORG_CREATE.invitationTtlSeconds * 1000,
    );
    expect(
      await rows<{ key: string | null }>(sql`
        select r.key from user_roles ur join roles r on r.id = ur.role_id
        where ur.user_id = ${admin?.id ?? ''}`),
    ).toEqual([{ key: 'admin' }]);
    expect(await counts()).toEqual([{ organizations: 1, users: 1, keys: 0, templates: 2 }]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual({ address: EMAIL });
    const link = /https:\/\/console\.example\.org\/accept-invitation#token=\S+/u.exec(
      sent[0]?.text ?? '',
    )?.[0];
    const token = invitationTokenFromUrl(link ?? '');
    expect(hashSessionToken(token ?? '')).toBe(admin?.invitation_token_hash);

    expect(result.stdout).toContain(organizationId);
    expect(result.stdout).toContain(admin?.id ?? 'usr_');
    expect(result.stdout).not.toContain(EMAIL);
    expect(result.stdout).not.toContain('accept-invitation');
    expect(result.stderr).toBe('');
  });

  it('refuses a second run with the same name and writes nothing', async () => {
    expect((await run(['--name', NAME, '--admin-email', EMAIL])).code).toBe(0);
    const before = await counts();
    const { mailer, sent } = recordingMailer();

    const second = await run(['--name', NAME, '--admin-email', 'other.admin@example.com'], {
      mailer,
    });

    expect(second.code).toBe(1);
    expect(second.stderr).toContain('already exists');
    expect(await counts()).toEqual(before);
    expect(sent).toEqual([]);
  });

  it('prints the link with --print-invitation on an interactive terminal only', async () => {
    const printed = await run(['--name', NAME, '--admin-email', EMAIL, '--print-invitation'], {
      interactive: true,
      mailer: null,
    });

    expect(printed.code).toBe(0);
    const token = invitationTokenFromUrl(
      /https:\/\/console\.example\.org\/accept-invitation#token=\S+/u.exec(printed.stdout)?.[0] ??
        '',
    );
    const [admin] = await rows<{ invitation_token_hash: string }>(
      sql`select invitation_token_hash from users`,
    );
    expect(hashSessionToken(token ?? '')).toBe(admin?.invitation_token_hash);
  });

  it('refuses --print-invitation where stdout is not a terminal, before writing anything', async () => {
    const refused = await run(['--name', NAME, '--admin-email', EMAIL, '--print-invitation'], {
      interactive: false,
    });

    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('interactive terminal');
    expect(refused.stdout).toBe('');
    expect(await counts()).toEqual([{ organizations: 0, users: 0, keys: 0, templates: 0 }]);
  });

  it('refuses when the invitation could reach nobody: no SMTP and no --print-invitation', async () => {
    const refused = await run(['--name', NAME, '--admin-email', EMAIL], { mailer: null });

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('OPENVERIFY_SMTP_URL');
    expect(await counts()).toEqual([{ organizations: 0, users: 0, keys: 0, templates: 0 }]);
  });

  it('refuses without the console URL the link points to', async () => {
    const refused = await run(['--name', NAME, '--admin-email', EMAIL], {
      dashboardPublicUrl: undefined,
    });

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('OPENVERIFY_DASHBOARD_PUBLIC_URL');
    expect(await counts()).toEqual([{ organizations: 0, users: 0, keys: 0, templates: 0 }]);
  });

  it('commits nothing when the SMTP server refuses the invitation', async () => {
    const refused = await run(['--name', NAME, '--admin-email', EMAIL], {
      mailer: recordingMailer(true).mailer,
    });

    expect(refused.code).toBe(1);
    expect(refused.stderr).not.toContain(EMAIL);
    expect(await counts()).toEqual([{ organizations: 0, users: 0, keys: 0, templates: 0 }]);
  });

  it.each([
    [[]],
    [['--name', NAME]],
    [['--admin-email', EMAIL]],
    [['--name', NAME, '--admin-email', 'not-an-email']],
    [['--name', '', '--admin-email', EMAIL]],
    [['--name', NAME, '--admin-email', EMAIL, '--unknown']],
    [['--name', NAME, '--admin-email', EMAIL, '--slug', 'Not A Slug']],
  ])('prints the usage and exits 2 for %j', async (argv) => {
    const refused = await run(argv);

    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Usage: pnpm --filter @openverify/api org:create');
    expect(await counts()).toEqual([{ organizations: 0, users: 0, keys: 0, templates: 0 }]);
  });
});
