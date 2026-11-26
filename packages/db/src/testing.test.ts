import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createKeyring, getDefaultKeyring, setDefaultKeyring } from './crypto.js';
import { appendAuditLog } from './repositories/audit-logs.js';
import { migrationTags, runMigrations } from './migrate.js';
import { organizations } from './schema.js';
import {
  ID_PREFIXES,
  POSTGRES_TEST_COMMAND,
  createIntegrationPool,
  createTestDatabase,
  createdAtClock,
  seedReport,
  seedReportTemplate,
  wallClockStepsBack,
  PGLITE_EXTENSIONS,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from './testing.js';

const V2_TABLES = [
  'account_actions',
  'account_exports',
  'account_relations',
  'account_types',
  'accounts',
  'analytics_case_assignee_daily',
  'analytics_case_daily',
  'analytics_check_daily',
  'analytics_check_reason_daily',
  'analytics_inquiry_daily',
  'analytics_inquiry_tag_daily',
  'analytics_path_daily',
  'analytics_rollup_state',
  'analytics_signal_daily',
  'analytics_step_daily',
  'analytics_transition_daily',
  'analytics_verification_daily',
  'analytics_verification_step_daily',
  'api_keys',
  'api_logs',
  'audit_log_ip_index',
  'audit_logs',
  'business_registry_records',
  'case_accounts',
  'case_action_templates',
  'case_actions',
  'case_assignment_policies',
  'case_assignment_policy_sources',
  'case_attachments',
  'case_bulk_actions',
  'case_calendars',
  'case_checklist_states',
  'case_comments',
  'case_exports',
  'case_field_keys',
  'case_graph_queries',
  'case_history',
  'case_inquiries',
  'case_name_counters',
  'case_notification_emails',
  'case_queue_members',
  'case_queues',
  'case_report_runs',
  'case_reports',
  'case_sla_policies',
  'case_template_versions',
  'case_templates',
  'case_transactions',
  'case_verifications',
  'cases',
  'chip_challenges',
  'chip_reads',
  // Workflow 11A Stage 1b (C) (C230.5).
  'connect_connections',
  'connect_share_policies',
  'connect_share_tokens',
  // Workflow 11A Stage 1b (K) (C230.5).
  'consent_records',
  'consent_texts',
  'crypto_challenges',
  'deployments',
  'devices',
  'document_extractions',
  'environments',
  'events',
  'exports',
  'face_templates',
  'file_renditions',
  'files',
  'government_id_extractions',
  'graph_attributes',
  'graph_components',
  'graph_index_jobs',
  'graph_index_state',
  'graph_queries',
  'graph_query_template_versions',
  'graph_query_templates',
  'handoff_tokens',
  'idempotency_keys',
  'importers',
  'inquiries',
  'inquiry_decisions',
  'inquiry_flow_actions',
  'inquiry_flow_signal_snapshots',
  'inquiry_flow_steps',
  'inquiry_handoff_steps',
  // Workflow 10B Stage 1b (I) (C221.3).
  'inquiry_integrity_challenges',
  'inquiry_integrity_verdicts',
  'inquiry_session_signals',
  'inquiry_sessions',
  'inquiry_signal_computations',
  'inquiry_template_promotions',
  'inquiry_template_versions',
  'inquiry_templates',
  'list_import_errors',
  'list_import_rows',
  'list_item_backgrounds',
  'list_item_faces',
  'list_item_geo',
  'list_item_ip_ranges',
  'list_item_keys',
  'list_items',
  'list_matches',
  'list_rescreen_requests',
  'list_screenings',
  'lists',
  'mfa_challenges',
  'mfa_factors',
  'mfa_recovery_codes',
  'network_sources',
  'network_syncs',
  'networks',
  'notification_preferences',
  'one_time_links',
  'organizations',
  'otp_challenges',
  'otp_verification_states',
  'queue_slots',
  'rendition_pages',
  'report_accounts',
  'report_actions',
  'report_bulk_job_rows',
  'report_bulk_jobs',
  'report_matches',
  'report_runs',
  'report_template_versions',
  'report_templates',
  'reports',
  'roles',
  'saved_views',
  'scheduled_runs',
  'selfie_backgrounds',
  'selfie_captures',
  'session_devices',
  'simulation_presets',
  'sso_login_states',
  'sso_providers',
  'theme_assets',
  'theme_set_revisions',
  'theme_sets',
  'transaction_children',
  'transaction_field_keys',
  'transaction_files',
  'transaction_filter_values',
  'transaction_labels',
  'transaction_objects',
  'transaction_relations',
  'transaction_status_history',
  'transaction_type_versions',
  'transaction_types',
  'transactions',
  'trust_anchor_memberships',
  'trust_anchor_sources',
  'trust_anchor_syncs',
  'trust_anchors',
  'trust_crls',
  'user_notifications',
  'user_roles',
  'user_sessions',
  'user_sso_identities',
  'users',
  'verification_checks',
  'verification_inputs',
  'verifications',
  'watchlist_crypto_addresses',
  'watchlist_entries',
  'watchlist_identifiers',
  'watchlist_key_df',
  'watchlist_names',
  'watchlist_sources',
  'watchlist_syncs',
  'webauthn_registration_challenges',
  'webhook_alert_emails',
  'webhook_deliveries',
  'webhooks',
  'workflow_deployments',
  'workflow_run_files',
  'workflow_run_journal',
  'workflow_run_steps',
  'workflow_run_subjects',
  'workflow_runs',
  'workflow_schedules',
  'workflow_secret_values',
  'workflow_secrets',
  'workflow_step_effects',
  'workflow_trigger_deliveries',
  'workflow_triggers',
  'workflow_versions',
  'workflow_wait_candidates',
  'workflow_wait_index',
  'workflows',
];

describe('createTestDatabase', () => {
  let first: TestDatabase;
  let second: TestDatabase;

  beforeAll(async () => {
    first = await createTestDatabase();
    second = await createTestDatabase();
  });

  afterAll(async () => {
    await first.close();
    await second.close();
  });

  it('applies every migration, including the pgvector extension', async () => {
    const tables = await first.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const distance = await first.client.query<{ distance: number }>(
      `select '[1,2,3]'::vector <-> '[1,2,5]'::vector as distance`,
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual(V2_TABLES);
    expect(distance.rows[0]?.distance).toBe(2);
  });

  it('loads pgvector and pg_trgm in every PGlite instance (C73.1, F16)', () => {
    expect(Object.keys(PGLITE_EXTENSIONS).sort()).toEqual(['pg_trgm', 'vector']);
  });

  it('runs Postgres 17, the production major version', async () => {
    const version = await first.client.query<{ server_version: string }>('show server_version');

    expect(version.rows[0]?.server_version).toMatch(/^17\./);
  });

  it('gives every call its own isolated database', async () => {
    await createTestTenant(first.db);

    expect(await first.db.$count(organizations)).toBe(1);
    expect(await second.db.$count(organizations)).toBe(0);
  });

  it('can re-run migrations without applying anything twice', async () => {
    await runMigrations(first.db);

    const applied = await first.db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0]?.count).toBe(migrationTags().length);
  });

  it('installs one synthetic process keyring for the encrypted columns', () => {
    expect(second.keyring).toBe(first.keyring);
    expect(getDefaultKeyring()).toBe(first.keyring);
  });

  it('accepts an explicit keyring', async () => {
    const keyring = createKeyring(randomBytes(32));
    const third = await createTestDatabase({ keyring });
    try {
      expect(third.keyring).toBe(keyring);
      expect(getDefaultKeyring()).toBe(keyring);
    } finally {
      await third.close();
      setDefaultKeyring(first.keyring);
    }
  });
});

describe('createIntegrationPool', () => {
  // node-postgres emits an idle client's lost connection on the pool. No server is needed: the
  // pool connects lazily, and these tests emit what node-postgres would.
  const pools: ReturnType<typeof createIntegrationPool>[] = [];
  const pool = () => {
    const created = createIntegrationPool('postgres://user:pass@127.0.0.1:1/unused', { max: 2 });
    pools.push(created);
    return created;
  };
  afterAll(async () => {
    await Promise.all(pools.map((created) => created.end()));
  });

  it('ignores the shutdown notice an idle client gets when the test container stops', () => {
    const shutdown = Object.assign(
      new Error('terminating connection due to administrator command'),
      {
        code: '57P01',
      },
    );

    expect(() => pool().emit('error', shutdown)).not.toThrow();
  });

  it('still raises any other idle client error', () => {
    const lost = Object.assign(new Error('connection failure'), { code: '08006' });

    expect(() => pool().emit('error', lost)).toThrow(lost);
  });

  it('keeps the pool options it is given', () => {
    expect(pool().options.max).toBe(2);
  });
});

describe('testId', () => {
  it.each(Object.values(ID_PREFIXES))('makes a C1 id with the %s prefix', (prefix) => {
    expect(testId(prefix)).toMatch(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => testId('inq')));

    expect(ids.size).toBe(1000);
  });

  it('sorts by creation time, like a ULID', () => {
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(Date.UTC(2026, 9, 20, 12, 0, 0));
      const earlier = testId('evt');
      now.mockReturnValue(Date.UTC(2026, 9, 20, 12, 0, 1));
      const later = testId('evt');

      expect(earlier < later).toBe(true);
      // ULID time component; the encoder matches the spec vector 1469918176385 -> 01ARYZ6S41.
      expect(earlier.slice(4, 14)).toBe('01M5CJXHG0');
    } finally {
      now.mockRestore();
    }
  });
});

describe('createTestTenant', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  it('creates a synthetic organization with a sandbox environment', async () => {
    const { organization, environment } = await createTestTenant(database.db);

    expect(organization.id).toMatch(/^org_/);
    expect(environment).toMatchObject({ organizationId: organization.id, kind: 'sandbox' });
    expect(environment.id).toMatch(/^env_/);
  });

  it('can create a production environment with a chosen name', async () => {
    const { organization, environment } = await createTestTenant(database.db, {
      kind: 'production',
      organizationName: 'Prod Example',
    });

    expect(organization.name).toBe('Prod Example');
    expect(environment.kind).toBe('production');
  });
});

describe('createTestInquiry', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  it('creates a template and an inquiry on its latest version', async () => {
    const { environment } = await createTestTenant(database.db);

    const { template, inquiry } = await createTestInquiry(database.db, environment.id);

    expect(template.environmentId).toBe(environment.id);
    expect(inquiry).toMatchObject({
      environmentId: environment.id,
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
      status: 'created',
      fields: {},
      referenceId: null,
    });
  });

  it('accepts a reference, fields, flow and verification config', async () => {
    const { environment } = await createTestTenant(database.db);

    const { template, inquiry } = await createTestInquiry(database.db, environment.id, {
      referenceId: 'ref-1',
      fields: { 'name-first': 'Synthetic' },
      flow: { steps: ['consent'] },
      verificationConfig: { selfie: { checks: {} } },
    });

    expect(inquiry).toMatchObject({ referenceId: 'ref-1', fields: { 'name-first': 'Synthetic' } });
    expect(template.latestVersion).toMatchObject({
      flow: { steps: ['consent'] },
      verificationConfig: { selfie: { checks: {} } },
    });
  });
});

// Vitest runs each test file in a fresh module, so a template kept only in memory was rebuilt by
// every file: all the migrations, 2 to 3 s alone and past 60 s under the full validation's load
// (after Workflow 6B). The template is kept on disk, named by the migrations.
describe('the migrated template on disk', () => {
  let dir: string;
  const previous = process.env.OPENVERIFY_TEST_DB_CACHE_DIR;

  /** The testing module as a new test file sees it: nothing kept in memory. */
  const fresh = async () => {
    vi.resetModules();
    return import('./testing.js');
  };

  // One cold build serves the first, third and fourth tests, which each migrated again before and
  // each passed its 60 s alone under the full validation's load (Workflow 8D V8C-1). The build
  // starts from what those three tests need: a stored template it cannot open, older templates
  // and an abandoned partial write. It runs in this hook, under the 120 s PGlite hook guard.
  let template: string;
  let older: string[];
  let kept: number;
  let built: TestDatabase;
  let builtTables: number;
  let builtListing: string[];
  let builtTemplate: Buffer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'openverify-template-test-'));
    process.env.OPENVERIFY_TEST_DB_CACHE_DIR = dir;
    const testing = await fresh();
    template = testing.migratedTemplatePath();
    kept = testing.MIGRATED_TEMPLATES_KEPT;
    writeFileSync(template, 'not a data directory');
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    older = Array.from({ length: 10 }, (_, index) => {
      const file = path.join(dir, `${String(index).padStart(64, '0')}.tar`);
      writeFileSync(file, 'an older template');
      utimesSync(file, minutesAgo(index + 1), minutesAgo(index + 1));
      return path.basename(file);
    });
    const abandoned = path.join(dir, `${path.basename(template)}.1234.00000000.partial`);
    writeFileSync(abandoned, 'half a template');
    utimesSync(abandoned, minutesAgo(120), minutesAgo(120));

    built = await testing.createTestDatabase();
    const tables = await built.client.query(
      `select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    );
    builtTables = (tables.rows[0] as { count: number }).count;
    builtListing = readdirSync(dir).sort();
    builtTemplate = readFileSync(template);
  });

  afterAll(async () => {
    await built.close();
    if (previous === undefined) {
      delete process.env.OPENVERIFY_TEST_DB_CACHE_DIR;
    } else {
      process.env.OPENVERIFY_TEST_DB_CACHE_DIR = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores the template the first file builds, named by a hash of the migrations', () => {
    expect(path.dirname(template)).toBe(dir);
    expect(path.basename(template)).toMatch(/^[0-9a-f]{64}\.tar$/);
    // The one file the build wrote: no partial write left, the abandoned one gone.
    expect(builtListing.filter((name) => !older.includes(name))).toEqual([path.basename(template)]);
    expect(builtTemplate.length).toBeGreaterThan(1_000_000);
  });

  it('opens the stored template in a new file instead of migrating again', async () => {
    await built.client.exec('create table template_marker (id int)');
    writeFileSync(
      template,
      Buffer.from(await (await built.client.dumpDataDir('none')).arrayBuffer()),
    );

    const reader = await fresh();
    const database = await reader.createTestDatabase();
    const marker = await database.client.query(`select to_regclass('template_marker') as found`);
    await database.close();

    expect(marker.rows).toEqual([{ found: 'template_marker' }]);
  });

  it('rebuilds a stored template it cannot open, and stores the new one', () => {
    expect(builtTables).toBeGreaterThan(50);
    expect(builtTemplate.toString('utf8', 0, 20)).not.toBe('not a data directory');
    expect(builtTemplate.length).toBeGreaterThan(1_000_000);
  });

  it('keeps the most recently used templates only, so changed migrations do not fill the disk', () => {
    expect(builtListing).toEqual([path.basename(template), ...older.slice(0, kept - 1)].sort());
  });

  it('marks a template as used when it opens it, so pruning keeps the ones in use', async () => {
    const testing = await fresh();
    const template = testing.migratedTemplatePath();
    const long = new Date(Date.now() - 24 * 60 * 60_000);
    utimesSync(template, long, long);

    const database = await testing.createTestDatabase();
    await database.close();

    expect(statSync(template).mtimeMs).toBeGreaterThan(Date.now() - 60_000);
  });
});

/** The repository's root, from this file (`packages/db/src`). */
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** Every source file under `dir` a test or a script can start a container from. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', 'coverage', '.next'].includes(entry.name)
        ? []
        : sourceFiles(full);
    }
    return /\.(?:ts|tsx|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

/** Built, so this file does not hold them literally and does not find itself. */
const NEW_CONTAINER = ['new', 'PostgreSqlContainer('].join(' ');
const IMAGE_COMMAND = ['imageCommand', 'true'].join(': ');

/** Every source file under `apps/*` and `packages/*` (`src`, `scripts`), from the root. */
function repositorySources(): string[] {
  return ['apps', 'packages']
    .flatMap((top) =>
      readdirSync(path.join(REPO_ROOT, top), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) =>
          ['src', 'scripts']
            .map((sub) => path.join(REPO_ROOT, top, entry.name, sub))
            .filter((dir) => {
              try {
                return statSync(dir).isDirectory();
              } catch {
                return false;
              }
            }),
        ),
    )
    .flatMap(sourceFiles);
}

describe('POSTGRES_TEST_COMMAND (C73.8, P18, owner decision 15: K6A-5)', () => {
  it('starts Postgres without logging bind parameters, as compose does', () => {
    expect(POSTGRES_TEST_COMMAND).toEqual([
      'postgres',
      '-c',
      'log_parameter_max_length=0',
      '-c',
      'log_parameter_max_length_on_error=0',
    ]);
  });

  it('starts every Testcontainers Postgres of the repository through startIntegrationPostgres (K7B-13), which passes it', () => {
    const sources = repositorySources().map((file) => ({
      file: path.relative(REPO_ROOT, file),
      text: readFileSync(file, 'utf8'),
    }));
    const constructing = sources.filter(({ text }) => text.includes(NEW_CONTAINER));
    const plain = sources.filter(({ text }) => text.includes(IMAGE_COMMAND));

    // The helper is the one place a container is made; the unit tests read its command.
    expect(constructing.map(({ file }) => file)).toEqual([
      'packages/db/src/integration-postgres.ts',
    ]);
    // The one exemption: the log test's control, a Postgres started plainly on purpose to show
    // that a logged parameter is seen (6B fix-api amendment 15, R003); and the helper's unit test,
    // which starts nothing.
    expect(plain.map(({ file }) => file).sort()).toEqual([
      'packages/db/src/integration-postgres.test.ts',
      'packages/db/src/postgres-logging.integration.test.ts',
    ]);
  });
});

describe('the clocks of ordered rows (owner decision 15 after 6B, P5-6)', () => {
  let clockDatabase: TestDatabase;

  beforeAll(async () => {
    clockDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await clockDatabase.close();
  });

  it('wallClockStepsBack makes every Date.now() reading a millisecond earlier, then restores the wall clock', () => {
    const wallClock = Date.now;
    const restore = wallClockStepsBack();
    const readings = [Date.now(), Date.now(), Date.now()];
    restore();

    expect([
      (readings[1] ?? 0) - (readings[0] ?? 0),
      (readings[2] ?? 0) - (readings[1] ?? 0),
    ]).toEqual([-1, -1]);
    expect(Date.now).toBe(wallClock);
  });

  it('wallClockStepsBack takes PGlite now() back with it, as two rows written back to back show', async () => {
    const { environment } = await createTestTenant(clockDatabase.db);
    const restore = wallClockStepsBack();
    try {
      const { inquiry: first } = await createTestInquiry(clockDatabase.db, environment.id);
      const { inquiry: second } = await createTestInquiry(clockDatabase.db, environment.id);

      expect(second.createdAt.getTime()).toBeLessThan(first.createdAt.getTime());
    } finally {
      restore();
    }
  });

  it('createdAtClock stamps each row a second after the last, created_at and updated_at alike', async () => {
    const { environment } = await createTestTenant(clockDatabase.db);
    const { inquiry: first } = await createTestInquiry(clockDatabase.db, environment.id);
    const { inquiry: second } = await createTestInquiry(clockDatabase.db, environment.id);
    const clock = createdAtClock(clockDatabase.db, new Date('2026-10-01T00:00:00.000Z'));

    const stamped = await clock.stamp('inquiries', first);
    const at = await clock.at('inquiries', second.id);

    const one = new Date('2026-10-01T00:00:01.000Z');
    expect(stamped).toEqual({ ...first, createdAt: one, updatedAt: one });
    expect(at).toEqual(new Date('2026-10-01T00:00:02.000Z'));
    const rows = await clockDatabase.db.execute<{
      id: string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      sql`select id, created_at, updated_at from inquiries
          where id in (${first.id}, ${second.id}) order by created_at`,
    );
    const two = new Date('2026-10-01T00:00:02.000Z');
    expect(
      rows.rows.map((row) => [row.id, new Date(row.created_at), new Date(row.updated_at)]),
    ).toEqual([
      [first.id, one, one],
      [second.id, two, two],
    ]);
  });

  it('createdAtClock stamps a row by another key column or a bigint id, in an append-only table too', async () => {
    const { environment } = await createTestTenant(clockDatabase.db);
    const entry = (action: string) =>
      appendAuditLog(clockDatabase.db, environment.id, { actorType: 'system', action });
    const first = await entry('inquiry.approved');
    const second = await entry('inquiry.declined');
    const clock = createdAtClock(clockDatabase.db, new Date('2026-10-01T00:00:00.000Z'));

    await clock.at('audit_logs', first.publicId, 'public_id');
    await clock.at('audit_logs', second.id);

    const rows = await clockDatabase.db.execute<{ public_id: string; created_at: Date | string }>(
      sql`select public_id, created_at from audit_logs
          where public_id in (${first.publicId}, ${second.publicId}) order by created_at`,
    );
    expect(rows.rows.map((row) => [row.public_id, new Date(row.created_at)])).toEqual([
      [first.publicId, new Date('2026-10-01T00:00:01.000Z')],
      [second.publicId, new Date('2026-10-01T00:00:02.000Z')],
    ]);
  });

  it('createdAtClock stamps created_at alone on a table without updated_at, and starts at the wall clock by default', async () => {
    const { environment } = await createTestTenant(clockDatabase.db);
    const { templateId, versionId } = await seedReportTemplate(clockDatabase.db, environment.id);
    const reportId = await seedReport(clockDatabase.db, environment.id, { templateId, versionId });
    const before = Date.now();

    const at = await createdAtClock(clockDatabase.db).at('reports', reportId);

    expect(at.getTime() - before).toBeGreaterThanOrEqual(1_000);
    expect(at.getTime() - before).toBeLessThan(61_000);
    const rows = await clockDatabase.db.execute<{ created_at: Date | string }>(
      sql`select created_at from reports where id = ${reportId}`,
    );
    expect(new Date(rows.rows[0]?.created_at ?? 0)).toEqual(at);
  });
});
