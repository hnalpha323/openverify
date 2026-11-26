'use client';

import { USER_NOTIFICATION_KINDS } from '@openverify/core';
import type { ActionResult, ActionState } from '../../lib/action-state';
import type { NotificationPreferences } from '../../lib/api/notifications';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

export interface NotificationPreferencesFormProps {
  readonly preferences: NotificationPreferences;
  readonly action: (
    previous: ActionState<NotificationPreferences>,
    formData: FormData,
  ) => Promise<ActionResult<NotificationPreferences>>;
}

const COPY = SETTINGS_COPY.notifications;
const BOX =
  'size-6 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * C169.7: a table of the notification kinds with a console and an email box each (24 px targets,
 * each box named by its kind and channel), saved together. It says what the choices apply to today
 * and what an email holds.
 */
export function NotificationPreferencesForm({
  preferences,
  action,
}: NotificationPreferencesFormProps) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: COPY.saved });
    },
  });
  return (
    <form {...formProps} className="flex flex-col gap-4">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{COPY.tableCaption}</caption>
        <thead>
          <tr className="border-b border-line text-start">
            <th scope="col" className="py-2 pe-4 text-start font-semibold">
              {COPY.kindColumn}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {COPY.consoleColumn}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {COPY.emailColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {USER_NOTIFICATION_KINDS.map((kind) => {
            const words = COPY.kinds[kind];
            return (
              <tr key={kind} className="border-b border-line">
                <th scope="row" className="py-3 pe-4 text-start font-normal">
                  {words}
                </th>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    name={`${kind}.console`}
                    aria-label={COPY.consoleLabel(words)}
                    defaultChecked={preferences[kind].console}
                    className={BOX}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    name={`${kind}.email`}
                    aria-label={COPY.emailLabel(words)}
                    defaultChecked={preferences[kind].email}
                    className={BOX}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm text-ink-muted">{COPY.emailNote}</p>
      <p className="text-sm text-ink-muted">{COPY.appliedNote}</p>
      <ProblemDisplay problem={problem} />
      <div>
        <SubmitButton pending={pending} pendingLabel={COPY.saving}>
          {COPY.save}
        </SubmitButton>
      </div>
    </form>
  );
}
