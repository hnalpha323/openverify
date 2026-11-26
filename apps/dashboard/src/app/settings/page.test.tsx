import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../components/operators/test-fixtures';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import SettingsError from './error';
import Loading from './loading';
import SettingsPage, { metadata } from './page';

vi.mock('./actions', () => ({ saveSettings: vi.fn() }));
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

function signedIn(
  permissions: readonly Permission[],
  environment: 'sandbox' | 'production' = 'sandbox',
): MockApi {
  return api.reply(200, meDocument({ permissions, environment: ENVIRONMENTS[environment] }));
}

async function renderPage() {
  render(<ToastProvider>{await SettingsPage()}</ToastProvider>);
}

describe('settings page', () => {
  it('edits the settings with settings:write', async () => {
    signedIn([...PERMISSIONS]).reply(200, settings({ 'require-mfa': true }));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Require a second factor' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Retention in Sandbox' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Face matching in Sandbox' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeVisible();
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/settings' });
  });

  it('names production as the environment whose retention is shown', async () => {
    signedIn([...PERMISSIONS], 'production').reply(200, settings());

    await renderPage();

    expect(screen.getByRole('group', { name: 'Retention in Production' })).toBeVisible();
  });

  it('binds the form to the environment it shows, so a switch in another tab saves nothing (Workflow 2D F002)', async () => {
    signedIn([...PERMISSIONS], 'production').reply(200, settings());

    await renderPage();

    expect(
      new FormData(
        screen.getByRole('button', { name: 'Save settings' }).closest('form') ?? undefined,
      ).get('environment-id'),
    ).toBe(ENVIRONMENTS.production.id);
  });

  it('shows the settings read-only with settings:read alone', async () => {
    signedIn(['settings:read']).reply(200, settings({ 'api-log-retention-days': 14 }));

    await renderPage();

    const organization = within(screen.getByRole('region', { name: 'Organization' }));
    expect(organization.getByText('Require a second factor')).toBeVisible();
    expect(organization.getByText('No')).toBeVisible();
    const retention = within(screen.getByRole('region', { name: 'Retention in Sandbox' }));
    expect(retention.getByText('Kept until redacted')).toBeVisible();
    expect(retention.getByText('14 days')).toBeVisible();
    expect(retention.getByText('90 days')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the face matching settings read-only with settings:read alone (C42.4, C42.6, C47)', async () => {
    signedIn(['settings:read']).reply(
      200,
      settings({ 'face-template-retention-days': 90, 'face-search-max-templates': 1000 }),
    );

    await renderPage();

    const face = screen.getByRole('region', { name: 'Face matching in Sandbox' });
    expect(within(face).getByText('Face template retention').nextElementSibling).toHaveTextContent(
      '90 days',
    );
    expect(
      within(face).getByText('Templates searched per selfie').nextElementSibling,
    ).toHaveTextContent('1,000 templates');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('says when an older server does not report the face matching settings', async () => {
    const older = settings();
    delete older['face-template-retention-days'];
    delete older['face-search-max-templates'];
    signedIn(['settings:read']).reply(200, older);

    await renderPage();

    expect(
      within(screen.getByRole('region', { name: 'Face matching in Sandbox' })).getAllByText(
        'Not reported',
      ),
    ).toHaveLength(2);
  });

  it('shows the text message budget and when it last tripped, read-only with settings:read alone (C55.7)', async () => {
    signedIn(['settings:read']).reply(
      200,
      settings({
        'otp-sms-max-per-hour': 150,
        'otp-sms-budget-tripped-at': '2026-10-20T04:35:00.000Z',
      }),
    );

    await renderPage();

    const budget = screen.getByRole('region', { name: 'Text message codes in Sandbox' });
    expect(within(budget).getByText('Text messages per hour').nextElementSibling).toHaveTextContent(
      '150 text messages',
    );
    expect(
      within(budget)
        .getByText('Budget last tripped (UTC)')
        .nextElementSibling?.querySelector('time'),
    ).toHaveAttribute('datetime', '2026-10-20T04:35:00.000Z');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('says the budget never tripped, and when an older server does not report it (C55.7)', async () => {
    signedIn(['settings:read']).reply(
      200,
      settings({ 'otp-sms-max-per-hour': 200, 'otp-sms-budget-tripped-at': null }),
    );
    const { unmount } = render(<ToastProvider>{await SettingsPage()}</ToastProvider>);
    const budget = screen.getByRole('region', { name: 'Text message codes in Sandbox' });
    expect(
      within(budget).getByText('Budget last tripped (UTC)').nextElementSibling,
    ).toHaveTextContent(/^Never$/);
    unmount();

    signedIn(['settings:read']).reply(200, settings());
    await renderPage();
    expect(
      within(screen.getByRole('region', { name: 'Text message codes in Sandbox' })).getAllByText(
        'Not reported',
      ),
    ).toHaveLength(2);
  });

  it('offers the budget field to a role that may change the settings (C55.7)', async () => {
    signedIn([...PERMISSIONS]).reply(200, settings({ 'otp-sms-max-per-hour': 150 }));

    await renderPage();

    expect(
      within(screen.getByRole('group', { name: 'Text message codes in Sandbox' })).getByLabelText(
        'Text messages per hour',
      ),
    ).toHaveValue(150);
  });

  it('shows the forbidden panel without settings:read', async () => {
    signedIn(['users:read']);

    await renderPage();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Settings');
  });
});

describe('settings loading and error states', () => {
  it('announces that the settings are loading', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the settings…');
  });

  it('explains a failure and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<SettingsError error={new Error('internal')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The settings could not be loaded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('settings page: report retention (C73.6, C86)', () => {
  it('shows the report retention read-only with settings:read alone', async () => {
    signedIn(['settings:read']).reply(200, settings({ 'report-retention-days': null }));

    await renderPage();

    const retention = screen.getByRole('region', { name: 'Retention in Sandbox' });
    const reports = within(retention).getByText('Reports', { selector: 'dt' });
    expect(reports.nextElementSibling).toHaveTextContent('Kept as long as their inquiries');
  });

  it('shows a set report retention in days, and offers the field to a role that may change it', async () => {
    signedIn([...PERMISSIONS]).reply(200, settings({ 'report-retention-days': 730 }));

    await renderPage();

    expect(screen.getByRole('spinbutton', { name: 'Reports (days)' })).toHaveValue(730);
  });
});
