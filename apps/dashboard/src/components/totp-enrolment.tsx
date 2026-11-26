'use client';

import { Button, Field, Input } from '@openverify/ui';
import { useId, useState } from 'react';
import type { ActionResult, ActionState, DisplayProblem } from '../lib/action-state';
import type { FactorActivated, TotpEnrolmentData } from '../lib/mfa-enrolment';
import { CopyButton } from './copy-button';
import { Dialog } from './dialog';
import { ProblemDisplay } from './problem-display';
import { RecoveryCodesDialog } from './recovery-codes-dialog';
import { SubmitButton } from './submit-button';
import { useToast } from './toasts';
import { useFormAction } from './use-form-action';

export interface TotpEnrolmentProps {
  readonly start: (
    state: ActionState<TotpEnrolmentData>,
    formData: FormData,
  ) => Promise<ActionResult<TotpEnrolmentData>>;
  readonly confirm: (
    state: ActionState<FactorActivated>,
    formData: FormData,
  ) => Promise<ActionResult<FactorActivated>>;
}

const ADDED = 'Authenticator app added.';

/**
 * Adds an authenticator app (C22): name it, scan the QR code (or type the secret), then confirm
 * with a code. The secret lives only in this dialog's state and is dropped when it closes.
 */
export function TotpEnrolment({ start, confirm }: TotpEnrolmentProps) {
  const secretId = useId();
  const [open, setOpen] = useState(false);
  const [enrolment, setEnrolment] = useState<TotpEnrolmentData | null>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [problem, setProblem] = useState<DisplayProblem>();
  const { show } = useToast();

  const close = () => {
    setOpen(false);
    setEnrolment(null);
    setProblem(undefined);
  };

  // A refusal keeps the name or code typed (Workflow 2D K003).
  const starter = useFormAction(start, {
    onSuccess: (data) => {
      setEnrolment(data);
      setProblem(undefined);
    },
    onProblem: setProblem,
  });
  const confirmer = useFormAction(confirm, {
    onSuccess: (data) => {
      close();
      if (data.recoveryCodes === null) {
        show({ tone: 'success', message: ADDED });
      } else {
        setCodes(data.recoveryCodes);
      }
    },
    onProblem: setProblem,
  });
  // The start action shows the secret before it ends (`onSuccess` runs inside it), so it holds
  // the dialog open only until its answer is in.
  const starting = starter.pending && enrolment === null;
  const confirming = confirmer.pending;

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Add an authenticator app
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Add an authenticator app"
        description={
          enrolment === null
            ? 'Give it a name, so you can tell your factors apart.'
            : 'Scan the QR code with your authenticator app, or type the secret key into it. Then enter the code the app shows.'
        }
        dismissible={!starting && !confirming}
        size="lg"
      >
        {enrolment === null ? (
          <form {...starter.formProps} className="flex flex-col gap-4">
            <Field label="Name (optional)">
              <Input name="name" maxLength={100} placeholder="Phone" autoComplete="off" />
            </Field>
            <ProblemDisplay problem={problem} />
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Starting…" pending={starting}>
                Continue
              </SubmitButton>
            </div>
          </form>
        ) : (
          <form {...confirmer.formProps} className="flex flex-col gap-4">
            <svg
              role="img"
              aria-label="QR code for your authenticator app"
              viewBox={`0 0 ${String(enrolment.qr.size)} ${String(enrolment.qr.size)}`}
              shapeRendering="crispEdges"
              className="h-56 w-56 self-center rounded-md border border-line"
            >
              <rect width={enrolment.qr.size} height={enrolment.qr.size} fill="#fff" />
              <path d={enrolment.qr.path} fill="#000" />
            </svg>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={secretId} className="text-sm font-medium text-ink">
                Secret key
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id={secretId}
                  readOnly
                  value={enrolment.secret}
                  spellCheck={false}
                  autoComplete="off"
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm"
                />
                <CopyButton value={enrolment.secret} />
              </div>
            </div>
            <input type="hidden" name="factor-id" value={enrolment.factorId} />
            <Field label="Authentication code" description="The 6-digit code the app shows now.">
              <Input
                name="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
              />
            </Field>
            <ProblemDisplay problem={problem} />
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Activating…" pending={confirming}>
                Activate
              </SubmitButton>
            </div>
          </form>
        )}
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
