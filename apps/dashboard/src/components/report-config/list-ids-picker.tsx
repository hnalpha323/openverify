'use client';

/**
 * A custom-list template's `list-ids` (C106.2, C153.4) as a widget override of the generated form:
 * `null`, each report names its own lists (`report_lists_required` when one names none), or 1 to
 * 20 distinct lists chosen from the environment's; the contract judges the choice as made.
 */
import { useState } from 'react';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import type { ListChoice } from '../schema-form/member-form';
import type { SchemaWidgetProps } from '../schema-form/schema-form';

const COPY = TEMPLATE_FORMS_COPY;

export function listIdsPickerOf(lists: readonly ListChoice[]) {
  function ListIdsPicker({ id, labelId, value, onValue, describedBy, invalid }: SchemaWidgetProps) {
    const [chosenMode, setChosenMode] = useState(() => Array.isArray(value));
    const chosen = Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    return (
      <div
        id={id}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="flex flex-col gap-2"
      >
        {(['own', 'chosen'] as const).map((mode) => (
          <label key={mode} className="flex min-h-6 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-mode`}
              value={mode}
              className="size-6"
              checked={chosenMode === (mode === 'chosen')}
              onChange={() => {
                setChosenMode(mode === 'chosen');
                onValue(mode === 'chosen' ? chosen : null);
              }}
            />
            {COPY.reportForms.listIdsMode[mode]}
          </label>
        ))}
        {chosenMode &&
          (lists.length === 0 && chosen.length === 0 ? (
            <p className="text-sm">{COPY.listPicker.noLists}</p>
          ) : (
            <ul aria-label={COPY.listPicker.choices} className="flex flex-col gap-1 ps-8">
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
                        onValue(
                          event.currentTarget.checked
                            ? [...chosen, list.id]
                            : chosen.filter((item) => item !== list.id),
                        );
                      }}
                    />
                    {list.kind === ''
                      ? COPY.listPicker.unknown(list.id)
                      : COPY.listPicker.kind(list.name, list.kind)}
                  </label>
                </li>
              ))}
            </ul>
          ))}
      </div>
    );
  }
  return ListIdsPicker;
}
