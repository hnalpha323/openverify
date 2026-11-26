'use server';

/**
 * Binding a running workflow as an account action (C118.7) or a case action (C140.1), under
 * `workflows:write`: its label, what it binds to (an account type, or case templates) and its
 * parameter form's prefill, each trigger input mapped to an `account.fields.*` or `case.fields.*`
 * path, never a value (P38). The API checks the workflow's trigger and each path; a refusal comes
 * back by its pointer.
 */
import {
  createAccountActionBodySchema,
  createCaseActionBodySchema,
  idSchema,
  updateAccountActionBodySchema,
  updateCaseActionBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction } from '../../lib/api/action';

/** A form control holding one input's prefill path: `prefill.<input name>` (`PREFILL_FIELD_PREFIX`). */
const PREFILL_PREFIX = 'prefill.';

/** The prefill the form posted: each input with a path, empty ones left out. */
function prefillOf(formData: FormData): Record<string, string> {
  const prefill: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith(PREFILL_PREFIX) && typeof value === 'string' && value.trim() !== '') {
      prefill[name.slice(PREFILL_PREFIX.length)] = value.trim();
    }
  }
  return prefill;
}

/** Case template ids, separated by commas, spaces or lines. */
const idsOf = (text: string | undefined) => (text ?? '').split(/[\s,]+/).filter((id) => id !== '');

const text = (formData: FormData, name: string) => formString(formData, name) ?? '';

type Bound = ActionResult<{ readonly id: string }>;

export async function createAccountAction(
  _previous: ActionState<{ readonly id: string }>,
  formData: FormData,
): Promise<Bound> {
  return runAction({ permissions: ['workflows:write'] }, async ({ api }) => {
    const body = parseInput(createAccountActionBodySchema, {
      data: {
        type: 'account-action',
        attributes: {
          'workflow-id': text(formData, 'workflow-id'),
          'account-type-id': text(formData, 'account-type-id'),
          label: text(formData, 'label'),
          prefill: prefillOf(formData),
        },
      },
    });
    const { data } = await api.accountActions.create(body.data.attributes);
    revalidatePath('/account-actions');
    return { id: data.id };
  });
}

export async function updateAccountAction(
  _previous: ActionState<{ readonly id: string }>,
  formData: FormData,
): Promise<Bound> {
  return runAction({ permissions: ['workflows:write'] }, async ({ api }) => {
    const id = parseInput(idSchema('accac'), formString(formData, 'account-action-id'));
    const body = parseInput(updateAccountActionBodySchema, {
      data: {
        type: 'account-action',
        attributes: {
          label: text(formData, 'label'),
          status: text(formData, 'status'),
          prefill: prefillOf(formData),
        },
      },
    });
    await api.accountActions.update(id, body.data.attributes);
    revalidatePath('/account-actions');
    revalidatePath(`/account-actions/${id}`);
    return { id };
  });
}

export async function createCaseAction(
  _previous: ActionState<{ readonly id: string }>,
  formData: FormData,
): Promise<Bound> {
  return runAction({ permissions: ['workflows:write'] }, async ({ api }) => {
    const body = parseInput(createCaseActionBodySchema, {
      data: {
        type: 'case-action',
        attributes: {
          'workflow-id': text(formData, 'workflow-id'),
          'case-template-ids': idsOf(formString(formData, 'case-template-ids')),
          label: text(formData, 'label'),
          prefill: prefillOf(formData),
        },
      },
    });
    const { data } = await api.caseActions.create(body.data.attributes);
    revalidatePath('/case-actions');
    return { id: data.id };
  });
}

export async function updateCaseAction(
  _previous: ActionState<{ readonly id: string }>,
  formData: FormData,
): Promise<Bound> {
  return runAction({ permissions: ['workflows:write'] }, async ({ api }) => {
    const id = parseInput(idSchema('cact'), formString(formData, 'case-action-id'));
    const body = parseInput(updateCaseActionBodySchema, {
      data: {
        type: 'case-action',
        attributes: {
          label: text(formData, 'label'),
          status: text(formData, 'status'),
          'case-template-ids': idsOf(formString(formData, 'case-template-ids')),
          prefill: prefillOf(formData),
        },
      },
    });
    await api.caseActions.update(id, body.data.attributes);
    revalidatePath('/case-actions');
    revalidatePath(`/case-actions/${id}`);
    return { id };
  });
}
