/**
 * C160.7, C154.9 (`api-themes`, Workflow 9B): a version's `theme-set-id` names an active theme set
 * of its own environment. The call sits in the shared `services/publish/index.ts`, inside
 * `publishHookProblems` (placed by `foundation-9a`, Stage 1b (H)), which reads the version's theme
 * set from `PublishContext.themeSetId`. A set archived after the publish detaches at resolution
 * (C160.7); the published version is never rewritten.
 */
import type { Db } from '@openverify/db';
import { firstActiveThemeSet } from './store.js';

/** The theme set a version names, in its environment. */
export interface ThemeSetReference {
  environmentId: string;
  themeSetId: string | null;
}

/** One refusal: a JSON Pointer into the version attributes and what is wrong, never a value. */
export interface ThemeSetPublishProblem {
  pointer: string;
  detail: string;
}

/** Refuses a theme set that is not an active set of the environment. */
export async function themeSetPublishProblems(
  db: Db,
  reference: ThemeSetReference,
): Promise<ThemeSetPublishProblem[]> {
  if (reference.themeSetId === null) {
    return [];
  }
  const row = await firstActiveThemeSet(db, reference.environmentId, [reference.themeSetId]);
  return row === null
    ? [{ pointer: '/theme-set-id', detail: 'names no active theme set of this environment' }]
    : [];
}
