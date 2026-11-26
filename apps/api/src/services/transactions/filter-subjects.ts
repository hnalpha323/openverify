/**
 * C107.4 (Workflow 7B; P03, V14): the strict webhook filter subject of a `transaction` event, which
 * resolves through its related accounts' types (attached, or under a relation schema) and its
 * attached inquiries' templates, all of them: a webhook filtered on any one receives it. A
 * transaction with neither link resolves to empty lists and fails any filter that is present,
 * since `eventFilterSubjects` marks the subject strict. A `transaction-type` event has no link at
 * all and is strict with nothing to resolve. Owner: `api-transactions`.
 */
import type { WebhookFilterSubject } from '@openverify/core';
import { listTransactionFilterLinks, type Db } from '@openverify/db';

export type ResolveTransactionFilterSubjects = (
  db: Db,
  environmentId: string,
  payloads: readonly unknown[],
) => Promise<Pick<WebhookFilterSubject, 'inquiryTemplateIds' | 'accountTypeIds'>[]>;

const TRANSACTION_ID = /^txn_[0-9A-HJKMNP-TV-Z]{26}$/;

/** The transaction id of a payload's `data`, if it has one. */
function transactionIdOf(payload: unknown): string | null {
  const id = (payload as { data?: { id?: unknown } } | null)?.data?.id;
  return typeof id === 'string' && TRANSACTION_ID.test(id) ? id : null;
}

export const resolveTransactionFilterSubjects: ResolveTransactionFilterSubjects = async (
  db,
  environmentId,
  payloads,
) => {
  const ids = payloads.map(transactionIdOf);
  const links = await listTransactionFilterLinks(
    db,
    environmentId,
    ids.filter((id): id is string => id !== null),
  );
  return ids.map((id) => {
    const found = id === null ? undefined : links.get(id);
    return {
      inquiryTemplateIds: found?.inquiryTemplateIds ?? [],
      accountTypeIds: found?.accountTypeIds ?? [],
    };
  });
};
