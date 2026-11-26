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
const writer = () => meDocument({ permissions: ['settings:read', 'settings:write'] });
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

describe('saveSettings: the workflow settings (C143.7)', () => {
  it('changes nothing when every workflow setting equals the current one', async () => {
    api.reply(200, admin()).reply(200, current());

    await expect(saveSettings(null, form())).resolves.toEqual({
      ok: true,
      data: { changed: false },
    });
    expect(api.requests).toHaveLength(2);
  });

  it('sends a changed window, cap and case retention, an empty case retention as null', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'case-retention-days': 400 }))
      .reply(200, current());

    await saveSettings(
      null,
      form({
        'workflow-run-retention-days': '60',
        'workflow-in-flight-cap': '80',
        'case-retention-days': '',
      }),
    );

    expect(api.last().body).toEqual({
      'workflow-run-retention-days': 60,
      'workflow-in-flight-cap': 80,
      'case-retention-days': null,
    });
  });

  it('sends a list typed one entry per line only when it changed, compared by value', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'workflow-link-hosts': ['help.example.com'] }))
      .reply(200, current());

    await saveSettings(
      null,
      form({
        'workflow-http-ports': '8443\n9443',
        'workflow-link-hosts': 'help.example.com',
        'workflow-email-recipients': 'ops@example.com\nexample.org',
        'workflow-sms-recipients': '+15555550100',
      }),
    );

    expect(api.last().body).toEqual({
      'workflow-http-ports': [8443, 9443],
      'workflow-email-recipients': ['ops@example.com', 'example.org'],
      'workflow-sms-recipients': ['+15555550100'],
    });
  });

  it('turns the host allowlist on with its hosts, and off as null; the SMS countries likewise', async () => {
    api
      .reply(200, admin())
      .reply(200, current({ 'workflow-sms-countries': ['GB'] }))
      .reply(200, current());

    await saveSettings(
      null,
      form({
        'workflow-http-hosts-on': 'true',
        'workflow-http-hosts': 'receiver.example.com',
        'workflow-sms-countries': 'GB',
      }),
    );

    expect(api.last().body).toEqual({
      'workflow-http-hosts': ['receiver.example.com'],
      'workflow-sms-countries': null,
    });
  });

  it('refuses a port that is not a whole number by its pointer, without saving', async () => {
    api.reply(200, admin());

    const result = await saveSettings(null, form({ 'workflow-http-ports': '8443\nhttps' }));

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/workflow-http-ports/1',
    ]);
    expect(api.requests).toHaveLength(1);
  });

  it('refuses a host the contract refuses by its pointer, without saving', async () => {
    api.reply(200, admin()).reply(200, current());

    const result = await saveSettings(
      null,
      form({ 'workflow-link-hosts': 'help.example.com\nhttps://Example.com/' }),
    );

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/workflow-link-hosts/1',
    ]);
    expect(api.requests).toHaveLength(2);
  });

  it('sends the private CIDRs with settings:privacy', async () => {
    api.reply(200, admin()).reply(200, current()).reply(200, current());

    await saveSettings(null, form({ 'workflow-http-private-cidrs': '10.20.0.0/16' }));

    expect(api.last().body).toEqual({ 'workflow-http-private-cidrs': ['10.20.0.0/16'] });
  });

  it('never posts the private CIDRs for a principal without settings:privacy, even if sent', async () => {
    api
      .reply(200, writer())
      .reply(200, current())
      .reply(200, current({ 'workflow-in-flight-cap': 70 }));

    await saveSettings(
      null,
      form(
        { 'workflow-in-flight-cap': '70', 'workflow-http-private-cidrs': '10.20.0.0/16' },
        false,
      ),
    );

    expect(api.last().body).toEqual({ 'workflow-in-flight-cap': 70 });
  });

  it('sends no workflow setting the form did not post (an older server)', async () => {
    api.reply(200, admin()).reply(200, current());

    const values = Object.fromEntries(
      [
        'workflow-run-retention-days',
        'workflow-run-history-retention-days',
        'workflow-in-flight-cap',
        'workflow-http-ports',
        'workflow-http-hosts-shown',
        'workflow-http-hosts',
        'workflow-email-recipients',
        'workflow-sms-recipients',
        'workflow-sms-countries-shown',
        'workflow-sms-countries',
        'workflow-link-hosts',
        'case-retention-days',
        'workflow-http-private-cidrs',
      ].map((name) => [name, '<absent>']),
    );

    await expect(saveSettings(null, form(values))).resolves.toEqual({
      ok: true,
      data: { changed: false },
    });
  });
});
