'use server';

/**
 * The roles pages' mutations (C15, C21): create, change and delete custom roles (`roles:write`).
 * The API refuses changing a built-in role, a name already in use and deleting a role users
 * still hold (409), and granting a permission the operator lacks (403).
 */
import { createRoleBodySchema, idSchema, updateRoleBodySchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult, ActionState } from '../../lib/action-state';
import {
  ActionInputError,
  formString,
  formStrings,
  parseInput,
  runAction,
} from '../../lib/api/action';
import {
  createRole as createRoleInApi,
  deleteRole as deleteRoleInApi,
  updateRole as updateRoleInApi,
} from '../../lib/api/roles';

const ROLES_PATH = '/roles';
const WRITE = { permissions: ['roles:write'] } as const;

/** The name and permissions of the form, refused in plain words when either is missing. */
function attributesOf(formData: FormData) {
  const name = formString(formData, 'name') ?? '';
  const permissions = formStrings(formData, 'permissions');
  const errors = [
    ...(name === '' ? [{ pointer: '/data/attributes/name', detail: 'Enter a name.' }] : []),
    ...(permissions.length === 0
      ? [{ pointer: '/data/attributes/permissions', detail: 'Choose at least one permission.' }]
      : []),
  ];
  if (errors.length > 0) {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'Some values are not valid.',
      errors,
    });
  }
  return { name, permissions };
}

const roleIdOf = (formData: FormData) =>
  parseInput(z.strictObject({ 'role-id': idSchema('role') }), {
    'role-id': formString(formData, 'role-id'),
  })['role-id'];

/** Creates a custom role, then opens it. */
export async function createRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction(WRITE, async () => {
    const body = parseInput(createRoleBodySchema, {
      data: { type: 'role', attributes: attributesOf(formData) },
    });
    const role = await createRoleInApi(body.data.attributes);
    revalidatePath(ROLES_PATH);
    return role.id;
  });
  if (result.ok) {
    redirect(`${ROLES_PATH}/${result.data}`);
  }
  return result;
}

/** Changes a custom role's name and permissions. */
export async function updateRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async () => {
    const roleId = roleIdOf(formData);
    const body = parseInput(updateRoleBodySchema, {
      data: { type: 'role', attributes: attributesOf(formData) },
    });
    await updateRoleInApi(roleId, body.data.attributes);
    revalidatePath(ROLES_PATH);
    revalidatePath(`${ROLES_PATH}/${roleId}`);
    return undefined;
  });
}

/** Deletes a custom role no user holds, then opens the list. */
export async function deleteRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction(WRITE, async () => {
    await deleteRoleInApi(roleIdOf(formData));
    revalidatePath(ROLES_PATH);
    return undefined;
  });
  if (result.ok) {
    redirect(ROLES_PATH);
  }
  return result;
}
