/**
 * C243.1 (Phase 11, Workflow 11A, `workflow-connect`): {@link ConnectActionPort} over the services
 * `api-connect` (create, expire: `services/connect/share-tokens.ts`) and `api-redeem` (the
 * redemption's synchronous part: `services/connect/redeem.ts`) export, each in the step's transaction
 * with the run as the actor and the step's time. The events a service stages are returned for the
 * engine to dispatch after the commit; the redemption's `connect-redeem` job is enqueued by the step
 * after its commit (`handlers.ts`), as the route enqueues it after its own.
 */
import {
  redeemShareTokenInTx,
  redemptionCrossTenant,
  type RedemptionCrossTenant,
} from '../../../services/connect/redeem.js';
import {
  createShareTokenInTx,
  expireShareTokenInTx,
} from '../../../services/connect/share-tokens.js';
import type { ConnectActionPort } from './port.js';

/**
 * The port over the services; `redemption` is the redemption's binding to `cross-tenant.ts`
 * (`redemptionCrossTenant`), which a test may replace as `api-redeem`'s own suite does.
 */
export function createShareTokenServices(
  redemption: RedemptionCrossTenant = redemptionCrossTenant,
): ConnectActionPort {
  const services: ConnectActionPort = {
    async createShareToken(tx, caller, body) {
      const { document, staged } = await createShareTokenInTx(
        caller.deps,
        tx,
        caller.acting,
        body.data.attributes,
        caller.now,
      );
      return { token: document.data, staged };
    },
    async redeemShareToken(tx, caller, shareTokenId, body) {
      const { token, staged } = await redeemShareTokenInTx(
        tx,
        caller,
        shareTokenId,
        body,
        redemption,
      );
      return { token, staged };
    },
    async expireShareToken(tx, caller, shareTokenId) {
      const { document, staged } = await expireShareTokenInTx(
        caller.deps,
        tx,
        caller.acting,
        shareTokenId,
        caller.now,
      );
      return { token: document.data, staged };
    },
  };
  return Object.freeze(services);
}

export const SHARE_TOKEN_SERVICES: ConnectActionPort = createShareTokenServices();
