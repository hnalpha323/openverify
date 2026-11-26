// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSACTION_PROBLEM_WORDS } from '../../components/transactions/transaction-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { TRANSACTION_DEVELOPER, TRANSACTION_REVIEWER } from '../../testing/routes/transactions';
import {
  FIELD_SCHEMAS,
  TRANSACTION_IDS,
  transactionType,
  transactionTypeVersion,
} from '../../testing/transactions-fixtures';
import {
  archiveTransactionType,
  createTransactionType,
  createTransactionTypeDraft,
  publishTransactionTypeDraft,
  renameTransactionType,
  setTransactionTypeDecisions,
  updateTransactionTypeDraft,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TYPE = `/transaction-types/${TRANSACTION_IDS.type}`;
const DRAFT = `/transaction-type-versions/${TRANSACTION_IDS.draft}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: TRANSACTION_DEVELOPER });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};
const as = (permissions: readonly Permission[]) => api.me({ permissions });
const ids = { 'transaction-type-id': TRANSACTION_IDS.type, 'version-id': TRANSACTION_IDS.draft };

describe('transaction type actions (C104.1)', () => {
  it('creates a type by its name, and answers its id', async () => {
    api.on('POST', '/transaction-types', 201, {
      data: transactionType({ publishedVersion: null }),
    });

    const result = await createTransactionType(
      null,
      form({ 'environment-id': ENVIRONMENTS.sandbox.id, name: ' Synthetic order ' }),
    );

    expect(result).toEqual({ ok: true, data: { id: TRANSACTION_IDS.type } });
    expect(api.find('POST', '/transaction-types')?.body).toEqual({
      data: { type: 'transaction-type', attributes: { name: 'Synthetic order' } },
    });
  });

  it('renames and archives a type', async () => {
    api.on('PATCH', TYPE, 200, { data: transactionType() });
    api.on('DELETE', TYPE, 200, { data: transactionType({ status: 'archived' }) });

    expect(await renameTransactionType(null, form({ ...ids, name: 'Orders' }))).toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.find('PATCH', TYPE)?.body).toEqual({
      data: { type: 'transaction-type', attributes: { name: 'Orders' } },
    });
    expect(await archiveTransactionType(null, form(ids))).toEqual({ ok: true, data: undefined });
    expect(revalidatePath).toHaveBeenCalledWith(TYPE);
  });

  it('makes a draft from the latest version, and answers its id for the editor', async () => {
    api.on('POST', '/transaction-type-versions', 201, { data: transactionTypeVersion() });

    const result = await createTransactionTypeDraft(null, form(ids));

    expect(result).toEqual({ ok: true, data: { id: TRANSACTION_IDS.draft } });
    expect(api.find('POST', '/transaction-type-versions')?.body).toEqual({
      data: {
        type: 'transaction-type-version',
        attributes: { 'transaction-type-id': TRANSACTION_IDS.type },
      },
    });
  });

  it('saves a draft from its JSON documents and the card switch', async () => {
    api.on('PATCH', DRAFT, 200, { data: transactionTypeVersion() });

    const result = await updateTransactionTypeDraft(
      null,
      form({
        ...ids,
        'field-schemas': JSON.stringify(FIELD_SCHEMAS),
        statuses: '["created", "paid"]',
        'relation-schemas': '[]',
        'allow-card-like-strings': 'on',
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', DRAFT)?.body).toEqual({
      data: {
        type: 'transaction-type-version',
        attributes: {
          'field-schemas': FIELD_SCHEMAS,
          statuses: ['created', 'paid'],
          'relation-schemas': [],
          'allow-card-like-strings': true,
        },
      },
    });
  });

  it('names a document that is not JSON at its pointer, without calling the API', async () => {
    const result = await updateTransactionTypeDraft(
      null,
      form({ ...ids, 'field-schemas': '[{', statuses: '["created"]', 'relation-schemas': '[]' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/field-schemas' }] },
    });
    expect(api.find('PATCH', DRAFT)).toBeUndefined();
  });

  it('publishes a draft, and titles a publish refusal in words with every pointer kept', async () => {
    api.on('POST', `${DRAFT}/publish`, 200, {
      data: transactionTypeVersion({ status: 'published' }),
    });
    expect(await publishTransactionTypeDraft(null, form(ids))).toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.find('POST', `${DRAFT}/publish`)?.body).toEqual({});

    api.onProblem('POST', `${DRAFT}/publish`, 422, undefined, {
      code: 'field_schema_invalid',
      errors: [
        { pointer: '/data/attributes/field-schemas/0/key', detail: 'Duplicate key.' },
        { pointer: '/data/attributes/statuses', detail: 'Starts with created.' },
      ],
    });
    expect(await publishTransactionTypeDraft(null, form(ids))).toMatchObject({
      ok: false,
      problem: {
        title: TRANSACTION_PROBLEM_WORDS.field_schema_invalid,
        errors: [
          { pointer: '/data/attributes/field-schemas/0/key' },
          { pointer: '/data/attributes/statuses' },
        ],
      },
    });
  });

  it('needs transaction-types:write, which reviewers lack', async () => {
    as(TRANSACTION_REVIEWER);

    expect(await createTransactionTypeDraft(null, form(ids))).toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
  });
});

describe('setTransactionTypeDecisions (C122.1, C128.3)', () => {
  const decisions = (values: [string, string][]) => {
    const data = new FormData();
    data.set('transaction-type-id', TRANSACTION_IDS.type);
    for (const [name, value] of values) {
      data.append(name, value);
    }
    return data;
  };

  it('sets the adverse statuses and the contest route by PATCH', async () => {
    api.on('PATCH', TYPE, 200, { data: transactionType() });

    const result = await setTransactionTypeDecisions(
      null,
      decisions([
        ['adverse-status', 'declined'],
        ['adverse-status', 'blocked'],
        ['contest-url', 'https://help.example.com/contest'],
        ['contest-contact', ''],
      ]),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', TYPE)?.body).toEqual({
      data: {
        type: 'transaction-type',
        attributes: {
          'adverse-statuses': ['declined', 'blocked'],
          'contest-route': { url: 'https://help.example.com/contest' },
        },
      },
    });
  });

  it('sends no adverse status and no contest route as an empty list and null', async () => {
    api.on('PATCH', TYPE, 200, { data: transactionType() });

    await setTransactionTypeDecisions(
      null,
      decisions([
        ['contest-url', ''],
        ['contest-contact', ''],
      ]),
    );

    expect(api.find('PATCH', TYPE)?.body).toEqual({
      data: {
        type: 'transaction-type',
        attributes: { 'adverse-statuses': [], 'contest-route': null },
      },
    });
  });

  it('refuses a contest URL that is not https at its pointer, without calling the API', async () => {
    const result = await setTransactionTypeDecisions(
      null,
      decisions([['contest-url', 'http://help.example.com']]),
    );

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/contest-route/url',
    ]);
    expect(api.all('PATCH', TYPE)).toHaveLength(0);
  });
});
