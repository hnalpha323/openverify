'use server';

/**
 * Account type mutations (C13, C25.3): server actions validated with the contract's request
 * schema.
 */
import {
  createAccountTypeBodySchema,
  idSchema,
  updateAccountTypeBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { jsonOf } from '../../components/lifecycle/action-input';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction } from '../../lib/api/action';
import { contestRouteFromForm } from '../../lib/contest-route-form';

/**
 * `POST /account-types` (scope `accounts:write`): a name, unique in the environment, and an
 * optional fields schema typed as JSON.
 */
export async function createAccountType(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(
    { permissions: ['accounts:write'], environmentForm: formData },
    async ({ api }) => {
      const schemaText = formString(formData, 'fields-schema') ?? '';
      const fieldsSchema =
        schemaText === '' ? undefined : jsonOf(schemaText, '/data/attributes/fields-schema');
      const body = parseInput(createAccountTypeBodySchema, {
        data: {
          type: 'account-type',
          attributes: {
            name: formString(formData, 'name') ?? '',
            ...(fieldsSchema === undefined ? {} : { 'fields-schema': fieldsSchema }),
          },
        },
      });
      await api.accountTypes.create(body.data.attributes);
      revalidatePath('/account-types');
      return undefined;
    },
  );
}

const accountTypeIdSchema = z.strictObject({ 'account-type-id': idSchema('acctp') });

/**
 * `PATCH /account-types/:id` (scope `accounts:write`, C25.3): the name and the whole new fields
 * schema, typed as JSON (empty means no fields). The API is the judge of the change: a key it
 * would remove or retype answers 422 with that key's pointer, which the form shows in its editor.
 * Bound to the environment the page was rendered in, like the creation (Workflow 2D F002).
 */
export async function updateAccountType(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(
    { permissions: ['accounts:write'], environmentForm: formData },
    async ({ api }) => {
      const { 'account-type-id': id } = parseInput(accountTypeIdSchema, {
        'account-type-id': formString(formData, 'account-type-id'),
      });
      const schemaText = formString(formData, 'fields-schema') ?? '';
      // C128.3: sent only by a form that shows the route, so an older form changes nothing.
      const route =
        formString(formData, 'contest-route-shown') === 'true'
          ? { 'contest-route': contestRouteFromForm(formData, '/data/attributes/contest-route') }
          : {};
      const body = parseInput(updateAccountTypeBodySchema, {
        data: {
          type: 'account-type',
          attributes: {
            name: formString(formData, 'name') ?? '',
            'fields-schema':
              schemaText === '' ? {} : jsonOf(schemaText, '/data/attributes/fields-schema'),
            ...route,
          },
        },
      });
      await api.accountTypes.update(id, body.data.attributes);
      revalidatePath('/account-types');
      revalidatePath(`/account-types/${id}`);
      return undefined;
    },
  );
}
