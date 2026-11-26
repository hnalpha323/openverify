'use client';

import { Alert, Button } from '@openverify/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import type { SimulatedEvent } from './action-data';
import type { EventPickerGroup } from './event-picker';
import { errorsUnder } from './form-errors';

export type { SimulatedEvent } from './action-data';

export interface SimulateEventFormProps {
  readonly webhookId: string;
  /** Every event name, grouped by subject (`eventNameGroups()` on the server). */
  readonly groups: readonly EventPickerGroup[];
  readonly action: (
    state: ActionState<SimulatedEvent>,
    formData: FormData,
  ) => Promise<ActionResult<SimulatedEvent>>;
  /** Whether the operator may open the event (`events:read`). */
  readonly canSeeEvents: boolean;
}

/**
 * Sends a webhook a sample event (C14 simulate): built from synthetic fixtures, flagged
 * `simulated`, and delivered to this webhook only.
 */
export function SimulateEventForm({
  webhookId,
  groups,
  action,
  canSeeEvents,
}: SimulateEventFormProps) {
  const [sent, setSent] = useState<string | null>(null);
  const submit = useFormAction(action, {
    onSuccess: (data) => {
      setSent(data.eventId);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <form
        {...submit.formProps}
        onSubmit={(event) => {
          setSent(null);
          submit.formProps.onSubmit(event);
        }}
        noValidate
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="webhook-id" value={webhookId} />
        <FormField
          label="Event"
          error={errorsUnder(submit.problem, '/meta/event-name')}
          className="min-w-64"
        >
          {(control) => (
            <select {...control} name="event-name" className={controlClassName(control)}>
              {groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </FormField>
        <Button type="submit" variant="secondary" disabled={submit.pending}>
          {submit.pending ? 'Sending…' : 'Send test event'}
        </Button>
      </form>
      <ProblemDisplay problem={submit.problem} />
      {sent !== null && (
        <Alert tone="success">
          Test event{' '}
          {canSeeEvents ? (
            <Link href={`/events/${sent}`} className={LINK_CLASS}>
              <code className="font-mono text-xs">{sent}</code>
            </Link>
          ) : (
            <code className="font-mono text-xs">{sent}</code>
          )}{' '}
          sent. Its delivery appears in the list below.
        </Alert>
      )}
    </div>
  );
}
