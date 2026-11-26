/**
 * C253.1, C253.5 (Workflow 11B, `dsar-export`): the access export's service over PGlite, a fake
 * store and in-memory storage: who may export (pii:view and the 10-minute step-up for a user; a
 * masked key refused), one pending export per account, the item limit with its counts, the resource
 * as its goldens state it, the manifest and files of a ready export only, each audited with ids, a
 * redacted file 410 and an unlisted one the generic 404. Synthetic values only.
 */
import { readFileSync } from 'node:fs';
import {
  accountExportDocumentSchema,
  accountExportManifestSchema,
  type AccountExportManifest,
} from '@openverify/contracts';
import {
  createUser,
  createUserSession,
  encryptBytes,
  getAccount,
  hashSessionToken,
  type Db,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { newId, newSessionToken } from '@openverify/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppError } from '../../errors.js';
import type { Principal, ServiceContext } from '../../ports.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../../storage/index.js';
import {
  createRecordingAuditLogger,
  fixedClock,
  type RecordingAuditLogger,
  type TestClock,
} from '../../test-support/fakes.js';
import { PII_MARKER, seedPiiSubject } from '../redaction.test-support.js';
import { collectAccountExport } from './collect.js';
import { buildAccountExportManifest, type CollectedAccountExport } from './manifest.js';
import {
  accountExportResource,
  assertMayExport,
  createAccountExport,
  getAccountExport,
  getAccountExportFile,
  getAccountExportManifest,
  manifestStorageKey,
  type AccountExportDeps,
  type AccountExportRow,
  type AccountExportStore,
  type LiveFile,
} from './service.js';

let database: TestDatabase;
let db: Db;
let ctx: ServiceContext;
let storage: InMemoryFileStorage;
let audit: RecordingAuditLogger;
let clock: TestClock;
let rows: Map<string, AccountExportRow>;
let admitted: string[];
let live: Map<string, LiveFile>;

const T0 = new Date('2026-11-13T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { organization, environment } = await createTestTenant(db);
  ctx = { organizationId: organization.id, environmentId: environment.id, requestId: 'req-ae' };
  storage = createInMemoryFileStorage();
  audit = createRecordingAuditLogger();
  clock = fixedClock(T0);
  rows = new Map();
  admitted = [];
  live = new Map();
});

/** The store over a map, its account lock a read of the account (the fake ignores locks). */
const store: AccountExportStore = {
  lockAccount: async (tx, environmentId, accountId) =>
    (await getAccount(tx, environmentId, accountId)) !== null,
  hasPendingExport: (_tx, environmentId, accountId) =>
    Promise.resolve(
      [...rows.values()].some(
        (row) =>
          row.environmentId === environmentId &&
          row.accountId === accountId &&
          row.status === 'pending',
      ),
    ),
  createPendingExport(_tx, environmentId, input) {
    const row: AccountExportRow = {
      id: input.id,
      environmentId,
      accountId: input.accountId,
      status: 'pending',
      createdAt: input.at,
      readyAt: null,
      expiresAt: null,
      itemCount: null,
      byteCount: null,
      errorCode: null,
      storageKey: null,
      wrappedDek: null,
    };
    rows.set(row.id, row);
    return Promise.resolve(row);
  },
  getExport: (_db, environmentId, id) => {
    const row = rows.get(id);
    return Promise.resolve(row?.environmentId === environmentId ? row : null);
  },
};

function deps(overrides: Partial<AccountExportDeps> = {}): AccountExportDeps {
  return {
    db,
    clock,
    audit,
    storage,
    keyring: database.keyring,
    ids: { newId: () => newId('aexp') },
    store,
    liveFile: (_db, _environmentId, file) =>
      Promise.resolve(live.get(file.id) ?? { state: 'missing' }),
    admit: (...args: string[]) => {
      admitted.push(args.join('/'));
      return Promise.resolve();
    },
    ...overrides,
  };
}

const keyPrincipal = (overrides: Partial<Extract<Principal, { kind: 'api-key' }>> = {}) =>
  ({
    kind: 'api-key',
    apiKeyId: 'key_01M5CN0000000000000011B200',
    organizationId: ctx.organizationId,
    environmentId: ctx.environmentId,
    environmentKind: 'sandbox',
    permissions: new Set(['account-access:export', 'pii:view']),
    ...overrides,
  }) as Principal;

/** A user with a session whose second factor was verified `ago` ms before T0 (`null`: never). */
async function userPrincipal(ago: number | null, pii = true): Promise<Principal> {
  const userId = newId('usr');
  await createUser(db, {
    id: userId,
    organizationId: ctx.organizationId,
    email: `operator-${userId.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
  });
  const sessionId = newId('uss');
  await createUserSession(db, {
    id: sessionId,
    organizationId: ctx.organizationId,
    userId,
    environmentId: ctx.environmentId,
    tokenHash: hashSessionToken(newSessionToken()),
    expiresAt: new Date(T0.getTime() + 3_600_000),
    mfaSatisfied: true,
    mfaVerifiedAt: ago === null ? null : new Date(T0.getTime() - ago),
  });
  return {
    kind: 'user',
    userId,
    userSessionId: sessionId,
    organizationId: ctx.organizationId,
    environmentId: ctx.environmentId,
    environmentKind: 'sandbox',
    permissions: new Set(pii ? ['account-access:export', 'pii:view'] : ['account-access:export']),
    mfaSatisfied: true,
  };
}

const codeOf = async (work: Promise<unknown>) =>
  work.then(
    () => 'ok',
    (error: unknown) =>
      `${String((error as AppError).status)}:${(error as AppError).code ?? (error as Error).name}`,
  );

const seed = () =>
  seedPiiSubject({ db, storage, keyring: database.keyring, environmentId: ctx.environmentId });

const golden = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../../../contracts/fixtures/api/account-exports/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );

/** A `ready` export of the account, its sealed manifest in storage. */
async function readyExport(
  accountId: string,
  readyAt = T0,
): Promise<{ row: AccountExportRow; manifest: AccountExportManifest }> {
  const id = newId('aexp');
  const manifest = buildAccountExportManifest(
    await collectAccountExport({ db, clock }, ctx.environmentId, accountId),
    { exportId: id, environmentId: ctx.environmentId, accountId, generatedAt: readyAt },
  );
  const sealed = encryptBytes(Buffer.from(JSON.stringify(manifest)), database.keyring, {
    context: id,
  });
  const storageKey = manifestStorageKey(ctx.environmentId, id);
  await storage.put(storageKey, sealed.ciphertext);
  const row: AccountExportRow = {
    id,
    environmentId: ctx.environmentId,
    accountId,
    status: 'ready',
    createdAt: readyAt,
    readyAt,
    expiresAt: new Date(readyAt.getTime() + 7 * 86_400_000),
    itemCount: manifest['item-count'],
    byteCount: 1000,
    errorCode: null,
    storageKey,
    wrappedDek: sealed.wrappedDek,
  };
  rows.set(id, row);
  return { row, manifest };
}

describe('assertMayExport (C253.1, review P16)', () => {
  it('lets a key that sees PII export', async () => {
    await expect(assertMayExport(db, keyPrincipal(), T0)).resolves.toBeUndefined();
  });

  it('refuses a key minted without pii:view, whose PII is masked', async () => {
    expect(await codeOf(assertMayExport(db, keyPrincipal({ piiMasked: true }), T0))).toBe(
      '403:PermissionDeniedError',
    );
  });

  it('refuses a user without pii:view', async () => {
    expect(await codeOf(assertMayExport(db, await userPrincipal(0, false), T0))).toBe(
      '403:PermissionDeniedError',
    );
  });

  it.each([
    ['never verified', null, '403:step_up_required'],
    ['verified eleven minutes ago', 11 * 60_000, '403:step_up_required'],
    ['verified ten minutes ago', 10 * 60_000, 'ok'],
    ['verified a minute ago', 60_000, 'ok'],
  ])('a user whose second factor was %s: %s', async (_, ago, expected) => {
    expect(await codeOf(assertMayExport(db, await userPrincipal(ago), T0))).toBe(expected);
  });
});

describe('accountExportResource (C253.1)', () => {
  const base: AccountExportRow = {
    id: 'aexp_01M5CN0000000000000011B100',
    environmentId: 'env_01M5CJXHGAKAJV1EY6T7EEFWQX',
    accountId: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8',
    status: 'pending',
    createdAt: new Date('2026-11-13T12:00:00.000Z'),
    readyAt: null,
    expiresAt: null,
    itemCount: null,
    byteCount: null,
    errorCode: null,
    storageKey: null,
    wrappedDek: null,
  };
  const ready: AccountExportRow = {
    ...base,
    status: 'ready',
    readyAt: new Date('2026-11-13T12:00:20.000Z'),
    expiresAt: new Date('2026-11-20T12:00:20.000Z'),
    itemCount: 14,
    byteCount: 2_457_600,
    storageKey: 'env_01M5CJXHGAKAJV1EY6T7EEFWQX/account-exports/aexp_01M5CN0000000000000011B100',
    wrappedDek: 'ov1.synthetic',
  };

  const failed: AccountExportRow = {
    ...base,
    status: 'failed',
    errorCode: 'account_export_too_large',
  };
  const expired: AccountExportRow = { ...ready, status: 'expired' };

  it.each([
    ['account-export-pending', base, T0],
    ['account-export-ready', ready, T0],
    ['account-export-failed', failed, T0],
    ['account-export-expired', expired, T0],
    // A ready export past its expiry reads expired before the retention pass marks it.
    ['account-export-expired', ready, new Date('2026-11-20T12:00:20.000Z')],
  ])('%s is its golden', (name, row, now) => {
    const document = { data: accountExportResource(row, now) };
    expect(accountExportDocumentSchema.parse(document)).toEqual(golden(name));
  });
});

describe('createAccountExport (C253.1, C253.5)', () => {
  it('answers a pending export, audits ids only and admits it after the commit', async () => {
    const subject = await seed();
    const { data } = await createAccountExport(
      deps(),
      { ctx, principal: keyPrincipal() },
      subject.accountId,
    );
    expect(data).toMatchObject({
      type: 'account-export',
      attributes: { status: 'pending', 'item-count': null },
      relationships: { account: { data: { type: 'account', id: subject.accountId } } },
    });
    expect(admitted).toEqual([`${ctx.environmentId}/${data.id}`]);
    const [entry] = audit.withAction('account-export.created');
    expect(entry).toMatchObject({
      resourceType: 'account-export',
      resourceId: data.id,
      actor: { type: 'api-key', id: 'key_01M5CN0000000000000011B200' },
      metadata: { 'account-id': subject.accountId },
    });
    expect(JSON.stringify(audit.entries)).not.toContain(PII_MARKER);
  });

  it('refuses a second export while one is pending (409 account_export_pending)', async () => {
    const subject = await seed();
    await createAccountExport(deps(), { ctx, principal: keyPrincipal() }, subject.accountId);
    expect(
      await codeOf(
        createAccountExport(deps(), { ctx, principal: keyPrincipal() }, subject.accountId),
      ),
    ).toBe('409:account_export_pending');
    expect(rows.size).toBe(1);
  });

  it('answers the generic 404 for an account of another environment', async () => {
    const subject = await seed();
    const other = await createTestTenant(db);
    const elsewhere = { ...ctx, environmentId: other.environment.id };
    expect(
      await codeOf(
        createAccountExport(
          deps(),
          { ctx: elsewhere, principal: keyPrincipal({ environmentId: other.environment.id }) },
          subject.accountId,
        ),
      ),
    ).toBe('404:NotFoundError');
  });

  it('refuses an account past the item limit with its counts, writing nothing (C253.5)', async () => {
    const subject = await seed();
    const collected = await collectAccountExport(
      { db, clock },
      ctx.environmentId,
      subject.accountId,
    );
    const many: CollectedAccountExport = {
      ...collected,
      inquiries: Array.from({ length: 5000 }, (_, index) => ({
        type: 'inquiry',
        id: `inq_${String(index)}`,
        attributes: {},
      })),
    };
    const refusal = createAccountExport(
      deps({ collect: () => Promise.resolve(many) }),
      { ctx, principal: keyPrincipal() },
      subject.accountId,
    );
    await expect(refusal).rejects.toMatchObject({
      status: 422,
      code: 'account_export_too_large',
      members: { 'item-limit': 5000 },
    });
    expect(rows.size).toBe(0);
    expect(admitted).toEqual([]);
  });

  it('keeps the export pending when admission fails (the sweep admits it)', async () => {
    const subject = await seed();
    const { data } = await createAccountExport(
      deps({ admit: () => Promise.reject(new Error('queue down')) }),
      { ctx, principal: keyPrincipal() },
      subject.accountId,
    );
    expect(data.attributes.status).toBe('pending');
  });

  it('refuses a user without the step-up before reading anything', async () => {
    const subject = await seed();
    expect(
      await codeOf(
        createAccountExport(
          deps(),
          { ctx, principal: await userPrincipal(null) },
          subject.accountId,
        ),
      ),
    ).toBe('403:step_up_required');
    expect(rows.size).toBe(0);
  });
});

describe('getAccountExport', () => {
  it('reads the caller’s environment’s export, and 404s another’s', async () => {
    const subject = await seed();
    const { row } = await readyExport(subject.accountId);
    const { data } = await getAccountExport(deps(), { ctx, principal: keyPrincipal() }, row.id);
    expect(data.attributes.status).toBe('ready');
    const other = await createTestTenant(db);
    expect(
      await codeOf(
        getAccountExport(
          deps(),
          { ctx: { ...ctx, environmentId: other.environment.id }, principal: keyPrincipal() },
          row.id,
        ),
      ),
    ).toBe('404:NotFoundError');
  });
});

describe('getAccountExportManifest (C253.2)', () => {
  it('serves the ready export’s manifest, audited with ids and counts only', async () => {
    const subject = await seed();
    const { row, manifest } = await readyExport(subject.accountId);
    const served = await getAccountExportManifest(
      deps(),
      { ctx, principal: keyPrincipal() },
      row.id,
    );
    expect(accountExportManifestSchema.parse(served)).toEqual(manifest);
    expect(JSON.stringify(served)).toContain(PII_MARKER);
    const [entry] = audit.withAction('account-export.manifest-downloaded');
    expect(entry?.metadata).toEqual({
      'account-id': subject.accountId,
      'item-count': manifest['item-count'],
    });
    expect(JSON.stringify(audit.entries)).not.toContain(PII_MARKER);
  });

  it('serves nothing for a pending or an expired export (the generic 404)', async () => {
    const subject = await seed();
    await createAccountExport(deps(), { ctx, principal: keyPrincipal() }, subject.accountId);
    const [pending] = [...rows.keys()];
    expect(
      await codeOf(
        getAccountExportManifest(deps(), { ctx, principal: keyPrincipal() }, pending ?? ''),
      ),
    ).toBe('404:NotFoundError');
    const { row } = await readyExport(subject.accountId);
    clock.set(new Date(T0.getTime() + 7 * 86_400_000));
    expect(
      await codeOf(getAccountExportManifest(deps(), { ctx, principal: keyPrincipal() }, row.id)),
    ).toBe('404:NotFoundError');
    expect(audit.withAction('account-export.manifest-downloaded')).toEqual([]);
  });
});

describe('getAccountExportFile (C253.2)', () => {
  it('serves a listed file from its live object, audited with its id', async () => {
    const subject = await seed();
    const { row, manifest } = await readyExport(subject.accountId);
    const [listed] = manifest.files;
    const fileId = listed?.id ?? '';
    const bytes = Buffer.from('synthetic file bytes');
    const sealed = encryptBytes(bytes, database.keyring, { context: fileId });
    await storage.put(`${ctx.environmentId}/live-object`, sealed.ciphertext);
    live.set(fileId, {
      state: 'live',
      storageKey: `${ctx.environmentId}/live-object`,
      wrappedDek: sealed.wrappedDek,
      mediaType: 'image/jpeg',
    });

    const served = await getAccountExportFile(
      deps(),
      { ctx, principal: keyPrincipal() },
      row.id,
      fileId,
    );

    expect(served.mediaType).toBe('image/jpeg');
    expect(Buffer.from(served.bytes).toString()).toBe('synthetic file bytes');
    expect(audit.withAction('account-export.file-downloaded')[0]?.metadata).toEqual({
      'account-id': subject.accountId,
      'file-id': fileId,
    });
  });

  it('answers 410 account_export_item_redacted for a listed file since redacted', async () => {
    const subject = await seed();
    const { row, manifest } = await readyExport(subject.accountId);
    const fileId = manifest.files[0]?.id ?? '';
    live.set(fileId, { state: 'redacted' });
    expect(
      await codeOf(
        getAccountExportFile(deps(), { ctx, principal: keyPrincipal() }, row.id, fileId),
      ),
    ).toBe('410:account_export_item_redacted');
  });

  it('answers the generic 404 for a file the manifest does not list', async () => {
    const subject = await seed();
    const { row } = await readyExport(subject.accountId);
    expect(
      await codeOf(
        getAccountExportFile(
          deps(),
          { ctx, principal: keyPrincipal() },
          row.id,
          'file_01M5CN0000000000000011B999',
        ),
      ),
    ).toBe('404:NotFoundError');
  });
});
