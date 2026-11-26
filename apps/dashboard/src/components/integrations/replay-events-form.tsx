'use client';

import { Alert, Button, Checkbox } from '@openverify/ui';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import type { ReplayedEvents } from './action-data';
import { errorsUnder } from './form-errors';

export type { ReplayedEvents } from './action-data';

export interface ReplayEventsFormProps {
  readonly webhookId: string;
  readonly action: (
    state: ActionState<ReplayedEvents>,
    formData: FormData,
  ) => Promise<ActionResult<ReplayedEvents>>;
}

type ReplayBy = 'event-ids' | 'range';

function replayedMessage(count: number): string {
  if (count === 0) {
    return 'No event matched: nothing will be delivered again.';
  }
  return count === 1
    ? '1 event will be delivered again.'
    : `${String(count)} events will be delivered again.`;
}

const RADIO_CLASS =
  'size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Delivers past events to a webhook again, as new deliveries (C14 replay): named by ID, or
 * created in a UTC time range, optionally only those whose delivery failed.
 */
export function ReplayEventsForm({ webhookId, action }: ReplayEventsFormProps) {
  const [replayBy, setReplayBy] = useState<ReplayBy>('event-ids');
  const [count, setCount] = useState<number | null>(null);
  const submit = useFormAction(action, {
    onSuccess: (data) => {
      setCount(data.replayedCount);
    },
  });
  const error = (member: string) => errorsUnder(submit.problem, `/meta/${member}`);

  return (
    <form
      {...submit.formProps}
      onSubmit={(event) => {
        setCount(null);
        submit.formProps.onSubmit(event);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="webhook-id" value={webhookId} />
      <fieldset className="flex flex-wrap gap-6">
        <legend className="mb-2 text-sm font-medium text-ink">Choose the events</legend>
        {(
          [
            ['event-ids', 'By event ID'],
            ['range', 'By time range'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="replay-by"
              value={value}
              checked={replayBy === value}
              onChange={() => {
                setReplayBy(value);
              }}
              className={RADIO_CLASS}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {replayBy === 'event-ids' ? (
        <FormField
          label="Event IDs"
          description="Up to 100, separated by commas, spaces or new lines."
          error={error('event-ids')}
        >
          {(control) => (
            <textarea
              {...control}
              name="event-ids"
              rows={3}
              spellCheck={false}
              className={`${controlClassName(control)} font-mono text-sm`}
            />
          )}
        </FormField>
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <FormField label="From (UTC)" error={error('created-at-start')}>
            {(control) => (
              <input
                {...control}
                type="datetime-local"
                name="created-at-start"
                className={controlClassName(control)}
              />
            )}
          </FormField>
          <FormField label="To (UTC)" error={error('created-at-end')}>
            {(control) => (
              <input
                {...control}
                type="datetime-local"
                name="created-at-end"
                className={controlClassName(control)}
              />
            )}
          </FormField>
          <Checkbox name="only-failed" value="true" label="Only events whose delivery failed" />
        </div>
      )}
      <p className="text-sm text-ink-muted">
        At most 1,000 events, oldest first. Events this webhook does not subscribe to, and simulated
        events, are skipped.
      </p>
      <ProblemDisplay problem={submit.problem} />
      <div>
        <Button type="submit" variant="secondary" disabled={submit.pending}>
          {submit.pending ? 'Replaying…' : 'Replay'}
        </Button>
      </div>
      {count !== null && <Alert tone="success">{replayedMessage(count)}</Alert>}
    </form>
  );
}
