/**
 * C105.7 (Workflow 7B): the `transaction` relationship of inquiries, verifications and reports: the
 * latest transaction each object was attached to by `add-objects`, else `null`. Every read that
 * builds one of those resources asks this resolver. It answers every id asked for, `null` for an
 * object with none, so each resource serves `{ data: null }` rather than leaving the member out.
 *
 * Owner: `api-transactions`. It imports nothing of the services, so the inquiry service can load it
 * statically without a cycle.
 */
import { latestTransactionsOfObjects, type Db } from '@openverify/db';

export type ResolveTransactionRelationships = (
  db: Db,
  environmentId: string,
  objectIds: readonly string[],
) => Promise<ReadonlyMap<string, string | null>>;

export const resolveTransactionRelationships: ResolveTransactionRelationships = async (
  db,
  environmentId,
  objectIds,
) => {
  const latest = await latestTransactionsOfObjects(db, environmentId, objectIds);
  return new Map(objectIds.map((id) => [id, latest.get(id) ?? null]));
};
