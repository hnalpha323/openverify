'use client';

import { Button } from '@openverify/ui';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../lib/action-state';
import { ConfirmDialog } from './confirm-dialog';
import { ProblemDisplay } from './problem-display';
import { RecoveryCodesDialog } from './recovery-codes-dialog';
import { useFormAction } from './use-form-action';

export interface RecoveryCodesButtonProps {
  readonly regenerate: (
    state: ActionState<readonly string[]>,
    formData: FormData,
  ) => Promise<ActionResult<readonly string[]>>;
}

/** Regenerates the recovery codes after a confirmation, and shows the new set once. */
export function RecoveryCodesButton({ regenerate }: RecoveryCodesButtonProps) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  // The codes go to `codes` only, which closing their dialog drops: the action state keeps
  // nothing (C21, Workflow 2D K003).
  const { pending, problem, clearProblem, formProps } = useFormAction(regenerate, {
    onSuccess: (regenerated) => {
      setOpen(false);
      setCodes(regenerated);
    },
  });

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          clearProblem();
          setOpen(true);
        }}
      >
        Regenerate recovery codes
      </Button>
      <ConfirmDialog
        open={open}
        title="Regenerate recovery codes?"
        description="The codes you have now stop working."
        confirmLabel="Regenerate"
        pendingLabel="Regenerating…"
        tone="primary"
        pending={pending}
        onCancel={() => {
          setOpen(false);
        }}
        formAction={formProps.action}
        onSubmit={formProps.onSubmit}
      >
        <ProblemDisplay problem={problem} />
      </ConfirmDialog>
      <RecoveryCodesDialog
        codes={codes}
        onClose={() => {
          setCodes(null);
        }}
      />
    </>
  );
}
