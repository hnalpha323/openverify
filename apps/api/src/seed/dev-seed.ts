/**
 * The development seed (`pnpm --filter @openverify/api seed:dev [--json] [--mfa-admin]`): one
 * organization with a sandbox and a production environment, its four built-in roles (C15)
 * and one operator holding each (admin, developer, reviewer, viewer), an API key holding every
 * scope in the sandbox, the default inquiry template from
 * `contracts/fixtures/flows/default-gov-id-selfie.json` with explicit C11 settings, and the
 * deterministic Utopia test CSCA as a sandbox-only trust anchor with a CRL current for 90 days
 * (C62.8). It refuses to run in production mode (`OPENVERIFY_MODE`, else `NODE_ENV`).
 * `--mfa-admin` also enrols a second admin in TOTP and returns its secret once.
 *
 * Re-running it is safe. When the admin email already exists, its organization, environments,
 * operators and template are reused (a changed default template is published as a new version,
 * C36), passwords are left as they are, each seeded operator gets
 * its role back if it lost it, and a new API key is issued: the token is shown once and only
 * its peppered hash is stored, so an earlier token cannot be shown again. The MFA admin's TOTP
 * factor is replaced on every `--mfa-admin` run, for the same reason.
 */
import {
  parseNetworkSourceLists,
  parseWatchlistSourcesDisabled,
  type NetworkSettings,
  type S3Settings,
} from '../config.js';
import { seedNetworkData, type SeededNetworkData } from './network.js';
import { seedCaseWorkflows } from './case-workflows.js';
import { seedWorkflowRecipes } from './workflows.js';
import { createFileStorage, type ClosableFileStorage } from '../storage/index.js';
import {
  reconcileWatchlistSources,
  type ReconcileWatchlistSourcesResult,
} from '../watchlists/reconcile.js';
import type { MatcherData } from '../watchlists/matcher-data.js';
import { watchlistReconcileOptIn } from '../watchlists/un-opt-in.js';
import { importSandboxWatchlists, type SandboxWatchlistImports } from '../watchlists/sandbox.js';
import { seedReportTemplates, type SeededReportTemplates } from './report-templates.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { APP_MODES, defaultAppMode } from '../config.js';
import { installSandboxTrustAnchor } from '../trust-anchors/sandbox.js';
import {
  API_SCOPES,
  createInquiryTemplateAttributesSchema,
  safeUrl,
  TEMPLATE_SETTINGS_DEFAULTS,
  WATCHLIST_UN_OPT_IN_SWITCH,
  type ApiScope,
  type CreateInquiryTemplateAttributes,
  type TemplateSettings,
} from '@openverify/contracts';
import type { BuiltinRoleKey } from '@openverify/core';
import {
  confirmMfaFactor,
  createApiKey,
  createEnvironment,
  createInquiryTemplate,
  createInquiryTemplateVersion,
  createOrganization,
  createTotpFactor,
  createUser,
  deleteMfaFactor,
  findEnvironmentByKind,
  findUserByEmail,
  getOrganization,
  generateApiKey,
  KEK_ENV,
  KEK_PREVIOUS_ENV,
  KeyringError,
  keyringFromEnv,
  listInquiryTemplates,
  type InquiryTemplateWithVersion,
  listMfaFactors,
  listUserRoles,
  listUsersByEmail,
  normalizeEmail,
  setUserRoles,
  type Db,
  type EnvironmentKind,
  type Keyring,
  type User,
} from '@openverify/db';
import { z } from 'zod';
import { hashPassword, type PasswordHasher } from '../operator-auth/index.js';
import { newTotpSecret, otpauthUri } from '../operator-auth/totp.js';
import {
  systemClock,
  ulidIdGenerator,
  type Clock,
  type FileStorage,
  type IdGenerator,
} from '../ports.js';
import { syncOrganizationRoles } from '../services/roles.js';
import { DEFAULT_TOTP_FACTOR_NAME, TOTP_ISSUER } from '../services/mfa.js';

/** The default template: the C7 flow and checks, shared with every client's contract tests. */
export const DEFAULT_TEMPLATE_PATH = fileURLToPath(
  new URL('../../../../contracts/fixtures/flows/default-gov-id-selfie.json', import.meta.url),
);

/**
 * The C11 settings of the default template's version 1: the documented defaults, written out so
 * the seeded template shows them. `retention-days` is left out, so the environment's
 * `inquiry-retention-days` applies (C16).
 */
export const DEFAULT_TEMPLATE_SETTINGS: Readonly<TemplateSettings> = Object.freeze({
  'inquiry-expiration-seconds': TEMPLATE_SETTINGS_DEFAULTS['inquiry-expiration-seconds'],
  'session-expiration-seconds': TEMPLATE_SETTINGS_DEFAULTS['session-expiration-seconds'],
  'one-time-link-expiration-seconds':
    TEMPLATE_SETTINGS_DEFAULTS['one-time-link-expiration-seconds'],
});

const DEFAULT_ORGANIZATION_NAME = 'OpenVerify Dev';
const MIN_PEPPER_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;
const PLACEHOLDER_PREFIX = 'change-me';
const USAGE = 'usage: seed:dev [--json] [--mfa-admin] [--connect]';

/** The built-in roles that get their own operator besides the admin. */
export const SEEDED_ROLE_KEYS = ['developer', 'reviewer', 'viewer'] as const;
export type SeededRoleKey = (typeof SEEDED_ROLE_KEYS)[number];

export interface Credentials {
  email: string;
  password: string;
}

export interface DevSeedSettings {
  databaseUrl: string;
  /** `OPENVERIFY_API_KEY_PEPPER` as UTF-8 bytes, the HMAC key of API key hashes. */
  pepper: Uint8Array;
  admin: Credentials;
  /** One operator per built-in role besides admin. */
  users: Record<SeededRoleKey, Credentials>;
  /** The TOTP-enrolled admin; only with `--mfa-admin`. */
  mfaAdmin?: Credentials | undefined;
  /** Seals the TOTP secret; only with `--mfa-admin`. */
  keyring?: Keyring | undefined;
  organizationName: string;
  /** C76.4: `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`, parsed as every process parses it. */
  watchlistSourcesDisabled: readonly string[];
  /** C254.1 (Q10 granted): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, parsed as every process parses it. */
  watchlistUnOptInAllowed: boolean;
  /** C92.5 (Workflow 7A): the network source lists, parsed as every process parses them. */
  networkSources: Pick<NetworkSettings, 'sourcesDisabled' | 'sourcesEnabled'>;
  /**
   * C92.3, C93.6 (Workflow 7A, foundation-7a amendment (N) 11): the object store the sandbox
   * network import writes its snapshot to, from `S3_*` as the API reads them; `undefined` when
   * `S3_BUCKET` is unset, and the seed then imports no network data and says so.
   */
  s3?: S3Settings | undefined;
}

/**
 * The file storage `scripts/seed-dev.ts` hands to the seed, or `undefined` without `S3_*`
 * (integration-7a; stub until built).
 */
export function openDevSeedStorage(
  settings: Pick<DevSeedSettings, 's3'>,
): ClosableFileStorage | undefined {
  return settings.s3 === undefined
    ? undefined
    : createFileStorage({ driver: 's3', ...settings.s3 });
}

/** The API's default region when `S3_REGION` is unset (config.ts). */
const DEFAULT_S3_REGION = 'us-east-1';

/** `S3_*` read as the API reads them (C92.3), or `undefined` without `S3_BUCKET`. */
function seedS3Settings(
  env: Readonly<Record<string, string | undefined>>,
  issues: string[],
): S3Settings | undefined {
  const value = (name: string) => env[name]?.trim() ?? '';
  const bucket = value('S3_BUCKET');
  if (bucket === '') {
    return undefined;
  }
  const required = (name: string) => {
    const found = value(name);
    if (found === '') {
      issues.push(`${name}: is required with S3_BUCKET`);
    }
    return found;
  };
  const accessKeyId = required('S3_ACCESS_KEY_ID');
  const secretAccessKey = required('S3_SECRET_ACCESS_KEY');
  const pathStyle = value('S3_FORCE_PATH_STYLE');
  if (pathStyle !== '' && pathStyle !== 'true' && pathStyle !== 'false') {
    issues.push('S3_FORCE_PATH_STYLE: must be true or false');
  }
  const endpoint = value('S3_ENDPOINT');
  const region = value('S3_REGION');
  return {
    endpoint: endpoint === '' ? undefined : endpoint,
    region: region === '' ? DEFAULT_S3_REGION : region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: pathStyle !== 'false',
  };
}

/** The seed's environment is invalid. Issues name the variable, never its value. */
export class DevSeedConfigError extends Error {
  override name = 'DevSeedConfigError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid dev seed configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.issues = issues;
  }
}

/** The command line is not valid; the message says what to fix. */
export class DevSeedUsageError extends Error {
  override name = 'DevSeedUsageError';
}

export interface DevSeedArgs {
  /** Print the result as one JSON object (the e2e global setup reads it). */
  json: boolean;
  /** Also seed the TOTP-enrolled admin and print its secret once. */
  mfaAdmin: boolean;
  /** C244.1 (Workflow 11A): also seed the sample partner and a pending connection to it. */
  connect: boolean;
}

/**
 * Parses `seed:dev`'s arguments.
 * @throws {DevSeedUsageError} for an unknown argument.
 */
export function parseDevSeedArgs(argv: readonly string[]): DevSeedArgs {
  const args: DevSeedArgs = { json: false, mfaAdmin: false, connect: false };
  for (const arg of argv) {
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--mfa-admin') {
      args.mfaAdmin = true;
    } else if (arg === '--connect') {
      args.connect = true;
    } else {
      throw new DevSeedUsageError(`Unknown argument ${arg}. ${USAGE}`);
    }
  }
  return args;
}

const emailSchema = z.email();

const roleVariable = (role: SeededRoleKey | 'mfa-admin') =>
  `OPENVERIFY_SEED_${role.replace('-', '_').toUpperCase()}`;

/**
 * Reads `DATABASE_URL`, `OPENVERIFY_API_KEY_PEPPER`, `OPENVERIFY_SEED_ADMIN_EMAIL` and
 * `_PASSWORD`, the `OPENVERIFY_SEED_{DEVELOPER,REVIEWER,VIEWER}_{EMAIL,PASSWORD}` of the role
 * operators and the optional `OPENVERIFY_SEED_ORGANIZATION_NAME`. With `mfaAdmin`, also
 * `OPENVERIFY_SEED_MFA_ADMIN_EMAIL` and `_PASSWORD`, and the KEK (`OPENVERIFY_KEK`) that seals
 * the TOTP secret.
 * @throws {DevSeedConfigError} listing every missing or invalid variable.
 */
export function devSeedSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: { mfaAdmin?: boolean } = {},
): DevSeedSettings {
  const issues: string[] = [];
  const read = (name: string, check: (value: string) => string | null): string => {
    const value = env[name]?.trim() ?? '';
    const problem = value === '' ? 'is required' : check(value);
    if (problem !== null) {
      issues.push(`${name}: ${problem}`);
    }
    return value;
  };
  const checkEmail = (value: string) =>
    emailSchema.safeParse(value).success ? null : 'must be an email address';
  const checkPassword = (value: string) => {
    if (value.startsWith(PLACEHOLDER_PREFIX)) {
      return 'still holds a change-me placeholder; set a real password';
    }
    return value.length >= MIN_PASSWORD_LENGTH
      ? null
      : `must be at least ${String(MIN_PASSWORD_LENGTH)} characters`;
  };
  const seen = new Set<string>();
  const credentials = (prefix: string): Credentials => {
    const email = read(`${prefix}_EMAIL`, (value) => {
      const problem = checkEmail(value);
      if (problem === null && seen.has(normalizeEmail(value))) {
        return 'must differ from the other seeded operators';
      }
      seen.add(normalizeEmail(value));
      return problem;
    });
    return { email, password: read(`${prefix}_PASSWORD`, checkPassword) };
  };

  // C62.8: the seed inserts sandbox data (a test CSCA among it); never in production mode.
  const mode = env.OPENVERIFY_MODE?.trim() ?? '';
  if (mode === '' && defaultAppMode(env.NODE_ENV) === 'production') {
    issues.push('NODE_ENV: seed:dev does not run in production mode (OPENVERIFY_MODE is not set)');
  } else if (mode === 'production') {
    issues.push('OPENVERIFY_MODE: seed:dev does not run in production mode');
  } else if (mode !== '' && !(APP_MODES as readonly string[]).includes(mode)) {
    issues.push(`OPENVERIFY_MODE: must be one of ${APP_MODES.join(', ')}`);
  }
  const databaseUrl = read('DATABASE_URL', (value) => {
    const protocol = safeUrl(value)?.protocol;
    return protocol === 'postgres:' || protocol === 'postgresql:'
      ? null
      : 'must be a postgres:// URL';
  });
  const pepper = read('OPENVERIFY_API_KEY_PEPPER', (value) =>
    value.length >= MIN_PEPPER_LENGTH
      ? null
      : `must be at least ${String(MIN_PEPPER_LENGTH)} characters`,
  );
  const admin = credentials('OPENVERIFY_SEED_ADMIN');
  const users = {
    developer: credentials(roleVariable('developer')),
    reviewer: credentials(roleVariable('reviewer')),
    viewer: credentials(roleVariable('viewer')),
  };
  let mfaAdmin: Credentials | undefined;
  let keyring: Keyring | undefined;
  if (options.mfaAdmin === true) {
    mfaAdmin = credentials(roleVariable('mfa-admin'));
    try {
      keyring = keyringFromEnv({
        [KEK_ENV]: env[KEK_ENV],
        [KEK_PREVIOUS_ENV]: env[KEK_PREVIOUS_ENV],
      });
    } catch (error) {
      if (!(error instanceof KeyringError)) {
        throw error;
      }
      // KeyringError messages name the variable and never contain key material.
      issues.push(error.message.replace(/^(OPENVERIFY_KEK(?:_PREVIOUS)?) /, '$1: '));
    }
  }

  const sourcesDisabled = parseWatchlistSourcesDisabled(env);
  issues.push(...sourcesDisabled.issues);
  // C254.1 (Q10 granted; KP11-31): the UN opt-in's install switch, read as every process reads it.
  const unOptIn = env.OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED?.trim() ?? '';
  if (unOptIn !== '' && unOptIn !== 'true' && unOptIn !== 'false') {
    issues.push('OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: must be true or false');
  }
  const networkSources = parseNetworkSourceLists(env);
  issues.push(...networkSources.issues);
  const s3 = seedS3Settings(env, issues);
  if (issues.length > 0) {
    throw new DevSeedConfigError(issues);
  }
  const organizationName = env.OPENVERIFY_SEED_ORGANIZATION_NAME?.trim() ?? '';
  return {
    databaseUrl,
    pepper: new TextEncoder().encode(pepper),
    admin,
    users,
    ...(mfaAdmin === undefined ? {} : { mfaAdmin, keyring }),
    organizationName: organizationName === '' ? DEFAULT_ORGANIZATION_NAME : organizationName,
    watchlistSourcesDisabled: sourcesDisabled.value,
    watchlistUnOptInAllowed:
      unOptIn === '' ? WATCHLIST_UN_OPT_IN_SWITCH.default : unOptIn === 'true',
    networkSources: networkSources.value,
    ...(s3 === undefined ? {} : { s3 }),
  };
}

/**
 * Reads and validates template attributes (`name`, `flow`, `verification-config`) with the
 * same schema as `POST /api/v1/inquiry-templates`.
 * @throws {Error} naming the file when it is not a valid template.
 */
export async function loadTemplateAttributes(
  file: string,
): Promise<CreateInquiryTemplateAttributes> {
  const parsed = createInquiryTemplateAttributesSchema.safeParse(
    JSON.parse(await readFile(file, 'utf8')),
  );
  if (!parsed.success) {
    throw new Error(`${file} is not a valid inquiry template: ${parsed.error.message}`);
  }
  return parsed.data;
}

export interface DevSeedOptions {
  db: Db;
  pepper: Uint8Array;
  admin: Credentials;
  /** One operator per built-in role besides admin. */
  users: Record<SeededRoleKey, Credentials>;
  /**
   * An admin enrolled in TOTP. The default keyring (`setDefaultKeyring`) seals its secret.
   * The plain admin never gets a second factor, so the Phase 1 dashboard login keeps working.
   */
  mfaAdmin?: Credentials | undefined;
  organizationName: string;
  template: CreateInquiryTemplateAttributes;
  /** Defaults to Argon2id with the OWASP parameters (`hashPassword`). */
  hasher?: Pick<PasswordHasher, 'hash'> | undefined;
  ids?: IdGenerator;
  clock?: Clock;
  /** C76.4: `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`, parsed. */
  watchlistSourcesDisabled?: readonly string[] | undefined;
  /**
   * C254.1 (Q10 granted 2026-11-21): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`; the seed opts no
   * environment in, and its reconcile keeps an environment's recorded opt-in while it is true.
   */
  watchlistUnOptInAllowed?: boolean | undefined;
  /** C76.6, C78.3: the matcher data the sandbox list imports key with; `loadMatcherData()` by default. */
  watchlistMatcherData?: (() => MatcherData) | undefined;
  /** C92.5 (Workflow 7A): the network source lists, parsed. */
  networkSources?: Pick<NetworkSettings, 'sourcesDisabled' | 'sourcesEnabled'> | undefined;
  /** C92.3 (Workflow 7A): where the sandbox network import writes its snapshot, when given. */
  storage?: FileStorage | undefined;
}

export interface SeededUser {
  role: BuiltinRoleKey;
  id: string;
  email: string;
  /** False when an operator with this email already existed in the organization. */
  created: boolean;
}

export interface SeededMfaAdmin {
  id: string;
  email: string;
  created: boolean;
  /** The only copy of the secret: show it once. */
  totp: { factorId: string; secret: string; otpauthUri: string };
}

export interface DevSeedResult {
  /** False when the admin already existed and their organization was reused. */
  created: boolean;
  organizationId: string;
  /**
   * C168.2 (Workflow 9B; decision 45): the organization's `require-mfa`. The dev seed creates its
   * organization with it off, since its operators have no factor; every other path leaves it on.
   */
  requireMfa?: boolean;
  /** The sandbox environment the key, the template and dashboard sessions belong to. */
  environmentId: string;
  environments: Record<EnvironmentKind, string>;
  admin: { id: string; email: string };
  /** One operator per built-in role, in `BUILTIN_ROLE_KEYS` order (the admin first). */
  users: SeededUser[];
  /** Only when the MFA admin was asked for. */
  mfaAdmin?: SeededMfaAdmin;
  /** `versionId`: the template's current version after seeding (C36). */
  template: { id: string; versionId: string; name: string; created: boolean };
  /** `token` is the only copy of the secret: show it once. */
  apiKey: { id: string; token: string; scopes: ApiScope[] };
  /**
   * C62.8: the Utopia sandbox anchor and when its CRL needs the next run (sandbox environments
   * only; the production loader never returns it).
   */
  sandboxTrustAnchor?: { id: string; crlNextUpdate: string };
  /** C76.4: what the source reconciliation wrote; counts only. */
  watchlistSources?: ReconcileWatchlistSourcesResult;
  /** C71.3: the report templates seeded; counts only. */
  reportTemplates?: SeededReportTemplates;
  /** C76.6: the synthetic sandbox lists imported, or the warning why none was. */
  sandboxWatchlists?: SandboxWatchlistImports;
  /** C93.6 (Workflow 7A): the sandbox network data imported, or the warning why none was. */
  sandboxNetwork?: SeededNetworkData;
}

/** The template with this name in the environment, looked up across every page. */
async function findTemplateByName(
  db: Db,
  environmentId: string,
  name: string,
): Promise<InquiryTemplateWithVersion | null> {
  let after: string | undefined;
  for (;;) {
    const page = await listInquiryTemplates(db, environmentId, { size: 100, after });
    const found = page.items.find((template) => template.name === name);
    if (found !== undefined) {
      return found;
    }
    if (page.next === null) {
      return null;
    }
    after = page.next;
  }
}

/** Gives the user `roleId` on top of the roles it holds, unless it already has it. */
async function ensureRole(db: Db, organizationId: string, userId: string, roleId: string) {
  const held = (await listUserRoles(db, organizationId, userId)).map((role) => role.id);
  if (!held.includes(roleId)) {
    await setUserRoles(db, organizationId, userId, [...held, roleId]);
  }
}

/** Seeds (or tops up) the development tenant in one transaction. */
export async function seedDevEnvironment(options: DevSeedOptions): Promise<DevSeedResult> {
  const { db, admin, template } = options;
  const ids = options.ids ?? ulidIdGenerator;
  const clock = options.clock ?? systemClock;
  const hasher = options.hasher ?? { hash: hashPassword };

  const [existing] = await listUsersByEmail(db, admin.email);
  const operators: { role: BuiltinRoleKey; credentials: Credentials; mfa: boolean }[] = [
    { role: 'admin', credentials: admin, mfa: false },
    ...SEEDED_ROLE_KEYS.map((role) => ({ role, credentials: options.users[role], mfa: false })),
    ...(options.mfaAdmin === undefined
      ? []
      : [{ role: 'admin' as const, credentials: options.mfaAdmin, mfa: true }]),
  ];
  const found = new Map<string, User>();
  if (existing !== undefined) {
    for (const { credentials } of operators) {
      const user = await findUserByEmail(db, existing.organizationId, credentials.email);
      if (user !== null) {
        found.set(normalizeEmail(credentials.email), user);
      }
    }
  }
  // Argon2id runs before the transaction, so no connection is held while it works.
  const hashes = new Map<string, string>();
  for (const { credentials } of operators) {
    const key = normalizeEmail(credentials.email);
    if (!found.has(key)) {
      hashes.set(key, await hasher.hash(credentials.password));
    }
  }

  const seeded = await db.transaction(async (tx) => {
    const organizationId =
      existing?.organizationId ??
      // C168.2 (Workflow 9B; decision 45): new organisations require MFA by default; the dev seed's
      // operators have no factor, so it keeps `false` explicitly (`--mfa-admin` enrols one).
      (
        await createOrganization(tx, {
          id: ids.newId('org'),
          name: options.organizationName,
          requireMfa: false,
        })
      ).id;
    const environment = async (kind: EnvironmentKind) =>
      (await findEnvironmentByKind(tx, organizationId, kind)) ??
      (await createEnvironment(tx, { id: ids.newId('env'), organizationId, kind }));
    const sandbox = await environment('sandbox');
    const production = await environment('production');
    const roleIds = new Map(
      (await syncOrganizationRoles(tx, organizationId, ids)).map((role) => [role.key, role.id]),
    );

    const users: SeededUser[] = [];
    let mfaAdmin: SeededMfaAdmin | undefined;
    for (const { role, credentials, mfa } of operators) {
      const key = normalizeEmail(credentials.email);
      const user =
        found.get(key) ??
        (await createUser(tx, {
          id: ids.newId('usr'),
          organizationId,
          email: credentials.email,
          passwordHash: hashes.get(key) ?? '',
          name: mfa ? 'Dev MFA admin' : `Dev ${role}`,
        }));
      await ensureRole(tx, organizationId, user.id, roleIds.get(role) ?? '');
      const created = !found.has(key);
      if (!mfa) {
        users.push({ role, id: user.id, email: user.email, created });
        continue;
      }
      // A fresh, active TOTP factor replaces any earlier one: its secret is shown only now.
      for (const factor of await listMfaFactors(tx, organizationId, user.id)) {
        if (factor.type === 'totp') {
          await deleteMfaFactor(tx, organizationId, user.id, factor.id);
        }
      }
      const secret = newTotpSecret();
      const factor = await createTotpFactor(tx, organizationId, {
        id: ids.newId('mfa'),
        userId: user.id,
        name: DEFAULT_TOTP_FACTOR_NAME,
        secret,
      });
      // No step is recorded, so the current code works at once.
      await confirmMfaFactor(tx, organizationId, factor.id, { at: clock.now() });
      mfaAdmin = {
        id: user.id,
        email: user.email,
        created,
        totp: {
          factorId: factor.id,
          secret,
          otpauthUri: otpauthUri({ secret, accountName: user.email, issuer: TOTP_ISSUER }),
        },
      };
    }

    const foundTemplate = await findTemplateByName(tx, sandbox.id, template.name);
    const version = {
      flow: template.flow,
      verificationConfig: template['verification-config'],
      settings: { ...DEFAULT_TEMPLATE_SETTINGS, ...template.settings },
    };
    const seededTemplate =
      foundTemplate ??
      (await createInquiryTemplate(tx, sandbox.id, {
        id: ids.newId('itmpl'),
        name: template.name,
        version: { id: ids.newId('itmplv'), ...version },
      }));
    // C36: a changed default template becomes a new published version of the seeded one, so
    // inquiries created before keep the version they pinned.
    const current = foundTemplate?.currentVersion;
    const changed =
      current !== undefined &&
      !isDeepStrictEqual(
        {
          flow: current.flow,
          verificationConfig: current.verificationConfig,
          settings: current.settings,
        },
        version,
      );
    const versionId = changed
      ? ((
          await createInquiryTemplateVersion(tx, sandbox.id, seededTemplate.id, {
            id: ids.newId('itmplv'),
            ...version,
          })
        )?.id ?? seededTemplate.currentVersion.id)
      : seededTemplate.currentVersion.id;

    const scopes = [...API_SCOPES];
    const generated = generateApiKey('sandbox', options.pepper);
    const apiKey = await createApiKey(tx, sandbox.id, {
      id: ids.newId('key'),
      name: `Dev seed key (${clock.now().toISOString()})`,
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes,
    });

    const [seededAdmin] = users;
    return {
      created: existing === undefined,
      organizationId,
      requireMfa: (await getOrganization(tx, organizationId))?.requireMfa ?? false,
      environmentId: sandbox.id,
      environments: { sandbox: sandbox.id, production: production.id },
      admin: { id: seededAdmin?.id ?? '', email: seededAdmin?.email ?? '' },
      users,
      ...(mfaAdmin === undefined ? {} : { mfaAdmin }),
      template: {
        id: seededTemplate.id,
        versionId,
        name: seededTemplate.name,
        created: foundTemplate === null,
      },
      apiKey: { id: apiKey.id, token: generated.token, scopes },
    };
  });
  // C62.8: the Utopia test CSCA, sandbox-only, with a CRL current for 90 days (refreshed on
  // every run), listed by the enabled openverify-sandbox source.
  const anchor = await installSandboxTrustAnchor(db, { now: clock.now() });
  // C76.4, C71.3: the source rows from the manifest first, then the default report templates,
  // whose source lists resolve against them.
  const watchlistSources = await reconcileWatchlistSources(db, {
    disabled: options.watchlistSourcesDisabled ?? [],
    clock,
    // C254.1 (Q10 granted; KP11-31): another environment's recorded UN opt-in, while allowed.
    ...(await watchlistReconcileOptIn(db, options.watchlistUnOptInAllowed === true)),
  });
  // C76.6: the synthetic sandbox lists, so a fresh stack's sandbox reports answer without a
  // download; without the variant groups they are skipped with a warning.
  const sandboxWatchlists = await importSandboxWatchlists(db, {
    clock,
    disabled: options.watchlistSourcesDisabled ?? [],
    matcherData: options.watchlistMatcherData,
  });
  const reportTemplates = await seedReportTemplates(db, {
    environments: seeded.environments,
    ids,
    clock,
  });
  // C92.5, C93.6 (Workflow 7A, F14): the network source rows and the synthetic sandbox network
  // data (`api-network`), so a fresh stack's sandbox sessions are evaluated without a download.
  const sandboxNetwork = await seedNetworkData(db, {
    sourcesDisabled: options.networkSources?.sourcesDisabled ?? [],
    sourcesEnabled: options.networkSources?.sourcesEnabled ?? [],
    clock,
    ...(options.storage === undefined ? {} : { storage: options.storage }),
  });
  // C127.11, C140.5: the recipes without a case, as paused drafts: nothing runs by itself.
  await seedWorkflowRecipes(db, seeded.environments.sandbox, seeded.admin.id);
  // C140.5, C146.3 (Workflow 8B): what the case recipes need of cases (`api-case-workflows`).
  await seedCaseWorkflows(db, seeded.environments.sandbox, seeded.admin.id);
  return {
    ...seeded,
    sandboxTrustAnchor: { id: anchor.anchorId, crlNextUpdate: anchor.crlNextUpdate.toISOString() },
    watchlistSources,
    reportTemplates,
    sandboxWatchlists,
    sandboxNetwork,
  };
}

/** The sandbox network data's summary lines: the sources imported, then any warning. */
function networkLines(network: SeededNetworkData | undefined, label: string): string[] {
  if (network === undefined) {
    return [];
  }
  return [
    ...(network.sources.length === 0
      ? []
      : [
          `${label}${network.sources
            .map(
              (source) =>
                `${source.sourceId} ${source.outcome} (${String(source.entryCount)} entries)`,
            )
            .join(', ')}`,
        ]),
    ...(network.warning === null ? [] : [`${label}${network.warning}`]),
  ];
}

/** The seed's result for a terminal: ids, operators and roles, then the secrets shown once. */
export function formatDevSeedResult(result: DevSeedResult): string {
  const column = (label: string) => `  ${label.padEnd(14)}`;
  const operator = (label: string, user: { id: string; email: string; created: boolean }) =>
    `${column(label)}${user.email} (${user.id}${user.created ? '' : ', existing'})`;
  const lines = [
    result.created
      ? 'OpenVerify dev seed: created a new organization.'
      : 'OpenVerify dev seed: the admin already exists; reused their organization.',
    `${column('organization')}${result.organizationId}`,
    ...(result.requireMfa === undefined
      ? []
      : [
          `${column('require-mfa')}${
            result.requireMfa
              ? 'on'
              : 'off: set for seed:dev only; organizations created otherwise require MFA'
          }`,
        ]),
    `${column('environment')}${result.environments.sandbox} (sandbox)`,
    `${column('environment')}${result.environments.production} (production)`,
    ...result.users.map((user) => operator(user.role, user)),
    ...(result.mfaAdmin === undefined ? [] : [operator('mfa admin', result.mfaAdmin)]),
    `${column('template')}${result.template.id} "${result.template.name}"${result.template.created ? ' (created)' : ''}`,
    `${column('API key')}${result.apiKey.id}, scopes: ${result.apiKey.scopes.join(' ')}`,
    ...(result.sandboxTrustAnchor === undefined
      ? []
      : [
          `${column('trust anchor')}${result.sandboxTrustAnchor.id} (Utopia, sandbox only; CRL until ${result.sandboxTrustAnchor.crlNextUpdate})`,
        ]),
    ...(result.sandboxWatchlists === undefined
      ? []
      : result.sandboxWatchlists.warning === null
        ? [
            `${column('watchlists')}${result.sandboxWatchlists.lists
              .map(
                (list) => `${list.sourceId} ${list.outcome} (${String(list.entryCount)} entries)`,
              )
              .join(', ')}`,
          ]
        : [result.sandboxWatchlists.warning]),
    // C93.6 (Workflow 7A): the sandbox network data, or why none was imported.
    ...networkLines(result.sandboxNetwork, column('network')),
    '',
    'The API key is shown only this once; store it now:',
    `  ${result.apiKey.token}`,
    '',
  ];
  if (result.mfaAdmin !== undefined) {
    lines.push(
      'TOTP secret of the MFA admin, shown only this once:',
      `  ${result.mfaAdmin.totp.secret}`,
      `  ${result.mfaAdmin.totp.otpauthUri}`,
      '',
    );
  }
  return lines.join('\n');
}
