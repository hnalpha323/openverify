'use client';

/**
 * The list picker of `list-config.screen` (C99.5, C153.1): a widget override of the generated form,
 * so the form keeps one model and never a hand-written field list. `screen` is `all` (every active
 * list whose `screen-at-completion` is on), `none`, or the distinct `lst_` ids chosen from the
 * environment's lists; the contract judges the choice as made (an empty choice is refused there).
 */
import { useState } from 'react';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import type { ListChoice } from './member-form';
import type { SchemaWidgetProps } from './schema-form';

const COPY = TEMPLATE_FORMS_COPY.listPicker;

type Mode = 'all' | 'none' | 'chosen';

const modeOf = (value: unknown): Mode =>
  value === 'none' ? 'none' : Array.isArray(value) ? 'chosen' : 'all';

/** A widget over `lists`, for a `SchemaForm`'s `widgets`. */
export function listPickerOf(lists: readonly ListChoice[]) {
  function ListPicker({ id, labelId, value, onValue, describedBy, invalid }: SchemaWidgetProps) {
    const [mode, setMode] = useState<Mode>(() => modeOf(value));
    const chosen = Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    const choose = (next: Mode) => {
      setMode(next);
      onValue(next === 'chosen' ? chosen : next);
    };
    return (
      <div
        id={id}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="flex flex-col gap-2"
      >
        {(['all', 'none', 'chosen'] as const).map((option) => (
          <label key={option} className="flex min-h-6 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-mode`}
              value={option}
              className="size-6"
              checked={mode === option}
              onChange={() => {
                choose(option);
              }}
            />
            {COPY[option]}
          </label>
        ))}
        {mode === 'chosen' &&
          (lists.length === 0 && chosen.length === 0 ? (
            <p className="text-sm">{COPY.noLists}</p>
          ) : (
            <ul aria-label={COPY.choices} className="flex flex-col gap-1 ps-8">
              {[
                ...lists,
                ...chosen
                  .filter((chosenId) => !lists.some((list) => list.id === chosenId))
                  .map((chosenId) => ({ id: chosenId, name: '', kind: '' })),
              ].map((list) => (
                <li key={list.id}>
                  <label className="flex min-h-6 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-6"
                      checked={chosen.includes(list.id)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        onValue(
                          checked
                            ? [...chosen, list.id]
                            : chosen.filter((item) => item !== list.id),
                        );
                      }}
                    />
                    {list.kind === '' ? COPY.unknown(list.id) : COPY.kind(list.name, list.kind)}
                  </label>
                </li>
              ))}
            </ul>
          ))}
      </div>
    );
  }
  return ListPicker;
}
