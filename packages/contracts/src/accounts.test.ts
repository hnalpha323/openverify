import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_RELATION_DIRECTIONS,
  ACCOUNT_STATUSES,
  MAX_ACCOUNT_INQUIRY_LINKAGE,
  MAX_CONSOLIDATE_SOURCES,
  accountDocumentSchema,
  accountListDocumentSchema,
  accountRelationListDocumentSchema,
  accountResourceSchema,
  addAccountObjectsBodySchema,
  addAccountRelationBodySchema,
  buildAccountRelation,
  buildAccountResource,
  consolidateAccountsBodySchema,
  createAccountBodySchema,
  listAccountsQuerySchema,
  redactAccountBodySchema,
  relationTypeSchema,
  removeAccountObjectsBodySchema,
  removeAccountRelationBodySchema,
  updateAccountBodySchema,
} from './accounts.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';

const account = {
  type: 'account',
  id: IDS.account,
  attributes: {
    'reference-id': 'user-test-001',
    status: 'active',
    fields: { name_first: 'Jane', name_last: 'Sample', birthdate: '1990-01-31', vip: true },
    tags: ['vip'],
    'consolidated-into': null,
    'created-at': AT_ISO,
    'updated-at': LATER_ISO,
    'redacted-at': null,
  },
  relationships: {
    'account-type': { data: { type: 'account-type', id: IDS.accountType } },
    inquiries: { data: [{ type: 'inquiry', id: IDS.inquiry }] },
  },
};

const record = {
  id: IDS.account,
  referenceId: 'user-test-001',
  status: 'active' as const,
  fields: { name_first: 'Jane', name_last: 'Sample', birthdate: '1990-01-31', vip: true },
  tags: ['vip'],
  consolidatedInto: null,
  accountTypeId: IDS.accountType,
  inquiryIds: [IDS.inquiry],
  createdAt: AT,
  updatedAt: LATER,
  redactedAt: null,
};

describe('account resource (C13)', () => {
  it('is active or archived', () => {
    expect(ACCOUNT_STATUSES).toEqual(['active', 'archived']);
  });

  it('carries fields, tags, consolidation, timestamps, its type and inquiries', () => {
    expect(accountResourceSchema.parse(account)).toEqual(account);
    expect(accountDocumentSchema.safeParse({ data: account }).success).toBe(true);
    expect(
      accountListDocumentSchema.safeParse({ data: [account], links: { next: null } }).success,
    ).toBe(true);
  });

  it('allows masked field values and a consolidated, redacted account', () => {
    const value = {
      ...account,
      attributes: {
        ...account.attributes,
        status: 'archived',
        fields: { name_first: null, name_last: null },
        'consolidated-into': IDS.otherAccount,
        'redacted-at': LATER_ISO,
      },
    };
    expect(accountResourceSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['a nested field value', { fields: { address: { city: 'Springfield' } } }],
    ['a kebab-case field name', { fields: { 'name-first': 'Jane' } }],
    ['a consolidation into a non-account', { 'consolidated-into': IDS.inquiry }],
    ['duplicate tags', { tags: ['vip', 'Vip'] }],
  ])('rejects %s', (_name, change) => {
    const value = { ...account, attributes: { ...account.attributes, ...change } };
    expect(accountResourceSchema.safeParse(value).success).toBe(false);
  });

  it('links at most the latest 100 inquiries', () => {
    expect(MAX_ACCOUNT_INQUIRY_LINKAGE).toBe(100);
    const many = Array.from({ length: 101 }, () => ({ type: 'inquiry', id: IDS.inquiry }));
    const value = {
      ...account,
      relationships: { ...account.relationships, inquiries: { data: many } },
    };
    expect(accountResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from an account record', () => {
    expect(buildAccountResource(record)).toEqual(account);
    expect(buildAccountResource({ ...record, redactedAt: LATER }).attributes['redacted-at']).toBe(
      LATER_ISO,
    );
    expect(() => buildAccountResource({ ...record, id: IDS.inquiry })).toThrow();
  });
});

describe('account requests (C13)', () => {
  it('create an account with optional reference, type, fields and tags', () => {
    const body = {
      data: {
        type: 'account',
        attributes: {
          'reference-id': 'user-test-001',
          'account-type-id': IDS.accountType,
          fields: { name_first: 'Jane' },
          tags: ['vip', 'VIP'],
        },
      },
    };
    expect(createAccountBodySchema.parse(body)).toEqual(body);
    expect(createAccountBodySchema.parse({ data: { attributes: {} } })).toEqual({
      data: { attributes: {} },
    });
    expect(
      createAccountBodySchema.safeParse({ data: { attributes: { status: 'archived' } } }).success,
    ).toBe(false);
  });

  it('update fields, the reference id or the status', () => {
    expect(
      updateAccountBodySchema.parse({
        data: { attributes: { fields: { vip: false }, 'reference-id': null, status: 'archived' } },
      }),
    ).toEqual({
      data: { attributes: { fields: { vip: false }, 'reference-id': null, status: 'archived' } },
    });
    expect(updateAccountBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(
      updateAccountBodySchema.safeParse({ data: { attributes: { tags: ['x'] } } }).success,
    ).toBe(false);
  });

  it('filter the list by reference, type, status, tag and creation time', () => {
    const query = {
      'filter[reference-id]': 'user-test-001',
      'filter[account-type-id]': IDS.accountType,
      'filter[status]': 'active,archived',
      'filter[tag]': 'vip',
      'filter[created-at-start]': '2026-10-01T00:00:00Z',
      'page[after]': IDS.account,
    };
    expect(listAccountsQuerySchema.parse(query)).toEqual(query);
    expect(listAccountsQuerySchema.safeParse({ 'filter[status]': 'deleted' }).success).toBe(false);
  });

  it('add or remove a typed, directed relation', () => {
    const body = { meta: { 'related-account-id': IDS.otherAccount, 'relation-type': 'spouse' } };
    expect(addAccountRelationBodySchema.parse(body)).toEqual(body);
    expect(removeAccountRelationBodySchema.parse(body)).toEqual(body);
    expect(relationTypeSchema.safeParse('business_owner').success).toBe(true);
    for (const type of ['Spouse', 'business-owner', '1st', '', `a${'b'.repeat(64)}`]) {
      expect(relationTypeSchema.safeParse(type).success, type).toBe(false);
    }
  });

  it('list relations in both directions', () => {
    const relation = buildAccountRelation({
      direction: 'incoming',
      relationType: 'business_owner',
      relatedAccountId: IDS.otherAccount,
      createdAt: AT,
    });
    expect(relation).toEqual({
      direction: 'incoming',
      'relation-type': 'business_owner',
      'related-account': { type: 'account', id: IDS.otherAccount },
      'created-at': AT_ISO,
    });
    expect(ACCOUNT_RELATION_DIRECTIONS).toEqual(['outgoing', 'incoming']);
    expect(accountRelationListDocumentSchema.parse({ data: [relation] })).toEqual({
      data: [relation],
    });
  });

  it('consolidate 1 to 10 distinct source accounts', () => {
    expect(MAX_CONSOLIDATE_SOURCES).toBe(10);
    const body = { meta: { 'source-account-ids': [IDS.sourceAccount, IDS.secondSource] } };
    expect(consolidateAccountsBodySchema.parse(body)).toEqual(body);
    for (const ids of [
      [],
      [IDS.sourceAccount, IDS.sourceAccount],
      Array.from({ length: 11 }, () => IDS.sourceAccount),
      [IDS.inquiry],
    ]) {
      expect(
        consolidateAccountsBodySchema.safeParse({ meta: { 'source-account-ids': ids } }).success,
      ).toBe(false);
    }
  });

  it('link or unlink inquiries', () => {
    const body = { meta: { objects: [{ type: 'inquiry', id: IDS.inquiry }] } };
    expect(addAccountObjectsBodySchema.parse(body)).toEqual(body);
    expect(removeAccountObjectsBodySchema.parse(body)).toEqual(body);
    for (const objects of [
      [],
      [{ type: 'account', id: IDS.account }],
      [
        { type: 'inquiry', id: IDS.inquiry },
        { type: 'inquiry', id: IDS.inquiry },
      ],
    ]) {
      expect(addAccountObjectsBodySchema.safeParse({ meta: { objects } }).success).toBe(false);
    }
  });

  it('redact without parameters', () => {
    expect(redactAccountBodySchema.parse(undefined)).toBeUndefined();
  });
});

describe('GET /api/v1/accounts/:id?include=reports (C70.5, F08)', () => {
  it('names the include, and carries the reports linked to the account in included', async () => {
    const { ACCOUNT_INCLUDES, accountIncludeDocumentSchema, getAccountQuerySchema } =
      await import('./accounts.js');
    const { readFixture } = await import('./test-support.js');
    expect(ACCOUNT_INCLUDES).toEqual(['reports', 'list-matches', 'transactions']);
    expect(getAccountQuerySchema.safeParse({ include: 'reports' }).success).toBe(true);
    expect(getAccountQuerySchema.safeParse({}).success).toBe(true);
    expect(getAccountQuerySchema.safeParse({ include: 'inquiries' }).success).toBe(false);
    const account = (readFixture('api/account.json') as { data: unknown }).data;
    const report = (readFixture('api/report-phone-number.json') as { data: unknown }).data;
    expect(
      accountIncludeDocumentSchema.safeParse({ data: account, included: [report] }).success,
    ).toBe(true);
    expect(accountIncludeDocumentSchema.safeParse({ data: account }).success).toBe(true);
  });
});
