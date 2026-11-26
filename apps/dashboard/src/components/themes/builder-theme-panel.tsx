'use client';

import Link from 'next/link';
import { useId } from 'react';
import { COPY_COPY } from '../../lib/copy/themes-copy';
import { controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';

/** A set the builder's theme picker offers: an active set of the environment. */
export interface ThemeSetChoice {
  readonly id: string;
  readonly name: string;
  /** The saved revision flows render. */
  readonly revision: number;
  /** Whether the environment's `default-theme-set-id` names it. */
  readonly isDefault: boolean;
}

export interface BuilderThemePanelProps {
  /** The environment's active sets (`GET /theme-sets?filter[status]=active`). */
  readonly themeSets: readonly ThemeSetChoice[];
  /** The version's `theme-set-id`: a set, or `null` for the environment's default. */
  readonly value: string | null;
  /** Called with the new choice; without it the picker is read-only (a published version). */
  readonly onChange?: (themeSetId: string | null) => void;
}

const copy = COPY_COPY.themeTab;

/**
 * C155.8, C160.7 (`dashboard-themes-copy`; mounted by `dashboard-flow-builder`): the builder's theme
 * picker. `null` means the environment's default set, else the built-in look; a chosen set that is
 * no longer active stays visible, marked, so the picker never hides what the version names. The
 * builder saves the choice with the draft (`If-Match`); the API checks the set at publish.
 */
export function BuilderThemePanel({ themeSets, value, onChange }: BuilderThemePanelProps) {
  const id = useId();
  const defaultSet = themeSets.find((set) => set.isDefault) ?? null;
  const known = value === null || themeSets.some((set) => set.id === value);
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-base font-semibold text-ink">
        {COPY_COPY.builder.themeHeading}
      </h2>
      <p id={`${id}-hint`} className="text-sm text-ink-muted">
        {COPY_COPY.builder.themeHint}
      </p>
      <label htmlFor={`${id}-select`} className="text-sm font-medium text-ink">
        {copy.choiceLabel}
      </label>
      <select
        id={`${id}-select`}
        aria-describedby={`${id}-hint`}
        className={controlClassName({})}
        value={value ?? ''}
        disabled={onChange === undefined}
        onChange={(event) => {
          onChange?.(event.target.value === '' ? null : event.target.value);
        }}
      >
        <option value="">{copy.environmentDefault(defaultSet?.name ?? null)}</option>
        {themeSets.map((set) => (
          <option key={set.id} value={set.id}>
            {`${set.name} (revision ${String(set.revision)})`}
          </option>
        ))}
        {!known && <option value={value}>{copy.archivedChoice(value)}</option>}
      </select>
      {themeSets.length === 0 && <p className="text-sm text-ink-muted">{copy.noSets}</p>}
      <Link href="/theme-sets" className={LINK_CLASS}>
        {copy.manageSets}
      </Link>
    </section>
  );
}
