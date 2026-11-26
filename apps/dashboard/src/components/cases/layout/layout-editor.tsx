'use client';

import type { CaseLayout, CaseLayoutModuleEntry } from '@openverify/contracts';
import type { CaseLayoutModule, Permission } from '@openverify/core';
import { Button } from '@openverify/ui';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { FormField, controlClassName } from '../../form-field';
import { ProblemDisplay } from '../../problem-display';
import { SubmitButton } from '../../submit-button';
import { useToast } from '../../toasts';
import { useFormAction } from '../../use-form-action';
import { LAYOUT_MODULE_WORDS } from '../case-words';
import {
  MAX_COLUMNS,
  addModule,
  editorLayoutOf,
  layoutOf,
  moveTo,
  moveWithin,
  positionOf,
  removeModule,
  setCollapsed,
  setColumns,
  startLayout,
  type EditorLayout,
} from './layout-editor-model';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const COPY = CASES_REPORTS_COPY.layout;
const DRAG_TYPE = 'text/plain';
const COLUMN_CHOICES = Array.from({ length: MAX_COLUMNS }, (_, index) => String(index + 1));

export interface LayoutEditorProps {
  readonly templateId: string;
  readonly versionId: string;
  readonly layout: CaseLayout | null;
  /** The version's `layout-modules`: what a layout may place, with what a reader needs. */
  readonly offered: readonly CaseLayoutModuleEntry[];
  /** The editor's own permissions: publishing refuses a module the publisher may not see. */
  readonly held: readonly Permission[];
  readonly action: Action;
}

/** "needs cases:read, which you do not hold; …", or nothing for a module anyone may see. */
function needsWords(
  entry: CaseLayoutModuleEntry | undefined,
  held: ReadonlySet<Permission>,
): string | null {
  const required = entry?.['required-permissions'] ?? [];
  if (required.length === 0) {
    return null;
  }
  const lacking = required.some((permission) => !held.has(permission));
  return `${COPY.needs} ${required.join(', ')}${lacking ? `, ${COPY.notHeld}` : ''}`;
}

/**
 * The case page layout editor (C172.1; WCAG 2.1.1, 2.5.7): the columns, each a list of its modules
 * in order, and the modules not laid out. Every move is a button first (move up, move down, move to
 * another column, add, remove), so it works by keyboard and with a single pointer; dragging a module
 * onto a column or before another module does the same move. Each move is announced politely. A
 * module whose permissions the author lacks is marked, since publishing refuses it. The layout is
 * saved alone, and `null` keeps the default layout.
 */
export function LayoutEditor({
  templateId,
  versionId,
  layout,
  offered,
  held,
  action,
}: LayoutEditorProps) {
  const { show } = useToast();
  const [state, setState] = useState<EditorLayout | null>(() => editorLayoutOf(layout));
  const [announcement, setAnnouncement] = useState('');
  // The module moved to another column, focused once it is rendered there.
  const focusNext = useRef<CaseLayoutModule | null>(null);
  const items = useRef(new Map<CaseLayoutModule, HTMLLIElement>());
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: COPY.saved });
    },
  });
  const entries = new Map(offered.map((entry) => [entry.key, entry]));
  const heldSet = new Set(held);

  useEffect(() => {
    if (focusNext.current !== null) {
      items.current.get(focusNext.current)?.focus();
      focusNext.current = null;
    }
  });

  const apply = (key: CaseLayoutModule, next: EditorLayout, refocus = false) => {
    setState(next);
    const at = positionOf(next, key);
    const words = LAYOUT_MODULE_WORDS[key];
    setAnnouncement(
      at === null
        ? `${words}: ${COPY.notPlaced.toLowerCase()}.`
        : `${words} ${COPY.moved.toLowerCase()} to column ${String(at.column)}, position ${String(at.index + 1)}.`,
    );
    if (refocus && at !== null) {
      focusNext.current = key;
    }
  };

  const allowDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };
  const dropOn = (
    event: DragEvent<HTMLElement>,
    current: EditorLayout,
    column: number,
    before: CaseLayoutModule | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const key = event.dataTransfer.getData(DRAG_TYPE) as CaseLayoutModule;
    if (positionOf(current, key) !== null) {
      apply(key, moveTo(current, key, column, before));
    }
  };

  const placedKeys = new Set(state?.placed.flat().map((module) => module.key) ?? []);
  const unplaced = offered.filter((entry) => !placedKeys.has(entry.key));

  return (
    <form {...form.formProps} aria-label={COPY.title} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="case-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      <input
        type="hidden"
        name="layout"
        value={JSON.stringify(state === null ? null : layoutOf(state))}
      />
      <p className="text-sm text-ink-muted">{COPY.description}</p>
      <p role="status" aria-live="polite" aria-label={COPY.changes} className="text-sm">
        {announcement}
      </p>
      {state === null ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">{COPY.defaultLayout}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setState(startLayout(offered.map((entry) => entry.key)));
            }}
          >
            {COPY.start}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={COPY.columns} description={COPY.columnsDescription}>
              {(control) => (
                <select
                  {...control}
                  value={String(state.columns)}
                  onChange={(event) => {
                    setState(setColumns(state, Number(event.target.value)));
                  }}
                  className={controlClassName(control)}
                >
                  {COLUMN_CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <Button
              variant="secondary"
              onClick={() => {
                setState(null);
                setAnnouncement(COPY.defaultChosen);
              }}
            >
              {COPY.useDefault}
            </Button>
          </div>
          <p className="text-sm text-ink-muted">{COPY.dragHint}</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {state.placed.map((column, index) => {
              const columnNumber = index + 1;
              const label = `${COPY.column} ${String(columnNumber)}`;
              return (
                <div key={label} className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-sm font-semibold">{label}</h3>
                  <ol
                    aria-label={label}
                    onDragOver={allowDrop}
                    onDrop={(event) => {
                      dropOn(event, state, columnNumber, null);
                    }}
                    className="flex min-h-12 flex-col gap-2 rounded-lg border border-dashed border-line p-2"
                  >
                    {column.map((module, position) => {
                      const words = LAYOUT_MODULE_WORDS[module.key];
                      const needs = needsWords(entries.get(module.key), heldSet);
                      return (
                        <li
                          key={module.key}
                          ref={(element) => {
                            if (element === null) {
                              items.current.delete(module.key);
                            } else {
                              items.current.set(module.key, element);
                            }
                          }}
                          tabIndex={-1}
                          aria-label={words}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(DRAG_TYPE, module.key);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={allowDrop}
                          onDrop={(event) => {
                            dropOn(event, state, columnNumber, module.key);
                          }}
                          className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          <span className="font-medium">{words}</span>
                          {needs !== null && (
                            <span className="text-xs text-ink-muted">{needs}</span>
                          )}
                          <label className="flex min-h-6 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={module.collapsed}
                              onChange={(event) => {
                                setState(setCollapsed(state, module.key, event.target.checked));
                              }}
                              className="size-6"
                            />
                            {`${words} ${COPY.collapsed.toLowerCase()}`}
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              disabled={position === 0}
                              onClick={() => {
                                apply(module.key, moveWithin(state, module.key, -1));
                              }}
                            >
                              {`Move ${words} up`}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={position === column.length - 1}
                              onClick={() => {
                                apply(module.key, moveWithin(state, module.key, 1));
                              }}
                            >
                              {`Move ${words} down`}
                            </Button>
                            {COLUMN_CHOICES.slice(0, state.columns).map((choice) =>
                              Number(choice) === columnNumber ? null : (
                                <Button
                                  key={choice}
                                  variant="secondary"
                                  onClick={() => {
                                    apply(
                                      module.key,
                                      moveTo(state, module.key, Number(choice)),
                                      true,
                                    );
                                  }}
                                >
                                  {`Move ${words} to column ${choice}`}
                                </Button>
                              ),
                            )}
                            <Button
                              variant="secondary"
                              onClick={() => {
                                apply(module.key, removeModule(state, module.key));
                              }}
                            >
                              {`Remove ${words} from the layout`}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{COPY.notPlaced}</h3>
            <ul aria-label={COPY.notPlaced} className="flex flex-col gap-2">
              {unplaced.map((entry) => {
                const words = LAYOUT_MODULE_WORDS[entry.key];
                const needs = needsWords(entry, heldSet);
                return (
                  <li
                    key={entry.key}
                    aria-label={words}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
                  >
                    <span className="font-medium">{words}</span>
                    {needs !== null && <span className="text-xs text-ink-muted">{needs}</span>}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        apply(entry.key, addModule(state, entry.key), true);
                      }}
                    >
                      {`Add ${words} to the layout`}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      <ProblemDisplay problem={form.problem} />
      <div>
        <SubmitButton pendingLabel={COPY.saving} pending={form.pending}>
          {COPY.save}
        </SubmitButton>
      </div>
    </form>
  );
}
