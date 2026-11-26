'use server';

/**
 * Saves the operator's notification channels (C169.7; a session, no permission). Every kind is
 * sent with both channels, a ticked box meaning on, so the stored choices are exactly the form's.
 */
import { USER_NOTIFICATION_KINDS } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { runAction } from '../../lib/api/action';
import {
  updateNotificationPreferences,
  type NotificationPreferences,
} from '../../lib/api/notifications';

export async function saveNotificationPreferences(
  _previous: ActionState<NotificationPreferences>,
  formData: FormData,
): Promise<ActionResult<NotificationPreferences>> {
  return runAction({}, async () => {
    const changes = Object.fromEntries(
      USER_NOTIFICATION_KINDS.map((kind) => [
        kind,
        {
          console: formData.get(`${kind}.console`) === 'on',
          email: formData.get(`${kind}.email`) === 'on',
        },
      ]),
    ) as unknown as NotificationPreferences;
    const saved = await updateNotificationPreferences(changes);
    revalidatePath('/notifications');
    return saved;
  });
}
