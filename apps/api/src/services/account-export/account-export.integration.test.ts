/**
 * C253 (Workflow 11B, `dsar-export`): the access export on a real Postgres and a real Valkey
 * (Testcontainers), through the production service, job, hooks and rate gate:
 *
 * - an account touching every family the C16 suite seeds is exported: each part of the manifest
 *   holds its rows, every file is listed with its size and digest, face templates only counted;
 * - two creates at once: one 202 and one 409 `account_export_pending` (the account's row lock);
 * - a listed file deleted after the cut answers 410 `account_export_item_redacted`;
 * - the deletion ordering both ways: a redaction after the cut deletes the export and its manifest
 *   in its cascade; a redaction while the job cuts leaves no export and no object;
 * - the expiry in the C16 hook;
 * - the `account-export` policy against Valkey: 10 an hour per environment, then 429; with the store
 *   stopped, 503 `account_export_unavailable` (failing closed).
 *
 * Synthetic rows only (rule 9).
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  createDatabase,
  createKeyring,
  getAccountExportRecord,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppError } from '../../errors.js';
import { processAccountExport } from '../../jobs/account-export/process.js';
import { createCapturingLogger } from '../../jobs/testing.js';
import type { Principal, ServiceContext } from '../../ports.js';
import {
  closeRateLimitRedis,
  createRateLimitRedis,
  createRateLimiter,
} from '../../rate-limit/index.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import { createRedactionService } from '../redaction.js';
import { seedPiiSubject, type SeededPiiSubject } from '../redaction.test-support.js';
import { cutAccountExport } from './cut.js';
import { readLiveFile } from './files.js';
import { accountExportHooks } from './hooks.js';
import { enforceAccountExportRate } from './refusals.js';
import {
  createAccountExport,
  getAccountExportFile,
  getAccountExportManifest,
  type AccountExportDeps,
} from './service.js';
import { accountExportStores } from './store.js';
import { VALKEY_TEST_IMAGE } from '../../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
const keyring = createKeyring(randomBytes(32));
const T0 = new Date('2026-11-13T12:00:00.000Z');
const DAY = 86_400_000;
const clock = fixedClock(T0);
const storage = createInMemoryFileStorage();

let container: StartedPostgreSqlContainer | undefined;
let valkey: StartedTestContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  [container, valkey] = await Promise.all([
    startIntegrationPostgres(),
    new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
  await valkey?.stop();
});

interface Tenant {
  ctx: ServiceContext;
  subject: SeededPiiSubject;
}

async function tenant(): Promise<Tenant> {
  const { organization, environment } = await createTestTenant(db);
  const ctx = { organizationId: organization.id, environmentId: environment.id, requestId: 'req' };
  const subject = await seedPiiSubject({ db, storage, keyring, environmentId: environment.id });
  return { ctx, subject };
}

const principal = (ctx: ServiceContext): Principal => ({
  kind: 'api-key',
  apiKeyId: 'key_01M5CN0000000000000011BE01',
  organizationId: ctx.organizationId,
  environmentId: ctx.environmentId,
  environmentKind: 'sandbox',
  permissions: new Set(['account-access:export', 'pii:view']),
});

const deps = (): AccountExportDeps => ({
  db,
  clock,
  audit: createRecordingAuditLogger(),
  storage,
  keyring,
  ids: { newId: () => newId('aexp') },
  store: accountExportStores,
  liveFile: readLiveFile,
  admit: () => Promise.resolve(),
});

const processDeps = () => ({ db, clock, logger: createCapturingLogger(), keyring, storage });

const redaction = () =>
  createRedactionService({
    db,
    storage,
    events: createRecordingEventPublisher(),
    clock,
    audit: createRecordingAuditLogger(),
  });

const codeOf = (work: Promise<unknown>) =>
  work.then(
    () => 'ok',
    (error: unknown) => `${String((error as AppError).status)}:${String((error as AppError).code)}`,
  );

async function readyExport({ ctx, subject }: Tenant): Promise<string> {
  const { data } = await createAccountExport(
    deps(),
    { ctx, principal: principal(ctx) },
    subject.accountId,
  );
  await expect(
    processAccountExport({ environmentId: ctx.environmentId, exportId: data.id }, processDeps()),
  ).resolves.toEqual({ outcome: 'ready' });
  return data.id;
}

describe('the access export on Postgres (C253.2)', () => {
  it('exports an account touching every seeded family, each part with its rows', async () => {
    const seeded = await tenant();
    const id = await readyExport(seeded);
    const manifest = await getAccountExportManifest(
      deps(),
      { ctx: seeded.ctx, principal: principal(seeded.ctx) },
      id,
    );

    const { subject } = manifest;
    const review = manifest['operator-review'];
    expect(subject.account).toMatchObject({ id: seeded.subject.accountId });
    for (const part of [
      subject.inquiries,
      subject['inquiry-sessions'],
      subject.verifications,
      subject.devices,
      subject.transactions,
      subject['consent-records'],
      review['list-memberships'],
      review.signals,
      review['integrity-verdicts'],
    ]) {
      expect(part.length).toBeGreaterThan(0);
    }
    expect(subject['face-templates'].count).toBeGreaterThan(0);
    expect(review.label).toBe('review before disclosure');
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const file of manifest.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest['not-covered'].length).toBeGreaterThan(0);
  });

  it('answers one of two creates at once and 409 account_export_pending to the other', async () => {
    const { ctx, subject } = await tenant();
    const acting = { ctx, principal: principal(ctx) };

    const outcomes = await Promise.all([
      codeOf(createAccountExport(deps(), acting, subject.accountId)),
      codeOf(createAccountExport(deps(), acting, subject.accountId)),
    ]);

    expect(outcomes.sort()).toEqual(['409:account_export_pending', 'ok']);
  });

  it('answers 410 for a listed file deleted after the cut', async () => {
    const seeded = await tenant();
    const id = await readyExport(seeded);
    const acting = { ctx: seeded.ctx, principal: principal(seeded.ctx) };
    const manifest = await getAccountExportManifest(deps(), acting, id);
    const file = manifest.files.find((entry) => entry.kind === 'verification-file');
    expect(file).toBeDefined();
    await pool.query('update files set deleted_at = $2 where id = $1', [file?.id, T0]);

    expect(await codeOf(getAccountExportFile(deps(), acting, id, file?.id ?? ''))).toBe(
      '410:account_export_item_redacted',
    );
  });
});

describe('C253.4: the deletion ordering, both ways', () => {
  it('a redaction after the cut deletes the export and its manifest in its cascade', async () => {
    const seeded = await tenant();
    const id = await readyExport(seeded);
    const key = (await getAccountExportRecord(db, seeded.ctx.environmentId, id))?.storageKey ?? '';
    expect(await storage.get(key)).not.toBeNull();

    await redaction().redactInquiry(seeded.ctx, seeded.subject.inquiryId, {
      type: 'api-key',
      id: 'key_01M5CN0000000000000011BE01',
    });

    await expect(getAccountExportRecord(db, seeded.ctx.environmentId, id)).resolves.toBeNull();
    expect(await storage.get(key)).toBeNull();
  });

  it('a redaction while the job cuts leaves no export and no object', async () => {
    const { ctx, subject } = await tenant();
    const { data } = await createAccountExport(
      deps(),
      { ctx, principal: principal(ctx) },
      subject.accountId,
    );
    const before = new Set(storage.keys());

    const outcome = await cutAccountExport(
      {
        ...processDeps(),
        store: {
          ...accountExportStores,
          // The account is redacted between the read and the ready write (its cascade's hook
          // deletes the pending export), so the ready write finds no pending row.
          completeExport: async (tx, environmentId, exportId, completion) => {
            await redaction().redactAccount(ctx, subject.accountId, {
              type: 'api-key',
              id: 'key_01M5CN0000000000000011BE01',
            });
            return accountExportStores.completeExport(tx, environmentId, exportId, completion);
          },
        },
      },
      ctx.environmentId,
      data.id,
    );

    expect(outcome).toEqual({ outcome: 'skipped' });
    await expect(getAccountExportRecord(db, ctx.environmentId, data.id)).resolves.toBeNull();
    expect(storage.keys().filter((key) => !before.has(key) && key.includes(data.id))).toEqual([]);
  });

  it('the C16 hook expires an export past its life and deletes its manifest', async () => {
    const seeded = await tenant();
    clock.set(new Date(T0.getTime() + 2 * DAY));
    const id = await readyExport(seeded);
    clock.set(T0);
    const key = (await getAccountExportRecord(db, seeded.ctx.environmentId, id))?.storageKey ?? '';

    const report = await accountExportHooks.retention(
      { db, storage },
      { now: new Date(T0.getTime() + 9 * DAY), limit: 500 },
    );

    expect(report.expiredAccountExports).toBeGreaterThanOrEqual(1);
    expect(await getAccountExportRecord(db, seeded.ctx.environmentId, id)).toMatchObject({
      status: 'expired',
      storageKey: null,
    });
    expect(await storage.get(key)).toBeNull();
  });
});

describe('the account-export policy against Valkey (C253.7)', () => {
  it('allows 10 an hour per environment, then 429; without its store, 503 account_export_unavailable', async () => {
    const target = valkey;
    if (target === undefined) {
      throw new Error('Valkey did not start');
    }
    const redis = createRateLimitRedis(
      `redis://${target.getHost()}:${String(target.getMappedPort(6379))}`,
    );
    const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const limiter = createRateLimiter({ redis, clock, logger: quiet });
    const environmentId = (await createTestTenant(db)).environment.id;
    const other = (await createTestTenant(db)).environment.id;
    try {
      for (let used = 0; used < 10; used += 1) {
        await enforceAccountExportRate(limiter, quiet, environmentId);
      }
      expect(await codeOf(enforceAccountExportRate(limiter, quiet, environmentId))).toMatch(
        /^429:/,
      );
      await expect(enforceAccountExportRate(limiter, quiet, other)).resolves.toBeUndefined();

      await target.stop();
      valkey = undefined;
      expect(await codeOf(enforceAccountExportRate(limiter, quiet, other))).toBe(
        '503:account_export_unavailable',
      );
    } finally {
      await closeRateLimitRedis(redis).catch(() => undefined);
    }
  });
});
