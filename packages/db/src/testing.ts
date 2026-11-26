/**
 * `@openverify/db/testing`: a migrated, isolated Postgres 17 database for unit tests,
 * with no Docker. It runs PGlite (Postgres compiled to WASM, with pgvector) in process.
 * Use Testcontainers (`pgvector/pgvector:pg17`) for integration tests against the real
 * server.
 *
 * Only for tests: PGlite is a dev dependency of this package.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite/vector';
import type {
  CaseAssignmentDistribution,
  CaseSlaOnReopen,
  DecisionKind,
  DecisionSubjectType,
  ListKind,
  ListMatchMethod,
  ListProbeSource,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool, type PoolConfig } from 'pg';
import type { Db, DbSchema } from './client.js';
import {
  createKeyring,
  encrypt,
  encryptBytes,
  getDefaultKeyring,
  setDefaultKeyring,
  type Keyring,
} from './crypto.js';
import { generateId, ID_PREFIXES, type IdPrefix } from './ids.js';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
import { createInquiry } from './repositories/inquiries.js';
import { createEnvironment } from './repositories/organizations.js';
import {
  createInquiryTemplate,
  type InquiryTemplateWithVersion,
} from './repositories/inquiry-templates.js';
import * as schema from './schema.js';
import { SEALED } from './encrypted-columns.js';
import { openJson, openOptional, sealJson, sealValue, type Sealed } from './sealed.js';

export { ID_PREFIXES, type IdPrefix };
export {
  INTEGRATION_POSTGRES_READY_TIMEOUT_MS,
  INTEGRATION_POSTGRES_RETRIES,
  INTEGRATION_POSTGRES_STARTUP_TIMEOUT_MS,
  POSTGRES_TEST_COMMAND,
  POSTGRES_TEST_IMAGE,
  ifSet,
  startIntegrationPostgres,
  startWithRetries,
  type IntegrationPostgresOptions,
  type StartWithRetriesOptions,
  type StartedIntegrationPostgres,
} from './integration-postgres.js';
export {
  createRuntimeRole,
  TEST_RUNTIME_ROLE,
  type CreateRuntimeRoleOptions,
} from './testing-runtime-role.js';

/**
 * The Postgres extensions the migrations create, as PGlite loads them (C73.1, F16): pgvector
 * (C42.5) and pg_trgm (C78.3). Every PGlite instance that runs the migrations passes these.
 */
export const PGLITE_EXTENSIONS = Object.freeze({ vector, pg_trgm });

export type TestDb = PgliteDatabase<DbSchema> & { $client: PGlite };

export interface TestDatabase {
  /** Drizzle client; pass it to any repository function. */
  db: TestDb;
  /** The underlying PGlite instance, for raw SQL. */
  client: PGlite;
  /** The keyring the encrypted columns use (also installed as the default keyring). */
  keyring: Keyring;
  close(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** Keyring for the encrypted columns. Defaults to one synthetic keyring per process. */
  keyring?: Keyring;
}

let migratedTemplate: Promise<Blob> | undefined;
let processKeyring: Keyring | undefined;

/** The PGlite build the template was dumped by: a data directory belongs to one build. */
const PGLITE_PACKAGE = fileURLToPath(
  new URL('../node_modules/@electric-sql/pglite/package.json', import.meta.url),
);

/**
 * Where the migrated template is kept on disk, for every test file and process: Vitest runs each
 * test file in a fresh module, so a template kept only in memory was rebuilt by every file (all
 * the migrations: 2 to 3 s alone, past 60 s under the full validation's load after Workflow 6B).
 * The name is a SHA-256 of the migrations, the PGlite version and the extensions, so a changed
 * migration builds a new template. `OPENVERIFY_TEST_DB_CACHE_DIR` moves the directory (tests).
 */
export function migratedTemplatePath(): string {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).map(
    ({ folderMillis, hash }) => [folderMillis, hash],
  );
  const pglite = (JSON.parse(readFileSync(PGLITE_PACKAGE, 'utf8')) as { version: string }).version;
  const key = createHash('sha256')
    .update(JSON.stringify({ migrations, pglite, extensions: Object.keys(PGLITE_EXTENSIONS) }))
    .digest('hex');
  const dir = process.env.OPENVERIFY_TEST_DB_CACHE_DIR ?? path.join(tmpdir(), 'openverify-test-db');
  return path.join(dir, `${key}.tar`);
}

/**
 * How many migrated templates the cache directory keeps (about 45 MB each): every change to a
 * migration names a new one, so the least recently used beyond these are removed.
 */
export const MIGRATED_TEMPLATES_KEPT = 8;

/** A partial write older than this was abandoned by a process that stopped. */
const ABANDONED_PARTIAL_MS = 60 * 60_000;

/** The stored template, or `undefined` when there is none yet. */
function readStoredTemplate(file: string): Blob | undefined {
  try {
    const template = new Blob([readFileSync(file)]);
    const now = new Date();
    utimesSync(file, now, now);
    return template;
  } catch {
    return undefined;
  }
}

/** Removes the templates beyond {@link MIGRATED_TEMPLATES_KEPT} and abandoned partial writes. */
function pruneTemplates(dir: string): void {
  const entries = readdirSync(dir).map((name) => {
    const file = path.join(dir, name);
    return { name, file, mtimeMs: statSync(file).mtimeMs };
  });
  const templates = entries
    .filter(({ name }) => name.endsWith('.tar'))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const abandoned = entries.filter(
    ({ name, mtimeMs }) => name.endsWith('.partial') && Date.now() - mtimeMs > ABANDONED_PARTIAL_MS,
  );
  for (const { file } of [...templates.slice(MIGRATED_TEMPLATES_KEPT), ...abandoned]) {
    rmSync(file, { force: true });
  }
}

/**
 * Stores the template for the next test files, atomically (a reader never sees half a file); best
 * effort, since a test that cannot write the cache still has its database.
 */
async function storeTemplate(file: string, template: Blob): Promise<void> {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const partial = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}.partial`;
    writeFileSync(partial, Buffer.from(await template.arrayBuffer()));
    renameSync(partial, file);
    pruneTemplates(path.dirname(file));
  } catch {
    // An unwritable cache costs time, not correctness.
  }
}

async function openTemplate(template: Blob): Promise<PGlite> {
  const client = new PGlite({ loadDataDir: template, extensions: PGLITE_EXTENSIONS });
  await client.waitReady;
  return client;
}

/**
 * The first call in a process opens the stored template, or migrates its own instance and stores
 * the template; later calls start from that template instead of migrating again.
 */
async function openMigratedClient(): Promise<PGlite> {
  if (migratedTemplate !== undefined) {
    return openTemplate(await migratedTemplate);
  }
  const file = migratedTemplatePath();
  const stored = readStoredTemplate(file);
  if (stored !== undefined) {
    const client = await openTemplate(stored).catch(() => undefined);
    if (client !== undefined) {
      migratedTemplate = Promise.resolve(stored);
      return client;
    }
  }
  const client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  migratedTemplate = runMigrations(drizzle({ client, schema })).then(async () => {
    const template = await client.dumpDataDir('none');
    await storeTemplate(file, template);
    return template;
  });
  await migratedTemplate;
  return client;
}

/**
 * A fresh in-memory database with every migration applied. Each call is isolated. The first
 * call anywhere migrates (about 2-3 s) and stores the template ({@link migratedTemplatePath});
 * every later call, in any test file or process, copies it (about 0.4 s). Under parallel load,
 * give `beforeAll` a generous `hookTimeout` (this package uses 120 s). Installs the keyring as the process default keyring
 * (`setDefaultKeyring`), so use one keyring per test file.
 */
export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const client = await openMigratedClient();
  const keyring = options.keyring ?? (processKeyring ??= createKeyring(randomBytes(32)));
  setDefaultKeyring(keyring);
  return {
    db: drizzle({ client, schema }),
    client,
    keyring,
    close: () => client.close(),
  };
}

/**
 * A synthetic C1 id (`<prefix>_<ULID>`): 10 characters of millisecond time, then 80
 * random bits, so ids sort by creation time. Production code takes ids from the
 * application's id generator, not from here.
 */
export function testId(prefix: IdPrefix): string {
  return generateId(prefix);
}

export interface TestTenantOptions {
  kind?: schema.EnvironmentKind;
  organizationName?: string;
  /**
   * C168.2 (Workflow 9B Stage 1b (U)): `false` unless given, the value every suite relied on before
   * new organisations started requiring MFA.
   */
  requireMfa?: boolean;
}

/**
 * Inserts a synthetic organization with one environment (sandbox by default). The organisation is
 * written with SQL and the columns every schema since 0001 has, so upgrade tests can seed it before
 * the newest migration: since Workflow 11A the table also has `connect_inbound` (0035), which
 * earlier schemas lack; the row it returns carries that column's default, `false`.
 */
export async function createTestTenant(
  db: Db,
  options: TestTenantOptions = {},
): Promise<{ organization: schema.Organization; environment: schema.Environment }> {
  const result: unknown = await db.execute(
    sql`insert into organizations (id, name, require_mfa)
        values (${testId('org')}, ${options.organizationName ?? 'Example Test Org'},
          ${options.requireMfa ?? false})
        returning id, name, require_mfa, created_at, updated_at`,
  );
  const row = (
    result as {
      rows: {
        id: string;
        name: string;
        require_mfa: boolean;
        created_at: Date | string;
        updated_at: Date | string;
      }[];
    }
  ).rows[0];
  if (row === undefined) {
    throw new Error('createTestTenant: no organization');
  }
  const organization: schema.Organization = {
    id: row.id,
    name: row.name,
    requireMfa: row.require_mfa,
    connectInbound: false,
    // Workflow 11B Stage 1b (A) (amendment 10): no sign-in name; the insert names no column a schema
    // before 0036 lacks (Workflow 11A Stage 1a amendment 30).
    slug: null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  const environment = await createEnvironment(db, {
    id: testId('env'),
    organizationId: organization.id,
    kind: options.kind ?? 'sandbox',
  });
  return { organization, environment };
}

export interface TestInquiryOptions {
  referenceId?: string;
  fields?: Record<string, unknown>;
  flow?: Record<string, unknown>;
  verificationConfig?: Record<string, unknown>;
}

/** SQLSTATE `admin_shutdown`: the server is stopping. */
const ADMIN_SHUTDOWN = '57P01';

/**
 * A pool for integration tests against a Testcontainers Postgres. `pool.end()` resolves once
 * the pool has let go of its idle clients, which can be before their connections close. A
 * container stopped right after can then send those clients its shutdown notice, and
 * node-postgres emits it on the pool, where an `error` nobody listens to fails the run after
 * every test passed. That notice is ignored; any other idle client error is still raised.
 */
export function createIntegrationPool(
  connectionString: string,
  config: Omit<PoolConfig, 'connectionString'> = {},
): Pool {
  const pool = new Pool({ ...config, connectionString });
  pool.on('error', (error: Error & { code?: string }) => {
    if (error.code !== ADMIN_SHUTDOWN) {
      throw error;
    }
  });
  return pool;
}

/** Inserts a synthetic template (version 1) and an inquiry on it, in status `created`. */
export async function createTestInquiry(
  db: Db,
  environmentId: string,
  options: TestInquiryOptions = {},
): Promise<{ template: InquiryTemplateWithVersion; inquiry: schema.Inquiry }> {
  const template = await createInquiryTemplate(db, environmentId, {
    id: testId('itmpl'),
    name: 'Test template',
    version: {
      id: testId('itmplv'),
      flow: options.flow ?? {},
      verificationConfig: options.verificationConfig ?? {},
    },
  });
  const inquiry = await createInquiry(db, environmentId, {
    id: testId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.latestVersion.id,
    referenceId: options.referenceId ?? null,
    fields: options.fields ?? {},
  });
  return { template, inquiry };
}

/**
 * Like {@link createTestInquiry}, for an upgrade test that seeds rows on an earlier schema: the
 * template and its published version 1 are written with SQL that names only the columns every
 * schema since 0003 has, because the repositories name every column of the current one (0020
 * added `inquiry_template_versions.report_config`, C84.1). The inquiry is written the same way,
 * because 0023 (Workflow 7A (S)) added `inquiries.signals` and `signal_details`, and so is its
 * account, because 0027 added `accounts.workflow_run_step_id`. Only the ids are returned: a full row
 * would name the current columns.
 */
export async function createTestInquiryOnEarlierSchema(
  db: Db,
  environmentId: string,
): Promise<{
  templateId: string;
  versionId: string;
  inquiry: Pick<
    schema.Inquiry,
    'id' | 'environmentId' | 'accountId' | 'inquiryTemplateId' | 'inquiryTemplateVersionId'
  >;
}> {
  const templateId = testId('itmpl');
  const versionId = testId('itmplv');
  await db.execute(
    sql`insert into inquiry_templates (id, environment_id, name)
        values (${templateId}, ${environmentId}, 'Test template')`,
  );
  await db.execute(
    sql`insert into inquiry_template_versions
          (id, environment_id, inquiry_template_id, version, flow, verification_config, settings,
           status, published_at)
        values (${versionId}, ${environmentId}, ${templateId}, 1, '{}'::jsonb, '{}'::jsonb,
          '{}'::jsonb, 'published', now())`,
  );
  const accountId = await createTestAccountOnEarlierSchema(db, environmentId);
  const id = testId('inq');
  const fields = encrypt(JSON.stringify({}), getDefaultKeyring(), { context: 'inquiries.fields' });
  await db.execute(
    sql`insert into inquiries (id, environment_id, inquiry_template_id, inquiry_template_version_id,
          account_id, fields)
        values (${id}, ${environmentId}, ${templateId}, ${versionId}, ${accountId}, ${fields})`,
  );
  const inquiry = {
    id,
    environmentId,
    accountId,
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
  };
  return { templateId, versionId, inquiry };
}

/**
 * An account of the default type, written with SQL and the columns every schema since 0001 has, for
 * upgrade tests: since Workflow 8A (A) the repository's insert names `workflow_run_step_id`, which
 * earlier schemas lack.
 */
export async function createTestAccountOnEarlierSchema(
  db: Db,
  environmentId: string,
): Promise<string> {
  const type: unknown = await db.execute(
    sql`insert into account_types (id, environment_id, name)
        values (${testId('acctp')}, ${environmentId}, 'user')
        on conflict (environment_id, name) do update set name = excluded.name
        returning id`,
  );
  const accountTypeId = (type as { rows: { id: string }[] }).rows[0]?.id;
  if (accountTypeId === undefined) {
    throw new Error('createTestAccountOnEarlierSchema: no account type');
  }
  const id = testId('acc');
  await db.execute(
    sql`insert into accounts (id, environment_id, account_type_id)
        values (${id}, ${environmentId}, ${accountTypeId})`,
  );
  return id;
}

/**
 * A verification of `inquiryId`, written with SQL and the columns every schema since 0001 has, for
 * upgrade tests that seed rows before the newest migration: since Workflow 7A (H) the repository's
 * insert names `created_by_session_id` and `from_rejected_handoff`, which earlier schemas lack.
 */
export async function createTestVerificationOnEarlierSchema(
  db: Db,
  environmentId: string,
  input: { inquiryId: string; type: string; id?: string },
): Promise<{ id: string }> {
  const id = input.id ?? testId('ver');
  await db.execute(
    sql`insert into verifications (id, environment_id, inquiry_id, type)
        values (${id}, ${environmentId}, ${input.inquiryId}, ${input.type}::verification_type)`,
  );
  return { id };
}

// Phase 5, Workflow 5A (C53.2) -----------------------------------------------------------------
//
// Rows of the Workflow 5A tables, written with SQL as their owners' repositories will write them
// (each value sealed to its row), so tests need none of the owners' write functions. Synthetic
// values only.

/** A SQL `text[]` literal of `values`. */
const textArray = (values: readonly string[]) =>
  values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`;

export interface SeedVerificationInputs {
  verificationId: string;
  inquiryId: string;
  values: Record<string, unknown>;
  source?: 'flow' | 'government_id';
  sourceVerificationId?: string | null;
  at?: Date;
}

/** A `verification_inputs` row, its values sealed to the verification (C52.3, C59.6). */
export async function seedVerificationInputs(
  db: Db,
  environmentId: string,
  input: SeedVerificationInputs,
): Promise<void> {
  const at = input.at ?? new Date();
  await db.execute(sql`
    insert into verification_inputs (environment_id, verification_id, inquiry_id, "values",
      field_names, source, source_verification_id, created_at, updated_at)
    values (${environmentId}, ${input.verificationId}, ${input.inquiryId},
      ${sealJson('verification_inputs.values', input.verificationId, input.values)},
      ${textArray(Object.keys(input.values))}, ${input.source ?? 'flow'},
      ${input.sourceVerificationId ?? null}, ${at.toISOString()}, ${at.toISOString()})`);
}

export interface SeedOtpChallenge {
  id?: string;
  verificationId: string;
  inquiryId: string;
  channel: 'sms' | 'email';
  /** Sealed to the row; `null` writes none. */
  destination: string | null;
  destinationIndex?: string | null;
  status?: 'sent' | 'confirmed' | 'superseded' | 'expired' | 'exhausted' | 'errored';
  codeHmac?: Uint8Array | null;
  codeKeyId?: string | null;
  failedAttempts?: number;
  provider?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date;
  expiresAt?: Date;
  confirmedAt?: Date | null;
  errorCode?: string | null;
}

/** An `otp_challenges` row (C53.2); returns its id. */
export async function seedOtpChallenge(
  db: Db,
  environmentId: string,
  input: SeedOtpChallenge,
): Promise<string> {
  const id = input.id ?? testId('otpc');
  const sentAt = input.sentAt ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(sentAt.getTime() + 600_000);
  const status = input.status ?? 'sent';
  const hmac =
    input.codeHmac === undefined
      ? status === 'sent'
        ? Buffer.alloc(32, 7)
        : null
      : input.codeHmac === null
        ? null
        : Buffer.from(input.codeHmac);
  await db.execute(sql`
    insert into otp_challenges (id, environment_id, verification_id, inquiry_id, channel,
      destination, destination_index, code_hmac, code_key_id, status, failed_attempts, provider,
      provider_message_id, sent_at, expires_at, confirmed_at, error_code)
    values (${id}, ${environmentId}, ${input.verificationId}, ${input.inquiryId}, ${input.channel},
      ${input.destination === null ? null : sealValue('otp_challenges.destination', id, input.destination)},
      ${input.destinationIndex ?? null}, ${hmac}, ${input.codeKeyId ?? null}, ${status},
      ${input.failedAttempts ?? 0}, ${input.provider ?? null}, ${input.providerMessageId ?? null},
      ${sentAt.toISOString()}, ${expiresAt.toISOString()},
      ${input.confirmedAt?.toISOString() ?? null}, ${input.errorCode ?? null})`);
  return id;
}

export interface SeedOtpVerificationState {
  verificationId: string;
  inquiryId: string;
  sends?: number;
  wrongEntries?: number;
  limitedAt?: Date | null;
  limitedReason?: 'destination' | 'inquiry' | 'guess' | 'environment' | 'store_unavailable' | null;
}

/** An `otp_verification_states` row (C53.2). */
export async function seedOtpVerificationState(
  db: Db,
  environmentId: string,
  input: SeedOtpVerificationState,
): Promise<void> {
  await db.execute(sql`
    insert into otp_verification_states (environment_id, verification_id, inquiry_id, sends,
      wrong_entries, limited_at, limited_reason)
    values (${environmentId}, ${input.verificationId}, ${input.inquiryId}, ${input.sends ?? 0},
      ${input.wrongEntries ?? 0}, ${input.limitedAt?.toISOString() ?? null},
      ${input.limitedReason ?? null})`);
}

export interface SeedCryptoChallenge {
  id?: string;
  verificationId: string;
  inquiryId: string;
  chainId: string;
  walletAddress: string;
  addressIndex?: string | null;
  message: string;
  status?: 'initiated' | 'submitted' | 'processed' | 'expired' | 'superseded';
  signature?: string | null;
  signedMessage?: string | null;
  scheme?: string | null;
  createdAt?: Date;
  expiresAt?: Date;
  submittedAt?: Date | null;
}

/** A `crypto_challenges` row (C53.2), every value sealed to it; returns its id. */
export async function seedCryptoChallenge(
  db: Db,
  environmentId: string,
  input: SeedCryptoChallenge,
): Promise<string> {
  const id = input.id ?? testId('cwc');
  const createdAt = input.createdAt ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(createdAt.getTime() + 600_000);
  const sealed = (column: string, value: string | null | undefined) =>
    value == null ? null : sealValue(`crypto_challenges.${column}`, id, value);
  await db.execute(sql`
    insert into crypto_challenges (id, environment_id, verification_id, inquiry_id, chain_id,
      wallet_address, address_index, message, status, signature, signed_message, scheme,
      created_at, expires_at, submitted_at)
    values (${id}, ${environmentId}, ${input.verificationId}, ${input.inquiryId}, ${input.chainId},
      ${sealed('wallet_address', input.walletAddress)}, ${input.addressIndex ?? null},
      ${sealed('message', input.message)}, ${input.status ?? 'initiated'},
      ${sealed('signature', input.signature)}, ${sealed('signed_message', input.signedMessage)},
      ${input.scheme ?? null}, ${createdAt.toISOString()}, ${expiresAt.toISOString()},
      ${input.submittedAt?.toISOString() ?? null})`);
  return id;
}

// Phase 6 (C73.2, C73.3) ------------------------------------------------------------------------
//
// Rows of the report and watchlist tables, written with SQL as their owners' repositories will
// write them (sealed values bound to their row), so tests need none of the owners' functions.
// Synthetic values only.

export interface SeedReportTemplate {
  id?: string;
  versionId?: string;
  reportType?: string;
  name?: string;
  status?: 'active' | 'archived';
  config?: Record<string, unknown>;
}

/** A `report_templates` row with its version 1, published; returns both ids. */
export async function seedReportTemplate(
  db: Db,
  environmentId: string,
  input: SeedReportTemplate = {},
): Promise<{ templateId: string; versionId: string }> {
  const templateId = input.id ?? testId('rptp');
  const versionId = input.versionId ?? testId('rptpv');
  const reportType = input.reportType ?? 'watchlist';
  await db.execute(sql`
    insert into report_templates (id, environment_id, name, report_type, status)
    values (${templateId}, ${environmentId}, ${input.name ?? 'Synthetic report template'},
      ${reportType}, ${input.status ?? 'active'})`);
  await db.execute(sql`
    insert into report_template_versions (id, environment_id, report_template_id, version, config,
      status, published_at)
    values (${versionId}, ${environmentId}, ${templateId}, 1,
      ${JSON.stringify(input.config ?? {})}::jsonb, 'published', now())`);
  return { templateId, versionId };
}

export interface SeedReport {
  id?: string;
  templateId: string;
  versionId: string;
  reportType?: string;
  origin?: 'inquiry_completion' | 'api' | 'dashboard';
  status?: 'pending' | 'ready' | 'errored';
  /** Sealed to the row; `null` writes none (a redacted report). */
  query?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  inquiryId?: string | null;
  accountId?: string | null;
  recurrenceIntervalDays?: number | null;
  nextRunAt?: Date | null;
  pausedAt?: Date | null;
  cryptoAddressIndex?: string | null;
  createdAt?: Date;
  redactedAt?: Date | null;
}

/** A `reports` row (C73.2); returns its id. */
export async function seedReport(
  db: Db,
  environmentId: string,
  input: SeedReport,
): Promise<string> {
  const id = input.id ?? testId('rep');
  const query =
    input.query === undefined ? { 'name-first': 'Avery', 'name-last': 'Synthetic' } : input.query;
  const createdAt = input.createdAt ?? new Date();
  await db.execute(sql`
    insert into reports (id, environment_id, report_type, report_template_id,
      report_template_version_id, origin, status, query, query_fields, result, inquiry_id,
      account_id, recurrence_interval_days, next_run_at, paused_at, paused_reason,
      crypto_address_index, created_at, redacted_at)
    values (${id}, ${environmentId}, ${input.reportType ?? 'watchlist'}, ${input.templateId},
      ${input.versionId}, ${input.origin ?? 'api'}, ${input.status ?? 'pending'},
      ${query === null ? null : sealJson('reports.query', id, query)},
      ${textArray(query === null ? [] : Object.keys(query))},
      ${input.result == null ? null : sealJson('reports.result', id, input.result)},
      ${input.inquiryId ?? null}, ${input.accountId ?? null},
      ${input.recurrenceIntervalDays ?? null}, ${input.nextRunAt?.toISOString() ?? null},
      ${input.pausedAt?.toISOString() ?? null}, ${input.pausedAt == null ? null : 'operator'},
      ${input.cryptoAddressIndex ?? null}, ${createdAt.toISOString()},
      ${input.redactedAt?.toISOString() ?? null})`);
  return id;
}

export interface SeedReportRun {
  id?: string;
  reportId: string;
  runType?: 'initial' | 'scheduled' | 'manual' | 'list_update';
  status?: 'pending' | 'running' | 'ready' | 'errored';
  scheduledFor?: Date;
  triggerSyncId?: number | null;
}

/** A `report_runs` row (C74.1); returns its id. */
export async function seedReportRun(
  db: Db,
  environmentId: string,
  input: SeedReportRun,
): Promise<string> {
  const id = input.id ?? testId('rpr');
  const runType = input.runType ?? (input.triggerSyncId == null ? 'initial' : 'list_update');
  await db.execute(sql`
    insert into report_runs (id, environment_id, report_id, run_type, status, scheduled_for,
      trigger_sync_id)
    values (${id}, ${environmentId}, ${input.reportId}, ${runType}, ${input.status ?? 'pending'},
      ${(input.scheduledFor ?? new Date()).toISOString()}, ${input.triggerSyncId ?? null})`);
  return id;
}

export interface SeedReportMatch {
  id?: string;
  reportId: string;
  runId: string;
  sourceId?: string | null;
  entryIndex?: string | null;
  evidenceHash?: string | null;
  score?: number;
  /** Sealed to the row; `null` writes none. */
  snapshot?: Record<string, unknown> | null;
  status?: 'open' | 'dismissed' | 'delisted';
}

/** A `report_matches` row (C73.2); returns its id. */
export async function seedReportMatch(
  db: Db,
  environmentId: string,
  input: SeedReportMatch,
): Promise<string> {
  const id = input.id ?? testId('rpm');
  const snapshot =
    input.snapshot === undefined ? { 'entry-key': 'openverify-sandbox:SYN-1' } : input.snapshot;
  const status = input.status ?? 'open';
  await db.execute(sql`
    insert into report_matches (id, environment_id, report_id, source_id, entry_index,
      evidence_hash, score, snapshot, status, first_run_id, last_run_id, delisted_at)
    values (${id}, ${environmentId}, ${input.reportId},
      ${input.sourceId === undefined ? 'openverify-sandbox' : input.sourceId},
      ${input.entryIndex === undefined ? 'e1'.repeat(32) : input.entryIndex},
      ${input.evidenceHash === undefined ? 'f2'.repeat(32) : input.evidenceHash},
      ${input.score ?? 0.91},
      ${snapshot === null ? null : sealJson('report_matches.snapshot', id, snapshot)}, ${status},
      ${input.runId}, ${input.runId}, ${status === 'delisted' ? new Date().toISOString() : null})`);
  return id;
}

export interface SeedReportAction {
  id?: string;
  reportId: string;
  actionType?: 'dismiss' | 'review' | 'pause' | 'resume' | 'run' | 'redact';
  actorType?: 'user' | 'api_key' | 'system' | 'workflow_run';
  actorId?: string | null;
  /** Sealed to the row; `null` writes none. */
  details?: Record<string, unknown> | null;
  createdAt?: Date;
}

/** A `report_actions` row (C73.2); returns its id. */
export async function seedReportAction(
  db: Db,
  environmentId: string,
  input: SeedReportAction,
): Promise<string> {
  const id = input.id ?? testId('ract');
  const actorType = input.actorType ?? 'api_key';
  const actorId =
    input.actorId === undefined ? (actorType === 'system' ? null : testId('key')) : input.actorId;
  const details = input.details === undefined ? { reason: 'Synthetic reason' } : input.details;
  await db.execute(sql`
    insert into report_actions (id, environment_id, report_id, action_type, actor_type, actor_id,
      details, created_at)
    values (${id}, ${environmentId}, ${input.reportId}, ${input.actionType ?? 'dismiss'},
      ${actorType}, ${actorId},
      ${details === null ? null : sealJson('report_actions.details', id, details)},
      ${(input.createdAt ?? new Date()).toISOString()})`);
  return id;
}

/** A `report_accounts` link (C84.4). */
export async function seedReportAccount(
  db: Db,
  environmentId: string,
  input: { reportId: string; accountId: string },
): Promise<void> {
  await db.execute(sql`
    insert into report_accounts (environment_id, report_id, account_id)
    values (${environmentId}, ${input.reportId}, ${input.accountId})`);
}

/** A `watchlist_sources` row (C73.3). */
export async function seedWatchlistSource(
  db: Db,
  input: { id: string; enabled?: boolean; sandboxOnly?: boolean; keysVersion?: string | null },
): Promise<void> {
  await db.execute(sql`
    insert into watchlist_sources (id, enabled, sandbox_only, keys_version)
    values (${input.id}, ${input.enabled ?? true}, ${input.sandboxOnly ?? false},
      ${input.keysVersion ?? null})`);
}

/** A `watchlist_syncs` row (C73.3); returns its id. */
export async function seedWatchlistSync(
  db: Db,
  input: {
    sourceId: string;
    outcome?: string;
    rescreenState?: 'none' | 'pending' | 'done';
    startedAt?: Date;
  },
): Promise<number> {
  const result = (await db.execute(sql`
    insert into watchlist_syncs (source_id, started_at, outcome, actor, rescreen_state)
    values (${input.sourceId}, ${(input.startedAt ?? new Date()).toISOString()},
      ${input.outcome ?? 'applied'}, 'cli', ${input.rescreenState ?? 'none'})
    returning id`)) as { rows: { id: number | string }[] };
  return Number(result.rows[0]?.id);
}

/**
 * Workflow 7A (N, C92.5): a network source row, as the reconciliation writes it. Install-wide,
 * so give each test its own id.
 */
export async function seedNetworkSource(
  db: Db,
  input: { id: string; enabled?: boolean; sandboxOnly?: boolean },
): Promise<void> {
  await db.execute(sql`
    insert into network_sources (id, enabled, sandbox_only)
    values (${input.id}, ${input.enabled ?? true}, ${input.sandboxOnly ?? false})`);
}

/** Workflow 7A (N, C92.2): one sync of a network source; returns its id. */
export async function seedNetworkSync(
  db: Db,
  input: {
    sourceId: string;
    outcome?: string;
    sha256?: string | null;
    publishedAt?: Date | null;
    startedAt?: Date;
  },
): Promise<number> {
  const result = (await db.execute(sql`
    insert into network_syncs (source_id, started_at, outcome, actor, sha256, published_at)
    values (${input.sourceId}, ${(input.startedAt ?? new Date()).toISOString()},
      ${input.outcome ?? 'applied'}, 'cli', ${input.sha256 ?? null},
      ${input.publishedAt?.toISOString() ?? null})
    returning id`)) as { rows: { id: number | string }[] };
  return Number(result.rows[0]?.id);
}

/**
 * Workflow 7A (N, C91.3, C93.2): a network evaluation of a session, its address and location
 * sealed for the row as `api-network`'s repository seals them, and the session's own facts. Every
 * address and ASN a test passes must come from the documentation ranges.
 */
export async function seedNetwork(
  db: Db,
  environmentId: string,
  input: {
    inquirySessionId: string;
    id?: string;
    ip?: string | null;
    location?: schema.NetworkLocation | null;
    asn?: number | null;
    countryCode?: string | null;
    threatLevel?: 'unknown' | 'low' | 'medium' | 'high';
    clientAddressSource?: 'socket' | 'trusted-list' | 'hop-count' | 'trust-all';
    evaluatedAt?: Date;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('net');
  const location = input.location ?? null;
  const evaluatedAt = (input.evaluatedAt ?? new Date()).toISOString();
  const ip =
    input.ip === undefined || input.ip === null ? null : sealValue('networks.ip', id, input.ip);
  await db.execute(sql`
    insert into networks (id, environment_id, inquiry_session_id, ip, location, asn, country_code,
      threat_level, client_address_source, evaluated_at)
    values (${id}, ${environmentId}, ${input.inquirySessionId}, ${ip},
      ${location === null ? null : sealJson('networks.location', id, location)},
      ${input.asn ?? null}, ${input.countryCode ?? null}, ${input.threatLevel ?? 'unknown'},
      ${input.clientAddressSource ?? 'socket'}, ${evaluatedAt}::timestamptz)`);
  await db.execute(sql`
    update inquiry_sessions
       set network_evaluated_at = ${evaluatedAt}::timestamptz,
           country_code = ${input.countryCode ?? null},
           location = ${location === null ? null : sealJson('inquiry_sessions.location', input.inquirySessionId, location)}
     where environment_id = ${environmentId} and id = ${input.inquirySessionId}`);
  return { id };
}

// Phase 7, Workflow 7A (S) (C91.2, C94.2, C94.4) -------------------------------------------------
//
// The signal and device rows as their owner's repositories (`api-signals`) will write them, each
// sealed value bound to its row, so tests need none of the owner's functions. Synthetic values.

/**
 * A stored flow signal body: `components` and `behaviour` sealed for the row key of
 * `(inquirySessionId, sequence)` (`sessionSignalRowKey`).
 */
export async function seedSessionSignalBody(
  db: Db,
  environmentId: string,
  input: {
    inquirySessionId: string;
    sequence?: number;
    screen?: string;
    platform?: 'web' | 'android';
    components?: Record<string, unknown> | null;
    behaviour?: Record<string, unknown> | null;
    createdAt?: Date;
  },
): Promise<{ id: number }> {
  const sequence = input.sequence ?? 0;
  const key = schema.sessionSignalRowKey(input.inquirySessionId, sequence);
  const components = input.components === undefined ? { integrity: {} } : input.components;
  const behaviour = input.behaviour === undefined ? { 'paste-count': 0 } : input.behaviour;
  const result = await db.execute(sql`
    insert into inquiry_session_signals (environment_id, inquiry_session_id, sequence, screen,
      platform, collector_version, components, behaviour, created_at)
    values (${environmentId}, ${input.inquirySessionId}, ${sequence}, ${input.screen ?? 'consent'},
      ${input.platform ?? 'web'}, 1,
      ${components === null ? null : sealJson('inquiry_session_signals.components', key, components)},
      ${behaviour === null ? null : sealJson('inquiry_session_signals.behaviour', key, behaviour)},
      ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)
    returning id`);
  const [row] = (result as { rows: { id: number | string }[] }).rows;
  return { id: Number(row?.id) };
}

/** The session's stored signal bodies, opened, by sequence; for the redaction and retention scans. */
export async function openSessionSignalBodies(
  db: Db,
  environmentId: string,
  inquirySessionId: string,
): Promise<{ sequence: number; components: unknown; behaviour: unknown }[]> {
  const result = await db.execute(sql`
    select sequence, components, behaviour from inquiry_session_signals
     where environment_id = ${environmentId} and inquiry_session_id = ${inquirySessionId}
     order by sequence`);
  const rows = (
    result as { rows: { sequence: number; components: string | null; behaviour: string | null }[] }
  ).rows;
  return rows.map((row) => {
    const key = schema.sessionSignalRowKey(inquirySessionId, row.sequence);
    const open = (column: string, sealed: string | null): unknown =>
      sealed === null ? null : openJson(column, key, sealed as Sealed);
    return {
      sequence: row.sequence,
      components: open('inquiry_session_signals.components', row.components),
      behaviour: open('inquiry_session_signals.behaviour', row.behaviour),
    };
  });
}

/** A device (web unless `platform` says otherwise) with random HMACs, linked to `sessionIds`. */
export async function seedDevice(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    platform?: 'web' | 'android';
    keyId?: string;
    lastSeenAt?: Date;
    sessionIds?: readonly string[];
  } = {},
): Promise<{
  id: string;
  browserFingerprint: string | null;
  deviceFingerprint: string | null;
  deviceClass: string | null;
}> {
  const id = input.id ?? testId('dev');
  const web = (input.platform ?? 'web') === 'web';
  const hex = () => randomBytes(32).toString('hex');
  const device = {
    id,
    browserFingerprint: web ? hex() : null,
    deviceFingerprint: web ? null : hex(),
    deviceClass: web ? hex() : null,
  };
  const lastSeenAt = (input.lastSeenAt ?? new Date()).toISOString();
  await db.execute(sql`
    insert into devices (id, environment_id, platform, collector_version, browser_fingerprint,
      device_fingerprint, device_class, key_id, first_seen_at, last_seen_at)
    values (${id}, ${environmentId}, ${web ? 'web' : 'android'}, 1, ${device.browserFingerprint},
      ${device.deviceFingerprint}, ${device.deviceClass}, ${input.keyId ?? 'AAAAAAAAAAA'},
      ${lastSeenAt}::timestamptz, ${lastSeenAt}::timestamptz)`);
  for (const sessionId of input.sessionIds ?? []) {
    await db.execute(sql`
      insert into session_devices (environment_id, inquiry_session_id, device_id)
      values (${environmentId}, ${sessionId}, ${id})`);
  }
  return device;
}

// Phase 5, Workflow 5B (C53.3) -------------------------------------------------------------------

export interface SeedDocumentExtraction {
  verificationId: string;
  inquiryId: string;
  documentType?: string;
  typeConfidence?: number | null;
  pageCount?: number;
  mimeType?: string;
  fields?: Record<string, string | null>;
  at?: Date;
}

/** A `document_extractions` row (C53.3), its values sealed to the verification. */
export async function seedDocumentExtraction(
  db: Db,
  environmentId: string,
  input: SeedDocumentExtraction,
): Promise<void> {
  const at = input.at ?? new Date();
  await db.execute(sql`
    insert into document_extractions (environment_id, verification_id, inquiry_id, document_type,
      type_confidence, fields, page_count, mime_type, created_at)
    values (${environmentId}, ${input.verificationId}, ${input.inquiryId},
      ${input.documentType ?? 'utility_bill'}, ${input.typeConfidence ?? 0.82},
      ${sealJson('document_extractions.fields', input.verificationId, input.fields ?? {})},
      ${input.pageCount ?? 1}, ${input.mimeType ?? 'application/pdf'}, ${at.toISOString()})`);
}

export interface SeedChipChallenge {
  id?: string;
  verificationId: string;
  inquiryId: string;
  /** Defaults to the SHA-256 of 8 zero bytes. */
  nonceSha256?: string;
  status?: 'initiated' | 'submitted' | 'processed' | 'expired' | 'superseded';
  aaResponse?: string | null;
  deviceReport?: string | null;
  createdAt?: Date;
  expiresAt?: Date;
  submittedAt?: Date | null;
}

/** A `chip_challenges` row (C53.3), the AA response and device report sealed to it; its id. */
export async function seedChipChallenge(
  db: Db,
  environmentId: string,
  input: SeedChipChallenge,
): Promise<string> {
  const id = input.id ?? testId('chc');
  const createdAt = input.createdAt ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(createdAt.getTime() + 300_000);
  const sealed = (column: string, value: string | null | undefined) =>
    value == null ? null : sealValue(`chip_challenges.${column}`, id, value);
  const nonce =
    input.nonceSha256 ?? 'af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc';
  await db.execute(sql`
    insert into chip_challenges (id, environment_id, verification_id, inquiry_id, nonce_sha256,
      status, aa_response, device_report, created_at, expires_at, submitted_at)
    values (${id}, ${environmentId}, ${input.verificationId}, ${input.inquiryId}, ${nonce},
      ${input.status ?? 'initiated'}, ${sealed('aa_response', input.aaResponse)},
      ${sealed('device_report', input.deviceReport)}, ${createdAt.toISOString()},
      ${expiresAt.toISOString()}, ${input.submittedAt?.toISOString() ?? null})`);
  return id;
}

export interface SeedChipRead {
  verificationId: string;
  inquiryId: string;
  fields?: Record<string, string | null>;
  sodSignature?: Uint8Array;
  sodSignatureIndex?: string | null;
  documentNumberIndex?: string | null;
  integrity?: 'established' | 'broken' | 'not_established';
  selfieBound?: boolean;
  issuingCountry?: string | null;
  paSummary?: Record<string, unknown>;
  at?: Date;
}

/** A `chip_reads` row (C53.3), the DG1 fields and SOD signature sealed to the verification. */
export async function seedChipRead(
  db: Db,
  environmentId: string,
  input: SeedChipRead,
): Promise<void> {
  const at = input.at ?? new Date();
  const signature = Buffer.from(input.sodSignature ?? new Uint8Array(64).fill(7)).toString(
    'base64',
  );
  await db.execute(sql`
    insert into chip_reads (environment_id, verification_id, inquiry_id, fields, sod_signature,
      sod_signature_index, document_number_index, integrity, selfie_bound, issuing_country,
      pa_summary, created_at)
    values (${environmentId}, ${input.verificationId}, ${input.inquiryId},
      ${sealJson('chip_reads.fields', input.verificationId, input.fields ?? {})},
      ${sealValue('chip_reads.sod_signature', input.verificationId, signature)},
      ${input.sodSignatureIndex ?? null}, ${input.documentNumberIndex ?? null},
      ${input.integrity ?? 'established'}, ${input.selfieBound ?? false},
      ${input.issuingCountry === undefined ? 'UTO' : input.issuingCountry},
      ${JSON.stringify(input.paSummary ?? {})}::jsonb, ${at.toISOString()})`);
}

export interface SeedBusinessRegistryRecord {
  verificationId: string;
  inquiryId: string;
  source?: 'gleif' | 'companies-house' | 'sec-edgar' | 'sandbox';
  record?: Record<string, string | null>;
  fetchedAt?: Date;
}

/** A `business_registry_records` row (C53.3), its summary sealed to the verification. */
export async function seedBusinessRegistryRecord(
  db: Db,
  environmentId: string,
  input: SeedBusinessRegistryRecord,
): Promise<void> {
  const fetchedAt = input.fetchedAt ?? new Date();
  const record = input.record ?? { recordId: 'SANDBOX0001', legalName: 'Utopia Widgets Ltd' };
  await db.execute(sql`
    insert into business_registry_records (environment_id, verification_id, inquiry_id, source,
      record, fetched_at)
    values (${environmentId}, ${input.verificationId}, ${input.inquiryId},
      ${input.source ?? 'sandbox'},
      ${sealJson('business_registry_records.record', input.verificationId, record)},
      ${fetchedAt.toISOString()})`);
}

/** A `trust_anchor_sources` row (C53.3). */
export async function seedTrustAnchorSource(
  db: Db,
  input: { id: string; enabled?: boolean },
): Promise<void> {
  await db.execute(sql`
    insert into trust_anchor_sources (id, enabled) values (${input.id}, ${input.enabled ?? true})`);
}

export interface SeedTrustAnchor {
  /** Synthetic DER bytes; the anchor's id is their SHA-256. */
  certificate: Uint8Array;
  country?: string;
  subjectDn?: string;
  ski?: string | null;
  aki?: string | null;
  notBefore?: Date;
  notAfter?: Date;
  isLink?: boolean;
  sandboxOnly?: boolean;
}

/** A `trust_anchors` row (C53.3); returns its id, the certificate's SHA-256. */
export async function seedTrustAnchor(db: Db, input: SeedTrustAnchor): Promise<string> {
  const id = createHash('sha256').update(input.certificate).digest('hex');
  const notBefore = input.notBefore ?? new Date('2026-01-01T00:00:00.000Z');
  const notAfter = input.notAfter ?? new Date('2040-01-01T00:00:00.000Z');
  await db.execute(sql`
    insert into trust_anchors (sha256, country, subject_dn, ski, aki, certificate, not_before,
      not_after, is_link, sandbox_only)
    values (${id}, ${input.country ?? 'UT'}, ${input.subjectDn ?? 'C=UT, CN=Synthetic CSCA'},
      ${input.ski === undefined ? 'a1'.repeat(20) : input.ski}, ${input.aki ?? null},
      ${Buffer.from(input.certificate)}, ${notBefore.toISOString()}, ${notAfter.toISOString()},
      ${input.isLink ?? false}, ${input.sandboxOnly ?? false})`);
  return id;
}

/** A `trust_anchor_memberships` row (C53.3): `anchorId` listed by `sourceId`. */
export async function seedTrustAnchorMembership(
  db: Db,
  input: {
    sourceId: string;
    anchorId: string;
    listSigningTime?: Date;
    lastSeenAt?: Date;
    withdrawnAt?: Date | null;
  },
): Promise<void> {
  const seen = input.lastSeenAt ?? new Date();
  await db.execute(sql`
    insert into trust_anchor_memberships (source_id, anchor_id, list_signing_time, last_seen_at,
      withdrawn_at)
    values (${input.sourceId}, ${input.anchorId},
      ${(input.listSigningTime ?? seen).toISOString()}, ${seen.toISOString()},
      ${input.withdrawnAt?.toISOString() ?? null})`);
}

export interface SeedTrustCrl {
  der: Uint8Array;
  issuerCountry?: string;
  issuerKeyId?: string | null;
  thisUpdate?: Date;
  nextUpdate?: Date | null;
  crlNumber?: string | null;
  url?: string | null;
}

/** A `trust_crls` row (C53.3); returns its id, the CRL's SHA-256. */
export async function seedTrustCrl(db: Db, input: SeedTrustCrl): Promise<string> {
  const id = createHash('sha256').update(input.der).digest('hex');
  const thisUpdate = input.thisUpdate ?? new Date('2026-10-01T00:00:00.000Z');
  await db.execute(sql`
    insert into trust_crls (sha256, issuer_country, issuer_key_id, der, this_update, next_update,
      crl_number, url)
    values (${id}, ${input.issuerCountry ?? 'UT'},
      ${input.issuerKeyId === undefined ? 'a1'.repeat(20) : input.issuerKeyId},
      ${Buffer.from(input.der)}, ${thisUpdate.toISOString()},
      ${input.nextUpdate === null ? null : (input.nextUpdate ?? new Date('2027-01-01T00:00:00.000Z')).toISOString()},
      ${input.crlNumber ?? '1'}, ${input.url ?? null})`);
  return id;
}

/**
 * Owner decision 15 after Workflow 6B (P5-6): makes every `Date.now()` reading a millisecond
 * earlier than the one before, until the returned function restores the wall clock. PGlite's
 * `now()` reads `Date.now()`, to the millisecond, so rows written back to back can share
 * `created_at` or, as the wall clock steps back under load, be stamped out of order (Workflow 5C
 * saw it step back by 11 ms). A test that lists rows in order runs its writes under this clock
 * (`onTestFinished(wallClockStepsBack())`), so an order it reads from the clock, not from
 * `createdAtClock`'s stamps, fails at once. `new Date()` is not changed.
 */
export function wallClockStepsBack(): () => void {
  const wallClock = Date.now;
  let reading = wallClock();
  Date.now = () => (reading -= 1);
  return () => {
    Date.now = wallClock;
  };
}

/** The `created_at` stamps a test gives the rows it lists in order (P5-6). */
export interface CreatedAtClock {
  /**
   * Gives the row of `table` whose `key` column (`id` by default) is `id` the clock's next instant
   * as its `created_at`, and returns it.
   */
  at(table: string, id: string | number, key?: string): Promise<Date>;
  /** `row` stamped as `at` does, with its `createdAt` (and `updatedAt`) set to that instant. */
  stamp<Row extends { readonly id: string }>(table: string, row: Row): Promise<Row>;
}

/**
 * P5-6: a clock of `created_at` stamps, each a second after the one before, from `start` (by
 * default the wall clock when the clock is made, read with `new Date()`, so time-window filters
 * relative to now keep working). Where `table` has an `updated_at`, it gets the same instant.
 * The update runs in its own transaction with `session_replication_role = replica`, so no row
 * trigger runs: an append-only table (`audit_logs`) takes the stamp, and `updated_at` is not
 * bumped again. Only for tests: no production path rewrites `created_at`.
 */
export function createdAtClock(db: Db, start: Date = new Date()): CreatedAtClock {
  let next = start.getTime();
  const withUpdatedAt = new Map<string, Promise<boolean>>();
  const hasUpdatedAt = (table: string) => {
    let known = withUpdatedAt.get(table);
    if (known === undefined) {
      known = db
        .execute(
          sql`select 1 from information_schema.columns
              where table_schema = current_schema() and table_name = ${table}
                and column_name = 'updated_at'`,
        )
        .then((result: unknown) => (result as { rows: unknown[] }).rows.length > 0);
      withUpdatedAt.set(table, known);
    }
    return known;
  };
  const at = async (table: string, id: string | number, key = 'id') => {
    next += 1_000;
    const instant = new Date(next);
    const iso = instant.toISOString();
    const updatedAt = await hasUpdatedAt(table);
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(
        updatedAt
          ? sql`update ${sql.identifier(table)}
                set created_at = ${iso}::timestamptz, updated_at = ${iso}::timestamptz
                where ${sql.identifier(key)} = ${id}`
          : sql`update ${sql.identifier(table)} set created_at = ${iso}::timestamptz
                where ${sql.identifier(key)} = ${id}`,
      );
    });
    return instant;
  };
  return {
    at,
    async stamp(table, row) {
      const instant = await at(table, row.id);
      const updated = (await hasUpdatedAt(table)) && 'updatedAt' in row;
      return {
        ...row,
        ...('createdAt' in row ? { createdAt: instant } : {}),
        ...(updated ? { updatedAt: instant } : {}),
      };
    },
  };
}

// Workflow 7B (L) (C98-C100): list rows for tests, written by SQL so the owners' repositories are
// not needed and the upgrade tests never meet a drizzle insert naming a newer column.

const toRows = <Row>(result: unknown): Row[] => (result as { rows: Row[] }).rows;

/** A list of `kind`, with its kind's required members. */
export async function seedList(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    kind?: ListKind;
    name?: string;
    status?: 'active' | 'archived';
    screenAtCompletion?: boolean;
    useForCompromisedIds?: boolean;
    itemRetentionDays?: number | null;
    fieldKey?: string | null;
    createdAt?: Date;
  } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('lst');
  const kind = input.kind ?? 'string';
  const archived = (input.status ?? 'active') === 'archived';
  const retention =
    input.itemRetentionDays !== undefined
      ? input.itemRetentionDays
      : kind === 'face' || kind === 'selfie-background'
        ? 30
        : null;
  await db.execute(sql`
    insert into lists (id, environment_id, type, name, status, archived_at, item_retention_days,
      screen_at_completion, use_for_compromised_ids, field_key, created_at)
    values (${id}, ${environmentId}, ${kind}, ${input.name ?? 'Synthetic list'},
      ${archived ? 'archived' : 'active'}, ${archived ? new Date().toISOString() : null}::timestamptz,
      ${retention}, ${input.screenAtCompletion ?? true}, ${input.useForCompromisedIds ?? false},
      ${input.fieldKey ?? (kind === 'field' ? 'synthetic-field' : null)},
      ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  return { id };
}

/** C128.1: a decision about `subjectId` (an inquiry by default), its comment sealed for its row. */
export async function seedInquiryDecision(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    kind?: DecisionKind;
    subjectType?: DecisionSubjectType;
    subjectId?: string;
    comment?: string | null;
    humanReviewPending?: boolean;
    createdAt?: Date;
  } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('idec');
  const comment = input.comment ?? null;
  await db.execute(sql`
    insert into inquiry_decisions (id, environment_id, kind, subject_type, subject_id, actor_type,
      actor_id, comment, human_review_pending, created_at)
    values (${id}, ${environmentId}, ${input.kind ?? 'decline'},
      ${input.subjectType ?? 'inquiry'}, ${input.subjectId ?? testId('inq')}, 'user',
      ${testId('usr')},
      ${comment === null ? null : sealValue(SEALED.inquiryDecisionComment, id, comment)},
      ${input.humanReviewPending ?? false},
      ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  return { id };
}

/** An item of the list, with its value sealed for its row. */
export async function seedListItem(
  db: Db,
  environmentId: string,
  input: {
    listId: string;
    id?: string;
    prefix?: IdPrefix;
    value?: Record<string, unknown> | null;
    matchKey?: string | null;
    normaliserVersion?: string;
    keyId?: string | null;
    status?: 'pending' | 'active';
    createdAt?: Date;
  },
): Promise<{ id: string; matchKey: string | null }> {
  const id = input.id ?? testId(input.prefix ?? 'lis');
  const matchKey = input.matchKey === undefined ? randomBytes(32).toString('hex') : input.matchKey;
  const value = input.value === undefined ? { value: 'synthetic' } : input.value;
  await db.execute(sql`
    insert into list_items (id, environment_id, list_id, value, match_key, normaliser_version,
      key_id, status, created_at)
    values (${id}, ${environmentId}, ${input.listId},
      ${value === null ? null : sealJson(SEALED.listItemValue, id, value)}, ${matchKey},
      ${input.normaliserVersion ?? 'lists-1'}, ${input.keyId ?? null}, ${input.status ?? 'active'},
      ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  return { id, matchKey };
}

/** A face item's side row: a sealed template when given, else `pending`'s empty row. */
export async function seedListItemFace(
  db: Db,
  environmentId: string,
  input: { itemId: string; sourceInquiryId: string; template?: string | null },
): Promise<void> {
  const template = input.template ?? null;
  await db.execute(sql`
    insert into list_item_faces (environment_id, item_id, template, model, source_inquiry_id)
    values (${environmentId}, ${input.itemId},
      ${template === null ? null : sealValue(SEALED.listItemFaceTemplate, input.itemId, template)},
      ${template === null ? null : 'sface-synthetic'}, ${input.sourceInquiryId})`);
}

/** A background item's side row; `maskedFile` gives its envelope object's key and wrapped DEK. */
export async function seedListItemBackground(
  db: Db,
  environmentId: string,
  input: {
    itemId: string;
    sourceInquiryId: string;
    maskedFile?: { key: string; wrappedDek: string } | null;
  },
): Promise<void> {
  await db.execute(sql`
    insert into list_item_backgrounds (environment_id, item_id, masked_file_key,
      masked_file_wrapped_dek, source_inquiry_id)
    values (${environmentId}, ${input.itemId}, ${input.maskedFile?.key ?? null},
      ${input.maskedFile?.wrappedDek ?? null}, ${input.sourceInquiryId})`);
}

/** A list match of the inquiry, its compared value and reason sealed for its row. */
export async function seedListMatch(
  db: Db,
  environmentId: string,
  input: {
    listId: string;
    inquiryId: string;
    id?: string;
    listItemId?: string | null;
    accountId?: string | null;
    source?: ListProbeSource;
    method?: ListMatchMethod;
    matchedValue?: string | null;
    dismissal?: { reason: string; at: Date } | null;
    createdAt?: Date;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('lmt');
  const value = input.matchedValue === undefined ? 'synthetic-value' : input.matchedValue;
  const dismissal = input.dismissal ?? null;
  await db.execute(sql`
    insert into list_matches (id, environment_id, list_id, list_item_id, inquiry_id, account_id,
      source, method, tier, list_version, matched_value, status, dismissed_at, reason, created_at)
    values (${id}, ${environmentId}, ${input.listId}, ${input.listItemId ?? null},
      ${input.inquiryId}, ${input.accountId ?? null}, ${input.source ?? 'inquiry.fields'},
      ${input.method ?? 'exact'}, 'R', 1,
      ${value === null ? null : sealValue(SEALED.listMatchMatchedValue, id, value)},
      ${dismissal === null ? 'open' : 'dismissed'},
      ${dismissal === null ? null : dismissal.at.toISOString()}::timestamptz,
      ${dismissal === null ? null : sealValue(SEALED.listMatchReason, id, dismissal.reason)},
      ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  return { id };
}

/** A list match's opened compared value and dismissal reason, for the redaction scans. */
export async function openListMatchValues(
  db: Db,
  environmentId: string,
  id: string,
): Promise<{ matchedValue: string | null; reason: string | null; redactedAt: Date | null } | null> {
  const [row] = toRows<{
    matched_value: Sealed | null;
    reason: Sealed | null;
    redacted_at: string | null;
  }>(
    await db.execute(sql`
      select matched_value, reason, redacted_at from list_matches
       where environment_id = ${environmentId} and id = ${id}`),
  );
  if (row === undefined) {
    return null;
  }
  return {
    matchedValue: openOptional(SEALED.listMatchMatchedValue, id, row.matched_value),
    reason: openOptional(SEALED.listMatchReason, id, row.reason),
    redactedAt: row.redacted_at === null ? null : new Date(row.redacted_at),
  };
}

/** An importer with its envelope object. */
export async function seedImporter(
  db: Db,
  environmentId: string,
  input: {
    listId: string;
    id?: string;
    wrappedDek?: string;
    storageKey?: string;
    fileSha256?: string;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('mprt');
  await db.execute(sql`
    insert into importers (id, environment_id, list_id, file_sha256, file_bytes, storage_key,
      wrapped_dek)
    values (${id}, ${environmentId}, ${input.listId},
      ${input.fileSha256 ?? randomBytes(32).toString('hex')}, 10,
      ${input.storageKey ?? `imports/${id}`}, ${input.wrappedDek ?? 'ov1.test.synthetic'})`);
  return { id };
}

/** A staged import row, sealed for `importRowKey(importer id, row)`. */
export async function seedListImportRow(
  db: Db,
  environmentId: string,
  input: { importerId: string; row: number; value: Record<string, unknown> },
): Promise<void> {
  const key = schema.importRowKey(input.importerId, input.row);
  await db.execute(sql`
    insert into list_import_rows (environment_id, importer_id, row, value)
    values (${environmentId}, ${input.importerId}, ${input.row},
      ${sealJson(SEALED.listImportRowValue, key, input.value)})`);
}

/**
 * C104.1 (Workflow 7B): a transaction type with its first version, published unless `status` says
 * otherwise, by SQL. Every value is synthetic.
 */
export async function seedTransactionType(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    versionId?: string;
    name?: string;
    typeStatus?: 'active' | 'archived';
    status?: 'draft' | 'published' | 'superseded';
    statuses?: readonly string[];
    fieldSchemas?: readonly unknown[];
    relationSchemas?: readonly unknown[];
  } = {},
): Promise<{ id: string; versionId: string }> {
  const id = input.id ?? testId('txntp');
  const versionId = input.versionId ?? testId('txntpv');
  const status = input.status ?? 'published';
  const statuses = sql.join(
    (input.statuses ?? ['created', 'approved', 'declined', 'needs review']).map(
      (name) => sql`${name}`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    insert into transaction_types (id, environment_id, name, status)
    values (${id}, ${environmentId}, ${input.name ?? 'Synthetic type'},
      ${input.typeStatus ?? 'active'})`);
  await db.execute(sql`
    insert into transaction_type_versions (id, environment_id, transaction_type_id, version, status,
      field_schemas, statuses, relation_schemas, published_at)
    values (${versionId}, ${environmentId}, ${id}, 1, ${status},
      ${JSON.stringify(input.fieldSchemas ?? [])}::jsonb, array[${statuses}]::text[],
      ${JSON.stringify(input.relationSchemas ?? [])}::jsonb,
      ${status === 'draft' ? null : new Date().toISOString()}::timestamptz)`);
  return { id, versionId };
}

/** C105.4 (Workflow 7B): a transaction with its fields sealed, by SQL. */
export async function seedTransaction(
  db: Db,
  environmentId: string,
  input: {
    transactionTypeId: string;
    transactionTypeVersionId: string;
    id?: string;
    status?: string;
    referenceId?: string | null;
    fields?: Readonly<Record<string, unknown>>;
    tags?: readonly string[];
    createdAt?: Date;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('txn');
  const tags = sql.join(
    (input.tags ?? []).map((tag) => sql`${tag}`),
    sql`, `,
  );
  await db.execute(sql`
    insert into transactions (id, environment_id, transaction_type_id,
      transaction_type_version_id, reference_id, status, fields, tags, created_at)
    values (${id}, ${environmentId}, ${input.transactionTypeId}, ${input.transactionTypeVersionId},
      ${input.referenceId ?? null}, ${input.status ?? 'created'},
      ${sealJson(SEALED.transactionFields, id, input.fields ?? {})},
      array[${tags}]::text[], ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  return { id };
}

/** C105.4 (Workflow 7B): a transaction's `file` field, its filename sealed, by SQL. */
export async function seedTransactionFile(
  db: Db,
  environmentId: string,
  input: {
    transactionId: string;
    id?: string;
    fieldKey?: string;
    filename?: string;
    storageKey?: string;
    wrappedDek?: string;
    deletedAt?: Date | null;
  },
): Promise<{ id: string; storageKey: string }> {
  const id = input.id ?? testId('txnf');
  const storageKey = input.storageKey ?? `transactions/${id}`;
  await db.execute(sql`
    insert into transaction_files (id, environment_id, transaction_id, field_key, filename,
      mime_type, byte_size, sha256, storage_key, wrapped_dek, deleted_at)
    values (${id}, ${environmentId}, ${input.transactionId}, ${input.fieldKey ?? 'statement'},
      ${sealValue(SEALED.transactionFileFilename, id, input.filename ?? 'synthetic.pdf')},
      'application/pdf', 10, ${randomBytes(32).toString('hex')}, ${storageKey},
      ${input.wrappedDek ?? 'ov1.test.synthetic'},
      ${input.deletedAt?.toISOString() ?? null}::timestamptz)`);
  return { id, storageKey };
}

/** C105.4 (Workflow 7B): one row of the append-only status history, by SQL. */
export async function seedTransactionStatus(
  db: Db,
  environmentId: string,
  input: { transactionId: string; fromStatus?: string | null; toStatus?: string },
): Promise<void> {
  await db.execute(sql`
    insert into transaction_status_history (environment_id, transaction_id, from_status, to_status,
      actor_type)
    values (${environmentId}, ${input.transactionId}, ${input.fromStatus ?? null},
      ${input.toStatus ?? 'approved'}, 'system')`);
}

/** C105.2 (Workflow 7B): one append-only label, by SQL. */
export async function seedTransactionLabel(
  db: Db,
  environmentId: string,
  input: { transactionId: string; id?: string; label?: string; modelVersion?: string | null },
): Promise<{ id: string }> {
  const id = input.id ?? testId('txnl');
  await db.execute(sql`
    insert into transaction_labels (id, environment_id, transaction_id, label, model_version, score)
    values (${id}, ${environmentId}, ${input.transactionId}, ${input.label ?? 'synthetic-label'},
      ${input.modelVersion ?? 'synthetic-model'}, 0.5)`);
  return { id };
}

/** C105.4 (Workflow 7B): one row of the field index, by SQL. */
export async function seedTransactionFieldKey(
  db: Db,
  environmentId: string,
  input: { transactionId: string; fieldKey?: string; valueKey?: string },
): Promise<void> {
  await db.execute(sql`
    insert into transaction_field_keys (environment_id, transaction_id, field_key, value_key)
    values (${environmentId}, ${input.transactionId}, ${input.fieldKey ?? 'reference'},
      ${input.valueKey ?? randomBytes(32).toString('hex')})`);
}

/** C101.1 (Workflow 7B): one `graph_attributes` row, by SQL; an account's own row by default. */
export async function seedGraphAttribute(
  db: Db,
  environmentId: string,
  input: {
    accountId: string;
    kind?: number;
    valueKey?: string;
    keyId?: string;
    source?: { type: 'account' | 'inquiry' | 'inquiry-session' | 'verification'; id: string };
    inquiryId?: string | null;
  },
): Promise<{ valueKey: string }> {
  const valueKey = input.valueKey ?? randomBytes(32).toString('hex');
  const source = input.source ?? { type: 'account', id: input.accountId };
  await db.execute(sql`
    insert into graph_attributes (environment_id, kind, value_key, key_id, account_id, source_type,
      source_id, inquiry_id)
    values (${environmentId}, ${input.kind ?? 4}, ${valueKey}, ${input.keyId ?? 'AbCdEfGh_-1'},
      ${input.accountId}, ${source.type}, ${source.id},
      ${input.inquiryId ?? (source.type === 'inquiry' ? source.id : null)})`);
  return { valueKey };
}

/** C102.1 (Workflow 7B): a graph query template with one version, by SQL. */
export async function seedGraphQueryTemplate(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    versionId?: string;
    name?: string;
    status?: 'draft' | 'published' | 'superseded';
    config?: Readonly<Record<string, unknown>>;
  } = {},
): Promise<{ id: string; versionId: string }> {
  const id = input.id ?? testId('grqt');
  const versionId = input.versionId ?? testId('grqtv');
  const status = input.status ?? 'published';
  await db.execute(sql`
    insert into graph_query_templates (id, environment_id, name)
    values (${id}, ${environmentId}, ${input.name ?? 'Synthetic template'})`);
  await db.execute(sql`
    insert into graph_query_template_versions (id, environment_id, graph_query_template_id, version,
      status, config, published_at)
    values (${versionId}, ${environmentId}, ${id}, 1, ${status},
      ${JSON.stringify(input.config ?? {})}::jsonb,
      ${status === 'draft' ? null : new Date().toISOString()}::timestamptz)`);
  return { id, versionId };
}

/**
 * C102.4 (Workflow 7B): a graph query with its params sealed and, when given, a stored result of
 * account nodes, by SQL.
 */
export async function seedGraphQuery(
  db: Db,
  environmentId: string,
  input: {
    graphQueryTemplateId: string;
    graphQueryTemplateVersionId: string;
    id?: string;
    params?: Readonly<Record<string, string>>;
    accountIds?: readonly string[];
    createdAt?: Date;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('grphq');
  const accountIds = input.accountIds ?? [];
  const nodes = accountIds.map((value) => ({ type: 'account', value }));
  const accounts = sql.join(
    accountIds.map((value) => sql`${value}`),
    sql`, `,
  );
  await db.execute(sql`
    insert into graph_queries (id, environment_id, graph_query_template_id,
      graph_query_template_version_id, status, params, nodes, account_ids, completed_at,
      created_at)
    values (${id}, ${environmentId}, ${input.graphQueryTemplateId},
      ${input.graphQueryTemplateVersionId}, 'completed',
      ${sealJson(SEALED.graphQueryParams, id, input.params ?? { email: 'synthetic@example.com' })},
      ${JSON.stringify(nodes)}::jsonb, array[${accounts}]::text[], now(),
      ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  return { id };
}

/** C102.4 (Workflow 7B): a graph query's params, opened; `null` once redacted. */
export async function openGraphQueryParams(
  db: Db,
  environmentId: string,
  id: string,
): Promise<unknown> {
  const [row] = toRows<{ params: Sealed | null }>(
    await db.execute(sql`
      select params from graph_queries where environment_id = ${environmentId} and id = ${id}`),
  );
  return row?.params == null ? null : openJson(SEALED.graphQueryParams, id, row.params);
}

/** Workflow 8A (C112.3): a workflow row, for suites that need one before `api-workflows` writes. */
export async function seedWorkflow(
  db: Db,
  environmentId: string,
  input: { id?: string; name?: string; status?: string; kind?: string } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('wfl');
  await db.execute(sql`
    insert into workflows (id, environment_id, name, status, kind)
    values (${id}, ${environmentId}, ${input.name ?? 'Synthetic workflow'},
      ${input.status ?? 'paused'}, ${input.kind ?? 'workflow'})`);
  return { id };
}

/** Workflow 8A (C112.4): a version. `published` fills what a published version must hold. */
export async function seedWorkflowVersion(
  db: Db,
  environmentId: string,
  input: {
    workflowId: string;
    id?: string;
    versionNumber?: number;
    status?: 'draft' | 'published';
    definition?: Readonly<Record<string, unknown>>;
    publishedById?: string;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('wfv');
  const published = input.status === 'published';
  await db.execute(sql`
    insert into workflow_versions (id, environment_id, workflow_id, version_number, status,
      schema_version, definition, definition_sha256, "grant", published_at, published_by_type,
      published_by_id)
    values (${id}, ${environmentId}, ${input.workflowId}, ${input.versionNumber ?? 1},
      ${input.status ?? 'draft'}, 1, ${JSON.stringify(input.definition ?? {})}::jsonb,
      ${published ? randomBytes(32).toString('hex') : null},
      ${published ? JSON.stringify({ scopes: [], pii: false }) : null}::jsonb,
      ${published ? new Date().toISOString() : null}::timestamptz,
      ${published ? 'user' : null}::audit_actor_type,
      ${published ? (input.publishedById ?? testId('usr')) : null})`);
  return { id };
}

/** Workflow 8A (C117.2): a run with its workflow and draft, and its values sealed when given. */
export async function seedWorkflowRun(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    workflowId?: string;
    workflowVersionId?: string;
    status?: 'in_progress' | 'completed' | 'canceled';
    createdAt?: Date;
    completedAt?: Date;
    triggerSnapshot?: Readonly<Record<string, unknown>>;
    inputs?: Readonly<Record<string, unknown>>;
    variables?: Readonly<Record<string, unknown>>;
    outputs?: Readonly<Record<string, unknown>>;
  } = {},
): Promise<{ id: string; workflowId: string; workflowVersionId: string }> {
  const id = input.id ?? testId('wfr');
  const workflowId = input.workflowId ?? (await seedWorkflow(db, environmentId)).id;
  const workflowVersionId =
    input.workflowVersionId ?? (await seedWorkflowVersion(db, environmentId, { workflowId })).id;
  const sealed = (column: string, value: Readonly<Record<string, unknown>> | undefined) =>
    value === undefined ? null : sealJson(column, id, value);
  const status = input.status ?? 'in_progress';
  const completedAt =
    input.completedAt ?? (status === 'in_progress' ? undefined : (input.createdAt ?? new Date()));
  await db.execute(sql`
    insert into workflow_runs (id, environment_id, workflow_id, workflow_version_id, status,
      trigger_type, deadline_at, effective_grant, trigger_snapshot, inputs, variables, outputs,
      completed_at, created_at)
    values (${id}, ${environmentId}, ${workflowId}, ${workflowVersionId}, ${status}, 'trigger-api',
      ${new Date(Date.now() + 90 * 86_400_000).toISOString()}::timestamptz, '{}'::jsonb,
      ${sealed(SEALED.workflowRunTriggerSnapshot, input.triggerSnapshot)},
      ${sealed(SEALED.workflowRunInputs, input.inputs)},
      ${sealed(SEALED.workflowRunVariables, input.variables)},
      ${sealed(SEALED.workflowRunOutputs, input.outputs)},
      ${completedAt?.toISOString() ?? null}::timestamptz,
      ${(input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  return { id, workflowId, workflowVersionId };
}

/** Workflow 8A (C117.2): a step of a run, its values sealed when given. */
export async function seedWorkflowRunStep(
  db: Db,
  environmentId: string,
  input: {
    runId: string;
    id?: string;
    nodeId?: string;
    iterationPath?: string;
    nodeType?: string;
    status?: string;
    input?: Readonly<Record<string, unknown>>;
    output?: Readonly<Record<string, unknown>>;
    console?: readonly string[];
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('wfst');
  const sealed = (column: string, value: unknown) =>
    value === undefined ? null : sealJson(column, id, value);
  await db.execute(sql`
    insert into workflow_run_steps (id, environment_id, run_id, node_id, iteration_path, node_type,
      status, input, output, console)
    values (${id}, ${environmentId}, ${input.runId}, ${input.nodeId ?? 'run_report'},
      ${input.iterationPath ?? ''}, ${input.nodeType ?? 'action'}, ${input.status ?? 'pending'},
      ${sealed(SEALED.workflowStepInput, input.input)},
      ${sealed(SEALED.workflowStepOutput, input.output)},
      ${sealed(SEALED.workflowStepConsole, input.console)})`);
  return { id };
}

/** Workflow 8A (C117.5): an effect of a step, its result sealed when given. */
export async function seedWorkflowEffect(
  db: Db,
  environmentId: string,
  input: {
    runId: string;
    stepId: string;
    id?: string;
    effectKey?: string;
    kind?: string;
    status?: string;
    result?: Readonly<Record<string, unknown>>;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('wfef');
  await db.execute(sql`
    insert into workflow_step_effects (id, environment_id, run_id, step_id, effect_key, kind, status,
      result)
    values (${id}, ${environmentId}, ${input.runId}, ${input.stepId},
      ${input.effectKey ?? `${input.runId}/run_report/`}, ${input.kind ?? 'tag_object'},
      ${input.status ?? 'done'},
      ${input.result === undefined ? null : sealJson(SEALED.workflowEffectResult, id, input.result)})`);
  return { id };
}

/** Workflow 8A (C118.2): a trigger file's row, with a real wrapped key for an object never stored. */
export async function seedWorkflowRunFile(
  db: Db,
  environmentId: string,
  input: { runId: string; id?: string; filename?: string },
): Promise<{ id: string }> {
  const id = input.id ?? testId('wfrf');
  const { wrappedDek } = encryptBytes(Buffer.from('synthetic'), getDefaultKeyring(), {
    context: id,
  });
  await db.execute(sql`
    insert into workflow_run_files (id, environment_id, run_id, storage_key, wrapped_dek, filename,
      mime_type, byte_size, sha256)
    values (${id}, ${environmentId}, ${input.runId}, ${`workflow-run-files/${id}`}, ${wrappedDek},
      ${sealValue(SEALED.workflowRunFileFilename, id, input.filename ?? 'synthetic.png')},
      'image/png', 9, ${randomBytes(32).toString('hex')})`);
  return { id };
}

/** Workflow 8A (C125.1): a secret of the organisation, bound to `api.example.com` by default. */
export async function seedWorkflowSecret(
  db: Db,
  organizationId: string,
  input: {
    id?: string;
    key?: string;
    allowedHosts?: readonly string[];
    createdBy?: string;
  } = {},
): Promise<{ id: string; key: string }> {
  const id = input.id ?? testId('wsec');
  const key = input.key ?? `secret_${id.slice(-12).toLowerCase()}`;
  const hosts = input.allowedHosts ?? ['api.example.com'];
  await db.execute(sql`
    insert into workflow_secrets (id, organization_id, key, allowed_hosts, created_by)
    values (${id}, ${organizationId}, ${key},
      array[${sql.join(
        hosts.map((host) => sql`${host}`),
        sql`, `,
      )}]::text[], ${input.createdBy ?? testId('usr')})`);
  return { id, key };
}

/** Workflow 8A (C125.1): the environment's value of a secret, sealed for its row. */
export async function seedWorkflowSecretValue(
  db: Db,
  input: {
    organizationId: string;
    environmentId: string;
    secretId: string;
    value: string;
    previousValue?: string;
    id?: string;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('wsecv');
  const previous =
    input.previousValue === undefined
      ? null
      : sealValue(SEALED.workflowSecretPreviousValue, id, input.previousValue);
  await db.execute(sql`
    insert into workflow_secret_values (id, organization_id, secret_id, environment_id, value, last4,
      previous_value, previous_expires_at)
    values (${id}, ${input.organizationId}, ${input.secretId}, ${input.environmentId},
      ${sealValue(SEALED.workflowSecretValue, id, input.value)}, ${input.value.slice(-4)},
      ${previous}, ${previous === null ? null : sql`now() + interval '1 day'`})`);
  return { id };
}

/** Workflow 8A (C118.3): a pending scheduled run, its inputs sealed when given. */
export async function seedScheduledRun(
  db: Db,
  environmentId: string,
  input: {
    targetWorkflowId: string;
    id?: string;
    subjectId?: string;
    inputs?: Readonly<Record<string, unknown>>;
  },
): Promise<{ id: string }> {
  const id = input.id ?? testId('srrun');
  await db.execute(sql`
    insert into scheduled_runs (id, environment_id, target_workflow_id, subject_id, base_at,
      offset_value, offset_unit, offset_direction, fire_at, inputs)
    values (${id}, ${environmentId}, ${input.targetWorkflowId}, ${input.subjectId ?? null}, now(), 1,
      'days', 'after', now(),
      ${input.inputs === undefined ? null : sealJson(SEALED.scheduledRunInputs, id, input.inputs)})`);
  return { id };
}

// ---------------------------------------------------------------------------------------------
// Workflow 8B (C): cases, written by SQL, as the case repositories are `api-cases`' to build.

/** C130 (Workflow 8B): a case template with a published version 1 holding the default statuses. */
export async function seedCaseTemplate(
  db: Db,
  environmentId: string,
  input: { id?: string; versionId?: string; key?: string; name?: string } = {},
): Promise<{ id: string; versionId: string; key: string }> {
  const id = input.id ?? testId('ctmpl');
  const versionId = input.versionId ?? testId('ctmplv');
  const key = input.key ?? `T${id.slice(-6).replace(/[^A-Z0-9]/g, '0')}`;
  const statuses = JSON.stringify([
    { key: 'open', label: 'Open', category: 'initial' },
    { key: 'pending', label: 'Pending', category: 'intermediate', 'pauses-sla': true },
    { key: 'approved', label: 'Approved', category: 'end' },
    { key: 'declined', label: 'Declined', category: 'end' },
  ]);
  await db.execute(sql`
    insert into case_templates (id, environment_id, name, key)
    values (${id}, ${environmentId}, ${input.name ?? 'Synthetic review'}, ${key})`);
  await db.execute(sql`
    insert into case_template_versions (id, environment_id, case_template_id, version, status,
      statuses, published_at)
    values (${versionId}, ${environmentId}, ${id}, 1, 'published', ${statuses}::jsonb, now())`);
  return { id, versionId, key };
}

/** C129.2 (Workflow 8B): a case in `open`, its fields sealed, by SQL. */
export async function seedCase(
  db: Db,
  environmentId: string,
  input: {
    caseTemplateId: string;
    caseTemplateVersionId: string;
    key: string;
    number: number;
    id?: string;
    fields?: Readonly<Record<string, unknown>>;
    creatorId?: string;
    /** Checkpoint (Q): its queue, and a user it is assigned to (by the user, on create). */
    caseQueueId?: string | null;
    assigneeId?: string | null;
  },
): Promise<{ id: string; name: string }> {
  const id = input.id ?? testId('case');
  const name = `${input.key}-${String(input.number)}`;
  const assigneeId = input.assigneeId ?? null;
  await db.execute(sql`
    insert into cases (id, environment_id, case_template_id, case_template_version_id, name, status,
      status_category, creator_type, creator_id, fields, case_queue_id, assignee_id, assigner_type,
      assigner_id, assigned_at)
    values (${id}, ${environmentId}, ${input.caseTemplateId}, ${input.caseTemplateVersionId},
      ${name}, 'open', 'initial', 'user', ${input.creatorId ?? testId('usr')},
      ${sealJson(SEALED.caseFields, id, input.fields ?? {})}, ${input.caseQueueId ?? null},
      ${assigneeId}, ${assigneeId === null ? null : 'user'}, ${assigneeId},
      ${assigneeId === null ? null : new Date().toISOString()})`);
  return { id, name };
}

/** C134.1 (Workflow 8B): a user's comment on a case, its message sealed, by SQL. */
export async function seedCaseComment(
  db: Db,
  environmentId: string,
  input: { caseId: string; id?: string; message?: string; commenterId?: string },
): Promise<{ id: string }> {
  const id = input.id ?? testId('cscm');
  await db.execute(sql`
    insert into case_comments (id, environment_id, case_id, message, commenter_type, commenter_id)
    values (${id}, ${environmentId}, ${input.caseId},
      ${sealValue(SEALED.caseCommentMessage, id, input.message ?? 'synthetic comment')}, 'user',
      ${input.commenterId ?? testId('usr')})`);
  return { id };
}

/** C137.4 (Workflow 8B): a pending bulk action, its request sealed, by SQL. */
export async function seedCaseBulkAction(
  db: Db,
  environmentId: string,
  input: { id?: string; request?: Readonly<Record<string, unknown>>; creatorId?: string } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('cblk');
  await db.execute(sql`
    insert into case_bulk_actions (id, environment_id, action, creator_type, creator_id, request)
    values (${id}, ${environmentId}, 'add-tags', 'user', ${input.creatorId ?? testId('usr')},
      ${sealJson(SEALED.caseBulkActionRequest, id, input.request ?? { 'case-ids': [] })})`);
  return { id };
}

/** C132.1 (Workflow 8B (Q)): a queue, with its members, by SQL. A member's user must exist. */
export async function seedCaseQueue(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    name?: string;
    caseAssignmentPolicyId?: string | null;
    members?: readonly { userId: string; maxOpen?: number; paused?: boolean }[];
  } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('cqueue');
  await db.execute(sql`
    insert into case_queues (id, environment_id, name, case_assignment_policy_id)
    values (${id}, ${environmentId}, ${input.name ?? 'Synthetic queue'},
      ${input.caseAssignmentPolicyId ?? null})`);
  for (const member of input.members ?? []) {
    await db.execute(sql`
      insert into case_queue_members (environment_id, case_queue_id, user_id, max_open, paused)
      values (${environmentId}, ${id}, ${member.userId}, ${member.maxOpen ?? 50},
        ${member.paused ?? false})`);
  }
  return { id };
}

/** C132.2 (Workflow 8B (Q)): an assignment policy, with its sources in order, by SQL. */
export async function seedCaseAssignmentPolicy(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    distribution?: CaseAssignmentDistribution;
    agentIds?: readonly string[] | null;
    maxCapacity?: number | null;
    sources?: readonly ({ caseTemplateId: string } | { caseQueueId: string })[];
  } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('cap');
  const agents =
    input.agentIds === undefined || input.agentIds === null
      ? sql`null::text[]`
      : textArray(input.agentIds);
  await db.execute(sql`
    insert into case_assignment_policies (id, environment_id, name, distribution, agent_ids,
      max_capacity)
    values (${id}, ${environmentId}, 'Synthetic policy', ${input.distribution ?? 'round-robin'},
      ${agents}, ${input.maxCapacity ?? null})`);
  for (const [position, source] of (input.sources ?? []).entries()) {
    const templateId = 'caseTemplateId' in source ? source.caseTemplateId : null;
    const queueId = 'caseQueueId' in source ? source.caseQueueId : null;
    await db.execute(sql`
      insert into case_assignment_policy_sources (environment_id, case_assignment_policy_id,
        position, case_template_id, case_queue_id)
      values (${environmentId}, ${id}, ${position}, ${templateId}, ${queueId})`);
  }
  return { id };
}

/** C133.2 (Workflow 8B (Q)): a calendar, nine to five on weekdays in London unless told otherwise. */
export async function seedCaseCalendar(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    timeZone?: string;
    week?: Readonly<Record<string, readonly { start: string; end: string }[]>>;
    holidays?: readonly { date: string; label: string }[];
  } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('ccal');
  const day = [{ start: '09:00', end: '17:00' }];
  const week = input.week ?? {
    monday: day,
    tuesday: day,
    wednesday: day,
    thursday: day,
    friday: day,
    saturday: [],
    sunday: [],
  };
  await db.execute(sql`
    insert into case_calendars (id, environment_id, name, time_zone, week, holidays)
    values (${id}, ${environmentId}, 'Synthetic hours', ${input.timeZone ?? 'Europe/London'},
      ${JSON.stringify(week)}::jsonb, ${JSON.stringify(input.holidays ?? [])}::jsonb)`);
  return { id };
}

/** C133.1 (Workflow 8B (Q)): an SLA policy, four business hours around the clock by default. */
export async function seedCaseSlaPolicy(
  db: Db,
  environmentId: string,
  input: {
    id?: string;
    targetMinutes?: number;
    caseCalendarId?: string | null;
    onReopen?: CaseSlaOnReopen;
  } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('cslap');
  await db.execute(sql`
    insert into case_sla_policies (id, environment_id, name, target_minutes, case_calendar_id,
      on_reopen)
    values (${id}, ${environmentId}, 'Synthetic SLA', ${input.targetMinutes ?? 240},
      ${input.caseCalendarId ?? null}, ${input.onReopen ?? 'continue'})`);
  return { id };
}

/** A synthetic wrapped data key in `encryptBytes`' form; it wraps nothing. */
const SYNTHETIC_WRAPPED_DEK = `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`;

/** C135.2 (Workflow 8B (F)): an attachment of a case, not scanned and not yet rendered, by SQL. */
export async function seedCaseAttachment(
  db: Db,
  environmentId: string,
  input: { caseId: string; id?: string; filename?: string; wrappedDek?: string },
): Promise<{ id: string; storageKey: string }> {
  const id = input.id ?? testId('catt');
  const storageKey = `${environmentId}/attachments/${id}`;
  await db.execute(sql`
    insert into case_attachments (id, environment_id, case_id, mime_type, byte_size,
      original_filename, sha256, storage_key, wrapped_dek, uploader_type, uploader_id, scan_status)
    values (${id}, ${environmentId}, ${input.caseId}, 'image/png', 1024,
      ${sealValue(SEALED.caseAttachmentFilename, id, input.filename ?? 'synthetic.png')},
      ${randomBytes(32).toString('hex')}, ${storageKey},
      ${input.wrappedDek ?? SYNTHETIC_WRAPPED_DEK}, 'user', ${testId('usr')}, 'not_scanned')`);
  return { id, storageKey };
}

/** C135.3 (Workflow 8B (F)): an inquiry file's rendition state, pending, by SQL. */
export async function seedFileRendition(
  db: Db,
  environmentId: string,
  input: { fileId: string },
): Promise<void> {
  await db.execute(sql`
    insert into file_renditions (file_id, environment_id, status)
    values (${input.fileId}, ${environmentId}, 'pending')`);
}

/**
 * C135.3 (Workflow 8B (F)): one page of a rendition of a file or an attachment, by SQL; answers its
 * id, `<source id>/<page>`.
 */
export async function seedRenditionPage(
  db: Db,
  environmentId: string,
  input: { sourceId: string; page?: number; wrappedDek?: string },
): Promise<string> {
  const page = input.page ?? 1;
  const id = `${input.sourceId}/${String(page)}`;
  await db.execute(sql`
    insert into rendition_pages (id, environment_id, source_id, page, media_type, width, height,
      byte_size, storage_key, wrapped_dek)
    values (${id}, ${environmentId}, ${input.sourceId}, ${page}, 'image/png', 800, 600, 2048,
      ${`${environmentId}/renditions/${id}`}, ${input.wrappedDek ?? SYNTHETIC_WRAPPED_DEK})`);
  return id;
}

/** C138.1 (Workflow 8B (F)): a pending CSV export by a user, its request sealed, by SQL. */
export async function seedCaseExport(
  db: Db,
  environmentId: string,
  input: { id?: string; request?: Readonly<Record<string, unknown>>; creatorId?: string } = {},
): Promise<{ id: string }> {
  const id = input.id ?? testId('cexp');
  await db.execute(sql`
    insert into case_exports (id, environment_id, creator_type, creator_id, format, request)
    values (${id}, ${environmentId}, 'user', ${input.creatorId ?? testId('usr')}, 'csv',
      ${sealJson(SEALED.caseExportRequest, id, input.request ?? {})})`);
  return { id };
}
