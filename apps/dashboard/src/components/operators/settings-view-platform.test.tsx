import { DASHBOARD_SETTINGS_DEFAULTS, type DashboardSettings } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsView } from './settings-view';
import { settings } from './test-fixtures';

const current = (overrides: Partial<DashboardSettings> = {}) =>
  settings({ ...DASHBOARD_SETTINGS_DEFAULTS, ...overrides });

const show = (values: DashboardSettings, environment: 'sandbox' | 'production' = 'sandbox') =>
  render(<SettingsView settings={values} environment={environment} canPrivacy={false} />);

/** The definition a term of the view answers with. */
const valueOf = (scope: HTMLElement, term: string) => {
  const dt = within(scope).getByText(term, { selector: 'dt' });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement) || dd.tagName !== 'DD') {
    throw new Error(`No value beside “${term}”`);
  }
  return dd;
};

describe('the 9A and 9B settings in the read-only settings view (C174.6; K9-10)', () => {
  it('shows every setting the form edits, read-only, each with its words and units', () => {
    show(
      current({
        'allowed-embed-origins': ['https://shop.example.com', 'https://*.brand.example.org'],
        'allowed-redirect-origins': ['https://return.example.net'],
        'default-theme-set-id': 'thms_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
        'analytics-time-zone': 'Europe/Paris',
        'analytics-suppression-threshold': 20,
        'analytics-retention-months': 24,
        'analytics-settle-days': 7,
        'analytics-assignee-retention-months': 6,
        'api-key-age-warning-days': 180,
        'audit-log-retention-days': 365,
        'mail-sender-name': 'Synthetic Bank',
      }),
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    const embedding = screen.getByRole('region', { name: 'Embedding and redirects in Sandbox' });
    expect(
      within(valueOf(embedding, 'Allowed embed origins')).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(valueOf(embedding, 'Allowed embed origins')).toHaveTextContent(
      'https://shop.example.comhttps://*.brand.example.org',
    );
    expect(valueOf(embedding, 'Allowed redirect origins')).toHaveTextContent(
      'https://return.example.net',
    );
    expect(valueOf(embedding, 'Default theme set')).toHaveTextContent(
      'thms_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
    );
    expect(embedding).toHaveTextContent(/It does not stop a compromised allowed site/u);

    const analytics = screen.getByRole('region', { name: 'Analytics in Sandbox' });
    expect(valueOf(analytics, 'Reporting time zone')).toHaveTextContent('Europe/Paris');
    expect(valueOf(analytics, 'Suppression threshold')).toHaveTextContent(/^20(?!\d)/u);
    expect(valueOf(analytics, 'Suppression threshold')).toHaveTextContent(
      'Counts below it show as "fewer than" the threshold.',
    );
    expect(valueOf(analytics, 'Analytics retention')).toHaveTextContent('24 months');
    expect(valueOf(analytics, 'Settle window')).toHaveTextContent('7 days');
    expect(valueOf(analytics, 'Per-reviewer analytics retention')).toHaveTextContent('6 months');

    const keys = screen.getByRole('region', { name: 'Keys, audit log and mail in Sandbox' });
    expect(valueOf(keys, 'API key age warning')).toHaveTextContent('180 days');
    expect(valueOf(keys, 'Audit log retention')).toHaveTextContent('365 days');
    expect(valueOf(keys, 'Sender name')).toHaveTextContent('Synthetic Bank');
  });

  it('says what each empty or null value means, never a blank or a zero', () => {
    show(
      current({
        'allowed-embed-origins': [],
        'allowed-redirect-origins': null,
        'default-theme-set-id': null,
        'audit-log-retention-days': null,
        'mail-sender-name': null,
      }),
      'production',
    );

    const embedding = screen.getByRole('region', { name: 'Embedding and redirects in Production' });
    expect(valueOf(embedding, 'Allowed embed origins')).toHaveTextContent(
      'None: no site may frame the flow',
    );
    expect(valueOf(embedding, 'Allowed redirect origins')).toHaveTextContent(
      'The embed origins above',
    );
    expect(valueOf(embedding, 'Default theme set')).toHaveTextContent('None: the built-in look');
    const keys = screen.getByRole('region', { name: 'Keys, audit log and mail in Production' });
    expect(valueOf(keys, 'Audit log retention')).toHaveTextContent('Every entry is kept');
    expect(valueOf(keys, 'Sender name')).toHaveTextContent('The installation’s own');
  });

  it('says that the second-factor rule is organisation-wide', () => {
    show(current({ 'require-mfa': false }));

    const organization = screen.getByRole('region', { name: 'Organization' });
    expect(organization).toHaveTextContent(
      'An organisation setting: only an operator whose settings:write comes from an organisation-wide role can change it.',
    );
    expect(organization).toHaveTextContent(
      'This organisation does not require a second factor: an operator can sign in with a password alone.',
    );
  });

  it('shows nothing of a setting an older server does not report', () => {
    show(settings());

    expect(screen.queryByRole('region', { name: /^Embedding and redirects/u })).toBeNull();
    expect(screen.queryByRole('region', { name: /^Analytics in/u })).toBeNull();
    expect(screen.queryByRole('region', { name: /^Keys, audit log and mail/u })).toBeNull();
  });
});
