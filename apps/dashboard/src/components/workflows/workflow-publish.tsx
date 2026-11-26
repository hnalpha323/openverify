'use client';

/**
 * Publishing with acknowledgements and the rollout controls (C116.3, C116.4, C141.5). The publish
 * form sends the rollout percentage and the change note; when the API answers that steps need an
 * acknowledgement, the form lists each one with its reason and the step it concerns, unticked, and
 * publishes only what the operator ticked. Finish and undo of a rollout sit behind a confirmation.
 */
import { Checkbox } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { FormField, controlClassName } from '../form-field';
import { FormDialogButton } from '../integrations/form-dialog-button';
import { WORKFLOW_ACKNOWLEDGEMENT_WORDS, wordOf } from './workflow-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const MISSING = 'publish_acknowledgement_missing';

/** The keys the API asked for (`<kind>:<step id>`), in its order, without repeats. */
function requiredOf(problem: DisplayProblem | undefined): string[] {
  if (problem?.code !== MISSING) {
    return [];
  }
  return [
    ...new Set(
      (problem.errors ?? [])
        .filter((error) => error.pointer === '/meta/acknowledgements')
        .map((error) => error.detail),
    ),
  ];
}

function reasonOf(key: string): string {
  const separator = key.indexOf(':');
  const kind = separator === -1 ? key : key.slice(0, separator);
  const step = separator === -1 ? '' : key.slice(separator + 1);
  return `${wordOf(WORKFLOW_ACKNOWLEDGEMENT_WORDS, kind)} (${step})`;
}

export function PublishDraftButton({
  workflowId,
  action,
}: {
  readonly workflowId: string;
  readonly action: Action;
}) {
  return (
    <FormDialogButton
      label="Publish the draft"
      variant="primary"
      title="Publish the draft"
      description="The draft becomes a published version and stops being editable. Runs start from it once the workflow is running."
      submitLabel="Publish"
      pendingLabel="Publishing…"
      action={action}
      fields={{ 'workflow-id': workflowId }}
      successMessage="The draft was published."
    >
      {(problem) => {
        const required = requiredOf(problem);
        return (
          <>
            <FormField
              label="Rollout percentage"
              description="Leave empty to publish to every new run. Below 100, the rest keep the live version until you finish or undo the rollout."
            >
              {(control) => (
                <input
                  {...control}
                  type="number"
                  name="rollout-percentage"
                  min={1}
                  max={100}
                  step={1}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField label="Change note">
              {(control) => (
                <textarea
                  {...control}
                  name="description"
                  maxLength={500}
                  rows={2}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            {required.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">
                  These steps need your acknowledgement before publishing
                </legend>
                {required.map((key) => (
                  <Checkbox key={key} name="acknowledgement" value={key} label={reasonOf(key)} />
                ))}
              </fieldset>
            )}
          </>
        );
      }}
    </FormDialogButton>
  );
}

/** C116.3: a rollout in progress, finished (100%) or undone (0%) with `workflows:publish`. */
export function RolloutActions({
  workflowId,
  percentage,
  action,
}: {
  readonly workflowId: string;
  readonly percentage: number | null;
  readonly action: Action | undefined;
}) {
  return (
    <div role="group" aria-label="Rollout" className="flex flex-col gap-3">
      <p className="text-sm">
        {percentage === null
          ? 'A rollout is in progress.'
          : `${String(percentage)}% of new runs use the new version.`}
      </p>
      {action !== undefined && (
        <div className="flex flex-wrap gap-3">
          <ConfirmActionButton
            label="Finish the rollout"
            variant="secondary"
            tone="primary"
            title="Finish the rollout?"
            description="Every new run uses the new version."
            confirmLabel="Finish the rollout"
            action={action}
            fields={{ 'workflow-id': workflowId, 'rollout-percentage': '100' }}
            successMessage="The rollout was finished."
          />
          <ConfirmActionButton
            label="Undo the rollout"
            title="Undo the rollout?"
            description="Every new run uses the previous version again. Runs already started keep their version."
            confirmLabel="Undo the rollout"
            action={action}
            fields={{ 'workflow-id': workflowId, 'rollout-percentage': '0' }}
            successMessage="The rollout was undone."
          />
        </div>
      )}
    </div>
  );
}

/** C116.5: makes a draft from version `versionNumber` and opens it, behind a confirmation. */
export function RestoreVersionButton({
  workflowId,
  versionId,
  versionNumber,
  action,
}: {
  readonly workflowId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly action: (
    state: ActionState<{ readonly workflowId: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ readonly workflowId: string }>>;
}) {
  const router = useRouter();
  return (
    <ConfirmActionButton
      label={`Restore version ${String(versionNumber)}`}
      variant="secondary"
      tone="primary"
      title={`Restore version ${String(versionNumber)}?`}
      description="Its definition becomes the draft, replacing any draft there is. It goes live only once the draft is published, under every publish rule."
      confirmLabel="Restore"
      action={action}
      fields={{ 'workflow-id': workflowId, 'version-id': versionId }}
      successMessage="The version was restored as the draft."
      onSuccess={() => {
        router.push(`/workflows/${workflowId}/draft`);
      }}
    />
  );
}
