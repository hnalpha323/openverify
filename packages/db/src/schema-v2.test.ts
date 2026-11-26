/**
 * Schema v2 (Phase 2, C9-C16): the shape of every table and column the Phase 2 services
 * need, checked on the Drizzle objects. Database-level behaviour (constraints, triggers,
 * the v1 -> v2 data migration) is in `constraints-v2.test.ts` and `migration-v2.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import { PgDialect, getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { ENCRYPTED_COLUMNS } from './encrypted-columns.js';
import { ID_PREFIXES } from './ids.js';
import * as schema from './schema.js';
import { openJson, openValue, rowContext, sealJson, sealValue, type Sealed } from './sealed.js';

const dialect = new PgDialect();

beforeAll(() => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
});

afterAll(() => {
  setDefaultKeyring(undefined);
});

const config = (table: PgTable) => getTableConfig(table);
const column = (table: PgTable, name: string): PgColumn => {
  const found = config(table).columns.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`${config(table).name}.${name} does not exist`);
  return found;
};
const columnTypes = (table: PgTable) =>
  Object.fromEntries(config(table).columns.map((part) => [part.name, part.getSQLType()]));
const checkSql = (table: PgTable, name: string): string => {
  const found = config(table).checks.find((check) => check.name === name);
  if (!found) throw new Error(`${config(table).name} has no check ${name}`);
  return dialect.sqlToQuery(found.value).sql;
};
const indexShape = (table: PgTable) =>
  config(table).indexes.map(({ config: index }) => ({
    name: index.name,
    unique: index.unique,
    partial: index.where !== undefined,
    columns: index.columns.map((part) =>
      'name' in part
        ? `${part.name ?? '?'}${part.indexConfig?.order === 'desc' ? ' desc' : ''}`
        : 'sql',
    ),
  }));
const indexNamed = (table: PgTable, name: string) => {
  const found = indexShape(table).find((index) => index.name === name);
  if (!found) throw new Error(`${config(table).name} has no index ${name}`);
  return found;
};
const foreignKeyShape = (table: PgTable) =>
  config(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      columns: reference.columns.map((part) => part.name),
      foreignTable: getTableConfig(reference.foreignTable).name,
      foreignColumns: reference.foreignColumns.map((part) => part.name),
      onDelete: foreignKey.onDelete,
    };
  });

describe('schema v2: C9 identifiers', () => {
  it('knows the Phase 2 prefixes', () => {
    expect(ID_PREFIXES).toMatchObject({
      account: 'acc',
      accountType: 'acctp',
      role: 'role',
      auditLog: 'aud',
      apiLog: 'alog',
      mfaFactor: 'mfa',
    });
  });

  it.each([
    [schema.accounts, 'id', 'accounts_id_format', 'acc'],
    [schema.accountTypes, 'id', 'account_types_id_format', 'acctp'],
    [schema.roles, 'id', 'roles_id_format', 'role'],
    [schema.apiLogs, 'id', 'api_logs_id_format', 'alog'],
    [schema.mfaFactors, 'id', 'mfa_factors_id_format', 'mfa'],
    [schema.auditLogs, 'public_id', 'audit_logs_public_id_format', 'aud'],
  ] as const)('%#: a caller-generated text id with its C9 prefix', (table, name, check, prefix) => {
    const id = column(table, name);

    expect(id.getSQLType()).toBe('text');
    expect(id.notNull).toBe(true);
    // Audit entries fall back to an id generated in SQL (openverify_new_id).
    expect(id.hasDefault).toBe(name === 'public_id');
    expect(checkSql(table, check)).toContain(`'^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$'`);
  });

  it('keeps the audit log identity key internal and adds a unique public id', () => {
    expect(column(schema.auditLogs, 'id').generatedIdentity?.type).toBe('always');
    expect(indexNamed(schema.auditLogs, 'audit_logs_public_id_key')).toMatchObject({
      unique: true,
      columns: ['public_id'],
    });
  });
});

describe('schema v2: new tables belong to a tenant', () => {
  const environmentTables: PgTable[] = [
    schema.accountTypes,
    schema.accounts,
    schema.accountRelations,
    schema.oneTimeLinks,
    schema.idempotencyKeys,
    schema.apiLogs,
  ];
  const organizationTables: PgTable[] = [
    schema.roles,
    schema.userRoles,
    schema.mfaFactors,
    schema.mfaRecoveryCodes,
    schema.mfaChallenges,
    schema.webauthnRegistrationChallenges,
  ];

  it.each(environmentTables.map((table) => [config(table).name, table] as const))(
    '%s has environment_id, deleted with its environment',
    (_name, table) => {
      expect(column(table, 'environment_id').notNull).toBe(true);
      expect(foreignKeyShape(table)).toContainEqual({
        columns: ['environment_id'],
        foreignTable: 'environments',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      });
    },
  );

  it.each(organizationTables.map((table) => [config(table).name, table] as const))(
    '%s has organization_id and no environment_id',
    (_name, table) => {
      expect(column(table, 'organization_id').notNull).toBe(true);
      expect(config(table).columns.map((part) => part.name)).not.toContain('environment_id');
    },
  );

  it.each(
    [...environmentTables, ...organizationTables].map(
      (table) => [config(table).name, table] as const,
    ),
  )('%s has created_at and updated_at', (_name, table) => {
    for (const name of ['created_at', 'updated_at']) {
      expect(column(table, name).getSQLType()).toBe('timestamp with time zone');
      expect(column(table, name).notNull).toBe(true);
    }
  });

  it.each([
    [schema.accounts, ['environment_id', 'account_type_id'], 'account_types', 'no action'],
    [schema.accounts, ['environment_id', 'consolidated_into'], 'accounts', 'no action'],
    [schema.accountRelations, ['environment_id', 'from_account_id'], 'accounts', 'cascade'],
    [schema.accountRelations, ['environment_id', 'to_account_id'], 'accounts', 'cascade'],
    [schema.inquiries, ['environment_id', 'account_id'], 'accounts', 'no action'],
    [schema.oneTimeLinks, ['environment_id', 'inquiry_id'], 'inquiries', 'cascade'],
  ] as const)('ties %# to a parent in the same environment', (table, columns, parent, onDelete) => {
    expect(foreignKeyShape(table)).toContainEqual({
      columns: [...columns],
      foreignTable: parent,
      foreignColumns: ['environment_id', 'id'],
      onDelete,
    });
  });

  it.each([
    [schema.userRoles, ['organization_id', 'user_id'], 'users', 'cascade'],
    [schema.userRoles, ['organization_id', 'role_id'], 'roles', 'no action'],
    [schema.mfaFactors, ['organization_id', 'user_id'], 'users', 'cascade'],
    [schema.mfaRecoveryCodes, ['organization_id', 'user_id'], 'users', 'cascade'],
    [schema.mfaChallenges, ['organization_id', 'user_id'], 'users', 'cascade'],
    [schema.webauthnRegistrationChallenges, ['organization_id', 'user_id'], 'users', 'cascade'],
  ] as const)(
    'ties %# to a parent in the same organization',
    (table, columns, parent, onDelete) => {
      expect(foreignKeyShape(table)).toContainEqual({
        columns: [...columns],
        foreignTable: parent,
        foreignColumns: ['organization_id', 'id'],
        onDelete,
      });
    },
  );
});

describe('schema v2: C9-C16 columns', () => {
  it('accounts (C13)', () => {
    expect(columnTypes(schema.accounts)).toMatchObject({
      account_type_id: 'text',
      reference_id: 'text',
      status: 'account_status',
      fields: 'text',
      tags: 'text[]',
      consolidated_into: 'text',
      redacted_at: 'timestamp with time zone',
    });
    expect(schema.accountStatus.enumValues).toEqual(['active', 'archived']);
    expect(column(schema.accounts, 'fields').notNull).toBe(false);
    expect(indexNamed(schema.accounts, 'accounts_environment_id_reference_id_key')).toMatchObject({
      unique: true,
      columns: ['environment_id', 'reference_id'],
    });
    expect(checkSql(schema.accounts, 'accounts_not_consolidated_into_itself')).toContain('<>');
  });

  it('account types and relations (C13)', () => {
    expect(columnTypes(schema.accountTypes)).toMatchObject({
      name: 'text',
      fields_schema: 'jsonb',
    });
    expect(indexNamed(schema.accountTypes, 'account_types_environment_id_name_key').unique).toBe(
      true,
    );
    expect(columnTypes(schema.accountRelations)).toMatchObject({
      from_account_id: 'text',
      to_account_id: 'text',
      relation_type: 'text',
    });
    expect(indexNamed(schema.accountRelations, 'account_relations_from_to_type_key')).toMatchObject(
      {
        unique: true,
        columns: ['from_account_id', 'to_account_id', 'relation_type'],
      },
    );
    expect(checkSql(schema.accountRelations, 'account_relations_not_self')).toContain('<>');
    expect(checkSql(schema.accountRelations, 'account_relations_type_format')).toContain(
      '^[a-z][a-z0-9_]{0,63}$',
    );
  });

  it('inquiries (C10, C13, C16)', () => {
    expect(columnTypes(schema.inquiries)).toMatchObject({
      account_id: 'text',
      tags: 'text[]',
      note: 'text',
      expires_at: 'timestamp with time zone',
      redacted_at: 'timestamp with time zone',
    });
    expect(column(schema.inquiries, 'account_id').notNull).toBe(true);
    expect(column(schema.inquiries, 'expires_at').notNull).toBe(true);
    expect(column(schema.inquiries, 'note').notNull).toBe(false);
  });

  it('templates and versions (C11)', () => {
    expect(schema.inquiryTemplateStatus.enumValues).toEqual(['active', 'archived']);
    expect(schema.inquiryTemplateVersionStatus.enumValues).toEqual([
      'draft',
      'published',
      'superseded',
    ]);
    expect(columnTypes(schema.inquiryTemplates)).toMatchObject({
      status: 'inquiry_template_status',
    });
    expect(columnTypes(schema.inquiryTemplateVersions)).toMatchObject({
      status: 'inquiry_template_version_status',
      settings: 'jsonb',
      published_at: 'timestamp with time zone',
    });
    expect(
      indexNamed(schema.inquiryTemplateVersions, 'inquiry_template_versions_one_published_key'),
    ).toMatchObject({ unique: true, partial: true, columns: ['inquiry_template_id'] });
  });

  it('one-time links (C10)', () => {
    expect(columnTypes(schema.oneTimeLinks)).toMatchObject({
      inquiry_id: 'text',
      token_hash: 'text',
      expires_at: 'timestamp with time zone',
      used_at: 'timestamp with time zone',
      revoked_at: 'timestamp with time zone',
    });
    expect(indexNamed(schema.oneTimeLinks, 'one_time_links_token_hash_key').unique).toBe(true);
    expect(checkSql(schema.oneTimeLinks, 'one_time_links_token_hash_hex')).toContain(
      '[0-9a-f]{64}',
    );
  });

  it('inquiry sessions (C10)', () => {
    expect(schema.inquirySessionStatus.enumValues).toEqual(['active', 'expired', 'canceled']);
    expect(columnTypes(schema.inquirySessions)).toMatchObject({
      status: 'inquiry_session_status',
      started_at: 'timestamp with time zone',
      expired_at: 'timestamp with time zone',
      canceled_at: 'timestamp with time zone',
      ip: 'text',
      user_agent: 'text',
    });
    expect(
      indexNamed(schema.inquirySessions, 'inquiry_sessions_active_expires_at_idx'),
    ).toMatchObject({ partial: true, columns: ['expires_at'] });
  });

  it('idempotency keys (C12)', () => {
    expect(schema.idempotencyKeyState.enumValues).toEqual(['in_progress', 'completed']);
    expect(schema.principalType.enumValues).toEqual(['api_key', 'user']);
    expect(columnTypes(schema.idempotencyKeys)).toMatchObject({
      principal_type: 'principal_type',
      principal_id: 'text',
      key: 'text',
      fingerprint: 'text',
      state: 'idempotency_key_state',
      response_status: 'integer',
      response_headers: 'jsonb',
      response_body: 'text',
      expires_at: 'timestamp with time zone',
    });
    expect(indexNamed(schema.idempotencyKeys, 'idempotency_keys_scope_key')).toMatchObject({
      unique: true,
      columns: ['environment_id', 'principal_type', 'principal_id', 'key'],
    });
  });

  it('API logs (C12), with an index per filter', () => {
    expect(columnTypes(schema.apiLogs)).toMatchObject({
      method: 'text',
      path: 'text',
      route: 'text',
      status: 'integer',
      duration_ms: 'integer',
      request_id: 'text',
      idempotency_key: 'text',
      api_key_id: 'text',
      user_id: 'text',
      ip: 'text',
      user_agent: 'text',
      query: 'text',
      request_body: 'text',
      response_body: 'text',
    });
    for (const [name, columns] of [
      [
        'api_logs_environment_id_created_at_id_idx',
        ['environment_id', 'created_at desc', 'id desc'],
      ],
      [
        'api_logs_environment_id_api_key_id_created_at_id_idx',
        ['environment_id', 'api_key_id', 'created_at desc', 'id desc'],
      ],
      [
        'api_logs_environment_id_route_created_at_id_idx',
        ['environment_id', 'route', 'created_at desc', 'id desc'],
      ],
      [
        'api_logs_environment_id_status_created_at_id_idx',
        ['environment_id', 'status', 'created_at desc', 'id desc'],
      ],
    ] as const) {
      expect(indexNamed(schema.apiLogs, name).columns).toEqual([...columns]);
    }
  });

  it('roles and users (C15)', () => {
    expect(columnTypes(schema.roles)).toMatchObject({
      key: 'text',
      name: 'text',
      builtin: 'boolean',
      permissions: 'text[]',
    });
    expect(schema.userStatus.enumValues).toEqual(['active', 'invited', 'deactivated']);
    expect(columnTypes(schema.users)).toMatchObject({
      status: 'user_status',
      name: 'text',
      invitation_token_hash: 'text',
      invitation_expires_at: 'timestamp with time zone',
      invited_by: 'text',
    });
    expect(column(schema.users, 'password_hash').notNull).toBe(false);
    expect(checkSql(schema.users, 'users_password_unless_invited')).toContain('invited');
    expect(columnTypes(schema.userSessions)).toMatchObject({ mfa_satisfied: 'boolean' });
    expect(columnTypes(schema.organizations)).toMatchObject({ require_mfa: 'boolean' });
  });

  it('MFA (C15)', () => {
    expect(schema.mfaFactorType.enumValues).toEqual(['totp', 'webauthn']);
    expect(columnTypes(schema.mfaFactors)).toMatchObject({
      user_id: 'text',
      type: 'mfa_factor_type',
      name: 'text',
      totp_secret: 'text',
      last_used_step: 'bigint',
      webauthn_credential_id: 'text',
      webauthn_public_key: 'text',
      webauthn_counter: 'bigint',
      webauthn_transports: 'text[]',
      confirmed_at: 'timestamp with time zone',
      last_used_at: 'timestamp with time zone',
    });
    expect(indexNamed(schema.mfaFactors, 'mfa_factors_webauthn_credential_id_key').unique).toBe(
      true,
    );
    expect(columnTypes(schema.mfaRecoveryCodes)).toMatchObject({
      code_hash: 'text',
      used_at: 'timestamp with time zone',
    });
    expect(columnTypes(schema.mfaChallenges)).toMatchObject({
      token_hash: 'text',
      expires_at: 'timestamp with time zone',
      failed_attempts: 'integer',
      webauthn_challenge_hash: 'text',
    });
    expect(indexNamed(schema.mfaChallenges, 'mfa_challenges_token_hash_key').unique).toBe(true);
    expect(columnTypes(schema.webauthnRegistrationChallenges)).toMatchObject({
      challenge_hash: 'text',
      expires_at: 'timestamp with time zone',
    });
  });

  it('environment settings (C16)', () => {
    expect(columnTypes(schema.environments)).toMatchObject({ settings: 'jsonb' });
    expect(column(schema.environments, 'settings').notNull).toBe(true);
  });

  it('webhooks and deliveries (C14)', () => {
    expect(schema.webhookStatus.enumValues).toEqual(['enabled', 'disabled', 'archived']);
    expect(columnTypes(schema.webhooks)).toMatchObject({
      api_version: 'text',
      custom_headers: 'text',
      filters: 'jsonb',
      attribute_blocklist: 'text[]',
      previous_secret: 'text',
      previous_secret_expires_at: 'timestamp with time zone',
    });
    expect(columnTypes(schema.webhookDeliveries)).toMatchObject({
      attempts: 'jsonb',
      next_attempt_at: 'timestamp with time zone',
      first_attempted_at: 'timestamp with time zone',
      max_attempts: 'integer',
      is_replay: 'boolean',
    });
    expect(
      indexNamed(schema.webhookDeliveries, 'webhook_deliveries_webhook_id_event_id_key'),
    ).toMatchObject({ unique: true, partial: true });
  });

  it('events (C12, C14, C16)', () => {
    expect(columnTypes(schema.events)).toMatchObject({
      simulated: 'boolean',
      object_id: 'text',
      object_type: 'text',
      redacted_at: 'timestamp with time zone',
    });
    expect(indexNamed(schema.events, 'events_environment_id_object_id_idx').columns).toEqual([
      'environment_id',
      'object_id',
    ]);
    expect(
      indexNamed(schema.events, 'events_environment_id_name_created_at_id_idx').columns,
    ).toEqual(['environment_id', 'name', 'created_at desc', 'id desc']);
  });

  it('audit logs (C15)', () => {
    expect(columnTypes(schema.auditLogs)).toMatchObject({
      public_id: 'text',
      actor_type: 'audit_actor_type',
      actor_id: 'text',
      ip: 'text',
      user_agent: 'text',
      metadata: 'jsonb',
    });
    expect(
      indexNamed(schema.auditLogs, 'audit_logs_environment_id_created_at_public_id_idx').columns,
    ).toEqual(['environment_id', 'created_at desc', 'public_id desc']);
  });

  it('API keys and files', () => {
    expect(columnTypes(schema.apiKeys)).toMatchObject({
      api_version: 'text',
      token_prefix: 'text',
      created_by_id: 'text',
    });
    expect(columnTypes(schema.files)).toMatchObject({ deleted_at: 'timestamp with time zone' });
  });
});

describe('schema: indexes added by the Workflow 2B review', () => {
  it('lets the retention sweeps walk api logs, events and finished deliveries oldest first (F019)', () => {
    expect(indexNamed(schema.apiLogs, 'api_logs_created_at_idx')).toMatchObject({
      partial: false,
      columns: ['created_at'],
    });
    expect(indexNamed(schema.events, 'events_created_at_idx')).toMatchObject({
      partial: false,
      columns: ['created_at'],
    });
    expect(
      indexNamed(schema.webhookDeliveries, 'webhook_deliveries_finished_created_at_idx'),
    ).toMatchObject({ partial: true, columns: ['created_at'] });
  });

  it('finds the accounts consolidated into an account without a scan (F023)', () => {
    expect(
      indexNamed(schema.accounts, 'accounts_environment_id_consolidated_into_idx'),
    ).toMatchObject({ partial: true, columns: ['environment_id', 'consolidated_into'] });
  });
});

describe('schema: indexes added by Workflow 2E', () => {
  it('lists the API logs of a user newest first without a scan (C25.9)', () => {
    expect(
      indexNamed(schema.apiLogs, 'api_logs_environment_id_user_id_created_at_id_idx'),
    ).toMatchObject({
      partial: false,
      columns: ['environment_id', 'user_id', 'created_at desc', 'id desc'],
    });
  });
});

describe('schema v2: row-bound encryption (F004)', () => {
  it('binds the AAD context to the column and the row id', () => {
    expect(rowContext('accounts.fields', 'acc_X')).toBe('accounts.fields#acc_X');
  });

  it('round-trips a sealed value only for the same column and row', () => {
    const sealed = sealValue('inquiries.note', 'inq_A', 'synthetic note');

    expect(sealed).toMatch(/^ov1\./);
    expect(sealed).not.toContain('synthetic');
    expect(openValue('inquiries.note', 'inq_A', sealed)).toBe('synthetic note');
    expect(() => openValue('inquiries.note', 'inq_B', sealed)).toThrow(/authentication failed/);
    expect(() => openValue('accounts.fields', 'inq_A', sealed)).toThrow(/authentication failed/);
  });

  it('seals JSON the same way', () => {
    const sealed: Sealed = sealJson('accounts.fields', 'acc_A', { 'name-first': 'Jane' });

    expect(openJson('accounts.fields', 'acc_A', sealed)).toEqual({ 'name-first': 'Jane' });
    expect(() => openJson('accounts.fields', 'acc_B', sealed)).toThrow();
  });

  it('lists every encrypted column for the KEK rewrap', () => {
    expect(
      ENCRYPTED_COLUMNS.map((entry) => `${entry.table}.${entry.column}:${entry.aad}`).sort(),
    ).toEqual([
      'account_exports.wrapped_dek:file',
      'accounts.fields:row',
      'api_logs.ip:row',
      'api_logs.query:row',
      'api_logs.request_body:row',
      'api_logs.response_body:row',
      'api_logs.user_agent:row',
      'audit_logs.ip:static',
      'audit_logs.user_agent:row',
      'business_registry_records.record:row',
      'case_attachments.original_filename:row',
      'case_attachments.wrapped_dek:file',
      'case_bulk_actions.request:row',
      'case_comments.message:row',
      'case_exports.request:row',
      'case_exports.wrapped_dek:file',
      'cases.fields:row',
      'chip_challenges.aa_response:row',
      'chip_challenges.device_report:row',
      'chip_reads.fields:row',
      'chip_reads.sod_signature:row',
      'connect_connections.agreement_reference:row',
      'consent_records.attested_text_body:row',
      'consent_records.evidence_ip:row',
      'consent_records.evidence_reference:row',
      'consent_records.evidence_user_agent:row',
      'consent_texts.body:row',
      'crypto_challenges.message:row',
      'crypto_challenges.signature:row',
      'crypto_challenges.signed_message:row',
      'crypto_challenges.wallet_address:row',
      'document_extractions.fields:row',
      'events.payload:static',
      'exports.request:row',
      'exports.wrapped_dek:file',
      'face_templates.template:row',
      'files.wrapped_dek:file',
      'government_id_extractions.fields:row',
      'graph_queries.params:row',
      'idempotency_keys.response_body:row',
      'importers.wrapped_dek:file',
      'inquiries.fields:static',
      'inquiries.initial_fields:row',
      'inquiries.note:row',
      'inquiry_decisions.comment:row',
      'inquiry_integrity_challenges.token:row',
      'inquiry_integrity_verdicts.verdict:row',
      'inquiry_session_signals.behaviour:row',
      'inquiry_session_signals.components:row',
      'inquiry_sessions.consent:static',
      'inquiry_sessions.ip:row',
      'inquiry_sessions.location:row',
      'inquiry_sessions.user_agent:row',
      'list_import_rows.value:row',
      'list_item_backgrounds.masked_file_wrapped_dek:file',
      'list_item_faces.template:row',
      'list_items.value:row',
      'list_matches.matched_value:row',
      'list_matches.reason:row',
      'mfa_factors.totp_secret:row',
      'networks.ip:row',
      'networks.location:row',
      'otp_challenges.destination:row',
      'rendition_pages.wrapped_dek:file',
      'report_actions.details:row',
      'report_bulk_jobs.wrapped_dek:file',
      'report_matches.snapshot:row',
      'reports.query:row',
      'reports.result:row',
      'scheduled_runs.inputs:row',
      'selfie_captures.device:row',
      'simulation_presets.scope:row',
      'sso_login_states.code_verifier:row',
      'sso_login_states.nonce:row',
      'sso_providers.client_secret:row',
      'theme_assets.wrapped_dek:file',
      'transaction_files.filename:row',
      'transaction_files.wrapped_dek:file',
      'transactions.fields:row',
      'verification_inputs.values:row',
      'webhooks.custom_headers:row',
      'webhooks.previous_secret:row',
      'webhooks.secret:static',
      'workflow_run_files.filename:row',
      'workflow_run_files.wrapped_dek:file',
      'workflow_run_steps.console:row',
      'workflow_run_steps.input:row',
      'workflow_run_steps.output:row',
      'workflow_runs.inputs:row',
      'workflow_runs.outputs:row',
      'workflow_runs.trigger_snapshot:row',
      'workflow_runs.variables:row',
      'workflow_secret_values.previous_value:row',
      'workflow_secret_values.value:row',
      'workflow_step_effects.result:row',
    ]);
  });
});
