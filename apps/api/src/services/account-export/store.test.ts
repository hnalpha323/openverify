/**
 * C253 (Workflow 11B, `dsar-export`): the service, the job's cut and the C253.4 deletion over the
 * real `account_exports` rows (PGlite) through `accountExportStores`, with in-memory storage: a
 * create writes one pending row (409 for a second), the cut seals the manifest and lists its ids,
 * the manifest and a live file are served, a redaction's deletion removes the export with its object
 * key, and the C16 drain expires an export past its life. Synthetic values only.
 */
import { newId } from '@openverify/contracts';
import { getAccountExportRecord, type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../../jobs/testing.js';
import type { AppError } from '../../errors.js';
import type { Principal, ServiceContext } from '../../ports.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../../storage/index.js';
import {
  createRecordingAuditLogger,
  fixedClock,
  type TestClock,
} from '../../test-support/fakes.js';
import { seedPiiSubject, type SeededPiiSubject } from '../redaction.test-support.js';
import { cutAccountExport } from './cut.js';
import {
  deleteExportObjects,
  deleteExportsListingInTx,
  runAccountExportRetention,
} from './deletion.js';
import { readLiveFile } from './files.js';
import {
  createAccountExport,
  getAccountExport,
  getAccountExportFile,
  getAccountExportManifest,
  type AccountExportDeps,
} from './service.js';
import { accountExportStores } from './store.js';

let database: TestDatabase;
let db: Db;
let ctx: ServiceContext;
let storage: InMemoryFileStorage;
let clock: TestClock;
let subject: SeededPiiSubject;
let admitted: string[];

const T0 = new Date('2026-11-13T12:00:00.000Z');
const DAY = 86_400_000;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { organization, environment } = await createTestTenant(db);
  ctx = { organizationId: organization.id, environmentId: environment.id, requestId: 'req-aes' };
  storage = createInMemoryFileStorage();
  clock = fixedClock(T0);
  admitted = [];
  subject = await seedPiiSubject({
    db,
    storage,
    keyring: database.keyring,
    environmentId: ctx.environmentId,
  });
});

const principal = (): Principal => ({
  kind: 'api-key',
  apiKeyId: 'key_01M5CN0000000000000011B300',
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
  keyring: database.keyring,
  ids: { newId: () => newId('aexp') },
  store: accountExportStores,
  liveFile: readLiveFile,
  admit: (environmentId) => {
    admitted.push(environmentId);
    return Promise.resolve();
  },
});

const acting = () => ({ ctx, principal: principal() });

const cut = (id: string) =>
  cutAccountExport(
    {
      db,
      clock,
      logger: createCapturingLogger(),
      storage,
      keyring: database.keyring,
      store: accountExportStores,
    },
    ctx.environmentId,
    id,
  );

const codeOf = (work: Promise<unknown>) =>
  work.then(
    () => 'ok',
    (error: unknown) => `${String((error as AppError).status)}:${String((error as AppError).code)}`,
  );

describe('the access export over its rows (C253.1, C253.2)', () => {
  it('creates one pending row, cuts it ready with its listed ids, and serves its manifest and files', async () => {
    const { data } = await createAccountExport(deps(), acting(), subject.accountId);
    expect(admitted).toEqual([ctx.environmentId]);
    expect(await getAccountExportRecord(db, ctx.environmentId, data.id)).toMatchObject({
      status: 'pending',
      accountId: subject.accountId,
      creatorType: 'api-key',
    });
    expect(await codeOf(createAccountExport(deps(), acting(), subject.accountId))).toBe(
      '409:account_export_pending',
    );

    await expect(cut(data.id)).resolves.toMatchObject({ outcome: 'ready' });
    const row = await getAccountExportRecord(db, ctx.environmentId, data.id);
    expect(row?.itemIds).toEqual(
      expect.arrayContaining([subject.accountId, subject.inquiryId, subject.verificationId]),
    );
    expect((await getAccountExport(deps(), acting(), data.id)).data.attributes).toMatchObject({
      status: 'ready',
      'ready-at': T0.toISOString(),
      'expires-at': new Date(T0.getTime() + 7 * DAY).toISOString(),
    });

    const manifest = await getAccountExportManifest(deps(), acting(), data.id);
    expect(manifest['account-id']).toBe(subject.accountId);
    const file = manifest.files[0];
    expect(file).toBeDefined();
    const served = await getAccountExportFile(deps(), acting(), data.id, file?.id ?? '');
    expect(served.bytes.byteLength).toBe(file?.size);
  });

  it('deletes the export listing a redacted item in the deletion’s transaction, then its object', async () => {
    const { data } = await createAccountExport(deps(), acting(), subject.accountId);
    await cut(data.id);
    const key = (await getAccountExportRecord(db, ctx.environmentId, data.id))?.storageKey;
    expect(key).toEqual(expect.any(String));
    expect(await storage.get(key ?? '')).not.toBeNull();

    const deleted = await db.transaction((tx) =>
      deleteExportsListingInTx(tx, accountExportStores, ctx.environmentId, [subject.inquiryId]),
    );
    expect(deleted).toEqual([{ id: data.id, environmentId: ctx.environmentId, storageKey: key }]);
    await expect(deleteExportObjects(storage, deleted)).resolves.toEqual([]);
    expect(await storage.get(key ?? '')).toBeNull();
    expect(await codeOf(getAccountExport(deps(), acting(), data.id))).toBe('404:undefined');
  });

  it('expires an export past its life in the C16 drain, deleting its manifest', async () => {
    // The drain is install-wide: this export is cut a day later than the others the file made, so
    // a drain at their expiry leaves it, and the next one expires it alone.
    clock.set(new Date(T0.getTime() + DAY));
    const { data } = await createAccountExport(deps(), acting(), subject.accountId);
    await cut(data.id);
    const key = (await getAccountExportRecord(db, ctx.environmentId, data.id))?.storageKey ?? '';

    await runAccountExportRetention(
      { db, storage },
      accountExportStores,
      new Date(T0.getTime() + 7 * DAY),
    );
    expect((await getAccountExport(deps(), acting(), data.id)).data.attributes.status).toBe(
      'ready',
    );
    await expect(
      runAccountExportRetention(
        { db, storage },
        accountExportStores,
        new Date(T0.getTime() + 8 * DAY),
      ),
    ).resolves.toEqual({ expired: 1, objectsKept: 0 });
    expect(await storage.get(key)).toBeNull();
    expect((await getAccountExport(deps(), acting(), data.id)).data.attributes).toMatchObject({
      status: 'expired',
      'byte-count': null,
    });
  });
});
