/**
 * C160.3, C160.4 (`api-themes`, Workflow 9B): the rules a `styles` tree must pass before it is
 * saved, after its schema (an unknown or mistyped cell is already a 400 with JSON Pointers):
 *
 * - a contradiction is 422 with `errors[]`: `use-dark-theme` without a `dark` palette, a logo that
 *   is not decorative without an `alt-key`, a logo or font that names no asset of that kind in the
 *   environment (another environment's asset is never named, decision 24);
 * - then the contrast gate on both palettes: 422 `theme_contrast_insufficient` with every failing
 *   pair (a warning below 7:1 never refuses).
 *
 * No problem echoes a colour, a name or an asset's bytes: pointers and token names only.
 */
import type { ThemeStyles } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { UnprocessableContentError, type ProblemFieldError } from '../../errors.js';
import { ThemeProblemError } from './problems.js';
import { getThemeAsset } from './store.js';
import { contrastFindingsOf, STYLES_POINTER, usesDarkTheme } from './styles.js';

/** Every contradiction of `styles` in the environment, as field errors under `base`. */
export async function stylesContradictions(
  db: Db,
  environmentId: string,
  styles: ThemeStyles,
  base: string = STYLES_POINTER,
): Promise<ProblemFieldError[]> {
  const errors: ProblemFieldError[] = [];
  const error = (pointer: string, detail: string) => {
    errors.push({ location: 'body', pointer: `${base}${pointer}`, detail });
  };
  if (usesDarkTheme(styles) && styles.dark === undefined) {
    error('/dark', 'use-dark-theme needs a dark palette (it may be empty: every cell built in).');
  }
  const logo = styles.branding?.logo;
  if (logo !== undefined) {
    if (!logo.decorative && logo['alt-key'] === undefined) {
      error('/branding/logo/alt-key', 'A logo that is not decorative needs an alt-key.');
    }
    if ((await getThemeAsset(db, environmentId, logo['asset-id'], 'logo')) === null) {
      error('/branding/logo/asset-id', 'names no logo asset of this environment');
    }
  }
  const font = styles.typography?.font;
  if (font?.kind === 'uploaded') {
    if ((await getThemeAsset(db, environmentId, font['asset-id'], 'font')) === null) {
      error('/typography/font/asset-id', 'names no font asset of this environment');
    }
  }
  return errors;
}

/**
 * Refuses `styles` that break a rule: a contradiction first, then the contrast gate.
 * @throws {UnprocessableContentError} for a contradiction.
 * @throws {ThemeProblemError} `theme_contrast_insufficient` for a pair below its minimum.
 */
export async function assertStylesSavable(
  db: Db,
  environmentId: string,
  styles: ThemeStyles,
): Promise<void> {
  const errors = await stylesContradictions(db, environmentId, styles);
  if (errors.length > 0) {
    throw new UnprocessableContentError('The styles contradict themselves.', errors);
  }
  const pairs = contrastFindingsOf(styles)
    .filter(({ level }) => level === 'fail')
    .map(({ pointer, foreground, background, ratio, required }) => ({
      pointer,
      foreground,
      background,
      ratio,
      required: required as 4.5 | 3,
    }));
  if (pairs.length > 0) {
    throw new ThemeProblemError(
      'theme_contrast_insufficient',
      'A palette pair is below its contrast minimum.',
      { pairs },
    );
  }
}
