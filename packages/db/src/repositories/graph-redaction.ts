/**
 * C102.7, C16 (Workflow 7B; P04): the redaction of a stored graph query result, by
 * `graph-query-retention-days` (default 30), in one transaction with the row locked. Built by
 * `foundation-7b` (Stage 1b (G)).
 *
 * | Column | What happens |
 * |---|---|
 * | `params` | null (the bound values a principal searched for) |
 * | `nodes`, `links`, `node_map`, `account_ids` | emptied |
 * | `redacted_at` | set; the first time stays |
 * | `status`, times, counts, the template and version | kept: the query's record, no value |
 * | `events` | payloads of the query -> the C16 stub |
 * | `api_logs`, `idempotency_keys` | stored copies about or mentioning it forgotten |
 *
 * Removing one account from every result (an account's or inquiry's redaction, C101.4) is
 * `scrubAccountFromGraphQueries`, `api-graph`'s.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { graphQueries, type GraphQueryRow } from '../schema.js';
import { forgetStoredResponses, stubEventPayloads, type RedactOptions } from './redaction.js';
import { listGraphQueriesDueForRetention, type DeleteOptions } from './retention.js';
import { firstOrNull, inserted } from './rows.js';

export interface GraphQueryRedaction {
  query: GraphQueryRow;
  /** Already redacted; `redacted_at` keeps the first time. */
  alreadyRedacted: boolean;
  /** Event payloads replaced by the C16 stub in this call. */
  stubbedEvents: number;
}

/**
 * Empties the query's params, nodes, links, node map and accounts, and sets `redacted_at`; stubs
 * its events and forgets its stored copies. `null` when it is not in this environment.
 */
export async function redactGraphQueryRecords(
  db: Db,
  environmentId: string,
  queryId: string,
  options: RedactOptions = {},
): Promise<GraphQueryRedaction | null> {
  return db.transaction(async (tx) => {
    const isThis = and(eq(graphQueries.id, queryId), eq(graphQueries.environmentId, environmentId));
    const current = firstOrNull(await tx.select().from(graphQueries).where(isThis).for('update'));
    if (current === null) {
      return null;
    }
    const at = current.redactedAt ?? options.at ?? new Date();
    const query = inserted(
      await tx
        .update(graphQueries)
        .set({
          paramsSealed: null,
          nodes: [],
          links: [],
          nodeMap: {},
          accountIds: [],
          redactedAt: at,
        })
        .where(isThis)
        .returning(),
      'redactGraphQueryRecords',
    );
    const stubbedEvents = await stubEventPayloads(tx, environmentId, [queryId], at);
    await forgetStoredResponses(tx, environmentId, [queryId]);
    return { query, alreadyRedacted: current.redactedAt !== null, stubbedEvents };
  });
}

/**
 * C102.7, C16: redacts one batch of the stored results past `graph-query-retention-days` (default
 * 30), oldest first, and answers how many it redacted; the retention pass drains it.
 */
export async function redactExpiredGraphQueries(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const at = options.now ?? new Date();
  const due = await listGraphQueriesDueForRetention(db, {
    now: at,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  let redacted = 0;
  for (const { id, environmentId } of due) {
    const outcome = await redactGraphQueryRecords(db, environmentId, id, { at });
    if (outcome !== null && !outcome.alreadyRedacted) {
      redacted += 1;
    }
  }
  return redacted;
}
