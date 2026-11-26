/**
 * C241.1-C241.3, C236.10 (Workflow 11A, `api-consent`): what a redaction does to Connect, called in
 * the redaction's own transaction (`services/redaction.ts` for an inquiry and an account,
 * `redactTransactionInTx` for a transaction, which the inquiry and account cascades reach too; Stage
 * 1a amendment 18):
 *
 * - A source redacted before redemption (C241.1): every `created` token whose source is the redacted
 *   object (an inquiry's verifications included) becomes `failed` with `source_redacted`, with
 *   `connect/share-token.failed` on both sides; a `pending` one fails when its job commits
 *   (`api-redeem`'s re-read).
 * - A source redacted after redemption (C241.2): nothing changes at the destination (its copy is its
 *   own); the destination hears `connect/share-token.source-redacted`, advisory only.
 * - Consent records (C241.3, C236.10): every record about the object (or its verifications, or, for
 *   an account, its inquiries) is redacted: its sealed evidence, its attested text, its text keys, its
 *   session and its subject link are cleared, its bare fact kept for `consent-proof-retention-days`.
 *   A destination record follows the copy it covers (its subject is the copy), so the copy's
 *   redaction reaches it the same way.
 *
 * The events go to the outbox (`createOutboxOnlyPublisher`): the hook has no publisher of its own,
 * so the rows wait for their sweeps, as every outbox row may. The audit entries name the system in
 * the source environment and `{organization-id, kind: system}` in the counterparty's (C240.4).
 *
 * `foundation-11a` placed the calls (Stage 1b (K)); `api-consent` builds them (its file).
 */
import {
  getConsentConnection,
  getEnvironment,
  listInquiryVerifications,
  lockOutboundShareTokenForUpdate,
  redactConsentRecordsOfSubject,
  updateOutboundShareToken,
  type ConnectShareToken,
  type ConsentRecordSubject,
  type Db,
} from '@openverify/db';
import { sql } from 'drizzle-orm';
import { createOutboxOnlyPublisher } from '../../events/index.js';
import { createAuditLogger } from '../audit-log.js';
import { crossTenant } from './cross-tenant.js';
import { stageTokenChange, type ShareTokenAuditAction } from './share-tokens.js';

/** One redacted object, in the redaction's transaction. */
export interface ConnectRedactedObject {
  environmentId: string;
  id: string;
  at: Date;
}

export interface ConnectRedactionHooks {
  inquiryRedactedInTx(tx: Db, object: ConnectRedactedObject): Promise<void>;
  accountRedactedInTx(tx: Db, object: ConnectRedactedObject): Promise<void>;
  transactionRedactedInTx(tx: Db, object: ConnectRedactedObject): Promise<void>;
}

/** The token's audit action for a source redaction told to the destination. */
const SOURCE_REDACTED_AUDIT = 'source-redacted' as ShareTokenAuditAction;

/** The tokens and consent records a redaction of `subjects` reaches, in `tx`. */
async function redactedInTx(
  tx: Db,
  environmentId: string,
  subjects: readonly ConsentRecordSubject[],
  at: Date,
): Promise<void> {
  const environment = await getEnvironment(tx, environmentId);
  if (environment === null) {
    return;
  }
  const ids = subjects.map((subject) => subject.id);
  const deps = { events: createOutboxOnlyPublisher(tx), audit: createAuditLogger() };
  const touching = await crossTenant.listSharesTouching(tx, environmentId, ids);
  const sources = touching.tokens.filter(
    (token: ConnectShareToken) =>
      token.environmentId === environmentId && ids.includes(token.sourceId),
  );
  for (const found of sources) {
    const token = await lockOutboundShareTokenForUpdate(tx, environmentId, found.id);
    if (token === null || (token.status !== 'created' && token.status !== 'redeemed')) {
      continue;
    }
    const connection = await getConsentConnection(
      tx,
      environment.organizationId,
      token.connectionId,
    );
    if (connection === null) {
      continue;
    }
    const sides = {
      sourceOrganizationId: connection.sourceOrganizationId,
      destinationOrganizationId: connection.destinationOrganizationId,
    };
    const actor = {
      kind: 'system' as const,
      sourceOrganizationId: connection.sourceOrganizationId,
    };
    if (token.status === 'created') {
      const failed = await updateOutboundShareToken(tx, environmentId, token.id, {
        status: 'failed',
        failureReason: 'source_redacted',
        failedAt: at,
        updatedAt: at,
      });
      await stageTokenChange(deps, tx, actor, failed, {
        source: 'connect/share-token.failed',
        destination: 'connect/share-token.failed',
        audit: 'failed',
        ...sides,
      });
    } else {
      // C241.2: advisory only; the copy is the destination's own.
      await stageTokenChange(deps, tx, actor, token, {
        source: null,
        destination: 'connect/share-token.source-redacted',
        audit: SOURCE_REDACTED_AUDIT,
        ...sides,
      });
    }
  }
  for (const subject of subjects) {
    await redactConsentRecordsOfSubject(tx, environmentId, subject, at);
  }
}

/** An inquiry and its verifications, as subjects. */
async function inquirySubjects(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<ConsentRecordSubject[]> {
  const verifications = await listInquiryVerifications(tx, environmentId, inquiryId);
  return [
    { type: 'inquiry', id: inquiryId },
    ...verifications.map(({ id }) => ({ type: 'verification' as const, id })),
  ];
}

export const connectRedactionHooks: ConnectRedactionHooks = {
  async inquiryRedactedInTx(tx, { environmentId, id, at }) {
    await redactedInTx(tx, environmentId, await inquirySubjects(tx, environmentId, id), at);
  },
  async accountRedactedInTx(tx, { environmentId, id, at }) {
    // The account's inquiries are redacted with it; their shares and records go here too, so the
    // hook does not depend on the order the cascade reaches them in.
    const result: unknown = await tx.execute(
      sql`select id from inquiries where environment_id = ${environmentId} and account_id = ${id}`,
    );
    const subjects: ConsentRecordSubject[] = [{ type: 'account', id }];
    for (const row of (result as { rows: { id: string }[] }).rows) {
      subjects.push(...(await inquirySubjects(tx, environmentId, row.id)));
    }
    await redactedInTx(tx, environmentId, subjects, at);
  },
  async transactionRedactedInTx(tx, { environmentId, id, at }) {
    await redactedInTx(tx, environmentId, [{ type: 'transaction', id }], at);
  },
};
