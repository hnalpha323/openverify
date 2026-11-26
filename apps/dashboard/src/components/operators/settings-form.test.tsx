import {
  FACE_SEARCH_MAX_TEMPLATES,
  FACE_TEMPLATE_RETENTION_DAYS,
  OTP_SMS_MAX_PER_HOUR,
  type DashboardSettings,
} from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { SettingsForm, type SettingsSaved } from './settings-form';
import { settings } from './test-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';

type Save = (
  state: ActionState<SettingsSaved>,
  formData: FormData,
) => Promise<ActionResult<SettingsSaved>>;

const saved = (changed = true) =>
  vi.fn<Save>(() => Promise.resolve({ ok: true, data: { changed } }));

function renderForm(save: Save, environment: 'sandbox' | 'production' = 'sandbox') {
  render(
    <ToastProvider>
      <SettingsForm
        settings={settings({ 'inquiry-retention-days': 365 })}
        environment={environment}
        environmentId={ENVIRONMENTS[environment].id}
        action={save}
      />
    </ToastProvider>,
  );
}

describe('SettingsForm', () => {
  it('shows the current settings: the organization and the environment apart', () => {
    renderForm(saved());

    const organization = screen.getByRole('group', { name: 'Organization' });
    expect(
      within(organization).getByRole('checkbox', { name: 'Require a second factor' }),
    ).not.toBeChecked();
    const retention = screen.getByRole('group', { name: 'Retention in Sandbox' });
    expect(within(retention).getByLabelText('Finished inquiries (days)')).toHaveValue(365);
    expect(within(retention).getByLabelText('API logs (days)')).toHaveValue(30);
    expect(within(retention).getByLabelText('Webhook deliveries (days)')).toHaveValue(30);
    expect(within(retention).getByLabelText('Events (days)')).toHaveValue(90);
  });

  it('shows the face matching settings of the environment, bounded by the contract ranges (C42.4, C42.6, C47)', () => {
    renderForm(saved());

    const face = screen.getByRole('group', { name: 'Face matching in Sandbox' });
    const retention = within(face).getByLabelText('Face template retention (days)');
    expect(retention).toHaveValue(365);
    expect(retention).toHaveAttribute('min', String(FACE_TEMPLATE_RETENTION_DAYS.min));
    expect(retention).toHaveAttribute('max', String(FACE_TEMPLATE_RETENTION_DAYS.max));
    expect(retention).toHaveAccessibleDescription(/whatever the inquiry's own retention/);
    const search = within(face).getByLabelText('Templates searched per selfie');
    expect(search).toHaveValue(50_000);
    expect(search).toHaveAttribute('min', String(FACE_SEARCH_MAX_TEMPLATES.min));
    expect(search).toHaveAttribute('max', String(FACE_SEARCH_MAX_TEMPLATES.max));
  });

  it('posts the face matching settings with the others', async () => {
    const save = saved();
    renderForm(save);

    await userEvent.clear(screen.getByLabelText('Face template retention (days)'));
    await userEvent.type(screen.getByLabelText('Face template retention (days)'), '90');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const formData = save.mock.calls[0]?.[1];
    expect(formData?.get('face-template-retention-days')).toBe('90');
    expect(formData?.get('face-search-max-templates')).toBe('50000');
  });

  it('shows a refusal of a face setting on its field, by its JSON Pointer', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Bad Request',
          detail: 'The request body failed validation.',
          errors: [{ pointer: '/face-search-max-templates', detail: 'Too small: expected >=1000' }],
        },
      }),
    );
    renderForm(save);

    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bad Request');
    expect(screen.getByLabelText('Templates searched per selfie')).toHaveAccessibleDescription(
      /Too small: expected >=1000$/,
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Too small');
  });

  it('saves the sandbox settings at once, and confirms', async () => {
    const save = saved();
    renderForm(save);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Require a second factor' }));
    await userEvent.clear(screen.getByLabelText('Events (days)'));
    await userEvent.type(screen.getByLabelText('Events (days)'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const formData = save.mock.calls[0]?.[1];
    expect(formData?.get('require-mfa')).toBe('true');
    expect(formData?.get('event-retention-days')).toBe('120');
    expect(formData?.get('inquiry-retention-days')).toBe('365');
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
  });

  it('says when nothing changed', async () => {
    renderForm(saved(false));

    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Nothing changed.');
  });

  it('asks before changing production, and saves only once confirmed', async () => {
    const save = saved();
    renderForm(save, 'production');

    expect(screen.getByRole('group', { name: 'Retention in Production' })).toBeVisible();
    expect(screen.getByText(/These settings change production/)).toBeVisible();
    await userEvent.clear(screen.getByLabelText('API logs (days)'));
    await userEvent.type(screen.getByLabelText('API logs (days)'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const dialog = screen.getByRole('dialog', { name: 'Change the production settings?' });
    expect(dialog).toHaveAccessibleDescription(
      'A shorter retention redacts or deletes live data at the next daily run. This cannot be undone.',
    );
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save production settings' }));

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[1].get('api-log-retention-days')).toBe('7');
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves nothing when the production change is canceled', async () => {
    const save = saved();
    renderForm(save, 'production');

    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('shows field errors next to their fields, and keeps what was entered', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          detail: 'Some values are not valid.',
          errors: [
            {
              pointer: '/event-retention-days',
              detail: 'Enter a whole number of days from 1 to 3650.',
            },
          ],
        },
      }),
    );
    renderForm(save);

    await userEvent.clear(screen.getByLabelText('Events (days)'));
    await userEvent.type(screen.getByLabelText('Events (days)'), '9999');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the values you entered');
    expect(screen.getByLabelText('Events (days)')).toHaveAccessibleDescription(
      'Events a pending webhook delivery still needs are kept. Enter a whole number of days from 1 to 3650.',
    );
    expect(screen.getByLabelText('Events (days)')).toHaveValue(9999);
  });
});

describe('SettingsForm: the text message budget (C55.7, C66)', () => {
  function renderBudget(save: Save, overrides: Partial<DashboardSettings> = {}) {
    render(
      <ToastProvider>
        <SettingsForm
          settings={settings({
            'otp-sms-max-per-hour': 150,
            'otp-sms-budget-tripped-at': null,
            ...overrides,
          })}
          environment="sandbox"
          environmentId={ENVIRONMENTS.sandbox.id}
          action={save}
        />
      </ToastProvider>,
    );
  }

  const budgetGroup = () => screen.getByRole('group', { name: 'Text message codes in Sandbox' });

  it('shows the budget of the environment, bounded from 1, naming the installation ceiling', () => {
    renderBudget(saved());

    const budget = within(budgetGroup()).getByLabelText('Text messages per hour');
    expect(budget).toHaveValue(150);
    expect(budget).toHaveAttribute('min', String(OTP_SMS_MAX_PER_HOUR.min));
    expect(budget).toHaveAccessibleDescription(
      new RegExp(
        `From 1 to the installation's ceiling \\(OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING, ${OTP_SMS_MAX_PER_HOUR.ceilingDefault.toLocaleString('en-US')} unless the operator set another\\)`,
      ),
    );
  });

  it('says the budget never tripped, read-only', () => {
    renderBudget(saved());

    expect(
      within(budgetGroup()).getByText('Budget last tripped (UTC)').nextElementSibling,
    ).toHaveTextContent(/^Never$/);
    expect(
      budgetGroup().querySelector('[name="otp-sms-budget-tripped-at"]'),
    ).not.toBeInTheDocument();
  });

  it('says when the budget last tripped, from the audit log, read-only', () => {
    renderBudget(saved(), { 'otp-sms-budget-tripped-at': '2026-10-20T04:35:00.000Z' });

    const tripped = within(budgetGroup()).getByText('Budget last tripped (UTC)').nextElementSibling;
    expect(tripped?.querySelector('time')).toHaveAttribute('datetime', '2026-10-20T04:35:00.000Z');
  });

  it('posts the budget with the other settings', async () => {
    const save = saved();
    renderBudget(save);

    await userEvent.clear(screen.getByLabelText('Text messages per hour'));
    await userEvent.type(screen.getByLabelText('Text messages per hour'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const formData = save.mock.calls[0]?.[1];
    expect(formData?.get('otp-sms-max-per-hour')).toBe('120');
    expect(formData?.get('otp-sms-budget-tripped-at')).toBeNull();
  });

  it('shows a refusal of the budget on its field, by its JSON Pointer', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Unprocessable Content',
          detail: "otp-sms-max-per-hour is at most this installation's ceiling, 1000.",
          errors: [{ pointer: '/otp-sms-max-per-hour', detail: 'must be at most 1000' }],
        },
      }),
    );
    renderBudget(save);

    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unprocessable Content');
    expect(screen.getByLabelText('Text messages per hour')).toHaveAccessibleDescription(
      /must be at most 1000$/,
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('must be at most');
  });

  it('asks for no budget a server does not report', () => {
    renderForm(saved());

    expect(within(budgetGroup()).getByText('Not reported by this server.')).toBeVisible();
    expect(screen.queryByLabelText('Text messages per hour')).not.toBeInTheDocument();
  });
});

describe('SettingsForm: report retention (C73.6, C86)', () => {
  function renderReports(save: Save, overrides: Partial<DashboardSettings> = {}) {
    render(
      <ToastProvider>
        <SettingsForm
          settings={settings({ 'report-retention-days': null, ...overrides })}
          environment="sandbox"
          environmentId={ENVIRONMENTS.sandbox.id}
          action={save}
        />
      </ToastProvider>,
    );
  }
  const field = () => screen.getByRole('spinbutton', { name: 'Reports (days)' });

  it('shows the environment’s report retention, empty to keep reports as long as their inquiries, from 1 to 3,650', () => {
    renderReports(saved());

    expect(field()).toHaveValue(null);
    expect(field()).toHaveAttribute('min', '1');
    expect(field()).toHaveAttribute('max', '3650');
    expect(field()).toHaveAccessibleDescription(
      'Reports are redacted, never deleted, this many days after they were created. Leave it empty to keep them as long as their inquiries. From 1 to 3,650.',
    );
    expect(
      within(screen.getByRole('group', { name: 'Retention in Sandbox' })).getByRole('spinbutton', {
        name: 'Reports (days)',
      }),
    ).toBeVisible();
  });

  it('posts the report retention with the other settings', async () => {
    const save = saved();
    renderReports(save, { 'report-retention-days': 365 });

    expect(field()).toHaveValue(365);
    await userEvent.clear(field());
    await userEvent.type(field(), '730');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    expect(save.mock.calls[0]?.[1].get('report-retention-days')).toBe('730');
  });

  it('shows a refusal of the report retention on its field, by its JSON Pointer', async () => {
    renderReports(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/report-retention-days', detail: 'must be at most 3650' }],
        },
      }),
    );

    await userEvent.type(field(), '9999');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await vi.waitFor(() => {
      expect(field()).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field()).toHaveAccessibleDescription(/must be at most 3650/);
    expect(screen.getByRole('alert')).not.toHaveTextContent('/report-retention-days');
  });

  it('asks for no report retention a server does not report', () => {
    render(
      <ToastProvider>
        <SettingsForm
          settings={settings()}
          environment="sandbox"
          environmentId={ENVIRONMENTS.sandbox.id}
          action={saved()}
        />
      </ToastProvider>,
    );

    expect(screen.queryByRole('spinbutton', { name: 'Reports (days)' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Retention in Sandbox' })).toHaveTextContent(
      'Reports: not reported by this server.',
    );
  });
});
