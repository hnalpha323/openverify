/**
 * C107.4 (Workflow 7B; P03, V14): the webhook filter subject of a `graph-query` event. A graph query
 * links to no inquiry template or account type, so it fails any filter that is present, as a
 * transaction type does; `eventFilterSubjects` marks it strict. A webhook with no filters keeps
 * receiving it. Owner: `api-graph`, who may resolve a link if a later contract gives one.
 */
import type { WebhookFilterSubject } from '@openverify/core';
import type { Db } from '@openverify/db';

export type ResolveGraphQueryFilterSubjects = (
  db: Db,
  environmentId: string,
  payloads: readonly unknown[],
) => Promise<Pick<WebhookFilterSubject, 'inquiryTemplateId' | 'accountTypeId'>[]>;

export const resolveGraphQueryFilterSubjects: ResolveGraphQueryFilterSubjects = (
  _db,
  _environmentId,
  payloads,
) => Promise.resolve(payloads.map(() => ({})));
