'use client';

import { Alert, Button, Field, Input } from '@openverify/ui';
import { startRegistration } from '@simplewebauthn/browser';
import { useState, useTransition } from 'react';
import type { ActionResult, DisplayProblem } from '../lib/action-state';
import type { FactorActivated } from '../lib/mfa-enrolment';
import { Dialog } from './dialog';
import { ProblemDisplay } from './problem-display';
import { RecoveryCodesDialog } from './recovery-codes-dialog';
import { useToast } from './toasts';

export interface WebauthnEnrolmentProps {
  readonly start: () => Promise<ActionResult<{ options: Record<string, unknown> }>>;
  readonly finish: (input: {
    credential: unknown;
    name?: string;
  }) => Promise<ActionResult<FactorActivated>>;
}

const ADDED = 'Security key added.';
type CreationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

/** Adds a security key or passkey (C22) through the browser's WebAuthn registration. */
export function WebauthnEnrolment({ start, finish }: WebauthnEnrolmentProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<DisplayProblem>();
  const [keyError, setKeyError] = useState<string | null>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const { show } = useToast();

  const close = () => {
    setOpen(false);
    setName('');
    setProblem(undefined);
    setKeyError(null);
  };

  function register() {
    setProblem(undefined);
    setKeyError(null);
    startTransition(async () => {
      const options = await start();
      if (!options.ok) {
        setProblem(options.problem);
        return;
      }
      let credential: unknown;
      try {
        credential = await startRegistration({
          optionsJSON: options.data.options as unknown as CreationOptions,
        });
      } catch {
        setKeyError('The security key did not respond. Try again.');
        return;
      }
      const trimmed = name.trim();
      const result = await finish(trimmed === '' ? { credential } : { credential, name: trimmed });
      if (!result.ok) {
        setProblem(result.problem);
        return;
      }
      close();
      if (result.data.recoveryCodes === null) {
        show({ tone: 'success', message: ADDED });
      } else {
        setCodes(result.data.recoveryCodes);
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add a security key
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Add a security key"
        description="Give it a name, then follow your browser's prompt to use the key or passkey."
        dismissible={!pending}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            register();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Name (optional)">
            <Input
              name="name"
              value={name}
              maxLength={100}
              placeholder="Laptop key"
              autoComplete="off"
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
            />
          </Field>
          {keyError !== null && <Alert tone="error">{keyError}</Alert>}
          <ProblemDisplay problem={problem} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Waiting for the security key…' : 'Continue'}
            </Button>
          </div>
        </form>
      </Dialog>
      <RecoveryCodesDialog
        codes={codes}
        onClose={() => {
          setCodes(null);
          show({ tone: 'success', message: ADDED });
        }}
      />
    </>
  );
}
