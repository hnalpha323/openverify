import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';

interface Journal {
  dialect: string;
  entries: { idx: number; tag: string }[];
}

const packageRoot = path.resolve(import.meta.dirname, '..');
const journal = (): Journal =>
  JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
const migrationSql = (index: number): string =>
  readFileSync(path.join(MIGRATIONS_FOLDER, `${journal().entries[index]?.tag ?? ''}.sql`), 'utf8');

describe('migrations', () => {
  it('lives in the package drizzle/ folder, next to src and dist', () => {
    expect(MIGRATIONS_FOLDER).toBe(path.join(packageRoot, 'drizzle'));
  });

  it('has a drizzle-kit journal whose entries all have SQL files', () => {
    expect(journal().dialect).toBe('postgresql');
    expect(journal().entries.length).toBeGreaterThan(0);
    for (const entry of journal().entries) {
      expect(existsSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)), entry.tag).toBe(true);
    }
  });

  it('creates the schema v0 tables in the first migration', () => {
    const sql = migrationSql(0);

    for (const table of ['organizations', 'environments', 'api_keys']) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain(`CREATE TYPE "public"."environment_kind"`);
  });

  it('adds schema v1 as 0001_schema_v1, one file per kind as 0002, then schema v2', () => {
    expect(
      journal()
        .entries.map((entry) => entry.tag)
        .slice(0, 4),
    ).toEqual(['0000_schema_v0', '0001_schema_v1', '0002_files_unique_kind', '0003_schema_v2']);
  });

  it('adds the Workflow 2B review fixes after schema v2', () => {
    expect(
      journal()
        .entries.map((entry) => entry.tag)
        .slice(4, 9),
    ).toEqual([
      '0004_api_key_pii_masked',
      '0005_redaction_subject_ids',
      '0006_retention_created_at_indexes',
      '0007_expired_credential_indexes',
      '0008_accounts_consolidated_into_index',
    ]);
    expect(migrationSql(4)).toContain(
      'ALTER TABLE "api_keys" ADD COLUMN "pii_masked" boolean DEFAULT false NOT NULL',
    );
    expect(migrationSql(5)).toContain('CREATE INDEX "api_logs_subject_ids_idx"');
  });

  it('adds the Workflow 2E API log index after the 2B fixes', () => {
    expect(
      journal()
        .entries.map((entry) => entry.tag)
        .slice(9, 10),
    ).toEqual(['0009_api_logs_user_id_index']);
    expect(migrationSql(9)).toContain(
      'CREATE INDEX "api_logs_environment_id_user_id_created_at_id_idx" ON "api_logs"',
    );
  });

  it('adds needs_review to verification_status in its own migration, 0011 (C30.4)', () => {
    expect(journal().entries[11]?.tag).toBe('0011_verification_needs_review');
    // Postgres cannot use a new enum value in the transaction that adds it, so the migration holds
    // nothing else, and no migration in the same batch may use the value.
    expect(migrationSql(11).trim()).toBe(
      `ALTER TYPE "public"."verification_status" ADD VALUE 'needs_review';`,
    );
  });

  it('creates the government ID extraction table in 0012 (C31.7)', () => {
    expect(journal().entries[12]?.tag).toBe('0012_government_id_extractions');
    const sql = migrationSql(12);
    expect(sql).toContain('CREATE TABLE "government_id_extractions"');
    expect(sql).toContain('GENERATED ALWAYS AS');
    expect(sql).not.toContain('needs_review');
  });

  it('adds the Phase 3 check result columns in 0010 (C29.2)', () => {
    expect(journal().entries[10]?.tag).toBe('0010_check_result_provenance');
    const sql = migrationSql(10);
    for (const column of ['"stage" text', '"confidence" double precision', '"provenance" jsonb']) {
      expect(sql).toContain(`ALTER TABLE "verification_checks" ADD COLUMN ${column}`);
    }
    expect(sql).toContain('"verification_checks_stage_valid"');
    expect(sql).toContain('"verification_checks_confidence_unit_interval"');
  });

  it('holds only the Phase 5 enum changes in 0016, hand-written so no type is recreated (C50.1, C52.4, F23)', () => {
    expect(journal().entries[16]?.tag).toBe('0016_phase5_verification_types');
    const statements = migrationSql(16)
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim());
    expect(statements).toEqual([
      `ALTER TYPE "public"."verification_type" RENAME VALUE 'business' TO 'database_business';`,
      `ALTER TYPE "public"."verification_type" ADD VALUE 'aamva' AFTER 'database';`,
      `ALTER TYPE "public"."verification_type" ADD VALUE 'business_website';`,
      ...[
        'document',
        'chip-sod',
        'chip-dg1',
        'chip-dg2',
        'chip-dg14',
        'chip-dg15',
        'chip-card-security',
        'chip-card-access',
        'chip-com',
        'document-preview',
        'chip-portrait',
      ].map((kind) => `ALTER TYPE "public"."file_kind" ADD VALUE '${kind}';`),
    ]);
    // drizzle-kit would drop and recreate the type for the rename; nothing may use a value the
    // batch adds (Postgres refuses that inside the migration transaction).
    expect(migrationSql(16)).not.toMatch(
      /CREATE TYPE|DROP TYPE|USING|INSERT|UPDATE|SET DATA TYPE/i,
    );
  });

  it('creates the four Workflow 5A tables in 0017 and changes nothing else (C53.2)', () => {
    expect(journal().entries[17]?.tag).toBe('0017_phase5_inputs_otp_crypto');
    const sql = migrationSql(17);
    const created = [...sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([
      'crypto_challenges',
      'otp_challenges',
      'otp_verification_states',
      'verification_inputs',
    ]);
    // 0016 added enum values; this batch must not use one (F23), drop or retype anything.
    const statements = sql.split('--> statement-breakpoint').map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    );
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(CREATE TABLE|ALTER TABLE \S+ ADD CONSTRAINT|CREATE (UNIQUE )?INDEX|CREATE TRIGGER)/,
      );
      expect(statement).not.toMatch(/SET DATA TYPE|ALTER TYPE/i);
    }
    for (const table of created) {
      expect(sql, `${String(table)} reaches its verification and inquiry`).toMatch(
        new RegExp(
          `ALTER TABLE "${String(table)}" ADD CONSTRAINT "${String(table)}_verification_fk"`,
        ),
      );
    }
  });

  it('creates the nine Workflow 5B tables in 0018 and changes nothing else (C53.3)', () => {
    expect(journal().entries[18]?.tag).toBe('0018_phase5_documents_chips_kyb');
    const sql = migrationSql(18);
    const created = [...sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([
      'business_registry_records',
      'chip_challenges',
      'chip_reads',
      'document_extractions',
      'trust_anchor_memberships',
      'trust_anchor_sources',
      'trust_anchor_syncs',
      'trust_anchors',
      'trust_crls',
    ]);
    const statements = sql.split('--> statement-breakpoint').map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    );
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(CREATE TABLE|ALTER TABLE \S+ ADD CONSTRAINT|CREATE (UNIQUE )?INDEX)/,
      );
      expect(statement).not.toMatch(/SET DATA TYPE|ALTER TYPE|DROP /i);
    }
    for (const table of [
      'business_registry_records',
      'chip_challenges',
      'chip_reads',
      'document_extractions',
    ]) {
      expect(sql, `${table} reaches its verification and inquiry`).toMatch(
        new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_verification_fk"`),
      );
    }
  });

  it('adds only the partial index of submitted verifications in 0019 (Workflow 5C review K1)', () => {
    expect(journal().entries[19]?.tag).toBe('0019_submitted_verifications_index');
    const statements = migrationSql(19)
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim());
    expect(statements).toEqual([
      `CREATE INDEX "verifications_submitted_at_idx" ON "verifications" USING btree ("submitted_at") WHERE "verifications"."status" = 'submitted';`,
    ]);
  });

  it('creates the Phase 6 report and watchlist tables in 0020, with pg_trgm first (C73.1)', () => {
    expect(journal().entries[20]?.tag).toBe('0020_phase6_reports_watchlists');
    const sql = migrationSql(20);
    expect(sql).toMatch(/^CREATE EXTENSION IF NOT EXISTS pg_trgm;/);
    for (const table of [
      'report_templates',
      'report_template_versions',
      'reports',
      'report_accounts',
      'report_runs',
      'report_actions',
      'report_matches',
      'watchlist_sources',
      'watchlist_syncs',
      'watchlist_entries',
      'watchlist_names',
      'watchlist_identifiers',
      'watchlist_crypto_addresses',
      'watchlist_key_df',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain(
      'ALTER TABLE "inquiry_template_versions" ADD COLUMN "report_config" jsonb DEFAULT \'{}\'::jsonb NOT NULL',
    );
    expect(sql).toContain('CREATE TRIGGER "report_actions_append_only"');
    // No earlier table is recreated or dropped (hand-written where drizzle-kit would, F16).
    expect(sql).not.toMatch(/DROP (TABLE|TYPE)/);
  });

  it('adds only the changed-entry page index in 0022 (Workflow 6D review, rescreen-6d)', () => {
    expect(journal().entries[22]?.tag).toBe('0022_watchlist_changed_page_index');
    const statements = migrationSql(22)
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /^CREATE INDEX "watchlist_entries_changed_page_idx" ON "watchlist_entries" USING btree \("source_id","changed_sync_id",\(?"?entry_id"? collate "C"\)?\) WHERE "watchlist_entries"\."removed_at" is null;$/u,
    );
  });

  it('recreates the two report_type CHECK constraints in 0023 with the ip-address type (C106.1)', () => {
    expect(journal().entries[23]?.tag).toMatch(/^0023_/);
    const sql = migrationSql(23);
    for (const constraint of ['report_templates_report_type_valid', 'reports_report_type_valid']) {
      expect(sql).toContain(`DROP CONSTRAINT "${constraint}"`);
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT "${constraint}" CHECK .*'ip-address'`));
    }
  });

  it('narrows the one-live-file index in 0025 and touches nothing else (K7B-5)', () => {
    expect(journal().entries[25]?.tag).toBe('0025_phase7c');
    const sql = migrationSql(25);
    expect(sql).toContain('DROP INDEX "transaction_files_one_live_per_field_key"');
    expect(sql).toMatch(/CREATE UNIQUE INDEX "transaction_files_one_live_per_field_key"[^;]*WHERE/);
    expect(sql).toContain('"transaction_files"."redacted_at" is null');
    expect(sql).not.toMatch(/DROP (TABLE|TYPE|COLUMN)/);
  });

  it('adds the relations page index in 0026 and touches nothing else (K7C-2)', () => {
    expect(journal().entries[26]?.tag).toBe('0026_transaction_relations_page_index');
    const statements = migrationSql(26)
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /^CREATE INDEX "transaction_relations_transaction_created_at_key_target_idx" ON "transaction_relations" USING btree \("environment_id","transaction_id","created_at" DESC NULLS FIRST,"relation_schema_key" DESC NULLS FIRST,"target_id" DESC NULLS FIRST\);$/u,
    );
  });

  it('recreates the two report_type CHECK constraints in 0024 with the custom-list type (C106.2)', () => {
    expect(journal().entries[24]?.tag).toBe('0024_phase7b');
    const sql = migrationSql(24);
    for (const constraint of ['report_templates_report_type_valid', 'reports_report_type_valid']) {
      expect(sql).toContain(`DROP CONSTRAINT "${constraint}"`);
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT "${constraint}" CHECK .*'custom-list'`));
    }
  });

  it('creates the Workflow 7A (N) network tables in 0023, with updated_at triggers and no table recreated (C92, C93)', () => {
    const sql = migrationSql(23);
    for (const table of ['network_sources', 'network_syncs', 'networks']) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
    }
    for (const table of ['network_sources', 'networks']) {
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_set_updated_at"`);
    }
    expect(sql).toContain('ALTER TABLE "inquiry_sessions" ADD COLUMN "network_evaluated_at"');
    expect(sql).not.toMatch(/DROP (TABLE|TYPE)/);
  });

  it('extends 0023 with the Workflow 7A (S) signal and device tables and columns, no table recreated (C90.5, C91, C94.2)', () => {
    const sql = migrationSql(23);
    for (const table of [
      'devices',
      'session_devices',
      'inquiry_session_signals',
      'inquiry_signal_computations',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
    }
    for (const table of ['devices', 'inquiry_signal_computations']) {
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_set_updated_at"`);
    }
    expect(sql).toContain('ALTER TABLE "inquiries" ADD COLUMN "signals"');
    expect(sql).toContain('ALTER TABLE "inquiries" ADD COLUMN "signal_details"');
    expect(sql).toContain('ALTER TABLE "inquiry_template_versions" ADD COLUMN "signal_config"');
    expect(sql).toContain('ALTER TABLE "inquiry_sessions" ADD COLUMN "signals_collected"');
    expect(sql).toContain('ALTER TABLE "inquiry_sessions" ADD COLUMN "signal_bodies_dropped"');
    expect(sql).not.toMatch(/DROP (TABLE|TYPE)/);
  });

  it('extends 0023 with the Workflow 7A (H) handoff tables and columns, no table recreated (C96, V02, V03)', () => {
    const sql = migrationSql(23);
    for (const table of ['handoff_tokens', 'inquiry_handoff_steps']) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_set_updated_at"`);
    }
    for (const column of [
      'device_handoff_method',
      'handoff_from_session_id',
      'handoff_rejected_at',
    ]) {
      expect(sql, column).toContain(`ALTER TABLE "inquiry_sessions" ADD COLUMN "${column}"`);
    }
    expect(sql).toContain('ALTER TABLE "verifications" ADD COLUMN "created_by_session_id"');
    expect(sql).toContain('ALTER TABLE "verifications" ADD COLUMN "from_rejected_handoff"');
    expect(sql).toContain('ALTER TABLE "selfie_captures" ADD COLUMN "created_by_session_id"');
    expect(sql).not.toMatch(/DROP (TABLE|TYPE)/);
  });

  it('extends 0024 with the Workflow 7B (L) list tables, no table recreated (C98, C99, C100)', () => {
    const sql = migrationSql(24);
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    for (const table of ['lists', 'list_items', 'list_matches', 'list_screenings', 'importers']) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_set_updated_at"`);
    }
    for (const table of [
      'list_item_keys',
      'list_item_ip_ranges',
      'list_item_geo',
      'list_item_faces',
      'list_item_backgrounds',
      'list_import_rows',
      'list_import_errors',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain('USING spgist ("range" inet_ops)');
    expect(sql).toContain('USING gist ("bbox" box_ops)');
    expect(sql).toContain('ALTER TABLE "inquiry_template_versions" ADD COLUMN "list_config"');
    expect(sql).not.toMatch(/DROP (TABLE|TYPE)/);
  });

  it('extends 0024 with the Workflow 7B (T) transaction tables and their triggers, no table recreated (C104, C105)', () => {
    const sql = migrationSql(24);
    for (const table of [
      'transaction_types',
      'transaction_type_versions',
      'transactions',
      'transaction_labels',
      'transaction_files',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_set_updated_at"`);
    }
    for (const table of [
      'transaction_status_history',
      'transaction_objects',
      'transaction_relations',
      'transaction_field_keys',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
    }
    for (const table of ['transaction_status_history', 'transaction_labels']) {
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_append_only"`);
    }
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "openverify_transaction_history_append_only"',
    );
    expect(sql).not.toMatch(/DROP (TABLE|TYPE)/);
  });

  it('extends 0024 with the Workflow 7B (G) graph tables, their triggers and the upgrade state, no table recreated (C101, C102)', () => {
    const sql = migrationSql(24);
    for (const table of [
      'graph_index_jobs',
      'graph_index_state',
      'graph_query_templates',
      'graph_query_template_versions',
      'graph_queries',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_set_updated_at"`);
    }
    for (const table of ['graph_attributes', 'graph_components']) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
    }
    // C101.5 (H10): an environment that predates the migration starts every kind incomplete, so
    // the graph-backfill job indexes what it already holds.
    expect(sql).toContain('INSERT INTO "graph_index_state"');
    expect(sql).not.toMatch(/DROP (TABLE|TYPE)/);
  });

  it('makes each file kind unique per verification in 0002', () => {
    expect(migrationSql(2)).toContain(
      'CREATE UNIQUE INDEX "files_environment_id_verification_id_kind_key" ON "files"',
    );
  });

  it('creates every schema v1 table in 0001', () => {
    const sql = migrationSql(1);

    for (const table of [
      'users',
      'user_sessions',
      'inquiry_templates',
      'inquiry_template_versions',
      'inquiries',
      'inquiry_sessions',
      'verifications',
      'verification_checks',
      'files',
      'events',
      'webhooks',
      'webhook_deliveries',
      'audit_logs',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('creates the pgvector extension itself, as the workspace conventions require', () => {
    expect(migrationSql(1)).toMatch(/^CREATE EXTENSION IF NOT EXISTS vector;/m);
  });

  it('converts the v0 uuid keys to C1 text ids', () => {
    const sql = migrationSql(1);

    for (const [table, columnName] of [
      ['organizations', 'id'],
      ['environments', 'id'],
      ['environments', 'organization_id'],
      ['api_keys', 'id'],
      ['api_keys', 'environment_id'],
    ]) {
      expect(sql).toContain(
        `ALTER TABLE "${table ?? ''}" ALTER COLUMN "${columnName ?? ''}" SET DATA TYPE text`,
      );
    }
  });

  it('creates every schema v2 table in 0003, with updated_at triggers', () => {
    const sql = migrationSql(3);

    for (const table of [
      'account_types',
      'accounts',
      'account_relations',
      'one_time_links',
      'idempotency_keys',
      'api_logs',
      'roles',
      'user_roles',
      'mfa_factors',
      'mfa_recovery_codes',
      'mfa_challenges',
      'webauthn_registration_challenges',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`);
      expect(sql, table).toContain(`CREATE TRIGGER "${table}_set_updated_at"`);
    }
  });

  it('backfills Phase 1 rows in SQL inside 0003 (accounts, statuses, ids, roles)', () => {
    const sql = migrationSql(3);

    expect(sql).toContain('CREATE OR REPLACE FUNCTION "openverify_new_id"');
    expect(sql).toContain('INSERT INTO "accounts"');
    expect(sql).toContain('ALTER TABLE "inquiries" ALTER COLUMN "account_id" SET NOT NULL');
    expect(sql).toContain('INSERT INTO "roles"');
    expect(sql).toContain('INSERT INTO "user_roles"');
  });

  it('maintains updated_at with a trigger and keeps audit logs append-only', () => {
    const sql = migrationSql(1);

    expect(sql).toContain('CREATE OR REPLACE FUNCTION "openverify_set_updated_at"()');
    expect(sql).toContain('CREATE TRIGGER "inquiries_set_updated_at"');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "openverify_reject_audit_log_update"()');
  });
});
