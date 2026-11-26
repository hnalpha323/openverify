'use server';

/**
 * Transaction mutations of the transactions console (C105.2, C108). Each one is a server action:
 * it validates its form with the contract's request schemas, calls the server API as the operator,
 * refreshes the transaction's page and answers `{ ok } | { problem }`. A refusal by a transaction
 * problem code is titled in words (`describeTransactionProblem`); a refusal without a code keeps the
 * API's own title, detail and pointer. No action answers a field value to the browser.
 *
 * The node client has no method for a redaction with `include-never`, so that goes through
 * `apiRequest` with its contract schema.
 */
import {
  addTagBodySchema,
  idSchema,
  labelTransactionBodySchema,
  redactTransactionBodySchema,
  removeTagBodySchema,
  setTagsBodySchema,
  transactionDocumentSchema,
  transactionObjectsBodySchema,
  transactionRelationBodySchema,
  updateTransactionBodySchema,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { tagNamesOf } from '../../components/lifecycle/action-input';
import { describeTransactionProblem } from '../../components/transactions/transaction-words';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction, type ActionContext } from '../../lib/api/action';
import { apiRequest } from '../../lib/api/client';

const transactionPath = (id: string) => `/transactions/${id}`;

/** The transaction the form names. */
const transactionIdOf = (formData: FormData) =>
  parseInput(z.strictObject({ 'transaction-id': idSchema('txn') }), {
    'transaction-id': formString(formData, 'transaction-id'),
  })['transaction-id'];

/** A text value of the form, or nothing when it was left empty. */
function optional(formData: FormData, name: string): string | undefined {
  const value = formString(formData, name);
  return value === undefined || value === '' ? undefined : value;
}

/**
 * `runAction` on the transaction the form names, refreshing its page after `run`; a refusal by a
 * transaction problem code is titled in words.
 */
async function transactionAction(
  permissions: readonly Permission[],
  formData: FormData,
  run: (id: string, context: ActionContext) => Promise<unknown>,
): Promise<ActionResult> {
  const result = await runAction({ permissions }, async (context) => {
    const id = transactionIdOf(formData);
    await run(id, context);
    revalidatePath(transactionPath(id));
    return undefined;
  });
  return result.ok ? result : { ok: false, problem: describeTransactionProblem(result.problem) };
}

const WRITE: readonly Permission[] = ['transactions:write'];

/** `PATCH /transactions/:id` with `status` (C104.5). */
export async function updateTransactionStatus(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    const body = parseInput(updateTransactionBodySchema, {
      data: { attributes: { status: formString(formData, 'status') } },
    });
    await api.transactions.update(id, body.data.attributes);
  });
}

/** `POST /transactions/:id/label`: an append-only label with its score and model version. */
export async function labelTransaction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    const score = optional(formData, 'score');
    const modelVersion = optional(formData, 'model-version');
    const body = parseInput(labelTransactionBodySchema, {
      meta: {
        label: formString(formData, 'label'),
        ...(score === undefined ? {} : { score: Number(score) }),
        ...(modelVersion === undefined ? {} : { 'model-version': modelVersion }),
      },
    });
    await api.transactions.label(id, body.meta);
  });
}

/** `POST /transactions/:id/add-objects`: inquiries, reports and verifications. */
export async function addTransactionObjects(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    const body = parseInput(transactionObjectsBodySchema, {
      meta: { 'object-ids': tagNamesOf(formString(formData, 'object-ids')) },
    });
    await api.transactions.addObjects(id, body.meta);
  });
}

/** `POST /transactions/:id/remove-objects` with the one object the row names. */
export async function removeTransactionObject(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    const body = parseInput(transactionObjectsBodySchema, {
      meta: { 'object-ids': [formString(formData, 'object-id')] },
    });
    await api.transactions.removeObjects(id, body.meta);
  });
}

const relationOf = (formData: FormData) =>
  parseInput(transactionRelationBodySchema, {
    meta: {
      'relation-schema-key': formString(formData, 'relation-schema-key'),
      'target-object-id': formString(formData, 'target-object-id'),
    },
  }).meta;

/** `POST /transactions/:id/add-relation` (idempotent). */
export async function addTransactionRelation(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    await api.transactions.addRelation(id, relationOf(formData));
  });
}

/** `POST /transactions/:id/remove-relation` (idempotent). */
export async function removeTransactionRelation(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    await api.transactions.removeRelation(id, relationOf(formData));
  });
}

export async function addTransactionTag(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    const body = parseInput(addTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.transactions.addTag(id, body.meta);
  });
}

export async function removeTransactionTag(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    const body = parseInput(removeTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.transactions.removeTag(id, body.meta);
  });
}

export async function setTransactionTags(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(WRITE, formData, async (id, { api }) => {
    const body = parseInput(setTagsBodySchema, {
      meta: { 'tag-names': tagNamesOf(formString(formData, 'tag-names')) },
    });
    await api.transactions.setTags(id, body.meta);
  });
}

/**
 * `DELETE /transactions/:id` (`transactions:redact`): erases the fields and files now, except the
 * fields marked `never` unless `include-never` is ticked (P21, an audited legal erasure).
 */
export async function redactTransaction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(['transactions:redact'], formData, async (id) => {
    const body = parseInput(
      redactTransactionBodySchema,
      formData.get('include-never') === 'on' ? { meta: { 'include-never': true } } : {},
    );
    await apiRequest({
      method: 'DELETE',
      path: transactionPath(id),
      body,
      schema: transactionDocumentSchema,
    });
  });
}

/** `POST /transactions/:id/redact-biometrics` (`transactions:redact` and `inquiries:redact`). */
export async function redactTransactionBiometrics(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return transactionAction(
    ['transactions:redact', 'inquiries:redact'],
    formData,
    async (id, { api }) => {
      await api.transactions.redactBiometrics(id);
    },
  );
}
