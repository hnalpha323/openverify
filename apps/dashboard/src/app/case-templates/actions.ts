'use server';

/**
 * Case template mutations of the case console (C130, C142.1). A template is created by its name and
 * key (which never changes), renamed and narrowed to roles with `case-templates:write`; a version is
 * edited as a draft with `case-templates:write` and published with `case-templates:publish`, which a
 * reviewer lacks. A refusal by a case problem code is titled in words, and every publish problem is
 * said in words at its place, by its pointer under `/data/attributes` (the API's 422 carries a code
 * per place, and no named problem: 8B item 63). The case subset (a field is never a file or JSON,
 * F37) is refused in words before the API is asked.
 */
import {
  createCaseTemplateBodySchema,
  createCaseTemplateVersionBodySchema,
  idSchema,
  updateCaseTemplateBodySchema,
  updateCaseTemplateVersionBodySchema,
} from '@openverify/contracts';
import { caseFieldTypeProblems, type FieldSchema } from '@openverify/core';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { LAYOUT_MODULE_WORDS, publishCodeWords } from '../../components/cases/case-words';
import { jsonDocumentsOf } from '../../components/lifecycle/action-input';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { ActionInputError, formString, formStrings, parseInput } from '../../lib/api/action';
import { getCaseTemplateVersion } from '../../lib/api/case-templates';
import { runCaseAction } from '../../lib/api/cases';

const ATTRIBUTES = '/data/attributes';
const FIELDS = `${ATTRIBUTES}/field-schemas`;
const STATUSES = `${ATTRIBUTES}/statuses`;

const templatePath = (id: string) => `/case-templates/${id}`;
const versionPath = (templateId: string, versionId: string) =>
  `${templatePath(templateId)}/versions/${versionId}`;

const templateIdOf = (formData: FormData) =>
  parseInput(idSchema('ctmpl'), formString(formData, 'case-template-id'));

const idsOf = (formData: FormData) =>
  parseInput(
    z.strictObject({ 'case-template-id': idSchema('ctmpl'), 'version-id': idSchema('ctmplv') }),
    {
      'case-template-id': formString(formData, 'case-template-id'),
      'version-id': formString(formData, 'version-id'),
    },
  );

/** Lines or comma-separated words of a text area, trimmed, the blank ones left out. */
const entriesOf = (text: string | undefined, separators = /\n/u) =>
  (text ?? '')
    .split(separators)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/** `POST /case-templates`: a template with its first draft, holding the defaults (C130.2). */
export async function createCaseTemplate(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runCaseAction(
    { permissions: ['case-templates:write'], environmentForm: formData },
    async ({ api }) => {
      const body = parseInput(createCaseTemplateBodySchema, {
        data: {
          attributes: { name: formString(formData, 'name'), key: formString(formData, 'key') },
        },
      });
      const { data } = await api.caseTemplates.create(body.data.attributes);
      revalidatePath('/case-templates');
      return { id: data.id };
    },
  );
}

/** `PATCH /case-templates/:id`: the name, and the roles that see its cases (none: every role). */
export async function updateCaseTemplate(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-templates:write'] }, async ({ api }) => {
    const id = templateIdOf(formData);
    const body = parseInput(updateCaseTemplateBodySchema, {
      data: {
        attributes: {
          name: formString(formData, 'name'),
          'visible-to-roles': entriesOf(formString(formData, 'visible-to-roles'), /[\s,]+/u),
        },
      },
    });
    await api.caseTemplates.update(id, body.data.attributes);
    revalidatePath(templatePath(id));
    return undefined;
  });
}

/** `POST /case-templates/:id/archive`: no new case; existing cases keep their version (C130.1). */
export async function archiveCaseTemplate(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-templates:write'] }, async ({ api }) => {
    const id = templateIdOf(formData);
    await api.caseTemplates.archive(id);
    revalidatePath(templatePath(id));
    revalidatePath('/case-templates');
    return undefined;
  });
}

/** `POST /case-template-versions`: a draft from the latest version; answers its id. */
export async function createCaseTemplateDraft(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runCaseAction({ permissions: ['case-templates:write'] }, async ({ api }) => {
    const id = templateIdOf(formData);
    const body = parseInput(createCaseTemplateVersionBodySchema, {
      data: { attributes: { 'case-template-id': id } },
    });
    const { data } = await api.caseTemplateVersions.create(body.data.attributes);
    revalidatePath(templatePath(id));
    return { id: data.id };
  });
}

/** F37: a case field is never a file or JSON; each refused in words at its place. */
function assertCaseSubset(fieldSchemas: unknown): void {
  if (!Array.isArray(fieldSchemas)) {
    return;
  }
  const problems = caseFieldTypeProblems(fieldSchemas as FieldSchema[]);
  if (problems.length > 0) {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'A case cannot have a file or JSON field.',
      errors: problems.map((problem) => ({
        pointer: `${ATTRIBUTES}${problem.pointer}`,
        detail:
          'A case field is never a file (attachments carry files) or JSON: choose another type.',
      })),
    });
  }
}

/** The status keys of the statuses document, when it is a list of objects with keys. */
function statusKeysOf(statuses: unknown): string[] {
  if (!Array.isArray(statuses)) {
    return [];
  }
  return statuses.flatMap((status: unknown) =>
    typeof status === 'object' &&
    status !== null &&
    typeof (status as { key?: unknown }).key === 'string'
      ? [(status as { key: string }).key]
      : [],
  );
}

/**
 * The map of the grid's `from>to` boxes, for the statuses sent: every status a key (a status the map
 * omits has no exits, C131.1), and a box naming a status no longer sent left out.
 */
function transitionsOf(formData: FormData, keys: readonly string[]): Record<string, string[]> {
  const known = new Set(keys);
  const map: Record<string, string[]> = Object.fromEntries(keys.map((key) => [key, []]));
  for (const move of formStrings(formData, 'transition')) {
    const [from = '', to = ''] = move.split('>');
    if (known.has(from) && known.has(to) && from !== to) {
      map[from]?.push(to);
    }
  }
  return map;
}

const nullableId = (formData: FormData, name: string) => {
  const value = formString(formData, name);
  return value === undefined || value === '' ? null : value;
};

/** The modules ticked, each keeping the permissions it was saved with. */
function layoutModulesOf(formData: FormData) {
  return formStrings(formData, 'layout-modules').map((key) => ({
    key,
    'required-permissions': entriesOf(formString(formData, `module-permissions:${key}`), /[\s,]+/u),
  }));
}

/** `PATCH /case-template-versions/:id`: the whole draft as the editor shows it (C130.2). */
export async function updateCaseTemplateDraft(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-templates:write'] }, async ({ api }) => {
    const ids = idsOf(formData);
    const documents = jsonDocumentsOf({
      [FIELDS]: formString(formData, 'field-schemas'),
      [STATUSES]: formString(formData, 'statuses'),
    });
    assertCaseSubset(documents[FIELDS]);
    const maxFiles = formString(formData, 'attachment-max-files') ?? '';
    const body = parseInput(updateCaseTemplateVersionBodySchema, {
      data: {
        attributes: {
          'field-schemas': documents[FIELDS],
          statuses: documents[STATUSES],
          transitions: transitionsOf(formData, statusKeysOf(documents[STATUSES])),
          resolutions: entriesOf(formString(formData, 'resolutions')),
          'default-queue-id': nullableId(formData, 'default-queue-id'),
          'assignment-policy-id': nullableId(formData, 'assignment-policy-id'),
          'sla-policy-id': nullableId(formData, 'sla-policy-id'),
          'sla-starts-on': formString(formData, 'sla-starts-on'),
          'held-object-types': formStrings(formData, 'held-object-types'),
          'attachment-policy': {
            'max-files': /^\d+$/u.test(maxFiles) ? Number(maxFiles) : maxFiles,
            types: formStrings(formData, 'attachment-types'),
          },
          'notify-on-create': entriesOf(formString(formData, 'notify-on-create'), /[\s,]+/u),
          'layout-modules': layoutModulesOf(formData),
        },
      },
    });
    await api.caseTemplateVersions.update(ids['version-id'], body.data.attributes);
    revalidatePath(versionPath(ids['case-template-id'], ids['version-id']));
    return undefined;
  });
}

const PLACES: readonly { readonly member: string; readonly words: string }[] = [
  { member: 'statuses', words: 'Status' },
  { member: 'field-schemas', words: 'Field' },
  { member: 'resolutions', words: 'Resolution' },
  { member: 'notify-on-create', words: 'Told of a new case, entry' },
];

/** A layout module's pointer (`/data/attributes/layout/modules/<n>/...`, C172.1). */
const LAYOUT_MODULE_POINTER = /^\/data\/attributes\/layout\/modules\/(\d+)(?:\/|$)/u;

/**
 * Where a pointer under `/data/attributes` is, in words ("Status 4"), or `undefined`. A layout
 * module is "Layout module 2", with its key in words when the draft's layout names one (K9-17).
 */
function placeWords(pointer: string, layoutKeys: readonly string[] | null): string | undefined {
  const layout = LAYOUT_MODULE_POINTER.exec(pointer);
  if (layout !== null) {
    const index = Number(layout[1]);
    const key = layoutKeys?.[index];
    const words =
      key !== undefined && Object.hasOwn(LAYOUT_MODULE_WORDS, key)
        ? LAYOUT_MODULE_WORDS[key as keyof typeof LAYOUT_MODULE_WORDS]
        : undefined;
    return `Layout module ${String(index + 1)}${words === undefined ? '' : ` (${words})`}`;
  }
  const parts = pointer.slice(ATTRIBUTES.length + 1).split('/');
  const [member, index] = parts;
  if (member === 'transitions' && index !== undefined) {
    return `Moves from ${index.replaceAll('~1', '/').replaceAll('~0', '~')}`;
  }
  const place = PLACES.find((each) => each.member === member);
  return place === undefined || index === undefined || !/^\d+$/u.test(index)
    ? undefined
    : `${place.words} ${String(Number(index) + 1)}`;
}

/** The keys of the draft's layout modules in order, or `null` when the draft cannot be read. */
async function layoutKeysOf(versionId: string): Promise<string[] | null> {
  try {
    const { data } = await getCaseTemplateVersion(versionId);
    return (data.attributes.layout?.modules ?? []).map((module) => module.key);
  } catch {
    return null;
  }
}

/** Whether a refused publish names a layout module, whose key only the draft holds. */
function namesLayoutModule(error: unknown): boolean {
  if (!(error instanceof OpenVerifyApiError) || !Array.isArray(error.problem.errors)) {
    return false;
  }
  return (error.problem.errors as unknown[]).some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { pointer?: unknown }).pointer === 'string' &&
      LAYOUT_MODULE_POINTER.test((item as { pointer: string }).pointer),
  );
}

/** A refused publish (a 422 with a code per place) said in words, or `null` for anything else. */
function publishProblemOf(
  error: unknown,
  layoutKeys: readonly string[] | null = null,
): DisplayProblem | null {
  if (!(error instanceof OpenVerifyApiError) || error.status !== 422) {
    return null;
  }
  const errors: unknown = error.problem.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }
  return {
    title: 'This version cannot be published',
    detail: 'Correct each problem below in the draft, save it, and publish again.',
    status: 422,
    ...(error.requestId === null ? {} : { requestId: error.requestId }),
    errors: errors.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) {
        return [];
      }
      const { pointer, detail, code } = item as Record<string, unknown>;
      if (typeof pointer !== 'string') {
        return [];
      }
      const words =
        (typeof code === 'string' ? publishCodeWords(code) : undefined) ??
        (typeof detail === 'string' ? detail : 'This cannot be published.');
      const place = placeWords(pointer, layoutKeys);
      return [{ pointer, detail: place === undefined ? words : `${place}: ${words}` }];
    }),
  };
}

/** `POST /case-template-versions/:id/publish`: the saved draft becomes the published version. */
export async function publishCaseTemplateDraft(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-templates:publish'] }, async ({ api }) => {
    const ids = idsOf(formData);
    try {
      await api.caseTemplateVersions.publish(ids['version-id']);
    } catch (error) {
      // K9-17: a layout module is named by its key, which only the draft holds.
      const keys = namesLayoutModule(error) ? await layoutKeysOf(ids['version-id']) : null;
      const problem = publishProblemOf(error, keys);
      if (problem !== null) {
        throw new ActionInputError(problem);
      }
      throw error;
    }
    revalidatePath(templatePath(ids['case-template-id']));
    revalidatePath(versionPath(ids['case-template-id'], ids['version-id']));
    return undefined;
  });
}
