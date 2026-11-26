import {
  DASHBOARD_SETTINGS_DEFAULTS,
  DEVICE_RETENTION_DAYS,
  GRAPH_QUERY_RETENTION_DAYS,
  IP_RETENTION_DAYS,
  SIGNAL_COMPONENT_RETENTION_DAYS,
  TRANSACTION_RETENTION_DAYS,
  type DashboardSettings,
} from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { ToastProvider } from '../toasts';
import { SettingsForm, type SettingsSaved } from './settings-form';
import { settings } from './test-fixtures';

type Save = (
  state: ActionState<SettingsSaved>,
  formData: FormData,
) => Promise<ActionResult<SettingsSaved>>;

const saved = () => vi.fn<Save>(() => Promise.resolve({ ok: true, data: { changed: true } }));

/** Every Phase 7 setting as a Workflow 7B server serves it. */
const phase7 = (overrides: Partial<DashboardSettings> = {}) =>
  settings({ ...DASHBOARD_SETTINGS_DEFAULTS, ...overrides });

function renderForm(
  save: Save,
  {
    canPrivacy = true,
    values = phase7(),
    environment = 'sandbox',
  }: {
    canPrivacy?: boolean;
    values?: DashboardSettings;
    environment?: 'sandbox' | 'production';
  } = {},
) {
  render(
    <ToastProvider>
      <SettingsForm
        settings={values}
        environment={environment}
        environmentId={ENVIRONMENTS[environment].id}
        canPrivacy={canPrivacy}
        action={save}
      />
    </ToastProvider>,
  );
}

const group = (name: string) => screen.getByRole('group', { name });

describe('SettingsForm: signals (C90.8, C91.7, C107.7)', () => {
  it('shows the collection tiers to a principal with settings:privacy', () => {
    renderForm(saved());

    const signals = group('Signals in Sandbox');
    expect(within(signals).getByRole('combobox', { name: 'Session integrity' })).toHaveValue('on');
    expect(within(signals).getByRole('combobox', { name: 'Device recognition' })).toHaveValue(
      'off',
    );
    expect(within(signals).getByRole('textbox', { name: /Device recognition basis/ })).toHaveValue(
      '',
    );
    expect(
      within(signals).getByRole('checkbox', { name: /Serve signals on the API/ }),
    ).toBeChecked();
  });

  it('bounds each window by its contract range, ip retention empty to keep addresses', () => {
    renderForm(saved());

    const signals = group('Signals in Sandbox');
    const components = within(signals).getByLabelText('Collector components (days)');
    expect(components).toHaveValue(SIGNAL_COMPONENT_RETENTION_DAYS.default);
    expect(components).toHaveAttribute('min', String(SIGNAL_COMPONENT_RETENTION_DAYS.min));
    expect(components).toHaveAttribute('max', String(SIGNAL_COMPONENT_RETENTION_DAYS.max));
    const addresses = within(signals).getByLabelText('IP addresses (days)');
    expect(addresses).toHaveValue(null);
    expect(addresses).toHaveAttribute('max', String(IP_RETENTION_DAYS.max));
    expect(addresses).toHaveAccessibleDescription(/empty/i);
    const devices = within(signals).getByLabelText('Devices (days)');
    expect(devices).toHaveValue(DEVICE_RETENTION_DAYS.default);
    expect(devices).toHaveAttribute('max', String(DEVICE_RETENTION_DAYS.max));
  });

  it('shows the collection tiers read-only without settings:privacy, and never posts them', async () => {
    const save = saved();
    renderForm(save, { canPrivacy: false });

    const signals = group('Signals in Sandbox');
    expect(within(signals).queryByRole('combobox')).toBeNull();
    expect(signals).toHaveTextContent('Session integrity');
    expect(signals).toHaveTextContent('On');
    expect(signals).toHaveTextContent(/settings:privacy/);
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const sent = save.mock.calls[0]?.[1];
    expect(sent?.has('signal-collection.session-integrity')).toBe(false);
    expect(sent?.has('biometric-lists-basis')).toBe(false);
    expect(sent?.has('graph-indexing-shown')).toBe(false);
    expect(sent?.get('expose-signals-shown')).toBe('true');
  });

  it('shows a refusal of exempt without a basis on the basis field', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Exempt device recognition needs a recorded basis.',
          detail: 'Synthetic.',
          code: 'basis_required',
          errors: [
            {
              pointer: '/signal-collection/device-recognition-basis',
              detail: 'Record the basis for exempt collection.',
            },
          ],
        },
      }),
    );
    renderForm(save);

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Device recognition' }),
      'exempt',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const basis = screen.getByRole('textbox', { name: /Device recognition basis/ });
    expect(await screen.findByText(/Record the basis for exempt collection/)).toBeVisible();
    expect(basis).toHaveAttribute('aria-invalid', 'true');
    expect(basis).toHaveAccessibleDescription(/Record the basis for exempt collection\./);
  });
});

describe('SettingsForm: the handoff display name (C96.1, C107.7)', () => {
  it('says the phone shows it and a handoff step needs it', () => {
    renderForm(saved(), { values: phase7({ 'organization-display-name': 'Example Org' }) });

    const name = screen.getByRole('textbox', { name: 'Organization display name' });
    expect(name).toHaveValue('Example Org');
    expect(name).toHaveAttribute('maxlength', '100');
    expect(name).toHaveAccessibleDescription(/phone/);
    expect(name).toHaveAccessibleDescription(/handoff step cannot be published without it/);
  });
});

describe('SettingsForm: the biometric lists basis (C97.4)', () => {
  it('asks before clearing it, saying it redacts every face and background list', async () => {
    const save = saved();
    renderForm(save, { values: phase7({ 'biometric-lists-basis': 'Synthetic basis' }) });

    await userEvent.clear(screen.getByRole('textbox', { name: /Biometric lists basis/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const dialog = screen.getByRole('dialog', { name: 'Clear the biometric lists basis?' });
    expect(dialog).toHaveAccessibleDescription(/redacts every face and background list/);
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear and save' }));

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[1].get('biometric-lists-basis')).toBe('');
  });

  it('saves a new basis without asking', async () => {
    const save = saved();
    renderForm(save);

    await userEvent.type(
      screen.getByRole('textbox', { name: /Biometric lists basis/ }),
      'Synthetic basis',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[1].get('biometric-lists-basis')).toBe('Synthetic basis');
  });

  it('shows the basis read-only without settings:privacy', () => {
    renderForm(saved(), {
      canPrivacy: false,
      values: phase7({ 'biometric-lists-basis': 'Synthetic basis' }),
    });

    expect(screen.queryByRole('textbox', { name: /Biometric lists basis/ })).toBeNull();
    expect(group('Lists in Sandbox')).toHaveTextContent('Synthetic basis');
  });
});

describe('SettingsForm: transactions and the graph (C101, C102.7, C105.5)', () => {
  it('shows the transaction retention, empty to keep them', () => {
    renderForm(saved());

    const retention = within(group('Transactions in Sandbox')).getByLabelText(
      'Transactions (days)',
    );
    expect(retention).toHaveValue(null);
    expect(retention).toHaveAttribute('max', String(TRANSACTION_RETENTION_DAYS.max));
  });

  it('shows the graph switches and the query retention, with their defaults', () => {
    renderForm(saved());

    const graph = group('Graph in Sandbox');
    expect(within(graph).getByRole('checkbox', { name: /Index the graph/ })).toBeChecked();
    expect(within(graph).getByRole('checkbox', { name: /Weak kinds/ })).not.toBeChecked();
    expect(within(graph).getByRole('checkbox', { name: /Components/ })).not.toBeChecked();
    expect(within(graph).getByLabelText('Graph query results (days)')).toHaveValue(
      GRAPH_QUERY_RETENTION_DAYS.default,
    );
  });

  it('shows the graph switches read-only without settings:privacy', () => {
    renderForm(saved(), { canPrivacy: false });

    const graph = group('Graph in Sandbox');
    expect(within(graph).queryByRole('checkbox')).toBeNull();
    expect(graph).toHaveTextContent('Index the graph');
    expect(within(graph).getByLabelText('Graph query results (days)')).toBeVisible();
  });
});

describe('SettingsForm: an older server', () => {
  it('asks for no Phase 7 setting a server does not report', () => {
    renderForm(saved(), { values: settings() });

    expect(screen.queryByRole('group', { name: 'Signals in Sandbox' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Organization display name' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Graph in Sandbox' })).toBeNull();
  });
});
