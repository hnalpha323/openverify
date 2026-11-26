'use server';

/**
 * The case list's mutations (C132.3, C134.4, C137.4, C142.1).
 *
 * - A bulk action (`POST /cases/bulk`, `cases:write`, and `cases:assign` to assign) is
 *   asynchronous: it answers the action's id, whose page reads each case's outcome when the job has
 *   applied it through the single-case rules. Assigning to oneself goes through the same rule.
 * - "Next case" (`POST /cases/next`, `cases:write`, users only) pulls the most urgent unassigned case
 *   of the caller's queues and assigns it to them; an empty queue is no error.
 * - A notification is marked read on the dashboard API (`cases:read`).
 */
import {
  createCaseBulkActionBodySchema,
  idSchema,
  nextCaseBodySchema,
  userNotificationDocumentSchema,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { tagNamesOf } from '../../components/lifecycle/action-input';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, formStrings, parseInput } from '../../lib/api/action';
import { runCaseAction } from '../../lib/api/cases';
import { apiRequest } from '../../lib/api/client';

const nullable = (value: string | undefined) =>
  value === undefined || value === '' ? null : value;

/** The `meta` of each bulk action, from the form. */
function metaOf(action: string | undefined, formData: FormData): Record<string, unknown> {
  switch (action) {
    case 'assign':
      return { 'user-id': nullable(formString(formData, 'user-id')) };
    case 'set-status': {
      const optional = (name: string) => {
        const value = formString(formData, name);
        return value === undefined || value === '' ? {} : { [name]: value };
      };
      return {
        status: formString(formData, 'status'),
        ...optional('resolution'),
        ...optional('comment'),
        ...optional('status-tag'),
      };
    }
    case 'set-queue':
      return { 'case-queue-id': nullable(formString(formData, 'case-queue-id')) };
    default:
      return { 'tag-names': tagNamesOf(formString(formData, 'tags')) };
  }
}

/** `POST /cases/bulk`: one action on the selected cases (at most 500); answers its id. */
export async function createCaseBulkAction(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const action = formString(formData, 'action');
  const permissions: Permission[] = [
    'cases:write',
    ...(action === 'assign' ? (['cases:assign'] as const) : []),
  ];
  const result = await runCaseAction({ permissions }, async ({ api }) => {
    const caseIds = formStrings(formData, 'case-id');
    if (caseIds.length === 0) {
      throw new ActionInputError({
        title: 'Select cases first',
        errors: [{ pointer: '/data/attributes/case-ids', detail: 'Select at least one case.' }],
      });
    }
    const body = parseInput(createCaseBulkActionBodySchema, {
      data: { type: 'case-bulk-action', attributes: { action, 'case-ids': caseIds } },
      meta: metaOf(action, formData),
    });
    const { data } = await api.cases.bulk(body);
    revalidatePath('/cases');
    return { id: data.id };
  });
  return result;
}

/**
 * `POST /cases/next`: the case pulled from the caller's queues (or the ones the form names) and
 * assigned to them, or `null` when none waits.
 */
export async function takeNextCase(
  _state: ActionState<{ caseId: string | null }>,
  formData: FormData,
): Promise<ActionResult<{ caseId: string | null }>> {
  return runCaseAction({ permissions: ['cases:write'] }, async ({ api }) => {
    // The queues to pull from, when the form names some; otherwise every queue of the caller's.
    const queueIds = formStrings(formData, 'case-queue-id').filter((id) => id !== '');
    const body = parseInput(nextCaseBodySchema, {
      ...(queueIds.length === 0 ? {} : { meta: { 'case-queue-ids': queueIds } }),
    });
    const { data } = await api.cases.next(body?.meta);
    if (data !== null) {
      revalidatePath('/cases');
    }
    return { caseId: data?.id ?? null };
  });
}

/** `POST /dashboard/notifications/:id/read`. */
export async function markNotificationRead(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['cases:read'] }, async () => {
    const id = parseInput(idSchema('unot'), formString(formData, 'notification-id'));
    await apiRequest({
      method: 'POST',
      path: `/dashboard/notifications/${encodeURIComponent(id)}/read`,
      body: {},
      schema: userNotificationDocumentSchema,
    });
    revalidatePath('/cases/notifications');
    return undefined;
  });
}
