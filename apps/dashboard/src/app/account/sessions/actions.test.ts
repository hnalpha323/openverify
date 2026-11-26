// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { SETTINGS_IDS } from '../../../testing/routes/settings';
import { revokeOtherSessions, revokeSession } from './actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  vi.mocked(revalidatePath).mockReset();
});

afterEach(() => {
  api.restore();
});

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

describe('the sessions actions (C168.4)', () => {
  it('signs out one session by id', async () => {
    api.reply(200, meDocument({ permissions: [] })).reply(204);

    await expect(
      revokeSession(null, form({ 'session-id': SETTINGS_IDS.otherSession })),
    ).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/sessions/${SETTINGS_IDS.otherSession}/revoke`,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/account/sessions');
  });

  it('refuses a malformed session id without calling the API', async () => {
    api.reply(200, meDocument({ permissions: [] }));

    await expect(revokeSession(null, form({ 'session-id': 'x' }))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/session-id' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('signs out every other session and answers how many ended', async () => {
    api.reply(200, meDocument({ permissions: [] })).reply(200, { meta: { revoked: 3 } });

    await expect(revokeOtherSessions()).resolves.toEqual({ ok: true, data: 3 });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/sessions/revoke-others',
    });
  });
});
