/**
 * C104.1, C104.3, C104.6 (Workflow 7B): the transaction type version routes' service. Owner:
 * `api-transactions`.
 *
 * - A draft is made from the latest version, numbered after it, its members replaced by the
 *   body's; an archived type takes no new draft.
 * - A draft changes; a published or superseded version answers 409
 *   `transaction_type_version_not_draft`.
 * - Publishing runs under the type's lock, as C71 does: the engine's rules across the version
 *   (`transactionTypeVersionProblems`), then ajv's strict compilation of each `json` field's schema,
 *   each refusal answered at its pointer. The previous published version is superseded, and a field
 *   it had that the new one drops or retypes raises `transaction-type.deleted-field` or
 *   `.converted-field`. Stored values are never rewritten: transactions keep their version.
 */
import {
  filterValues,
  idSchema,
  type CreateTransactionTypeVersionBody,
  type ListTransactionTypeVersionsQuery,
  type TransactionTypeVersionDocument,
  type TransactionTypeVersionListDocument,
  type UpdateTransactionTypeVersionBody,
} from '@openverify/contracts';
import {
  transactionTypeVersionDiff,
  transactionTypeVersionProblems,
  type FieldSchema,
} from '@openverify/core';
import {
  createTransactionTypeVersion as insertVersion,
  getTransactionType,
  latestTransactionTypeVersionNumber,
  listCurrentTransactionTypeVersions,
  listTransactionTypeVersions as listVersionRows,
  lockTransactionType,
  publishTransactionTypeVersion as publishVersionRow,
  updateTransactionTypeVersionDraft,
  type Db,
  type TransactionTypeVersion,
} from '@openverify/db';
import { NotFoundError, TransactionProblemError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { TransactionActing } from './acting.js';
import { jsonSchemaCompileProblems } from './json-schemas.js';
import { transactionTypeResources, transactionTypeVersionResource } from './resources.js';
import {
  change,
  requireTransactionTypeVersion,
  throwFieldProblems,
  versionContent,
} from './shared.js';

const notDraft = (version: TransactionTypeVersion) =>
  new TransactionProblemError(
    'transaction_type_version_not_draft',
    `Version ${String(version.version)} is ${version.status}; only drafts change or publish.`,
  );

async function lockType(tx: Db, environmentId: string, id: string) {
  const type = await lockTransactionType(tx, environmentId, id);
  if (type === null) {
    throw new NotFoundError(`Transaction type ${id} was not found.`);
  }
  return type;
}

/** Owner decision 7 after Workflow 7B: `GET /transaction-type-versions`, newest first. */
export async function listTransactionTypeVersions(
  { db }: ApiDependencies,
  acting: TransactionActing,
  query: ListTransactionTypeVersionsQuery,
): Promise<TransactionTypeVersionListDocument> {
  const filter = { 'filter[transaction-type-id]': query['filter[transaction-type-id]'] };
  const page = await withCursor(() =>
    listVersionRows(db, acting.ctx.environmentId, {
      ...pageRequest(query),
      transactionTypeIds: filterValues(filter['filter[transaction-type-id]'], idSchema('txntp')),
    }),
  );
  return {
    data: page.items.map(transactionTypeVersionResource),
    links: { next: nextLink('/api/v1/transaction-type-versions', filter, query, page.next) },
  };
}

export async function createTransactionTypeVersion(
  deps: ApiDependencies,
  acting: TransactionActing,
  attributes: CreateTransactionTypeVersionBody['data']['attributes'],
): Promise<TransactionTypeVersionDocument> {
  const { environmentId } = acting.ctx;
  const typeId = attributes['transaction-type-id'];
  const version = await change(deps, acting, async ({ tx, audit }) => {
    const type = await lockType(tx, environmentId, typeId);
    if (type.status === 'archived') {
      throw new TransactionProblemError(
        'transaction_type_archived',
        'This transaction type is archived; it takes no new version.',
      );
    }
    const latest = (await listCurrentTransactionTypeVersions(tx, environmentId, [typeId])).get(
      typeId,
    )?.latest;
    const draft = await insertVersion(tx, environmentId, {
      id: deps.ids.newId('txntpv'),
      transactionTypeId: typeId,
      version: (await latestTransactionTypeVersionNumber(tx, environmentId, typeId)) + 1,
      fieldSchemas: attributes['field-schemas'] ?? latest?.fieldSchemas ?? [],
      statuses: attributes.statuses ?? latest?.statuses ?? ['created'],
      relationSchemas: attributes['relation-schemas'] ?? latest?.relationSchemas ?? [],
      allowCardLikeStrings:
        attributes['allow-card-like-strings'] ?? latest?.allowCardLikeStrings ?? false,
    });
    await audit({
      action: 'transaction-type-version.created',
      resourceType: 'transaction-type-version',
      resourceId: draft.id,
      metadata: { 'transaction-type-id': typeId, 'version-number': draft.version },
    });
    return draft;
  });
  return { data: transactionTypeVersionResource(version) };
}

export async function getTransactionTypeVersionDocument(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
): Promise<TransactionTypeVersionDocument> {
  return {
    data: transactionTypeVersionResource(
      await requireTransactionTypeVersion(deps.db, acting.ctx.environmentId, id),
    ),
  };
}

/** Drafts only: 409 `transaction_type_version_not_draft` otherwise. */
export async function updateTransactionTypeVersion(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  attributes: UpdateTransactionTypeVersionBody['data']['attributes'],
): Promise<TransactionTypeVersionDocument> {
  const { environmentId } = acting.ctx;
  const version = await change(deps, acting, async ({ tx, audit }) => {
    const current = await requireTransactionTypeVersion(tx, environmentId, id);
    const updated = await updateTransactionTypeVersionDraft(tx, environmentId, id, {
      ...(attributes['field-schemas'] === undefined
        ? {}
        : { fieldSchemas: attributes['field-schemas'] }),
      ...(attributes.statuses === undefined ? {} : { statuses: attributes.statuses }),
      ...(attributes['relation-schemas'] === undefined
        ? {}
        : { relationSchemas: attributes['relation-schemas'] }),
      ...(attributes['allow-card-like-strings'] === undefined
        ? {}
        : { allowCardLikeStrings: attributes['allow-card-like-strings'] }),
    });
    if (updated === null) {
      throw notDraft(current);
    }
    await audit({
      action: 'transaction-type-version.updated',
      resourceType: 'transaction-type-version',
      resourceId: id,
      metadata: { attributes: Object.keys(attributes) },
    });
    return updated;
  });
  return { data: transactionTypeVersionResource(version) };
}

export async function publishTransactionTypeVersion(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
): Promise<TransactionTypeVersionDocument> {
  const { environmentId } = acting.ctx;
  const version = await change(deps, acting, async ({ tx, emit, audit }) => {
    const found = await requireTransactionTypeVersion(tx, environmentId, id);
    const typeId = found.transactionTypeId;
    await lockType(tx, environmentId, typeId);
    const draft = await requireTransactionTypeVersion(tx, environmentId, id);
    if (draft.status !== 'draft') {
      throw notDraft(draft);
    }
    const content = versionContent(draft);
    const problems = transactionTypeVersionProblems(content);
    const all = problems.length > 0 ? problems : jsonSchemaCompileProblems(content.fieldSchemas);
    if (all.length > 0) {
      throwFieldProblems(all, '/data/attributes', 'This version cannot be published as it is.');
    }
    const previous =
      (await listCurrentTransactionTypeVersions(tx, environmentId, [typeId])).get(typeId)
        ?.published ?? null;
    const result = await publishVersionRow(tx, environmentId, id, deps.clock.now());
    if (result === null) {
      throw notDraft(draft);
    }
    if (previous !== null) {
      const diff = transactionTypeVersionDiff(
        previous.fieldSchemas as readonly FieldSchema[],
        content.fieldSchemas,
      );
      const type = await getTransactionType(tx, environmentId, typeId);
      const [data] = type === null ? [] : await transactionTypeResources(tx, environmentId, [type]);
      if (data !== undefined) {
        const versionNumber = result.published.version;
        for (const key of diff.deletedFields) {
          await emit('transaction-type.deleted-field', {
            data,
            meta: { 'field-key': key, 'version-number': versionNumber },
          });
        }
        for (const { key, from, to } of diff.convertedFields) {
          await emit('transaction-type.converted-field', {
            data,
            meta: { 'field-key': key, 'version-number': versionNumber, from, to },
          });
        }
      }
    }
    await audit({
      action: 'transaction-type-version.published',
      resourceType: 'transaction-type-version',
      resourceId: id,
      metadata: {
        'transaction-type-id': typeId,
        'superseded-version-id': result.superseded?.id ?? null,
      },
    });
    return result.published;
  });
  return { data: transactionTypeVersionResource(version) };
}
