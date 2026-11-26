'use client';

import { Button } from '@openverify/ui';
import { useId, useState, type ReactNode } from 'react';

export interface JsonEditorProps {
  readonly label: string;
  /** The form field the text is posted as; the server action parses it. */
  readonly name: string;
  readonly defaultValue?: string;
  readonly description?: ReactNode;
  /**
   * The API's errors for this document, by JSON Pointer (from the action's problem), each with
   * the place it points at in words where the form knows them (`label`).
   */
  readonly errors?: readonly {
    readonly pointer: string;
    readonly detail: string;
    readonly label?: string | undefined;
  }[];
  readonly rows?: number;
  readonly required?: boolean;
  readonly onChange?: (value: string) => void;
}

/**
 * Where a JSON syntax error is, as "line L, column C: message". V8 names a `position`, and
 * newer engines also the line and column.
 */
export function describeJsonError(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const base = message
    .replace(/\s*\(line \d+ column \d+\)/, '')
    .replace(/\s+at position \d+/, '')
    .trim();
  const named = /\(line (\d+) column (\d+)\)/.exec(message);
  if (named !== null) {
    return `line ${named[1] ?? ''}, column ${named[2] ?? ''}: ${base}`;
  }
  const position = /at position (\d+)/.exec(message);
  if (position === null) {
    return base;
  }
  const before = text.slice(0, Number(position[1]));
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return `line ${String(line)}, column ${String(column)}: ${base}`;
}

type Verdict = { readonly ok: boolean; readonly message: string } | null;

/**
 * A monospaced text area for a JSON document (C23: no editor dependency), with Format and
 * Validate buttons. The API stays the judge of the document's content; its errors show here by
 * path.
 */
export function JsonEditor({
  label,
  name,
  defaultValue = '',
  description,
  errors = [],
  rows = 16,
  required = false,
  onChange,
}: JsonEditorProps) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const verdictId = `${id}-verdict`;
  const errorsLabelId = `${id}-errors`;
  const errorsListId = `${id}-error-list`;
  const invalid = verdict?.ok === false || errors.length > 0;

  /** The parsed document, or `undefined` after reporting where the syntax breaks. */
  function parse(): { readonly document: unknown } | undefined {
    try {
      return { document: JSON.parse(value) };
    } catch (error) {
      setVerdict({ ok: false, message: `Not valid JSON: ${describeJsonError(value, error)}` });
      return undefined;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {descriptionId !== undefined && (
        <p id={descriptionId} className="text-sm text-ink-muted">
          {description}
        </p>
      )}
      <textarea
        id={id}
        name={name}
        value={value}
        rows={rows}
        required={required}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={invalid || undefined}
        aria-describedby={
          [
            descriptionId,
            verdict?.ok === false ? verdictId : undefined,
            // The heading and the details, so the problems are read out, not only named
            // (Workflow 2E F013).
            errors.length > 0 ? `${errorsLabelId} ${errorsListId}` : undefined,
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          setVerdict(null);
          onChange?.(next);
        }}
        className={`w-full rounded-md border bg-surface px-3 py-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${invalid ? 'border-danger' : 'border-control'}`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            const parsed = parse();
            if (parsed !== undefined) {
              const formatted = JSON.stringify(parsed.document, null, 2);
              setValue(formatted);
              setVerdict({ ok: true, message: 'Formatted.' });
              onChange?.(formatted);
            }
          }}
        >
          Format
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (parse() !== undefined) {
              setVerdict({ ok: true, message: 'Valid JSON.' });
            }
          }}
        >
          Validate
        </Button>
        <p role="status" className="text-sm text-ink-muted">
          {verdict?.ok === true ? verdict.message : ''}
        </p>
      </div>
      {verdict?.ok === false && (
        <p id={verdictId} role="alert" className="text-sm font-medium text-danger">
          {verdict.message}
        </p>
      )}
      {errors.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <p id={errorsLabelId} className="font-medium text-danger">
            Problems in {label}
          </p>
          <ul id={errorsListId} aria-labelledby={errorsLabelId} className="flex flex-col gap-1">
            {errors.map((error) => (
              <li key={`${error.pointer}:${error.detail}`}>
                {error.label !== undefined && (
                  <span className="block font-medium text-ink">{error.label}</span>
                )}
                <code className="font-mono text-xs">{error.pointer}</code>: {error.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
