'use client';

/**
 * The flow builder's dialogs (C155.2, C155.4, C155.6): the palette of step types (each refusal in
 * words, never a silent absence), the connect dialog (only the targets the format allows), delete
 * with confirmation, the 412 "reload the latest draft" with what changed on the server, and publish
 * with every acknowledgement and its reason. Each is a modal `Dialog`: focus moves in and back.
 */
import { Button } from '@openverify/ui';
import { useId, useState } from 'react';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import { Dialog } from '../dialog';
import type { FlowPaletteEntry } from './flow-adapter';
import type { ModuleOffer } from './flow-modules';

const copy = FLOW_BUILDER_COPY.dialogs;

const OPTION =
  'flex min-h-11 w-full flex-col items-start rounded-md border border-line px-3 py-2 text-start text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-disabled:cursor-not-allowed aria-disabled:opacity-70';

export function PaletteDialog({
  open,
  after,
  entries,
  onPick,
  onClose,
}: {
  readonly open: boolean;
  readonly after: string;
  readonly entries: readonly FlowPaletteEntry[];
  readonly onPick: (entry: FlowPaletteEntry) => void;
  readonly onClose: () => void;
}) {
  const base = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.palette(after)}
      description={copy.paletteDescription}
    >
      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {entries.map((entry) => {
          const reasonId = `${base}-${entry.type}`;
          return (
            <li key={entry.type}>
              <button
                type="button"
                className={OPTION}
                aria-disabled={entry.refusal === null ? undefined : true}
                {...(entry.refusal === null ? {} : { 'aria-describedby': reasonId })}
                onClick={() => {
                  if (entry.refusal === null) {
                    onPick(entry);
                  }
                }}
              >
                <span className="font-semibold">{entry.label}</span>
                {entry.refusal !== null && (
                  <span id={reasonId} className="text-ink-muted">
                    {entry.refusal}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" onClick={onClose}>
        {copy.cancel}
      </Button>
    </Dialog>
  );
}

/**
 * C155.4, C155.11: the modules at a place, each with what it inserts as its description, and a
 * refused one with its reason; the explanation-screen choice applies to the verification modules.
 */
export function ModuleDialog({
  open,
  after,
  offers,
  explanation,
  onExplanation,
  onPick,
  onClose,
}: {
  readonly open: boolean;
  readonly after: string;
  readonly offers: readonly ModuleOffer[];
  readonly explanation: boolean;
  readonly onExplanation: (explanation: boolean) => void;
  readonly onPick: (offer: ModuleOffer) => void;
  readonly onClose: () => void;
}) {
  const base = useId();
  const words = FLOW_BUILDER_COPY.modules;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={words.dialog(after)}
      description={words.dialogDescription}
    >
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={explanation}
          onChange={(event) => {
            onExplanation(event.currentTarget.checked);
          }}
          className="size-6"
        />
        {words.explanation}
      </label>
      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {offers.map((offer) => {
          const describedBy = `${base}-${offer.key}`;
          return (
            <li key={offer.key}>
              <button
                type="button"
                className={OPTION}
                aria-disabled={offer.refusal === null ? undefined : true}
                aria-describedby={describedBy}
                onClick={() => {
                  if (offer.refusal === null) {
                    onPick(offer);
                  }
                }}
              >
                <span className="font-semibold">{offer.label}</span>
                <span id={describedBy} className="text-ink-muted">
                  {offer.refusal ?? offer.inserts}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" onClick={onClose}>
        {copy.cancel}
      </Button>
    </Dialog>
  );
}

export function ConnectDialog({
  open,
  title,
  targets,
  onConnect,
  onClose,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly targets: readonly { readonly id: string; readonly label: string }[];
  readonly onConnect: (target: string) => void;
  readonly onClose: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title={title} description={copy.connectDescription}>
      {targets.length === 0 ? (
        <p className="text-sm">{copy.connectNone}</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">{copy.connectTo}</legend>
          {targets.map((target) => (
            <label key={target.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="connect-target"
                value={target.id}
                checked={choice === target.id}
                onChange={() => {
                  setChoice(target.id);
                }}
                className="size-5"
              />
              {target.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={choice === null}
          onClick={() => {
            if (choice !== null) {
              onConnect(choice);
            }
          }}
        >
          {copy.connectConfirm}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </Dialog>
  );
}

export function DeleteDialog({
  open,
  label,
  onDelete,
  onClose,
}: {
  readonly open: boolean;
  readonly label: string;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.delete(label)}
      description={copy.deleteDescription}
    >
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" onClick={onDelete}>
          {copy.deleteConfirm}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </Dialog>
  );
}

export function ConflictDialog({
  open,
  changes,
  onReload,
}: {
  readonly open: boolean;
  readonly changes: readonly string[];
  readonly onReload: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onReload}
      title={copy.conflict}
      description={copy.conflictDescription}
      dismissible={false}
    >
      <ul className="list-disc ps-5 text-sm">
        {(changes.length === 0 ? [copy.conflictNone] : changes).map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      <Button onClick={onReload}>{copy.conflictReload}</Button>
    </Dialog>
  );
}

export interface PublishDialogState {
  readonly checking: boolean;
  readonly problems: readonly { readonly pointer: string; readonly detail: string }[];
  readonly acknowledgements: readonly string[];
}

export function PublishDialog({
  open,
  state,
  reasonOf,
  onPublish,
  onClose,
}: {
  readonly open: boolean;
  readonly state: PublishDialogState;
  readonly reasonOf: (key: string) => string;
  readonly onPublish: (acknowledgements: readonly string[], note: string) => void;
  readonly onClose: () => void;
}) {
  const base = useId();
  const [given, setGiven] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState('');
  const ready =
    !state.checking &&
    state.problems.length === 0 &&
    state.acknowledgements.every((key) => given.has(key));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.publish}
      description={copy.publishDescription}
    >
      {state.checking ? (
        <p className="text-sm">{copy.publishChecking}</p>
      ) : (
        <>
          {state.problems.length > 0 && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-semibold">{copy.publishProblems}</p>
              <ul className="list-disc ps-5">
                {state.problems.map((problem) => (
                  <li key={`${problem.pointer}:${problem.detail}`}>
                    <code className="font-mono text-xs">{problem.pointer}</code>: {problem.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.acknowledgements.length > 0 && (
            <fieldset className="flex flex-col gap-3 text-sm">
              <legend className="mb-2">{copy.publishAcknowledgements}</legend>
              {state.acknowledgements.map((key, index) => {
                const reasonId = `${base}-reason-${String(index)}`;
                return (
                  <label key={key} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 size-5"
                      aria-describedby={reasonId}
                      checked={given.has(key)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setGiven((previous) => {
                          const next = new Set(previous);
                          if (checked) {
                            next.add(key);
                          } else {
                            next.delete(key);
                          }
                          return next;
                        });
                      }}
                    />
                    <span className="flex flex-col">
                      <code className="font-mono text-xs">{key}</code>
                      <span id={reasonId} className="text-ink-muted">
                        {reasonOf(key)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${base}-note-input`} className="font-semibold">
              {copy.publishNote}
            </label>
            <input
              id={`${base}-note-input`}
              value={note}
              maxLength={255}
              aria-describedby={`${base}-note`}
              onChange={(event) => {
                setNote(event.currentTarget.value);
              }}
              className="min-h-11 rounded-md border border-control px-3"
            />
            <p id={`${base}-note`} className="text-ink-muted">
              {copy.publishNoteHint}
            </p>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!ready}
          onClick={() => {
            onPublish(
              state.acknowledgements.filter((key) => given.has(key)),
              note,
            );
          }}
        >
          {copy.publishConfirm}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </Dialog>
  );
}
