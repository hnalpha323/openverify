// @vitest-environment node
import { DASHBOARD_SETTINGS_DEFAULTS, type DashboardSettings } from '@openverify/contracts';
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

/** The form as the settings page posts it, every value at the API's defaults unless given. */
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
    'workflow-run-retention-days': '30',
    'workflow-run-history-retention-days': '365',
    'workflow-in-flight-cap': '50',
    'workflow-http-ports': '',
    'workflow-http-hosts-shown': 'true',
    'workflow-http-hosts': '',
    'workflow-email-recipients': '',
    'workflow-sms-recipients': '',
    'workflow-sms-countries-shown': 'true',
    'workflow-sms-countries': '',
    'workflow-link-hosts': '',
    'case-retention-days': '',
    'allowed-embed-origins': '',
    'allowed-redirect-origins-shown': 'true',
    'analytics-time-zone': 'UTC',
    'analytics-suppression-threshold': '11',
    'analytics-retention-months': '13',
    'analytics-settle-days': '30',
    'analytics-assignee-retention-months': '13',
    'api-key-age-warning-days': '90',
    'audit-log-retention-days': '',
    'mail-sender-name': '',
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
          'workflow-http-private-cidrs': '',
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

describe('saveSettings: the 9A and 9B settings (C174.6, C158.1, C158.4)', () => {
  it('changes nothing when every platform setting equals the current one', async () => {
    api.reply(200, admin()).reply(200, current());

    await expect(saveSettings(null, form())).resolves.toEqual({
      ok: true,
      data: { changed: false },
    });
    expect(api.requests).toHaveLength(2);
  });

  it('sends the embed origins one per line and the redirect origins of their own, only as changed', async () => {
    api.reply(200, admin()).reply(200, current()).reply(200, current());

    await saveSettings(
      null,
      form({
        'allowed-embed-origins': ' https://shop.example.com \n\nhttps://*.brand.example.org:8443',
        'allowed-redirect-origins-own': 'true',
        'allowed-redirect-origins': 'https://shop.example.com',
      }),
    );

    expect(api.last()).toMatchObject({ method: 'PATCH', path: '/api/v1/dashboard/settings' });
    expect(api.last().body).toEqual({
      'allowed-embed-origins': ['https://shop.example.com', 'https://*.brand.example.org:8443'],
      'allowed-redirect-origins': ['https://shop.example.com'],
    });
  });

  it('sends the redirect origins as null (the embed origins) when their box is unticked', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'allowed-redirect-origins': ['https://shop.example.com'] }))
      .reply(200, current());

    await saveSettings(null, form());

    expect(api.last().body).toEqual({ 'allowed-redirect-origins': null });
  });

  it('acknowledges production wildcards only when the box is ticked and an origin changed', async () => {
    api.reply(200, admin()).reply(200, current()).reply(200, current());

    await saveSettings(
      null,
      form({
        'allowed-embed-origins': 'https://*.brand.example.org',
        'acknowledge-wildcards': 'true',
      }),
    );

    expect(api.last().body).toEqual({
      'allowed-embed-origins': ['https://*.brand.example.org'],
      meta: { 'acknowledge-wildcards': true },
    });
  });

  it('sends changed analytics, key, audit and sender settings, empty ones as null', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'audit-log-retention-days': 365, 'mail-sender-name': 'Old name' }))
      .reply(200, current());

    await saveSettings(
      null,
      form({
        'analytics-time-zone': ' Europe/Paris ',
        'analytics-suppression-threshold': '20',
        'analytics-retention-months': '24',
        'analytics-settle-days': '7',
        'analytics-assignee-retention-months': '6',
        'api-key-age-warning-days': '30',
        'audit-log-retention-days': '',
        'mail-sender-name': ' ',
      }),
    );

    expect(api.last().body).toEqual({
      'analytics-time-zone': 'Europe/Paris',
      'analytics-suppression-threshold': 20,
      'analytics-retention-months': 24,
      'analytics-settle-days': 7,
      'analytics-assignee-retention-months': 6,
      'api-key-age-warning-days': 30,
      'audit-log-retention-days': null,
      'mail-sender-name': null,
    });
  });

  it.each([
    [
      'analytics-suppression-threshold',
      '10',
      'Enter a whole number from 11 to 100. The floor of 11 is never lowered.',
    ],
    ['analytics-retention-months', '12', 'Enter a whole number of months from 13 to 60.'],
    ['analytics-settle-days', '91', 'Enter a whole number of days from 1 to 90.'],
    ['analytics-assignee-retention-months', '0', 'Enter a whole number of months from 1 to 60.'],
    ['api-key-age-warning-days', '3651', 'Enter a whole number of days from 1 to 3,650.'],
    [
      'audit-log-retention-days',
      '29',
      'Enter a whole number of days from 30 to 3,650, or leave it empty to keep every entry.',
    ],
    [
      'analytics-time-zone',
      '+05:30',
      'Enter an IANA time zone name, such as Europe/Paris or UTC; offsets are refused.',
    ],
    [
      'mail-sender-name',
      'Bank <alerts@bank.example>',
      'Enter a display name of up to 100 characters, without control characters, <, >, @ or ".',
    ],
  ])('refuses %s %j at its field without calling the API', async (name, value, detail) => {
    api.reply(200, admin());

    await expect(saveSettings(null, form({ [name]: value }))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: `/${name}`, detail }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('posts none of them when this server does not report them', async () => {
    api.reply(200, admin()).reply(200, current()).reply(200, current());
    const data = form({ 'inquiry-retention-days': '30' });
    for (const name of [
      'allowed-embed-origins',
      'allowed-redirect-origins-shown',
      'analytics-time-zone',
      'analytics-suppression-threshold',
      'analytics-retention-months',
      'analytics-settle-days',
      'analytics-assignee-retention-months',
      'api-key-age-warning-days',
      'audit-log-retention-days',
      'mail-sender-name',
    ]) {
      data.delete(name);
    }

    await saveSettings(null, data);

    expect(api.last().body).toEqual({ 'inquiry-retention-days': 30 });
  });

  it('says the production wildcard refusal in words', async () => {
    api
      .reply(200, admin())
      .reply(200, current())
      .replyProblem(422, undefined, {
        code: 'embed_wildcard_unacknowledged',
        errors: [
          {
            pointer: '/allowed-embed-origins/0',
            detail: 'A production wildcard needs meta.acknowledge-wildcards.',
          },
        ],
      });

    await expect(
      saveSettings(null, form({ 'allowed-embed-origins': 'https://*.brand.example.org' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        title:
          'A wildcard origin in production needs your acknowledgement: tick “I accept wildcard origins in production” and save again.',
      },
    });
  });

  it('keeps the origin refusals at each entry’s position', async () => {
    api
      .reply(200, admin())
      .reply(200, current())
      .replyProblem(422, undefined, {
        code: 'embed_origin_invalid',
        errors: [
          {
            pointer: '/allowed-embed-origins/1',
            detail: 'A wildcard may not cover a shared-hosting suffix.',
          },
        ],
      });

    await expect(
      saveSettings(
        null,
        form({ 'allowed-embed-origins': 'https://shop.example.com\nhttps://*.vercel.app' }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        title: 'An origin is not allowed. Each refused entry is named at its field.',
        errors: [
          {
            pointer: '/allowed-embed-origins/1',
            detail: 'A wildcard may not cover a shared-hosting suffix.',
          },
        ],
      },
    });
  });
});
