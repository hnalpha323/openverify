'use client';

import { MAX_WEBHOOK_CUSTOM_HEADERS } from '@openverify/contracts';
import { Button, Checkbox, Input } from '@openverify/ui';
import { useEffect, useId, useRef, useState } from 'react';

export interface CustomHeadersEditorProps {
  /**
   * On edit: the names of the stored headers. Their values are write-only (C14), so they are
   * kept unless the operator replaces the whole list. Leave out on create.
   */
  readonly existingNames?: readonly string[];
  /** The headers' error, such as `errorsUnder(problem, '/data/attributes/custom-headers')`. */
  readonly error?: string | undefined;
}

interface Row {
  readonly key: number;
}

/**
 * The custom headers a webhook sends with every delivery, as rows of name and value posted as
 * repeated `header-name` and `header-value`. On edit, `replace-custom-headers=true` is posted
 * only when the operator chose to replace the stored headers.
 */
export function CustomHeadersEditor({ existingNames, error }: CustomHeadersEditorProps) {
  const id = useId();
  const editing = existingNames !== undefined;
  const [replacing, setReplacing] = useState(!editing);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const nextKey = useRef(0);
  // Where focus goes once the rows render: a row's name, or Add a header (WCAG 2.4.3).
  const focusTarget = useRef<number | 'add' | null>(null);
  const nameInputs = useRef(new Map<number, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const full = rows.length >= MAX_WEBHOOK_CUSTOM_HEADERS;

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === 'add') {
      addButton.current?.focus();
    } else if (target !== null) {
      nameInputs.current.get(target)?.focus();
    }
  }, [rows]);

  return (
    <fieldset
      aria-describedby={[descriptionId, error === undefined ? undefined : errorId]
        .filter(Boolean)
        .join(' ')}
      className="flex flex-col gap-3"
    >
      <legend className="mb-1 text-sm font-medium text-ink">Custom headers</legend>
      <p id={descriptionId} className="text-sm text-ink-muted">
        Sent with every delivery, for example to authenticate it to your endpoint. Values are stored
        encrypted and never shown again.
      </p>
      {editing && (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-ink">Current headers</p>
            <p className="text-sm text-ink-muted">
              {existingNames.length === 0
                ? 'None.'
                : `${existingNames.join(', ')}. Their values are never shown again.`}
            </p>
          </div>
          <Checkbox
            name="replace-custom-headers"
            value="true"
            label="Replace the custom headers"
            description="The headers below replace every current one. Leave none to remove them all."
            checked={replacing}
            onChange={(event) => {
              setReplacing(event.currentTarget.checked);
            }}
          />
        </>
      )}
      {replacing && (
        <>
          {rows.map((row, index) => {
            const number = String(index + 1);
            return (
              <div key={row.key} className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-sm font-medium text-ink">
                  {`Header ${number} name`}
                  <Input
                    name="header-name"
                    autoComplete="off"
                    spellCheck={false}
                    ref={(element) => {
                      if (element === null) {
                        nameInputs.current.delete(row.key);
                      } else {
                        nameInputs.current.set(row.key, element);
                      }
                    }}
                  />
                </label>
                <label className="flex min-w-40 flex-[2] flex-col gap-1.5 text-sm font-medium text-ink">
                  {`Header ${number} value`}
                  <Input name="header-value" autoComplete="off" spellCheck={false} />
                </label>
                <Button
                  variant="secondary"
                  aria-label={`Remove header ${number}`}
                  onClick={() => {
                    // The row that moves into its place, else the one before it, else Add a
                    // header: focus stays on a control that remains.
                    const remaining = rows.filter((candidate) => candidate.key !== row.key);
                    const next = remaining[index] ?? remaining[index - 1];
                    focusTarget.current = next === undefined ? 'add' : next.key;
                    setRows(remaining);
                  }}
                >
                  Remove
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={addButton}
              variant="secondary"
              disabled={full}
              onClick={() => {
                const key = nextKey.current;
                nextKey.current += 1;
                focusTarget.current = key;
                setRows((current) => [...current, { key }]);
              }}
            >
              Add a header
            </Button>
            {full && (
              <p className="text-sm text-ink-muted">
                {`A webhook takes at most ${String(MAX_WEBHOOK_CUSTOM_HEADERS)} custom headers.`}
              </p>
            )}
          </div>
        </>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
