// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { single } from '../../testing/lifecycle-fixtures';
import { SIGNAL_IDS as IDS, listMatch } from '../../testing/signals-fixtures';
import { dismissListMatch } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const DISMISS = `/list-matches/${IDS.match}/dismiss`;
const CASE = 'case_01JB0000000000000000000001';
let api: RouteApi;

const as = (...permissions: Permission[]) => {
  api.me({ permissions });
};

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as('inquiries:read', 'lists:read', 'lists:write');
  api.on(
    'POST',
    DISMISS,
    200,
    single(
      listMatch({
        status: 'dismissed',
        'dismissed-at': '2026-10-20T05:00:00.000Z',
        reason: 'Synthetic',
      }),
    ),
  );
});

afterEach(() => {
  api.restore();
});

describe('dismissListMatch (C99.3, C108)', () => {
  it('posts the reason and refreshes the page it came from', async () => {
    const result = await dismissListMatch(
      null,
      form({
        'list-match-id': IDS.match,
        reason: 'Synthetic: a shared office',
        'inquiry-id': IDS.inquiry,
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', DISMISS)?.body).toEqual({
      data: { attributes: { reason: 'Synthetic: a shared office' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${IDS.inquiry}`);
  });

  it('refreshes the account page for a dismissal made there', async () => {
    await dismissListMatch(
      null,
      form({ 'list-match-id': IDS.match, reason: 'Synthetic', 'account-id': IDS.account }),
    );

    expect(revalidatePath).toHaveBeenCalledWith(`/accounts/${IDS.account}`);
  });

  it('refreshes the case page for a dismissal made there, as well as the inquiry page (K8-39)', async () => {
    const result = await dismissListMatch(
      null,
      form({
        'list-match-id': IDS.match,
        reason: 'Synthetic',
        'inquiry-id': IDS.inquiry,
        'case-id': CASE,
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toEqual([
      `/inquiries/${IDS.inquiry}`,
      `/cases/${CASE}`,
    ]);
  });

  it.each([['../settings'], ['/settings'], ['inq_01JB0000000000000000000001']])(
    'refuses a case id %s that is not a case’s, revalidating nothing and never calling the API (K8-39)',
    async (caseId) => {
      const result = await dismissListMatch(
        null,
        form({ 'list-match-id': IDS.match, reason: 'Synthetic', 'case-id': caseId }),
      );

      expect(result.ok).toBe(false);
      expect(api.find('POST', DISMISS)).toBeUndefined();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('requires a reason, on its field, without calling the API', async () => {
    const result = await dismissListMatch(null, form({ 'list-match-id': IDS.match, reason: ' ' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/reason' }] },
    });
    expect(api.find('POST', DISMISS)).toBeUndefined();
  });

  it('says a match dismissed already in words (409 list_match_not_open)', async () => {
    api.onProblem('POST', DISMISS, 409, undefined, { code: 'list_match_not_open' });

    const result = await dismissListMatch(
      null,
      form({ 'list-match-id': IDS.match, reason: 'Synthetic' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { title: 'This list match is no longer open: it was dismissed already.' },
    });
  });

  it('needs lists:write', async () => {
    as('inquiries:read', 'lists:read');

    const result = await dismissListMatch(
      null,
      form({ 'list-match-id': IDS.match, reason: 'Synthetic' }),
    );

    expect(result).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.find('POST', DISMISS)).toBeUndefined();
  });
});
