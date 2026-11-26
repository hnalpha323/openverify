/**
 * Test support for `api-redeem`'s suites (Workflow 11A): the redemption port with the two entry
 * points `cross-tenant.ts` lacks today, written as they will be (`markInboundShareToken` over the
 * inbound token's row, bound to the destination environment; `readRedemptionSource` in the lock order
 * connection FOR SHARE, the source consent record FOR SHARE, the token FOR UPDATE, then the source as
 * it is now with the copy's material), and an optional hold inside either, so a race test can stop a
 * transaction while it holds its locks. Only tests import this file. Every value is synthetic.
 */
import { lockConnectionForShare, lockConsentRecord } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { loadRedemptionMaterial } from '../../services/connect/clone.js';
import { crossTenant } from '../../services/connect/cross-tenant.js';
import { loadShareSource } from '../../services/connect/peek.js';
import {
  redemptionCrossTenant,
  type RedemptionCrossTenant,
} from '../../services/connect/redeem.js';

const COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  status: 'status',
  pendingAt: 'pending_at',
  redeemedAt: 'redeemed_at',
  failedAt: 'failed_at',
  failureReason: 'failure_reason',
  redeemMode: 'redeem_mode',
  destinationType: 'destination_type',
  destinationId: 'destination_id',
  destinationConsentRecordId: 'destination_consent_record_id',
  redeemSummary: 'redeem_summary',
  updatedAt: 'updated_at',
});

/** Where a test may hold a transaction, and the promise it waits on there. */
export interface RedemptionHolds {
  /** Inside `markInboundShareToken`, after the row is written, before the transaction goes on. */
  afterMark?: () => Promise<void>;
  /** Inside `readRedemptionSource`, after the token is locked, before the source is read. */
  afterTokenLock?: () => Promise<void>;
}

/** The redemption port of the suites (see the header). */
export function testRedemptionPort(holds: RedemptionHolds = {}): RedemptionCrossTenant {
  return {
    ...redemptionCrossTenant,
    async markInboundShareToken(tx, caller, token, changes) {
      const sets = Object.entries(changes).map(([key, value]) =>
        key === 'redeemSummary'
          ? sql`${sql.raw(COLUMNS[key] ?? key)} = ${JSON.stringify(value)}::jsonb`
          : sql`${sql.raw(COLUMNS[key] ?? key)} = ${value instanceof Date ? value.toISOString() : value}`,
      );
      await tx.execute(sql`update connect_share_tokens set ${sql.join(sets, sql`, `)}
        where id = ${token.id} and destination_environment_id = ${caller.environmentId}`);
      await holds.afterMark?.();
      return redemptionCrossTenant.getInboundShareToken(tx, caller, token.id);
    },
    async readRedemptionSource(tx, caller, token) {
      const connection = await lockConnectionForShare(
        tx,
        caller.organizationId,
        token.connectionId,
      );
      const sourceConsent = await lockConsentRecord(
        tx,
        token.environmentId,
        token.consentRecordId,
        'share',
      );
      const locked = await redemptionCrossTenant.lockInboundShareToken(tx, caller, token.id);
      await holds.afterTokenLock?.();
      const policy = await crossTenant.inboundShareTokenPolicy(tx, caller, locked);
      const loaded = await loadShareSource(
        tx,
        locked.environmentId,
        locked.sourceType,
        locked.sourceId,
      );
      const ids =
        loaded === null
          ? []
          : loaded.content.type === 'inquiry'
            ? loaded.content.verifications.map(({ id }) => id)
            : loaded.content.type === 'verification'
              ? [loaded.content.verification.id]
              : [];
      return {
        token: locked,
        connectionStatus: connection?.status ?? 'archived',
        policy: { version: policy.version, body: policy.body },
        sourceConsent,
        sourceOrganizationName: 'Example Partner',
        source:
          loaded === null
            ? null
            : { loaded, material: await loadRedemptionMaterial(tx, locked.environmentId, ids) },
      };
    },
  };
}

/** A promise and its resolver. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
