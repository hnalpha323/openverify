'use server';

import {
  createThemeSetBodySchema,
  idSchema,
  themeSetNameSchema,
  type ThemeAssetKind,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ActionInputError,
  formString,
  parseInput,
  runAction,
  type ActionResult,
  type ActionState,
} from '../../lib/api/action';
import {
  assetUploadFromForm,
  contrastRefusalOf,
  setDefaultThemeSet,
  stylesFromForm,
  uploadThemeAsset,
  type ContrastRefusalPair,
} from '../../lib/api/theme-sets';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import {
  previewTemplateVersion,
  type TemplatePreviewDocument,
} from '../../lib/api/template-preview';

/**
 * The theme set actions (C160; Workflow 9C, `dashboard-themes-copy`): each validates its input with
 * the contract's request schema and leaves the judgement to the API, whose refusals are said in
 * words by the forms.
 */

/** `POST /theme-sets` (`theme-sets:write`): a set with every cell built in. */
export async function createThemeSet(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(
    { permissions: ['theme-sets:write'], environmentForm: formData },
    async ({ api }) => {
      const body = parseInput(createThemeSetBodySchema, {
        data: { type: 'theme-set', attributes: { name: formString(formData, 'name') ?? '' } },
      });
      const { data } = await api.themeSets.create(body.data.attributes);
      revalidatePath('/theme-sets');
      return { id: data.id };
    },
  );
}

/** What a styles save answers: the new revision, or the pairs the contrast gate refused. */
export type ThemeSaveOutcome =
  | { readonly kind: 'saved'; readonly revision: number }
  | { readonly kind: 'refused'; readonly pairs: readonly ContrastRefusalPair[] };

/** A stored asset, as the editor offers it; never its bytes. */
export interface UploadedThemeAsset {
  readonly id: string;
  readonly kind: ThemeAssetKind;
  readonly width: number | null;
  readonly height: number | null;
}

const words = THEMES_COPY.problems;

/** A refusal this area says in its own words (C160's named problems), by code then status. */
const CODE_WORDS: Readonly<Record<string, string>> = {
  theme_set_default: words.theme_set_default,
  asset_type_refused: words.asset_type_refused,
  theme_contrast_insufficient: words.theme_contrast_insufficient,
};

/**
 * Runs `run`, saying the area's named refusals in words: the API's own problem is kept for every
 * other failure (`runAction` maps it).
 */
async function themeAction<Data>(
  permissions: readonly Permission[],
  run: Parameters<typeof runAction<Data>>[1],
  statusWords: Readonly<Partial<Record<number, string>>> = {},
): Promise<ActionResult<Data>> {
  return runAction<Data>({ permissions }, async (context) => {
    try {
      return await run(context);
    } catch (error) {
      if (error instanceof OpenVerifyApiError) {
        const detail =
          (error.code === null ? undefined : CODE_WORDS[error.code]) ?? statusWords[error.status];
        if (detail !== undefined) {
          throw new ActionInputError({ title: error.problem.title, detail, status: error.status });
        }
      }
      throw error;
    }
  });
}

const setIdOf = (formData: FormData) =>
  parseInput(z.object({ 'theme-set-id': idSchema('theset') }), {
    'theme-set-id': formString(formData, 'theme-set-id'),
  })['theme-set-id'];

const revalidateSet = (id: string) => {
  revalidatePath('/theme-sets');
  revalidatePath(`/theme-sets/${id}`);
};

/** `PATCH /theme-sets/:id` `styles`: the whole tree, one revision, after the contrast gate. */
export async function saveThemeStyles(
  _state: ActionState<ThemeSaveOutcome>,
  formData: FormData,
): Promise<ActionResult<ThemeSaveOutcome>> {
  return themeAction<ThemeSaveOutcome>(
    ['theme-sets:write'],
    async ({ api }) => {
      const id = setIdOf(formData);
      const styles = stylesFromForm(formData);
      try {
        const { data } = await api.themeSets.update(id, { styles });
        revalidateSet(id);
        return { kind: 'saved', revision: data.attributes.revision };
      } catch (error) {
        const pairs = contrastRefusalOf(error);
        if (pairs === null) {
          throw error;
        }
        return { kind: 'refused', pairs };
      }
    },
    { 422: words.archivedEdit },
  );
}

/** `PATCH /theme-sets/:id` `name`. */
export async function renameThemeSet(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return themeAction(['theme-sets:write'], async ({ api }) => {
    const id = setIdOf(formData);
    const { name } = parseInput(z.object({ name: themeSetNameSchema }), {
      name: formString(formData, 'name') ?? '',
    });
    await api.themeSets.update(id, { name });
    revalidateSet(id);
    return undefined;
  });
}

/** `DELETE /theme-sets/:id`: archives; the default set is refused (`theme_set_default`). */
export async function archiveThemeSet(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return themeAction(['theme-sets:write'], async ({ api }) => {
    const id = setIdOf(formData);
    await api.themeSets.archive(id);
    revalidateSet(id);
    return undefined;
  });
}

/** `POST /theme-sets/:id/restore` `meta.revision`: a new revision with the earlier content. */
export async function restoreThemeSetRevision(
  _state: ActionState<{ revision: number }>,
  formData: FormData,
): Promise<ActionResult<{ revision: number }>> {
  return themeAction<{ revision: number }>(
    ['theme-sets:write'],
    async ({ api }) => {
      const id = setIdOf(formData);
      const { revision } = parseInput(z.object({ revision: z.coerce.number().int().min(1) }), {
        revision: formString(formData, 'revision'),
      });
      const { data } = await api.themeSets.restore(id, revision);
      revalidateSet(id);
      return { revision: data.attributes.revision };
    },
    { 422: words.revisionMissing },
  );
}

/** A new set with this set's name, marked a copy, and its current styles. */
export async function duplicateThemeSet(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return themeAction<{ id: string }>(['theme-sets:write'], async ({ api }) => {
    const { data: source } = await api.themeSets.retrieve(setIdOf(formData));
    const { data } = await api.themeSets.create({
      name: THEMES_COPY.set.duplicateName(source.attributes.name),
      styles: source.attributes.styles,
    });
    revalidatePath('/theme-sets');
    return { id: data.id };
  });
}

/** `default-theme-set-id` (`settings:write`): this set. */
export async function makeDefaultThemeSet(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return themeAction(['settings:write'], async () => {
    const id = setIdOf(formData);
    await setDefaultThemeSet(id);
    revalidateSet(id);
    return undefined;
  });
}

/** `default-theme-set-id` (`settings:write`): none, so the built-in look applies. */
export async function clearDefaultThemeSet(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return themeAction(['settings:write'], async () => {
    const id = setIdOf(formData);
    await setDefaultThemeSet(null);
    revalidateSet(id);
    return undefined;
  });
}

/** `POST /theme-sets/assets`: a logo, or a font with its licence attestation. */
export async function uploadThemeAssetAction(
  _state: ActionState<UploadedThemeAsset>,
  formData: FormData,
): Promise<ActionResult<UploadedThemeAsset>> {
  return themeAction<UploadedThemeAsset>(
    ['theme-sets:write'],
    async ({ api }) => {
      const { data } = await uploadThemeAsset(api, await assetUploadFromForm(formData));
      return {
        id: data.id,
        kind: data.attributes.kind,
        width: data.attributes.width,
        height: data.attributes.height,
      };
    },
    {
      403: words.fontFromKey,
      413: words.tooLarge,
      422: words.tooManyPixels,
      429: words.tooManyUploads,
      503: words.busy,
    },
  );
}

/**
 * C156.1: unsaved styles on a template version's real screens (`inquiry-templates:read`): the
 * preview route resolves them with the contrast gate's findings and stores nothing.
 */
export async function previewThemeStyles(
  _state: ActionState<TemplatePreviewDocument>,
  formData: FormData,
): Promise<ActionResult<TemplatePreviewDocument>> {
  return themeAction<TemplatePreviewDocument>(['inquiry-templates:read'], async () => {
    const { 'version-id': versionId } = parseInput(z.object({ 'version-id': idSchema('itmplv') }), {
      'version-id': formString(formData, 'version-id'),
    });
    return previewTemplateVersion(versionId, {
      data: { attributes: { styles: stylesFromForm(formData) } },
      meta: { locale: 'en' },
    });
  });
}
