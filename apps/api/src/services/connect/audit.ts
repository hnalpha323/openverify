/**
 * C240.4, C240.5 (Workflow 11A): the counterparty entry point of the audit writer. In the actor's
 * own environment a Connect entry names its actor through the ordinary audit writer; in the
 * counterparty's environment it names only `{organization-id, kind}` (review P26), and only this
 * module writes it. Never a value (rule 11): the details are ids only.
 *
 * Only `cross-tenant.ts` imports this module (the ESLint rule and the source test hold it). The
 * shared audit writer (`services/audit-log.ts`, `appendAuditLog`) is unchanged: the entry is stored
 * with no principal (served as the `system` actor), and the counterparty's organisation and kind of
 * principal in its metadata, so no user or key id of the other organisation is ever stored here.
 *
 * Built by `api-connect` over `foundation-11a`'s stub.
 */
import { auditActionSchema } from '@openverify/contracts';
import { appendAuditLog, type Db } from '@openverify/db';

/** The counterparty's view of who acted: the organisation and its kind of principal only. */
export interface CounterpartyActor {
  'organization-id': string;
  kind: 'user' | 'api-key' | 'workflow' | 'system';
}

/** One audit entry in the counterparty's environment. */
export interface CounterpartyAuditEntry {
  environmentId: string;
  /** Dotted kebab-case, such as `connect-connection.activated`. */
  action: string;
  actor: CounterpartyActor;
  /** Such as `connect-connection` or `connect-share-token`. */
  resourceType: string;
  /** A handle (`cxn_`, `cnst_`, `cnsr_`, `cxnp_`). */
  resourceId: string;
  /** Ids only (`cxn_`, `cnst_`, `cnsr_`, `cxnp_`), never a value. */
  details?: Record<string, string> | undefined;
}

/** Appends the entries in `tx` (the transaction of the change). */
export async function appendCounterpartyAuditEntries(
  tx: Db,
  entries: readonly CounterpartyAuditEntry[],
): Promise<void> {
  for (const entry of entries) {
    auditActionSchema.parse(entry.action);
    await appendAuditLog(tx, entry.environmentId, {
      actorType: 'system',
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: { counterparty: { ...entry.actor }, ...entry.details },
    });
  }
}
