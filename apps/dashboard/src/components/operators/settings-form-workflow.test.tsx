import { DASHBOARD_SETTINGS_DEFAULTS, type DashboardSettings } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toasts';
import { SettingsForm } from './settings-form';
import { settings } from './test-fixtures';

const current = (overrides: Partial<DashboardSettings> = {}) =>
  settings({ ...DASHBOARD_SETTINGS_DEFAULTS, ...overrides });

const show = (values: DashboardSettings, canPrivacy: boolean) =>
  render(
    <ToastProvider>
      <SettingsForm
        settings={values}
        environment="sandbox"
        environmentId="env_01J9ZK3M5Q7R8S9T0V1W2X3Y51"
        canPrivacy={canPrivacy}
        action={vi.fn()}
      />
    </ToastProvider>,
  );

describe('the workflow settings of the settings form (C143.7)', () => {
  it('shows each workflow setting with its current value, lists one entry per line', () => {
    show(
      current({
        'workflow-run-retention-days': 45,
        'workflow-http-ports': [8443, 9443],
        'workflow-link-hosts': ['help.example.com'],
        'workflow-http-hosts': null,
        'workflow-sms-countries': ['GB', 'IE'],
      }),
      true,
    );

    const group = screen.getByRole('group', { name: 'Workflows in Sandbox' });
    expect(within(group).getByRole('spinbutton', { name: /Run values \(days\)/ })).toHaveValue(45);
    expect(within(group).getByRole('textbox', { name: /Extra HTTPS ports/ })).toHaveValue(
      '8443\n9443',
    );
    expect(within(group).getByRole('textbox', { name: /Link hosts/ })).toHaveValue(
      'help.example.com',
    );
    expect(
      within(group).getByRole('checkbox', { name: /Allow HTTPS steps only to listed hosts/ }),
    ).not.toBeChecked();
    expect(
      within(group).getByRole('checkbox', { name: /Choose the SMS countries here/ }),
    ).toBeChecked();
    expect(within(group).getByRole('textbox', { name: /SMS countries/ })).toHaveValue('GB\nIE');
    expect(within(group).getByRole('textbox', { name: /Private networks/ })).toBeVisible();
  });

  it('shows the private networks read-only without settings:privacy, and posts nothing for them', () => {
    show(current({ 'workflow-http-private-cidrs': ['10.20.0.0/16'] }), false);

    const group = screen.getByRole('group', { name: 'Workflows in Sandbox' });
    expect(within(group).queryByRole('textbox', { name: /Private networks/ })).toBeNull();
    expect(group).toHaveTextContent(
      'Private networks: 10.20.0.0/16 (needs settings:privacy to change)',
    );
  });

  it('shows nothing of a setting this server does not report', () => {
    show(settings(), true);

    expect(screen.queryByRole('group', { name: 'Workflows in Sandbox' })).toBeNull();
  });
});
