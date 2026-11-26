/**
 * C160.7 (`api-themes`, Workflow 9B): the theme a flow renders. A session's is the inquiry's
 * `theme-set-id`, else its version's, else the environment's `default-theme-set-id`, else the
 * built-in tokens; each only while it names an **active** set of the inquiry's environment, so
 * archiving a set detaches it and flows fall back (public), and published versions are never
 * rewritten. The call in the session builder (`getFlowSession`, `services/flow.ts`) was placed by
 * `foundation-9a` (Stage 1b (T)).
 *
 * - {@link resolveThemeForSession} answers `null` for the built-in tokens (the session carries no
 *   `theme` member and the flow renders its own stylesheet, the same hex tokens), else the set's
 *   theme naming its saved revision (C160.5).
 * - {@link resolveThemeForVersion} is the template preview's (C156.1; `api-templates-carry` serves
 *   it): a version's theme without an inquiry, the built-in theme included, with the contrast gate's
 *   findings in the preview's shape (B46); unsaved `styles` replace the set's, so the theme editor
 *   previews a change before it is saved (review H15).
 */
import type { FlowTheme, ThemeStyles, previewContrastSchema } from '@openverify/contracts';
import type { Db, Inquiry, InquiryTemplateVersion } from '@openverify/db';
import type { z } from 'zod';
import { UnprocessableContentError } from '../../errors.js';
import { stylesContradictions } from './rules.js';
import { defaultThemeSetIdOf, firstActiveThemeSet, type ThemeSetRow } from './store.js';
import {
  builtinFlowTheme,
  contrastFindingsOf,
  flowThemeOf,
  storedStylesOf,
  STYLES_POINTER,
} from './styles.js';

/** What the session's theme is resolved for. */
export interface SessionThemeRequest {
  inquiry: Inquiry;
  version: InquiryTemplateVersion;
}

/** The first active set of the candidates whose stored styles still read. */
async function resolvedSet(
  db: Db,
  environmentId: string,
  candidates: readonly (string | null | undefined)[],
): Promise<{ row: ThemeSetRow; styles: ThemeStyles } | null> {
  const remaining = [...candidates, await defaultThemeSetIdOf(db, environmentId)];
  while (remaining.length > 0) {
    const row = await firstActiveThemeSet(db, environmentId, remaining);
    if (row === null) {
      return null;
    }
    const styles = storedStylesOf(row.styles);
    if (styles !== null) {
      return { row, styles };
    }
    // A stored tree that no longer reads is skipped, never rendered half-applied.
    remaining.splice(0, remaining.indexOf(row.id) + 1);
  }
  return null;
}

/** The session's theme, or `null` for the built-in tokens served as no member. */
export async function resolveThemeForSession(
  db: Db,
  request: SessionThemeRequest,
): Promise<FlowTheme | null> {
  const { inquiry, version } = request;
  const resolved = await resolvedSet(db, inquiry.environmentId, [
    inquiry.themeSetId,
    version.themeSetId,
  ]);
  return resolved === null
    ? null
    : flowThemeOf({ id: resolved.row.id, revision: resolved.row.revision, styles: resolved.styles });
}

/** What a version's theme is resolved for, without an inquiry (the template preview, C156.1). */
export interface VersionThemeRequest {
  environmentId: string;
  /** The version's (or the preview body's) `theme-set-id`. */
  themeSetId: string | null;
  /** The preview body's unsaved `styles`, which replace the set's (C156.1; review H15). */
  styles?: ThemeStyles | undefined;
}

/** The resolved theme and the contrast gate's answer for it, in the preview's shape (B46). */
export interface ResolvedVersionTheme {
  theme: FlowTheme;
  contrast: z.infer<typeof previewContrastSchema>;
}

/** The preview's `contrast`: every finding of both palettes, `failed` when one fails. */
function contrastOf(styles: ThemeStyles): ResolvedVersionTheme['contrast'] {
  const findings = contrastFindingsOf(styles).map(
    ({ pointer, foreground, background, ratio, required, level }) => ({
      pointer,
      foreground,
      background,
      ratio,
      required,
      level,
    }),
  );
  return {
    status: findings.some(({ level }) => level === 'fail') ? 'failed' : 'passed',
    findings,
  };
}

/**
 * A version's resolved theme without an inquiry: the version's `theme-set-id`, else the
 * environment's `default-theme-set-id`, else the built-in tokens (each only while active), with the
 * contrast gate's findings. Unsaved `styles` replace the resolved set's tree; a failing palette is
 * answered, not refused (the preview renders it), but a contradiction is.
 * @throws {UnprocessableContentError} for unsaved styles that contradict themselves or name an
 *   asset outside the environment (pointers under `/data/attributes/styles`).
 */
export async function resolveThemeForVersion(
  db: Db,
  request: VersionThemeRequest,
): Promise<ResolvedVersionTheme> {
  const resolved = await resolvedSet(db, request.environmentId, [request.themeSetId]);
  if (request.styles !== undefined) {
    const errors = await stylesContradictions(
      db,
      request.environmentId,
      request.styles,
      STYLES_POINTER,
    );
    if (errors.length > 0) {
      throw new UnprocessableContentError('The styles contradict themselves.', errors);
    }
    return {
      theme: flowThemeOf({ id: resolved?.row.id ?? null, revision: null, styles: request.styles }),
      contrast: contrastOf(request.styles),
    };
  }
  if (resolved === null) {
    return { theme: builtinFlowTheme(), contrast: contrastOf({}) };
  }
  return {
    theme: flowThemeOf({
      id: resolved.row.id,
      revision: resolved.row.revision,
      styles: resolved.styles,
    }),
    contrast: contrastOf(resolved.styles),
  };
}
