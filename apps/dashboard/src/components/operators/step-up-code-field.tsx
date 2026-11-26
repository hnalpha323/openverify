'use client';

import { Alert, Button, Field, Input } from '@openverify/ui';
import { startAuthentication } from '@simplewebauthn/browser';
import { useState, useTransition } from 'react';
import type { ActionResult } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';

const COPY = SETTINGS_COPY.users;

export interface StepUpCodeFieldProps {
  /**
   * C168.1 (K9-11): starts a passkey step-up (`startStepUpWebauthn`). Without it the dialog offers
   * the code alone.
   */
  readonly startWebauthn?: () => Promise<
    ActionResult<{ readonly options: Record<string, unknown> }>
  >;
}

type KeyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ready'; readonly credential: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * C168.1: a reset or a reactivation needs a factor verified in the last 10 minutes. The dialog asks
 * for a code, or (K9-11) a security key or passkey, asserted in the browser as the sign-in does
 * (`components/mfa-login.tsx`); the action verifies it first and acts only then. The assertion
 * travels in the dialog's form, never anywhere else. Paste is allowed (WCAG 3.3.8).
 */
export function StepUpCodeField({ startWebauthn }: StepUpCodeFieldProps) {
  const [key, setKey] = useState<KeyState>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  function confirmWithKey() {
    if (startWebauthn === undefined) {
      return;
    }
    setKey({ kind: 'idle' });
    startTransition(async () => {
      const start = await startWebauthn();
      if (!start.ok) {
        setKey({ kind: 'failed', message: start.problem.title });
        return;
      }
      try {
        const credential = await startAuthentication({
          optionsJSON: start.data.options as unknown as Parameters<
            typeof startAuthentication
          >[0]['optionsJSON'],
        });
        setKey({ kind: 'ready', credential: JSON.stringify(credential) });
      } catch {
        setKey({ kind: 'failed', message: COPY.stepUpKeyNoResponse });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={COPY.stepUpLabel} description={COPY.stepUpDescription}>
        <Input
          name="totp-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={12}
          spellCheck={false}
        />
      </Field>
      {startWebauthn !== undefined && (
        <div className="flex flex-col gap-2">
          <input
            type="hidden"
            name="step-up-credential"
            value={key.kind === 'ready' ? key.credential : ''}
          />
          <Button type="button" variant="secondary" onClick={confirmWithKey} disabled={pending}>
            {pending ? COPY.stepUpKeyPending : COPY.stepUpKey}
          </Button>
          {key.kind === 'ready' && <p role="status">{COPY.stepUpKeyReady}</p>}
          {key.kind === 'failed' && <Alert tone="error">{key.message}</Alert>}
        </div>
      )}
    </div>
  );
}
