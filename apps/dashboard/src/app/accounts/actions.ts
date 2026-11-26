'use server';

/**
 * Account mutations of the account page (C13, C21): server actions that validate their form with
 * the contract's schemas, call the server API as the operator, refresh the pages they change and
 * answer `{ ok } | { problem }`.
 */
import {
  MAX_ACCOUNT_OBJECTS,
  MAX_CONSOLIDATE_SOURCES,
  addAccountObjectsBodySchema,
  addAccountRelationBodySchema,
  addTagBodySchema,
  consolidateAccountsBodySchema,
  idSchema,
  removeAccountObjectsBodySchema,
  removeAccountRelationBodySchema,
  removeTagBodySchema,
  setTagsBodySchema,
  updateAccountBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { idListOf, jsonOf, tagNamesOf } from '../../components/lifecycle/action-input';
import { REDACT_PHRASE } from '../../components/lifecycle/inquiry-action-names';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction } from '../../lib/api/action';

const accountPath = (id: string) => `/accounts/${id}`;

/** The account the form field `name` names; a malformed one is a field error at `/name`. */
function accountIdOf(formData: FormData, name = 'account-id'): string {
  const input = parseInput(z.strictObject({ [name]: idSchema('acc') }), {
    [name]: formString(formData, name),
  });
  const id = input[name];
  if (id === undefined) {
    throw new TypeError(`The schema guarantees ${name}`);
  }
  return id;
}

/** `PATCH /accounts/:id` with `status`: archive or restore. */
export async function updateAccountStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const body = parseInput(updateAccountBodySchema, {
      data: { type: 'account', attributes: { status: formString(formData, 'status') } },
    });
    await api.accounts.update(id, body.data.attributes);
    revalidatePath(accountPath(id));
    return undefined;
  });
}

/** `POST /accounts/:id/add-tag`. */
export async function addAccountTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const body = parseInput(addTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.accounts.addTag(id, body.meta);
    revalidatePath(accountPath(id));
    return undefined;
  });
}

/** `POST /accounts/:id/remove-tag`. */
export async function removeAccountTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const body = parseInput(removeTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.accounts.removeTag(id, body.meta);
    revalidatePath(accountPath(id));
    return undefined;
  });
}

/** `POST /accounts/:id/set-tags`: the typed list, one tag per line, replaces every tag. */
export async function setAccountTags(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const body = parseInput(setTagsBodySchema, {
      meta: { 'tag-names': tagNamesOf(formString(formData, 'tag-names')) },
    });
    await api.accounts.setTags(id, body.meta);
    revalidatePath(accountPath(id));
    return undefined;
  });
}

/**
 * `PATCH /accounts/:id` with fields typed as a JSON object, merged into the account's and checked
 * by the API against the account type (422 by path). It needs `pii:view`, which shows the values.
 */
export async function updateAccountFields(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write', 'pii:view'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const fields = jsonOf(formString(formData, 'fields'), '/data/attributes/fields');
    const body = parseInput(updateAccountBodySchema, {
      data: { type: 'account', attributes: { fields } },
    });
    await api.accounts.update(id, body.data.attributes);
    revalidatePath(accountPath(id));
    return undefined;
  });
}

/** `POST /accounts/:id/add-relation`, from this account to another. */
export async function addAccountRelation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const body = parseInput(addAccountRelationBodySchema, {
      meta: {
        'related-account-id': formString(formData, 'related-account-id'),
        'relation-type': formString(formData, 'relation-type'),
      },
    });
    await api.accounts.addRelation(id, body.meta);
    revalidatePath(accountPath(id));
    revalidatePath(accountPath(body.meta['related-account-id']));
    return undefined;
  });
}

/**
 * `POST /accounts/:from/remove-relation`. Relations are directed, so an incoming relation is
 * removed on the account it starts from (`from-account-id`).
 */
export async function removeAccountRelation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const pageId = accountIdOf(formData);
    const from = accountIdOf(formData, 'from-account-id');
    const body = parseInput(removeAccountRelationBodySchema, {
      meta: {
        'related-account-id': formString(formData, 'related-account-id'),
        'relation-type': formString(formData, 'relation-type'),
      },
    });
    await api.accounts.removeRelation(from, body.meta);
    for (const id of new Set([pageId, from, body.meta['related-account-id']])) {
      revalidatePath(accountPath(id));
    }
    return undefined;
  });
}

/**
 * `POST /accounts/:id/consolidate`: moves the sources' inquiries, tags, fields and relations to
 * this account and archives the sources (C13).
 */
export async function consolidateAccounts(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const sources = idListOf(formString(formData, 'source-account-ids'), {
      prefix: 'acc',
      max: MAX_CONSOLIDATE_SOURCES,
      pointer: '/meta/source-account-ids',
      noun: 'account',
    });
    const body = parseInput(consolidateAccountsBodySchema, {
      meta: { 'source-account-ids': sources },
    });
    await api.accounts.consolidate(id, body.meta);
    for (const changed of [id, ...body.meta['source-account-ids']]) {
      revalidatePath(accountPath(changed));
    }
    return undefined;
  });
}

/** `POST /accounts/:id/add-objects`: links the typed inquiries to this account. */
export async function addAccountInquiries(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const inquiries = idListOf(formString(formData, 'inquiry-ids'), {
      prefix: 'inq',
      max: MAX_ACCOUNT_OBJECTS,
      pointer: '/meta/objects',
      noun: 'inquiry',
    });
    const body = parseInput(addAccountObjectsBodySchema, {
      meta: { objects: inquiries.map((inquiryId) => ({ type: 'inquiry', id: inquiryId })) },
    });
    await api.accounts.addObjects(id, body.meta);
    revalidatePath(accountPath(id));
    return undefined;
  });
}

/** `POST /accounts/:id/remove-objects` with one inquiry. */
export async function removeAccountInquiry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:write'] }, async ({ api }) => {
    const id = accountIdOf(formData);
    const body = parseInput(removeAccountObjectsBodySchema, {
      meta: { objects: [{ type: 'inquiry', id: formString(formData, 'inquiry-id') }] },
    });
    await api.accounts.removeObjects(id, body.meta);
    revalidatePath(accountPath(id));
    return undefined;
  });
}

const redactInputSchema = z.strictObject({
  'account-id': idSchema('acc'),
  confirmation: z.literal(REDACT_PHRASE, { error: `Type ${REDACT_PHRASE} to confirm.` }),
});

/**
 * Irreversible redaction (C16) of the account, its inquiries and the accounts consolidated into
 * it, once the operator typed the confirmation phrase.
 */
export async function redactAccount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['accounts:redact'] }, async ({ api }) => {
    const input = parseInput(redactInputSchema, {
      'account-id': formString(formData, 'account-id'),
      confirmation: formString(formData, 'confirmation'),
    });
    await api.accounts.redact(input['account-id']);
    revalidatePath(accountPath(input['account-id']));
    return undefined;
  });
}
