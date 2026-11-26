/**
 * C13 `AccountsService.resolveForInquiry` and the lazily seeded `user` account type, against
 * PGlite with the real event publisher, so the `account.created` event is written in the
 * caller's transaction. Every value is synthetic.
 */
import {
  accountTypes,
  consolidateAccounts,
  createAccount,
  createAccountType,
  createWebhook,
  getAccount,
  getDefaultAccountType,
  listEvents,
  listWebhookDeliveries,
  type Db,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '@openverify/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors.js';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import type { ServiceContext } from '../ports.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../webhooks/queue.js';
import {
  createAccountsService,
  DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA,
  ensureDefaultAccountType,
} from './accounts.js';

let database: TestDatabase;
let db: Db;
let events: TransactionalEventPublisher;
let ctx: ServiceContext;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler({
      add: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  });
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { organization, environment } = await createTestTenant(db);
  ctx = { organizationId: organization.id, environmentId: environment.id };
});

const service = () => createAccountsService({ events });

async function accountEvents(environmentId: string) {
  return (await listEvents(db, environmentId, { name: 'account.created' })).items;
}

describe('ensureDefaultAccountType (C13: every environment has the type user)', () => {
  it('gives the seeded type user its default fields schema on first use', async () => {
    const seeded = await getDefaultAccountType(db, ctx.environmentId);
    expect(seeded?.fieldsSchema).toEqual({});

    const type = await ensureDefaultAccountType(db, ctx.environmentId);

    expect(type.id).toBe(seeded?.id);
    expect(type.name).toBe('user');
    expect(type.fieldsSchema).toEqual(DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA);
    expect((await getDefaultAccountType(db, ctx.environmentId))?.fieldsSchema).toEqual(
      DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA,
    );
  });

  it('creates the type user when the environment has none', async () => {
    await db
      .delete(accountTypes)
      .where(
        and(eq(accountTypes.environmentId, ctx.environmentId), eq(accountTypes.name, 'user')),
      );

    const type = await ensureDefaultAccountType(db, ctx.environmentId);

    expect(type.name).toBe('user');
    expect(type.fieldsSchema).toEqual(DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA);
    expect((await getDefaultAccountType(db, ctx.environmentId))?.id).toBe(type.id);
  });

  it('is idempotent', async () => {
    const first = await ensureDefaultAccountType(db, ctx.environmentId);
    const second = await ensureDefaultAccountType(db, ctx.environmentId);

    expect(second).toEqual(first);
  });

  it('includes the fields of the C20 account fixture', () => {
    expect(DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA).toMatchObject({
      name_first: { type: 'string' },
      name_last: { type: 'string' },
      birthdate: { type: 'date' },
    });
  });
});

describe('createAccountsService().resolveForInquiry (C13)', () => {
  it('returns the given account when it is in the environment, and emits nothing', async () => {
    const account = await createAccount(db, ctx.environmentId, { id: testId('acc') });

    const resolved = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { accountId: account.id }),
    );

    expect(resolved).toBe(account.id);
    expect(await accountEvents(ctx.environmentId)).toEqual([]);
  });

  it('refuses an account of another environment with a 404', async () => {
    const other = await createTestTenant(db);
    const foreign = await createAccount(db, other.environment.id, { id: testId('acc') });

    const call = db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { accountId: foreign.id }),
    );

    await expect(call).rejects.toBeInstanceOf(NotFoundError);
    await expect(call).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an unknown account with a 404', async () => {
    await expect(
      db.transaction((tx) => service().resolveForInquiry(tx, ctx, { accountId: testId('acc') })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('prefers the account id over the reference id', async () => {
    const account = await createAccount(db, ctx.environmentId, { id: testId('acc') });
    await createAccount(db, ctx.environmentId, { id: testId('acc'), referenceId: 'ref-other' });

    const resolved = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { accountId: account.id, referenceId: 'ref-other' }),
    );

    expect(resolved).toBe(account.id);
  });

  it('resolves a consolidated account to the account that absorbed it', async () => {
    const target = await createAccount(db, ctx.environmentId, { id: testId('acc') });
    const source = await createAccount(db, ctx.environmentId, {
      id: testId('acc'),
      referenceId: 'ref-merged',
    });
    await consolidateAccounts(db, ctx.environmentId, {
      targetId: target.id,
      sourceIds: [source.id],
    });

    const byId = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { accountId: source.id }),
    );
    const byReference = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { referenceId: 'ref-merged' }),
    );

    expect(byId).toBe(target.id);
    expect(byReference).toBe(target.id);
  });

  it('finds the account with the reference id, and emits nothing', async () => {
    const account = await createAccount(db, ctx.environmentId, {
      id: testId('acc'),
      referenceId: 'ref-existing',
    });

    const resolved = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { referenceId: 'ref-existing' }),
    );

    expect(resolved).toBe(account.id);
    expect(await accountEvents(ctx.environmentId)).toEqual([]);
  });

  it('creates the account with the reference id in the type user and stages account.created', async () => {
    const resolved = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { referenceId: 'ref-new' }),
    );

    const account = await getAccount(db, ctx.environmentId, resolved);
    const user = await getDefaultAccountType(db, ctx.environmentId);
    expect(account).toMatchObject({
      referenceId: 'ref-new',
      status: 'active',
      accountTypeId: user?.id,
      fields: {},
      tags: [],
    });
    const [event] = await accountEvents(ctx.environmentId);
    expect(event?.payload).toMatchObject({
      data: {
        type: 'account',
        id: resolved,
        attributes: { 'reference-id': 'ref-new', status: 'active' },
      },
    });
    expect(event?.objectId).toBe(resolved);
  });

  it('finds the same account for the same reference id the next time', async () => {
    const first = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { referenceId: 'ref-again' }),
    );
    const second = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { referenceId: 'ref-again' }),
    );

    expect(second).toBe(first);
    expect(await accountEvents(ctx.environmentId)).toHaveLength(1);
  });

  it('keeps reference ids per environment', async () => {
    const other = await createTestTenant(db);
    const foreign = await createAccount(db, other.environment.id, {
      id: testId('acc'),
      referenceId: 'ref-shared',
    });

    const resolved = await db.transaction((tx) =>
      service().resolveForInquiry(tx, ctx, { referenceId: 'ref-shared' }),
    );

    expect(resolved).not.toBe(foreign.id);
    expect((await getAccount(db, ctx.environmentId, resolved))?.referenceId).toBe('ref-shared');
  });

  it('creates a new account without a reference id each time', async () => {
    const first = await db.transaction((tx) => service().resolveForInquiry(tx, ctx, {}));
    const second = await db.transaction((tx) => service().resolveForInquiry(tx, ctx, {}));

    expect(first).not.toBe(second);
    expect((await getAccount(db, ctx.environmentId, first))?.referenceId).toBeNull();
    expect(
      (await accountEvents(ctx.environmentId)).map((event) => event.objectId).sort(),
    ).toEqual([first, second].sort());
  });

  it('uses the injected id generator for new accounts', async () => {
    const id = testId('acc');
    const resolved = await db.transaction((tx) =>
      createAccountsService({ events, ids: { newId: () => id as never } }).resolveForInquiry(
        tx,
        ctx,
        {},
      ),
    );

    expect(resolved).toBe(id);
  });

  it('writes nothing when the caller rolls its transaction back', async () => {
    let created: string | undefined;
    await expect(
      db.transaction(async (tx) => {
        created = await service().resolveForInquiry(tx, ctx, { referenceId: 'ref-rolled' });
        throw new Error('the inquiry insert failed');
      }),
    ).rejects.toThrow('the inquiry insert failed');

    expect(created).toBeDefined();
    expect(await getAccount(db, ctx.environmentId, created ?? '')).toBeNull();
    expect(await accountEvents(ctx.environmentId)).toEqual([]);
  });

  it('seeds the type user when it is missing before creating the account', async () => {
    await db
      .delete(accountTypes)
      .where(
        and(eq(accountTypes.environmentId, ctx.environmentId), eq(accountTypes.name, 'user')),
      );

    const resolved = await db.transaction((tx) => service().resolveForInquiry(tx, ctx, {}));

    const user = await getDefaultAccountType(db, ctx.environmentId);
    expect((await getAccount(db, ctx.environmentId, resolved))?.accountTypeId).toBe(user?.id);
  });

  it('creates accounts of the type user even when other types exist', async () => {
    await createAccountType(db, ctx.environmentId, { id: testId('acctp'), name: 'business' });

    const resolved = await db.transaction((tx) => service().resolveForInquiry(tx, ctx, {}));

    const user = await getDefaultAccountType(db, ctx.environmentId);
    expect((await getAccount(db, ctx.environmentId, resolved))?.accountTypeId).toBe(user?.id);
  });
});

describe('the staged account.created event', () => {
  it('leaves its deliveries pending for the sweep instead of enqueueing them before the commit', async () => {
    await createWebhook(db, ctx.environmentId, {
      id: testId('wbh'),
      url: 'https://hooks.example.test/openverify',
      enabledEvents: ['account.created'],
      secret: `wbhsec_${'s'.repeat(43)}`,
    });
    const jobs: WebhookDeliveryJob[] = [];
    const publisher = createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler({
        add: (_name, job) => {
          jobs.push(job);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      }),
    });

    await db.transaction((tx) =>
      createAccountsService({ events: publisher }).resolveForInquiry(tx, ctx, {}),
    );

    expect(jobs).toEqual([]);
    const deliveries = await listWebhookDeliveries(db, ctx.environmentId);
    expect(deliveries.items.map((delivery) => delivery.status)).toEqual(['pending']);
  });
});
