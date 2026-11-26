import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CHECK_STATUSES,
  CHECK_TYPES,
  ID_CLASSES,
  INQUIRY_STATUSES,
  VERIFICATION_STATUSES,
  VERIFICATION_TYPES,
  REPORT_ACTION_TYPES,
  REPORT_MATCH_STATUSES,
  REPORT_ORIGINS,
  REPORT_REVIEW_STATUSES,
  REPORT_RISK_LEVELS,
  REPORT_RUN_TYPES,
  REPORT_STATUSES,
} from '@openverify/core';
import { PgDialect, getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, decrypt, setDefaultKeyring, type Keyring } from './crypto.js';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';

const {
  apiKeys,
  auditLogs,
  environments,
  events,
  files,
  inquiries,
  inquirySessions,
  inquiryTemplateVersions,
  inquiryTemplates,
  organizations,
  userSessions,
  users,
  verificationChecks,
  verifications,
  webhookDeliveries,
  webhooks,
} = schema;

const dialect = new PgDialect();
let keyring: Keyring;

beforeAll(() => {
  // Synthetic per-run KEK; the encrypted columns resolve it lazily.
  keyring = createKeyring(randomBytes(32));
  setDefaultKeyring(keyring);
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
const checkSql = (table: PgTable, name: string): string => {
  const found = config(table).checks.find((check) => check.name === name);
  if (!found) throw new Error(`${config(table).name} has no check ${name}`);
  return dialect.sqlToQuery(found.value).sql;
};
const indexShape = (table: PgTable) =>
  config(table).indexes.map(({ config: index }) => ({
    name: index.name,
    unique: index.unique,
    columns: index.columns.map((part) =>
      'name' in part
        ? `${part.name ?? '?'}${part.indexConfig?.order === 'desc' ? ' desc' : ''}`
        : 'sql',
    ),
  }));
const uniqueShape = (table: PgTable) =>
  config(table).uniqueConstraints.map((unique) => ({
    name: unique.getName(),
    columns: unique.columns.map((part) => part.name),
  }));
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

/** C1 prefixes for every table whose primary key is a prefixed ULID. */
const prefixedTables: [PgTable, string][] = [
  [organizations, 'org'],
  [environments, 'env'],
  [apiKeys, 'key'],
  [users, 'usr'],
  [userSessions, 'uss'],
  [inquiryTemplates, 'itmpl'],
  [inquiryTemplateVersions, 'itmplv'],
  [inquiries, 'inq'],
  [inquirySessions, 'iqse'],
  [verifications, 'ver'],
  [files, 'file'],
  [events, 'evt'],
  [webhooks, 'wbh'],
  [webhookDeliveries, 'whd'],
];

/** Tables that hold one environment's data. */
const tenantTables: PgTable[] = [
  apiKeys,
  userSessions,
  inquiryTemplates,
  inquiryTemplateVersions,
  inquiries,
  inquirySessions,
  verifications,
  verificationChecks,
  files,
  events,
  webhooks,
  webhookDeliveries,
  auditLogs,
];

const allTables: PgTable[] = [organizations, environments, users, ...tenantTables];
const named = (tables: PgTable[]) => tables.map((table) => [config(table).name, table] as const);

describe('schema v1: identifiers', () => {
  it.each(prefixedTables.map(([table, prefix]) => [config(table).name, table, prefix] as const))(
    '%s has a caller-generated text id in the C1 prefixed-ULID format',
    (name, table, prefix) => {
      const id = column(table, 'id');

      expect(id.getSQLType()).toBe('text');
      expect(id.primary).toBe(true);
      expect(id.hasDefault).toBe(false);
      expect(checkSql(table, `${name}_id_format`)).toContain(
        `'^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$'`,
      );
    },
  );

  it('keys verification checks by verification and check name', () => {
    expect(config(verificationChecks).primaryKeys.map((key) => key.getName())).toEqual([
      'verification_checks_pkey',
    ]);
    expect(config(verificationChecks).primaryKeys[0]?.columns.map((part) => part.name)).toEqual([
      'verification_id',
      'name',
    ]);
  });

  it('gives audit logs an identity key, since they are append-only and not exposed by id', () => {
    const id = column(auditLogs, 'id');

    expect(id.getSQLType()).toBe('bigint');
    expect(id.primary).toBe(true);
    expect(id.generatedIdentity?.type).toBe('always');
  });
});

describe('schema v1: tenancy', () => {
  it.each(named(tenantTables))(
    '%s belongs to an environment and is deleted with it',
    (_name, table) => {
      const environmentId = column(table, 'environment_id');

      expect(environmentId.getSQLType()).toBe('text');
      expect(environmentId.notNull).toBe(true);
      expect(foreignKeyShape(table)).toContainEqual({
        columns: ['environment_id'],
        foreignTable: 'environments',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      });
    },
  );

  it.each(named(allTables))('%s has created_at and updated_at timestamps', (_name, table) => {
    for (const name of ['created_at', 'updated_at']) {
      const timestamp = column(table, name);

      expect(timestamp.getSQLType()).toBe('timestamp with time zone');
      expect(timestamp.notNull).toBe(true);
      expect(timestamp.hasDefault).toBe(true);
    }
  });

  it.each([
    [
      inquiryTemplateVersions,
      ['environment_id', 'inquiry_template_id'],
      'inquiry_templates',
      ['environment_id', 'id'],
      'cascade',
    ],
    [
      inquiries,
      ['environment_id', 'inquiry_template_id', 'inquiry_template_version_id'],
      'inquiry_template_versions',
      ['environment_id', 'inquiry_template_id', 'id'],
      'no action',
    ],
    [
      inquirySessions,
      ['environment_id', 'inquiry_id'],
      'inquiries',
      ['environment_id', 'id'],
      'cascade',
    ],
    [
      verifications,
      ['environment_id', 'inquiry_id'],
      'inquiries',
      ['environment_id', 'id'],
      'cascade',
    ],
    [
      verificationChecks,
      ['environment_id', 'verification_id'],
      'verifications',
      ['environment_id', 'id'],
      'cascade',
    ],
    [
      files,
      ['environment_id', 'verification_id'],
      'verifications',
      ['environment_id', 'id'],
      'cascade',
    ],
    [
      webhookDeliveries,
      ['environment_id', 'webhook_id'],
      'webhooks',
      ['environment_id', 'id'],
      'cascade',
    ],
    [
      webhookDeliveries,
      ['environment_id', 'event_id'],
      'events',
      ['environment_id', 'id'],
      'cascade',
    ],
    [userSessions, ['organization_id', 'user_id'], 'users', ['organization_id', 'id'], 'cascade'],
    [
      userSessions,
      ['organization_id', 'environment_id'],
      'environments',
      ['organization_id', 'id'],
      'cascade',
    ],
  ] as const)(
    'ties %# children to a parent in the same environment or organization',
    (table, columns, foreignTable, foreignColumns, onDelete) => {
      expect(foreignKeyShape(table)).toContainEqual({
        columns: [...columns],
        foreignTable,
        foreignColumns: [...foreignColumns],
        onDelete,
      });
    },
  );

  it('scopes users to an organization, so one operator can work in sandbox and production', () => {
    expect(column(users, 'organization_id').notNull).toBe(true);
    expect(config(users).columns.map((part) => part.name)).not.toContain('environment_id');
    // Schema v2 (C15) adds the self reference `invited_by`.
    expect(foreignKeyShape(users)).toEqual([
      {
        columns: ['organization_id'],
        foreignTable: 'organizations',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        columns: ['invited_by'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'set null',
      },
    ]);
  });
});

describe('schema v1: statuses match @openverify/core', () => {
  it.each([
    ['inquiry_status', schema.inquiryStatus, INQUIRY_STATUSES],
    ['verification_status', schema.verificationStatus, VERIFICATION_STATUSES],
    ['verification_type', schema.verificationType, VERIFICATION_TYPES],
    ['check_status', schema.checkStatus, CHECK_STATUSES],
    ['check_type', schema.checkType, CHECK_TYPES],
    ['id_class', schema.idClass, ID_CLASSES],
    // Phase 6 (C73.1).
    ['report_status', schema.reportStatus, REPORT_STATUSES],
    ['report_run_type', schema.reportRunType, REPORT_RUN_TYPES],
    ['report_action_type', schema.reportActionType, REPORT_ACTION_TYPES],
    ['report_match_status', schema.reportMatchStatus, REPORT_MATCH_STATUSES],
    ['report_review_status', schema.reportReviewStatus, REPORT_REVIEW_STATUSES],
    ['report_risk_level', schema.reportRiskLevel, REPORT_RISK_LEVELS],
    ['report_origin', schema.reportOrigin, REPORT_ORIGINS],
  ] as const)('%s', (enumName, pgEnum, values) => {
    expect(pgEnum.enumName).toBe(enumName);
    expect(pgEnum.enumValues).toEqual([...values]);
  });

  it('defines the Phase 1 enums that have no core counterpart', () => {
    expect(schema.checkRequirement.enumValues).toEqual(['required', 'not_required']);
    expect(schema.fileKind.enumValues).toEqual([
      'front',
      'back',
      'portrait',
      'selfie-center',
      'selfie-left',
      'selfie-right',
      // C52.4 (migration 0016): the document and the chip files a client uploads, then the
      // two kinds only the server writes.
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
    ]);
    // Schema v2 (C14) adds `archived`.
    expect(schema.webhookStatus.enumValues).toEqual(['enabled', 'disabled', 'archived']);
    expect(schema.webhookDeliveryStatus.enumValues).toEqual(['pending', 'succeeded', 'failed']);
    expect(schema.auditActorType.enumValues).toEqual(['user', 'api_key', 'system', 'workflow_run']);
  });

  it.each([
    [inquiries, 'status', 'inquiry_status', "'created'"],
    [verifications, 'status', 'verification_status', "'initiated'"],
    [verifications, 'type', 'verification_type', undefined],
    [verificationChecks, 'status', 'check_status', undefined],
    [webhooks, 'status', 'webhook_status', "'enabled'"],
    [webhookDeliveries, 'status', 'webhook_delivery_status', "'pending'"],
  ] as const)('stores %s.%s as %s', (table, name, type, defaultValue) => {
    const status = column(table, name);

    expect(status.getSQLType()).toBe(type);
    expect(status.notNull).toBe(true);
    if (defaultValue !== undefined) {
      expect(`'${String(status.default)}'`).toBe(defaultValue);
    }
  });
});

describe('schema v1: indexes for the C2-C5 queries', () => {
  it.each([
    [inquiryTemplates, 'inquiry_templates_environment_id_created_at_id_idx'],
    [inquiries, 'inquiries_environment_id_created_at_id_idx'],
    [events, 'events_environment_id_created_at_id_idx'],
    [webhooks, 'webhooks_environment_id_created_at_id_idx'],
  ] as const)('pages %s by (environment_id, created_at desc, id desc)', (table, name) => {
    expect(indexShape(table)).toContainEqual({
      name,
      unique: false,
      columns: ['environment_id', 'created_at desc', 'id desc'],
    });
  });

  it('filters inquiries by status and by reference id (not unique)', () => {
    expect(indexShape(inquiries)).toEqual(
      expect.arrayContaining([
        {
          name: 'inquiries_environment_id_status_created_at_id_idx',
          unique: false,
          columns: ['environment_id', 'status', 'created_at desc', 'id desc'],
        },
        {
          name: 'inquiries_environment_id_reference_id_idx',
          unique: false,
          columns: ['environment_id', 'reference_id'],
        },
      ]),
    );
  });

  it.each([
    [inquirySessions, 'inquiry_sessions_token_hash_key', ['token_hash']],
    [userSessions, 'user_sessions_token_hash_key', ['token_hash']],
    [apiKeys, 'api_keys_secret_hash_key', ['secret_hash']],
    [users, 'users_organization_id_email_key', ['organization_id', 'email']],
    [files, 'files_storage_key_key', ['storage_key']],
    [
      files,
      'files_environment_id_verification_id_kind_key',
      ['environment_id', 'verification_id', 'kind'],
    ],
    [webhookDeliveries, 'webhook_deliveries_webhook_id_event_id_key', ['webhook_id', 'event_id']],
    [
      inquiryTemplateVersions,
      'inquiry_template_versions_inquiry_template_id_version_key',
      ['inquiry_template_id', 'version'],
    ],
  ] as const)('enforces the unique index %#', (table, name, columns) => {
    expect(indexShape(table)).toContainEqual({ name, unique: true, columns: [...columns] });
  });

  it('finds due webhook deliveries by (status, next_attempt_at)', () => {
    expect(indexShape(webhookDeliveries)).toContainEqual({
      name: 'webhook_deliveries_status_next_attempt_at_idx',
      unique: false,
      columns: ['status', 'next_attempt_at'],
    });
  });

  it.each([
    [inquiryTemplates, 'inquiry_templates_environment_id_id_key', ['environment_id', 'id']],
    [
      inquiryTemplateVersions,
      // Postgres truncates identifiers at 63 bytes, so this one is abbreviated.
      'inquiry_template_versions_env_template_id_key',
      ['environment_id', 'inquiry_template_id', 'id'],
    ],
    [inquiries, 'inquiries_environment_id_id_key', ['environment_id', 'id']],
    [verifications, 'verifications_environment_id_id_key', ['environment_id', 'id']],
    [events, 'events_environment_id_id_key', ['environment_id', 'id']],
    [webhooks, 'webhooks_environment_id_id_key', ['environment_id', 'id']],
    [users, 'users_organization_id_id_key', ['organization_id', 'id']],
    [environments, 'environments_organization_id_id_key', ['organization_id', 'id']],
  ] as const)('exposes %# as a composite foreign-key target', (table, name, columns) => {
    expect(uniqueShape(table)).toContainEqual({ name, columns: [...columns] });
  });
});

describe('schema v1: PII and secrets at rest', () => {
  it.each([
    [inquiries, 'fields', { 'name-first': 'Jane' }, 'Jane'],
    [events, 'payload', { data: { attributes: { 'name-first': 'Jane' } } }, 'Jane'],
    [webhooks, 'secret', 'wbhsec_synthetic-secret-value', 'synthetic-secret'],
    [auditLogs, 'ip', '198.51.100.7', '198.51.100.7'],
  ] as const)('encrypts %#: %s.%s', (table, name, value, needle) => {
    const target = column(table, name);
    const stored = String(target.mapToDriverValue(value));

    expect(target.getSQLType()).toBe('text');
    expect(stored).toMatch(/^ov1\./);
    expect(stored).not.toContain(needle);
    expect(target.mapFromDriverValue(stored)).toEqual(value);
  });

  it('keeps the consent record as jsonb with the IP and user agent encrypted', () => {
    const consent = column(inquirySessions, 'consent');
    const record = {
      acceptedAt: new Date('2026-10-20T12:00:00.000Z'),
      textKeys: ['consent.biometric', 'consent.processing'],
      locale: 'en',
      ip: '203.0.113.9',
      userAgent: 'SyntheticBrowser/1.0',
    };

    const stored = consent.mapToDriverValue(record) as string;
    const json = JSON.parse(stored) as Record<string, unknown>;

    expect(consent.getSQLType()).toBe('jsonb');
    expect(consent.notNull).toBe(false);
    expect(json).toMatchObject({
      accepted_at: '2026-10-20T12:00:00.000Z',
      text_keys: ['consent.biometric', 'consent.processing'],
      locale: 'en',
    });
    expect(stored).not.toContain('203.0.113.9');
    expect(stored).not.toContain('SyntheticBrowser');
    expect(decrypt(String(json.ip), keyring, { context: 'inquiry_sessions.consent.ip' })).toBe(
      '203.0.113.9',
    );
    expect(consent.mapFromDriverValue(json)).toEqual(record);
    expect(consent.mapFromDriverValue(stored)).toEqual(record);
    expect(
      consent.mapFromDriverValue(
        consent.mapToDriverValue({ ...record, ip: null, userAgent: null }),
      ),
    ).toEqual({ ...record, ip: null, userAgent: null });
  });

  it('keeps operator email in plaintext, but lowercased by constraint', () => {
    expect(column(users, 'email').getSQLType()).toBe('text');
    expect(checkSql(users, 'users_email_lowercase')).toMatch(/lower\(/);
    expect(checkSql(users, 'users_password_hash_argon2id')).toContain('$argon2id$');
  });

  it('stores file metadata and the wrapped DEK, never the bytes', () => {
    expect(
      Object.fromEntries(config(files).columns.map((part) => [part.name, part.getSQLType()])),
    ).toMatchObject({
      verification_id: 'text',
      kind: 'file_kind',
      storage_key: 'text',
      mime_type: 'text',
      byte_size: 'integer',
      sha256: 'text',
      wrapped_dek: 'text',
    });
    expect(checkSql(files, 'files_wrapped_dek_format')).toContain('ov1');
    expect(checkSql(files, 'files_sha256_hex')).toContain('[0-9a-f]{64}');
  });

  it('has no plaintext secret, token or password columns', () => {
    const sensitive = allTables.flatMap((table) =>
      config(table)
        .columns.filter((part) => /secret|token|password/.test(part.name))
        .map((part) => `${config(table).name}.${part.name}`),
    );

    expect(sensitive.sort()).toEqual([
      'api_keys.secret_hash',
      // Schema v2 (C12): the environment prefix plus 4 secret characters, shown to users.
      'api_keys.token_prefix',
      'inquiry_sessions.token_hash',
      'user_sessions.token_hash',
      'users.invitation_token_hash',
      'users.password_hash',
      // Workflow 11B Stage 1b (A) (C248.6; review F11): the break-glass grant's expiry, not a password.
      'users.password_login_allowed_until',
      // Schema v2 (C14): the previous secret is encrypted and bound to the webhook id.
      'webhooks.previous_secret',
      'webhooks.previous_secret_expires_at',
      'webhooks.secret',
      'webhooks.secret_last4',
    ]);
    for (const table of [inquirySessions, userSessions]) {
      expect(checkSql(table, `${config(table).name}_token_hash_hex`)).toContain('[0-9a-f]{64}');
    }
  });
});

/** drizzle-kit's api.d.ts imports zod types it does not ship, so type what we use. */
interface Snapshot {
  id: string;
}
interface DrizzleKitApi {
  generateDrizzleJson: (imports: Record<string, unknown>, prevId?: string) => Snapshot;
  generateMigration: (prev: Snapshot, cur: Snapshot) => Promise<string[]>;
}

describe('schema v1: migrations stay in sync', () => {
  it('has no drift between the schema and the latest drizzle-kit snapshot', async () => {
    const kit = (await import('drizzle-kit/api')) as unknown as DrizzleKitApi;
    const snapshots = readdirSync(path.join(MIGRATIONS_FOLDER, 'meta'))
      .filter((file) => file.endsWith('_snapshot.json'))
      .sort();
    const latest = JSON.parse(
      readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', snapshots.at(-1) ?? ''), 'utf8'),
    ) as Snapshot;

    const current = kit.generateDrizzleJson(schema, latest.id);

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(await kit.generateMigration(latest, current)).toEqual([]);
  });
});
