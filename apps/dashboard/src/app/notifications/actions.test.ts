// @vitest-environment node
import { USER_NOTIFICATION_KINDS } from '@openverify/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { preferences, preferencesDocument } from '../../testing/routes/settings';
import { saveNotificationPreferences } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('saveNotificationPreferences (C169.7)', () => {
  it('sends both channels of every kind, a ticked box meaning on and an unticked one off', async () => {
    const form = new FormData();
    form.set('webhook-failure.email', 'on');
    form.set('assigned.console', 'on');
    api
      .reply(200, meDocument({ permissions: [] }))
      .reply(200, preferencesDocument({ 'webhook-failure': { console: false, email: true } }));

    const result = await saveNotificationPreferences(null, form);

    expect(result.ok).toBe(true);
    const expected = Object.fromEntries(
      USER_NOTIFICATION_KINDS.map((kind) => [kind, { console: false, email: false }]),
    );
    expected['webhook-failure'] = { console: false, email: true };
    expected.assigned = { console: true, email: false };
    expect(api.last()).toMatchObject({
      method: 'PUT',
      path: '/api/v1/dashboard/notification-preferences',
      body: { data: { type: 'notification-preferences', attributes: { preferences: expected } } },
    });
    expect(result).toEqual({
      ok: true,
      data: preferences({ 'webhook-failure': { console: false, email: true } }),
    });
  });

  it('answers the API’s refusal as a problem', async () => {
    api.reply(200, meDocument({ permissions: [] })).replyProblem(400);

    const result = await saveNotificationPreferences(null, new FormData());

    expect(result.ok).toBe(false);
  });
});
