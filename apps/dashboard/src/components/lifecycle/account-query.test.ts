import { describe, expect, it } from 'vitest';
import { accountFilterQuery, accountListFilter, parseAccountListQuery } from './account-query';

const TYPE = 'acctp_01JB0000000000000000000001';
const CURSOR = 'acc_01JB0000000000000000000001';

describe('parseAccountListQuery', () => {
  it('reads every filter and the cursor from the page URL', () => {
    expect(
      parseAccountListQuery({
        status: 'archived',
        'account-type-id': TYPE,
        tag: 'vip, gold',
        'reference-id': ' acct-ref-001 ',
        'created-from': '2026-10-01',
        'created-to': '2026-10-02',
        after: CURSOR,
      }),
    ).toEqual({
      filters: {
        status: 'archived',
        accountTypeId: TYPE,
        tags: ['vip', 'gold'],
        referenceId: 'acct-ref-001',
        createdFrom: '2026-10-01',
        createdTo: '2026-10-02',
      },
      selected: { status: 'archived', accountTypeId: TYPE },
      values: {
        tag: 'vip, gold',
        'reference-id': ' acct-ref-001 ',
        'created-from': '2026-10-01',
        'created-to': '2026-10-02',
      },
      after: CURSOR,
      errors: {},
    });
  });

  it('drops an unknown status, a malformed type and a malformed cursor, which no form produces', () => {
    expect(
      parseAccountListQuery({ status: 'deleted', 'account-type-id': 'user', after: 'acc_x' }),
    ).toEqual({ filters: { tags: [] }, selected: {}, values: {}, errors: {} });
  });

  it('explains typed values the API would refuse', () => {
    const query = parseAccountListQuery({
      tag: '<b>',
      'created-from': '2026-10-02',
      'created-to': '2026-10-01',
    });

    expect(Object.keys(query.errors).sort()).toEqual(['created-to', 'tag']);
    expect(query.filters).toEqual({ tags: [] });
  });

  it('keeps the chosen status and type for the form while a typed value is refused (Workflow 2D F003)', () => {
    const query = parseAccountListQuery({
      status: 'archived',
      'account-type-id': TYPE,
      tag: '<b>',
    });

    expect(query.filters).toEqual({ tags: [] });
    expect(query.selected).toEqual({ status: 'archived', accountTypeId: TYPE });
  });
});

describe('accountFilterQuery', () => {
  it('keeps the filters in links', () => {
    expect(accountFilterQuery({ status: 'active', accountTypeId: TYPE, tags: ['vip'] })).toEqual({
      status: 'active',
      'account-type-id': TYPE,
      tag: 'vip',
      'reference-id': undefined,
      'created-from': undefined,
      'created-to': undefined,
    });
  });
});

describe('accountListFilter', () => {
  it('builds the C13 list filters for the API client', () => {
    expect(
      accountListFilter({
        status: 'active',
        accountTypeId: TYPE,
        tags: ['vip', 'gold'],
        referenceId: 'ref',
        createdFrom: '2026-10-01',
        createdTo: '2026-10-01',
      }),
    ).toEqual({
      status: 'active',
      'account-type-id': TYPE,
      tag: 'vip,gold',
      'reference-id': 'ref',
      'created-at-start': '2026-10-01T00:00:00.000Z',
      'created-at-end': '2026-10-02T00:00:00.000Z',
    });
  });
});
