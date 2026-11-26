/**
 * C97.4, C97.5, C99.7 (Workflow 7B): a face or background item is added from one inquiry at a time.
 * It is created `pending`, with no value and no key, and the `list-item-embed` job gives it its own
 * sealed copy. `services/lists/items.ts` routes these two kinds here, after the route checked
 * `pii:view` (C97.3) and the service took the `lists-write` policy.
 *
 * Everything is decided in one transaction: the basis under a shared lock of the environment (a
 * clear waits for this commit and redacts what it wrote), then the inquiry and the list under their
 * row locks (C40.6), so a redaction, an archive or a full list cannot pass between the check and the
 * write. The job comes after the commit, and the `list-item-embed-sweep` recovers a lost enqueue.
 */
import { newId, type IdPrefix, type ListItemDocument } from '@openverify/contracts';
import { LIST_KEYS_VERSION } from '@openverify/checks';
import { LIST_KIND_REGISTRY, LIST_LIMITS } from '@openverify/core';
import {
  getInquiry,
  getListItem,
  hasLiveBiometricItem,
  insertBiometricListItem,
  lockInquiry,
  lockList,
  type BiometricListKind,
  type Db,
  type ListItem,
  type Inquiry,
  type ListRow,
} from '@openverify/db';
import { ListProblemError, NotFoundError } from '../../../errors.js';
import { auditEntryOf, type ApiDependencies } from '../../context.js';
import { fieldError } from '../field-error.js';
import type { ListActing } from '../lists.js';
import { listItemResource } from '../resources.js';
import { biometricListsGate } from './index.js';
import { latestSelfieOf, selfieConsentHolds } from './source-selfie.js';

export type BiometricItemDeps = Pick<
  ApiDependencies,
  'db' | 'audit' | 'listItemEmbeds' | 'biometricListsGate'
>;

/** The inquiry, locked and able to be a source. */
async function lockedSource(tx: Db, environmentId: string, inquiryId: string): Promise<Inquiry> {
  await lockInquiry(tx, environmentId, inquiryId);
  const inquiry = await getInquiry(tx, environmentId, inquiryId);
  if (inquiry === null) {
    throw new NotFoundError(`Inquiry ${inquiryId} was not found.`);
  }
  const selfie =
    inquiry.redactedAt === null ? await latestSelfieOf(tx, environmentId, inquiryId) : null;
  if (inquiry.redactedAt !== null || !(await selfieConsentHolds(tx, inquiry, selfie))) {
    throw new ListProblemError(
      'consent_not_given',
      'The source inquiry did not consent to biometric matching.',
      { errors: [fieldError('/data/attributes/inquiry-id', 'Holds no matching consent.')] },
    );
  }
  return inquiry;
}

/** The list, locked, and able to take one more item of `kind`. */
async function lockedList(
  tx: Db,
  environmentId: string,
  listId: string,
  kind: BiometricListKind,
): Promise<ListRow> {
  const list = await lockList(tx, environmentId, listId);
  if (list === null) {
    throw new NotFoundError(`List ${listId} was not found.`);
  }
  if (list.type !== kind) {
    throw new ListProblemError('list_kind_mismatch', `List ${listId} holds another kind of item.`, {
      errors: [fieldError('/data/attributes/list-id', 'Names a list of another kind.')],
    });
  }
  if (list.status === 'archived') {
    throw new ListProblemError('list_archived', `List ${listId} is archived.`);
  }
  if (list.itemCount >= LIST_LIMITS.itemsPerBiometricList) {
    throw new ListProblemError(
      'list_limit_reached',
      `List ${listId} holds as many items as its limit allows.`,
    );
  }
  return list;
}

/**
 * `POST /api/v1/list-item/faces` and `.../selfie-backgrounds`.
 * @throws {ListProblemError} 409 `biometric_lists_not_acknowledged`, 422 `consent_not_given`, 422
 * `list_kind_mismatch`, 409 `list_archived`, `list_limit_reached` or `list_item_exists`.
 * @throws {NotFoundError} for an inquiry or a list this environment does not hold.
 */
export async function createBiometricListItem(
  deps: BiometricItemDeps,
  acting: ListActing,
  kind: BiometricListKind,
  attributes: Readonly<Record<string, unknown>>,
): Promise<ListItemDocument> {
  const { environmentId } = acting.ctx;
  const itemId = newId(LIST_KIND_REGISTRY[kind].itemPrefix as IdPrefix);
  const item = await deps.db.transaction((tx) =>
    createBiometricListItemInTx(tx, deps, acting, kind, attributes, itemId),
  );
  // The row is the record: a lost enqueue waits for the sweep, and the caller holds its item.
  await deps.listItemEmbeds?.enqueueListItemEmbed({ environmentId, itemId }).catch(() => undefined);
  if (item === null) {
    throw new NotFoundError(`List item ${itemId} was not found.`);
  }
  return { data: listItemResource(item, acting.mask) };
}

/**
 * {@link createBiometricListItem} in the caller's transaction, for `add_face_list_item`. A pending
 * item stages nothing (outcome 25), and the caller enqueues the embed after the commit.
 */
export async function createBiometricListItemInTx(
  tx: Db,
  deps: BiometricItemDeps,
  acting: ListActing,
  kind: BiometricListKind,
  attributes: Readonly<Record<string, unknown>>,
  itemId: string,
): Promise<ListItem | null> {
  const { environmentId } = acting.ctx;
  const listId = attributes['list-id'] as string;
  const sourceInquiryId = attributes['inquiry-id'] as string;
  const gate = deps.biometricListsGate ?? biometricListsGate;
    if (!(await gate.isAcknowledged(tx, environmentId))) {
      throw new ListProblemError(
        'biometric_lists_not_acknowledged',
        'Set `biometric-lists-basis` before adding a face or background item.',
      );
    }
    await lockedSource(tx, environmentId, sourceInquiryId);
    await lockedList(tx, environmentId, listId, kind);
    if (await hasLiveBiometricItem(tx, environmentId, listId, sourceInquiryId)) {
      throw new ListProblemError('list_item_exists', `List ${listId} already holds this inquiry.`);
    }
    await insertBiometricListItem(tx, environmentId, {
      itemId,
      listId,
      kind,
      sourceInquiryId,
      normaliserVersion: LIST_KEYS_VERSION,
      creator: { type: acting.actor.type, id: acting.actor.id },
    });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'list-item.created',
        resourceType: 'list-item',
        resourceId: itemId,
        metadata: { 'list-id': listId, kind, 'source-inquiry-id': sourceInquiryId },
      }),
    );
    return getListItem(tx, environmentId, itemId);
}
