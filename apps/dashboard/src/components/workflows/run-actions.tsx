'use client';

/**
 * Resume, rerun, cancel and redact on the run page (C120.3 to C120.5, C120.9, C141.6), each behind a
 * confirmation that says what it does and what it cannot undo. A resume skips a step whose outcome
 * is unknown only when the operator ticks the acknowledgement; unticked, the API refuses it.
 */
import { Checkbox } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';

export type RunControl = 'resume' | 'rerun' | 'cancel';

export interface RunActionsProps {
  readonly runId: string;
  readonly controls: readonly RunControl[];
  /** Steps whose outcome is unknown, which a resume skips only when acknowledged. */
  readonly unknownEffects: number;
  readonly control: (
    state: ActionState<{ readonly runId: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ readonly runId: string }>>;
  /** `undefined` without `workflow-runs:redact` or once redacted. */
  readonly redact: ((state: ActionState, formData: FormData) => Promise<ActionResult>) | undefined;
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

export function RunActions({ runId, controls, unknownEffects, control, redact }: RunActionsProps) {
  const router = useRouter();
  return (
    <div role="group" aria-label="Run actions" className="flex flex-wrap gap-3">
      {controls.includes('resume') && (
        <ConfirmActionButton
          label="Resume"
          variant="secondary"
          tone="primary"
          title="Resume this run?"
          description="The failed step runs again. A step whose effect was made is never repeated."
          confirmLabel="Resume"
          action={control}
          fields={{ 'run-id': runId, control: 'resume' }}
          successMessage="The run was resumed."
        >
          {unknownEffects > 0 && (
            <Checkbox
              name="skip-unknown-effects"
              value="acknowledged"
              label={`Skip the ${plural(unknownEffects, 'step')} whose outcome is unknown. Their effect may or may not have been made, and is neither repeated nor checked.`}
            />
          )}
        </ConfirmActionButton>
      )}
      {controls.includes('rerun') && (
        <ConfirmActionButton
          label="Rerun"
          variant="secondary"
          tone="primary"
          title="Rerun this run?"
          description="A new run starts on the latest published version with the same inputs. This run stays as it is."
          confirmLabel="Rerun"
          action={control}
          fields={{ 'run-id': runId, control: 'rerun' }}
          successMessage="A new run started."
          onSuccess={({ runId: started }) => {
            router.push(`/workflows/runs/${started}`);
          }}
        />
      )}
      {controls.includes('cancel') && (
        <ConfirmActionButton
          label="Cancel run"
          title="Cancel this run?"
          description="No further step runs. Effects already made stay made."
          confirmLabel="Cancel run"
          action={control}
          fields={{ 'run-id': runId, control: 'cancel' }}
          successMessage="The run was canceled."
        />
      )}
      {redact !== undefined && (
        <ConfirmActionButton
          label="Redact run"
          title="Redact this run?"
          description="Its inputs, variables, outputs and step values are deleted for good, and its trigger files with them. Copies already sent elsewhere are not reached."
          confirmLabel="Redact run"
          action={redact}
          fields={{ 'run-id': runId }}
          successMessage="The run was redacted."
        />
      )}
    </div>
  );
}
