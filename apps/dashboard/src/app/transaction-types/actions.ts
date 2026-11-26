'use server';

/**
 * Transaction type mutations of the types editor (C104.1, C108), with `transaction-types:write`,
 * which reviewers lack. A version is edited as a draft and published as C71 publishes; a refusal by
 * a transaction problem code is titled in words, and every publish problem keeps its pointer under
 * `/data/attributes` (7B Stage 3 amendment 4). A new draft is made from the latest version
 * (`POST /transaction-type-versions`) and opens the id it answers; a draft that already exists is
 * opened from the type's page, by its `latest-version` relationship.
 */
import {
  createTransactionTypeBodySchema,
  idSchema,
  updateTransactionTypeBodySchema,
  updateTransactionTypeVersionBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { jsonDocumentsOf } from '../../components/lifecycle/action-input';
import { describeTransactionProblem } from '../../components/transactions/transaction-words';
import type { ActionResult, ActionState } from '../../lib/action-state';
import {
  formString,
  formStrings,
  parseInput,
  runAction,
  type ActionContext,
} from '../../lib/api/action';
import { contestRouteFromForm } from '../../lib/contest-route-form';

const typePath = (id: string) => `/transaction-types/${id}`;

const idsOf = (formData: FormData, withVersion: boolean) =>
  parseInput(
    z.strictObject({
      'transaction-type-id': idSchema('txntp'),
      ...(withVersion ? { 'version-id': idSchema('txntpv') } : {}),
    }),
    {
      'transaction-type-id': formString(formData, 'transaction-type-id'),
      ...(withVersion ? { 'version-id': formString(formData, 'version-id') } : {}),
    },
  ) as { 'transaction-type-id': string; 'version-id': string };

/** `runAction` with `transaction-types:write`; a refusal by a transaction code titled in words. */
async function typeAction<Data>(
  run: (context: ActionContext) => Promise<Data>,
  environmentForm?: FormData,
): Promise<ActionResult<Data>> {
  const result = await runAction(
    {
      permissions: ['transaction-types:write'],
      ...(environmentForm === undefined ? {} : { environmentForm }),
    },
    run,
  );
  return result.ok ? result : { ok: false, problem: describeTransactionProblem(result.problem) };
}

/** `POST /transaction-types`: a new type with its draft version 1; answers the type's id. */
export async function createTransactionType(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return typeAction(async ({ api }) => {
    const body = parseInput(createTransactionTypeBodySchema, {
      data: { attributes: { name: formString(formData, 'name') } },
    });
    const { data } = await api.transactionTypes.create(body.data.attributes);
    revalidatePath('/transaction-types');
    return { id: data.id };
  }, formData);
}

/** `PATCH /transaction-types/:id`: the name only. */
export async function renameTransactionType(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return typeAction(async ({ api }) => {
    const id = idsOf(formData, false)['transaction-type-id'];
    const body = parseInput(updateTransactionTypeBodySchema, {
      data: { attributes: { name: formString(formData, 'name') } },
    });
    await api.transactionTypes.update(id, body.data.attributes);
    revalidatePath(typePath(id));
    return undefined;
  });
}

/** `DELETE /transaction-types/:id`: archives it; its transactions keep their version. */
export async function archiveTransactionType(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return typeAction(async ({ api }) => {
    const id = idsOf(formData, false)['transaction-type-id'];
    await api.transactionTypes.archive(id);
    revalidatePath(typePath(id));
    return undefined;
  });
}

/** `POST /transaction-type-versions`: a draft from the latest version; answers its id. */
export async function createTransactionTypeDraft(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return typeAction(async ({ api }) => {
    const id = idsOf(formData, false)['transaction-type-id'];
    const { data } = await api.transactionTypes.versions.create({ 'transaction-type-id': id });
    revalidatePath(typePath(id));
    return { id: data.id };
  });
}

const FIELDS = '/data/attributes/field-schemas';
const STATUSES = '/data/attributes/statuses';
const RELATIONS = '/data/attributes/relation-schemas';

/** `PATCH /transaction-type-versions/:id`: the draft's three documents and the card switch. */
export async function updateTransactionTypeDraft(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return typeAction(async ({ api }) => {
    const ids = idsOf(formData, true);
    const documents = jsonDocumentsOf({
      [FIELDS]: formString(formData, 'field-schemas'),
      [STATUSES]: formString(formData, 'statuses'),
      [RELATIONS]: formString(formData, 'relation-schemas'),
    });
    const body = parseInput(updateTransactionTypeVersionBodySchema, {
      data: {
        attributes: {
          'field-schemas': documents[FIELDS],
          statuses: documents[STATUSES],
          'relation-schemas': documents[RELATIONS],
          'allow-card-like-strings': formData.get('allow-card-like-strings') === 'on',
        },
      },
    });
    await api.transactionTypes.versions.update(ids['version-id'], body.data.attributes);
    revalidatePath(`${typePath(ids['transaction-type-id'])}/versions/${ids['version-id']}`);
    return undefined;
  });
}

/** `POST /transaction-type-versions/:id/publish`: the saved draft becomes the published version. */
export async function publishTransactionTypeDraft(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return typeAction(async ({ api }) => {
    const ids = idsOf(formData, true);
    await api.transactionTypes.versions.publish(ids['version-id']);
    revalidatePath(typePath(ids['transaction-type-id']));
    revalidatePath(`${typePath(ids['transaction-type-id'])}/versions/${ids['version-id']}`);
    return undefined;
  });
}

/**
 * C122.1, C128.3: a type's adverse statuses (an `update_transaction_status` into one is an adverse
 * step, recorded and gated like a decline) and its contest route, which an adverse step on its
 * transactions may name instead of its own. `PATCH /transaction-types/:id`; the API holds each
 * status to the newest version's and refuses one by its pointer.
 */
export async function setTransactionTypeDecisions(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return typeAction(async ({ api }) => {
    const id = idsOf(formData, false)['transaction-type-id'];
    const route = contestRouteFromForm(formData, '/data/attributes/contest-route');
    const body = parseInput(updateTransactionTypeBodySchema, {
      data: {
        type: 'transaction-type',
        attributes: {
          'adverse-statuses': formStrings(formData, 'adverse-status'),
          'contest-route': route,
        },
      },
    });
    await api.transactionTypes.update(id, body.data.attributes);
    revalidatePath(typePath(id));
    return undefined;
  });
}
