'use server';

import { idSchema, templateLocaleSchema, templateVersionEtagSchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ActionInputError,
  formString,
  formStrings,
  parseInput,
  runAction,
  type ActionResult,
  type ActionState,
} from '../../../../lib/api/action';
import {
  isPreconditionFailed,
  updateTemplateVersion,
} from '../../../../lib/api/inquiry-template-versions';
import {
  importTranslations,
  translationRefusalsOf,
  translationRowsFromForm,
  type TranslationRefusal,
} from '../../../../lib/api/translations';
import { COPY_COPY } from '../../../../lib/copy/themes-copy';

/** What an import answers: how many texts were saved, or each refused cell by pointer and code. */
export type TranslationsImportOutcome =
  | { readonly kind: 'saved'; readonly count: number }
  | { readonly kind: 'refused'; readonly refusals: readonly TranslationRefusal[] };

const templateIdOf = (formData: FormData) =>
  parseInput(z.object({ 'inquiry-template-id': idSchema('itmpl') }), {
    'inquiry-template-id': formString(formData, 'inquiry-template-id'),
  })['inquiry-template-id'];

/**
 * `POST /inquiry-templates/:id/translations` (`inquiry-templates:write`): the edited cells into the
 * draft (made from the published version when none exists); nothing is published. A refusal of the
 * copy rules answers each cell's pointer and code, never a value.
 */
export async function importTranslationRows(
  _state: ActionState<TranslationsImportOutcome>,
  formData: FormData,
): Promise<ActionResult<TranslationsImportOutcome>> {
  return runAction<TranslationsImportOutcome>(
    { permissions: ['inquiry-templates:write'] },
    async ({ api }) => {
      const templateId = templateIdOf(formData);
      const rows = translationRowsFromForm(formData);
      try {
        await importTranslations(api, templateId, rows);
      } catch (error) {
        const refusals = translationRefusalsOf(error);
        if (refusals === null) {
          throw error;
        }
        return { kind: 'refused', refusals };
      }
      revalidatePath(`/templates/${templateId}/translations`);
      return {
        kind: 'saved',
        count: rows.reduce((total, row) => total + row['locale-values'].length, 0),
      };
    },
  );
}

/**
 * The draft's `enabled-locales` and `default-locale` (`PATCH` with `If-Match`): base tags only; the
 * default must be enabled. A draft changed since the page was read answers the stale words.
 */
export async function saveTemplateLocales(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async () => {
    const input = parseInput(
      z
        .object({
          'inquiry-template-id': idSchema('itmpl'),
          'version-id': idSchema('itmplv'),
          etag: templateVersionEtagSchema,
          'enabled-locales': z.array(templateLocaleSchema).min(1).max(5),
          'default-locale': templateLocaleSchema,
        })
        .refine((value) => value['enabled-locales'].includes(value['default-locale']), {
          message: COPY_COPY.locales.defaultLocale,
          path: ['default-locale'],
        }),
      {
        'inquiry-template-id': formString(formData, 'inquiry-template-id'),
        'version-id': formString(formData, 'version-id'),
        etag: formString(formData, 'etag'),
        'enabled-locales': formStrings(formData, 'enabled-locales'),
        'default-locale': formString(formData, 'default-locale'),
      },
    );
    try {
      await updateTemplateVersion(
        input['version-id'],
        {
          'enabled-locales': input['enabled-locales'],
          'default-locale': input['default-locale'],
        },
        input.etag,
      );
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new ActionInputError({ title: COPY_COPY.themeTab.stale, status: 412 });
      }
      throw error;
    }
    revalidatePath(`/templates/${input['inquiry-template-id']}/translations`);
    return undefined;
  });
}
