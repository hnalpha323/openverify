/**
 * Workflow 11B Stage 1b common (foundation-11b): the variables 11B adds (Stage 1a amendment 25),
 * parsed in `config.ts` so no Stage 2 agent edits it (review F30), and the two hooks every secret
 * and every store's TLS go through (`config/secret-files.ts`, `config/store-tls.ts`, platform-ops').
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_REGISTRY } from './config-registry.js';
import { ConfigError, loadConfig, loadMigrateConfig, type LoadConfigOptions } from './config.js';
import * as secretFiles from './config/secret-files.js';
import * as storeTls from './config/store-tls.js';
import { syntheticEnv } from './test-support/env.js';

vi.mock('./config/secret-files.js', { spy: true });
vi.mock('./config/store-tls.js', { spy: true });

afterEach(() => {
  vi.mocked(secretFiles.resolveSecretFiles).mockClear();
  vi.mocked(storeTls.readStoreTls).mockClear();
});

function issuesOf(env: NodeJS.ProcessEnv, options: LoadConfigOptions = {}): readonly string[] {
  try {
    loadConfig(syntheticEnv(env), options);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

const configOf = (env: NodeJS.ProcessEnv = {}, options: LoadConfigOptions = {}) =>
  loadConfig(syntheticEnv(env), options);

const PREVIOUS_A = 'synthetic-previous-pepper-a-0123456789abcdef';
const PREVIOUS_B = 'synthetic-previous-pepper-b-0123456789abcdef';

describe('the 11B defaults (Stage 1a amendment 25)', () => {
  it.each(['api', 'worker'] as const)(
    'keeps every 11B behaviour off or at its default in the %s',
    (process) => {
      const config = configOf({}, { process });
      expect(config.consoleSessions).toEqual({
        idleTimeoutSeconds: 1800,
        absoluteTimeoutSeconds: 43_200,
      });
      expect(config.apiKeyPepperPrevious).toEqual([]);
      expect(config.sso).toEqual({ privateIssuers: [] });
      expect(config.storeTls).toEqual({
        caFiles: { postgres: null, redis: null, s3: null, vision: null },
      });
      expect(config.workerHeartbeatFile).toBe('/tmp/openverify-worker-heartbeat');
      expect(config.internalListen).toBeNull();
      expect(config.queueInFlightCapMax).toBe(50);
      // Q10 granted (2026-11-21): the documented default allows the opt-in; each environment still
      // needs an admin's audited acknowledgement (C254.1).
      expect(config.watchlistUnOptInAllowed).toBe(true);
      expect(config.hstsMaxAge).toBe(0);
      expect(config.startupWarnings).toEqual([]);
    },
  );
});

describe('the console session limits (C245.1)', () => {
  it('reads both limits within their bounds', () => {
    expect(
      configOf({
        OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS: '300',
        OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS: '86400',
      }).consoleSessions,
    ).toEqual({ idleTimeoutSeconds: 300, absoluteTimeoutSeconds: 86_400 });
  });

  it('refuses a limit out of bounds and an idle limit above the absolute one', () => {
    expect(issuesOf({ OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS: '299' })).toEqual([
      'OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS: must be a whole number from 300 to 86400',
    ]);
    expect(issuesOf({ OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS: '86401' })).toEqual([
      'OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS: must be a whole number from 3600 to 86400',
    ]);
    expect(
      issuesOf({
        OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS: '7200',
        OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS: '3600',
      }),
    ).toEqual([
      'OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS: must be at least OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS',
    ]);
  });
});

describe('the previous API-key peppers (C247.1)', () => {
  it.each(['api', 'worker'] as const)('reads at most two, in order, in the %s', (process) => {
    const config = configOf(
      { OPENVERIFY_API_KEY_PEPPER_PREVIOUS: `${PREVIOUS_A}, ${PREVIOUS_B}` },
      { process },
    );
    expect(config.apiKeyPepperPrevious.map((pepper) => new TextDecoder().decode(pepper))).toEqual([
      PREVIOUS_A,
      PREVIOUS_B,
    ]);
  });

  it('refuses a third pepper, a short one and the current pepper repeated, never echoing a value', () => {
    expect(
      issuesOf({
        OPENVERIFY_API_KEY_PEPPER_PREVIOUS: `${PREVIOUS_A},${PREVIOUS_B},${PREVIOUS_A}x`,
      }),
    ).toEqual(['OPENVERIFY_API_KEY_PEPPER_PREVIOUS: holds at most 2 peppers']);
    expect(issuesOf({ OPENVERIFY_API_KEY_PEPPER_PREVIOUS: `${PREVIOUS_A},short` })).toEqual([
      'OPENVERIFY_API_KEY_PEPPER_PREVIOUS: entry 2 must be at least 32 characters',
    ]);
    const current = syntheticEnv().OPENVERIFY_API_KEY_PEPPER ?? '';
    expect(issuesOf({ OPENVERIFY_API_KEY_PEPPER_PREVIOUS: current })).toEqual([
      'OPENVERIFY_API_KEY_PEPPER_PREVIOUS: entry 1 must differ from OPENVERIFY_API_KEY_PEPPER',
    ]);
  });

  it('refuses a change-me placeholder in production', () => {
    const issues = issuesOf({
      OPENVERIFY_MODE: 'production',
      OPENVERIFY_API_KEY_PEPPER_PREVIOUS: 'change-me-previous-pepper-at-least-32-bytes',
    });
    expect(issues).toContain(
      'OPENVERIFY_API_KEY_PEPPER_PREVIOUS: still holds a change-me placeholder; set a real secret',
    );
  });
});

describe('the SSO private issuers (C248.3)', () => {
  it('reads exact issuer URLs', () => {
    expect(
      configOf({
        OPENVERIFY_SSO_PRIVATE_ISSUERS:
          'https://idp.internal.example.com, https://login.example.org/tenant',
      }).sso,
    ).toEqual({
      privateIssuers: ['https://idp.internal.example.com', 'https://login.example.org/tenant'],
    });
  });

  it('refuses more than 20, and anything but an http(s) URL without credentials', () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://idp${String(i)}.example.com`).join(
      ',',
    );
    expect(issuesOf({ OPENVERIFY_SSO_PRIVATE_ISSUERS: many })).toEqual([
      'OPENVERIFY_SSO_PRIVATE_ISSUERS: holds at most 20 issuers',
    ]);
    expect(issuesOf({ OPENVERIFY_SSO_PRIVATE_ISSUERS: 'idp.example.com' })).toEqual([
      'OPENVERIFY_SSO_PRIVATE_ISSUERS: entry 1 must be an http(s) issuer URL',
    ]);
    expect(
      issuesOf({ OPENVERIFY_SSO_PRIVATE_ISSUERS: 'https://user:synthetic@idp.example.com' }),
    ).toEqual(['OPENVERIFY_SSO_PRIVATE_ISSUERS: entry 1 must be an http(s) issuer URL']);
  });
});

describe('the store TLS settings (C249.1) through store-tls.ts', () => {
  it('hands the hook every store, its URL and its CA path, and keeps its settings', () => {
    // The CA paths are not files here: the hook answers as it would for readable ones (C249.1).
    vi.mocked(storeTls.readStoreTls).mockImplementationOnce((input) => ({
      settings: { caFiles: input.caFiles },
      issues: [],
      warnings: [],
    }));
    const config = configOf({
      OPENVERIFY_POSTGRES_CA_FILE: '/etc/openverify/ca/postgres.pem',
      OPENVERIFY_VISION_CA_FILE: '/etc/openverify/ca/vision.pem',
    });
    expect(storeTls.readStoreTls).toHaveBeenCalledWith({
      production: false,
      stores: ['postgres', 'redis', 's3', 'vision'],
      urls: {
        postgres: syntheticEnv().DATABASE_URL,
        redis: syntheticEnv().REDIS_URL,
        s3: syntheticEnv().S3_ENDPOINT,
        vision: 'http://127.0.0.1:1',
      },
      caFiles: {
        postgres: '/etc/openverify/ca/postgres.pem',
        redis: null,
        s3: null,
        vision: '/etc/openverify/ca/vision.pem',
      },
    });
    expect(config.storeTls.caFiles.postgres).toBe('/etc/openverify/ca/postgres.pem');
  });

  it('refuses a CA path that is not absolute', () => {
    expect(issuesOf({ OPENVERIFY_REDIS_CA_FILE: 'ca/valkey.pem' })).toEqual([
      'OPENVERIFY_REDIS_CA_FILE: must be an absolute path',
    ]);
  });

  it("adds the hook's issues and keeps its warnings", () => {
    vi.mocked(storeTls.readStoreTls).mockReturnValueOnce({
      settings: storeTls.NO_STORE_TLS,
      issues: ['OPENVERIFY_S3_CA_FILE: cannot be read'],
      warnings: [],
    });
    expect(issuesOf({})).toEqual(['OPENVERIFY_S3_CA_FILE: cannot be read']);
    const warning = { code: 'insecure_transport', store: 'redis', reason: 'Valkey is plain text.' };
    vi.mocked(storeTls.readStoreTls).mockReturnValueOnce({
      settings: storeTls.NO_STORE_TLS,
      issues: [],
      warnings: [warning],
    });
    expect(configOf().startupWarnings).toEqual([warning]);
  });
});

describe('secrets as files (C249.2) through secret-files.ts', () => {
  it('resolves the environment through the hook, with the registry, before reading anything', () => {
    vi.mocked(secretFiles.resolveSecretFiles).mockImplementationOnce((env) => ({
      env: { ...env, OPENVERIFY_HSTS_MAX_AGE: '31536000' },
      issues: [],
      warnings: [{ code: 'secret_file_readable', variable: 'OPENVERIFY_KEK_FILE', reason: 'r' }],
    }));
    const config = configOf();
    expect(secretFiles.resolveSecretFiles).toHaveBeenCalledWith(expect.anything(), CONFIG_REGISTRY);
    expect(config.hstsMaxAge).toBe(31_536_000);
    expect(config.startupWarnings).toEqual([
      { code: 'secret_file_readable', variable: 'OPENVERIFY_KEK_FILE', reason: 'r' },
    ]);
  });

  it("lists the hook's issues with the others", () => {
    vi.mocked(secretFiles.resolveSecretFiles).mockImplementationOnce((env) => ({
      env,
      issues: ['OPENVERIFY_KEK: is set together with OPENVERIFY_KEK_FILE; set one'],
      warnings: [],
    }));
    expect(issuesOf({ OPENVERIFY_HSTS_MAX_AGE: '-1' })).toEqual([
      'OPENVERIFY_KEK: is set together with OPENVERIFY_KEK_FILE; set one',
      'OPENVERIFY_HSTS_MAX_AGE: must be a whole number from 0 to 63072000',
    ]);
  });
});

describe('the worker heartbeat, the internal listener, the caps, the UN switch and HSTS', () => {
  it('reads the heartbeat file as an absolute path (C250.2)', () => {
    expect(
      configOf(
        { OPENVERIFY_WORKER_HEARTBEAT_FILE: '/run/openverify/heartbeat' },
        { process: 'worker' },
      ).workerHeartbeatFile,
    ).toBe('/run/openverify/heartbeat');
    expect(issuesOf({ OPENVERIFY_WORKER_HEARTBEAT_FILE: 'heartbeat' })).toEqual([
      'OPENVERIFY_WORKER_HEARTBEAT_FILE: must be an absolute path',
    ]);
  });

  it('reads the internal listener as host:port (C250.3)', () => {
    expect(configOf({ OPENVERIFY_INTERNAL_LISTEN: '127.0.0.1:3101' }).internalListen).toEqual({
      host: '127.0.0.1',
      port: 3101,
    });
    expect(configOf({ OPENVERIFY_INTERNAL_LISTEN: '[::1]:3101' }).internalListen).toEqual({
      host: '::1',
      port: 3101,
    });
    for (const value of ['3101', '127.0.0.1', '127.0.0.1:99999', 'http://127.0.0.1:3101']) {
      expect(issuesOf({ OPENVERIFY_INTERNAL_LISTEN: value }), value).toEqual([
        'OPENVERIFY_INTERNAL_LISTEN: must be host:port',
      ]);
    }
  });

  it('reads the install ceiling of the queue caps (C251.2)', () => {
    expect(configOf({ OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX: '1000' }).queueInFlightCapMax).toBe(1000);
    expect(issuesOf({ OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX: '1001' })).toEqual([
      'OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX: must be a whole number from 1 to 1000',
    ]);
  });

  it("allows the UN opt-in by default since Q10's grant, and an install may lock it (C254.1)", () => {
    expect(configOf({}, { process: 'worker' }).watchlistUnOptInAllowed).toBe(true);
    expect(
      configOf({ OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: 'false' }).watchlistUnOptInAllowed,
    ).toBe(false);
    expect(issuesOf({ OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: 'yes' })).toEqual([
      'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: must be true or false',
    ]);
  });

  it('reads the HSTS max-age (C255.1)', () => {
    expect(configOf({ OPENVERIFY_HSTS_MAX_AGE: '63072000' }).hstsMaxAge).toBe(63_072_000);
    expect(issuesOf({ OPENVERIFY_HSTS_MAX_AGE: '63072001' })).toEqual([
      'OPENVERIFY_HSTS_MAX_AGE: must be a whole number from 0 to 63072000',
    ]);
  });
});

describe('db:migrate settings (C249.3, C249.4)', () => {
  // Without OPENVERIFY_MODE or NODE_ENV a process reads production mode, as the API does.
  const MIGRATE_ENV = {
    OPENVERIFY_MODE: 'test',
    DATABASE_URL: 'postgres://openverify:synthetic@127.0.0.1:1/openverify',
  } as const;

  it('reads the runtime URL, no migration URL and the default lock timeout', () => {
    expect(loadMigrateConfig({ ...MIGRATE_ENV })).toEqual({
      mode: 'test',
      databaseUrl: MIGRATE_ENV.DATABASE_URL,
      migrationDatabaseUrl: null,
      lockTimeoutSeconds: 600,
      storeTls: storeTls.NO_STORE_TLS,
      startupWarnings: [],
    });
  });

  it('reads the migration URL, the timeout and the mode, through both hooks', () => {
    // The CA path is not a file here: the hook answers as it would for a readable one (C249.1).
    vi.mocked(storeTls.readStoreTls).mockImplementationOnce((input) => ({
      settings: { caFiles: input.caFiles },
      issues: [],
      warnings: [],
    }));
    const config = loadMigrateConfig({
      ...MIGRATE_ENV,
      OPENVERIFY_MODE: 'production',
      OPENVERIFY_MIGRATION_DATABASE_URL:
        'postgresql://openverify_migrator:synthetic@db:5432/openverify',
      OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: '3600',
      OPENVERIFY_POSTGRES_CA_FILE: '/etc/openverify/ca/postgres.pem',
    });
    expect(config).toMatchObject({
      mode: 'production',
      migrationDatabaseUrl: 'postgresql://openverify_migrator:synthetic@db:5432/openverify',
      lockTimeoutSeconds: 3600,
    });
    expect(secretFiles.resolveSecretFiles).toHaveBeenCalledWith(expect.anything(), CONFIG_REGISTRY);
    expect(storeTls.readStoreTls).toHaveBeenCalledWith({
      production: true,
      stores: ['postgres', 'redis'],
      urls: {
        postgres: 'postgresql://openverify_migrator:synthetic@db:5432/openverify',
        redis: undefined,
        s3: undefined,
        vision: undefined,
      },
      caFiles: { postgres: '/etc/openverify/ca/postgres.pem', redis: null, s3: null, vision: null },
    });
  });

  it('refuses a missing runtime URL, a non-postgres migration URL and a timeout out of bounds', () => {
    expect(() =>
      loadMigrateConfig({
        OPENVERIFY_MIGRATION_DATABASE_URL: 'mysql://db/openverify',
        OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: '0',
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [
          'DATABASE_URL: is required',
          'OPENVERIFY_MIGRATION_DATABASE_URL: must be a postgres:// URL',
          'OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: must be a whole number from 1 to 3600',
        ],
      }),
    );
  });
});
