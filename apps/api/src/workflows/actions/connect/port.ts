/**
 * C243.1 (Phase 11, Workflow 11A, `workflow-connect`): what Connect's three actions ask of the share
 * token services. The actions never reach a repository or `services/connect/cross-tenant.ts`
 * themselves (rule 20(a)): every read and write goes through the services `api-connect` (create,
 * expire) and `api-redeem` (the redemption's synchronous part) export, called in the step's own
 * transaction so the effect is exactly once (C117.5). A refusal is the service's own problem
 * (`ConnectProblemError`, the one 404), which the handler surfaces as the step's error by its code.
 */
import type {
  CreateShareTokenBody,
  RedeemShareTokenBody,
  ShareTokenResource,
} from '@openverify/contracts';
import type { Db } from '@openverify/db';
import type { StagedEvent } from '../../../events/index.js';
import type { ApiDependencies } from '../../../services/context.js';
import type { Acting } from '../../../services/inquiries.js';

/** The caller of a service: the run as its actor (`workflow-run`, C121.1), in its environment. */
export interface ConnectActionCaller {
  readonly deps: ApiDependencies;
  /** The run: the audit actor of every entry the service writes (C243.1). */
  readonly acting: Acting;
  readonly now: Date;
}

/** What an action outputs of a token: ids, statuses and reasons, never shared data. */
export type ShareTokenFacts = Pick<ShareTokenResource, 'id'> & {
  readonly attributes: Pick<
    ShareTokenResource['attributes'],
    'status' | 'expires-at' | 'redeem-mode' | 'expiry-reason'
  >;
};

/** A service's answer: the token as the caller's side sees it, and what it staged. */
export interface ConnectActionAnswer {
  readonly token: ShareTokenFacts;
  /** Events staged in the transaction, dispatched after the commit. */
  readonly staged?: readonly StagedEvent[];
}

/** The services the actions call, each in the step's transaction. */
export interface ConnectActionPort {
  /** C232.1: every check in order; the token `created`. */
  createShareToken(
    tx: Db,
    caller: ConnectActionCaller,
    body: CreateShareTokenBody,
  ): Promise<ConnectActionAnswer>;
  /**
   * C234.1's synchronous part, under the token row lock: the token `pending`, its destination
   * consent record checked (C243.4). The job is enqueued by the action after the commit.
   */
  redeemShareToken(
    tx: Db,
    caller: ConnectActionCaller,
    shareTokenId: string,
    body: RedeemShareTokenBody,
  ): Promise<ConnectActionAnswer>;
  /** C232.4: `created` to `expired` with `source_expired`, the source only. */
  expireShareToken(
    tx: Db,
    caller: ConnectActionCaller,
    shareTokenId: string,
  ): Promise<ConnectActionAnswer>;
}
