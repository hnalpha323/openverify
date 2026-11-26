// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { LIFECYCLE_IDS as IDS, account, single } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import {
  addAccountInquiries,
  addAccountRelation,
  addAccountTag,
  consolidateAccounts,
  redactAccount,
  removeAccountInquiry,
  removeAccountRelation,
  removeAccountTag,
  setAccountTags,
  updateAccountFields,
  updateAccountStatus,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ACCOUNT = `/accounts/${IDS.account}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as('accounts:read', 'accounts:write', 'accounts:redact', 'pii:view');
  for (const action of [
    'add-tag',
    'remove-tag',
    'set-tags',
    'add-relation',
    'remove-relation',
    'consolidate',
    'add-objects',
    'remove-objects',
    'redact',
  ]) {
    api.on('POST', `${ACCOUNT}/${action}`, 200, single(account()));
  }
  api.on('POST', `/accounts/${IDS.thirdAccount}/remove-relation`, 200, single(account()));
  api.on('PATCH', ACCOUNT, 200, single(account()));
});

afterEach(() => {
  api.restore();
});

function as(...permissions: Permission[]) {
  api.me({ permissions });
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const body = (method: string, path: string) => api.find(method, path)?.body;

describe('updateAccountStatus', () => {
  it('archives and restores through PATCH /accounts/:id', async () => {
    await expect(
      updateAccountStatus(null, form({ 'account-id': IDS.account, status: 'archived' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(body('PATCH', ACCOUNT)).toEqual({
      data: { type: 'account', attributes: { status: 'archived' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(ACCOUNT);
  });

  it('refuses an unknown status', async () => {
    await expect(
      updateAccountStatus(null, form({ 'account-id': IDS.account, status: 'deleted' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/status' }] },
    });
  });

  it('needs accounts:write', async () => {
    as('accounts:read');

    await expect(
      updateAccountStatus(null, form({ 'account-id': IDS.account, status: 'archived' })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('account tags', () => {
  it('adds, removes and replaces tags', async () => {
    await addAccountTag(null, form({ 'account-id': IDS.account, 'tag-name': 'gold' }));
    await removeAccountTag(null, form({ 'account-id': IDS.account, 'tag-name': 'vip' }));
    await setAccountTags(null, form({ 'account-id': IDS.account, 'tag-names': 'a\nb' }));

    expect(body('POST', `${ACCOUNT}/add-tag`)).toEqual({ meta: { 'tag-name': 'gold' } });
    expect(body('POST', `${ACCOUNT}/remove-tag`)).toEqual({ meta: { 'tag-name': 'vip' } });
    expect(body('POST', `${ACCOUNT}/set-tags`)).toEqual({ meta: { 'tag-names': ['a', 'b'] } });
  });
});

describe('updateAccountFields', () => {
  it('merges the JSON object into the fields', async () => {
    await expect(
      updateAccountFields(null, form({ 'account-id': IDS.account, fields: '{"name_first":"A"}' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(body('PATCH', ACCOUNT)).toEqual({
      data: { type: 'account', attributes: { fields: { name_first: 'A' } } },
    });
  });

  it("shows the API's 422 for fields outside the account type, by path", async () => {
    api.onProblem('PATCH', ACCOUNT, 422, undefined, {
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/fields/nickname',
          detail: 'is not a field of this account type',
        },
      ],
    });

    await expect(
      updateAccountFields(null, form({ 'account-id': IDS.account, fields: '{"nickname":"A"}' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        status: 422,
        errors: [
          {
            pointer: '/data/attributes/fields/nickname',
            detail: 'is not a field of this account type',
          },
        ],
      },
    });
  });

  it('needs pii:view', async () => {
    as('accounts:read', 'accounts:write');

    await expect(
      updateAccountFields(null, form({ 'account-id': IDS.account, fields: '{}' })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('relations', () => {
  it('adds a relation from this account', async () => {
    await expect(
      addAccountRelation(
        null,
        form({
          'account-id': IDS.account,
          'related-account-id': ` ${IDS.otherAccount} `,
          'relation-type': 'spouse',
        }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(body('POST', `${ACCOUNT}/add-relation`)).toEqual({
      meta: { 'related-account-id': IDS.otherAccount, 'relation-type': 'spouse' },
    });
  });

  it('refuses a relation type the contract refuses', async () => {
    await expect(
      addAccountRelation(
        null,
        form({
          'account-id': IDS.account,
          'related-account-id': IDS.otherAccount,
          'relation-type': 'Business Owner',
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/meta/relation-type' }] },
    });
  });

  it('removes an incoming relation on the account it starts from, and refreshes both pages', async () => {
    await expect(
      removeAccountRelation(
        null,
        form({
          'account-id': IDS.account,
          'from-account-id': IDS.thirdAccount,
          'related-account-id': IDS.account,
          'relation-type': 'business_owner',
        }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(body('POST', `/accounts/${IDS.thirdAccount}/remove-relation`)).toEqual({
      meta: { 'related-account-id': IDS.account, 'relation-type': 'business_owner' },
    });
    expect(revalidatePath).toHaveBeenCalledWith(ACCOUNT);
    expect(revalidatePath).toHaveBeenCalledWith(`/accounts/${IDS.thirdAccount}`);
  });
});

describe('consolidateAccounts', () => {
  it('consolidates the listed accounts into this one', async () => {
    await expect(
      consolidateAccounts(
        null,
        form({
          'account-id': IDS.account,
          'source-account-ids': `${IDS.otherAccount},\n ${IDS.thirdAccount}`,
        }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(body('POST', `${ACCOUNT}/consolidate`)).toEqual({
      meta: { 'source-account-ids': [IDS.otherAccount, IDS.thirdAccount] },
    });
    expect(revalidatePath).toHaveBeenCalledWith(ACCOUNT);
    expect(revalidatePath).toHaveBeenCalledWith(`/accounts/${IDS.otherAccount}`);
  });

  it('refuses an empty list or a malformed id, plainly', async () => {
    for (const ids of ['', 'acc_x', `${IDS.otherAccount} ${IDS.inquiry}`]) {
      await expect(
        consolidateAccounts(null, form({ 'account-id': IDS.account, 'source-account-ids': ids })),
      ).resolves.toMatchObject({
        ok: false,
        problem: {
          errors: [
            {
              pointer: '/meta/source-account-ids',
              detail: 'Enter 1 to 10 account IDs, such as acc_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
            },
          ],
        },
      });
    }
    expect(api.find('POST', `${ACCOUNT}/consolidate`)).toBeUndefined();
  });
});

describe('account inquiries', () => {
  it('links the listed inquiries to the account', async () => {
    await addAccountInquiries(
      null,
      form({ 'account-id': IDS.account, 'inquiry-ids': `${IDS.inquiry} ${IDS.otherInquiry}` }),
    );

    expect(body('POST', `${ACCOUNT}/add-objects`)).toEqual({
      meta: {
        objects: [
          { type: 'inquiry', id: IDS.inquiry },
          { type: 'inquiry', id: IDS.otherInquiry },
        ],
      },
    });
  });

  it('refuses a malformed inquiry id, plainly', async () => {
    await expect(
      addAccountInquiries(null, form({ 'account-id': IDS.account, 'inquiry-ids': 'inq_x' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/meta/objects' }] },
    });
  });

  it('unlinks one inquiry', async () => {
    await removeAccountInquiry(
      null,
      form({ 'account-id': IDS.account, 'inquiry-id': IDS.inquiry }),
    );

    expect(body('POST', `${ACCOUNT}/remove-objects`)).toEqual({
      meta: { objects: [{ type: 'inquiry', id: IDS.inquiry }] },
    });
  });
});

describe('redactAccount', () => {
  it('redacts once the operator typed the confirmation', async () => {
    await expect(
      redactAccount(null, form({ 'account-id': IDS.account, confirmation: 'redact' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `${ACCOUNT}/redact`)).toBeDefined();
  });

  it('refuses without the confirmation or without accounts:redact', async () => {
    await expect(
      redactAccount(null, form({ 'account-id': IDS.account, confirmation: '' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/confirmation' }] } });
    as('accounts:read', 'accounts:write');
    await expect(
      redactAccount(null, form({ 'account-id': IDS.account, confirmation: 'redact' })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.find('POST', `${ACCOUNT}/redact`)).toBeUndefined();
  });
});
