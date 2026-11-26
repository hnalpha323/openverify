/**
 * C232.5 (Workflow 11A, `api-connect`): the `connect-token-expiry` pass, run every minute by the
 * worker while the install allows Connect: `created` tokens past `expires-at` become `expired` with
 * `expiry-reason: time`, in batches of {@link CONNECT_TOKEN_EXPIRY_BATCH} under `FOR UPDATE SKIP
 * LOCKED` (`expireDueShareTokens`), each batch in its own transaction with its events and audit
 * entries on both sides (the source's as the system's, the destination's through the cross-tenant
 * module naming only `{organization-id, kind: system}`). A row another transaction holds (a
 * redemption, a deactivation, a withdrawal) is skipped and left for the next pass; a redemption also
 * refuses a token past `expires-at` before the sweep reaches it.
 *
 * The pass writes its events as the outbox (no producer is bound in a repeatable job): the webhook
 * dispatcher's and the workflow triggers' sweeps enqueue them. It logs counts only.
 */
import {
  expireDueShareTokens,
  getEnvironment,
  type ConnectShareToken,
  type Db,
} from '@openverify/db';
import { createOutboxOnlyPublisher } from '../events/index.js';
import type { Clock } from '../ports.js';
import { createAuditLogger } from '../services/audit-log.js';
import { stageTokenChange } from '../services/connect/share-tokens.js';
import type { WorkerLogger } from './logger.js';

/** What a pass reads. */
export interface ConnectTokenExpiryDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
}

/** What one pass did: the tokens it expired. */
export interface ConnectTokenExpiryResult {
  expired: number;
}

export type RunConnectTokenExpiry = (
  deps: ConnectTokenExpiryDeps,
) => Promise<ConnectTokenExpiryResult>;

/**
 * C232.5: 500 a batch (`CONNECT_TOKEN_EXPIRY_BATCH_SIZE` of `connect-queues.ts`, which imports this
 * module, so the value is held equal by the test rather than imported).
 */
export const CONNECT_TOKEN_EXPIRY_BATCH = 500;

/** At most this many batches a pass, so one pass ends; the next minute takes the rest. */
const MAX_BATCHES_PER_PASS = 20;

/** The organisations of a token's two environments (the system reads both, as the sweep's own). */
async function organizationsOf(
  db: Db,
  token: ConnectShareToken,
): Promise<{ source: string; destination: string } | null> {
  const [source, destination] = await Promise.all([
    getEnvironment(db, token.environmentId),
    getEnvironment(db, token.destinationEnvironmentId),
  ]);
  return source === null || destination === null
    ? null
    : { source: source.organizationId, destination: destination.organizationId };
}

export const runConnectTokenExpiry: RunConnectTokenExpiry = async (deps) => {
  const audit = createAuditLogger();
  let expired = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_PASS; batch += 1) {
    const now = deps.clock.now();
    const count = await deps.db.transaction(async (tx) => {
      const events = createOutboxOnlyPublisher(tx);
      const tokens = await expireDueShareTokens(tx, now, CONNECT_TOKEN_EXPIRY_BATCH);
      for (const token of tokens) {
        const organizations = await organizationsOf(tx, token);
        if (organizations === null) {
          continue;
        }
        await stageTokenChange(
          { events, audit },
          tx,
          { kind: 'system', sourceOrganizationId: organizations.source },
          token,
          {
            source: 'connect/share-token.expired',
            destination: 'connect/share-token.expired',
            audit: 'expired',
            sourceOrganizationId: organizations.source,
            destinationOrganizationId: organizations.destination,
          },
        );
      }
      return tokens.length;
    });
    expired += count;
    if (count < CONNECT_TOKEN_EXPIRY_BATCH) {
      break;
    }
  }
  if (expired > 0) {
    deps.logger.info({ expired }, 'connect-token-expiry expired share tokens');
  }
  return { expired };
};
