import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { InvalidCursorError, pgErrorCode } from '../errors.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  createdAtClock,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  AccountConsolidationError,
  addAccountRelation,
  addAccountTag,
  consolidateAccounts,
  createAccount,
  createAccountType,
  findAccountByReferenceId,
  findAccountTypeByName,
  getAccount,
  getAccountType,
  getDefaultAccountType,
  listAccountInquiryIds,
  listAccountRelations,
  listAccountTypes,
  listAccounts,
  lockAccount,
  lockAccountType,
  moveInquiriesToAccount,
  removeAccountRelation,
  removeAccountTag,
  resolveInquiryAccount,
  setAccountTags,
  TagLimitError,
  updateAccount,
  updateAccountType,
} from './index.js';
import { getInquiry } from './inquiries.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const tenant = async () => (await createTestTenant(database.db)).environment.id;

describe('account types', () => {
  it('finds the seeded "user" type and creates others with a fields schema', async () => {
    onTestFinished(wallClockStepsBack());
    const env = await tenant();
    const clock = createdAtClock(database.db);
    const user = await getDefaultAccountType(database.db, env);
    await clock.at('account_types', user?.id ?? '');
    const business = await clock.stamp(
      'account_types',
      await createAccountType(database.db, env, {
        id: testId('acctp'),
        name: 'business',
        fieldsSchema: { legal_name: { type: 'string', label: 'Legal name' } },
      }),
    );

    expect(user).toMatchObject({ environmentId: env, name: 'user', fieldsSchema: {} });
    expect(await getAccountType(database.db, env, business.id)).toEqual(business);
    expect(await findAccountTypeByName(database.db, env, 'business')).toEqual(business);
    expect((await listAccountTypes(database.db, env)).items.map((type) => type.name)).toEqual([
      'business',
      'user',
    ]);
  });

  it('keeps types inside their environment', async () => {
    const env = await tenant();
    const other = await tenant();
    const type = await createAccountType(database.db, env, { id: testId('acctp'), name: 'x' });

    expect(await getAccountType(database.db, other, type.id)).toBeNull();
    expect(await findAccountTypeByName(database.db, other, 'x')).toBeNull();
    expect(await getDefaultAccountType(database.db, testId('env'))).toBeNull();
  });
});

describe('account type changes (C25.3, Workflow 2E)', () => {
  it('locks a type of the environment only', async () => {
    const env = await tenant();
    const other = await tenant();
    const type = await createAccountType(database.db, env, { id: testId('acctp'), name: 'locked' });

    const locked = await database.db.transaction((tx) => lockAccountType(tx, env, type.id));

    expect(locked).toEqual(type);
    expect(await lockAccountType(database.db, other, type.id)).toBeNull();
  });

  it('writes the name and the fields schema, and nothing in another environment', async () => {
    const env = await tenant();
    const other = await tenant();
    const type = await createAccountType(database.db, env, {
      id: testId('acctp'),
      name: 'before',
      fieldsSchema: { legal_name: { type: 'string', label: 'Legal name' } },
    });
    const fieldsSchema = {
      legal_name: { type: 'string', label: 'Registered name' },
      founded_on: { type: 'date', label: 'Founded on' },
    } as const;

    const renamed = await updateAccountType(database.db, env, type.id, { name: 'after' });
    const reshaped = await updateAccountType(database.db, env, type.id, { fieldsSchema });

    expect(renamed).toMatchObject({ id: type.id, name: 'after', fieldsSchema: type.fieldsSchema });
    expect(reshaped).toMatchObject({ id: type.id, name: 'after', fieldsSchema });
    expect(await getAccountType(database.db, env, type.id)).toEqual(reshaped);
    expect(await updateAccountType(database.db, other, type.id, { name: 'stolen' })).toBeNull();
    expect(await getAccountType(database.db, env, type.id)).toMatchObject({ name: 'after' });
  });

  it('keeps names unique per environment', async () => {
    const env = await tenant();
    const type = await createAccountType(database.db, env, { id: testId('acctp'), name: 'first' });
    await createAccountType(database.db, env, { id: testId('acctp'), name: 'taken' });

    const failure: unknown = await updateAccountType(database.db, env, type.id, {
      name: 'taken',
    }).catch((error: unknown) => error);

    expect(pgErrorCode(failure)).toBe('23505');
  });
});

describe('accounts', () => {
  it('creates an account in the default type with sealed fields', async () => {
    const env = await tenant();

    const account = await createAccount(database.db, env, {
      id: testId('acc'),
      referenceId: 'customer-1',
      fields: { name_first: 'Jane' },
      tags: ['VIP'],
    });
    const raw = await database.db.execute<{ fields: string }>(
      sql`select fields from accounts where id = ${account.id}`,
    );

    expect(account).toMatchObject({
      environmentId: env,
      referenceId: 'customer-1',
      status: 'active',
      fields: { name_first: 'Jane' },
      tags: ['VIP'],
      consolidatedInto: null,
      redactedAt: null,
    });
    expect(account.accountTypeId).toBe((await getDefaultAccountType(database.db, env))?.id);
    expect(raw.rows[0]?.fields).toMatch(/^ov1\./);
    expect(raw.rows[0]?.fields).not.toContain('Jane');
    expect(await getAccount(database.db, env, account.id)).toEqual(account);
    expect(await findAccountByReferenceId(database.db, env, 'customer-1')).toEqual(account);
    expect(await lockAccount(database.db, env, account.id)).toEqual(account);
  });

  it('reads an account without fields as {}', async () => {
    const env = await tenant();
    const account = await createAccount(database.db, env, { id: testId('acc') });

    expect(account.fields).toEqual({});
  });

  it('keeps accounts inside their environment', async () => {
    const env = await tenant();
    const other = await tenant();
    const account = await createAccount(database.db, env, { id: testId('acc'), referenceId: 'r' });

    expect(await getAccount(database.db, other, account.id)).toBeNull();
    expect(await lockAccount(database.db, other, account.id)).toBeNull();
    expect(await findAccountByReferenceId(database.db, other, 'r')).toBeNull();
    expect(await updateAccount(database.db, other, account.id, { status: 'archived' })).toBeNull();
  });

  it('lists with the C13 filters and the C1 cursor', async () => {
    onTestFinished(wallClockStepsBack());
    const env = await tenant();
    const clock = createdAtClock(database.db);
    const type = await createAccountType(database.db, env, { id: testId('acctp'), name: 'biz' });
    const a = await clock.stamp(
      'accounts',
      await createAccount(database.db, env, {
        id: testId('acc'),
        referenceId: 'a',
        tags: ['Gold'],
      }),
    );
    const b = await clock.stamp(
      'accounts',
      await createAccount(database.db, env, {
        id: testId('acc'),
        accountTypeId: type.id,
        tags: ['silver'],
      }),
    );
    const c = await clock.stamp(
      'accounts',
      await createAccount(database.db, env, { id: testId('acc') }),
    );
    await updateAccount(database.db, env, c.id, { status: 'archived' });
    const ids = async (options: Parameters<typeof listAccounts>[2]) =>
      (await listAccounts(database.db, env, options)).items.map((account) => account.id);

    expect(await ids({})).toEqual([c.id, b.id, a.id]);
    expect(await ids({ referenceId: 'a' })).toEqual([a.id]);
    expect(await ids({ accountTypeId: type.id })).toEqual([b.id]);
    expect(await ids({ status: 'archived' })).toEqual([c.id]);
    expect(await ids({ status: ['active'] })).toEqual([b.id, a.id]);
    expect(await ids({ tag: 'GOLD' })).toEqual([a.id]);
    expect(await ids({ tag: ['gold', 'Silver'] })).toEqual([b.id, a.id]);
    expect(await ids({ status: [] })).toEqual([]);
    expect(await ids({ createdAtStart: new Date(Date.now() + 60_000) })).toEqual([]);
    expect(await ids({ createdAtEnd: new Date(Date.now() + 60_000) })).toHaveLength(3);
    const first = await listAccounts(database.db, env, { size: 2 });
    expect(first.next).toBe(b.id);
    expect(
      (await listAccounts(database.db, env, { size: 2, after: first.next ?? '' })).items,
    ).toEqual([a]);
    await expect(listAccounts(database.db, env, { after: testId('acc') })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it('merges fields, changes the reference and status, and returns the previous state', async () => {
    const env = await tenant();
    const account = await createAccount(database.db, env, {
      id: testId('acc'),
      fields: { name_first: 'Jane', name_last: 'Doe' },
    });

    const result = await updateAccount(database.db, env, account.id, {
      fields: { name_last: 'Roe', birthdate: '1990-01-01' },
      referenceId: 'ref-9',
      status: 'archived',
    });
    const unchanged = await updateAccount(database.db, env, account.id, {});

    expect(result?.previous).toMatchObject({ status: 'active', referenceId: null });
    expect(result?.account).toMatchObject({
      status: 'archived',
      referenceId: 'ref-9',
      fields: { name_first: 'Jane', name_last: 'Roe', birthdate: '1990-01-01' },
    });
    expect(unchanged?.account).toEqual(result?.account);
  });
});

describe('account tags (C9)', () => {
  it('adds, ignores duplicates ignoring case, removes and replaces', async () => {
    const env = await tenant();
    const account = await createAccount(database.db, env, { id: testId('acc'), tags: ['VIP'] });

    const added = await addAccountTag(database.db, env, account.id, 'Risk');
    const again = await addAccountTag(database.db, env, account.id, 'vip');
    const removed = await removeAccountTag(database.db, env, account.id, 'RISK');
    const missing = await removeAccountTag(database.db, env, account.id, 'absent');
    const replaced = await setAccountTags(database.db, env, account.id, ['a', 'B', 'b']);

    expect(added).toMatchObject({ changed: true, record: { tags: ['VIP', 'Risk'] } });
    expect(again).toMatchObject({ changed: false, record: { tags: ['VIP', 'Risk'] } });
    expect(removed).toMatchObject({ changed: true, record: { tags: ['VIP'] } });
    expect(missing?.changed).toBe(false);
    expect(replaced).toMatchObject({ changed: true, record: { tags: ['a', 'B'] } });
  });

  it('refuses a 51st tag', async () => {
    const env = await tenant();
    const fifty = Array.from({ length: 50 }, (_, index) => `t${String(index)}`);
    const account = await createAccount(database.db, env, { id: testId('acc'), tags: fifty });

    await expect(addAccountTag(database.db, env, account.id, 'one-more')).rejects.toThrow(
      TagLimitError,
    );
    await expect(setAccountTags(database.db, env, account.id, [...fifty, 'x'])).rejects.toThrow(
      TagLimitError,
    );
    expect(await addAccountTag(database.db, await tenant(), account.id, 'x')).toBeNull();
  });
});

describe('inquiry to account resolution (C13)', () => {
  it('uses the given account, then the reference id, then a new account', async () => {
    const env = await tenant();
    const other = await tenant();
    const existing = await createAccount(database.db, env, {
      id: testId('acc'),
      referenceId: 'r1',
    });

    expect(await resolveInquiryAccount(database.db, env, { accountId: existing.id })).toBe(
      existing.id,
    );
    expect(await resolveInquiryAccount(database.db, other, { accountId: existing.id })).toBeNull();
    expect(await resolveInquiryAccount(database.db, env, { referenceId: 'r1' })).toBe(existing.id);
    const created = await resolveInquiryAccount(database.db, env, {
      referenceId: 'r2',
      newAccountId: testId('acc'),
    });
    expect((await getAccount(database.db, env, created ?? ''))?.referenceId).toBe('r2');
    const fresh = await resolveInquiryAccount(database.db, env, {});
    expect(fresh).toMatch(/^acc_/);
    expect(fresh).not.toBe(created);
  });

  it('follows a consolidated account to the account that absorbed it', async () => {
    const env = await tenant();
    const target = await createAccount(database.db, env, { id: testId('acc') });
    await createAccount(database.db, env, { id: testId('acc'), referenceId: 'old-ref' });
    const source = await findAccountByReferenceId(database.db, env, 'old-ref');
    await consolidateAccounts(database.db, env, {
      targetId: target.id,
      sourceIds: [source?.id ?? ''],
    });

    expect(await resolveInquiryAccount(database.db, env, { referenceId: 'old-ref' })).toBe(
      target.id,
    );
  });

  it('links and unlinks inquiries, listing the latest ones', async () => {
    onTestFinished(wallClockStepsBack());
    const env = await tenant();
    const other = await tenant();
    const account = await createAccount(database.db, env, { id: testId('acc') });
    const { inquiry: first } = await createTestInquiry(database.db, env);
    const { inquiry: second } = await createTestInquiry(database.db, env);
    const { inquiry: foreign } = await createTestInquiry(database.db, other);
    const clock = createdAtClock(database.db);
    await clock.at('inquiries', first.id);
    await clock.at('inquiries', second.id);

    const moved = await moveInquiriesToAccount(database.db, env, account.id, [
      first.id,
      second.id,
      foreign.id,
    ]);

    expect(moved.sort()).toEqual([first.id, second.id].sort());
    expect(await listAccountInquiryIds(database.db, env, account.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(await listAccountInquiryIds(database.db, env, account.id, 1)).toEqual([second.id]);
    expect((await getInquiry(database.db, other, foreign.id))?.accountId).not.toBe(account.id);
    expect(await moveInquiriesToAccount(database.db, env, account.id, [])).toEqual([]);
    expect(await moveInquiriesToAccount(database.db, other, account.id, [foreign.id])).toEqual([]);
  });
});

describe('account relations (C13)', () => {
  it('adds directed relations once and lists both directions', async () => {
    onTestFinished(wallClockStepsBack());
    const env = await tenant();
    const clock = createdAtClock(database.db);
    const a = await createAccount(database.db, env, { id: testId('acc') });
    const b = await createAccount(database.db, env, { id: testId('acc') });
    const c = await createAccount(database.db, env, { id: testId('acc') });
    const relationOf = async (from: string, to: string) =>
      (
        await database.db.execute<{ id: number }>(
          sql`select id from account_relations
              where from_account_id = ${from} and to_account_id = ${to}`,
        )
      ).rows[0]?.id ?? 0;

    expect(
      await addAccountRelation(database.db, env, {
        fromAccountId: a.id,
        toAccountId: b.id,
        relationType: 'spouse',
      }),
    ).toBe(true);
    expect(
      await addAccountRelation(database.db, env, {
        fromAccountId: a.id,
        toAccountId: b.id,
        relationType: 'spouse',
      }),
    ).toBe(false);
    await clock.at('account_relations', await relationOf(a.id, b.id));
    await addAccountRelation(database.db, env, {
      fromAccountId: c.id,
      toAccountId: a.id,
      relationType: 'business_owner',
    });
    await clock.at('account_relations', await relationOf(c.id, a.id));

    expect(await listAccountRelations(database.db, env, a.id)).toEqual([
      expect.objectContaining({
        relatedAccountId: b.id,
        relationType: 'spouse',
        direction: 'outgoing',
      }),
      expect.objectContaining({
        relatedAccountId: c.id,
        relationType: 'business_owner',
        direction: 'incoming',
      }),
    ]);
    expect(
      await removeAccountRelation(database.db, env, {
        fromAccountId: a.id,
        toAccountId: b.id,
        relationType: 'spouse',
      }),
    ).toBe(true);
    expect(
      await removeAccountRelation(database.db, env, {
        fromAccountId: a.id,
        toAccountId: b.id,
        relationType: 'spouse',
      }),
    ).toBe(false);
    expect(await listAccountRelations(database.db, await tenant(), a.id)).toEqual([]);
  });
});

describe('consolidation (C13)', () => {
  async function setup() {
    const env = await tenant();
    const target = await createAccount(database.db, env, {
      id: testId('acc'),
      fields: { name_first: 'Target', city: 'Here' },
      tags: ['VIP'],
    });
    const s1 = await createAccount(database.db, env, {
      id: testId('acc'),
      referenceId: 'dup-1',
      fields: { name_first: 'Source', birthdate: '1990-01-01' },
      tags: ['vip', 'Risk'],
    });
    const s2 = await createAccount(database.db, env, {
      id: testId('acc'),
      fields: { phone: '+15555550100', birthdate: '1980-01-01' },
    });
    const outsider = await createAccount(database.db, env, { id: testId('acc') });
    return { env, target, s1, s2, outsider };
  }

  it('moves inquiries and relations, unions tags, merges fields and archives the sources', async () => {
    const { env, target, s1, s2, outsider } = await setup();
    const { inquiry } = await createTestInquiry(database.db, env);
    await moveInquiriesToAccount(database.db, env, s1.id, [inquiry.id]);
    const relate = (from: string, to: string, relationType: string) =>
      addAccountRelation(database.db, env, { fromAccountId: from, toAccountId: to, relationType });
    await relate(s1.id, outsider.id, 'spouse');
    await relate(target.id, outsider.id, 'spouse');
    await relate(outsider.id, s2.id, 'business_owner');
    await relate(s1.id, s2.id, 'sibling');
    await relate(s1.id, target.id, 'parent');

    const result = await consolidateAccounts(database.db, env, {
      targetId: target.id,
      sourceIds: [s1.id, s2.id],
    });

    expect(result.target).toMatchObject({
      tags: ['VIP', 'Risk'],
      fields: {
        name_first: 'Target',
        city: 'Here',
        birthdate: '1990-01-01',
        phone: '+15555550100',
      },
      status: 'active',
    });
    expect(
      result.sources.map((source) => [source.id, source.status, source.consolidatedInto]),
    ).toEqual([
      [s1.id, 'archived', target.id],
      [s2.id, 'archived', target.id],
    ]);
    expect(result.movedInquiryIds).toEqual([inquiry.id]);
    expect((await getInquiry(database.db, env, inquiry.id))?.accountId).toBe(target.id);
    const relations = await listAccountRelations(database.db, env, target.id);
    expect(
      relations.map((relation) => [
        relation.relatedAccountId,
        relation.relationType,
        relation.direction,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [outsider.id, 'spouse', 'outgoing'],
        [outsider.id, 'business_owner', 'incoming'],
      ]),
    );
    expect(relations).toHaveLength(2);
    expect(await listAccountRelations(database.db, env, s1.id)).toEqual([]);
  });

  it('re-points accounts consolidated into a source, and refuses invalid requests', async () => {
    const { env, target, s1, s2 } = await setup();
    await consolidateAccounts(database.db, env, { targetId: s1.id, sourceIds: [s2.id] });
    await consolidateAccounts(database.db, env, { targetId: target.id, sourceIds: [s1.id] });

    expect((await getAccount(database.db, env, s2.id))?.consolidatedInto).toBe(target.id);
    const reason = async (
      input: Parameters<typeof consolidateAccounts>[2],
      environmentId = env,
    ) => {
      try {
        await consolidateAccounts(database.db, environmentId, input);
      } catch (error) {
        return error instanceof AccountConsolidationError ? error.reason : String(error);
      }
      return 'ok';
    };
    const fresh = await createAccount(database.db, env, { id: testId('acc') });
    expect(await reason({ targetId: target.id, sourceIds: [target.id] })).toBe('target_in_sources');
    expect(await reason({ targetId: target.id, sourceIds: [s1.id] })).toBe('source_consolidated');
    expect(await reason({ targetId: s1.id, sourceIds: [fresh.id] })).toBe('target_inactive');
    expect(await reason({ targetId: target.id, sourceIds: [testId('acc')] })).toBe('not_found');
    expect(await reason({ targetId: target.id, sourceIds: [] })).toBe('invalid_sources');
    expect(await reason({ targetId: target.id, sourceIds: [fresh.id] }, await tenant())).toBe(
      'not_found',
    );
  });

  it('refuses a union of more than 50 tags', async () => {
    const env = await tenant();
    const tags = (prefix: string) =>
      Array.from({ length: 30 }, (_, index) => `${prefix}${String(index)}`);
    const target = await createAccount(database.db, env, { id: testId('acc'), tags: tags('a') });
    const source = await createAccount(database.db, env, { id: testId('acc'), tags: tags('b') });

    await expect(
      consolidateAccounts(database.db, env, { targetId: target.id, sourceIds: [source.id] }),
    ).rejects.toMatchObject({ reason: 'too_many_tags' });
    expect((await getAccount(database.db, env, source.id))?.status).toBe('active');
  });
});
