'use client';

import { useEffect, useState } from 'react';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { ProblemDisplay } from '../../problem-display';
import { SubmitButton } from '../../submit-button';
import { useFormAction } from '../../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** Every closed `<details>` opens for printing and closes again after (C142.5). */
function useDetailsOpenForPrint() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll('details:not([open])')].filter(
        (element): element is HTMLDetailsElement => element instanceof HTMLDetailsElement,
      );
      for (const details of opened) {
        details.open = true;
      }
    };
    const after = () => {
      for (const details of opened) {
        details.open = false;
      }
      opened = [];
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

/**
 * Print (C138.3, C142.5): `POST /cases/:id/print` writes the audit entry and fires
 * `case.print-initiated` first; only once it is recorded does the browser's print dialog open. A
 * refusal says why and prints nothing.
 */
export function PrintButton({
  caseId,
  action,
}: {
  readonly caseId: string;
  readonly action: Action;
}) {
  useDetailsOpenForPrint();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      window.print();
    },
  });
  return (
    <form {...formProps} className="flex flex-col gap-2 print:hidden">
      <input type="hidden" name="case-id" value={caseId} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Recording the print…" pending={pending}>
          Print
        </SubmitButton>
      </div>
      <ProblemDisplay problem={problem} />
    </form>
  );
}

/**
 * The printed page's footer (C142.5): the environment, the case, who printed it and when, and
 * whether it holds personal data. Hidden on screen; the time is taken as the browser prints.
 */
export function PrintFooter({
  environment,
  caseId,
  operatorId,
  personalData,
}: {
  readonly environment: string;
  readonly caseId: string;
  readonly operatorId: string;
  readonly personalData: boolean;
}) {
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  useEffect(() => {
    const stamp = () => {
      setPrintedAt(new Date().toISOString());
    };
    window.addEventListener('beforeprint', stamp);
    return () => {
      window.removeEventListener('beforeprint', stamp);
    };
  }, []);
  return (
    <footer
      data-case-print-footer=""
      className="hidden border-t border-line pt-2 text-xs text-ink print:block"
    >
      <p>
        Environment: {environment}. Case {caseId}. Printed by {operatorId}
        {printedAt === null ? '' : ` at ${printedAt} (UTC)`}.
      </p>
      <p className="font-semibold">
        {personalData ? 'Contains personal data.' : 'Personal data is masked on this printout.'}
      </p>
    </footer>
  );
}
