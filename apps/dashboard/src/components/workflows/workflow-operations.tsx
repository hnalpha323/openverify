'use client';

/**
 * The workflow page's operations beyond publishing (C141.5, C141.6): promote (C112.2) and the
 * cancel of older versions' runs (C116.2), each behind a confirmation that says what it does and
 * what it never does.
 */
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { FormField, controlClassName } from '../form-field';
import { useToast } from '../toasts';

/** An environment the operator can name: its id and kind. */
export interface EnvironmentChoice {
  readonly id: string;
  readonly kind: 'sandbox' | 'production';
}

/** "Production (env_…)", so a target is never only an id. */
export function environmentWords(environment: EnvironmentChoice): string {
  return `${environment.kind === 'production' ? 'Production' : 'Sandbox'} (${environment.id})`;
}

/**
 * C112.2: copies the live version into another environment as a draft. The API refuses a target
 * that already has a draft (`draft_exists`) and a workflow in a rollout, and it never publishes;
 * the words say so before anything is sent.
 */
export function PromoteButton({
  workflowId,
  targets,
  action,
}: {
  readonly workflowId: string;
  readonly targets: readonly EnvironmentChoice[];
  readonly action: (
    state: ActionState<{ readonly environmentId: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ readonly environmentId: string }>>;
}) {
  return (
    <ConfirmActionButton
      label="Promote"
      variant="secondary"
      tone="primary"
      title="Promote the live version?"
      description={
        <>
          The live version is copied into the target environment as a draft, with each reference
          found again there by name or key. It never replaces a draft that is already there, and it
          never publishes: someone with the rights in that environment reviews and publishes the
          draft.
        </>
      }
      confirmLabel="Promote"
      pendingLabel="Promoting…"
      action={action}
      fields={{ 'workflow-id': workflowId }}
      successMessage="A draft was made in the target environment. It is not published."
    >
      <FormField label="Target environment">
        {(control) => (
          <select
            {...control}
            name="environment-id"
            required
            defaultValue={targets[0]?.id ?? ''}
            className={controlClassName(control)}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {environmentWords(target)}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </ConfirmActionButton>
  );
}

/** A version a cancel can name: the runs of every version older than it are cancelled. */
export interface VersionChoice {
  readonly id: string;
  readonly number: number;
}

/**
 * C116.2: cancels the unfinished runs of every version older than the one chosen. A cancel is a
 * database write first (C120.5), so what those runs already did stays done.
 */
export function CancelOlderRunsButton({
  workflowId,
  versions,
  action,
}: {
  readonly workflowId: string;
  readonly versions: readonly VersionChoice[];
  readonly action: (
    state: ActionState<{ readonly canceledCount: number }>,
    formData: FormData,
  ) => Promise<ActionResult<{ readonly canceledCount: number }>>;
}) {
  const { show } = useToast();
  return (
    <ConfirmActionButton
      label="Cancel older runs"
      variant="secondary"
      title="Cancel the runs of older versions?"
      description={
        <>
          Every unfinished run of a version older than the one you choose is cancelled. Effects
          already made stay made: a message sent, a request made or an object changed is not undone.
        </>
      }
      confirmLabel="Cancel the runs"
      pendingLabel="Cancelling…"
      action={action}
      fields={{ 'workflow-id': workflowId }}
      onSuccess={({ canceledCount }) => {
        show({
          tone: 'success',
          message:
            canceledCount === 1
              ? 'One run was cancelled.'
              : `${String(canceledCount)} runs were cancelled.`,
        });
      }}
    >
      <FormField label="Runs of versions before">
        {(control) => (
          <select
            {...control}
            name="before-version-id"
            required
            defaultValue={versions[0]?.id ?? ''}
            className={controlClassName(control)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {`Version ${String(version.number)}`}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </ConfirmActionButton>
  );
}
