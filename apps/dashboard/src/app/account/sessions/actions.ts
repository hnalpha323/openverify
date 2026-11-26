'use server';

/**
 * The operator's own sessions (C168.4; a session, no permission): sign out one, or every other.
 */
import { idSchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { ActionInputError, formString, runAction } from '../../../lib/api/action';
import { revokeMySession, revokeOtherSessions as revokeOthers } from '../../../lib/api/sessions';
import { SETTINGS_COPY } from '../../../lib/copy/settings';

const SESSIONS_PATH = '/account/sessions';

/** Signs out one of the operator's sessions. */
export async function revokeSession(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({}, async () => {
    const parsed = idSchema('uss').safeParse(formString(formData, 'session-id'));
    if (!parsed.success) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        errors: [{ pointer: '/session-id', detail: SETTINGS_COPY.sessions.sessionIdHint }],
      });
    }
    await revokeMySession(parsed.data);
    revalidatePath(SESSIONS_PATH);
    return undefined;
  });
}

/** Signs out every session but this one; answers how many ended. */
export async function revokeOtherSessions(): Promise<ActionResult<number>> {
  return runAction({}, async () => {
    const revoked = await revokeOthers();
    revalidatePath(SESSIONS_PATH);
    return revoked;
  });
}
