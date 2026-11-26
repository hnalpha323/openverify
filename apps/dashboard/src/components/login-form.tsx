'use client';

import { Alert, Button, Field, Input } from '@openverify/ui';
import { useActionState, useRef, useState } from 'react';
import { INITIAL_LOGIN_STATE, LOGIN_ERROR_MESSAGES, type LoginState } from '../lib/login-state';
import {
  hasErrors,
  validateLogin,
  type LoginCredentials,
  type LoginErrors,
} from '../lib/login-validation';

const MESSAGES = {
  email: {
    required: 'Enter your email address.',
    invalid: 'Enter an email address in the format name@example.com.',
  },
  password: { required: 'Enter your password.' },
} as const;

export interface LoginFormProps {
  /** The login server action; it receives the form fields and reports a failure, if any. */
  readonly action: (state: LoginState, formData: FormData) => Promise<LoginState>;
}

export function LoginForm({ action }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_LOGIN_STATE);
  const [values, setValues] = useState<LoginCredentials>({ email: '', password: '' });
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Errors appear after the first submit attempt, then follow the user's corrections.
  const errors: LoginErrors = submitted ? validateLogin(values) : {};

  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        setSubmitted(true);
        const found = validateLogin(values);
        if (hasErrors(found)) {
          // Stops React from running the action; the server validates again anyway.
          event.preventDefault();
          (found.email ? emailRef : passwordRef).current?.focus();
        }
      }}
    >
      <Field label="Email" error={errors.email && MESSAGES.email[errors.email]}>
        <Input
          ref={emailRef}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
          maxLength={254}
          required
          value={values.email}
          onChange={(event) => {
            const email = event.currentTarget.value;
            setValues((current) => ({ ...current, email }));
          }}
        />
      </Field>
      <Field label="Password" error={errors.password && MESSAGES.password[errors.password]}>
        <Input
          ref={passwordRef}
          type="password"
          name="password"
          autoComplete="current-password"
          maxLength={1024}
          required
          value={values.password}
          onChange={(event) => {
            const password = event.currentTarget.value;
            setValues((current) => ({ ...current, password }));
          }}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      {state.error !== null && !pending && (
        <Alert tone="error">{LOGIN_ERROR_MESSAGES[state.error]}</Alert>
      )}
    </form>
  );
}
