'use client';

/**
 * The outline menu's dialogs (C141.2): setting the trigger, connecting a path to one of the
 * targets the shared port rules accept, and confirming a delete. Each is a modal `Dialog`, so focus
 * moves in and returns to what opened it.
 */
import { WORKFLOW_TRIGGER_TYPES } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useId, useState, type ReactNode } from 'react';
import { Dialog } from '../../dialog';
import { WORKFLOW_TRIGGER_TYPE_WORDS, wordOf } from '../workflow-words';

const RADIO =
  'mt-0.5 size-6 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Choices({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly { readonly value: string; readonly label: ReactNode }[];
  readonly value: string | null;
  readonly onChange: (value: string) => void;
}) {
  const base = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          htmlFor={`${base}-${option.value}`}
          className="flex items-start gap-3 text-sm"
        >
          <input
            id={`${base}-${option.value}`}
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value);
            }}
            className={RADIO}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

/** The trigger types offered, each with its words. */
export interface TriggerDialogProps {
  readonly open: boolean;
  readonly current: string | null;
  readonly onClose: () => void;
  readonly onSet: (type: string) => void;
}

function TriggerForm({ current, onClose, onSet }: Omit<TriggerDialogProps, 'open'>) {
  const [type, setType] = useState<string>(current ?? WORKFLOW_TRIGGER_TYPES[0]);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSet(type);
      }}
    >
      <Choices
        legend="Trigger"
        name="trigger-type"
        value={type}
        onChange={setType}
        options={WORKFLOW_TRIGGER_TYPES.map((value) => ({
          value,
          label: wordOf(WORKFLOW_TRIGGER_TYPE_WORDS, value),
        }))}
      />
      <p className="text-sm text-ink-muted">
        A new type starts with the settings its schema needs; change them in the definition.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">Set trigger</Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Set the trigger" (C118, C141.2). */
export function TriggerDialog({ open, ...props }: TriggerDialogProps) {
  return (
    <Dialog open={open} onClose={props.onClose} title="Set the trigger">
      <TriggerForm {...props} />
    </Dialog>
  );
}

export interface ConnectTarget {
  readonly id: string;
  readonly label: string;
}

export interface ConnectDialogProps {
  readonly open: boolean;
  /** What is connected, in words ("Next of Wait for a time"). */
  readonly source: string;
  /** Each port of the source, with the targets the port rules accept for it. */
  readonly ports: readonly {
    readonly port: string;
    readonly label: string;
    readonly current: string | null;
    readonly targets: readonly ConnectTarget[];
  }[];
  readonly onClose: () => void;
  readonly onConnect: (port: string, target: string) => void;
}

function ConnectForm({ source, ports, onClose, onConnect }: Omit<ConnectDialogProps, 'open'>) {
  const base = useId();
  const [port, setPort] = useState(ports[0]?.port ?? '');
  const shown = ports.find((candidate) => candidate.port === port);
  const [chosen, setChosen] = useState<string | null>(null);
  const targets = shown?.targets ?? [];
  const target =
    targets.find((candidate) => candidate.id === chosen)?.id ??
    targets.find((candidate) => candidate.id === shown?.current)?.id ??
    targets[0]?.id ??
    null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (target !== null) {
          onConnect(port, target);
        }
      }}
    >
      <p className="text-sm">From {source}.</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${base}-port`} className="text-sm font-medium">
          Path
        </label>
        <select
          id={`${base}-port`}
          value={port}
          onChange={(event) => {
            setPort(event.currentTarget.value);
            setChosen(null);
          }}
          className="min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {ports.map((candidate) => (
            <option key={candidate.port} value={candidate.port}>
              {candidate.label}
            </option>
          ))}
        </select>
      </div>
      {targets.length === 0 ? (
        <p className="text-sm">
          No step can follow this path: every other step would make a cycle or is the start.
        </p>
      ) : (
        <Choices
          legend="Leads to"
          name="connect-target"
          value={target}
          onChange={setChosen}
          options={targets.map((candidate) => ({
            value: candidate.id,
            label:
              candidate.id === shown?.current
                ? `${candidate.label} (leads here now)`
                : candidate.label,
          }))}
        />
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={target === null}>
          Connect
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Connect next step to" (C141.2): valid targets only. */
export function ConnectDialog({ open, ...props }: ConnectDialogProps) {
  return (
    <Dialog open={open} onClose={props.onClose} title="Connect a path">
      <ConnectForm {...props} />
    </Dialog>
  );
}

export interface DeleteDialogProps {
  readonly open: boolean;
  readonly step: string;
  /** What else goes with it, or is left unconnected, in words. */
  readonly consequence: string;
  readonly onClose: () => void;
  readonly onDelete: () => void;
}

/** "Delete" (C141.2), always confirmed. */
export function DeleteDialog({ open, step, consequence, onClose, onDelete }: DeleteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={`Delete ${step}?`} description={consequence}>
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
