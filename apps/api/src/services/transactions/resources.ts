/**
 * C104.1, C105.1 (Workflow 7B): the type, version, transaction and label resources from their rows.
 *
 * - A type serves the published version's `field-schemas`, `statuses` and `relation-schemas`, and
 *   empty lists until one is published (`published-version: null` says why); `latest-version` is
 *   the highest version number.
 * - A transaction's `fields` hold each stored `{ type, value }`, plus each alias of its pinned
 *   version read through its `source-key-path` (P22); masked member-wise without `pii:view`
 *   (`mask.attributes`), and `null` in every event's resource (C107.5).
 */
import {
  buildTransactionLabelResource,
  buildTransactionResource,
  buildTransactionTypeResource,
  buildTransactionTypeVersionResource,
  toVerificationResourceType,
  type SupportedVerificationType,
  type TransactionFieldValue,
  type TransactionLabelResource,
  type TransactionResource,
  type TransactionTypeResource,
  type TransactionTypeVersionResource,
} from '@openverify/contracts';
import {
  TRANSACTION_LIMITS,
  readSourceKeyPath,
  toReportResourceType,
  type FieldSchema,
  type RelationSchema,
  type ReportType,
} from '@openverify/core';
import {
  getTransactionTypeVersion,
  latestTransactionLabels,
  listCurrentTransactionTypeVersions,
  listTransactionRelatedObjects,
  type Db,
  type Transaction,
  type TransactionLabelRow,
  type TransactionRelatedObject,
  type TransactionType,
  type TransactionTypeVersion,
} from '@openverify/db';
import type { PiiMask } from '../../auth/pii.js';

type CurrentVersions = Awaited<ReturnType<typeof listCurrentTransactionTypeVersions>>;

export function transactionTypeResource(
  type: TransactionType,
  current: CurrentVersions,
): TransactionTypeResource {
  const versions = current.get(type.id);
  const published = versions?.published ?? null;
  return buildTransactionTypeResource({
    id: type.id,
    name: type.name,
    status: type.status,
    fieldSchemas: (published?.fieldSchemas ?? []) as readonly FieldSchema[],
    statuses: published?.statuses ?? [],
    relationSchemas: (published?.relationSchemas ?? []) as readonly RelationSchema[],
    adverseStatuses: type.adverseStatuses,
    contestRoute: type.contestRoute,
    latestVersion: versions?.latest?.version ?? 1,
    publishedVersion: published?.version ?? null,
    ...(versions?.latest == null ? {} : { latestVersionId: versions.latest.id }),
    publishedVersionId: published?.id ?? null,
    createdAt: type.createdAt,
    updatedAt: type.updatedAt,
  });
}

/** The resources of `types`, with their versions read in one query. */
export async function transactionTypeResources(
  db: Db,
  environmentId: string,
  types: readonly TransactionType[],
): Promise<TransactionTypeResource[]> {
  const current = await listCurrentTransactionTypeVersions(
    db,
    environmentId,
    types.map((type) => type.id),
  );
  return types.map((type) => transactionTypeResource(type, current));
}

export function transactionTypeVersionResource(
  version: TransactionTypeVersion,
): TransactionTypeVersionResource {
  return buildTransactionTypeVersionResource({
    id: version.id,
    transactionTypeId: version.transactionTypeId,
    versionNumber: version.version,
    status: version.status,
    fieldSchemas: version.fieldSchemas as readonly FieldSchema[],
    statuses: version.statuses,
    relationSchemas: version.relationSchemas as readonly RelationSchema[],
    allowCardLikeStrings: version.allowCardLikeStrings,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
  });
}

export function transactionLabelResource(label: TransactionLabelRow): TransactionLabelResource {
  return buildTransactionLabelResource({
    id: label.id,
    label: label.label ?? '',
    modelVersion: label.modelVersion,
    score: label.score,
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
  });
}

function identifierOf(object: TransactionRelatedObject) {
  switch (object.kind) {
    case 'account':
      return { type: 'account' as const, id: object.id };
    case 'inquiry':
      return { type: 'inquiry' as const, id: object.id };
    case 'report':
      return { type: toReportResourceType(object.subtype as ReportType), id: object.id };
    case 'verification':
      return {
        type: toVerificationResourceType(object.subtype as SupportedVerificationType),
        id: object.id,
      };
  }
}

/** The stored fields plus each alias of the version, as `{ type, value }`. */
export function servedFields(
  fields: Readonly<Record<string, unknown>> | null,
  fieldSchemas: readonly FieldSchema[],
): Record<string, TransactionFieldValue> | null {
  if (fields === null) {
    return null;
  }
  const served = { ...(fields as Readonly<Record<string, TransactionFieldValue>>) };
  const values = Object.fromEntries(
    Object.entries(served).map(([key, field]) => [key, field.value]),
  );
  for (const field of fieldSchemas) {
    const path = field.config?.['source-key-path'];
    if (typeof path === 'string' && !Object.hasOwn(served, field.key)) {
      const value = readSourceKeyPath(values, path);
      if (value !== undefined) {
        served[field.key] = { type: field.type as TransactionFieldValue['type'], value };
      }
    }
  }
  return served;
}

export interface TransactionResourceOptions {
  mask: PiiMask;
  /** An event's resource: `fields` is `null` (C107.5). */
  forEvent?: boolean;
}

/** The resources of `transactions`, with their objects, labels and versions read together. */
export async function transactionResources(
  db: Db,
  environmentId: string,
  transactions: readonly Transaction[],
  options: TransactionResourceOptions,
): Promise<TransactionResource[]> {
  const ids = transactions.map((transaction) => transaction.id);
  const [objects, labels] = await Promise.all([
    listTransactionRelatedObjects(db, environmentId, ids),
    latestTransactionLabels(db, environmentId, ids),
  ]);
  const versions = new Map<string, readonly FieldSchema[]>();
  if (options.forEvent !== true) {
    for (const versionId of new Set(transactions.map((row) => row.transactionTypeVersionId))) {
      const version = await getTransactionTypeVersion(db, environmentId, versionId);
      versions.set(versionId, (version?.fieldSchemas ?? []) as readonly FieldSchema[]);
    }
  }
  return transactions.map((transaction) => {
    const built = buildTransactionResource({
      id: transaction.id,
      status: transaction.status,
      referenceId: transaction.referenceId,
      fields:
        options.forEvent === true
          ? null
          : servedFields(
              transaction.fields,
              versions.get(transaction.transactionTypeVersionId) ?? [],
            ),
      tags: transaction.tags,
      transactionTypeId: transaction.transactionTypeId,
      transactionTypeVersionId: transaction.transactionTypeVersionId,
      latestLabelId: labels.get(transaction.id)?.id ?? null,
      relatedObjects: (objects.get(transaction.id) ?? [])
        .slice(0, TRANSACTION_LIMITS.relatedObjects)
        .map(identifierOf),
      reviewer:
        transaction.reviewerType === null || transaction.reviewerId === null
          ? null
          : { type: transaction.reviewerType, id: transaction.reviewerId },
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      redactedAt: transaction.redactedAt,
      biometricsRedactedAt: transaction.biometricsRedactedAt,
    });
    return { ...built, attributes: options.mask.attributes(built.attributes) };
  });
}

/** One transaction's resource. */
export async function transactionResource(
  db: Db,
  environmentId: string,
  transaction: Transaction,
  options: TransactionResourceOptions,
): Promise<TransactionResource> {
  const [resource] = await transactionResources(db, environmentId, [transaction], options);
  if (resource === undefined) {
    throw new Error('transactionResource: no resource was built');
  }
  return resource;
}
