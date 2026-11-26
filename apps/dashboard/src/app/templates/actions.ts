'use server';

/**
 * Template mutations (C11, C21): server actions that validate their form with the contract's
 * request schemas, call the server API as the operator, refresh the pages they change and answer
 * `{ ok } | { problem }`.
 */
import {
  createInquiryTemplateVersionBodySchema,
  idSchema,
  updateInquiryTemplateBodySchema,
  updateInquiryTemplateVersionBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { jsonDocumentsOf } from '../../components/lifecycle/action-input';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { describeVersionProblem } from '../../lib/version-problem-words';
import { formString, parseInput, runAction } from '../../lib/api/action';
import { restoreTemplateVersion } from '../../lib/api/inquiry-templates';

const templatePath = (id: string) => `/templates/${id}`;
const versionPath = (templateId: string, versionId: string) =>
  `${templatePath(templateId)}/versions/${versionId}`;

const templateIdSchema = z.strictObject({ 'inquiry-template-id': idSchema('itmpl') });
const versionIdsSchema = templateIdSchema.extend({ 'version-id': idSchema('itmplv') });

const templateIdOf = (formData: FormData) =>
  parseInput(templateIdSchema, {
    'inquiry-template-id': formString(formData, 'inquiry-template-id'),
  })['inquiry-template-id'];

const versionIdsOf = (formData: FormData) =>
  parseInput(versionIdsSchema, {
    'inquiry-template-id': formString(formData, 'inquiry-template-id'),
    'version-id': formString(formData, 'version-id'),
  });

/**
 * `POST /inquiry-template-versions`: a new draft with the content of the template's current
 * version, then its editor.
 */
export async function createDraftVersion(
  _previous: ActionState<{ path: string }>,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const result = await runAction({ permissions: ['inquiry-templates:write'] }, async ({ api }) => {
    const id = templateIdOf(formData);
    const { data: template } = await api.inquiryTemplates.retrieve(id);
    const current = template.attributes['current-version'];
    const body = parseInput(createInquiryTemplateVersionBodySchema, {
      data: {
        type: 'inquiry-template-version',
        attributes: {
          'inquiry-template-id': id,
          flow: current.flow,
          'verification-config': current['verification-config'],
          ...(current.settings === undefined ? {} : { settings: current.settings }),
        },
      },
    });
    const { data: created } = await api.inquiryTemplateVersions.create(body.data.attributes);
    revalidatePath(templatePath(id));
    return { path: versionPath(id, created.id) };
  });
  if (result.ok) {
    redirect(result.data.path);
  }
  return result;
}

/**
 * `PATCH /inquiry-template-versions/:id` (drafts only) with the flow, verification config and
 * settings typed as JSON. Errors come back by path inside each document.
 */
export async function updateDraftVersion(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async ({ api }) => {
    const ids = versionIdsOf(formData);
    const documents = jsonDocumentsOf({
      '/data/attributes/flow': formString(formData, 'flow'),
      '/data/attributes/verification-config': formString(formData, 'verification-config'),
      '/data/attributes/settings': formString(formData, 'settings'),
    });
    // C90.6, C99.5: sent only when the editor has them, as a server before Phase 7 has neither.
    const optionalDocuments = jsonDocumentsOf(
      Object.fromEntries(
        (['signal-config', 'list-config'] as const)
          .filter((name) => formString(formData, name) !== undefined)
          .map((name) => [`/data/attributes/${name}`, formString(formData, name)]),
      ),
    );
    const body = parseInput(updateInquiryTemplateVersionBodySchema, {
      data: {
        type: 'inquiry-template-version',
        attributes: {
          flow: documents['/data/attributes/flow'],
          'verification-config': documents['/data/attributes/verification-config'],
          settings: documents['/data/attributes/settings'],
          ...Object.fromEntries(
            Object.entries(optionalDocuments).map(([pointer, value]) => [
              pointer.slice('/data/attributes/'.length),
              value,
            ]),
          ),
        },
      },
    });
    await api.inquiryTemplateVersions.update(ids['version-id'], body.data.attributes);
    revalidatePath(versionPath(ids['inquiry-template-id'], ids['version-id']));
    return undefined;
  });
}

/**
 * `POST /inquiry-template-versions/:id/publish`: the draft becomes the template's current
 * version, and the version published before is superseded (C11).
 */
export async function publishVersion(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction(
    { permissions: ['inquiry-templates:publish'] },
    async ({ api }) => {
      const ids = versionIdsOf(formData);
      await api.inquiryTemplateVersions.publish(ids['version-id']);
      revalidatePath(templatePath(ids['inquiry-template-id']));
      revalidatePath(versionPath(ids['inquiry-template-id'], ids['version-id']));
      return undefined;
    },
  );
  // C108: a refusal in words, each error on its document by pointer.
  return result.ok ? result : { ok: false, problem: describeVersionProblem(result.problem) };
}

/** `PATCH /inquiry-templates/:id` with `status`: archive or activate. */
export async function updateTemplateStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async ({ api }) => {
    const id = templateIdOf(formData);
    const body = parseInput(updateInquiryTemplateBodySchema, {
      data: { type: 'inquiry-template', attributes: { status: formString(formData, 'status') } },
    });
    await api.inquiryTemplates.update(id, body.data.attributes);
    revalidatePath(templatePath(id));
    return undefined;
  });
}

/**
 * `POST /inquiry-templates/:id/restore` (C154.4): a new draft from a version; the API refuses with
 * `draft_exists` when the template already has one, which the button shows in words.
 */
export async function restoreVersion(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async () => {
    const { 'inquiry-template-id': id, 'version-id': versionId } = versionIdsOf(formData);
    await restoreTemplateVersion(id, versionId);
    revalidatePath(templatePath(id));
    return undefined;
  });
}
