'use client';

/**
 * C153.1: one form engine for every template member and report template configuration. The fields
 * come from `z.toJSONSchema()` of the contract's own schema (`templateFieldsOf`), never from a list
 * written by hand, and the contract judges every value as it is typed (`problemsOf`), so a refused
 * value is said at its field before anything is sent (C153.5). A member may take a widget of its
 * own (a list picker, say) by its name. Read-only, the values are a description list.
 *
 * Accessibility (C171.2): every control is labelled by its member's name and described by its
 * hint, its note and its problem; a refusal is text at the field, never colour alone; paste is
 * allowed everywhere; every target is at least 24 CSS px.
 */
import { useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { z } from 'zod';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import {
  jsonSchemaOf,
  parseTemplateFieldText,
  problemsOf,
  templateFieldText,
  templateFieldsOf,
  type MemberProblem,
  type TemplateField,
} from './model';

const COPY = TEMPLATE_FORMS_COPY.schemaForm;

export interface SchemaWidgetProps {
  /** The id the field's label points at. */
  readonly id: string;
  /** The id of the field's label, for a widget that is a group (`aria-labelledby`). */
  readonly labelId: string;
  readonly field: TemplateField;
  readonly value: unknown;
  /** `undefined` leaves the member out. */
  readonly onValue: (value: unknown) => void;
  /** The ids of the hint, note and problem, for `aria-describedby`. */
  readonly describedBy: string;
  readonly invalid: boolean;
}

export type SchemaWidget = ComponentType<SchemaWidgetProps>;

export interface SchemaFormProps {
  /** The group's name, such as "Settings". */
  readonly legend: string;
  /** The contract's schema of the member: an object schema. */
  readonly schema: z.ZodType;
  readonly value: Readonly<Record<string, unknown>>;
  readonly onChange?: (value: Record<string, unknown>) => void;
  /** A control of its own for a member, by its name. */
  readonly widgets?: Readonly<Record<string, SchemaWidget>>;
  /** Words shown and read with a member's control, such as a warning. */
  readonly notes?: Readonly<Record<string, ReactNode>>;
  /** The API's errors, by JSON Pointer inside the member (`''` for the member itself). */
  readonly errors?: readonly MemberProblem[];
  readonly readOnly?: boolean;
}

export const CONTROL_CLASS =
  'min-h-11 w-full rounded-md border border-control bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60';

const inside = (pointer: string, name: string) =>
  pointer === `/${name}` || pointer.startsWith(`/${name}/`);

interface FieldProps {
  readonly field: TemplateField;
  readonly value: unknown;
  readonly onValue: (value: unknown) => void;
  readonly problems: readonly string[];
  readonly note: ReactNode;
  readonly widget: SchemaWidget | undefined;
}

function choicesOf(field: TemplateField): readonly (readonly [string, string])[] {
  return field.kind === 'boolean'
    ? [
        ['true', COPY.yes],
        ['false', COPY.no],
      ]
    : field.options.map((option) => [option, option] as const);
}

/** One member: its label, its control (or widget), its none switch, hint, note and problem. */
function SchemaField({ field, value, onValue, problems, note, widget: Widget }: FieldProps) {
  const id = useId();
  const [text, setText] = useState(() => templateFieldText(field, value));
  const [parseProblem, setParseProblem] = useState<string | null>(null);
  const kept = useRef<unknown>(value === null ? undefined : value);
  const none = value === null;
  const shown = parseProblem === null ? problems : [parseProblem];
  const invalid = shown.length > 0;
  // A widget is the whole control: it says what its value means, none included.
  const ownHint = Widget === undefined;
  const described = [
    ownHint ? `${id}-hint` : undefined,
    note === undefined ? undefined : `${id}-note`,
    invalid ? `${id}-problem` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' ');
  const label = field.required ? COPY.required(field.name) : field.name;

  const take = (next: string) => {
    setText(next);
    const parsed = parseTemplateFieldText(field, next);
    if (parsed.ok) {
      setParseProblem(null);
      kept.current = parsed.value;
      onValue(parsed.value);
    } else {
      setParseProblem(parsed.problem);
    }
  };

  const control =
    Widget !== undefined ? (
      <Widget
        id={id}
        labelId={`${id}-label`}
        field={field}
        value={value}
        onValue={(next) => {
          kept.current = next;
          onValue(next);
        }}
        describedBy={described}
        invalid={invalid}
      />
    ) : field.kind === 'boolean' || field.kind === 'enum' ? (
      <select
        id={id}
        value={text}
        disabled={none}
        aria-describedby={described}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          take(event.currentTarget.value);
        }}
        className={CONTROL_CLASS}
      >
        <option value="">{COPY.notSet}</option>
        {choicesOf(field).map(([option, words]) => (
          <option key={option} value={option}>
            {words}
          </option>
        ))}
      </select>
    ) : field.kind === 'json' ? (
      <textarea
        id={id}
        value={text}
        rows={4}
        disabled={none}
        spellCheck={false}
        aria-describedby={described}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          take(event.currentTarget.value);
        }}
        className={`${CONTROL_CLASS} py-2 font-mono`}
      />
    ) : (
      <input
        id={id}
        type="text"
        value={text}
        disabled={none}
        inputMode={
          field.kind === 'integer' ? 'numeric' : field.kind === 'number' ? 'decimal' : undefined
        }
        aria-describedby={described}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          take(event.currentTarget.value);
        }}
        className={CONTROL_CLASS}
      />
    );

  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {control}
      {field.nullable && ownHint && (
        <div className="flex items-center gap-2">
          <input
            id={`${id}-none`}
            type="checkbox"
            className="size-6"
            checked={none}
            aria-describedby={`${id}-none-hint`}
            onChange={(event) => {
              if (event.currentTarget.checked) {
                setParseProblem(null);
                onValue(null);
              } else {
                setText(templateFieldText(field, kept.current));
                onValue(kept.current);
              }
            }}
          />
          <label htmlFor={`${id}-none`} className="text-sm">
            {COPY.none(field.name)}
          </label>
          <span id={`${id}-none-hint`} className="sr-only">
            {COPY.noneHint}
          </span>
        </div>
      )}
      {ownHint && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {field.hint}
        </p>
      )}
      {note !== undefined && (
        <p id={`${id}-note`} className="text-sm">
          {note}
        </p>
      )}
      {invalid && (
        <p id={`${id}-problem`} className="text-sm font-medium text-danger">
          <span aria-hidden="true">⚠ </span>
          {COPY.problem}: {shown.join('. ')}
        </p>
      )}
    </div>
  );
}

/** A stored value in words, for the read-only form. */
function valueText(value: unknown): string {
  if (value === undefined) return COPY.readOnlyNotSet;
  if (value === null) return COPY.readOnlyNone;
  if (typeof value === 'boolean') return value ? COPY.yes : COPY.no;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

export function SchemaForm({
  legend,
  schema,
  value,
  onChange,
  widgets = {},
  notes = {},
  errors = [],
  readOnly = false,
}: SchemaFormProps): ReactNode {
  const fields = useMemo(() => templateFieldsOf(jsonSchemaOf(schema)), [schema]);

  if (readOnly) {
    return (
      <div role="group" aria-label={legend} className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{legend}</p>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,16rem)_1fr]">
          {fields.map((field) => (
            <div key={field.name} className="contents">
              <dt className="font-mono text-sm">{field.name}</dt>
              <dd className="text-sm break-words">{valueText(value[field.name])}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const problems = [...problemsOf(schema, value), ...errors];
  const rest = problems.filter(
    (problem) => !fields.some((field) => inside(problem.pointer, field.name)),
  );

  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="text-sm font-semibold">{legend}</legend>
      {rest.length > 0 && (
        <div className="text-sm font-medium text-danger">
          <p>
            <span aria-hidden="true">⚠ </span>
            {COPY.formProblems}
          </p>
          <ul className="list-disc ps-5">
            {rest.map((problem) => (
              <li key={`${problem.pointer}:${problem.detail}`}>
                {problem.pointer === '' ? problem.detail : `${problem.pointer}: ${problem.detail}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {fields.map((field) => (
        <SchemaField
          key={field.name}
          field={field}
          value={value[field.name]}
          widget={widgets[field.name]}
          note={notes[field.name]}
          problems={problems
            .filter((problem) => inside(problem.pointer, field.name))
            .map((problem) => problem.detail)}
          onValue={(next) => {
            // `undefined` leaves the member out.
            onChange?.(
              Object.fromEntries(
                Object.entries({ ...value, [field.name]: next }).filter(
                  ([, member]) => member !== undefined,
                ),
              ),
            );
          }}
        />
      ))}
    </fieldset>
  );
}
