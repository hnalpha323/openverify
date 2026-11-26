// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSACTION_PROBLEM_WORDS } from '../../components/transactions/transaction-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { TRANSACTION_REVIEWER } from '../../testing/routes/transactions';
import { TRANSACTION_IDS, transaction } from '../../testing/transactions-fixtures';
import {
  addTransactionObjects,
  addTransactionRelation,
  addTransactionTag,
  labelTransaction,
  redactTransaction,
  redactTransactionBiometrics,
  removeTransactionObject,
  removeTransactionRelation,
  removeTransactionTag,
  setTransactionTags,
  updateTransactionStatus,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ID = TRANSACTION_IDS.transaction;
const PATH = `/transactions/${ID}`;
const DOCUMENT = { data: transaction() };
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: [...TRANSACTION_REVIEWER, 'inquiries:redact'] });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
};
const as = (permissions: readonly Permission[]) => api.me({ permissions });
const OK = { ok: true, data: undefined };
const FORBIDDEN = { ok: false, problem: { title: 'You do not have access' } };
const id = { 'transaction-id': ID };

describe('transaction actions (C105.2)', () => {
  it('changes the status with PATCH, and titles an unknown status in words', async () => {
    api.on('PATCH', PATH, 200, DOCUMENT);

    expect(await updateTransactionStatus(null, form({ ...id, status: 'needs review' }))).toEqual(
      OK,
    );
    expect(api.find('PATCH', PATH)?.body).toEqual({
      data: { type: 'transaction', attributes: { status: 'needs review' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(PATH);

    api.onProblem('PATCH', PATH, 422, undefined, { code: 'status_does_not_exist' });
    expect(await updateTransactionStatus(null, form({ ...id, status: 'gone' }))).toMatchObject({
      ok: false,
      problem: { title: TRANSACTION_PROBLEM_WORDS.status_does_not_exist },
    });
  });

  it('adds a label with its score and model version, leaving out what was left empty', async () => {
    api.on('POST', `${PATH}/label`, 200, DOCUMENT);

    await labelTransaction(
      null,
      form({ ...id, label: 'fraud', score: '0.82', 'model-version': '' }),
    );

    expect(api.find('POST', `${PATH}/label`)?.body).toEqual({
      meta: { label: 'fraud', score: 0.82 },
    });
  });

  it('attaches the objects typed, one per line or comma, and detaches one', async () => {
    api.on('POST', `${PATH}/add-objects`, 200, DOCUMENT);
    api.on('POST', `${PATH}/remove-objects`, 200, DOCUMENT);

    await addTransactionObjects(
      null,
      form({
        ...id,
        'object-ids': `${TRANSACTION_IDS.inquiry},\n ${TRANSACTION_IDS.verification}`,
      }),
    );
    await removeTransactionObject(null, form({ ...id, 'object-id': TRANSACTION_IDS.inquiry }));

    expect(api.find('POST', `${PATH}/add-objects`)?.body).toEqual({
      meta: { 'object-ids': [TRANSACTION_IDS.inquiry, TRANSACTION_IDS.verification] },
    });
    expect(api.find('POST', `${PATH}/remove-objects`)?.body).toEqual({
      meta: { 'object-ids': [TRANSACTION_IDS.inquiry] },
    });
  });

  it('sets and removes a relation, wording a refused second target (K7B-6)', async () => {
    api.on('POST', `${PATH}/add-relation`, 200, DOCUMENT);
    api.on('POST', `${PATH}/remove-relation`, 200, DOCUMENT);
    const relation = {
      ...id,
      'relation-schema-key': 'payer',
      'target-object-id': TRANSACTION_IDS.account,
    };

    expect(await addTransactionRelation(null, form(relation))).toEqual(OK);
    expect(await removeTransactionRelation(null, form(relation))).toEqual(OK);
    expect(api.find('POST', `${PATH}/add-relation`)?.body).toEqual({
      meta: { 'relation-schema-key': 'payer', 'target-object-id': TRANSACTION_IDS.account },
    });

    api.onProblem('POST', `${PATH}/add-relation`, 422, undefined, {
      code: 'relation_cardinality_exceeded',
      detail: 'The relation payer takes one target.',
      errors: [{ pointer: '/meta/relation-schema-key', detail: 'Holds one target.' }],
    });
    expect(await addTransactionRelation(null, form(relation))).toMatchObject({
      ok: false,
      problem: {
        title: TRANSACTION_PROBLEM_WORDS.relation_cardinality_exceeded,
        detail: 'The relation payer takes one target.',
        errors: [
          { pointer: '/meta/relation-schema-key', detail: 'Remove the current target first.' },
        ],
      },
    });
  });

  it('adds, removes and sets tags through the tag routes', async () => {
    api.on('POST', `${PATH}/add-tag`, 200, DOCUMENT);
    api.on('POST', `${PATH}/remove-tag`, 200, DOCUMENT);
    api.on('POST', `${PATH}/set-tags`, 200, DOCUMENT);

    expect(await addTransactionTag(null, form({ ...id, 'tag-name': 'vip' }))).toEqual(OK);
    expect(await removeTransactionTag(null, form({ ...id, 'tag-name': 'vip' }))).toEqual(OK);
    expect(await setTransactionTags(null, form({ ...id, 'tag-names': 'a, b' }))).toEqual(OK);
    expect(api.find('POST', `${PATH}/add-tag`)?.body).toEqual({ meta: { 'tag-name': 'vip' } });
    // K7B-9: the node client's own header, which `apiRequest` never sends.
    for (const route of ['add-tag', 'remove-tag', 'set-tags']) {
      expect(api.find('POST', `${PATH}/${route}`)?.headers.get('idempotency-key')).toBeTruthy();
    }
    expect(api.find('POST', `${PATH}/set-tags`)?.body).toEqual({
      meta: { 'tag-names': ['a', 'b'] },
    });
  });

  it('redacts, with the never fields only when asked, and redacts the biometrics', async () => {
    api.on('DELETE', PATH, 200, DOCUMENT);
    api.on('POST', `${PATH}/redact-biometrics`, 200, DOCUMENT);

    expect(await redactTransaction(null, form(id))).toEqual(OK);
    expect(api.find('DELETE', PATH)?.body).toEqual({});
    expect(await redactTransaction(null, form({ ...id, 'include-never': 'on' }))).toEqual(OK);
    expect(api.find('DELETE', PATH)?.body).toEqual({ meta: { 'include-never': true } });
    expect(await redactTransactionBiometrics(null, form(id))).toEqual(OK);
    expect(api.find('POST', `${PATH}/redact-biometrics`)?.body).toEqual({});
    expect(
      api.find('POST', `${PATH}/redact-biometrics`)?.headers.get('idempotency-key'),
    ).toBeTruthy();
  });

  it('needs the scope of each action', async () => {
    as(['transactions:read']);
    expect(await updateTransactionStatus(null, form({ ...id, status: 'x' }))).toMatchObject(
      FORBIDDEN,
    );
    as(['transactions:read', 'transactions:write']);
    expect(await redactTransaction(null, form(id))).toMatchObject(FORBIDDEN);
    as(TRANSACTION_REVIEWER);
    expect(await redactTransactionBiometrics(null, form(id))).toMatchObject(FORBIDDEN);
    expect(api.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('refuses a transaction id of the wrong form without calling the API', async () => {
    const result = await updateTransactionStatus(
      null,
      form({ 'transaction-id': 'nope', status: 'x' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/transaction-id' }] },
    });
  });
});
