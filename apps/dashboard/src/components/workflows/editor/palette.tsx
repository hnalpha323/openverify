'use client';

/**
 * The palette as a dialog (C141.4, editor note 2.3): the step types and every catalogue action as
 * radio buttons in two groups, narrowed by a filter. An action the environment cannot run says
 * "not configured" with its reason and can still be added (publishing then warns, and a run that
 * reaches it errors, C122.5); one that does not serve the trigger says so and cannot be chosen.
 */
import { Button } from '@openverify/ui';
import { useId, useState } from 'react';
import { Dialog } from '../../dialog';
import type { StepTemplate } from './document-model';
import type { PaletteEntry } from './palette-model';

export interface PaletteDialogProps {
  readonly open: boolean;
  /** Where the step goes, in words ("after Trigger: The API"). */
  readonly place: string;
  readonly entries: readonly PaletteEntry[];
  readonly onClose: () => void;
  readonly onAdd: (template: StepTemplate, label: string) => void;
}

const GROUPS = [
  { group: 'steps', legend: 'Steps' },
  { group: 'actions', legend: 'Actions' },
  { group: 'templates', legend: 'Decision templates' },
] as const;

function matches(entry: PaletteEntry, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  return (
    wanted === '' ||
    entry.label.toLowerCase().includes(wanted) ||
    entry.id.toLowerCase().includes(wanted.replaceAll(' ', '_'))
  );
}

function PaletteForm({ place, entries, onClose, onAdd }: Omit<PaletteDialogProps, 'open'>) {
  const base = useId();
  const [filter, setFilter] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = entries.filter((entry) => matches(entry, filter));
  const selectable = shown.filter((entry) => entry.refusal === null);
  const current = selectable.find((entry) => entry.id === chosen) ?? selectable[0];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (current !== undefined) {
          onAdd(current.template, current.label);
        }
      }}
    >
      <p className="text-sm">Adds it {place}.</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${base}-filter`} className="text-sm font-medium">
          Filter
        </label>
        <input
          id={`${base}-filter`}
          type="search"
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
          className="min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      </div>
      {shown.length === 0 && <p className="text-sm">Nothing matches the filter.</p>}
      <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
        {GROUPS.map(({ group, legend }) => {
          const members = shown.filter((entry) => entry.group === group);
          if (members.length === 0) {
            return null;
          }
          return (
            <fieldset key={group} className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">{legend}</legend>
              {members.map((entry) => {
                const id = `${base}-${entry.id}`;
                return (
                  <div key={entry.id} className="flex items-start gap-3">
                    <input
                      id={id}
                      type="radio"
                      name="palette-entry"
                      value={entry.id}
                      checked={current?.id === entry.id}
                      disabled={entry.refusal !== null}
                      aria-describedby={`${id}-detail`}
                      onChange={() => {
                        setChosen(entry.id);
                      }}
                      className="mt-0.5 size-6 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    />
                    <div className="flex flex-col gap-0.5 text-sm">
                      <label htmlFor={id} className="font-medium">
                        {entry.label}
                        {entry.beta && (
                          <span className="ml-2 rounded border border-line px-1.5 text-xs">
                            Beta
                          </span>
                        )}
                      </label>
                      <span id={`${id}-detail`} className="text-ink-muted">
                        {entry.detail}
                        {entry.notConfigured !== null && (
                          <span className="block font-medium text-ink">{entry.notConfigured}</span>
                        )}
                        {entry.refusal !== null && (
                          <span className="block font-medium text-ink">{entry.refusal}</span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={current === undefined}>
          Add step
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The palette as a dialog (C141.4). */
export function PaletteDialog({ open, ...props }: PaletteDialogProps) {
  return (
    <Dialog open={open} onClose={props.onClose} title="Add a step" size="lg">
      <PaletteForm {...props} />
    </Dialog>
  );
}
