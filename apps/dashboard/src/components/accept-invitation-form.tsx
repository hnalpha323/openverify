'use client';

import { Alert, Field, Input } from '@openverify/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../lib/action-state';
import { withoutFieldErrors } from './field-errors';
import { ProblemDisplay } from './problem-display';
import { SubmitButton } from './submit-button';
import { useFormAction } from './use-form-action';

const INVITATION_TOKEN = /^ovi_[A-Za-z0-9_-]{43}$/;

/** The `ovi_` token of an invitation link's fragment (`#token=ovi_...`), or `null`. */
export function invitationTokenFrom(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token !== null && INVITATION_TOKEN.test(token) ? token : null;
}

const noSubscription = () => () => undefined;

/** The fields that show their own errors; the announced summary does not repeat them. */
const FIELD_POINTERS = ['/name', '/password', '/password-confirmation'];

export interface AcceptInvitationFormProps {
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}

/**
 * Accepts an invitation (C22). The token arrives in the link's fragment, which browsers never
 * send to a server; it is read once in the browser, kept in memory, and the fragment is cleared
 * from the address bar at once. It reaches the server only in the form's POST.
 */
export function AcceptInvitationForm({ action }: AcceptInvitationFormProps) {
  // The server cannot see the fragment: render the same placeholder as the server until hydrated.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [token] = useState(() =>
    typeof window === 'undefined' ? null : invitationTokenFrom(window.location.hash),
  );
  // A refusal keeps the name typed (Workflow 2D K003); success signs in and leaves the page.
  const { pending, problem, formProps } = useFormAction(action);

  useEffect(() => {
    if (window.location.hash !== '') {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  if (!hydrated) {
    return <p className="text-sm text-ink-muted">Reading your invitation…</p>;
  }
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return (
      <Alert tone="error">
        This invitation link is not complete. Open the link from your email again.
      </Alert>
    );
  }

  return (
    <form {...formProps} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <Field label="Your name" error={fieldErrorOf(problem, '/name')}>
        <Input name="name" autoComplete="name" maxLength={200} required />
      </Field>
      <Field
        label="Password"
        description="At least 12 characters."
        error={fieldErrorOf(problem, '/password')}
      >
        <Input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          required
        />
      </Field>
      <Field label="Repeat the password" error={fieldErrorOf(problem, '/password-confirmation')}>
        <Input
          type="password"
          name="password-confirmation"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          required
        />
      </Field>
      <SubmitButton pendingLabel="Creating your account…" pending={pending} className="w-full">
        Create my account
      </SubmitButton>
      <ProblemDisplay problem={withoutFieldErrors(problem, FIELD_POINTERS)} />
    </form>
  );
}
