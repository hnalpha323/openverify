import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_LOGIN_STATE, type LoginState } from '../lib/login-state';
import { LoginForm } from './login-form';

const VALID_EMAIL = 'operator@example.com';
const VALID_PASSWORD = 'correct horse battery staple';

type Action = (state: LoginState, formData: FormData) => Promise<LoginState>;

function fields() {
  return {
    email: screen.getByLabelText('Email'),
    password: screen.getByLabelText('Password'),
    submit: screen.getByRole('button', { name: /Sign(ing)? in/ }),
  };
}

async function fillAndSubmit(email = VALID_EMAIL, password = VALID_PASSWORD) {
  const { email: emailField, password: passwordField, submit } = fields();
  await userEvent.type(emailField, email);
  await userEvent.type(passwordField, password);
  await userEvent.click(submit);
}

describe('LoginForm', () => {
  it('has labelled email and password fields that password managers understand', () => {
    render(<LoginForm action={vi.fn<Action>()} />);
    const { email, password, submit } = fields();

    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('name', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toBeRequired();
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('name', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toBeRequired();
    expect(submit).toHaveAttribute('type', 'submit');
  });

  it('does not show errors before the first submit', () => {
    render(<LoginForm action={vi.fn<Action>()} />);

    expect(fields().email).not.toHaveAttribute('aria-invalid');
    expect(fields().password).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires both fields, announces why, focuses the first invalid field and does not submit', async () => {
    const action = vi.fn<Action>();
    render(<LoginForm action={action} />);
    const { email, password, submit } = fields();

    await userEvent.click(submit);

    expect(action).not.toHaveBeenCalled();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter your email address.');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription('Enter your password.');
    expect(email).toHaveFocus();
  });

  it('rejects a malformed email', async () => {
    const action = vi.fn<Action>();
    render(<LoginForm action={action} />);

    await fillAndSubmit('not-an-email');

    expect(action).not.toHaveBeenCalled();
    expect(fields().email).toHaveAccessibleDescription(
      'Enter an email address in the format name@example.com.',
    );
    expect(fields().password).not.toHaveAttribute('aria-invalid');
  });

  it('focuses the password when only the password is missing', async () => {
    render(<LoginForm action={vi.fn<Action>()} />);
    const { email, password, submit } = fields();

    await userEvent.type(email, VALID_EMAIL);
    await userEvent.click(submit);

    expect(password).toHaveFocus();
  });

  it('clears an error as soon as the field is corrected', async () => {
    render(<LoginForm action={vi.fn<Action>()} />);
    const { email, submit } = fields();

    await userEvent.click(submit);
    await userEvent.type(email, VALID_EMAIL);

    expect(email).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Enter your email address.')).not.toBeInTheDocument();
  });

  it('submits the form fields to the server action', async () => {
    const action = vi.fn<Action>(() => Promise.resolve(INITIAL_LOGIN_STATE));
    render(<LoginForm action={action} />);

    await fillAndSubmit(`  ${VALID_EMAIL} `, ` ${VALID_PASSWORD} `);

    expect(action).toHaveBeenCalledOnce();
    const [state, formData] = action.mock.calls[0] ?? [];
    expect(state).toEqual(INITIAL_LOGIN_STATE);
    // Email inputs drop surrounding whitespace (HTML value sanitization); passwords never do.
    expect(formData?.get('email')).toBe(VALID_EMAIL);
    expect(formData?.get('password')).toBe(` ${VALID_PASSWORD} `);
  });

  it.each([
    ['invalid_credentials', 'The email or password is incorrect.'],
    ['rate_limited', 'Too many sign-in attempts. Wait a few minutes, then try again.'],
    ['unavailable', 'Sign-in is unavailable right now. Try again later.'],
    ['invalid_input', 'Enter a valid email address and password.'],
  ] as const)('announces the %s failure', async (error, message) => {
    render(<LoginForm action={() => Promise.resolve({ error })} />);

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    // The typed email stays so the operator can correct it.
    expect(fields().email).toHaveValue(VALID_EMAIL);
  });

  it('shows progress and blocks double submits while signing in', async () => {
    let finish: (state: LoginState) => void = () => undefined;
    const action = vi.fn<Action>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<LoginForm action={action} />);

    await fillAndSubmit();

    const pending = await screen.findByRole('button', { name: 'Signing in…' });
    expect(pending).toBeDisabled();
    finish({ error: 'invalid_credentials' });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});
