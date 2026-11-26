import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toasts';
import { ConnectSettingsForm, type ConnectSettingsFormProps } from './connect-settings-form';

const ENVIRONMENT_ID = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';
const values = {
  'connect-inbound': false,
  'share-token-max-seconds': 1_209_600,
  'consent-proof-retention-days': 30,
} as const;

function show(props: Partial<ConnectSettingsFormProps> = {}) {
  const action = vi.fn(() => Promise.resolve({ ok: true as const, data: undefined }));
  render(
    <ToastProvider>
      <ConnectSettingsForm
        settings={values}
        canWrite
        environmentId={ENVIRONMENT_ID}
        environmentName="Sandbox"
        action={action}
        {...props}
      />
    </ToastProvider>,
  );
  return action;
}

describe('ConnectSettingsForm (C231.10, C232.1, C241.3)', () => {
  it('posts the opt-in, the longest token life and the proof retention with the page’s environment', async () => {
    const action = show();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('checkbox', { name: 'Receive connections from other organizations' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save Connect settings' }));

    expect(action).toHaveBeenCalledTimes(1);
    const form = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(form.get('connect-inbound')).toBe('true');
    expect(form.get('share-token-max-seconds')).toBe('1209600');
    expect(form.get('consent-proof-retention-days')).toBe('30');
    expect(form.get('environment-id')).toBe(ENVIRONMENT_ID);
  });

  it('says which settings are the organization’s and which the environment’s, with their ranges', () => {
    show();

    expect(
      screen.getByRole('checkbox', { name: 'Receive connections from other organizations' }),
    ).toHaveAccessibleDescription(/organization/);
    expect(
      screen.getByRole('spinbutton', { name: /Longest share token life/ }),
    ).toHaveAccessibleDescription(/From 60 to 1,814,400 seconds/);
    expect(
      screen.getByRole('spinbutton', { name: /Consent proof kept/ }),
    ).toHaveAccessibleDescription(/From 0 to 3,650 days/);
    expect(screen.getByText(/Sandbox/)).toBeInTheDocument();
  });

  it('shows the settings as values without settings:write', () => {
    show({ canWrite: false, settings: { ...values, 'connect-inbound': true } });

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('1,209,600 seconds (14 days)')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });

  it('says a setting the API did not send as not reported', () => {
    show({ canWrite: false, settings: {} });

    expect(screen.getAllByText('Not reported by the API')).toHaveLength(3);
  });
});
