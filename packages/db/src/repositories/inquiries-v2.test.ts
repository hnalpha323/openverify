/** Phase 2 inquiry repository behaviour: accounts, tags, notes, filters and expiry (C10, C13). */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import { createAccount, getAccount } from './accounts.js';
import {
  addInquiryTag,
  createInquiry,
  getInquiry,
  InquiryAccountNotFoundError,
  listInquiries,
  listOverdueInquiries,
  removeInquiryTag,
  setInquiryTags,
  TagLimitError,
  transitionInquiryStatus,
  updateInquiry,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const { environment } = await createTestTenant(database.db);
  const { template } = await createTestInquiry(database.db, environment.id);
  const create = (input: Partial<Parameters<typeof createInquiry>[2]> = {}) =>
    createInquiry(database.db, environment.id, {
      id: testId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.currentVersion.id,
      ...input,
    });
  return { env: environment.id, template, create };
}

describe('creating inquiries with accounts (C13)', () => {
  it('uses the given account, or resolves one from the reference id', async () => {
    const { env, create } = await setup();
    const account = await createAccount(database.db, env, { id: testId('acc') });

    const linked = await create({ accountId: account.id });
    const first = await create({ referenceId: 'cust-7' });
    const second = await create({ referenceId: 'cust-7' });
    const anonymous = await create();

    expect(linked.accountId).toBe(account.id);
    expect(first.accountId).toBe(second.accountId);
    expect((await getAccount(database.db, env, first.accountId))?.referenceId).toBe('cust-7');
    expect(anonymous.accountId).not.toBe(first.accountId);
  });

  it('refuses an account from another environment', async () => {
    const { create } = await setup();
    const other = (await createTestTenant(database.db)).environment.id;
    const foreign = await createAccount(database.db, other, { id: testId('acc') });

    await expect(create({ accountId: foreign.id })).rejects.toThrow(InquiryAccountNotFoundError);
  });

  it('stores tags, a sealed note and the expiry', async () => {
    const { create } = await setup();
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');

    const inquiry = await create({ tags: ['VIP'], note: 'Synthetic note', expiresAt });
    const raw = await database.db.execute<{ note: string }>(
      sql`select note from inquiries where id = ${inquiry.id}`,
    );

    expect(inquiry).toMatchObject({
      tags: ['VIP'],
      note: 'Synthetic note',
      expiresAt,
      redactedAt: null,
    });
    expect(raw.rows[0]?.note).toMatch(/^ov1\./);
    expect(raw.rows[0]?.note).not.toContain('Synthetic');
  });
});

describe('updating inquiries (C10 PATCH)', () => {
  it('merges fields and sets the reference and note', async () => {
    const { env, create } = await setup();
    const inquiry = await create({ fields: { name_first: 'Jane', name_last: 'Doe' } });

    const updated = await updateInquiry(database.db, env, inquiry.id, {
      fields: { name_last: 'Roe' },
      referenceId: 'ref-2',
      note: 'checked',
    });
    const cleared = await updateInquiry(database.db, env, inquiry.id, { note: null });
    const same = await updateInquiry(database.db, env, inquiry.id, {});

    expect(updated).toMatchObject({
      fields: { name_first: 'Jane', name_last: 'Roe' },
      referenceId: 'ref-2',
      note: 'checked',
    });
    expect(cleared?.note).toBeNull();
    expect(same).toEqual(cleared);
    expect(await updateInquiry(database.db, testId('env'), inquiry.id, { note: 'x' })).toBeNull();
  });
});

describe('inquiry tags (C9)', () => {
  it('adds, removes and replaces tags ignoring case', async () => {
    const { env, create } = await setup();
    const inquiry = await create();

    expect(await addInquiryTag(database.db, env, inquiry.id, 'VIP')).toMatchObject({
      changed: true,
      record: { tags: ['VIP'] },
    });
    expect((await addInquiryTag(database.db, env, inquiry.id, 'vip'))?.changed).toBe(false);
    expect(await removeInquiryTag(database.db, env, inquiry.id, 'Vip')).toMatchObject({
      changed: true,
      record: { tags: [] },
    });
    expect(await setInquiryTags(database.db, env, inquiry.id, ['x', 'X', 'y'])).toMatchObject({
      record: { tags: ['x', 'y'] },
    });
    await expect(
      setInquiryTags(
        database.db,
        env,
        inquiry.id,
        Array.from({ length: 51 }, (_, index) => `t${String(index)}`),
      ),
    ).rejects.toThrow(TagLimitError);
    expect(await removeInquiryTag(database.db, testId('env'), inquiry.id, 'x')).toBeNull();
    expect(await setInquiryTags(database.db, testId('env'), inquiry.id, [])).toBeNull();
  });
});

describe('listing inquiries with the C10 filters', () => {
  it('filters by account, template, tag and creation time', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, create } = await setup();
    const account = await createAccount(database.db, env, { id: testId('acc') });
    const other = await setup();
    const clock = createdAtClock(database.db);
    const a = await create({ accountId: account.id, tags: ['Gold'] });
    await clock.at('inquiries', a.id);
    const b = await create({ tags: ['silver'] });
    await clock.at('inquiries', b.id);
    const ids = async (options: Parameters<typeof listInquiries>[2]) =>
      (await listInquiries(database.db, env, options)).items.map((inquiry) => inquiry.id);

    expect(await ids({ accountId: account.id })).toEqual([a.id]);
    expect(await ids({ tag: 'GOLD' })).toEqual([a.id]);
    expect(await ids({ tag: ['gold', 'SILVER'] })).toEqual([b.id, a.id]);
    expect(await ids({ inquiryTemplateId: other.template.id })).toEqual([]);
    expect(await ids({ createdAtEnd: new Date(Date.now() - 3_600_000) })).toEqual([]);
    expect(
      await ids({ createdAtStart: new Date(Date.now() - 3_600_000), referenceId: ['none'] }),
    ).toEqual([]);
    expect(await ids({ tag: [] })).toEqual([]);
  });
});

describe('the C10 expiry sweep', () => {
  it('selects open inquiries past their expiry, across environments, oldest first', async () => {
    const first = await setup();
    const second = await setup();
    const past = new Date('2001-01-01T00:00:00.000Z');
    const overdue = await first.create({ expiresAt: past });
    const pending = await second.create({ expiresAt: new Date('2001-01-02T00:00:00.000Z') });
    await transitionInquiryStatus(database.db, second.env, pending.id, {
      from: 'created',
      to: 'pending',
    });
    const finished = await first.create({ expiresAt: past });
    await transitionInquiryStatus(database.db, first.env, finished.id, {
      from: 'created',
      to: 'pending',
    });
    await transitionInquiryStatus(database.db, first.env, finished.id, {
      from: 'pending',
      to: 'completed',
    });
    await first.create();

    const due = await listOverdueInquiries(database.db, {
      now: new Date('2002-01-01T00:00:00.000Z'),
    });
    const locked = await database.db.transaction((tx) =>
      listOverdueInquiries(tx, { now: new Date('2002-01-01T00:00:00.000Z'), lock: true, limit: 1 }),
    );

    expect(due).toEqual([
      { id: overdue.id, environmentId: first.env, status: 'created', expiresAt: past },
      {
        id: pending.id,
        environmentId: second.env,
        status: 'pending',
        expiresAt: new Date('2001-01-02T00:00:00.000Z'),
      },
    ]);
    expect(locked.map((row) => row.id)).toEqual([overdue.id]);
  });

  it('reads redaction state', async () => {
    const { env, create } = await setup();
    const inquiry = await create();

    expect((await getInquiry(database.db, env, inquiry.id))?.redactedAt).toBeNull();
  });
});
