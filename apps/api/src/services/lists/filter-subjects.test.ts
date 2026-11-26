/**
 * C107.4 (Workflow 7B, `api-lists`; V14): a `list-match` event resolves through its inquiry for the
 * strict webhook filters, scoped to the environment. Synthetic values.
 */
import { createTestDatabase, createTestInquiry, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveListMatchFilterSubjects } from './filter-subjects.js';

let database: TestDatabase;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const payloadOf = (inquiryId: string, accountId: string | null) => ({
  data: {
    type: 'list-match',
    relationships: {
      inquiry: { data: { type: 'inquiry', id: inquiryId } },
      account: { data: accountId === null ? null : { type: 'account', id: accountId } },
    },
  },
});

describe('resolveListMatchFilterSubjects (C107.4)', () => {
  it('reads the inquiry’s template and its account’s type', async () => {
    const { inquiry, template } = await createTestInquiry(database.db, environmentId);
    const [subject] = await resolveListMatchFilterSubjects(database.db, environmentId, [
      payloadOf(inquiry.id, inquiry.accountId),
    ]);
    expect(subject?.inquiryTemplateId).toBe(template.id);
    expect(subject?.accountTypeId).toMatch(/^acctp_/u);
  });

  it('resolves nothing for another environment’s inquiry, or a payload without one', async () => {
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const other = (await createTestTenant(database.db)).environment.id;
    expect(
      await resolveListMatchFilterSubjects(database.db, other, [
        payloadOf(inquiry.id, inquiry.accountId),
        {},
      ]),
    ).toEqual([{}, {}]);
  });
});
