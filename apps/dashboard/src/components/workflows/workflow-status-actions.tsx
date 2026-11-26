'use client';

/**
 * Pause, activate and archive (C112.6, C121.5) with `workflows:write`, each behind a confirmation.
 * Archive needs a paused workflow, as the public product does; activate of a workflow its
 * publisher's rights no longer cover answers 409 until someone holding them republishes.
 */
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';

const ACTIONS = {
  pause: {
    label: 'Pause',
    title: 'Pause this workflow?',
    description: 'No new run starts. Runs in progress continue.',
    success: 'The workflow was paused.',
  },
  activate: {
    label: 'Activate',
    title: 'Activate this workflow?',
    description: 'New runs start from its live published version.',
    success: 'The workflow was activated.',
  },
  archive: {
    label: 'Archive',
    title: 'Archive this workflow?',
    description: 'It stops for good. Its runs and versions stay readable.',
    success: 'The workflow was archived.',
  },
} as const;

export type WorkflowStatusAction = keyof typeof ACTIONS;

export function WorkflowStatusActions({
  workflowId,
  actions,
  action,
}: {
  readonly workflowId: string;
  readonly actions: readonly WorkflowStatusAction[];
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  return (
    <div role="group" aria-label="Workflow actions" className="flex flex-wrap gap-3">
      {actions.map((name) => {
        const words = ACTIONS[name];
        return (
          <ConfirmActionButton
            key={name}
            label={words.label}
            variant="secondary"
            tone={name === 'archive' ? 'danger' : 'primary'}
            title={words.title}
            description={words.description}
            confirmLabel={words.label}
            action={action}
            fields={{ 'workflow-id': workflowId, action: name }}
            successMessage={words.success}
          />
        );
      })}
    </div>
  );
}
