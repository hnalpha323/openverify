/**
 * C104.1 (Workflow 7B): the transaction type routes' service. Owner: `api-transactions`.
 *
 * A type comes with its first draft version (number 1), holding the body's content or the default
 * statuses (C104.5); a transaction needs a published version. `PATCH` renames; `DELETE` archives,
 * and an archived type takes no new transaction or draft. Every write is audited, with ids only.
 */
import {
  DEFAULT_TRANSACTION_STATUSES,
  filterValues,
  type ContestRoute,
  type CreateTransactionTypeBody,
  type TransactionTypeDocument,
  type UpdateTransactionTypeBody,
  type listTransactionTypesQuerySchema,
  type transactionTypeListDocumentSchema,
} from '@openverify/contracts';
import { transactionTypeStatusSchema } from '@openverify/core';
import {
  archiveTransactionType as archiveTypeRow,
  createTransactionType as insertType,
  createTransactionTypeVersion as insertVersion,
  listTransactionTypes as listTypeRows,
  listCurrentTransactionTypeVersions,
  renameTransactionType,
  updateTransactionType as writeTransactionType,
} from '@openverify/db';
import type { z } from 'zod';
import { NotFoundError, UnprocessableContentError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { fieldError } from '../lists/field-error.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { TransactionActing } from './acting.js';
import { transactionTypeResources } from './resources.js';
import { change, requireTransactionType, TRANSACTION_TYPES_PATH } from './shared.js';

export type ListTransactionTypesQuery = z.infer<typeof listTransactionTypesQuerySchema>;

async function documentOf(
  deps: ApiDependencies,
  environmentId: string,
  type: Parameters<typeof transactionTypeResources>[2][number],
): Promise<TransactionTypeDocument> {
  const [data] = await transactionTypeResources(deps.db, environmentId, [type]);
  if (data === undefined) {
    throw new Error('documentOf: no resource was built');
  }
  return { data };
}

/**
 * C122.1 (Stage 1a amendment 52): an adverse status the type cannot reach would never gate anything,
 * and read as if it did.
 * @throws {UnprocessableContentError} naming each by its pointer.
 */
function assertAdverseStatuses(
  adverse: readonly string[] | undefined,
  statuses: readonly string[],
): void {
  const errors = (adverse ?? []).flatMap((status, index) =>
    statuses.includes(status)
      ? []
      : [
          fieldError(
            `/data/attributes/adverse-statuses/${String(index)}`,
            'The type has no such status.',
          ),
        ],
  );
  if (errors.length > 0) {
    throw new UnprocessableContentError('An adverse status is not one of the type’s.', errors);
  }
}

/** The members that are the type's and not a version's, as given. */
function typeColumnsOf(attributes: {
  'adverse-statuses'?: string[] | undefined;
  'contest-route'?: ContestRoute | null | undefined;
}) {
  const adverse = attributes['adverse-statuses'];
  const route = attributes['contest-route'];
  return {
    ...(adverse === undefined ? {} : { adverseStatuses: adverse }),
    ...(route === undefined ? {} : { contestRoute: route }),
  };
}

/** A type comes with its first draft version (`transaction-types:write`). */
export async function createTransactionType(
  deps: ApiDependencies,
  acting: TransactionActing,
  attributes: CreateTransactionTypeBody['data']['attributes'],
): Promise<TransactionTypeDocument> {
  const { environmentId } = acting.ctx;
  const type = await change(deps, acting, async ({ tx, audit }) => {
    const statuses = attributes.statuses ?? DEFAULT_TRANSACTION_STATUSES;
    assertAdverseStatuses(attributes['adverse-statuses'], statuses);
    const created = await insertType(tx, environmentId, {
      id: deps.ids.newId('txntp'),
      name: attributes.name,
      ...typeColumnsOf(attributes),
    });
    const version = await insertVersion(tx, environmentId, {
      id: deps.ids.newId('txntpv'),
      transactionTypeId: created.id,
      version: 1,
      fieldSchemas: attributes['field-schemas'] ?? [],
      statuses,
      relationSchemas: attributes['relation-schemas'] ?? [],
      allowCardLikeStrings: attributes['allow-card-like-strings'] ?? false,
    });
    await audit({
      action: 'transaction-type.created',
      resourceType: 'transaction-type',
      resourceId: created.id,
      metadata: { 'transaction-type-version-id': version.id },
    });
    return created;
  });
  return documentOf(deps, environmentId, type);
}

export async function listTransactionTypes(
  deps: ApiDependencies,
  acting: TransactionActing,
  query: ListTransactionTypesQuery,
): Promise<z.infer<typeof transactionTypeListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const page = await withCursor(() =>
    listTypeRows(
      deps.db,
      environmentId,
      { statuses: filterValues(query['filter[status]'], transactionTypeStatusSchema) },
      pageRequest(query),
    ),
  );
  return {
    data: await transactionTypeResources(deps.db, environmentId, page.items),
    links: {
      next: nextLink(
        TRANSACTION_TYPES_PATH,
        { 'filter[status]': query['filter[status]'] },
        query,
        page.next,
      ),
    },
  };
}

export async function getTransactionTypeDocument(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
): Promise<TransactionTypeDocument> {
  const { environmentId } = acting.ctx;
  return documentOf(deps, environmentId, await requireTransactionType(deps.db, environmentId, id));
}

/**
 * The name, `adverse-statuses` and `contest-route` (C122.1, C128.3). Everything else is a version's,
 * so an adverse status is held to the statuses of the type's newest version.
 */
export async function updateTransactionType(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  attributes: UpdateTransactionTypeBody['data']['attributes'],
): Promise<TransactionTypeDocument> {
  const { environmentId } = acting.ctx;
  const type = await change(deps, acting, async ({ tx, audit }) => {
    const current = await requireTransactionType(tx, environmentId, id);
    const adverse = attributes['adverse-statuses'];
    if (adverse !== undefined) {
      const versions = await listCurrentTransactionTypeVersions(tx, environmentId, [id]);
      assertAdverseStatuses(adverse, versions.get(id)?.latest?.statuses ?? []);
    }
    const members = Object.keys(attributes).sort();
    if (members.length === 0) {
      return current;
    }
    if (attributes.name !== undefined) {
      await renameTransactionType(tx, environmentId, id, attributes.name);
    }
    const updated = await writeTransactionType(tx, environmentId, id, typeColumnsOf(attributes));
    if (updated === null) {
      throw new NotFoundError(`Transaction type ${id} was not found.`);
    }
    await audit({
      action: 'transaction-type.updated',
      resourceType: 'transaction-type',
      resourceId: id,
      metadata: { attributes: members },
    });
    return updated;
  });
  return documentOf(deps, environmentId, type);
}

/** `DELETE`: an archived type takes no new transaction; types are never deleted. */
export async function archiveTransactionType(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
): Promise<TransactionTypeDocument> {
  const { environmentId } = acting.ctx;
  const type = await change(deps, acting, async ({ tx, audit }) => {
    const current = await requireTransactionType(tx, environmentId, id);
    const archived = (await archiveTypeRow(tx, environmentId, id)) ?? current;
    if (current.status === 'active') {
      await audit({
        action: 'transaction-type.archived',
        resourceType: 'transaction-type',
        resourceId: id,
      });
    }
    return archived;
  });
  return documentOf(deps, environmentId, type);
}
