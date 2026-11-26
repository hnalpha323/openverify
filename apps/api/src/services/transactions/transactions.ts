/**
 * C105 (Workflow 7B): the transaction routes' service. Owner: `api-transactions`.
 *
 * - A transaction is validated against its type's published version and pins it; later versions
 *   never change what it holds (C104.6). Every write runs under the row lock (C111.3), refuses a
 *   redacted transaction (410 `transaction_redacted`), and checks the reference, tags and labels
 *   with the card guard, which no opt-out reaches (C104.4).
 * - `fields` are stored sealed as `{ type, value }`; a searchable field's value is keyed into
 *   `transaction_field_keys` (C105.4). A `write_once` field already set takes no other value (409).
 * - Events carry the resource with `fields: null` (C107.5); a relation event carries its
 *   `meta.context` (C105.3). Every change is audited with ids and names, never a value.
 * - Masking: the resource's `attributes` go through `mask.attributes`, so each field keeps its key
 *   and type and loses its value without `pii:view` (C105.8).
 */
import {
  filterValues,
  idSchema,
  transactionStatusSchema,
  type CreateTransactionBody,
  type EventName,
  type LabelTransactionBody,
  type RedactTransactionBody,
  type TransactionDocument,
  type TransactionIncludeDocument,
  type TransactionObjectsBody,
  type TransactionRelationBody,
  type UpdateTransactionBody,
  type getTransactionQuerySchema,
  type listTransactionsQuerySchema,
  type transactionListDocumentSchema,
} from '@openverify/contracts';
import {
  TRANSACTION_LIMITS,
  TooManyTagsError,
  addTag,
  normalizeTags,
  removeTag,
  transactionRelationProblems,
  transactionStatusProblems,
  type FieldSchema,
  type RelationSchema,
} from '@openverify/core';
import {
  addTransactionLabel,
  addTransactionObjects as attachObjects,
  addTransactionRelation as insertRelation,
  appendTransactionStatus,
  createTransaction as insertTransaction,
  findAccountByReferenceId,
  getAccount,
  getTransaction,
  inquiries,
  latestTransactionLabels,
  listCurrentTransactionTypeVersions,
  listTransactionObjects,
  listTransactionRelations,
  listTransactions as listTransactionRows,
  lockTransaction,
  markFilesDeleted,
  redactTransactionBiometricRows,
  listTransactionBiometricScope,
  removeTransactionObjects as detachObjects,
  removeTransactionRelation as deleteRelation,
  replaceTransactionFieldKeys,
  reports,
  updateTransaction as writeTransaction,
  verifications,
  type Db,
  type Transaction,
  type TransactionChanges,
  type TransactionTypeVersion,
} from '@openverify/db';
import { writeTransactionFilterValuesInTx } from '../list-filters/transaction-values.js';
import { transactionListFilters } from '../list-filters/transactions.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { UNMASKED } from '../../auth/pii.js';
import { NotFoundError, TransactionProblemError, UnprocessableContentError } from '../../errors.js';
import { storedActorOf } from '../audit-log.js';
import { deleteRenditionsForFilesInTx } from '../cases/attachments/renditions.js';
import { setTransactionReviewerInTx } from '../../workflows/actions/transactions/reviewer.js';
import { afterListItemsRedactedInTx } from '../lists/list-writes.js';
import type { ApiDependencies } from '../context.js';
import { biometricItemRedactor } from '../lists/biometric/index.js';
import { fieldError } from '../lists/field-error.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { TransactionActing } from './acting.js';
import {
  transactionLabelResource,
  transactionResource,
  transactionResources,
  transactionTypeResources,
} from './resources.js';
import {
  change,
  requireTransactionType,
  requireTransactionTypeVersion,
  throwFieldProblems,
  TRANSACTIONS_PATH,
  type TransactionChange,
} from './shared.js';
import {
  assertTexts,
  fieldValueKey,
  searchableFieldKeys,
  searchableKeysOf,
  typedFields,
  validatedFields,
} from './write-checks.js';

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type GetTransactionQuery = z.infer<typeof getTransactionQuerySchema>;

/** C9, as `AccountTagChange`. */
export type TransactionTagChange =
  | { kind: 'add'; tag: string }
  | { kind: 'remove'; tag: string }
  | { kind: 'set'; tags: readonly string[] };

const ATTRIBUTES = '/data/attributes';

const actorOfHistory = (acting: TransactionActing) => storedActorOf(acting.actor);

/** @throws {NotFoundError} for a transaction this environment does not hold. */
async function requireTransaction(db: Db, environmentId: string, id: string) {
  const transaction = await getTransaction(db, environmentId, id);
  if (transaction === null) {
    throw new NotFoundError(`Transaction ${id} was not found.`);
  }
  return transaction;
}

/** The row under its lock, not redacted: every change starts here. */
async function lockWritable(tx: Db, environmentId: string, id: string): Promise<Transaction> {
  const transaction = await lockTransaction(tx, environmentId, id);
  if (transaction === null) {
    throw new NotFoundError(`Transaction ${id} was not found.`);
  }
  if (transaction.redactedAt !== null) {
    throw new TransactionProblemError(
      'transaction_redacted',
      `Transaction ${id} was redacted; it takes no change.`,
    );
  }
  return transaction;
}

const fieldSchemasOf = (version: TransactionTypeVersion) =>
  version.fieldSchemas as readonly FieldSchema[];

async function documentOf(
  deps: ApiDependencies,
  acting: TransactionActing,
  transaction: Transaction,
): Promise<TransactionDocument> {
  return {
    data: await transactionResource(deps.db, acting.ctx.environmentId, transaction, {
      mask: acting.mask,
    }),
  };
}

/** The event's resource: `fields` is `null` (C107.5). */
const eventResource = (tx: Db, environmentId: string, transaction: Transaction) =>
  transactionResource(tx, environmentId, transaction, { mask: UNMASKED, forEvent: true });

function tagsOf(change: () => string[]): string[] {
  try {
    return change();
  } catch (error) {
    if (error instanceof TooManyTagsError) {
      throw new UnprocessableContentError(error.message);
    }
    throw error;
  }
}

export async function createTransaction(
  deps: ApiDependencies,
  acting: TransactionActing,
  attributes: CreateTransactionBody['data']['attributes'],
): Promise<TransactionDocument> {
  const transaction = await change(deps, acting, (unit) =>
    createTransactionInTx(deps, unit, acting, attributes),
  );
  return documentOf(deps, acting, transaction);
}

/** {@link createTransaction} in the caller's transaction (C117.5). */
export async function createTransactionInTx(
  deps: ApiDependencies,
  { tx, emit, audit }: TransactionChange,
  acting: TransactionActing,
  attributes: CreateTransactionBody['data']['attributes'],
): Promise<Transaction> {
  const { environmentId } = acting.ctx;
  const typeId = attributes['transaction-type-id'];
    const type = await requireTransactionType(tx, environmentId, typeId);
    if (type.status === 'archived') {
      throw new TransactionProblemError(
        'transaction_type_archived',
        'This transaction type is archived; it takes no new transaction.',
      );
    }
    const version = (await listCurrentTransactionTypeVersions(tx, environmentId, [typeId])).get(
      typeId,
    )?.published;
    if (version == null) {
      throw new TransactionProblemError(
        'transaction_type_not_published',
        'This transaction type has no published version yet.',
      );
    }
    const referenceId = attributes['reference-id'] ?? null;
    assertTexts({ 'reference-id': referenceId, tags: attributes.tags }, ATTRIBUTES);
    const values = await validatedFields(
      tx,
      environmentId,
      acting,
      version,
      attributes.fields ?? {},
      false,
    );
    const fields = typedFields(values, fieldSchemasOf(version));
    const created = await insertTransaction(tx, environmentId, {
      id: deps.ids.newId('txn'),
      transactionTypeId: typeId,
      transactionTypeVersionId: version.id,
      referenceId,
      status: version.statuses[0] ?? 'created',
      fields,
      tags: tagsOf(() => normalizeTags(attributes.tags ?? [])),
    });
    await appendTransactionStatus(tx, environmentId, {
      transactionId: created.id,
      fromStatus: null,
      toStatus: created.status,
      ...actorOfHistory(acting),
    });
    await replaceTransactionFieldKeys(
      tx,
      environmentId,
      created.id,
      [],
      searchableFieldKeys(deps.blindIndexKey, environmentId, fieldSchemasOf(version), fields),
    );
    // C165.3 (Workflow 9B Stage 1b (X)): the filterable fields' projection, `api-exports`'.
    await writeTransactionFilterValuesInTx(tx, {
      environmentId,
      transactionId: created.id,
      fieldSchemas: fieldSchemasOf(version),
      fields,
      changedFieldKeys: null,
    });
    // C105.1 (ours): an account the reference names joins the related objects.
    const account =
      referenceId === null ? null : await findAccountByReferenceId(tx, environmentId, referenceId);
    if (account !== null) {
      await attachObjects(tx, environmentId, created.id, [account.id]);
    }
    await emit('transaction.created', { data: await eventResource(tx, environmentId, created) });
    await audit({
      action: 'transaction.created',
      resourceType: 'transaction',
      resourceId: created.id,
      metadata: { 'transaction-type-id': typeId, 'transaction-type-version-id': version.id },
    });
    return created;
}

export async function listTransactions(
  deps: ApiDependencies,
  acting: TransactionActing,
  query: ListTransactionsQuery,
): Promise<z.infer<typeof transactionListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const key = query['filter[identifier][key]'];
  const value = query['filter[identifier][value]'];
  const created = query as ListTransactionsQuery & {
    'filter[created-at-start]'?: string;
    'filter[created-at-end]'?: string;
  };
  const start = created['filter[created-at-start]'];
  const end = created['filter[created-at-end]'];
  // C165.3 (Workflow 9B Stage 1b (X); B16, B18): `filter[fields.<key>]`, `api-exports`', with the
  // principal's PII visibility (it also sees `filter[identifier]`); until built it refuses a field
  // filter with 501 rather than answer unfiltered.
  const added = await transactionListFilters(deps.db, {
    environmentId,
    query,
    piiVisible: acting.mask.visible,
    blindIndexKey: deps.blindIndexKey,
  });
  const page = await withCursor(() =>
    listTransactionRows(
      deps.db,
      environmentId,
      {
        referenceId: query['filter[reference-id]'],
        transactionTypeIds: filterValues(query['filter[transaction-type-id]'], idSchema('txntp')),
        statuses: filterValues(query['filter[status]'], transactionStatusSchema),
        identifier:
          key === undefined || value === undefined
            ? undefined
            : {
                fieldKey: key,
                valueKey: fieldValueKey(deps.blindIndexKey, environmentId, key, value),
              },
        createdAtStart: start === undefined ? undefined : new Date(start),
        createdAtEnd: end === undefined ? undefined : new Date(end),
        where: added.where,
      },
      pageRequest(query),
    ),
  );
  return {
    data: await transactionResources(deps.db, environmentId, page.items, { mask: acting.mask }),
    links: {
      next: nextLink(
        TRANSACTIONS_PATH,
        {
          'filter[reference-id]': query['filter[reference-id]'],
          'filter[transaction-type-id]': query['filter[transaction-type-id]'],
          'filter[identifier][key]': key,
          'filter[identifier][value]': value,
          'filter[status]': query['filter[status]'],
          'filter[created-at-start]': start,
          'filter[created-at-end]': end,
          ...added.links,
        },
        query,
        page.next,
      ),
    },
  };
}

export async function getTransactionDocument(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  query: GetTransactionQuery,
): Promise<TransactionIncludeDocument> {
  const { environmentId } = acting.ctx;
  const transaction = await requireTransaction(deps.db, environmentId, id);
  const { data } = await documentOf(deps, acting, transaction);
  const include = new Set((query.include ?? '').split(',').filter((name) => name !== ''));
  if (include.size === 0) {
    return { data };
  }
  const included: NonNullable<TransactionIncludeDocument['included']> = [];
  if (include.has('transaction-type')) {
    const type = await requireTransactionType(
      deps.db,
      environmentId,
      transaction.transactionTypeId,
    );
    included.push(...(await transactionTypeResources(deps.db, environmentId, [type])));
  }
  if (include.has('transaction-label')) {
    const label = (await latestTransactionLabels(deps.db, environmentId, [id])).get(id);
    if (label !== undefined) {
      included.push(transactionLabelResource(label));
    }
  }
  return { data, included };
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** C105.2: a `write_once` field already set takes no other value. */
function assertWriteOnce(
  current: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, { value: unknown }>>,
  fieldSchemas: readonly FieldSchema[],
): void {
  for (const field of fieldSchemas) {
    const stored = current[field.key] as { value?: unknown } | undefined;
    const sent = next[field.key];
    if (
      field.config?.['write-policy'] === 'write_once' &&
      stored !== undefined &&
      sent !== undefined &&
      !sameJson(stored.value, sent.value)
    ) {
      throw new TransactionProblemError(
        'field_write_once',
        `The field ${field.key} is written once and already holds a value.`,
        { errors: [fieldError(`${ATTRIBUTES}/fields/${field.key}`, 'Already written.')] },
      );
    }
  }
}

async function appendLabel(
  deps: ApiDependencies,
  tx: Db,
  environmentId: string,
  transactionId: string,
  label: { label: string; score?: number | undefined; 'model-version'?: string | undefined },
) {
  return addTransactionLabel(tx, environmentId, {
    id: deps.ids.newId('txnl'),
    transactionId,
    label: label.label,
    modelVersion: label['model-version'] ?? null,
    score: label.score ?? null,
  });
}

export async function updateTransaction(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  attributes: UpdateTransactionBody['data']['attributes'],
): Promise<TransactionDocument> {
  const transaction = await change(deps, acting, (unit) =>
    updateTransactionInTx(deps, unit, acting, id, attributes),
  );
  return documentOf(deps, acting, transaction);
}

/** {@link updateTransaction} in the caller's transaction (C117.5). */
export async function updateTransactionInTx(
  deps: ApiDependencies,
  { tx, emit, audit }: TransactionChange,
  acting: TransactionActing,
  id: string,
  attributes: UpdateTransactionBody['data']['attributes'],
): Promise<Transaction> {
  const { environmentId } = acting.ctx;
    const current = await lockWritable(tx, environmentId, id);
    const version = await requireTransactionTypeVersion(
      tx,
      environmentId,
      current.transactionTypeVersionId,
    );
    const fieldSchemas = fieldSchemasOf(version);
    assertTexts(
      {
        'reference-id': attributes['reference-id'],
        tags: attributes.tags,
        label: attributes.label,
      },
      ATTRIBUTES,
    );
    const changes: TransactionChanges = {};
    let changedFieldKeys: string[] = [];
    if (attributes.fields !== undefined) {
      const values = await validatedFields(
        tx,
        environmentId,
        acting,
        version,
        attributes.fields,
        true,
      );
      const sent = typedFields(values, fieldSchemas);
      const stored = current.fields ?? {};
      assertWriteOnce(stored, sent, fieldSchemas);
      changedFieldKeys = Object.keys(sent).filter((key) => !sameJson(stored[key], sent[key]));
      if (changedFieldKeys.length > 0) {
        changes.fields = { ...stored, ...sent };
      }
    }
    if (attributes.status !== undefined && attributes.status !== current.status) {
      const problems = transactionStatusProblems(version.statuses, attributes.status);
      if (problems.length > 0) {
        throwFieldProblems(problems, ATTRIBUTES, 'The type has no such status.');
      }
      changes.status = attributes.status;
    }
    const referenceId = attributes['reference-id'];
    if (referenceId !== undefined && referenceId !== current.referenceId) {
      changes.referenceId = referenceId;
    }
    if (attributes.tags !== undefined) {
      const tags = tagsOf(() => normalizeTags(attributes.tags ?? []));
      if (!sameJson(tags, current.tags)) {
        changes.tags = tags;
      }
    }
    const changed = Object.keys(changes);
    let updated = current;
    if (changed.length > 0) {
      updated = (await writeTransaction(tx, environmentId, id, changes)) ?? current;
    }
    if (changes.fields !== undefined) {
      const searchable = searchableKeysOf(fieldSchemas).filter((key) =>
        changedFieldKeys.includes(key),
      );
      await replaceTransactionFieldKeys(
        tx,
        environmentId,
        id,
        searchable,
        searchableFieldKeys(
          deps.blindIndexKey,
          environmentId,
          fieldSchemas.filter((field) => searchable.includes(field.key)),
          changes.fields,
        ),
      );
      // C165.3 (Workflow 9B Stage 1b (X)): the changed filterable fields' projection, `api-exports`'.
      await writeTransactionFilterValuesInTx(tx, {
        environmentId,
        transactionId: id,
        fieldSchemas,
        fields: changes.fields,
        changedFieldKeys,
      });
    }
    if (changes.status !== undefined) {
      await appendTransactionStatus(tx, environmentId, {
        transactionId: id,
        fromStatus: current.status,
        toStatus: changes.status,
        ...actorOfHistory(acting),
      });
      // C127.7 (V27): whoever moved it last is served as its reviewer (`api-actions`).
      await setTransactionReviewerInTx(tx, {
        environmentId,
        transactionId: id,
        actor: acting.actor,
      });
    }
    if (attributes.label !== undefined) {
      await appendLabel(deps, tx, environmentId, id, { label: attributes.label });
    }
    if (changed.length === 0 && attributes.label === undefined) {
      return current;
    }
    const data = await eventResource(tx, environmentId, updated);
    if (changes.fields !== undefined) {
      await emit('transaction.updated-fields', { data });
    }
    if (changes.status !== undefined) {
      await emit('transaction.status-updated', {
        data,
        meta: { from: current.status, to: changes.status },
      });
    }
    if (attributes.label !== undefined) {
      await emit('transaction.labeled', { data });
    }
    await audit({
      action: 'transaction.updated',
      resourceType: 'transaction',
      resourceId: id,
      metadata: {
        attributes: [...changed, ...(attributes.label === undefined ? [] : ['label'])],
        ...(changedFieldKeys.length === 0 ? {} : { 'field-keys': changedFieldKeys }),
      },
    });
    return updated;
}

/** C105.5, through `deps.redaction.redactTransaction`; `include-never` is audited (P21). */
export async function redactTransaction(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  meta: NonNullable<RedactTransactionBody['meta']>,
): Promise<TransactionDocument> {
  const { environmentId } = acting.ctx;
  await requireTransaction(deps.db, environmentId, id);
  await deps.redaction.redactTransaction(acting.ctx, id, acting.actor, {
    includeNever: meta['include-never'] === true,
  });
  return documentOf(deps, acting, await requireTransaction(deps.db, environmentId, id));
}

const VERIFICATION_ID = /^ver_[0-9A-HJKMNP-TV-Z]{26}$/;

/** The verification ids a transaction's stored values name (its `relation-schema` fields). */
function namedVerifications(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string' && VERIFICATION_ID.test(value)) {
    found.add(value);
  } else if (Array.isArray(value)) {
    for (const member of value) {
      namedVerifications(member, found);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const member of Object.values(value)) {
      namedVerifications(member, found);
    }
  }
  return found;
}

/**
 * C105.6, in one transaction: the transaction's row, then the inquiries by id (the Phase 4 order),
 * then the face templates, background rows and biometric files of every associated object, and the
 * face and background list items they sourced (`BiometricItemRedactor`). The objects go after the
 * commit. Non-biometric data stays; a second call finds nothing left and changes nothing.
 */
export async function redactTransactionBiometrics(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
): Promise<TransactionDocument> {
  const { environmentId } = acting.ctx;
  const at = deps.clock.now();
  const outcome = await change(deps, acting, async ({ tx, audit, adopt }) => {
    const current = await lockTransaction(tx, environmentId, id);
    if (current === null) {
      throw new NotFoundError(`Transaction ${id} was not found.`);
    }
    const named = [...namedVerifications(current.fields)].sort();
    const scope = await listTransactionBiometricScope(tx, environmentId, id, named);
    const rows = await redactTransactionBiometricRows(tx, environmentId, id, { ...scope, at });
    if (rows === null) {
      throw new NotFoundError(`Transaction ${id} was not found.`);
    }
    const storageKeys: string[] = [];
    for (const inquiryId of scope.inquiryIds) {
      const items = await biometricItemRedactor.redactBySource(tx, {
        environmentId,
        inquiryId,
        at,
      });
      storageKeys.push(...items.storageKeys);
      // C127.12, C128.1 (F20, V25): what those items owe, in this transaction.
      adopt(await afterListItemsRedactedInTx(tx, deps, environmentId, items, at));
    }
    const deleted =
      rows.faceTemplates + rows.selfieBackgrounds + rows.files.length + storageKeys.length;
    if (current.biometricsRedactedAt === null || deleted > 0) {
      await audit({
        action: 'transaction.biometrics-redacted',
        resourceType: 'transaction',
        resourceId: id,
        metadata: {
          'inquiry-count': scope.inquiryIds.length,
          'verification-count': scope.verificationIds.length,
          'face-template-count': rows.faceTemplates,
          'selfie-background-count': rows.selfieBackgrounds,
          'file-count': rows.files.length,
          'list-item-object-count': storageKeys.length,
        },
      });
    }
    // C135.3 (V19, Workflow 8B (F); `api-case-files`): the redacted files' rendition pages, whose
    // objects go after the commit with the files'.
    storageKeys.push(
      ...(await deleteRenditionsForFilesInTx(tx, {
        environmentId,
        fileIds: rows.files.map((file) => file.id),
      })),
    );
    return { files: rows.files, storageKeys };
  });
  const deletedFiles: string[] = [];
  for (const file of outcome.files) {
    await deps.storage.delete(file.storageKey);
    deletedFiles.push(file.id);
  }
  await markFilesDeleted(deps.db, environmentId, deletedFiles, at);
  for (const key of outcome.storageKeys) {
    await deps.storage.delete(key);
  }
  return documentOf(deps, acting, await requireTransaction(deps.db, environmentId, id));
}

/** C105.2: the ids of `objectIds` the environment holds, by kind. */
async function existingObjects(
  tx: Db,
  environmentId: string,
  objectIds: readonly string[],
): Promise<Set<string>> {
  const of = (prefix: string) => objectIds.filter((id) => id.startsWith(`${prefix}_`));
  const found = new Set<string>();
  const inquiryIds = of('inq');
  if (inquiryIds.length > 0) {
    for (const row of await tx
      .select({ id: inquiries.id })
      .from(inquiries)
      .where(and(eq(inquiries.environmentId, environmentId), inArray(inquiries.id, inquiryIds)))) {
      found.add(row.id);
    }
  }
  const reportIds = of('rep');
  if (reportIds.length > 0) {
    for (const row of await tx
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.environmentId, environmentId), inArray(reports.id, reportIds)))) {
      found.add(row.id);
    }
  }
  const verificationIds = of('ver');
  if (verificationIds.length > 0) {
    for (const row of await tx
      .select({ id: verifications.id })
      .from(verifications)
      .where(
        and(
          eq(verifications.environmentId, environmentId),
          inArray(verifications.id, verificationIds),
        ),
      )) {
      found.add(row.id);
    }
  }
  return found;
}

export async function addTransactionObjects(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  meta: TransactionObjectsBody['meta'],
): Promise<TransactionDocument> {
  const { environmentId } = acting.ctx;
  const ids = meta['object-ids'];
  const transaction = await change(deps, acting, async ({ tx, audit }) => {
    const current = await lockWritable(tx, environmentId, id);
    const found = await existingObjects(tx, environmentId, ids);
    const missing = ids.flatMap((objectId, index) => (found.has(objectId) ? [] : [index]));
    if (missing.length > 0) {
      throw new TransactionProblemError(
        'related_object_not_found',
        'An object id names nothing this environment holds.',
        {
          errors: missing.map((index) =>
            fieldError(`/meta/object-ids/${String(index)}`, 'Names nothing here.'),
          ),
        },
      );
    }
    const attached = new Set(
      ((await listTransactionObjects(tx, environmentId, [id])).get(id) ?? []).map(
        (row) => row.objectId,
      ),
    );
    if (new Set([...attached, ...ids]).size > TRANSACTION_LIMITS.relatedObjects) {
      throw new TransactionProblemError(
        'related_objects_limit',
        `A transaction holds at most ${String(TRANSACTION_LIMITS.relatedObjects)} related objects.`,
        { errors: [fieldError('/meta/object-ids', 'Past the limit.')] },
      );
    }
    const written = await attachObjects(tx, environmentId, id, ids);
    if (written.length > 0) {
      await audit({
        action: 'transaction.objects-added',
        resourceType: 'transaction',
        resourceId: id,
        metadata: { 'object-ids': written },
      });
    }
    return current;
  });
  return documentOf(deps, acting, transaction);
}

export async function removeTransactionObjects(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  meta: TransactionObjectsBody['meta'],
): Promise<TransactionDocument> {
  const { environmentId } = acting.ctx;
  const transaction = await change(deps, acting, async ({ tx, audit }) => {
    const current = await lockWritable(tx, environmentId, id);
    const removed = await detachObjects(tx, environmentId, id, meta['object-ids']);
    if (removed.length > 0) {
      await audit({
        action: 'transaction.objects-removed',
        resourceType: 'transaction',
        resourceId: id,
        metadata: { 'object-ids': removed },
      });
    }
    return current;
  });
  return documentOf(deps, acting, transaction);
}

/** The relation's schema under the pinned version, and its target, or a refusal. */
async function relationOf(
  tx: Db,
  environmentId: string,
  current: Transaction,
  meta: TransactionRelationBody['meta'],
): Promise<RelationSchema> {
  const version = await requireTransactionTypeVersion(
    tx,
    environmentId,
    current.transactionTypeVersionId,
  );
  const relationSchemas = version.relationSchemas as readonly RelationSchema[];
  const key = meta['relation-schema-key'];
  const targetId = meta['target-object-id'];
  const problems = transactionRelationProblems(relationSchemas, key, targetId);
  if (problems.length > 0) {
    throwFieldProblems(problems, '/meta', 'The type declares no such relation for this object.');
  }
  const target = targetId.startsWith('acc_')
    ? await getAccount(tx, environmentId, targetId)
    : await getTransaction(tx, environmentId, targetId);
  if (target === null) {
    throw new TransactionProblemError(
      'related_object_not_found',
      'The target names nothing this environment holds.',
      { errors: [fieldError('/meta/target-object-id', 'Names nothing here.')] },
    );
  }
  const schema = relationSchemas.find((relation) => relation.key === key);
  if (schema === undefined) {
    throw new Error('relationOf: a relation the engine passed has no schema');
  }
  return schema;
}

const relationContext = (meta: TransactionRelationBody['meta']) => {
  const targetId = meta['target-object-id'];
  return targetId.startsWith('acc_')
    ? { 'relation-schema-key': meta['relation-schema-key'], 'related-account-id': targetId }
    : { 'relation-schema-key': meta['relation-schema-key'], 'related-txn-id': targetId };
};

async function changeRelationInTx(
  unit: TransactionChange,
  acting: TransactionActing,
  id: string,
  meta: TransactionRelationBody['meta'],
  work: (
    change: TransactionChange,
    current: Transaction,
    schema: RelationSchema,
  ) => Promise<boolean>,
  event: EventName,
): Promise<Transaction> {
  const { environmentId } = acting.ctx;
  const current = await lockWritable(unit.tx, environmentId, id);
  const schema = await relationOf(unit.tx, environmentId, current, meta);
  if (await work(unit, current, schema)) {
    await unit.emit(event, {
      data: await eventResource(unit.tx, environmentId, current),
      meta: { context: relationContext(meta) },
    });
    await unit.audit({
      action: event,
      resourceType: 'transaction',
      resourceId: id,
      metadata: relationContext(meta),
    });
  }
  return current;
}

export async function addTransactionRelation(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  meta: TransactionRelationBody['meta'],
): Promise<TransactionDocument> {
  const transaction = await change(deps, acting, (unit) =>
    addTransactionRelationInTx(unit, acting, id, meta),
  );
  return documentOf(deps, acting, transaction);
}

/** {@link addTransactionRelation} in the caller's transaction (C117.5). */
export async function addTransactionRelationInTx(
  unit: TransactionChange,
  acting: TransactionActing,
  id: string,
  meta: TransactionRelationBody['meta'],
): Promise<Transaction> {
  const { environmentId } = acting.ctx;
  const input = {
    transactionId: id,
    relationSchemaKey: meta['relation-schema-key'],
    targetId: meta['target-object-id'],
  };
  return changeRelationInTx(
    unit,
    acting,
    id,
    meta,
    async ({ tx }, _current, schema) => {
      if (schema.cardinality === 'one') {
        const held = (await listTransactionRelations(tx, environmentId, id)).filter(
          (row) => row.relationSchemaKey === schema.key && row.targetId !== input.targetId,
        );
        if (held.length > 0) {
          throw new TransactionProblemError(
            'relation_cardinality_exceeded',
            `The relation ${schema.key} holds one target; remove it before adding another.`,
            { errors: [fieldError('/meta/relation-schema-key', 'Holds one target.')] },
          );
        }
      }
      return insertRelation(tx, environmentId, input);
    },
    'transaction.added-relation',
  );
}

export async function removeTransactionRelation(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  meta: TransactionRelationBody['meta'],
): Promise<TransactionDocument> {
  const transaction = await change(deps, acting, (unit) =>
    removeTransactionRelationInTx(unit, acting, id, meta),
  );
  return documentOf(deps, acting, transaction);
}

/** {@link removeTransactionRelation} in the caller's transaction (C117.5). */
export async function removeTransactionRelationInTx(
  unit: TransactionChange,
  acting: TransactionActing,
  id: string,
  meta: TransactionRelationBody['meta'],
): Promise<Transaction> {
  const { environmentId } = acting.ctx;
  return changeRelationInTx(
    unit,
    acting,
    id,
    meta,
    ({ tx }) =>
      deleteRelation(tx, environmentId, {
        transactionId: id,
        relationSchemaKey: meta['relation-schema-key'],
        targetId: meta['target-object-id'],
      }),
    'transaction.removed-relation',
  );
}

const TAG_ACTIONS = {
  add: 'transaction.tag-added',
  remove: 'transaction.tag-removed',
  set: 'transaction.updated-tags',
} as const;

export async function changeTransactionTags(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  request: TransactionTagChange,
): Promise<TransactionDocument> {
  const transaction = await change(deps, acting, (unit) =>
    changeTransactionTagsInTx(unit, acting, id, request),
  );
  return documentOf(deps, acting, transaction);
}

/** {@link changeTransactionTags} in the caller's transaction (C117.5). */
export async function changeTransactionTagsInTx(
  { tx, audit }: TransactionChange,
  acting: TransactionActing,
  id: string,
  request: TransactionTagChange,
): Promise<Transaction> {
  const { environmentId } = acting.ctx;
  assertTexts(
    { tags: request.kind === 'set' ? request.tags : [request.tag] },
    request.kind === 'set' ? '/meta/tag-names' : '/meta/tag-name',
  );
    const current = await lockWritable(tx, environmentId, id);
    const tags = tagsOf(() =>
      request.kind === 'add'
        ? addTag(current.tags, request.tag)
        : request.kind === 'remove'
          ? removeTag(current.tags, request.tag)
          : normalizeTags(request.tags),
    );
    if (sameJson(tags, current.tags)) {
      return current;
    }
    const updated = (await writeTransaction(tx, environmentId, id, { tags })) ?? current;
    await audit({
      action: TAG_ACTIONS[request.kind],
      resourceType: 'transaction',
      resourceId: id,
      metadata: { 'tag-count': tags.length },
    });
    return updated;
}

/** Labels are append-only history; the answer is the transaction (amendment 22 of Stage 1a). */
export async function labelTransaction(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  meta: LabelTransactionBody['meta'],
): Promise<TransactionDocument> {
  const { environmentId } = acting.ctx;
  assertTexts({ label: meta.label, 'model-version': meta['model-version'] }, '/meta');
  const transaction = await change(deps, acting, async ({ tx, emit, audit }) => {
    const current = await lockWritable(tx, environmentId, id);
    const label = await appendLabel(deps, tx, environmentId, id, meta);
    await emit('transaction.labeled', { data: await eventResource(tx, environmentId, current) });
    await audit({
      action: 'transaction.labeled',
      resourceType: 'transaction',
      resourceId: id,
      metadata: { 'transaction-label-id': label.id },
    });
    return current;
  });
  return documentOf(deps, acting, transaction);
}
