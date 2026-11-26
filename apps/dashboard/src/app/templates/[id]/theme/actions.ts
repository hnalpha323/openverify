'use server';

import { idSchema, templateVersionEtagSchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ActionInputError,
  formString,
  parseInput,
  runAction,
  type ActionResult,
  type ActionState,
} from '../../../../lib/api/action';
import {
  isPreconditionFailed,
  updateTemplateVersion,
} from '../../../../lib/api/inquiry-template-versions';
import { COPY_COPY } from '../../../../lib/copy/themes-copy';

/**
 * C160.7: the draft's `theme-set-id` (`PATCH` with `If-Match`, C154.3): a set of the environment,
 * or empty for `null` (the environment's default set, else the built-in look). The API checks at
 * publish that the set is still active here. A draft changed since the page was read is refused.
 */
export async function saveTemplateTheme(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async () => {
    const input = parseInput(
      z.object({
        'inquiry-template-id': idSchema('itmpl'),
        'version-id': idSchema('itmplv'),
        etag: templateVersionEtagSchema,
        'theme-set-id': z.union([z.literal(''), idSchema('theset')]),
      }),
      {
        'inquiry-template-id': formString(formData, 'inquiry-template-id'),
        'version-id': formString(formData, 'version-id'),
        etag: formString(formData, 'etag'),
        'theme-set-id': formString(formData, 'theme-set-id') ?? '',
      },
    );
    const themeSetId = input['theme-set-id'] === '' ? null : input['theme-set-id'];
    try {
      await updateTemplateVersion(input['version-id'], { 'theme-set-id': themeSetId }, input.etag);
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new ActionInputError({ title: COPY_COPY.themeTab.stale, status: 412 });
      }
      throw error;
    }
    revalidatePath(`/templates/${input['inquiry-template-id']}/theme`);
    return undefined;
  });
}
