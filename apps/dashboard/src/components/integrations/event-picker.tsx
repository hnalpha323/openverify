'use client';

import { Checkbox } from '@openverify/ui';
import { useId, useState } from 'react';

/** Subscribes a webhook to every event (C5, C14). */
const ALL_EVENTS = '*';

export interface EventPickerGroup {
  /** The resource the events are about, such as "Inquiry". */
  readonly label: string;
  readonly names: readonly string[];
}

export interface EventPickerProps {
  /** Every event name, grouped by subject (`eventNameGroups()` on the server). */
  readonly groups: readonly EventPickerGroup[];
  /** The webhook's `enabled-events`. */
  readonly defaultValue?: readonly string[];
  /** The field's error, such as `errorsUnder(problem, '/data/attributes/enabled-events')`. */
  readonly error?: string | undefined;
}

/**
 * The events a webhook receives, posted as repeated `enabled-events`. "All events" posts `*`
 * alone: the other boxes are disabled meanwhile, so they are not sent.
 */
export function EventPicker({ groups, defaultValue = [], error }: EventPickerProps) {
  const id = useId();
  const [all, setAll] = useState(defaultValue.includes(ALL_EVENTS));
  const errorId = `${id}-error`;

  return (
    <fieldset
      aria-describedby={error === undefined ? undefined : errorId}
      className="flex flex-col gap-4"
    >
      <legend className="mb-2 text-sm font-medium text-ink">Events</legend>
      <Checkbox
        name="enabled-events"
        value={ALL_EVENTS}
        label="All events"
        description="Including events added in later versions."
        checked={all}
        onChange={(event) => {
          setAll(event.currentTarget.checked);
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group.label} className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {group.label}
            </legend>
            {group.names.map((name) => (
              <Checkbox
                key={name}
                name="enabled-events"
                value={name}
                label={<code className="font-mono text-xs">{name}</code>}
                defaultChecked={defaultValue.includes(name)}
                disabled={all}
              />
            ))}
          </fieldset>
        ))}
      </div>
      {error !== undefined && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
