// @vitest-environment node
import { PERMISSIONS, type Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECT_PROBLEM_WORDS,
  CONSENT_REQUIRED_REASON_WORDS,
} from '../../../components/connect/connect-problem-words';
import { SHARE_TOKEN_ID, shareToken } from '../../../components/connect/connect-fixtures';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { expireShareTokenAction, redeemShareTokenAction } from './actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  vi.mocked(revalidatePath).mockReset();
});

afterEach(() => {
  api.restore();
});

const as = (permissions: readonly Permission[] = PERMISSIONS) => api.me({ permissions });
const formOf = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};
const TOKEN_PATH = `/connect/share-tokens/${SHARE_TOKEN_ID}`;
const REDEEM_PATH = `${TOKEN_PATH}/redeem`;
const CONSENT = 'cnsr_01M5CN0000000000000011A410';
const TEMPLATE = 'itmpl_01M5CN0000000000000011A600';
const ACCOUNT = 'acc_01M5CN0000000000000011A610';
const posts = () => api.requests.filter((request) => request.method === 'POST');

describe('expire a share token (C232.4)', () => {
  it('expires the token named in the form', async () => {
    as();
    api.on('POST', `${TOKEN_PATH}/expire`, 200, {
      data: shareToken('outbound', {
        status: 'expired',
        'expired-at': '2026-10-21T00:00:00.000Z',
        'expiry-reason': 'source_expired',
      }),
    });

    expect(
      await expireShareTokenAction(null, formOf({ 'share-token-id': SHARE_TOKEN_ID })),
    ).toEqual({
      ok: true,
      data: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/connect/share-tokens/${SHARE_TOKEN_ID}`);
  });

  it('says a token that can no longer expire in words', async () => {
    as();
    api.onProblem('POST', `${TOKEN_PATH}/expire`, 409, undefined, {
      code: 'share_token_not_expirable',
    });

    expect(
      await expireShareTokenAction(null, formOf({ 'share-token-id': SHARE_TOKEN_ID })),
    ).toMatchObject({
      ok: false,
      problem: { title: CONNECT_PROBLEM_WORDS.share_token_not_expirable },
    });
  });

  it('needs connect-share-tokens:write and a share token id', async () => {
    as(['connect-share-tokens:read']);
    expect(
      await expireShareTokenAction(null, formOf({ 'share-token-id': SHARE_TOKEN_ID })),
    ).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });

    as();
    expect(
      await expireShareTokenAction(null, formOf({ 'share-token-id': 'cnst_x' })),
    ).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/share-token-id' }] },
    });
    expect(posts()).toHaveLength(0);
  });
});

describe('redeem a share token (C234.1)', () => {
  beforeEach(() => {
    api.on('POST', REDEEM_PATH, 202, { data: shareToken('pending') });
  });

  it('clones an inquiry under a template, linked to an existing account', async () => {
    as();

    const result = await redeemShareTokenAction(
      null,
      formOf({
        'share-token-id': SHARE_TOKEN_ID,
        mode: 'clone',
        'inquiry-template-id': TEMPLATE,
        'account-link': 'existing',
        'account-id': ACCOUNT,
        'destination-consent-record-id': CONSENT,
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', REDEEM_PATH)?.body).toEqual({
      meta: {
        'inquiry-template-id': TEMPLATE,
        'account-id': ACCOUNT,
        'destination-consent-record-id': CONSENT,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/connect/share-tokens/${SHARE_TOKEN_ID}`);
  });

  it('clones a verification into an open inquiry, or creates an account by reference and type', async () => {
    as();

    await redeemShareTokenAction(
      null,
      formOf({
        'share-token-id': SHARE_TOKEN_ID,
        mode: 'clone',
        'inquiry-id': 'inq_01M5CN0000000000000011A620',
        'account-link': 'new',
        'auto-create-account-reference-id': 'synthetic-reference-1',
        'auto-create-account-type-id': 'acctp_01M5CN0000000000000011A640',
        'destination-consent-record-id': CONSENT,
      }),
    );

    expect(api.find('POST', REDEEM_PATH)?.body).toEqual({
      meta: {
        'inquiry-id': 'inq_01M5CN0000000000000011A620',
        'auto-create-account-reference-id': 'synthetic-reference-1',
        'auto-create-account-type-id': 'acctp_01M5CN0000000000000011A640',
        'destination-consent-record-id': CONSENT,
      },
    });
  });

  it('hydrates a destination with the field mappings, one per line', async () => {
    as();

    await redeemShareTokenAction(
      null,
      formOf({
        'share-token-id': SHARE_TOKEN_ID,
        mode: 'hydrate',
        'destination-id': 'acc_01M5CN0000000000000011A630',
        'field-mappings': 'name_first -> name.first\n\n  birthdate->birthdate  ',
        'account-link': 'existing',
        'account-id': ACCOUNT,
        'destination-consent-record-id': CONSENT,
      }),
    );

    expect(api.find('POST', REDEEM_PATH)?.body).toEqual({
      data: {
        type: 'connect/share-token',
        attributes: { 'destination-id': 'acc_01M5CN0000000000000011A630' },
      },
      meta: {
        'field-mappings': [
          { 'source-field-name': 'name_first', 'destination-field-name': 'name.first' },
          { 'source-field-name': 'birthdate', 'destination-field-name': 'birthdate' },
        ],
        'destination-consent-record-id': CONSENT,
      },
    });
  });

  it('refuses a missing consent record or a malformed mapping at its field, before calling anything', async () => {
    as();

    const result = await redeemShareTokenAction(
      null,
      formOf({
        'share-token-id': SHARE_TOKEN_ID,
        mode: 'hydrate',
        'destination-id': 'acc_01M5CN0000000000000011A630',
        'field-mappings': 'name_first name.first',
        'destination-consent-record-id': '',
      }),
    );

    expect(result.ok ? [] : (result.problem.errors ?? []).map((error) => error.pointer)).toEqual([
      '/meta/field-mappings/0',
      '/meta/destination-consent-record-id',
    ]);
    expect(posts()).toHaveLength(0);
  });

  it('says why a destination consent does not cover the share, in words', async () => {
    as();
    api.onProblem('POST', REDEEM_PATH, 422, undefined, {
      code: 'consent_required',
      reason: 'explicit_biometric',
    });

    const result = await redeemShareTokenAction(
      null,
      formOf({
        'share-token-id': SHARE_TOKEN_ID,
        mode: 'clone',
        'inquiry-template-id': TEMPLATE,
        'destination-consent-record-id': CONSENT,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: CONNECT_PROBLEM_WORDS.consent_required,
        detail: CONSENT_REQUIRED_REASON_WORDS.explicit_biometric,
      },
    });
  });

  it('needs connect-share-tokens:redeem', async () => {
    as(['connect-share-tokens:read', 'connect-share-tokens:write']);

    expect(
      await redeemShareTokenAction(
        null,
        formOf({
          'share-token-id': SHARE_TOKEN_ID,
          mode: 'clone',
          'destination-consent-record-id': CONSENT,
        }),
      ),
    ).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});
