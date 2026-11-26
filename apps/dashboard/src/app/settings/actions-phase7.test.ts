// @vitest-environment node
import {
  DASHBOARD_SETTINGS_DEFAULTS,
  DEVICE_RETENTION_DAYS,
  GRAPH_QUERY_RETENTION_DAYS,
  type DashboardSettings,
} from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { saveSettings } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
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

const admin = () => meDocument({ permissions: [...PERMISSIONS] });
const current = (overrides: Partial<DashboardSettings> = {}) =>
  settings({ ...DASHBOARD_SETTINGS_DEFAULTS, ...overrides });

/**
 * The form as the settings page posts it for a principal with `settings:privacy` (`privacy`) or
 * without: every value at the API's defaults unless given.
 */
function form(values: Record<string, string> = {}, privacy = true): FormData {
  const data = new FormData();
  data.set('environment-id', ENVIRONMENTS.sandbox.id);
  const fields: Record<string, string> = {
    'inquiry-retention-days': '',
    'api-log-retention-days': '30',
    'webhook-delivery-retention-days': '30',
    'event-retention-days': '90',
    'face-template-retention-days': '365',
    'face-search-max-templates': '50000',
    'report-retention-days': '',
    'expose-signals-shown': 'true',
    'expose-signals': 'true',
    'signal-component-retention-days': '30',
    'ip-retention-days': '',
    'device-retention-days': '365',
    'organization-display-name': '',
    'transaction-retention-days': '',
    'graph-query-retention-days': '30',
    ...(privacy
      ? {
          'signal-collection.session-integrity': 'on',
          'signal-collection.device-recognition': 'off',
          'signal-collection.device-recognition-basis': '',
          'biometric-lists-basis': '',
          'graph-indexing-shown': 'true',
          'graph-indexing': 'true',
          'graph-weak-kinds-shown': 'true',
          'graph-components-shown': 'true',
        }
      : {}),
    ...values,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (value !== '<absent>') {
      data.set(name, value);
    }
  }
  return data;
}

describe('saveSettings: the Phase 7 settings (C90.8, C91.7, C97.4, C101, C107.7)', () => {
  it('changes nothing, signal-collection included, when every value equals the current one', async () => {
    api.reply(200, admin()).reply(200, current());

    await expect(saveSettings(null, form())).resolves.toEqual({
      ok: true,
      data: { changed: false },
    });
    expect(api.requests).toHaveLength(2);
  });

  it('compares signal-collection by value, whatever the order of its members', async () => {
    api.reply(200, admin()).reply(
      200,
      current({
        'signal-collection': {
          'device-recognition-basis': null,
          'device-recognition': 'off',
          'session-integrity': 'on',
        },
      }),
    );

    await expect(saveSettings(null, form())).resolves.toEqual({
      ok: true,
      data: { changed: false },
    });
  });

  it('never posts a privacy member for a principal without settings:privacy', async () => {
    api
      .reply(200, meDocument({ permissions: ['settings:read', 'settings:write'] }))
      .reply(200, current())
      .reply(200, current({ 'device-retention-days': 90 }));

    await saveSettings(null, form({ 'device-retention-days': '90' }, false));

    expect(api.last().body).toEqual({ 'device-retention-days': 90 });
  });

  it('sends a changed collection tier whole, an empty basis as null', async () => {
    api.reply(200, admin()).reply(200, current()).reply(200, current());

    await saveSettings(
      null,
      form({
        'signal-collection.device-recognition': 'consent',
        'signal-collection.session-integrity': 'off',
      }),
    );

    expect(api.last().body).toEqual({
      'signal-collection': {
        'session-integrity': 'off',
        'device-recognition': 'consent',
        'device-recognition-basis': null,
      },
    });
  });

  it('passes exempt without a basis to the API, whose 422 lands on the basis field', async () => {
    api
      .reply(200, admin())
      .reply(200, current())
      .replyProblem(422, undefined, {
        code: 'basis_required',
        errors: [
          {
            location: 'body',
            pointer: '/signal-collection/device-recognition-basis',
            detail: 'basis_required',
          },
        ],
      });

    const result = await saveSettings(
      null,
      form({ 'signal-collection.device-recognition': 'exempt' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: 'Exempt device recognition needs a recorded basis.',
        errors: [{ pointer: '/signal-collection/device-recognition-basis' }],
      },
    });
  });

  it('sends a cleared biometric basis as null, and a new one trimmed', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'biometric-lists-basis': 'Synthetic basis' }))
      .reply(200, current());

    await saveSettings(null, form({ 'biometric-lists-basis': '   ' }));

    expect(api.last().body).toEqual({ 'biometric-lists-basis': null });
  });

  it('refuses a basis over 500 characters on its field, without calling the API', async () => {
    api.reply(200, admin());

    const result = await saveSettings(null, form({ 'biometric-lists-basis': 'x'.repeat(501) }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/biometric-lists-basis' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('sends the display name, empty as null, and refuses one over 100 characters', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'organization-display-name': 'Example Org' }))
      .reply(200, current());

    await saveSettings(null, form({ 'organization-display-name': '' }));
    expect(api.last().body).toEqual({ 'organization-display-name': null });

    api.reply(200, admin());
    const result = await saveSettings(null, form({ 'organization-display-name': 'x'.repeat(101) }));
    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/organization-display-name' }] },
    });
  });

  it('sends the windows, empty ip and transaction retention as null (kept)', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'ip-retention-days': 30, 'transaction-retention-days': 365 }))
      .reply(200, current());

    await saveSettings(
      null,
      form({ 'signal-component-retention-days': '7', 'graph-query-retention-days': '60' }),
    );

    expect(api.last().body).toEqual({
      'signal-component-retention-days': 7,
      'ip-retention-days': null,
      'transaction-retention-days': null,
      'graph-query-retention-days': 60,
    });
  });

  it('refuses a window outside its contract range, on its field', async () => {
    api.reply(200, admin());

    const result = await saveSettings(
      null,
      form({ 'device-retention-days': String(DEVICE_RETENTION_DAYS.max + 1) }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/device-retention-days',
            detail: `Enter a whole number of days from ${String(DEVICE_RETENTION_DAYS.min)} to ${DEVICE_RETENTION_DAYS.max.toLocaleString('en-US')}.`,
          },
        ],
      },
    });
  });

  it('reads an unchecked shown box as off, for exposure and the graph switches', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'graph-weak-kinds': true }))
      .reply(200, current());

    await saveSettings(
      null,
      form({
        'expose-signals': '<absent>',
        'graph-indexing': '<absent>',
        'graph-components': 'true',
        'graph-query-retention-days': String(GRAPH_QUERY_RETENTION_DAYS.default),
      }),
    );

    expect(api.last().body).toEqual({
      'expose-signals': false,
      'graph-indexing': false,
      'graph-weak-kinds': false,
      'graph-components': true,
    });
  });
});
