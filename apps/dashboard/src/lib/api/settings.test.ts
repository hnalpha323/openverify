// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../components/operators/test-fixtures';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import { getSettings, updateSettings } from './settings';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the settings API (C15, C16)', () => {
  it("reads the organization's require-mfa and the environment's retention", async () => {
    api.reply(200, settings({ 'inquiry-retention-days': 365 }));

    await expect(getSettings()).resolves.toEqual(settings({ 'inquiry-retention-days': 365 }));
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/settings' });
  });

  it('changes only the settings it is given, and answers with all of them', async () => {
    api.reply(200, settings({ 'require-mfa': true }));

    await expect(updateSettings({ 'require-mfa': true })).resolves.toEqual(
      settings({ 'require-mfa': true }),
    );
    expect(api.last()).toMatchObject({
      method: 'PATCH',
      path: '/api/v1/dashboard/settings',
      body: { 'require-mfa': true },
    });
  });
});
