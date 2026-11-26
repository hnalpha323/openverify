import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepUpCodeField } from './step-up-code-field';

const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => browser);

const OPTIONS = { challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', allowCredentials: [] };
const ASSERTION = {
  id: 'Y3JlZGVudGlhbA',
  rawId: 'Y3JlZGVudGlhbA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  clientExtensionResults: {},
};

const credentialInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="step-up-credential"]');

beforeEach(() => {
  browser.startAuthentication.mockReset();
});

describe('the step-up field (C168.1; K9-11)', () => {
  it('offers only the code without a passkey start', () => {
    render(<StepUpCodeField />);

    expect(screen.getByRole('textbox', { name: 'Code from your authenticator app' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use a security key or passkey' })).toBeNull();
  });

  it('confirms with a passkey as the sign-in does, and sends the assertion with the dialog', async () => {
    const start = vi.fn().mockResolvedValue({ ok: true, data: { options: OPTIONS } });
    browser.startAuthentication.mockResolvedValueOnce(ASSERTION);
    const { container } = render(<StepUpCodeField startWebauthn={start} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use a security key or passkey' }));

    expect(start).toHaveBeenCalledOnce();
    expect(browser.startAuthentication).toHaveBeenCalledExactlyOnceWith({ optionsJSON: OPTIONS });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Security key or passkey ready. Confirm to continue.',
    );
    expect(JSON.parse(credentialInput(container)?.value ?? 'null')).toEqual(ASSERTION);
  });

  it('says at the field when the key does not respond, and sends nothing', async () => {
    const start = vi.fn().mockResolvedValue({ ok: true, data: { options: OPTIONS } });
    browser.startAuthentication.mockRejectedValueOnce(new Error('NotAllowedError'));
    const { container } = render(<StepUpCodeField startWebauthn={start} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use a security key or passkey' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The security key or passkey did not respond. Try again, or enter a code.',
    );
    expect(credentialInput(container)?.value ?? '').toBe('');
  });

  it('says the refusal of the start in its own words, and never calls the browser', async () => {
    const start = vi.fn().mockResolvedValue({
      ok: false,
      problem: { title: 'You need users:write to do this.' },
    });
    render(<StepUpCodeField startWebauthn={start} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use a security key or passkey' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You need users:write to do this.');
    expect(browser.startAuthentication).not.toHaveBeenCalled();
  });
});
