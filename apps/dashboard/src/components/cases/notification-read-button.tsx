'use client';

import { Button } from '@openverify/ui';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { problemSentence } from '../lifecycle/tag-editor';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

/** Marks one notification read; a refusal shows as a toast (C134.4). */
export function NotificationReadButton({
  notificationId,
  label,
  action,
}: {
  readonly notificationId: string;
  /** What the notification is, for the button's accessible name (WCAG 2.4.6). */
  readonly label: string;
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onProblem: (problem) => {
      show({ tone: 'error', message: problemSentence(problem) });
    },
  });
  return (
    <form {...form.formProps}>
      <input type="hidden" name="notification-id" value={notificationId} />
      <Button
        type="submit"
        variant="secondary"
        disabled={form.pending}
        aria-label={`Mark as read: ${label}`}
      >
        {form.pending ? 'Marking…' : 'Mark as read'}
      </Button>
    </form>
  );
}
