/**
 * Test support: a schema v1 database (migrations 0000-0002) seeded with synthetic Phase 1
 * rows, written with raw SQL because the Drizzle schema in `src/` is v2. Shared by the
 * PGlite (`migration-v2.test.ts`) and Postgres 17 (`migration-v2.integration.test.ts`)
 * upgrade tests. Not part of the package build.
 */
import { encrypt, type Keyring } from './crypto.js';
import { testId } from './testing.js';

/** Runs one parameterised statement: PGlite's `client.query` or a node-postgres pool. */
export type Exec = (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

export const V1_ARGON2 =
  '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGljc2FsdA$c3ludGhldGljaGFzaHZhbHVlZm9ydGVzdHM';

const hex = (char: string) => char.repeat(64);
const DAY_MS = 86_400_000;

/** The ids and timestamps the upgrade tests assert against. */
export interface V1Seed {
  organizations: [string, string];
  environments: { e1: string; e2: string; e3: string };
  users: { u1: string; u2: string };
  userSession: string;
  templates: { t1: string; t2: string };
  versions: { t1v1: string; t1v2: string; t2v1: string };
  inquiries: { i1: string; i2: string; i3: string; i4: string; i5: string };
  createdAt: Record<'i1' | 'i2' | 'i3' | 'i4' | 'i5', Date>;
  updatedAt: Date;
  sessions: { active: string; revoked: string; expired: string };
  revokedAt: Date;
  expiredAt: Date;
  event: string;
  webhook: string;
  delivery: string;
  apiKey: string;
  auditLogCount: number;
}

/**
 * Seeds two organizations, three environments and the v1 tables. Inquiries in `e1` share
 * the reference `cust-1` (i1, i2), have `cust-2` (i4) or none (i3); `e3` reuses `cust-1`
 * (i5), which must not join the `e1` account.
 */
export async function seedV1(exec: Exec, keyring: Keyring, now = new Date()): Promise<V1Seed> {
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  const organizations: [string, string] = [testId('org'), testId('org')];
  const environments = { e1: testId('env'), e2: testId('env'), e3: testId('env') };
  const users = { u1: testId('usr'), u2: testId('usr') };
  const templates = { t1: testId('itmpl'), t2: testId('itmpl') };
  const versions = { t1v1: testId('itmplv'), t1v2: testId('itmplv'), t2v1: testId('itmplv') };
  const inquiries = {
    i1: testId('inq'),
    i2: testId('inq'),
    i3: testId('inq'),
    i4: testId('inq'),
    i5: testId('inq'),
  };
  const createdAt = {
    i1: at(-3 * DAY_MS),
    i2: at(-2 * DAY_MS),
    i3: at(-DAY_MS / 2),
    i4: at(-DAY_MS),
    i5: at(-4 * DAY_MS),
  };
  const updatedAt = at(-60_000);

  await exec(`insert into organizations (id, name) values ($1, 'Org One'), ($2, 'Org Two')`, [
    ...organizations,
  ]);
  await exec(
    `insert into environments (id, organization_id, kind)
     values ($1, $4, 'sandbox'), ($2, $4, 'production'), ($3, $5, 'sandbox')`,
    [environments.e1, environments.e2, environments.e3, ...organizations],
  );
  await exec(
    `insert into users (id, organization_id, email, password_hash, name)
     values ($1, $3, 'admin@example.test', $5, 'Synthetic Admin'),
            ($2, $4, 'other@example.test', $5, null)`,
    [users.u1, users.u2, ...organizations, V1_ARGON2],
  );
  const userSession = testId('uss');
  await exec(
    `insert into user_sessions (id, organization_id, user_id, environment_id, token_hash, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [userSession, organizations[0], users.u1, environments.e1, hex('1'), at(DAY_MS)],
  );
  const apiKey = testId('key');
  await exec(
    `insert into api_keys (id, environment_id, name, prefix, secret_hash, scopes)
     values ($1, $2, 'Seed key', 'ov_sbx_', $3, '{inquiries:read}')`,
    [apiKey, environments.e1, hex('2')],
  );

  await exec(
    `insert into inquiry_templates (id, environment_id, name) values ($1, $3, 'KYC'), ($2, $4, 'KYB')`,
    [templates.t1, templates.t2, environments.e1, environments.e3],
  );
  await exec(
    `insert into inquiry_template_versions
       (id, environment_id, inquiry_template_id, version, flow, verification_config, created_at)
     values ($1, $4, $5, 1, '{}', '{}', $7),
            ($2, $4, $5, 2, '{"steps":[]}', '{}', $8),
            ($3, $6, $9, 1, '{}', '{}', $7)`,
    [
      versions.t1v1,
      versions.t1v2,
      versions.t2v1,
      environments.e1,
      templates.t1,
      environments.e3,
      at(-10 * DAY_MS),
      at(-5 * DAY_MS),
      templates.t2,
    ],
  );

  const inquiryRows: [keyof typeof inquiries, string, string, string, string | null, string][] = [
    ['i1', environments.e1, templates.t1, versions.t1v2, 'cust-1', 'created'],
    ['i2', environments.e1, templates.t1, versions.t1v2, 'cust-1', 'completed'],
    ['i3', environments.e1, templates.t1, versions.t1v1, null, 'pending'],
    ['i4', environments.e1, templates.t1, versions.t1v2, 'cust-2', 'approved'],
    ['i5', environments.e3, templates.t2, versions.t2v1, 'cust-1', 'created'],
  ];
  for (const [key, environmentId, templateId, versionId, referenceId, status] of inquiryRows) {
    const fields = encrypt(JSON.stringify({ 'name-first': `Synthetic ${key}` }), keyring, {
      context: 'inquiries.fields',
    });
    await exec(
      `insert into inquiries (id, environment_id, inquiry_template_id, inquiry_template_version_id,
                              status, reference_id, fields, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        inquiries[key],
        environmentId,
        templateId,
        versionId,
        status,
        referenceId,
        fields,
        createdAt[key],
        updatedAt,
      ],
    );
  }

  const sessions = { active: testId('iqse'), revoked: testId('iqse'), expired: testId('iqse') };
  const revokedAt = at(-3_600_000);
  const expiredAt = at(-7_200_000);
  await exec(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at, revoked_at)
     values ($1, $4, $5, $7, $8, null),
            ($2, $4, $5, $9, $8, $10),
            ($3, $4, $6, $11, $12, null)`,
    [
      sessions.active,
      sessions.revoked,
      sessions.expired,
      environments.e1,
      inquiries.i1,
      inquiries.i3,
      hex('3'),
      at(DAY_MS),
      hex('4'),
      revokedAt,
      hex('5'),
      expiredAt,
    ],
  );

  const event = testId('evt');
  await exec(
    `insert into events (id, environment_id, name, payload) values ($1, $2, 'inquiry.created', $3)`,
    [
      event,
      environments.e1,
      encrypt(JSON.stringify({ data: { type: 'inquiry', id: inquiries.i1 } }), keyring, {
        context: 'events.payload',
      }),
    ],
  );
  const webhook = testId('wbh');
  await exec(
    `insert into webhooks (id, environment_id, url, enabled_events, secret, secret_last4)
     values ($1, $2, 'https://hooks.example.test/v1', '{*}', $3, 'abcd')`,
    [
      webhook,
      environments.e1,
      encrypt('wbhsec_synthetic_v1_abcd', keyring, { context: 'webhooks.secret' }),
    ],
  );
  const delivery = testId('whd');
  await exec(
    `insert into webhook_deliveries (id, environment_id, webhook_id, event_id, status, attempt_count,
                                     next_attempt_at)
     values ($1, $2, $3, $4, 'failed', 5, null)`,
    [delivery, environments.e1, webhook, event],
  );
  await exec(
    `insert into audit_logs (environment_id, actor_type, actor_id, action, ip, created_at)
     values ($1, 'user', $2, 'file.viewed', $3, $4), ($1, 'user', $2, 'user.logged-in', null, $5)`,
    [
      environments.e1,
      users.u1,
      encrypt('198.51.100.20', keyring, { context: 'audit_logs.ip' }),
      at(-DAY_MS),
      at(-2 * DAY_MS),
    ],
  );

  return {
    organizations,
    environments,
    users,
    userSession,
    templates,
    versions,
    inquiries,
    createdAt,
    updatedAt,
    sessions,
    revokedAt,
    expiredAt,
    event,
    webhook,
    delivery,
    apiKey,
    auditLogCount: 2,
  };
}

const row = async <T>(exec: Exec, text: string, params: unknown[] = []): Promise<T[]> =>
  (await exec(text, params)).rows as T[];

/** C15 built-in role permissions, as the migration seeds them for existing organizations. */
export const V2_BUILTIN_ROLE_KEYS = ['admin', 'developer', 'reviewer', 'viewer'] as const;

/**
 * Asserts the state a v1 database must reach after migration 0003 (schema v2). Uses raw
 * SQL so it does not depend on the Drizzle row mapping.
 */
export async function expectV2Upgrade(
  exec: Exec,
  seed: V1Seed,
  expect: typeof import('vitest').expect,
): Promise<void> {
  const { environments, inquiries } = seed;

  // C13: one "user" account type per environment.
  const types = await row<{ environment_id: string; name: string; id: string }>(
    exec,
    `select environment_id, name, id from account_types where environment_id = any($1) order by environment_id`,
    [Object.values(environments)],
  );
  expect(types.map((type) => type.name)).toEqual(['user', 'user', 'user']);
  expect(new Set(types.map((type) => type.environment_id))).toEqual(
    new Set(Object.values(environments)),
  );
  expect(types.every((type) => /^acctp_[0-9A-HJKMNP-TV-Z]{26}$/.test(type.id))).toBe(true);

  // C13: every inquiry has an account; one account per (environment, reference id).
  const linked = await row<{
    id: string;
    account_id: string;
    account_reference_id: string | null;
    account_environment_id: string;
    account_type: string;
    account_created_at: Date;
    updated_at: Date;
    expires_at: Date;
    created_at: Date;
    tags: string[];
    note: string | null;
    redacted_at: Date | null;
  }>(
    exec,
    `select i.id, i.account_id, a.reference_id as account_reference_id,
            a.environment_id as account_environment_id, t.name as account_type,
            a.created_at as account_created_at, i.updated_at, i.expires_at, i.created_at, i.tags,
            i.note, i.redacted_at
       from inquiries i join accounts a on a.id = i.account_id
       join account_types t on t.id = a.account_type_id
      where i.id = any($1)`,
    [Object.values(inquiries)],
  );
  const byId = new Map(linked.map((entry) => [entry.id, entry]));
  const accountOf = (id: string) => byId.get(id)?.account_id;
  expect(linked).toHaveLength(5);
  expect(accountOf(inquiries.i1)).toBe(accountOf(inquiries.i2));
  expect(
    new Set([inquiries.i1, inquiries.i3, inquiries.i4, inquiries.i5].map(accountOf)).size,
  ).toBe(4);
  expect(byId.get(inquiries.i1)?.account_reference_id).toBe('cust-1');
  expect(byId.get(inquiries.i3)?.account_reference_id).toBeNull();
  expect(byId.get(inquiries.i4)?.account_reference_id).toBe('cust-2');
  expect(byId.get(inquiries.i5)).toMatchObject({
    account_reference_id: 'cust-1',
    account_environment_id: environments.e3,
  });
  for (const entry of linked) {
    expect(entry.account_id).toMatch(/^acc_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(entry.account_type).toBe('user');
    // The backfill must not touch updated_at: retention counts from it (C16).
    expect(new Date(entry.updated_at).getTime()).toBe(seed.updatedAt.getTime());
    expect(new Date(entry.expires_at).getTime() - new Date(entry.created_at).getTime()).toBe(
      DAY_MS,
    );
    expect(entry).toMatchObject({ tags: [], note: null, redacted_at: null });
  }
  // The account of a reference group is as old as its oldest inquiry.
  expect(new Date(byId.get(inquiries.i2)?.account_created_at ?? 0).getTime()).toBe(
    seed.createdAt.i1.getTime(),
  );
  const accountColumns = await row<{ status: string; fields: string | null; tags: string[] }>(
    exec,
    `select status, fields, tags from accounts where environment_id = any($1)`,
    [Object.values(environments)],
  );
  expect(accountColumns).toHaveLength(4);
  expect(accountColumns.every((entry) => entry.status === 'active' && entry.fields === null)).toBe(
    true,
  );

  // C11: the latest version of each template is published, the others superseded.
  const versions = await row<{
    id: string;
    status: string;
    published_at: Date | null;
    created_at: Date;
    settings: unknown;
  }>(
    exec,
    `select id, status, published_at, created_at, settings from inquiry_template_versions
      where id = any($1)`,
    [Object.values(seed.versions)],
  );
  const versionStatus = Object.fromEntries(versions.map((entry) => [entry.id, entry.status]));
  expect(versionStatus).toEqual({
    [seed.versions.t1v1]: 'superseded',
    [seed.versions.t1v2]: 'published',
    [seed.versions.t2v1]: 'published',
  });
  for (const entry of versions) {
    expect(new Date(entry.published_at ?? 0).getTime()).toBe(new Date(entry.created_at).getTime());
    expect(entry.settings).toEqual({});
  }
  const templateStatus = await row<{ status: string }>(
    exec,
    `select status from inquiry_templates where id = any($1)`,
    [Object.values(seed.templates)],
  );
  expect(templateStatus.map((entry) => entry.status)).toEqual(['active', 'active']);

  // C10: v1 sessions get a status from revoked_at and expires_at.
  const sessions = await row<{
    id: string;
    status: string;
    canceled_at: Date | null;
    expired_at: Date | null;
    started_at: Date | null;
  }>(
    exec,
    `select id, status, canceled_at, expired_at, started_at from inquiry_sessions where id = any($1)`,
    [Object.values(seed.sessions)],
  );
  const session = new Map(sessions.map((entry) => [entry.id, entry]));
  expect(session.get(seed.sessions.active)).toMatchObject({
    status: 'active',
    canceled_at: null,
    expired_at: null,
  });
  expect(session.get(seed.sessions.revoked)?.status).toBe('canceled');
  expect(new Date(session.get(seed.sessions.revoked)?.canceled_at ?? 0).getTime()).toBe(
    seed.revokedAt.getTime(),
  );
  expect(session.get(seed.sessions.expired)?.status).toBe('expired');
  expect(new Date(session.get(seed.sessions.expired)?.expired_at ?? 0).getTime()).toBe(
    seed.expiredAt.getTime(),
  );

  // C15: audit logs get public ids and stay append-only.
  const audits = await row<{ public_id: string }>(
    exec,
    `select public_id from audit_logs where environment_id = $1`,
    [environments.e1],
  );
  expect(audits).toHaveLength(seed.auditLogCount);
  expect(audits.every((entry) => /^aud_[0-9A-HJKMNP-TV-Z]{26}$/.test(entry.public_id))).toBe(true);
  expect(new Set(audits.map((entry) => entry.public_id)).size).toBe(seed.auditLogCount);

  // C15: built-in roles in every organization; existing operators become admins.
  const roleRows = await row<{
    organization_id: string;
    key: string;
    builtin: boolean;
    permissions: string[];
  }>(
    exec,
    `select organization_id, key, builtin, permissions from roles where organization_id = any($1)
      order by organization_id, key`,
    [seed.organizations],
  );
  expect(roleRows).toHaveLength(8);
  for (const organizationId of seed.organizations) {
    expect(
      roleRows
        .filter((entry) => entry.organization_id === organizationId)
        .map((entry) => entry.key),
    ).toEqual([...V2_BUILTIN_ROLE_KEYS]);
  }
  expect(roleRows.every((entry) => entry.builtin)).toBe(true);
  const admin = roleRows.find((entry) => entry.key === 'admin');
  expect(admin?.permissions).toEqual(
    expect.arrayContaining(['inquiries:write', 'pii:view', 'users:write', 'roles:write']),
  );
  expect(roleRows.find((entry) => entry.key === 'viewer')?.permissions).not.toContain('pii:view');
  const assignments = await row<{ user_id: string; key: string }>(
    exec,
    `select ur.user_id, r.key from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = any($1) order by ur.user_id`,
    [Object.values(seed.users)],
  );
  expect(assignments).toEqual(
    expect.arrayContaining([
      { user_id: seed.users.u1, key: 'admin' },
      { user_id: seed.users.u2, key: 'admin' },
    ]),
  );
  expect(assignments).toHaveLength(2);
  const userRows = await row<{ status: string }>(
    exec,
    `select status from users where id = any($1)`,
    [Object.values(seed.users)],
  );
  expect(userRows.map((entry) => entry.status)).toEqual(['active', 'active']);
  const userSessions = await row<{ mfa_satisfied: boolean }>(
    exec,
    `select mfa_satisfied from user_sessions where id = $1`,
    [seed.userSession],
  );
  expect(userSessions).toEqual([{ mfa_satisfied: true }]);
  const organizationRows = await row<{ require_mfa: boolean }>(
    exec,
    `select require_mfa from organizations where id = any($1)`,
    [seed.organizations],
  );
  expect(organizationRows).toEqual([{ require_mfa: false }, { require_mfa: false }]);

  // C12, C14, C16 defaults.
  expect(
    await row(exec, `select settings from environments where id = $1`, [environments.e1]),
  ).toEqual([{ settings: {} }]);
  expect(
    await row(exec, `select api_version, token_prefix from api_keys where id = $1`, [seed.apiKey]),
  ).toEqual([{ api_version: '2026-10-01', token_prefix: null }]);
  expect(
    await row(
      exec,
      `select status, api_version, filters, attribute_blocklist, custom_headers, previous_secret
         from webhooks where id = $1`,
      [seed.webhook],
    ),
  ).toEqual([
    {
      status: 'enabled',
      api_version: '2026-10-01',
      filters: {},
      attribute_blocklist: [],
      custom_headers: null,
      previous_secret: null,
    },
  ]);
  expect(
    await row(
      exec,
      `select max_attempts, is_replay, attempt_count from webhook_deliveries where id = $1`,
      [seed.delivery],
    ),
  ).toEqual([{ max_attempts: 8, is_replay: false, attempt_count: 5 }]);
  expect(
    await row(exec, `select simulated, object_id, redacted_at from events where id = $1`, [
      seed.event,
    ]),
  ).toEqual([{ simulated: false, object_id: null, redacted_at: null }]);
}
