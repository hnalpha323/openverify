'use client';

/**
 * C155.5 (Workflow 9D, fix-builder): the screen editor, outline and keyboard first. The screen's
 * components are a list in order with their nesting; every move a canvas would make by dragging
 * is a button (move up, move down, into the container before it, out of its container; 2.5.7),
 * enabled only when the format's screen schema accepts the result (C155.6). A component opens its
 * Data (the field it fills and its validation), Logic (its visibility rule over the screen's own
 * fields, written with the shared condition builder and run by flow-spec's strict evaluator) and
 * Design tabs. A drag-and-drop screen canvas and per-component style overrides are not built.
 */
import type { Component, ComponentKind, ScreenStep } from '@openverify/flow-spec';
import { Button } from '@openverify/ui';
import { useId, useState, type KeyboardEvent } from 'react';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import type { ScopePath } from '../graph-editor/graph-adapter';
import { ConditionBuilder } from '../workflows/editor/condition-builder';
import {
  addComponent,
  componentLibrary,
  componentRows,
  moveComponent,
  removeComponent,
  replaceComponent,
  type ComponentMove,
  type ComponentPath,
} from './screen-model';

export interface ScreenField {
  readonly key: string;
  readonly type: string;
  readonly pii: boolean;
}

const copy = FLOW_BUILDER_COPY.screen;

const CONTROL =
  'min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** `value` without its member `member` (a member left out, never set to undefined). */
function without<Value extends object>(value: Value, member: string): Value {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== member)) as Value;
}

const LENGTH_KINDS: ReadonlySet<string> = new Set(['text_input', 'text_area', 'masked_text']);

const TABS = ['data', 'logic', 'design'] as const;
type Tab = (typeof TABS)[number];

/** A kind in words: `text_input` reads "Text input". */
export function kindWords(kind: string): string {
  const words = kind.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

const fieldOf = (component: Component): string | null =>
  'field' in component && typeof component.field === 'string' ? component.field : null;

/** The screen's own fields as the visibility rule may read them (`screen.<field>`, C148.4). */
function visibilityScope(
  step: ScreenStep,
  fields: readonly ScreenField[],
  own: string,
): ScopePath[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return componentRows(step).flatMap(({ component }) => {
    const field = fieldOf(component);
    if (field === null || component.id === own) return [];
    const schema = byKey.get(field);
    const options =
      'options' in component && Array.isArray(component.options)
        ? component.options.map((option) => option.value)
        : [];
    const type =
      component.kind === 'checkbox' || schema?.type === 'boolean'
        ? 'boolean'
        : options.length > 0 && (component.kind === 'select' || component.kind === 'radio_group')
          ? 'enum'
          : 'string';
    return [
      {
        path: `screen.${field}`,
        type,
        options,
        nullable: false,
        // A field the version does not describe counts as personal data (fail closed).
        pii: schema?.pii ?? true,
        source: FLOW_BUILDER_COPY.sources.person,
      },
    ];
  });
}

export function ScreenEditor({
  step,
  fields,
  editable,
  onChange,
}: {
  readonly step: ScreenStep;
  readonly fields: readonly ScreenField[];
  readonly editable: boolean;
  readonly onChange: (next: ScreenStep, message: string) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<ComponentKind>('text');
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('data');
  const [refused, setRefused] = useState(false);
  const rows = componentRows(step);
  const library = componentLibrary();
  const editingRow = rows.find((row) => row.component.id === editing);

  const offer = (next: ScreenStep | null, message: string) => {
    setRefused(next === null);
    if (next !== null) onChange(next, message);
  };

  const replace = (path: ComponentPath, next: Component) => {
    offer(replaceComponent(step, path, next), copy.changed(next.id));
  };

  const moves: readonly [ComponentMove, string][] = [
    ['up', copy.moveUp],
    ['down', copy.moveDown],
    ['into', copy.into],
    ['out', copy.out],
  ];

  const bound = new Set(rows.map((row) => fieldOf(row.component)).filter((key) => key !== null));
  const unbound = [
    ...fields.filter((field) => !bound.has(field.key)),
    ...fields.filter((field) => bound.has(field.key)),
  ].map((field) => field.key);

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? TABS[(index + 1) % TABS.length]
        : event.key === 'ArrowLeft'
          ? TABS[(index + TABS.length - 1) % TABS.length]
          : undefined;
    if (next !== undefined) {
      event.preventDefault();
      setTab(next);
      document.getElementById(`${id}-tab-${next}`)?.focus();
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3 text-sm">
      <h3 id={`${id}-heading`} className="font-semibold">
        {copy.heading}
      </h3>
      <p>{copy.description}</p>
      <ul aria-label={copy.heading} className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.path.join('.')}
            className={`flex flex-col gap-1 rounded-md border border-line p-2 ${row.depth > 1 ? 'ms-6' : ''}`}
          >
            <span className="font-medium">
              {copy.row(kindWords(row.component.kind), row.component.id, row.depth)}
            </span>
            <div
              role="group"
              aria-label={`Actions for ${row.component.id}`}
              className="flex flex-wrap gap-2"
            >
              {editable &&
                moves.map(([move, words]) => (
                  <Button
                    key={move}
                    variant="secondary"
                    disabled={moveComponent(step, row.path, move) === null}
                    onClick={() => {
                      offer(moveComponent(step, row.path, move), copy.moved(row.component.id));
                    }}
                  >
                    {words}
                  </Button>
                ))}
              {editable && (
                <Button
                  variant="secondary"
                  disabled={removeComponent(step, row.path) === null}
                  onClick={() => {
                    offer(removeComponent(step, row.path), copy.removed(row.component.id));
                  }}
                >
                  {copy.remove}
                </Button>
              )}
              <Button
                variant="secondary"
                aria-pressed={editing === row.component.id}
                onClick={() => {
                  setEditing(row.component.id);
                  setTab('data');
                }}
              >
                {copy.edit}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {refused && <p role="status">{copy.refused}</p>}
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-kind`} className="font-medium">
              {copy.kind}
            </label>
            <select
              id={`${id}-kind`}
              value={kind}
              aria-describedby={`${id}-kind-hint`}
              onChange={(event) => {
                setKind(event.currentTarget.value as ComponentKind);
              }}
              className={CONTROL}
            >
              {library.map((entry) => (
                <option key={entry.kind} value={entry.kind} disabled={entry.refusal !== null}>
                  {kindWords(entry.kind)}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              offer(addComponent(step, kind, unbound), copy.added(kindWords(kind)));
            }}
          >
            {copy.add}
          </Button>
          <p id={`${id}-kind-hint`} className="w-full">
            {copy.library}. {library.find((entry) => entry.refusal !== null)?.refusal}
          </p>
        </div>
      )}
      {editingRow !== undefined && (
        <div className="flex flex-col gap-2">
          <div role="tablist" aria-label={copy.tabs} onKeyDown={onTabKey} className="flex gap-2">
            {TABS.map((each) => (
              <button
                key={each}
                id={`${id}-tab-${each}`}
                type="button"
                role="tab"
                aria-selected={tab === each}
                aria-controls={`${id}-panel-${each}`}
                tabIndex={tab === each ? 0 : -1}
                onClick={() => {
                  setTab(each);
                }}
                className="min-h-11 rounded-md border border-line px-3 font-medium aria-selected:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {copy[each]}
              </button>
            ))}
          </div>
          <div
            id={`${id}-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${tab}`}
            className="flex flex-col gap-2"
          >
            {tab === 'data' && (
              <DataPanel
                component={editingRow.component}
                fields={fields}
                editable={editable}
                onReplace={(next) => {
                  replace(editingRow.path, next);
                }}
              />
            )}
            {tab === 'logic' && (
              <fieldset disabled={!editable} className="flex flex-col gap-2">
                <ConditionBuilder
                  key={editingRow.component.id}
                  label={copy.visibleWhen(editingRow.component.id)}
                  condition={editingRow.component.visibleWhen}
                  onNull={undefined}
                  position="visibility"
                  scope={visibilityScope(step, fields, editingRow.component.id)}
                  onChange={(condition) => {
                    const rest = without(editingRow.component, 'visibleWhen');
                    replace(
                      editingRow.path,
                      condition === undefined
                        ? rest
                        : ({ ...rest, visibleWhen: condition } as Component),
                    );
                  }}
                />
                <p>{copy.logicHint}</p>
              </fieldset>
            )}
            {tab === 'design' && <p>{copy.designNote}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

/** C155.5's Data: the field a component fills, whether it is required, and its lengths. */
function DataPanel({
  component,
  fields,
  editable,
  onReplace,
}: {
  readonly component: Component;
  readonly fields: readonly ScreenField[];
  readonly editable: boolean;
  readonly onReplace: (next: Component) => void;
}) {
  const id = useId();
  const field = fieldOf(component);
  if (field === null) {
    return <p>{copy.noData}</p>;
  }
  const keys = [...new Set([...fields.map((each) => each.key), field])];
  const record = component as unknown as Readonly<Record<string, unknown>>;
  const set = (member: string, value: unknown) => {
    const rest = without(record, member);
    onReplace((value === undefined ? rest : { ...rest, [member]: value }) as unknown as Component);
  };
  return (
    <fieldset disabled={!editable} className="flex flex-col gap-2">
      <label htmlFor={`${id}-field`} className="font-medium">
        {copy.field}
      </label>
      <select
        id={`${id}-field`}
        value={field}
        aria-describedby={`${id}-field-hint`}
        onChange={(event) => {
          set('field', event.currentTarget.value);
        }}
        className={CONTROL}
      >
        {keys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <p id={`${id}-field-hint`}>{copy.fieldHint}</p>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={record.required === true}
          onChange={(event) => {
            set('required', event.currentTarget.checked ? true : undefined);
          }}
          className="size-6"
        />
        {copy.required}
      </label>
      {LENGTH_KINDS.has(component.kind) &&
        (['minLength', 'maxLength'] as const).map((member) => (
          <label key={member} className="flex flex-col gap-1">
            <span className="font-medium">{copy[member]}</span>
            <input
              type="number"
              min={member === 'minLength' ? 0 : 1}
              step={1}
              defaultValue={typeof record[member] === 'number' ? String(record[member]) : ''}
              onChange={(event) => {
                const text = event.currentTarget.value;
                const value = Number(text);
                set(member, text === '' || !Number.isInteger(value) ? undefined : value);
              }}
              className={`${CONTROL} w-32`}
            />
          </label>
        ))}
    </fieldset>
  );
}
