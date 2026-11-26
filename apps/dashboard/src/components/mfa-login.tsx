'use client';

import type { MfaFactorKind } from '@openverify/contracts';
import { Alert, Button, Field, Input } from '@openverify/ui';
import { startAuthentication } from '@simplewebauthn/browser';
import { useActionState, useState, useTransition } from 'react';
import {
  INITIAL_MFA_CODE_STATE,
  type MfaCodeState,
  type WebauthnLoginFinish,
  type WebauthnLoginStart,
} from '../lib/mfa-login-state';
import { SubmitButton } from './submit-button';

export interface MfaLoginProps {
  /** The factor types the user has; the page never sees the `mfa-token`. */
  readonly factors: readonly MfaFactorKind[];
  readonly completeMfa: (state: MfaCodeState, formData: FormData) => Promise<MfaCodeState>;
  readonly startWebauthnLogin: () => Promise<WebauthnLoginStart>;
  readonly finishWebauthnLogin: (credential: unknown) => Promise<WebauthnLoginFinish>;
  readonly cancelMfaLogin: () => Promise<void>;
}

/**
 * The API counts wrong attempts and ends the sign-in at the fifth (C15, C25.1); the page cannot
 * know how many are left, since another tab may have used some.
 */
const ATTEMPT_LIMIT = 'After five wrong attempts you need to sign in again.';

function codeMessage(state: MfaCodeState): string | null {
  switch (state.error) {
    case 'invalid_code':
      return `That code is not valid. ${ATTEMPT_LIMIT}`;
    case 'invalid_input':
      return 'Enter the code exactly as it is shown.';
    case 'unavailable':
      return 'Sign-in is unavailable right now. Try again later.';
    case null:
      return null;
  }
}

function keyMessage(result: WebauthnLoginStart | WebauthnLoginFinish): string | null {
  if (result.ok) {
    return null;
  }
  switch (result.error) {
    case 'rejected':
      return `The security key was not accepted. ${ATTEMPT_LIMIT}`;
    case 'expired':
      return 'The sign-in took too long. Sign in again.';
    case 'invalid_input':
    case 'unavailable':
      return 'Sign-in is unavailable right now. Try again later.';
  }
}

/** The second step of signing in (C22): an authenticator code, a recovery code or a security key. */
export function MfaLogin({
  factors,
  completeMfa,
  startWebauthnLogin,
  finishWebauthnLogin,
  cancelMfaLogin,
}: MfaLoginProps) {
  const hasTotp = factors.includes('totp');
  const [method, setMethod] = useState<'totp' | 'recovery'>(hasTotp ? 'totp' : 'recovery');
  const [showCodeForm, setShowCodeForm] = useState(hasTotp);
  const [state, formAction, codePending] = useActionState(completeMfa, INITIAL_MFA_CODE_STATE);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyPending, startKeyTransition] = useTransition();
  // A refusal shows until the next code is sent, so the one shown is always that code's own.
  const codeError = codePending ? null : codeMessage(state);

  function signInWithSecurityKey() {
    setKeyError(null);
    startKeyTransition(async () => {
      const start = await startWebauthnLogin();
      if (!start.ok) {
        setKeyError(keyMessage(start));
        return;
      }
      let credential: unknown;
      try {
        credential = await startAuthentication({
          optionsJSON: start.options as unknown as Parameters<
            typeof startAuthentication
          >[0]['optionsJSON'],
        });
      } catch {
        setKeyError('The security key did not respond. Try again.');
        return;
      }
      setKeyError(keyMessage(await finishWebauthnLogin(credential)));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {factors.includes('webauthn') && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">Use the security key or passkey you added.</p>
          <Button onClick={signInWithSecurityKey} disabled={keyPending} className="w-full">
            {keyPending ? 'Waiting for the security key…' : 'Use a security key'}
          </Button>
          {keyError !== null && <Alert tone="error">{keyError}</Alert>}
        </div>
      )}

      {showCodeForm ? (
        <form action={formAction} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="method" value={method} />
          {method === 'totp' ? (
            <Field
              label="Authentication code"
              description="The 6-digit code your authenticator app shows."
            >
              <Input
                key="totp"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                required
              />
            </Field>
          ) : (
            <Field
              label="Recovery code"
              description="One of the codes you saved, like XXXX-XXXX-XXXX."
            >
              <Input
                key="recovery"
                name="code"
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                autoFocus
                required
              />
            </Field>
          )}
          <SubmitButton pendingLabel="Verifying…" className="w-full">
            Verify
          </SubmitButton>
          {codeError !== null && <Alert tone="error">{codeError}</Alert>}
        </form>
      ) : null}

      <div className="flex flex-col items-start gap-2 text-sm">
        {method === 'totp' || !showCodeForm ? (
          <Button
            variant="secondary"
            onClick={() => {
              setMethod('recovery');
              setShowCodeForm(true);
            }}
          >
            Use a recovery code instead
          </Button>
        ) : (
          hasTotp && (
            <Button
              variant="secondary"
              onClick={() => {
                setMethod('totp');
              }}
            >
              Use your authenticator app instead
            </Button>
          )
        )}
        <form action={cancelMfaLogin}>
          <Button type="submit" variant="secondary">
            Sign in again
          </Button>
        </form>
      </div>
    </div>
  );
}
