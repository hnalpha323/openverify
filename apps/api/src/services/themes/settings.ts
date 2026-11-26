/**
 * C160.7, C174.6 (`api-themes`, Workflow 9B): the environment's `default-theme-set-id` and
 * `POST /inquiries`' `theme-set-id` name an active theme set of that environment. The calls sit in
 * the shared settings and inquiry services (placed by `foundation-9a`, Stage 1b (H)); `null` keeps
 * the built-in tokens. A set of another environment, an archived one and an unknown id are refused
 * alike, so nothing tells one from another.
 */
import type { Db } from '@openverify/db';
import { UnprocessableContentError } from '../../errors.js';
import { firstActiveThemeSet } from './store.js';

/** A theme set named by a setting or a create body, and where the request names it. */
export interface ThemeSetChoice {
  environmentId: string;
  themeSetId: string | null;
  /** The request member's JSON Pointer, such as `/default-theme-set-id`. */
  pointer: string;
}

/**
 * Refuses a theme set that is not an active set of the environment.
 * @throws {UnprocessableContentError} at `choice.pointer`.
 */
export async function checkThemeSetChoice(db: Db, choice: ThemeSetChoice): Promise<void> {
  if (choice.themeSetId === null) {
    return;
  }
  if ((await firstActiveThemeSet(db, choice.environmentId, [choice.themeSetId])) === null) {
    throw new UnprocessableContentError('The theme set is not an active set of this environment.', [
      { location: 'body', pointer: choice.pointer, detail: 'names no active theme set' },
    ]);
  }
}
