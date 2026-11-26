import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  API_SCOPES,
  TEMPLATE_SETTINGS_DEFAULTS,
  SELFIE_CHECK_IDS,
  defaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { BUILTIN_ROLE_KEYS, BUILTIN_ROLES } from '@openverify/core';
import {
  apiKeys,
  createKeyring,
  createOrganization,
  createUser,
  environments,
  findEnvironmentByKind,
  findUserByEmail,
  getInquiryTemplate,
  getInquiryTemplateVersion,
  hashApiKeySecret,
  listInquiryTemplates,
  listMfaFactors,
  listUserPermissions,
  listUserRoles,
  loadTrustStore,
  listUsersByEmail,
  organizations,
  roles,
  setUserRoles,
  updateEnvironmentSettings,
  workflows,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { SANDBOX_IMPORT_SKIPPED } from '../watchlists/sandbox.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbApiKeyAuthenticator } from '../auth/api-key-lookup.js';
import {
  createOperatorAuth,
  hashPassword,
  type LoginOutcome,
  type PasswordHasher,
} from '../operator-auth/index.js';
import { totpCode } from '../operator-auth/totp.js';
import { fixedClock } from '../test-support/fakes.js';
import {
  DEFAULT_TEMPLATE_PATH,
  DEFAULT_TEMPLATE_SETTINGS,
  DevSeedConfigError,
  devSeedSettingsFromEnv,
  formatDevSeedResult,
  loadTemplateAttributes,
  parseDevSeedArgs,
  seedDevEnvironment,
  type DevSeedOptions,
  type DevSeedResult,
} from './dev-seed.js';

/** Synthetic values only; at least 32 characters, plainly not a real pepper. */
const PEPPER = new TextEncoder().encode('seed-test-pepper-'.padEnd(40, 'x'));
const ADMIN = { email: 'Admin@Example.test', password: 'seed-test-password-not-real' };
/** One operator per non-admin built-in role (C15). Synthetic credentials only. */
const ROLE_USERS = {
  developer: { email: 'developer@example.test', password: 'seed-test-password-not-real' },
  reviewer: { email: 'reviewer@example.test', password: 'seed-test-password-not-real' },
  viewer: { email: 'viewer@example.test', password: 'seed-test-password-not-real' },
};
const MFA_ADMIN = { email: 'mfa-admin@example.test', password: 'seed-test-password-not-real' };

function sessionOf(outcome: LoginOutcome) {
  if (outcome.kind !== 'session') {
    throw new Error('expected a session, got an MFA challenge');
  }
  return outcome;
}

/**
 * A fast stand-in for Argon2id that returns one real hash computed once (the users table only
 * accepts Argon2id PHC strings). The seed must store exactly what the hasher returns.
 */
let precomputedHash: string;
const fakeHasher: Pick<PasswordHasher, 'hash'> = {
  hash: () => Promise.resolve(precomputedHash),
};

describe('devSeedSettingsFromEnv', () => {
  const roleEnv = {
    OPENVERIFY_SEED_DEVELOPER_EMAIL: 'developer@example.test',
    OPENVERIFY_SEED_DEVELOPER_PASSWORD: 'a-long-enough-developer-password',
    OPENVERIFY_SEED_REVIEWER_EMAIL: 'reviewer@example.test',
    OPENVERIFY_SEED_REVIEWER_PASSWORD: 'a-long-enough-reviewer-password',
    OPENVERIFY_SEED_VIEWER_EMAIL: 'viewer@example.test',
    OPENVERIFY_SEED_VIEWER_PASSWORD: 'a-long-enough-viewer-password',
  };
  const env = {
    // C62.8: seed:dev refuses production mode, which an unset mode resolves to.
    OPENVERIFY_MODE: 'development',
    DATABASE_URL: 'postgres://openverify:synthetic@127.0.0.1:5432/openverify',
    OPENVERIFY_API_KEY_PEPPER: 'p'.repeat(32),
    OPENVERIFY_SEED_ADMIN_EMAIL: ' admin@example.test ',
    OPENVERIFY_SEED_ADMIN_PASSWORD: 'a-long-enough-dev-password',
    ...roleEnv,
  };
  const mfaEnv = {
    ...env,
    OPENVERIFY_SEED_MFA_ADMIN_EMAIL: 'mfa-admin@example.test',
    OPENVERIFY_SEED_MFA_ADMIN_PASSWORD: 'a-long-enough-mfa-password',
    OPENVERIFY_KEK: Buffer.alloc(32, 7).toString('base64'),
  };

  it('refuses to run in production mode (C62.8): OPENVERIFY_MODE, else NODE_ENV', () => {
    const refused = (overrides: Record<string, string>) => {
      try {
        devSeedSettingsFromEnv({ ...env, ...overrides });
      } catch (error) {
        return (error as DevSeedConfigError).issues;
      }
      return [];
    };

    expect(refused({ OPENVERIFY_MODE: 'production' })).toEqual([
      'OPENVERIFY_MODE: seed:dev does not run in production mode',
    ]);
    expect(refused({ OPENVERIFY_MODE: '', NODE_ENV: 'production' })).toEqual([
      'NODE_ENV: seed:dev does not run in production mode (OPENVERIFY_MODE is not set)',
    ]);
    expect(refused({ OPENVERIFY_MODE: 'development', NODE_ENV: 'production' })).toEqual([]);
    expect(refused({ OPENVERIFY_MODE: 'test' })).toEqual([]);
  });

  it('reads the database, the pepper and the admin credentials', () => {
    const settings = devSeedSettingsFromEnv(env);

    expect(settings.databaseUrl).toBe(env.DATABASE_URL);
    expect(new TextDecoder().decode(settings.pepper)).toBe(env.OPENVERIFY_API_KEY_PEPPER);
    expect(settings.admin).toEqual({
      email: 'admin@example.test',
      password: 'a-long-enough-dev-password',
    });
    expect(settings.organizationName).toBe('OpenVerify Dev');
  });

  it('reads the UN opt-in switch as every process does (C254.1, Q10 granted)', () => {
    expect(
      devSeedSettingsFromEnv({ ...env, OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: 'true' }),
    ).toMatchObject({ watchlistUnOptInAllowed: true });
    expect(
      devSeedSettingsFromEnv({ ...env, OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: 'false' }),
    ).toMatchObject({ watchlistUnOptInAllowed: false });
    expect(() =>
      devSeedSettingsFromEnv({ ...env, OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: 'yes' }),
    ).toThrow(DevSeedConfigError);
  });

  it('reads one operator per built-in role besides admin (C15)', () => {
    expect(devSeedSettingsFromEnv(env).users).toEqual({
      developer: { email: 'developer@example.test', password: 'a-long-enough-developer-password' },
      reviewer: { email: 'reviewer@example.test', password: 'a-long-enough-reviewer-password' },
      viewer: { email: 'viewer@example.test', password: 'a-long-enough-viewer-password' },
    });
  });

  it('checks the role operators like the admin, naming the variables only', () => {
    const placeholder = 'change-me-reviewer-password';
    let error: unknown;
    try {
      devSeedSettingsFromEnv({
        ...env,
        OPENVERIFY_SEED_DEVELOPER_EMAIL: '',
        OPENVERIFY_SEED_REVIEWER_PASSWORD: placeholder,
        OPENVERIFY_SEED_VIEWER_PASSWORD: 'short',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DevSeedConfigError);
    expect((error as DevSeedConfigError).issues).toEqual([
      'OPENVERIFY_SEED_DEVELOPER_EMAIL: is required',
      'OPENVERIFY_SEED_REVIEWER_PASSWORD: still holds a change-me placeholder; set a real password',
      'OPENVERIFY_SEED_VIEWER_PASSWORD: must be at least 12 characters',
    ]);
    expect((error as DevSeedConfigError).message).not.toContain(placeholder);
  });

  it('refuses two seeded operators with the same email', () => {
    expect(() =>
      devSeedSettingsFromEnv({ ...env, OPENVERIFY_SEED_VIEWER_EMAIL: 'Admin@Example.test' }),
    ).toThrow('OPENVERIFY_SEED_VIEWER_EMAIL: must differ from the other seeded operators');
  });

  it('reads the MFA admin and the KEK that seals its TOTP secret only when asked to', () => {
    expect(devSeedSettingsFromEnv(mfaEnv).mfaAdmin).toBeUndefined();

    const settings = devSeedSettingsFromEnv(mfaEnv, { mfaAdmin: true });

    expect(settings.mfaAdmin).toEqual({
      email: 'mfa-admin@example.test',
      password: 'a-long-enough-mfa-password',
    });
    expect(settings.keyring?.currentKeyId).toEqual(expect.any(String));
  });

  it('requires the MFA admin and a KEK when asked for the MFA admin', () => {
    expect(() => devSeedSettingsFromEnv(env, { mfaAdmin: true })).toThrow(
      /OPENVERIFY_SEED_MFA_ADMIN_EMAIL: is required[\s\S]*OPENVERIFY_SEED_MFA_ADMIN_PASSWORD: is required[\s\S]*OPENVERIFY_KEK: is not set/,
    );
  });

  it('takes an organization name when one is given', () => {
    expect(
      devSeedSettingsFromEnv({ ...env, OPENVERIFY_SEED_ORGANIZATION_NAME: 'Acme Test' })
        .organizationName,
    ).toBe('Acme Test');
  });

  it('lists every missing or invalid variable by name, never by value', () => {
    const secret = 'change-me-admin-password';
    let error: unknown;
    try {
      devSeedSettingsFromEnv({
        OPENVERIFY_MODE: 'development',
        DATABASE_URL: 'mysql://nope',
        OPENVERIFY_API_KEY_PEPPER: 'short',
        OPENVERIFY_SEED_ADMIN_EMAIL: 'not-an-email',
        OPENVERIFY_SEED_ADMIN_PASSWORD: secret,
        ...roleEnv,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DevSeedConfigError);
    const { issues, message } = error as DevSeedConfigError;
    expect(issues).toEqual([
      'DATABASE_URL: must be a postgres:// URL',
      'OPENVERIFY_API_KEY_PEPPER: must be at least 32 characters',
      'OPENVERIFY_SEED_ADMIN_EMAIL: must be an email address',
      'OPENVERIFY_SEED_ADMIN_PASSWORD: still holds a change-me placeholder; set a real password',
    ]);
    expect(message).not.toContain(secret);
    expect(message).not.toContain('nope');
  });

  it('requires every variable and a password of at least 12 characters', () => {
    expect(() => devSeedSettingsFromEnv({})).toThrow(
      /DATABASE_URL: is required[\s\S]*OPENVERIFY_API_KEY_PEPPER: is required[\s\S]*OPENVERIFY_SEED_ADMIN_EMAIL: is required[\s\S]*OPENVERIFY_SEED_ADMIN_PASSWORD: is required/,
    );
    expect(() =>
      devSeedSettingsFromEnv({ ...env, OPENVERIFY_SEED_ADMIN_PASSWORD: 'short' }),
    ).toThrow('OPENVERIFY_SEED_ADMIN_PASSWORD: must be at least 12 characters');
  });
});

describe('loadTemplateAttributes', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'openverify-seed-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the default template from the shared C7 fixture', async () => {
    const template = await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH);

    expect(DEFAULT_TEMPLATE_PATH).toMatch(
      /contracts\/fixtures\/flows\/default-gov-id-selfie\.json$/,
    );
    expect(template.name).toBe('Government ID and selfie');
    expect(template.flow.steps.map((step) => step.type)).toEqual([
      'consent',
      'government_id',
      'selfie',
      'completion',
      'failure',
    ]);
    // C36: the fixture is the shared default template, every §4.1 check grouped.
    expect(template).toEqual(defaultInquiryTemplateAttributes());
    // C45.1: every selfie check of PLAN §4.2, required, advisory or disabled.
    expect(Object.keys(template['verification-config'].selfie?.checks ?? {}).sort()).toEqual(
      [...SELFIE_CHECK_IDS].sort(),
    );
  });

  it('refuses a file that is not a valid template, naming the file', async () => {
    const file = path.join(dir, 'broken.json');
    await writeFile(file, JSON.stringify({ name: 'No flow' }));

    await expect(loadTemplateAttributes(file)).rejects.toThrow(
      `${file} is not a valid inquiry template`,
    );
  });
});

describe('seedDevEnvironment', () => {
  let database: TestDatabase;
  let base: DevSeedOptions;

  beforeAll(async () => {
    database = await createTestDatabase();
    precomputedHash = await hashPassword(ADMIN.password);
    base = {
      db: database.db,
      pepper: PEPPER,
      admin: ADMIN,
      users: ROLE_USERS,
      organizationName: 'OpenVerify Dev',
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      hasher: fakeHasher,
    };
  });

  afterAll(async () => {
    await database.close();
  });

  it('creates an organization, its sandbox, the admin, an all-scope key and the default template', async () => {
    const result = await seedDevEnvironment(base);

    expect(result.created).toBe(true);
    expect(result.organizationId).toMatch(/^org_[0-9A-Z]{26}$/);
    expect(result.environmentId).toMatch(/^env_[0-9A-Z]{26}$/);
    expect(result.admin).toEqual({
      id: expect.stringMatching(/^usr_/) as string,
      email: 'admin@example.test',
    });
    expect(result.template).toEqual({
      id: expect.stringMatching(/^itmpl_/) as string,
      versionId: expect.stringMatching(/^itmplv_/) as string,
      name: 'Government ID and selfie',
      created: true,
    });
    expect(result.apiKey.token).toMatch(/^ov_sbx_[A-Za-z0-9_-]{43}$/);
    expect(result.apiKey.scopes).toEqual([...API_SCOPES]);

    const [user] = await listUsersByEmail(database.db, ADMIN.email);
    expect(user).toMatchObject({
      id: result.admin.id,
      organizationId: result.organizationId,
      passwordHash: precomputedHash,
    });

    const template = await getInquiryTemplate(
      database.db,
      result.environmentId,
      result.template.id,
    );
    expect(template?.latestVersion.flow).toEqual(base.template.flow);
    expect(template?.latestVersion.verificationConfig).toEqual(
      base.template['verification-config'],
    );
    expect(template?.currentVersion.settings).toEqual(DEFAULT_TEMPLATE_SETTINGS);
  });

  it('keeps require-mfa off explicitly and says so, on a reused organization too (C168.2, decision 45)', async () => {
    const result = await seedDevEnvironment(base);

    expect(result.requireMfa).toBe(false);
    const [organization] = (
      await database.client.query<{ require_mfa: boolean }>(
        'select require_mfa from organizations where id = $1',
        [result.organizationId],
      )
    ).rows;
    expect(organization?.require_mfa).toBe(false);
    expect(formatDevSeedResult(result)).toContain(
      '  require-mfa   off: set for seed:dev only; organizations created otherwise require MFA',
    );
  });

  it('gives the default template explicit C11 settings within their ranges', () => {
    expect(DEFAULT_TEMPLATE_SETTINGS).toEqual({
      'inquiry-expiration-seconds': TEMPLATE_SETTINGS_DEFAULTS['inquiry-expiration-seconds'],
      'session-expiration-seconds': TEMPLATE_SETTINGS_DEFAULTS['session-expiration-seconds'],
      'one-time-link-expiration-seconds':
        TEMPLATE_SETTINGS_DEFAULTS['one-time-link-expiration-seconds'],
    });
  });

  it('creates both a sandbox and a production environment', async () => {
    const result = await seedDevEnvironment(base);

    expect(result.environments.sandbox).toBe(result.environmentId);
    expect(result.environments.production).toMatch(/^env_/);
    const production = await findEnvironmentByKind(
      database.db,
      result.organizationId,
      'production',
    );
    expect(production?.id).toBe(result.environments.production);
  });

  it("seeds the organization's built-in roles and one operator holding each of them (C15)", async () => {
    const result = await seedDevEnvironment(base);

    expect(result.users.map((user) => user.role)).toEqual([...BUILTIN_ROLE_KEYS]);
    expect(result.users[0]).toMatchObject({ id: result.admin.id, email: 'admin@example.test' });
    for (const user of result.users) {
      const held = await listUserRoles(database.db, result.organizationId, user.id);
      expect(held.map((role) => role.key)).toEqual([user.role]);
      expect(
        (await listUserPermissions(database.db, result.organizationId, user.id)).sort(),
      ).toEqual([...BUILTIN_ROLES[user.role].permissions].sort());
    }
    const builtin = await database.db.select().from(roles);
    expect(builtin.filter((role) => role.organizationId === result.organizationId)).toHaveLength(
      BUILTIN_ROLE_KEYS.length,
    );
    const reviewer = await findUserByEmail(
      database.db,
      result.organizationId,
      ROLE_USERS.reviewer.email,
    );
    expect(reviewer?.passwordHash).toBe(precomputedHash);
  });

  it('gives a seeded operator its role back on a re-run, without duplicates', async () => {
    const first = await seedDevEnvironment(base);
    const viewer = first.users.find((user) => user.role === 'viewer');
    await setUserRoles(database.db, first.organizationId, viewer?.id ?? '', []);

    const again = await seedDevEnvironment(base);

    expect(again.users).toEqual(first.users.map((user) => ({ ...user, created: false })));
    const held = await listUserRoles(database.db, first.organizationId, viewer?.id ?? '');
    expect(held.map((role) => role.key)).toEqual(['viewer']);
    expect(
      (await database.db.select().from(environments)).filter(
        (environment) => environment.organizationId === first.organizationId,
      ),
    ).toHaveLength(2);
  });

  it('installs the recipes as paused drafts, so nothing runs by itself (C127.11, C140.5)', async () => {
    const result = await seedDevEnvironment(base);

    const rows = await database.db.select().from(workflows);
    const installed = rows.filter(
      ({ environmentId }) => environmentId === result.environments.sandbox,
    );
    expect(installed.length).toBeGreaterThan(0);
    expect(installed.every(({ status }) => status === 'paused')).toBe(true);
    expect(
      installed.every(({ latestPublishedVersionId }) => latestPublishedVersionId === null),
    ).toBe(true);
  });

  it('stores only the peppered hash of the key, which then authenticates with every scope', async () => {
    const result = await seedDevEnvironment(base);
    const rows = await database.db.select().from(apiKeys);
    const row = rows.find((candidate) => candidate.id === result.apiKey.id);

    expect(row?.secretHash).toBe(hashApiKeySecret(result.apiKey.token, PEPPER));
    expect(JSON.stringify(rows)).not.toContain(result.apiKey.token);

    const key = await createDbApiKeyAuthenticator({ db: database.db, pepper: PEPPER }).lookup(
      result.apiKey.token,
    );
    expect(key).toMatchObject({
      id: result.apiKey.id,
      environmentId: result.environmentId,
      scopes: [...API_SCOPES],
      revokedAt: null,
      expiresAt: null,
    });
  });

  it('reuses the admin, organization, sandbox and template on a re-run and issues a new key', async () => {
    const first = await seedDevEnvironment(base);
    const again = await seedDevEnvironment({
      ...base,
      admin: { email: ADMIN.email, password: 'a-different-password-is-ignored' },
    });

    expect(again.created).toBe(false);
    expect(again.organizationId).toBe(first.organizationId);
    expect(again.environmentId).toBe(first.environmentId);
    expect(again.admin).toEqual(first.admin);
    expect(again.template).toEqual({ ...first.template, created: false });
    expect(again.apiKey.id).not.toBe(first.apiKey.id);
    expect(again.apiKey.token).not.toBe(first.apiKey.token);

    expect(await database.db.select().from(organizations)).toHaveLength(1);
    expect((await listInquiryTemplates(database.db, first.environmentId)).items).toHaveLength(1);
    const [user] = await listUsersByEmail(database.db, ADMIN.email);
    expect(user?.passwordHash).toBe(precomputedHash);
  });

  it('publishes a changed default template as a new version, so earlier inquiries keep theirs (C36)', async () => {
    const tenant = await createTestDatabase();
    try {
      const phase1 = structuredClone(base.template);
      phase1['verification-config']['government-id'] = {
        checks: {
          id_blur_detection: { enabled: true, required: true },
          id_glare_detection: { enabled: true, required: true },
          id_portrait_detection: { enabled: true, required: true },
          id_double_side_detection: { enabled: true, required: true },
        },
      };
      const first = await seedDevEnvironment({ ...base, db: tenant.db, template: phase1 });
      const before = await getInquiryTemplate(tenant.db, first.environmentId, first.template.id);
      const again = await seedDevEnvironment({ ...base, db: tenant.db });
      const twice = await seedDevEnvironment({ ...base, db: tenant.db });

      expect(again.template).toMatchObject({ id: first.template.id, created: false });
      expect(again.template.versionId).not.toBe(first.template.versionId);
      expect(twice.template.versionId).toBe(again.template.versionId);
      const after = await getInquiryTemplate(tenant.db, first.environmentId, first.template.id);
      expect(after?.currentVersion).toMatchObject({
        id: again.template.versionId,
        version: 2,
        verificationConfig: base.template['verification-config'],
        settings: DEFAULT_TEMPLATE_SETTINGS,
      });
      // The version earlier inquiries pin is unchanged.
      expect(
        await getInquiryTemplateVersion(tenant.db, first.environmentId, first.template.versionId),
      ).toMatchObject({
        id: before?.currentVersion.id,
        verificationConfig: phase1['verification-config'],
      });
    } finally {
      await tenant.close();
    }
  });

  it('publishes the default template opting in to review for missing fields (Phase 12A C7)', async () => {
    const tenant = await createTestDatabase();
    try {
      // The default template as Phase 11 seeded it: no option on the extraction check.
      const phase11 = structuredClone(base.template);
      const governmentId = phase11['verification-config']['government-id'];
      const extracted = governmentId?.checks.id_extracted_properties_detection;
      if (governmentId === undefined || extracted === undefined) {
        throw new Error('the default template requires id_extracted_properties_detection');
      }
      governmentId.checks.id_extracted_properties_detection = {
        enabled: extracted.enabled,
        required: extracted.required,
      };
      const first = await seedDevEnvironment({ ...base, db: tenant.db, template: phase11 });
      const again = await seedDevEnvironment({ ...base, db: tenant.db });

      expect(again.template.versionId).not.toBe(first.template.versionId);
      const latest = await getInquiryTemplate(tenant.db, first.environmentId, first.template.id);
      expect(latest?.currentVersion.version).toBe(2);
      expect(latest?.currentVersion.verificationConfig).toMatchObject({
        'government-id': {
          checks: {
            id_extracted_properties_detection: {
              enabled: true,
              required: true,
              config: { 'missing-fields-outcome': 'review' },
            },
          },
        },
      });
    } finally {
      await tenant.close();
    }
  });

  it('hashes the password with Argon2id by default, so the admin can sign in to the dashboard', async () => {
    const own = await createTestDatabase();
    try {
      const result = await seedDevEnvironment({
        ...base,
        db: own.db,
        admin: { email: 'operator@example.test', password: ADMIN.password },
        hasher: undefined,
      });
      const [user] = await listUsersByEmail(own.db, 'operator@example.test');
      expect(user?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

      const login = sessionOf(
        await createOperatorAuth({ db: own.db }).login({
          email: 'operator@example.test',
          password: ADMIN.password,
          ip: '127.0.0.1',
        }),
      );
      expect(login.user.id).toBe(result.admin.id);
      expect(login.session.environmentId).toBe(result.environmentId);
    } finally {
      await own.close();
    }
  });

  it('creates the sandbox when an existing admin organization has none', async () => {
    const own = await createTestDatabase();
    try {
      const organization = await createOrganization(own.db, {
        id: testId('org'),
        name: 'Without sandbox',
      });
      await createUser(own.db, {
        id: testId('usr'),
        organizationId: organization.id,
        email: ADMIN.email,
        passwordHash: await hashPassword(ADMIN.password),
      });

      const result = await seedDevEnvironment({ ...base, db: own.db });

      expect(result.created).toBe(false);
      expect(result.organizationId).toBe(organization.id);
      expect(result.environmentId).toMatch(/^env_/);
      expect(result.template.created).toBe(true);
    } finally {
      await own.close();
    }
  });
});

describe('seedDevEnvironment with an MFA-enrolled admin', () => {
  let database: TestDatabase;
  let base: DevSeedOptions;

  beforeAll(async () => {
    database = await createTestDatabase({ keyring: createKeyring(Buffer.alloc(32, 9)) });
    base = {
      db: database.db,
      pepper: PEPPER,
      admin: { email: 'plain-admin@example.test', password: ADMIN.password },
      users: ROLE_USERS,
      mfaAdmin: MFA_ADMIN,
      organizationName: 'OpenVerify Dev',
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
    };
  });

  afterAll(async () => {
    await database.close();
  });

  it('enrols an admin in TOTP and returns its secret once, so it signs in with password and code', async () => {
    const result = await seedDevEnvironment(base);
    const mfaAdmin = result.mfaAdmin;

    expect(mfaAdmin?.email).toBe(MFA_ADMIN.email);
    expect(mfaAdmin?.totp.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(mfaAdmin?.totp.otpauthUri).toBe(
      `otpauth://totp/OpenVerify:${encodeURIComponent(MFA_ADMIN.email)}?secret=${mfaAdmin?.totp.secret ?? ''}&issuer=OpenVerify&algorithm=SHA1&digits=6&period=30`,
    );
    const held = await listUserRoles(database.db, result.organizationId, mfaAdmin?.id ?? '');
    expect(held.map((role) => role.key)).toEqual(['admin']);

    const clock = fixedClock(new Date());
    const auth = createOperatorAuth({ db: database.db, clock });
    const challenge = await auth.login({ ...MFA_ADMIN, ip: '127.0.0.1' });
    expect(challenge.kind).toBe('mfa');
    if (challenge.kind !== 'mfa') return;
    const session = await auth.completeMfa({
      mfaToken: challenge.mfaToken,
      totpCode: totpCode(mfaAdmin?.totp.secret ?? '', clock.now()),
    });
    expect(session.user.id).toBe(mfaAdmin?.id);
    expect(session.method).toBe('totp');

    // The plain admin keeps signing in without a second factor (the Phase 1 dashboard login).
    const plain = await auth.login({ ...base.admin, ip: '127.0.0.1' });
    expect(plain.kind).toBe('session');
  });

  it('replaces the TOTP factor on a re-run, so the new secret is the only one that works', async () => {
    const first = await seedDevEnvironment(base);
    const again = await seedDevEnvironment(base);

    expect(again.mfaAdmin?.id).toBe(first.mfaAdmin?.id);
    expect(again.mfaAdmin?.totp.secret).not.toBe(first.mfaAdmin?.totp.secret);
    const factors = await listMfaFactors(
      database.db,
      again.organizationId,
      again.mfaAdmin?.id ?? '',
    );
    expect(factors).toHaveLength(1);
    expect(factors[0]?.id).toBe(again.mfaAdmin?.totp.factorId);
    expect(factors[0]?.confirmedAt).not.toBeNull();
  });
});

describe('parseDevSeedArgs', () => {
  it('reads --json and --mfa-admin', () => {
    expect(parseDevSeedArgs([])).toEqual({ json: false, mfaAdmin: false, connect: false });
    expect(parseDevSeedArgs(['--json', '--mfa-admin'])).toEqual({
      json: true,
      mfaAdmin: true,
      connect: false,
    });
  });

  it('refuses anything else, with the usage', () => {
    expect(() => parseDevSeedArgs(['--bogus'])).toThrow(
      'Unknown argument --bogus. usage: seed:dev [--json] [--mfa-admin] [--connect]',
    );
  });
});

describe('seedDevEnvironment: the sandbox trust anchor (C62.8)', () => {
  let anchorDatabase: TestDatabase;
  let base: DevSeedOptions;

  beforeAll(async () => {
    anchorDatabase = await createTestDatabase();
    precomputedHash = await hashPassword(ADMIN.password);
    base = {
      db: anchorDatabase.db,
      pepper: PEPPER,
      admin: ADMIN,
      users: ROLE_USERS,
      organizationName: 'OpenVerify Dev',
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      hasher: fakeHasher,
    };
  });

  afterAll(async () => {
    await anchorDatabase.close();
  });

  it('inserts the Utopia sandbox anchor and its 90-day CRL, for sandbox environments only (C62.8, V04)', async () => {
    const clock = fixedClock(new Date('2026-10-20T12:00:00.000Z'));

    const first = await seedDevEnvironment({ ...base, db: anchorDatabase.db, clock });
    clock.advance(86_400_000);
    const again = await seedDevEnvironment({ ...base, db: anchorDatabase.db, clock });

    expect(first.sandboxTrustAnchor).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{64}$/u) as string,
      crlNextUpdate: '2027-01-18T12:00:00.000Z',
    });
    expect(again.sandboxTrustAnchor).toEqual({
      id: first.sandboxTrustAnchor?.id,
      crlNextUpdate: '2027-01-19T12:00:00.000Z',
    });
    const sandbox = await loadTrustStore(anchorDatabase.db, { environmentKind: 'sandbox' });
    expect(
      sandbox.anchors.map((anchor) => [anchor.id, anchor.sandboxOnly, anchor.withdrawn]),
    ).toEqual([[first.sandboxTrustAnchor?.id, true, false]]);
    // V04: the production loader returns no sandbox-only row after seed:dev on that database.
    expect(
      (await loadTrustStore(anchorDatabase.db, { environmentKind: 'production' })).anchors,
    ).toEqual([]);
  });
});

describe('formatDevSeedResult', () => {
  const result: DevSeedResult = {
    created: true,
    organizationId: 'org_01M5CJXHG0000000000000000A',
    environmentId: 'env_01M5CJXHG0000000000000000A',
    environments: {
      sandbox: 'env_01M5CJXHG0000000000000000A',
      production: 'env_01M5CJXHG0000000000000000B',
    },
    admin: { id: 'usr_01M5CJXHG0000000000000000A', email: 'admin@example.test' },
    users: [
      {
        role: 'admin',
        id: 'usr_01M5CJXHG0000000000000000A',
        email: 'admin@example.test',
        created: true,
      },
      {
        role: 'developer',
        id: 'usr_01M5CJXHG0000000000000000B',
        email: 'developer@example.test',
        created: true,
      },
      {
        role: 'reviewer',
        id: 'usr_01M5CJXHG0000000000000000C',
        email: 'reviewer@example.test',
        created: false,
      },
      {
        role: 'viewer',
        id: 'usr_01M5CJXHG0000000000000000D',
        email: 'viewer@example.test',
        created: true,
      },
    ],
    template: {
      id: 'itmpl_01M5CJXHG0000000000000000A',
      versionId: 'itmplv_01M5CJXHG0000000000000000A',
      name: 'Government ID and selfie',
      created: true,
    },
    apiKey: {
      id: 'key_01M5CJXHG0000000000000000A',
      token: 'ov_sbx_synthetic-token',
      scopes: ['inquiries:read'],
    },
  };

  it('lists the tenant, every operator with its role, and the key shown once', () => {
    const text = formatDevSeedResult(result);

    expect(text).toContain('environment   env_01M5CJXHG0000000000000000A (sandbox)');
    expect(text).toContain('environment   env_01M5CJXHG0000000000000000B (production)');
    expect(text).toContain('developer     developer@example.test (usr_01M5CJXHG0000000000000000B)');
    expect(text).toContain(
      'reviewer      reviewer@example.test (usr_01M5CJXHG0000000000000000C, existing)',
    );
    expect(text).toContain('  ov_sbx_synthetic-token');
    expect(text).not.toContain('TOTP');
  });

  it('names the sandbox trust anchor and its CRL', () => {
    const text = formatDevSeedResult({
      ...result,
      sandboxTrustAnchor: { id: 'a1'.repeat(32), crlNextUpdate: '2027-01-18T12:00:00.000Z' },
    });

    expect(text).toContain(
      `trust anchor  ${'a1'.repeat(32)} (Utopia, sandbox only; CRL until 2027-01-18T12:00:00.000Z)`,
    );
  });

  it('shows the MFA admin TOTP secret once when it was enrolled', () => {
    const text = formatDevSeedResult({
      ...result,
      mfaAdmin: {
        id: 'usr_01M5CJXHG0000000000000000E',
        email: 'mfa-admin@example.test',
        created: true,
        totp: {
          factorId: 'mfa_01M5CJXHG0000000000000000A',
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/OpenVerify:mfa-admin%40example.test?secret=JBSWY3DPEHPK3PXP',
        },
      },
    });

    expect(text).toContain('mfa admin     mfa-admin@example.test (usr_01M5CJXHG0000000000000000E)');
    expect(text).toContain('TOTP secret of the MFA admin, shown only this once:');
    expect(text).toContain('  JBSWY3DPEHPK3PXP');
    expect(text).toContain(
      '  otpauth://totp/OpenVerify:mfa-admin%40example.test?secret=JBSWY3DPEHPK3PXP',
    );
  });
});

const SEED_MATCHER = {
  status: 'loaded',
  groups: variantGroupsFrom([], 'a'.repeat(64)),
  keysVersion: keysVersion('a'.repeat(64)),
} as const;

describe('seedDevEnvironment and the report data (C71.3, C76.4, C76.6)', () => {
  let own: TestDatabase;

  beforeAll(async () => {
    own = await createTestDatabase();
  });

  afterAll(async () => {
    await own.close();
  });

  it('reconciles the watchlist source rows, then seeds the report templates', async () => {
    const result = await seedDevEnvironment({
      db: own.db,
      pepper: PEPPER,
      admin: ADMIN,
      users: ROLE_USERS,
      organizationName: 'OpenVerify Dev',
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      hasher: fakeHasher,
      watchlistSourcesDisabled: ['un-sc'],
      watchlistMatcherData: () => SEED_MATCHER,
    });

    // One row per manifest source; un-sc is disabled by default and by the variable (C76.4).
    expect(result.watchlistSources).toEqual({ sources: 8, enabled: 7, retired: 0 });
    // C71.3: one published template per report type in each environment.
    expect(result.reportTemplates).toEqual({ created: 22, existing: 0, skipped: 0 });
    // C76.6: both synthetic sandbox lists, imported once.
    expect(
      result.sandboxWatchlists?.lists.map((list) => [list.sourceId, list.outcome, list.entryCount]),
    ).toEqual([
      ['openverify-sandbox', 'applied', 69],
      ['openverify-sandbox-pep', 'applied', 62],
    ]);
    expect(formatDevSeedResult(result)).toContain(
      '  watchlists    openverify-sandbox applied (69 entries), openverify-sandbox-pep applied (62 entries)',
    );
  });

  it("opts no environment in to the UN list, and keeps another environment's opt-in while the install allows it (C254.1, Q10)", async () => {
    const { environment } = await createTestTenant(own.db);
    await updateEnvironmentSettings(own.db, environment.id, {
      'watchlist-un-opt-in': {
        'source-id': 'un-sc',
        'terms-url': 'https://www.un.org/en/about-us/terms-of-use',
        'accepted-at': '2026-11-21T12:00:00.000Z',
        'accepted-by': testId('usr'),
      },
    });
    const template = await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH);
    const seed = (allowed: boolean) =>
      seedDevEnvironment({
        db: own.db,
        pepper: PEPPER,
        admin: ADMIN,
        users: ROLE_USERS,
        organizationName: 'OpenVerify Dev',
        template,
        hasher: fakeHasher,
        watchlistUnOptInAllowed: allowed,
        watchlistMatcherData: () => SEED_MATCHER,
      });
    try {
      expect((await seed(true)).watchlistSources).toEqual({ sources: 8, enabled: 8, retired: 0 });
      expect((await seed(false)).watchlistSources).toEqual({ sources: 8, enabled: 7, retired: 0 });
      const seeded = await own.db.select().from(environments);
      const optedIn = seeded.filter((row) => row.settings['watchlist-un-opt-in'] != null);
      expect(optedIn.map((row) => row.id)).toEqual([environment.id]);
    } finally {
      await updateEnvironmentSettings(own.db, environment.id, { 'watchlist-un-opt-in': null });
    }
  });

  it('seeds everything else and says how to get the variant groups when they are missing (F14)', async () => {
    const result = await seedDevEnvironment({
      db: own.db,
      pepper: PEPPER,
      admin: ADMIN,
      users: ROLE_USERS,
      organizationName: 'OpenVerify Dev',
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      hasher: fakeHasher,
      watchlistMatcherData: () => ({ status: 'missing' }),
    });

    expect(result.created).toBe(false);
    expect(result.sandboxWatchlists).toEqual({ lists: [], warning: SANDBOX_IMPORT_SKIPPED });
    expect(formatDevSeedResult(result)).toContain(SANDBOX_IMPORT_SKIPPED);
  });
});
