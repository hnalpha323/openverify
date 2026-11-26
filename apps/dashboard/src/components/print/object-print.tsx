'use client';

import { useEffect, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { CASES_REPORTS_COPY } from '../../lib/copy/cases-reports';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const COPY = CASES_REPORTS_COPY.print;

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
 * The Print button of an inquiry, report or verification page (C173.3, decision 59): the audit
 * entry is written first (`POST /dashboard/print-audits`), and only once it is recorded does the
 * browser's print dialog open. It records use of this button, not every print, and says so.
 */
export function ObjectPrintButton({
  objectId,
  action,
}: {
  readonly objectId: string;
  readonly action: Action;
}) {
  useDetailsOpenForPrint();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      window.print();
    },
  });
  return (
    <form {...formProps} className="flex max-w-xs flex-col gap-2 print:hidden">
      <input type="hidden" name="object-id" value={objectId} />
      <div>
        <SubmitButton variant="secondary" pendingLabel={COPY.recording} pending={pending}>
          {COPY.button}
        </SubmitButton>
      </div>
      <p className="text-xs text-ink-muted">{COPY.recordsUse}</p>
      <ProblemDisplay problem={problem} />
    </form>
  );
}

export interface ObjectPrintFooterProps {
  /** `data-<kind>-print-footer`, read by the page's print stylesheet. */
  readonly kind: 'inquiry' | 'report' | 'verification';
  readonly environment: string;
  readonly objectId: string;
  readonly operatorId: string;
  /** The reader's `pii:view`: whether the printout holds personal data or shows it masked. */
  readonly personalData: boolean;
}

/**
 * The printed page's footer (C173.3, under C142.5's rules): the environment, the object, who
 * printed it and when, whether the page holds personal data, and that only the button's prints are
 * recorded. Hidden on screen; the time is taken as the browser prints.
 */
export function ObjectPrintFooter({
  kind,
  environment,
  objectId,
  operatorId,
  personalData,
}: ObjectPrintFooterProps) {
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
      {...{ [`data-${kind}-print-footer`]: '' }}
      className="hidden border-t border-line pt-2 text-xs text-ink print:block"
    >
      <p>
        {COPY.footerEnvironment}: {environment}. {objectId}. {COPY.printedBy} {operatorId}
        {printedAt === null ? '' : ` at ${printedAt} (UTC)`}.
      </p>
      <p className="font-semibold">{personalData ? COPY.containsPersonalData : COPY.masked}</p>
      <p>{COPY.recordsUse}</p>
    </footer>
  );
}
