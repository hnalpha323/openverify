/**
 * Workflow 7A Stage 1b (N) (C92.5, C93.6, F14): `seed:dev` reads the network source lists as every
 * process does, and after the watchlist steps calls `seedNetworkData` (`seed/network.ts`,
 * `api-network`) with them, its clock and its storage; the printed summary says what was imported,
 * or why nothing was. The owner's function is replaced by a spy here.
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../operator-auth/index.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { fixedClock } from '../test-support/fakes.js';
import {
  DEFAULT_TEMPLATE_PATH,
  DevSeedConfigError,
  devSeedSettingsFromEnv,
  formatDevSeedResult,
  loadTemplateAttributes,
  openDevSeedStorage,
  seedDevEnvironment,
} from './dev-seed.js';
import type { SeedNetworkOptions, SeededNetworkData } from './network.js';

const seedNetwork = vi.hoisted(() =>
  vi.fn<(db: unknown, options: SeedNetworkOptions) => Promise<SeededNetworkData>>(),
);
vi.mock('./network.js', () => ({ seedNetworkData: seedNetwork }));

const ENV = {
  OPENVERIFY_MODE: 'development',
  DATABASE_URL: 'postgres://openverify:synthetic@127.0.0.1:5432/openverify',
  OPENVERIFY_API_KEY_PEPPER: 'p'.repeat(32),
  OPENVERIFY_SEED_ADMIN_EMAIL: 'admin@example.test',
  OPENVERIFY_SEED_ADMIN_PASSWORD: 'a-long-enough-dev-password',
  OPENVERIFY_SEED_DEVELOPER_EMAIL: 'developer@example.test',
  OPENVERIFY_SEED_DEVELOPER_PASSWORD: 'a-long-enough-developer-password',
  OPENVERIFY_SEED_REVIEWER_EMAIL: 'reviewer@example.test',
  OPENVERIFY_SEED_REVIEWER_PASSWORD: 'a-long-enough-reviewer-password',
  OPENVERIFY_SEED_VIEWER_EMAIL: 'viewer@example.test',
  OPENVERIFY_SEED_VIEWER_PASSWORD: 'a-long-enough-viewer-password',
};
const PEPPER = new TextEncoder().encode('seed-test-pepper-'.padEnd(40, 'x'));
const PASSWORD = 'seed-test-password-not-real';
/** A fast stand-in for Argon2id: one real hash computed once (the users table takes PHC strings). */
let precomputedHash = '';
const fakeHasher = { hash: () => Promise.resolve(precomputedHash) };

describe('the seed’s network source lists (C92.5)', () => {
  it('are read as every process reads them', () => {
    const settings = devSeedSettingsFromEnv({
      ...ENV,
      OPENVERIFY_NETWORK_SOURCES_DISABLED: 'gcp-cloud, gcp-cloud',
      OPENVERIFY_NETWORK_SOURCES_ENABLED: 'dbip-city-lite',
    });

    expect(settings.networkSources).toEqual({
      sourcesDisabled: ['gcp-cloud'],
      sourcesEnabled: ['dbip-city-lite'],
    });
  });

  it('refuse an entry that is not a source id, naming the variable only', () => {
    let issues: readonly string[] = [];
    try {
      devSeedSettingsFromEnv({ ...ENV, OPENVERIFY_NETWORK_SOURCES_ENABLED: 'Not An Id!' });
    } catch (error) {
      issues = (error as DevSeedConfigError).issues;
    }

    expect(issues).toEqual([
      'OPENVERIFY_NETWORK_SOURCES_ENABLED: must be comma-separated source ids such as gcp-cloud',
    ]);
  });
});

describe('the seed’s object storage, where the sandbox network import writes (C92.3, C93.6)', () => {
  const S3 = {
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'openverify-synthetic',
    S3_ACCESS_KEY_ID: 'change-me-access-key',
    S3_SECRET_ACCESS_KEY: 'change-me-secret-key-synthetic',
  };

  it('is read from S3_* as the API reads it, path-style by default', () => {
    expect(devSeedSettingsFromEnv({ ...ENV, ...S3 }).s3).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'openverify-synthetic',
      accessKeyId: 'change-me-access-key',
      secretAccessKey: 'change-me-secret-key-synthetic',
      forcePathStyle: true,
    });
    expect(
      devSeedSettingsFromEnv({ ...ENV, ...S3, S3_FORCE_PATH_STYLE: 'false', S3_ENDPOINT: '' }).s3,
    ).toMatchObject({ endpoint: undefined, forcePathStyle: false });
  });

  it('is absent without S3_BUCKET, so the seed imports no network data and says why', () => {
    expect(devSeedSettingsFromEnv(ENV).s3).toBeUndefined();
    expect(openDevSeedStorage({ s3: undefined })).toBeUndefined();
  });

  it('refuses a bucket without its credentials, naming the variables and never a value', () => {
    let issues: readonly string[] = [];
    try {
      devSeedSettingsFromEnv({
        ...ENV,
        S3_BUCKET: 'openverify-synthetic',
        S3_FORCE_PATH_STYLE: 'maybe',
      });
    } catch (error) {
      issues = (error as DevSeedConfigError).issues;
    }

    expect(issues).toEqual([
      'S3_ACCESS_KEY_ID: is required with S3_BUCKET',
      'S3_SECRET_ACCESS_KEY: is required with S3_BUCKET',
      'S3_FORCE_PATH_STYLE: must be true or false',
    ]);
  });

  it('opens an S3 file storage that the script closes', async () => {
    const storage = openDevSeedStorage(devSeedSettingsFromEnv({ ...ENV, ...S3 }));

    expect(storage).toBeDefined();
    expect(typeof storage?.put).toBe('function');
    await storage?.close();
  });
});

describe('seedDevEnvironment and the sandbox network data (C93.6)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    precomputedHash = await hashPassword(PASSWORD);
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it('imports it with the lists, the clock and the storage, and prints what it imported', async () => {
    const imported: SeededNetworkData = {
      sources: [{ sourceId: 'openverify-sandbox-network', outcome: 'applied', entryCount: 9 }],
      warning: null,
    };
    seedNetwork.mockReset().mockResolvedValue(imported);
    const clock = fixedClock();
    const storage = createInMemoryFileStorage();
    const networkSources = { sourcesDisabled: ['gcp-cloud'], sourcesEnabled: [] };

    const result = await seedDevEnvironment({
      db: database.db,
      pepper: PEPPER,
      admin: { email: 'admin@example.test', password: PASSWORD },
      users: {
        developer: { email: 'developer@example.test', password: PASSWORD },
        reviewer: { email: 'reviewer@example.test', password: PASSWORD },
        viewer: { email: 'viewer@example.test', password: PASSWORD },
      },
      organizationName: 'OpenVerify Dev',
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      hasher: fakeHasher,
      clock,
      networkSources,
      storage,
      watchlistMatcherData: () => ({ status: 'missing' }),
    });

    expect(seedNetwork).toHaveBeenCalledTimes(1);
    expect(seedNetwork).toHaveBeenCalledWith(database.db, { ...networkSources, clock, storage });
    expect(result.sandboxNetwork).toEqual(imported);
    expect(formatDevSeedResult(result)).toContain(
      '  network       openverify-sandbox-network applied (9 entries)',
    );
  });

  it('prints why it imported nothing', async () => {
    const warning = 'The ASN seeds are missing: run python3 scripts/fetch_data.py.';
    seedNetwork.mockReset().mockResolvedValue({ sources: [], warning });

    const result = await seedDevEnvironment({
      db: database.db,
      pepper: PEPPER,
      admin: { email: 'admin@example.test', password: PASSWORD },
      users: {
        developer: { email: 'developer@example.test', password: PASSWORD },
        reviewer: { email: 'reviewer@example.test', password: PASSWORD },
        viewer: { email: 'viewer@example.test', password: PASSWORD },
      },
      organizationName: 'OpenVerify Dev',
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      hasher: fakeHasher,
      watchlistMatcherData: () => ({ status: 'missing' }),
    });

    expect(seedNetwork).toHaveBeenCalledWith(
      database.db,
      expect.objectContaining({ sourcesDisabled: [], sourcesEnabled: [] }),
    );
    expect(formatDevSeedResult(result)).toContain(`  network       ${warning}`);
  });
});
