'use server';

/**
 * The case template version editor's layout, checklists and preset comments (C172.1, C172.2,
 * C172.4): each saved alone with `PATCH /case-template-versions/:id`, naming only its own members,
 * so the rest of the draft stays as it is. The contract's schemas check each document first; the
 * API stays the judge, and its refusals keep their pointers. A refusal by a case problem code is
 * titled in words.
 */
import { idSchema, updateCaseTemplateVersionBodySchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { formString, parseInput } from '../../../lib/api/action';
import { runCaseAction } from '../../../lib/api/cases';
import { jsonDocumentsOf } from '../../lifecycle/action-input';

const ATTRIBUTES = '/data/attributes';

const idsOf = (formData: FormData) =>
  parseInput(
    z.strictObject({ 'case-template-id': idSchema('ctmpl'), 'version-id': idSchema('ctmplv') }),
    {
      'case-template-id': formString(formData, 'case-template-id'),
      'version-id': formString(formData, 'version-id'),
    },
  );

const versionPath = (ids: ReturnType<typeof idsOf>) =>
  `/case-templates/${ids['case-template-id']}/versions/${ids['version-id']}`;

/** `PATCH` the draft's `layout` (`null` for the default layout). */
export async function saveCaseVersionLayout(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-templates:write'] }, async ({ api }) => {
    const ids = idsOf(formData);
    const pointer = `${ATTRIBUTES}/layout`;
    const documents = jsonDocumentsOf({ [pointer]: formString(formData, 'layout') });
    const body = parseInput(updateCaseTemplateVersionBodySchema, {
      data: { type: 'case-template-version', attributes: { layout: documents[pointer] } },
    });
    await api.caseTemplateVersions.update(ids['version-id'], body.data.attributes);
    revalidatePath(versionPath(ids));
    return undefined;
  });
}

/** `PATCH` the draft's `checklists` and `preset-comments`. */
export async function saveCaseVersionChecklists(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-templates:write'] }, async ({ api }) => {
    const ids = idsOf(formData);
    const checklists = `${ATTRIBUTES}/checklists`;
    const presets = `${ATTRIBUTES}/preset-comments`;
    const documents = jsonDocumentsOf({
      [checklists]: formString(formData, 'checklists'),
      [presets]: formString(formData, 'preset-comments'),
    });
    const body = parseInput(updateCaseTemplateVersionBodySchema, {
      data: {
        type: 'case-template-version',
        attributes: { checklists: documents[checklists], 'preset-comments': documents[presets] },
      },
    });
    await api.caseTemplateVersions.update(ids['version-id'], body.data.attributes);
    revalidatePath(versionPath(ids));
    return undefined;
  });
}
