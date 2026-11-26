'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { LINK_CLASS } from '../../link-styles';
import { ProblemDisplay } from '../../problem-display';
import { SubmitButton } from '../../submit-button';
import { useFormAction } from '../../use-form-action';
import { ParameterFields } from '../../workflows/parameter-fields';

type RunAction = (
  state: ActionState<{ runId: string }>,
  formData: FormData,
) => Promise<ActionResult<{ runId: string }>>;

/** One input of an action's parameter form, as `GET /cases/:id/available-actions` served it. */
export interface ActionParameter {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  /** Prefilled under the viewer's mask (P38): `null` when masked or unset. */
  readonly 'prefilled-value': unknown;
}

/**
 * One case action (C140.1, C142.2): its parameter form (the shared `ParameterFields`, typed by the
 * C115.3 DSL, 8C Stage 1 amendment 9), prefilled under the viewer's mask (a value
 * the viewer may not see stays empty, and the run reads the live one under its grant), and a Run
 * button. The run it started is linked, and said politely (4.1.3).
 */
export function CaseActionForm({
  caseId,
  actionId,
  label,
  form,
  action,
}: {
  readonly caseId: string;
  readonly actionId: string;
  readonly label: string;
  readonly form: readonly ActionParameter[];
  readonly action: RunAction;
}) {
  const legend = useId();
  const [runId, setRunId] = useState<string | null>(null);
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: (data) => {
      setRunId(data.runId);
    },
  });
  return (
    <form {...formProps}>
      <fieldset
        aria-labelledby={legend}
        className="flex flex-col gap-3 rounded-lg border border-line p-3"
      >
        <legend id={legend} className="px-1 text-sm font-semibold">
          {label}
        </legend>
        <input type="hidden" name="case-id" value={caseId} />
        <input type="hidden" name="case-action-id" value={actionId} />
        <ParameterFields inputs={form} />
        <ProblemDisplay problem={problem} />
        <div>
          <SubmitButton pendingLabel="Starting…" pending={pending}>
            Run {label}
          </SubmitButton>
        </div>
        <p role="status" aria-live="polite" className="text-sm">
          {runId !== null && (
            <>
              Started{' '}
              <Link href={`/workflows/runs/${runId}`} className={`${LINK_CLASS} font-mono text-xs`}>
                {runId}
              </Link>
              .
            </>
          )}
        </p>
      </fieldset>
    </form>
  );
}
