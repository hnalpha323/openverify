'use server';

/**
 * Report template mutations (C71.1, C71.2, C86): server actions that validate their form with the
 * contract's request schemas, call the server API as the operator, refresh the pages they change
 * and answer `{ ok } | { problem }`. A refused publish is answered in words (C72.4).
 */
import {
  createReportTemplateBodySchema,
  createReportTemplateVersionBodySchema,
  idSchema,
  updateReportTemplateBodySchema,
  updateReportTemplateVersionBodySchema,
} from '@openverify/contracts';
import { OpenVerifyApiError, type OpenVerifyClient } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { jsonOf } from '../../components/lifecycle/action-input';
import {
  configRecord,
  explicitConfig,
  publishProblemInWords,
} from '../../components/report-config/config-words';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';

const templatePath = (id: string) => `/report-templates/${id}`;
const versionPath = (templateId: string, versionId: string) =>
  `${templatePath(templateId)}/versions/${versionId}`;

const templateIdSchema = z.strictObject({ 'report-template-id': idSchema('rptp') });
const versionIdsSchema = templateIdSchema.extend({ 'version-id': idSchema('rptpv') });

const templateIdOf = (formData: FormData) =>
  parseInput(templateIdSchema, {
    'report-template-id': formString(formData, 'report-template-id'),
  })['report-template-id'];

const versionIdsOf = (formData: FormData) =>
  parseInput(versionIdsSchema, {
    'report-template-id': formString(formData, 'report-template-id'),
    'version-id': formString(formData, 'version-id'),
  });

/**
 * `POST /report-template-versions`: a new draft holding what the template's current version sets
 * (its resolved configuration less the keys at their default), then its editor.
 */
export async function createReportDraft(
  _previous: ActionState<{ path: string }>,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const result = await runAction({ permissions: ['report-templates:write'] }, async ({ api }) => {
    const id = templateIdOf(formData);
    const { data: template } = await api.reportTemplates.retrieve(id);
    const { attributes } = template;
    const body = parseInput(createReportTemplateVersionBodySchema, {
      data: {
        type: 'report-template-version',
        attributes: {
          'report-template-id': id,
          config: explicitConfig(
            attributes['report-type'],
            configRecord(attributes['current-version'].config),
          ),
        },
      },
    });
    const { data: created } = await api.reportTemplateVersions.create(body.data.attributes);
    revalidatePath(templatePath(id));
    return { path: versionPath(id, created.id) };
  });
  if (result.ok) {
    redirect(result.data.path);
  }
  return result;
}

/**
 * `PATCH /report-template-versions/:id` (drafts only) with the configuration typed as JSON. The
 * API checks it against the template's type and answers 422 with pointers inside it.
 */
export async function updateReportDraft(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['report-templates:write'] }, async ({ api }) => {
    const ids = versionIdsOf(formData);
    const config = jsonOf(
      formString(formData, 'config', { trim: false }),
      '/data/attributes/config',
    );
    const body = parseInput(updateReportTemplateVersionBodySchema, {
      data: { type: 'report-template-version', attributes: { config } },
    });
    await api.reportTemplateVersions.update(ids['version-id'], body.data.attributes);
    revalidatePath(versionPath(ids['report-template-id'], ids['version-id']));
    return undefined;
  });
}

/** The saved draft's pinned lists, to name a refused source by its id; none when unreadable. */
async function savedSearchLists(api: OpenVerifyClient, versionId: string): Promise<string[]> {
  try {
    const { data } = await api.reportTemplateVersions.retrieve(versionId);
    const lists = configRecord(data.attributes.config)['search-lists'];
    return Array.isArray(lists) ? lists.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // Only the labels need it: the refusal is answered in words either way.
    return [];
  }
}

/**
 * `POST /report-template-versions/:id/publish`: the saved draft becomes the template's current
 * version, superseding the published one (C71.1). The API checks the publish rules first (C71.2);
 * a refusal (422) or a version that is no longer a draft (409) is answered in words, each refused
 * source named by the id the saved draft holds at that place.
 */
export async function publishReportDraft(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['report-templates:publish'] }, async ({ api }) => {
    const ids = versionIdsOf(formData);
    try {
      await api.reportTemplateVersions.publish(ids['version-id']);
    } catch (error) {
      if (error instanceof OpenVerifyApiError && (error.status === 422 || error.status === 409)) {
        const { problem } = error;
        const lists = error.status === 422 ? await savedSearchLists(api, ids['version-id']) : [];
        // `runAction` answers this error's problem as it is.
        throw new ActionInputError(
          publishProblemInWords(
            {
              status: error.status,
              code: error.code,
              title: problem.title,
              detail: problem.detail,
              requestId: error.requestId ?? problem.requestId,
              errors: problem.errors?.map(({ pointer, detail }) => ({ pointer, detail })),
            },
            lists,
          ),
        );
      }
      throw error;
    }
    revalidatePath(templatePath(ids['report-template-id']));
    revalidatePath(versionPath(ids['report-template-id'], ids['version-id']));
    return undefined;
  });
}

/** `PATCH /report-templates/:id` with `status`: archive or activate (C71.1). */
export async function updateReportTemplateStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['report-templates:write'] }, async ({ api }) => {
    const id = templateIdOf(formData);
    const body = parseInput(updateReportTemplateBodySchema, {
      data: { type: 'report-template', attributes: { status: formString(formData, 'status') } },
    });
    await api.reportTemplates.update(id, body.data.attributes);
    revalidatePath(templatePath(id));
    return undefined;
  });
}

/**
 * `POST /report-templates` (C153.4, K14): a template of one type, named, with the configuration the
 * create form generated (keys left out take their default; the API pins the source lists), checked
 * with the contract first (errors by pointer), then opened. The API publishes its version 1.
 */
export async function createReportTemplate(
  _previous: ActionState<{ path: string }>,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const result = await runAction({ permissions: ['report-templates:write'] }, async ({ api }) => {
    const config = jsonOf(
      formString(formData, 'config', { trim: false }),
      '/data/attributes/config',
    );
    const body = parseInput(createReportTemplateBodySchema, {
      data: {
        type: 'report-template',
        attributes: {
          'report-type': formString(formData, 'report-type'),
          name: formString(formData, 'name'),
          config,
        },
      },
    });
    const { data: created } = await api.reportTemplates.create(body.data.attributes);
    revalidatePath('/report-templates');
    return { path: templatePath(created.id) };
  });
  if (result.ok) {
    redirect(result.data.path);
  }
  return result;
}
