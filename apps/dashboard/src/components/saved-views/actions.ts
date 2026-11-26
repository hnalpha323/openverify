'use server';

/**
 * Saved view changes (C165.1, C165.2): save the current filters, rename, share or stop sharing,
 * delete (the owner's view only), and copy a view shared by another user, which is how a shared
 * view is changed. A view never holds personal data: a filter the list marks as personal is refused
 * here in words before the API is asked, and the API's own refusal (`saved_view_pii_filter`) reads
 * the same. Each needs the list's read permission, as the API does.
 */
import {
  savedViewFiltersSchema,
  savedViewListSchema,
  savedViewPiiFilterKeys,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../../lib/api/saved-views';
import { SAVED_VIEW_COPY, piiRefusalWords } from './saved-view-words';
import { SAVED_VIEW_READ_PERMISSIONS } from './saved-view-permissions';
import { readNonPersonalTransactionFields } from './read-transaction-field-kinds';
import { transactionStringFieldsFor } from './transaction-field-kinds';

const PATH = /^\/[a-z0-9/_-]{1,200}$/;

function inputs(formData: FormData) {
  const list = parseInput(savedViewListSchema, formString(formData, 'list'));
  const path = formString(formData, 'path') ?? '';
  return { list, path: PATH.test(path) ? path : undefined };
}

/** The refusal of a filter the list marks as personal, in words. */
function refusePii(keys: readonly string[]): never {
  throw new ActionInputError({
    title: SAVED_VIEW_COPY.piiTitle,
    detail: piiRefusalWords(keys),
    errors: [],
  });
}

/** The API's own personal-data refusal, read the same as the console's. */
async function guardPii<T>(run: () => Promise<T>, keys: () => readonly string[]): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OpenVerifyApiError && error.code === 'saved_view_pii_filter') {
      refusePii(keys());
    }
    throw error;
  }
}

/** Saves the current filters as a view (`POST /dashboard/saved-views`). */
export async function createSavedViewAction(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { list, path } = inputs(formData);
  return runAction({ permissions: [SAVED_VIEW_READ_PERMISSIONS[list]] }, async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(formString(formData, 'filters') ?? '{}');
    } catch {
      parsed = null;
    }
    const filters = parseInput(savedViewFiltersSchema, parsed);
    // DA4 (K9-19): a field filter is saved only when the console knows it is not a string field.
    const pii = savedViewPiiFilterKeys(
      list,
      filters,
      list === 'transactions'
        ? transactionStringFieldsFor(filters, await readNonPersonalTransactionFields())
        : {},
    );
    if (pii.length > 0) {
      refusePii(pii);
    }
    const { data } = await guardPii(
      () =>
        createSavedView({
          list,
          name: formString(formData, 'name') ?? '',
          filters,
          shared: formData.get('shared') === 'on',
        }),
      () => Object.keys(filters),
    );
    if (path !== undefined) {
      revalidatePath(path);
    }
    return { id: data.id };
  });
}

/** Renames the owner's view, or shares it or stops sharing it. */
export async function updateSavedViewAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const { list, path } = inputs(formData);
  return runAction<undefined>({ permissions: [SAVED_VIEW_READ_PERMISSIONS[list]] }, async () => {
    const id = formString(formData, 'id') ?? '';
    const name = formString(formData, 'name');
    const shared = formString(formData, 'shared');
    await updateSavedView(id, {
      ...(name === undefined ? {} : { name }),
      ...(shared === undefined ? {} : { shared: shared === 'true' }),
    });
    if (path !== undefined) {
      revalidatePath(path);
    }
    return undefined;
  });
}

/** Deletes the owner's view. */
export async function deleteSavedViewAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const { list, path } = inputs(formData);
  return runAction<undefined>({ permissions: [SAVED_VIEW_READ_PERMISSIONS[list]] }, async () => {
    await deleteSavedView(formString(formData, 'id') ?? '');
    if (path !== undefined) {
      revalidatePath(path);
    }
    return undefined;
  });
}

/** Copies a view another user shared, as the caller's own, unshared, to change it. */
export async function copySavedViewAction(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { list, path } = inputs(formData);
  return runAction({ permissions: [SAVED_VIEW_READ_PERMISSIONS[list]] }, async () => {
    const id = formString(formData, 'id');
    const source = (await listSavedViews(list)).data.find((view) => view.id === id);
    if (source === undefined) {
      throw new ActionInputError({ title: SAVED_VIEW_COPY.gone, errors: [] });
    }
    const { data } = await guardPii(
      () =>
        createSavedView({
          list,
          name: `${source.attributes.name} (copy)`.slice(0, 100),
          filters: source.attributes.filters,
          shared: false,
        }),
      () => Object.keys(source.attributes.filters),
    );
    if (path !== undefined) {
      revalidatePath(path);
    }
    return { id: data.id };
  });
}
