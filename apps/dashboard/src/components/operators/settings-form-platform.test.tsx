import { DASHBOARD_SETTINGS_DEFAULTS, type DashboardSettings } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toasts';
import { SettingsForm } from './settings-form';
import { settings } from './test-fixtures';

const current = (overrides: Partial<DashboardSettings> = {}) =>
  settings({ ...DASHBOARD_SETTINGS_DEFAULTS, ...overrides });

const show = (
  values: DashboardSettings,
  canPrivacy: boolean,
  environment: 'sandbox' | 'production' = 'sandbox',
) =>
  render(
    <ToastProvider>
      <SettingsForm
        settings={values}
        environment={environment}
        environmentId="env_01J9ZK3M5Q7R8S9T0V1W2X3Y51"
        canPrivacy={canPrivacy}
        action={vi.fn()}
      />
    </ToastProvider>,
  );

describe('the 9A and 9B settings of the settings form (C174.6)', () => {
  it('shows the origins one per line, the analytics, key, audit and sender settings with their values', () => {
    show(
      current({
        'allowed-embed-origins': ['https://shop.example.com', 'https://*.brand.example.org'],
        'allowed-redirect-origins': null,
        'analytics-time-zone': 'Europe/Paris',
        'audit-log-retention-days': 365,
        'mail-sender-name': 'Synthetic Bank',
      }),
      false,
    );

    const embedding = screen.getByRole('group', { name: 'Embedding and redirects in Sandbox' });
    expect(within(embedding).getByRole('textbox', { name: 'Allowed embed origins' })).toHaveValue(
      'https://shop.example.com\nhttps://*.brand.example.org',
    );
    expect(
      within(embedding).getByRole('checkbox', { name: 'Use a redirect list of its own' }),
    ).not.toBeChecked();
    expect(embedding).toHaveTextContent(
      'An allowlist decides which sites may frame the flow and where it may send a person back afterwards. It does not stop a compromised allowed site, a copy of the hosted page on another domain, or a browser that ignores Content Security Policy.',
    );
    expect(
      within(embedding).queryByRole('checkbox', { name: /wildcard origins in production/u }),
    ).toBeNull();
    const analytics = screen.getByRole('group', { name: 'Analytics in Sandbox' });
    expect(within(analytics).getByRole('combobox', { name: 'Reporting time zone' })).toHaveValue(
      'Europe/Paris',
    );
    expect(
      within(analytics).getByRole('spinbutton', { name: 'Suppression threshold' }),
    ).toHaveAttribute('min', '11');
    const keys = screen.getByRole('group', { name: 'Keys, audit log and mail in Sandbox' });
    expect(
      within(keys).getByRole('spinbutton', { name: 'Audit log retention (days)' }),
    ).toHaveValue(365);
    expect(within(keys).getByRole('textbox', { name: 'Sender name' })).toHaveValue(
      'Synthetic Bank',
    );
  });

  it('asks for the wildcard acknowledgement in production', () => {
    show(current(), false, 'production');

    expect(
      screen.getByRole('checkbox', { name: 'I accept wildcard origins in production' }),
    ).not.toBeChecked();
  });

  it('says the organisation setting is changed only with an organisation-wide settings:write, and when MFA is not required', () => {
    show(current({ 'require-mfa': false }), false);

    const organization = screen.getByRole('group', { name: 'Organization' });
    expect(organization).toHaveTextContent(
      'An organisation setting: only an operator whose settings:write comes from an organisation-wide role can change it.',
    );
    expect(organization).toHaveTextContent(
      'This organisation does not require a second factor: an operator can sign in with a password alone.',
    );
  });

  it('shows nothing of the 9A and 9B settings this server does not report', () => {
    show(settings(), false);

    expect(screen.queryByRole('group', { name: 'Embedding and redirects in Sandbox' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Analytics in Sandbox' })).toBeNull();
  });
});
