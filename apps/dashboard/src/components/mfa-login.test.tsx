import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { later } from '../testing/later';
import { MfaLogin, type MfaLoginProps } from './mfa-login';

const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => browser);

const OPTIONS = { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost' };
const ASSERTION = { id: 'Y3JlZA', rawId: 'Y3JlZA', type: 'public-key' };

function setup(overrides: Partial<MfaLoginProps> = {}) {
  const props: MfaLoginProps = {
    factors: ['totp', 'webauthn'],
    completeMfa: vi.fn<MfaLoginProps['completeMfa']>(() => Promise.resolve({ error: null })),
    startWebauthnLogin: vi.fn<MfaLoginProps['startWebauthnLogin']>(() =>
      Promise.resolve({ ok: true, options: OPTIONS }),
    ),
    finishWebauthnLogin: vi.fn<MfaLoginProps['finishWebauthnLogin']>(() =>
      Promise.resolve({ ok: true }),
    ),
    cancelMfaLogin: vi.fn<MfaLoginProps['cancelMfaLogin']>(() => Promise.resolve()),
    ...overrides,
  };
  render(<MfaLogin {...props} />);
  return props;
}

beforeEach(() => {
  browser.startAuthentication.mockReset();
});

describe('MfaLogin: codes', () => {
  it('asks for the authenticator code in a labelled one-time-code field', () => {
    setup();

    const code = screen.getByRole('textbox', { name: 'Authentication code' });
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveFocus();
  });

  it('submits the code with its method', async () => {
    const props = setup();

    await userEvent.type(screen.getByRole('textbox', { name: 'Authentication code' }), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    const formData = vi.mocked(props.completeMfa).mock.calls[0]?.[1];
    expect(formData?.get('method')).toBe('totp');
    expect(formData?.get('code')).toBe('123456');
  });

  it.each([
    // The API counts wrong attempts (C25.1); the page does not know how many are left.
    [
      { error: 'invalid_code' },
      'That code is not valid. After five wrong attempts you need to sign in again.',
    ],
    [{ error: 'invalid_input' }, 'Enter the code exactly as it is shown.'],
    [{ error: 'unavailable' }, 'Sign-in is unavailable right now. Try again later.'],
  ] as const)('announces %j', async (state, message) => {
    setup({ completeMfa: () => Promise.resolve(state) });

    await userEvent.type(screen.getByRole('textbox', { name: 'Authentication code' }), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('takes the previous refusal away while the next code is checked', async () => {
    let answer: (state: { readonly error: 'invalid_code' }) => void = () => undefined;
    const completeMfa = vi
      .fn<MfaLoginProps['completeMfa']>()
      .mockImplementationOnce(() => later({ error: 'invalid_code' }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
    setup({ completeMfa });
    const code = screen.getByRole('textbox', { name: 'Authentication code' });
    await userEvent.type(code, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^That code is not valid/);

    await userEvent.clear(code);
    await userEvent.type(code, '111111');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    // While the second code is checked, no refusal shows: the next one is this code's own.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    answer({ error: 'invalid_code' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/^That code is not valid/);
  });

  it('switches to a recovery code and back', async () => {
    const props = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Recovery code' }), 'ABCD-EFGH-JKMN');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(vi.mocked(props.completeMfa).mock.calls[0]?.[1].get('method')).toBe('recovery');
    await userEvent.click(
      screen.getByRole('button', { name: 'Use your authenticator app instead' }),
    );
    expect(screen.getByRole('textbox', { name: 'Authentication code' })).toBeVisible();
  });

  it('offers only a recovery code when the user has no authenticator app', () => {
    setup({ factors: ['webauthn'] });

    expect(screen.queryByRole('textbox', { name: 'Authentication code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a recovery code instead' })).toBeVisible();
  });
});

describe('MfaLogin: security keys', () => {
  it('runs the WebAuthn ceremony: options, the browser, then verification', async () => {
    browser.startAuthentication.mockResolvedValueOnce(ASSERTION);
    const props = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Use a security key' }));

    expect(browser.startAuthentication).toHaveBeenCalledExactlyOnceWith({ optionsJSON: OPTIONS });
    expect(props.finishWebauthnLogin).toHaveBeenCalledExactlyOnceWith(ASSERTION);
  });

  it('says so when the browser gets no answer from the key', async () => {
    browser.startAuthentication.mockRejectedValueOnce(
      new DOMException('timed out', 'NotAllowedError'),
    );
    const props = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Use a security key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The security key did not respond. Try again.',
    );
    expect(props.finishWebauthnLogin).not.toHaveBeenCalled();
  });

  it('says so when the key is refused', async () => {
    browser.startAuthentication.mockResolvedValueOnce(ASSERTION);
    setup({
      finishWebauthnLogin: () => Promise.resolve({ ok: false, error: 'rejected' }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Use a security key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The security key was not accepted. After five wrong attempts you need to sign in again.',
    );
  });

  it('says the sign-in expired when the challenge is gone', async () => {
    setup({ startWebauthnLogin: () => Promise.resolve({ ok: false, error: 'expired' }) });

    await userEvent.click(screen.getByRole('button', { name: 'Use a security key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sign-in took too long. Sign in again.',
    );
    expect(browser.startAuthentication).not.toHaveBeenCalled();
  });
});

describe('MfaLogin: starting over', () => {
  it('signs in again through the cancel action', async () => {
    const props = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(props.cancelMfaLogin).toHaveBeenCalledOnce();
  });
});
