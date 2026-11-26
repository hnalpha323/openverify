/**
 * Migration 0031 (Workflow 9B), upgrading a database at 0030 on PGlite. `foundation-9b` extends it
 * per checkpoint (Stage 1b (A), (U), (W), (X), (C), (F)); each checkpoint adds its own describe.
 */
import { PGlite } from '@electric-sql/pglite';
import { ANALYTICS_ROLLUP_TABLES } from '@openverify/core';
import { drizzle } from 'drizzle-orm/pglite';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  PGLITE_EXTENSIONS,
  seedCase,
  seedCaseTemplate,
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
} from './testing.js';

let upgraded: PGlite;
let seeded: { environmentId: string; inquiryId: string; verificationId: string };
/** (U): an organisation, an operator with a role and a session, and an audit entry, before 0031. */
let access: { organizationId: string; userId: string; sessionId: string; auditPublicId: string };
/** (W): an API key, a webhook and a case notification, before 0031. */
let keysWebhooks: { apiKeyId: string; webhookId: string; notificationId: string; caseId: string };
/** (X): a report and a transaction, before 0031. */
let exportsSeed: { reportId: string; transactionId: string };
/** (C): a case template version and a case action, before 0031 (the case is (W)'s). */
let casesSeed: { environmentId: string; versionId: string; caseActionId: string };

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const earlier = drizzle({ client: upgraded, schema });
  await runMigrations(earlier, { upTo: '0030_phase9a' });
  const { environment } = await createTestTenant(earlier);
  const { inquiry } = await createTestInquiryOnEarlierSchema(earlier, environment.id);
  const verification = await createTestVerificationOnEarlierSchema(earlier, environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await upgraded.query(
    `insert into verification_checks (environment_id, verification_id, name, status, type, requirement)
     values ($1, $2, 'id_expired', 'passed', 'fraud', 'required')`,
    [environment.id, verification.id],
  );
  seeded = {
    environmentId: environment.id,
    inquiryId: inquiry.id,
    verificationId: verification.id,
  };
  // (U): by SQL, so no column 0031 adds is named; the organisation takes the old column default.
  access = {
    organizationId: testId('org'),
    userId: testId('usr'),
    sessionId: testId('uss'),
    auditPublicId: testId('aud'),
  };
  const accessEnvironmentId = testId('env');
  const roleId = testId('role');
  await upgraded.query(`insert into organizations (id, name) values ($1, 'Example Earlier Org')`, [
    access.organizationId,
  ]);
  await upgraded.query(
    `insert into environments (id, organization_id, kind) values ($1, $2, 'sandbox')`,
    [accessEnvironmentId, access.organizationId],
  );
  await upgraded.query(
    `insert into users (id, organization_id, email, password_hash)
     values ($1, $2, 'earlier-operator@example.test', '$argon2id$v=19$m=65536,t=3,p=4$synthetic')`,
    [access.userId, access.organizationId],
  );
  await upgraded.query(
    `insert into roles (id, organization_id, name, permissions) values ($1, $2, 'Earlier', '{inquiries:read}')`,
    [roleId, access.organizationId],
  );
  await upgraded.query(
    `insert into user_roles (organization_id, user_id, role_id) values ($1, $2, $3)`,
    [access.organizationId, access.userId, roleId],
  );
  await upgraded.query(
    `insert into user_sessions (id, organization_id, user_id, environment_id, token_hash, expires_at, mfa_satisfied)
     values ($1, $2, $3, $4, $5, now() + interval '1 hour', true)`,
    [access.sessionId, access.organizationId, access.userId, accessEnvironmentId, 'b'.repeat(64)],
  );
  await upgraded.query(
    `insert into audit_logs (public_id, environment_id, actor_type, action) values ($1, $2, 'system', 'inquiry.approved')`,
    [access.auditPublicId, accessEnvironmentId],
  );
  // (W): by SQL too, in the (U) organisation's environment; the case through Phase 8's seeds.
  const template = await seedCaseTemplate(earlier, accessEnvironmentId);
  const earlierCase = await seedCase(earlier, accessEnvironmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
  });
  keysWebhooks = {
    apiKeyId: testId('key'),
    webhookId: testId('wbh'),
    notificationId: testId('unot'),
    caseId: earlierCase.id,
  };
  await upgraded.query(
    `insert into api_keys (id, environment_id, name, prefix, secret_hash, scopes)
     values ($1, $2, 'Earlier key', 'ov_sbx_', $3, '{inquiries:read}')`,
    [keysWebhooks.apiKeyId, accessEnvironmentId, 'c'.repeat(64)],
  );
  await upgraded.query(
    `insert into webhooks (id, environment_id, url, enabled_events, secret, secret_last4)
     values ($1, $2, 'https://hooks.example.test/earlier', '{inquiry.completed}', 'synthetic', 'etic')`,
    [keysWebhooks.webhookId, accessEnvironmentId],
  );
  await upgraded.query(
    `insert into user_notifications (id, environment_id, user_id, kind, case_id)
     values ($1, $2, $3, 'assigned', $4)`,
    [keysWebhooks.notificationId, accessEnvironmentId, access.userId, keysWebhooks.caseId],
  );
  // (X): through the earlier seeds, whose columns 0031 does not change.
  const reportTemplate = await seedReportTemplate(earlier, environment.id);
  const transactionType = await seedTransactionType(earlier, environment.id);
  exportsSeed = {
    reportId: await seedReport(earlier, environment.id, {
      templateId: reportTemplate.templateId,
      versionId: reportTemplate.versionId,
    }),
    transactionId: (
      await seedTransaction(earlier, environment.id, {
        transactionTypeId: transactionType.id,
        transactionTypeVersionId: transactionType.versionId,
      })
    ).id,
  };
  // (C): a case action by SQL, on a workflow of the (W) environment; the version is (W)'s template's.
  const workflowId = testId('wfl');
  casesSeed = {
    environmentId: accessEnvironmentId,
    versionId: template.versionId,
    caseActionId: testId('cact'),
  };
  await upgraded.query(
    `insert into workflows (id, environment_id, name) values ($1, $2, 'Earlier escalation')`,
    [workflowId, accessEnvironmentId],
  );
  await upgraded.query(
    `insert into case_actions (id, environment_id, workflow_id, label) values ($1, $2, $3, 'Escalate')`,
    [casesSeed.caseActionId, accessEnvironmentId, workflowId],
  );
  await runMigrations(earlier);
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await upgraded.close();
});

describe('migration 0031: applies on top of 0030 (Workflow 9B)', () => {
  it('is the migration after 0030_phase9a', () => {
    const tags = migrationTags();
    expect(tags.indexOf('0031_phase9b')).toBe(tags.indexOf('0030_phase9a') + 1);
  });
});

describe('migration 0031: the analytics rollups on an upgraded database (Workflow 9B Stage 1b (A))', () => {
  it('adds the twelve rollup tables and the rollup state, empty', async () => {
    for (const table of [...ANALYTICS_ROLLUP_TABLES, 'analytics_rollup_state']) {
      const { rows } = await upgraded.query<{ count: number }>(
        `select count(*)::int as count from ${table}`,
      );
      expect(rows, table).toEqual([{ count: 0 }]);
    }
  });

  it('keeps the inquiry, verification and check made before it, now found by the dirty-day indexes (B2)', async () => {
    const { rows } = await upgraded.query<{
      inquiries: number;
      verifications: number;
      checks: number;
    }>(
      `select (select count(*)::int from inquiries where environment_id = $1 and id = $2) as inquiries,
              (select count(*)::int from verifications where environment_id = $1 and id = $3) as verifications,
              (select count(*)::int from verification_checks where environment_id = $1
                 and verification_id = $3) as checks`,
      [seeded.environmentId, seeded.inquiryId, seeded.verificationId],
    );
    expect(rows).toEqual([{ inquiries: 1, verifications: 1, checks: 1 }]);
    const { rows: indexes } = await upgraded.query<{ indexname: string }>(
      `select indexname from pg_indexes where indexname in (
         'inquiries_environment_id_updated_at_idx',
         'verifications_environment_id_updated_at_idx',
         'verification_checks_environment_id_updated_at_idx') order by indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'inquiries_environment_id_updated_at_idx',
      'verification_checks_environment_id_updated_at_idx',
      'verifications_environment_id_updated_at_idx',
    ]);
  });
});

describe('migration 0031: access on an upgraded database (Workflow 9B Stage 1b (U))', () => {
  it('keeps every existing assignment organisation-wide: environment_ids NULL (C167.2)', async () => {
    const { rows } = await upgraded.query<{ environment_ids: string[] | null }>(
      'select environment_ids from user_roles where user_id = $1',
      [access.userId],
    );
    expect(rows).toEqual([{ environment_ids: null }]);
  });

  it('keeps an existing session satisfied, with no factor check recorded yet (C168.1)', async () => {
    const { rows } = await upgraded.query<{ mfa_satisfied: boolean; mfa_verified_at: Date | null }>(
      'select mfa_satisfied, mfa_verified_at from user_sessions where id = $1',
      [access.sessionId],
    );
    expect(rows).toEqual([{ mfa_satisfied: true, mfa_verified_at: null }]);
  });

  it('keeps an existing organisation without require-mfa, and starts a new one with it (C168.2)', async () => {
    const created = testId('org');
    await upgraded.query(`insert into organizations (id, name) values ($1, 'Example Later Org')`, [
      created,
    ]);
    const { rows } = await upgraded.query<{ id: string; require_mfa: boolean }>(
      'select id, require_mfa from organizations where id = any($1)',
      [[access.organizationId, created]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.require_mfa]))).toEqual({
      [access.organizationId]: false,
      [created]: true,
    });
  });

  it('adds the audit IP index empty, and the earlier audit entry stays append-only (C168.6, P23)', async () => {
    const { rows } = await upgraded.query<{ count: number }>(
      'select count(*)::int as count from audit_log_ip_index',
    );
    expect(rows).toEqual([{ count: 0 }]);
    await expect(
      upgraded.query(`update audit_logs set action = 'inquiry.declined' where public_id = $1`, [
        access.auditPublicId,
      ]),
    ).rejects.toThrow('audit_logs is append-only');
  });
});

describe('migration 0031: keys, webhooks and notifications on an upgraded database (Workflow 9B Stage 1b (W))', () => {
  it('keeps an existing key with no note and an empty blocklist (C169.1, C169.3)', async () => {
    const { rows } = await upgraded.query<{ note: string | null; attribute_blocklist: string[] }>(
      'select note, attribute_blocklist from api_keys where id = $1',
      [keysWebhooks.apiKeyId],
    );
    expect(rows).toEqual([{ note: null, attribute_blocklist: [] }]);
  });

  it('keeps an existing webhook with no name, description or failure alert (C169.5, C169.6)', async () => {
    const { rows } = await upgraded.query(
      `select name, description, failure_alert_enabled, failure_alert_threshold,
              failure_alert_window_minutes, failure_alert_notified_at from webhooks where id = $1`,
      [keysWebhooks.webhookId],
    );
    expect(rows).toEqual([
      {
        name: null,
        description: null,
        failure_alert_enabled: null,
        failure_alert_threshold: null,
        failure_alert_window_minutes: null,
        failure_alert_notified_at: null,
      },
    ]);
  });

  it('keeps Phase 8’s notification about its case, now read as subject case (C169.7, F18)', async () => {
    const { rows } = await upgraded.query(
      `select kind, case_id, webhook_id, subject_type, subject_id from user_notifications
        where id = $1`,
      [keysWebhooks.notificationId],
    );
    expect(rows).toEqual([
      {
        kind: 'assigned',
        case_id: keysWebhooks.caseId,
        webhook_id: null,
        subject_type: 'case',
        subject_id: keysWebhooks.caseId,
      },
    ]);
  });

  it('takes a webhook failure about the earlier webhook, and refuses a case kind about a webhook', async () => {
    await upgraded.query(
      `insert into user_notifications (id, environment_id, user_id, kind, webhook_id)
       select $1, environment_id, $2, 'webhook-failure', id from webhooks where id = $3`,
      [testId('unot'), access.userId, keysWebhooks.webhookId],
    );
    await expect(
      upgraded.query(
        `insert into user_notifications (id, environment_id, user_id, kind, webhook_id)
         select $1, environment_id, $2, 'assigned', id from webhooks where id = $3`,
        [testId('unot'), access.userId, keysWebhooks.webhookId],
      ),
    ).rejects.toThrow('user_notifications_assigned_subject');
  });

  it('adds notification_preferences and webhook_alert_emails, empty', async () => {
    for (const table of ['notification_preferences', 'webhook_alert_emails']) {
      const { rows } = await upgraded.query<{ count: number }>(
        `select count(*)::int as count from ${table}`,
      );
      expect(rows, table).toEqual([{ count: 0 }]);
    }
  });
});

describe('migration 0031: exports, saved views, bulk reports and filters on an upgraded database (Workflow 9B Stage 1b (X))', () => {
  /** 0031's statements, in order. */
  const statements = () =>
    readFileSync(new URL('../drizzle/0031_phase9b.sql', import.meta.url), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

  it("adds report_origin's bulk first, and never uses it in the same migration (Phase 8 amendment 2)", () => {
    const all = statements();
    expect(all[0]).toBe(`ALTER TYPE "public"."report_origin" ADD VALUE 'bulk';`);
    expect(all.slice(1).some((statement) => statement.includes("'bulk'"))).toBe(false);
  });

  it('keeps an earlier report and its origin, and takes the origin bulk after the commit (C166.5)', async () => {
    const before = await upgraded.query<{ origin: string }>(
      'select origin from reports where id = $1',
      [exportsSeed.reportId],
    );
    expect(before.rows).toEqual([{ origin: 'api' }]);

    await upgraded.query(`update reports set origin = 'bulk' where id = $1`, [
      exportsSeed.reportId,
    ]);

    const after = await upgraded.query<{ origin: string }>(
      'select origin from reports where id = $1',
      [exportsSeed.reportId],
    );
    expect(after.rows).toEqual([{ origin: 'bulk' }]);
  });

  it('keeps an earlier transaction with no filter value, and takes one for it (C165.3)', async () => {
    const count = async () =>
      (
        await upgraded.query<{ count: number }>(
          'select count(*)::int as count from transaction_filter_values where transaction_id = $1',
          [exportsSeed.transactionId],
        )
      ).rows;
    expect(await count()).toEqual([{ count: 0 }]);

    await upgraded.query(
      `insert into transaction_filter_values (environment_id, transaction_id, field_key, value)
       values ($1, $2, 'channel', 'web')`,
      [seeded.environmentId, exportsSeed.transactionId],
    );

    expect(await count()).toEqual([{ count: 1 }]);
  });

  it('adds exports, saved_views, report_bulk_jobs and report_bulk_job_rows, empty', async () => {
    for (const table of ['exports', 'saved_views', 'report_bulk_jobs', 'report_bulk_job_rows']) {
      const { rows } = await upgraded.query<{ count: number }>(
        `select count(*)::int as count from ${table}`,
      );
      expect(rows, table).toEqual([{ count: 0 }]);
    }
  });
});

describe('migration 0031: case completions on an upgraded database (Workflow 9B Stage 1b (C))', () => {
  it('keeps an earlier version with the default layout, no checklist and no preset comment (C172.1)', async () => {
    const { rows } = await upgraded.query(
      'select layout, checklists, preset_comments from case_template_versions where id = $1',
      [casesSeed.versionId],
    );
    expect(rows).toEqual([{ layout: null, checklists: [], preset_comments: [] }]);
  });

  it('keeps an earlier action in the header, restricting nothing, and takes the new placements (B34)', async () => {
    const { rows } = await upgraded.query(
      'select placement, visible_when from case_actions where id = $1',
      [casesSeed.caseActionId],
    );
    expect(rows).toEqual([{ placement: 'header', visible_when: null }]);

    for (const placement of ['status-switcher', 'module:summary']) {
      await upgraded.query('update case_actions set placement = $2 where id = $1', [
        casesSeed.caseActionId,
        placement,
      ]);
    }
    await expect(
      upgraded.query(`update case_actions set placement = 'footer' where id = $1`, [
        casesSeed.caseActionId,
      ]),
    ).rejects.toThrow('case_actions_placement_valid');
  });

  it('takes the checklist history kinds on an earlier case, and adds case_checklist_states empty (C172.2)', async () => {
    await upgraded.query(
      `insert into case_history (environment_id, case_id, kind, actor_type, actor_id)
       values ($1, $2, 'checklist-item-checked', 'user', $3)`,
      [casesSeed.environmentId, keysWebhooks.caseId, access.userId],
    );
    const { rows } = await upgraded.query<{ count: number }>(
      'select count(*)::int as count from case_checklist_states',
    );
    expect(rows).toEqual([{ count: 0 }]);
  });
});

describe('migration 0031: the carried 9A columns on an upgraded database (Workflow 9B Stage 1b (F))', () => {
  it('keeps an earlier inquiry with no window of its own, so its version decides (C151.10; B44)', async () => {
    const { rows } = await upgraded.query(
      `select expiration_after_start_seconds, expiration_after_resume_seconds,
              one_time_link_expiration_seconds
         from inquiries where id = $1`,
      [seeded.inquiryId],
    );
    expect(rows).toEqual([
      {
        expiration_after_start_seconds: null,
        expiration_after_resume_seconds: null,
        one_time_link_expiration_seconds: null,
      },
    ]);
    await upgraded.query(
      'update inquiries set expiration_after_start_seconds = 3600 where id = $1',
      [seeded.inquiryId],
    );
    await expect(
      upgraded.query('update inquiries set one_time_link_expiration_seconds = 60 where id = $1', [
        seeded.inquiryId,
      ]),
    ).rejects.toThrow('inquiries_expiry_overrides_range');
  });

  it('keeps an earlier published version with no recorded grant (C152.2; B45)', async () => {
    const { rows } = await upgraded.query(
      `select v.flow_run_grants from inquiry_template_versions v
         join inquiries i on i.inquiry_template_version_id = v.id where i.id = $1`,
      [seeded.inquiryId],
    );
    expect(rows).toEqual([{ flow_run_grants: [] }]);
  });
});
