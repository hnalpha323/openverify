'use server';

/**
 * List mutations of the lists console (C97.1, C100.1, C108). Each one is a server action: it
 * validates its form with the contract's request schemas, calls the server API as the operator,
 * refreshes the list's page and answers `{ ok } | { problem }`. A refusal by a list problem code is
 * titled in words (`describeListProblem`), keeping the API's detail, field errors and request id.
 * No action answers a list value to the browser: creation answers the new list's or import's id.
 *
 * A face or background item needs `pii:view` beside `lists:write` (C97.3), and an import
 * `importers:write` beside `lists:write`, which reviewers lack (7B Stage 1a amendment 21).
 */
import {
  IMPORTER_LIST_KINDS,
  LIST_CREATE_BODY_SCHEMAS,
  LIST_ITEM_CREATE_BODY_SCHEMAS,
  LIST_KIND_REGISTRY,
  createImporterBodySchema,
  idSchema,
  listKindSchema,
  updateListBodySchema,
  type IdPrefix,
} from '@openverify/contracts';
import type { ListKind, Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { IMPORT_FILE_MAX_BYTES, describeListProblem } from '../../components/lists/list-words';
import type { ActionResult, ActionState } from '../../lib/action-state';
import {
  ActionInputError,
  formString,
  parseInput,
  runAction,
  type ActionContext,
} from '../../lib/api/action';

const listPath = (id: string) => `/lists/${id}`;

/** `runAction`, with a refusal by a list problem code titled in words. */
async function listAction<Data>(
  permissions: readonly Permission[],
  run: (context: ActionContext) => Promise<Data>,
  environmentForm?: FormData,
): Promise<ActionResult<Data>> {
  const result = await runAction(
    { permissions, ...(environmentForm === undefined ? {} : { environmentForm }) },
    run,
  );
  return result.ok ? result : { ok: false, problem: describeListProblem(result.problem) };
}

/** A text value of the form, or nothing when it was left empty. */
function optional(formData: FormData, name: string): string | undefined {
  const value = formString(formData, name);
  return value === undefined || value === '' ? undefined : value;
}

const checked = (formData: FormData, name: string) => formData.get(name) === 'on';

/** A number typed in the form; text that is not one stays text, so the schema names it. */
function numberOf(value: string | undefined): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

const kindOf = (formData: FormData): ListKind =>
  parseInput(z.strictObject({ kind: listKindSchema }), { kind: formString(formData, 'kind') }).kind;

const listIdOf = (formData: FormData): string =>
  parseInput(z.strictObject({ 'list-id': idSchema('lst') }), {
    'list-id': formString(formData, 'list-id'),
  })['list-id'];

/** The create body's attributes the form sets, for `kind`. */
function createAttributes(kind: ListKind, formData: FormData): Record<string, unknown> {
  const attributes: Record<string, unknown> = { name: optional(formData, 'name') };
  const retention = optional(formData, 'item-retention-days');
  if (retention !== undefined) {
    attributes['item-retention-days'] = numberOf(retention);
  }
  attributes['screen-at-completion'] = checked(formData, 'screen-at-completion');
  if (kind === 'field') {
    attributes['field-key'] = formString(formData, 'field-key') ?? '';
  } else if (kind === 'name') {
    attributes['allow-fuzzy-name-first'] = checked(formData, 'allow-fuzzy-name-first');
  } else if (kind === 'phone-number') {
    const region = optional(formData, 'default-region');
    if (region !== undefined) {
      attributes['default-region'] = region.toUpperCase();
    }
  } else if (kind === 'string') {
    attributes['case-sensitive'] = checked(formData, 'case-sensitive');
  } else if (kind === 'government-id-number') {
    attributes['use-for-compromised-ids'] = checked(formData, 'use-for-compromised-ids');
  }
  return attributes;
}

/** `POST /list/<plural>` (`lists:write`): answers the new list's id, for its page. */
export async function createList(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return listAction(
    ['lists:write'],
    async ({ api }) => {
      const kind = kindOf(formData);
      const body = parseInput(LIST_CREATE_BODY_SCHEMAS[kind], {
        data: { attributes: createAttributes(kind, formData) },
      });
      const { data } = await api.lists.create(
        LIST_KIND_REGISTRY[kind].plural,
        body.data.attributes,
      );
      revalidatePath('/lists');
      return { id: data.id };
    },
    formData,
  );
}

/** `PATCH /lists/:id` (`lists:write`): the name, retention, screening and compromised-ID switch. */
export async function updateList(_state: ActionState, formData: FormData): Promise<ActionResult> {
  return listAction(['lists:write'], async ({ api }) => {
    const id = listIdOf(formData);
    const retention = optional(formData, 'item-retention-days');
    const attributes: Record<string, unknown> = {
      name: optional(formData, 'name'),
      'item-retention-days': retention === undefined ? null : numberOf(retention),
      'screen-at-completion': checked(formData, 'screen-at-completion'),
      ...(optional(formData, 'purpose') === undefined
        ? {}
        : { purpose: optional(formData, 'purpose') }),
    };
    if (formString(formData, 'kind') === 'government-id-number') {
      attributes['use-for-compromised-ids'] = checked(formData, 'use-for-compromised-ids');
    }
    const body = parseInput(updateListBodySchema, { data: { attributes } });
    await api.lists.update(id, body.data.attributes);
    revalidatePath(listPath(id));
    return undefined;
  });
}

/** `DELETE /lists/:id` (`lists:write`): the list stops matching and stays readable. */
export async function archiveList(_state: ActionState, formData: FormData): Promise<ActionResult> {
  return listAction(['lists:write'], async ({ api }) => {
    const id = listIdOf(formData);
    await api.lists.archive(id);
    revalidatePath(listPath(id));
    revalidatePath('/lists');
    return undefined;
  });
}

/** The item create body's attributes the form sets, for `kind`. */
function itemAttributes(kind: ListKind, formData: FormData): Record<string, unknown> {
  const text = (name: string) => formString(formData, name) ?? '';
  switch (kind) {
    case 'country':
      return { 'country-code': text('country-code').toUpperCase() };
    case 'email-address': {
      const matchType = optional(formData, 'match-type');
      return {
        value: text('value'),
        ...(matchType === undefined ? {} : { 'match-type': matchType }),
      };
    }
    case 'face':
    case 'selfie-background':
      return { 'inquiry-id': text('inquiry-id') };
    case 'geolocation':
      return {
        latitude: numberOf(optional(formData, 'latitude')),
        longitude: numberOf(optional(formData, 'longitude')),
        'radius-meters': numberOf(optional(formData, 'radius-meters')),
      };
    case 'government-id-number': {
      const idClass = optional(formData, 'id-class');
      return {
        'id-number': text('id-number'),
        ...(idClass === undefined ? {} : { 'id-class': idClass }),
      };
    }
    case 'field':
      return { 'field-value': text('field-value') };
    case 'name':
      return { 'name-first': text('name-first'), 'name-last': text('name-last') };
    default:
      return { value: text('value') };
  }
}

/** `POST /list-item/<plural>` (`lists:write`; a face or background item also `pii:view`). */
export async function addListItem(_state: ActionState, formData: FormData): Promise<ActionResult> {
  const posted = listKindSchema.safeParse(formString(formData, 'kind')).data;
  const biometric = posted !== undefined && LIST_KIND_REGISTRY[posted].biometric;
  return listAction(biometric ? ['lists:write', 'pii:view'] : ['lists:write'], async ({ api }) => {
    const kind = kindOf(formData);
    const listId = listIdOf(formData);
    const body = parseInput(LIST_ITEM_CREATE_BODY_SCHEMAS[kind], {
      data: { attributes: { 'list-id': listId, ...itemAttributes(kind, formData) } },
    });
    await api.listItems.create(LIST_KIND_REGISTRY[kind].plural, body.data.attributes);
    revalidatePath(listPath(listId));
    return undefined;
  });
}

/** `DELETE /list-item/<plural>/:id` (`lists:write`): the item stops matching, stays readable. */
export async function archiveListItem(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return listAction(['lists:write'], async ({ api }) => {
    const kind = kindOf(formData);
    const listId = listIdOf(formData);
    const itemId = parseInput(
      z.strictObject({ 'item-id': idSchema(LIST_KIND_REGISTRY[kind].itemPrefix as IdPrefix) }),
      { 'item-id': formString(formData, 'item-id') },
    )['item-id'];
    await api.listItems.archive(LIST_KIND_REGISTRY[kind].plural, itemId);
    revalidatePath(listPath(listId));
    return undefined;
  });
}

const fileProblem = (detail: string) =>
  new ActionInputError({
    title: 'Check the file',
    detail,
    errors: [{ pointer: '/file', detail }],
  });

/**
 * `POST /importer/list-item/<plural>` (`importers:write` and `lists:write`), with the file as
 * base64 JSON: answers the importer's id, for its page.
 */
export async function importListItems(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return listAction(['importers:write', 'lists:write'], async ({ api }) => {
    const kind = kindOf(formData);
    if (!IMPORTER_LIST_KINDS.includes(kind)) {
      throw new ActionInputError({
        title: 'This kind of list has no importer',
        errors: [{ pointer: '/kind', detail: 'Face and background items are added one by one.' }],
      });
    }
    const listId = listIdOf(formData);
    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      throw fileProblem('Choose a CSV file that is not empty.');
    }
    if (file.size > IMPORT_FILE_MAX_BYTES) {
      throw fileProblem(
        'The console sends files of at most 1,000,000 bytes. Send a larger file, up to 20 MB, with the API.',
      );
    }
    const mode = optional(formData, 'mode');
    const encoding = optional(formData, 'encoding');
    const body = parseInput(createImporterBodySchema, {
      data: {
        attributes: {
          'list-id': listId,
          file: Buffer.from(await file.arrayBuffer()).toString('base64'),
          ...(mode === undefined ? {} : { mode }),
          ...(encoding === undefined ? {} : { encoding }),
        },
      },
    });
    const { data } = await api.importers.create(
      LIST_KIND_REGISTRY[kind].plural,
      body.data.attributes,
    );
    revalidatePath(listPath(listId));
    return { id: data.id };
  });
}
