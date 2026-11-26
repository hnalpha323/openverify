/**
 * Migration 0036 (Workflow 11B, `0036_phase11_hardening`), upgrading a database at 0035 on PGlite:
 * the Workflow's one migration, which `foundation-11b` extends per checkpoint, each checkpoint with
 * its own describe. Every value is synthetic.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  PGLITE_EXTENSIONS,
  createTestAccountOnEarlierSchema,
  createTestInquiryOnEarlierSchema,
  createTestVerificationOnEarlierSchema,
  createTestTenant,
  testId,
} from './testing.js';

let upgraded: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
/** (A): a tenant, a user, its session and an API key written on 0035. */
let earlier: {
  organizationId: string;
  environmentId: string;
  userId: string;
  sessionId: string;
  keyId: string;
  /** (D): an account and a watchlist source row written on 0035. */
  accountId: string;
  sourceId: string;
  /** (P): a verification written on 0035, and the environment's Phase 8 slot. */
  verificationId: string;
};
const TOUCHED_AT = '2026-11-01T09:30:00.000Z';

async function rejects(statement: string, params: unknown[] = []): Promise<string> {
  try {
    await upgraded.query(statement, params);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected the statement to be refused: ${statement}`);
}

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
  db = drizzle({ client: upgraded, schema });
  await runMigrations(db, { upTo: '0035_phase11_connect' });
  // Written in SQL: the drizzle schema already names the columns 0035 does not have.
  const tenant = await createTestTenant(db, { organizationName: 'Example Earlier Org' });
  const userId = testId('usr');
  const sessionId = testId('uss');
  const keyId = testId('key');
  await upgraded.query(
    `insert into users (id, organization_id, email, password_hash, status)
     values ($1, $2, 'earlier@example.com', '$argon2id$v=19$synthetic', 'active')`,
    [userId, tenant.organization.id],
  );
  await upgraded.query(
    `insert into user_sessions (id, organization_id, user_id, environment_id, token_hash,
       expires_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, now() + interval '1 hour', $6, $6)`,
    [sessionId, tenant.organization.id, userId, tenant.environment.id, 'e'.repeat(64), TOUCHED_AT],
  );
  await upgraded.query(
    `insert into api_keys (id, environment_id, name, prefix, secret_hash)
     values ($1, $2, 'Earlier key', 'ov_sbx_', $3)`,
    [keyId, tenant.environment.id, 'f'.repeat(64)],
  );
  const accountId = await createTestAccountOnEarlierSchema(db, tenant.environment.id);
  const sourceId = 'example-earlier-source';
  await upgraded.query(
    `insert into watchlist_sources (id, enabled, last_sha256, last_checked_at)
     values ($1, true, $2, $3)`,
    [sourceId, 'a'.repeat(64), TOUCHED_AT],
  );
  const { inquiry } = await createTestInquiryOnEarlierSchema(db, tenant.environment.id);
  const verification = await createTestVerificationOnEarlierSchema(db, tenant.environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await upgraded.query(
    `insert into workflow_environment_slots (environment_id, in_flight_cap, last_served_at)
     values ($1, 7, $2)`,
    [tenant.environment.id, TOUCHED_AT],
  );
  earlier = {
    organizationId: tenant.organization.id,
    environmentId: tenant.environment.id,
    userId,
    sessionId,
    keyId,
    accountId,
    sourceId,
    verificationId: verification.id,
  };
  await runMigrations(db);
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await upgraded.close();
});

describe('migration 0036: applies on top of 0035 (Workflow 11B)', () => {
  it('is the migration after 0035_phase11_connect, and the last', () => {
    const tags = migrationTags();
    expect(tags.indexOf('0036_phase11_hardening')).toBe(tags.indexOf('0035_phase11_connect') + 1);
    // Workflow 11F's 0037 (KP11-26) follows it.
    expect(tags.indexOf('0037_phase11f_session_amr')).toBe(
      tags.indexOf('0036_phase11_hardening') + 1,
    );
  });
});

describe('migration 0036 (A): sessions, keys, users and organisations', () => {
  it('gives an earlier session its updated_at as last_seen_at (C245.1)', async () => {
    const rows = await upgraded.query<{ last_seen_at: Date }>(
      'select last_seen_at from user_sessions where id = $1',
      [earlier.sessionId],
    );
    expect(rows.rows[0]?.last_seen_at.toISOString()).toBe(TOUCHED_AT);
  });

  it('leaves an earlier key without a pepper id, and takes only 16 hex characters (C247.1)', async () => {
    const rows = await upgraded.query<{ pepper_key_id: string | null }>(
      'select pepper_key_id from api_keys where id = $1',
      [earlier.keyId],
    );
    expect(rows.rows).toEqual([{ pepper_key_id: null }]);
    await upgraded.query(`update api_keys set pepper_key_id = '0123456789abcdef' where id = $1`, [
      earlier.keyId,
    ]);
    expect(
      await rejects(`update api_keys set pepper_key_id = 'XYZ' where id = $1`, [earlier.keyId]),
    ).toContain('api_keys_pepper_key_id_format');
  });

  it('leaves an earlier user without a break-glass grant (C248.6)', async () => {
    const rows = await upgraded.query<{ password_login_allowed_until: Date | null }>(
      'select password_login_allowed_until from users where id = $1',
      [earlier.userId],
    );
    expect(rows.rows).toEqual([{ password_login_allowed_until: null }]);
  });

  it('gives no organisation a sign-in name, holds each name once and to its format (C248.8)', async () => {
    const rows = await upgraded.query<{ slug: string | null }>(
      'select slug from organizations where id = $1',
      [earlier.organizationId],
    );
    expect(rows.rows).toEqual([{ slug: null }]);
    await upgraded.query(`update organizations set slug = 'example-bank' where id = $1`, [
      earlier.organizationId,
    ]);
    const other = await createTestTenant(db, { organizationName: 'Example Other Org' });
    expect(
      await rejects(`update organizations set slug = 'example-bank' where id = $1`, [
        other.organization.id,
      ]),
    ).toContain('organizations_slug_key');
    for (const bad of ['Example', 'ex', '-bank', 'bank-', 'bank_1']) {
      expect(
        await rejects(`update organizations set slug = $1 where id = $2`, [
          bad,
          other.organization.id,
        ]),
        bad,
      ).toContain('organizations_slug_format');
    }
  });
});

describe('migration 0036 (A): SSO providers, identities and login states (C248)', () => {
  let providerId: string;

  beforeAll(async () => {
    providerId = testId('ssop');
    await upgraded.query(
      `insert into sso_providers (id, organization_id, display_name, issuer, client_id,
         client_secret, allowed_email_domains)
       values ($1, $2, 'Example IdP', 'https://idp.example.com', 'synthetic-client-id',
         'synthetic-sealed-secret', '{example.com}')`,
      [providerId, earlier.organizationId],
    );
  });

  it('defaults a provider to no pin, no amr or acr, no just-in-time users and no enforcement', async () => {
    const rows = await upgraded.query(
      `select tenant_pin_claim, tenant_pin_value, required_amr, required_acr, jit_provisioning,
         default_role_ids, enforced from sso_providers where id = $1`,
      [providerId],
    );
    expect(rows.rows).toEqual([
      {
        tenant_pin_claim: null,
        tenant_pin_value: null,
        required_amr: [],
        required_acr: [],
        jit_provisioning: false,
        default_role_ids: [],
        enforced: false,
      },
    ]);
  });

  it('refuses a provider without email domains, a half tenant pin and an unknown claim', async () => {
    const insert = (columns: string, values: string) =>
      rejects(
        `insert into sso_providers (id, organization_id, display_name, issuer, client_id,
           client_secret, allowed_email_domains${columns})
         values ($1, $2, 'Example IdP', 'https://idp.example.com', 'c', 's', ${values})`,
        [testId('ssop'), earlier.organizationId],
      );
    expect(await insert('', `'{}'`)).toContain('sso_providers_allowed_email_domains_present');
    expect(await insert(', tenant_pin_claim', `'{example.com}', 'tid'`)).toContain(
      'sso_providers_tenant_pin',
    );
    expect(
      await insert(', tenant_pin_claim, tenant_pin_value', `'{example.com}', 'oid', 'x'`),
    ).toContain('sso_providers_tenant_pin_claim_valid');
  });

  it('links an identity once by provider, issuer and subject, and one per user and provider', async () => {
    const link = (subject: string) =>
      upgraded.query(
        `insert into user_sso_identities (organization_id, user_id, provider_id, issuer, subject)
         values ($1, $2, $3, 'https://idp.example.com', $4)`,
        [earlier.organizationId, earlier.userId, providerId, subject],
      );
    await link('synthetic-subject-1');
    expect(
      await rejects(
        `insert into user_sso_identities (organization_id, user_id, provider_id, issuer, subject)
         values ($1, $2, $3, 'https://idp.example.com', 'synthetic-subject-1')`,
        [earlier.organizationId, testId('usr'), providerId],
      ),
    ).toContain('user_sso_identities_pkey');
    await expect(link('synthetic-subject-2')).rejects.toThrow(
      'user_sso_identities_provider_id_user_id_key',
    );
  });

  it('keeps a step-up state with its session and a sign-in state without one, and drops them with the provider', async () => {
    const state = (binding: string, purpose: string, sessionId: string | null) =>
      upgraded.query(
        `insert into sso_login_states (binding_sha256, organization_id, provider_id, purpose,
           session_id, state_sha256, nonce, code_verifier, expires_at)
         values ($1, $2, $3, $4, $5, $6, 'sealed-nonce', 'sealed-verifier',
           now() + interval '10 minutes')`,
        [binding, earlier.organizationId, providerId, purpose, sessionId, '1'.repeat(64)],
      );
    await state('2'.repeat(64), 'sign-in', null);
    await state('3'.repeat(64), 'step-up', earlier.sessionId);
    await expect(state('4'.repeat(64), 'step-up', null)).rejects.toThrow(
      'sso_login_states_step_up_session',
    );
    await expect(state('5'.repeat(64), 'sign-up', null)).rejects.toThrow(
      'sso_login_states_purpose_valid',
    );
    await upgraded.query('delete from sso_providers where id = $1', [providerId]);
    const left = await upgraded.query<{ count: number }>(
      'select count(*)::int as count from sso_login_states where provider_id = $1',
      [providerId],
    );
    const links = await upgraded.query<{ count: number }>(
      'select count(*)::int as count from user_sso_identities where provider_id = $1',
      [providerId],
    );
    expect([left.rows[0]?.count, links.rows[0]?.count]).toEqual([0, 0]);
  });
});

describe('migration 0036 (D): access exports (C253) and the watchlist sources’ checks (C254.2)', () => {
  const columnsOf = (extra: string) =>
    `id, environment_id, account_id, creator_type, creator_id${extra}`;
  const insertExport = (extra: string, values: string, params: unknown[] = []) =>
    upgraded.query(
      `insert into account_exports (${columnsOf(extra)}) values ($1, $2, $3, 'user', $4${values})`,
      [testId('aexp'), earlier.environmentId, earlier.accountId, earlier.userId, ...params],
    );
  const refused = async (extra: string, values: string, params: unknown[] = []) => {
    try {
      await insertExport(extra, values, params);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error(`expected the export to be refused: ${extra}`);
  };

  it('starts an export pending and unadmitted, listing nothing yet, one pending per account (C251.1, C253.5)', async () => {
    const id = testId('aexp');
    await upgraded.query(
      `insert into account_exports (${columnsOf('')}) values ($1, $2, $3, 'api-key', $4)`,
      [id, earlier.environmentId, earlier.accountId, testId('key')],
    );
    const rows = await upgraded.query(
      `select status, admitted_at, item_ids, item_count, byte_count, error_code, storage_key,
         wrapped_dek, ready_at, expires_at from account_exports where id = $1`,
      [id],
    );
    expect(rows.rows).toEqual([
      {
        status: 'pending',
        admitted_at: null,
        item_ids: [],
        item_count: null,
        byte_count: null,
        error_code: null,
        storage_key: null,
        wrapped_dek: null,
        ready_at: null,
        expires_at: null,
      },
    ]);
    expect(await refused('', '')).toContain('account_exports_one_pending_key');
    await upgraded.query(
      `update account_exports set status = 'failed',
      error_code = 'account_export_unavailable' where id = $1`,
      [id],
    );
  });

  it('holds a ready export to its times, counts, object and key, and a failed one to its code', async () => {
    const wrapped = `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`;
    expect(
      await refused(', status, storage_key, wrapped_dek, byte_count', ", 'ready', $5, $6, 16", [
        'synthetic/account-export-without-times',
        wrapped,
      ]),
    ).toContain('account_exports_ready_with_times');
    expect(
      await refused(
        ', status, item_count, ready_at, expires_at',
        ", 'ready', 1, now(), now() + interval '7 days'",
      ),
    ).toContain('account_exports_object_while_ready');
    expect(await refused(', status', ", 'failed'")).toContain('account_exports_error_when_failed');
    expect(await refused(', status, error_code', ", 'failed', 'account_export_pending'")).toContain(
      'account_exports_error_code_valid',
    );
    expect(await refused(', status', ", 'running'")).toContain('account_exports_status_valid');
    expect(
      await rejects(
        `insert into account_exports (${columnsOf('')}) values ($1, $2, $3, 'workflow-run', $4)`,
        [testId('aexp'), earlier.environmentId, earlier.accountId, testId('wfr')],
      ),
    ).toContain('account_exports_creator_type_valid');
    await insertExport(', status, error_code', ", 'failed', 'account_export_too_large'");
    await insertExport(
      ', status, item_ids, item_count, byte_count, storage_key, wrapped_dek, admitted_at, ' +
        'ready_at, expires_at',
      ", 'ready', $5, 2, 16, $6, $7, now(), now(), now() + interval '7 days'",
      [[earlier.accountId, testId('inq')], 'synthetic/account-export', wrapped],
    );
  });

  it('gives an earlier source no validation, no validator and no full check yet (C254.2)', async () => {
    const rows = await upgraded.query(
      `select last_validated_at, validated_by, last_full_check_at, last_etag, last_modified
       from watchlist_sources where id = $1`,
      [earlier.sourceId],
    );
    expect(rows.rows).toEqual([
      {
        last_validated_at: null,
        validated_by: null,
        last_full_check_at: null,
        last_etag: null,
        last_modified: null,
      },
    ]);
    await upgraded.query(
      `update watchlist_sources set validated_by = 'http-304', last_validated_at = now()
       where id = $1`,
      [earlier.sourceId],
    );
    expect(
      await rejects(`update watchlist_sources set validated_by = 'etag' where id = $1`, [
        earlier.sourceId,
      ]),
    ).toContain('watchlist_sources_validated_by_valid');
  });
});

describe('migration 0036 (P): the queue slots, the admission stamps (C251.1) and the retention functions (C249.3)', () => {
  it("moves Phase 8's slot rows to the workflow-step queue's and drops the old table", async () => {
    const rows = await upgraded.query(
      `select queue, in_flight_cap, last_served_at from queue_slots where environment_id = $1`,
      [earlier.environmentId],
    );
    expect(rows.rows).toEqual([
      { queue: 'workflow-step', in_flight_cap: 7, last_served_at: new Date(TOUCHED_AT) },
    ]);
    const old = await upgraded.query(`select to_regclass('workflow_environment_slots') as t`);
    expect(old.rows).toEqual([{ t: null }]);
    expect(
      await rejects(`insert into queue_slots (environment_id, queue) values ($1, 'export')`, [
        earlier.environmentId,
      ]),
    ).toContain('queue_slots_queue_valid');
    await upgraded.query(
      `insert into queue_slots (environment_id, queue) values ($1, 'process-verification')`,
      [earlier.environmentId],
    );
    expect(
      await rejects(
        `insert into queue_slots (environment_id, queue) values ($1, 'process-verification')`,
        [earlier.environmentId],
      ),
    ).toContain('queue_slots_pkey');
  });

  it("leaves an earlier verification unadmitted, and every capped row's stamp null (C251.1)", async () => {
    const rows = await upgraded.query(`select admitted_at from verifications where id = $1`, [
      earlier.verificationId,
    ]);
    expect(rows.rows).toEqual([{ admitted_at: null }]);
    const columns = await upgraded.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where column_name in ('admitted_at', 'scan_admitted_at', 'rendition_admitted_at')
        order by table_name, column_name`,
    );
    expect(columns.rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
      'account_exports.admitted_at',
      'case_attachments.rendition_admitted_at',
      'case_attachments.scan_admitted_at',
      'case_bulk_actions.admitted_at',
      'connect_share_tokens.admitted_at',
      'file_renditions.admitted_at',
      'inquiry_integrity_challenges.admitted_at',
      'list_items.admitted_at',
      'report_runs.admitted_at',
      'verifications.admitted_at',
    ]);
  });

  it('deletes only the audit entries past the setting, never under 30 days, through the function', async () => {
    const insert = (createdAt: string) =>
      upgraded.query(
        `insert into audit_logs (public_id, environment_id, actor_type, action, created_at)
         values ($1, $2, 'system', 'inquiry.viewed', $3)`,
        [testId('aud'), earlier.environmentId, createdAt],
      );
    await insert('2026-01-01T00:00:00.000Z');
    await insert('2026-02-20T00:00:00.000Z');
    await insert('2026-03-30T00:00:00.000Z');
    const run = async (now: string) =>
      (
        await upgraded.query<{ deleted: number }>(
          `select openverify_delete_expired_audit_logs($1, $2, 100) as deleted`,
          [earlier.environmentId, now],
        )
      ).rows[0]?.deleted;
    // No setting: nothing is deleted.
    expect(await run('2026-04-01T00:00:00.000Z')).toBe(0);
    // A setting below the 30-day minimum is held to it.
    await upgraded.query(
      `update environments set settings = settings || '{"audit-log-retention-days": 7}'::jsonb
        where id = $1`,
      [earlier.environmentId],
    );
    expect(await run('2026-04-01T00:00:00.000Z')).toBe(2);
    const left = await upgraded.query<{ n: number }>(
      `select count(*)::int as n from audit_logs where environment_id = $1
          and created_at < '2026-03-31T00:00:00Z'`,
      [earlier.environmentId],
    );
    expect(left.rows[0]?.n).toBe(1);
  });

  it("cleans a source's pending GIN lists through the function, and guards both tables' deletes", async () => {
    await upgraded.query(`select openverify_gin_clean_pending_lists($1)`, [earlier.sourceId]);
    const triggers = await upgraded.query<{ table: string; name: string }>(
      `select c.relname as table, t.tgname as name from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where t.tgname like 'openverify_%_delete_guard' order by 1`,
    );
    expect(triggers.rows).toEqual([
      { table: 'audit_logs', name: 'openverify_audit_logs_delete_guard' },
      { table: 'connect_share_policies', name: 'openverify_connect_share_policies_delete_guard' },
    ]);
    const definers = await upgraded.query<{ name: string; definer: boolean }>(
      `select proname as name, prosecdef as definer from pg_proc
        where proname in ('openverify_delete_expired_audit_logs', 'openverify_gin_clean_pending_lists')
        order by 1`,
    );
    expect(definers.rows).toEqual([
      { name: 'openverify_delete_expired_audit_logs', definer: true },
      { name: 'openverify_gin_clean_pending_lists', definer: true },
    ]);
  });
});
