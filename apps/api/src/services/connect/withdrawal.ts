/**
 * C237 (Workflow 11A, `api-consent`): withdrawal of a consent record and its effects, in one
 * transaction, whatever the channel (`api`: `POST /connect/consent-records/:id/withdraw`; `operator`:
 * the console's action; `flow`: the person in a living session, C237.6).
 *
 * In the lock order of C231.4 and C287.2 (connection, consent records, token): the record `FOR
 * UPDATE` (a second withdrawal waits, then answers 409 `consent_already_withdrawn`), then the token it
 * authorised, through `cross-tenant.ts` (a destination record's token lives in the source
 * environment):
 *
 * - `created`: `expired` with `expiry-reason: consent_withdrawn` and `connect/share-token.expired` on
 *   both sides (`api-connect`'s `stageTokenChange`);
 * - `pending`: nothing here; the redeem job holds the record `FOR SHARE` while it commits and fails
 *   with `consent_withdrawn` (`api-redeem`);
 * - `redeemed`: nothing is recalled (a copy belongs to its controller); the counterparty hears
 *   `connect/share-token.consent-withdrawn` so its operator can act, and a destination record's
 *   copies gain `provenance.consent-withdrawn-at`, after which they stop counting (C235.4, C237.6).
 *
 * `consent-record.withdrawn` is emitted in the record's own environment, and the audit names the
 * actor there (the system for the flow); the counterparty's entry names only `{organization-id,
 * kind}` (C240.4). No route changes a record's method, purpose, recipient or categories (C237.3).
 *
 * Honesty: withdrawal stops every future platform transfer under the record; a copy already made
 * belongs to its controller, and both operators must act on the event.
 */
import type { ConsentRecordResource, ConsentWithdrawalReason } from '@openverify/contracts';
import {
  getConsentConnection,
  getEnvironment,
  getOutboundShareToken,
  lockConsentRecord,
  markShareCopiesConsentWithdrawn,
  shareTokensCitingConsentRecords,
  withdrawConsentRecord,
  type ConnectShareToken,
  type Db,
  type OpenedConsentRecord,
} from '@openverify/db';
import { NotFoundError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { appendSystemAuditEntry } from '../audit-log.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import type { Acting } from '../inquiries.js';
import { consentRecordResource, servedConsentRecord, stageConsentRecordEvent } from './consent.js';
import { crossTenant, type CrossTenantCaller } from './cross-tenant.js';
import { connectNotFound } from './not-found.js';
import { ConnectProblemError } from './problems.js';
import { stageTokenChange, type ShareTokenAuditAction, type TokenActor } from './share-tokens.js';

/** What a withdrawal reads and writes through. */
export type WithdrawalDeps = Pick<ApiDependencies, 'db' | 'clock' | 'ids' | 'events' | 'audit'>;

/** Who withdrew: a principal (the API or the console) or the person in the flow. */
export type WithdrawalActor = { kind: 'principal'; acting: Acting } | { kind: 'flow' };

export interface WithdrawalInput {
  environmentId: string;
  id: string;
  via: 'api' | 'operator' | 'flow';
  reason: ConsentWithdrawalReason | null;
  actor: WithdrawalActor;
}

const alreadyWithdrawn = () =>
  new ConnectProblemError('consent_already_withdrawn', 'The consent record is already withdrawn.');

/**
 * The audit action of a token's consent withdrawal. `stageTokenChange`'s list names the token's own
 * changes; this one is the token's too (both sides' entries), so it is passed as one of them.
 */
const CONSENT_WITHDRAWN_AUDIT = 'consent-withdrawn' as ShareTokenAuditAction;

/** The token a record authorised: the one citing a source record, or a destination record's. */
async function authorisedToken(
  tx: Db,
  caller: CrossTenantCaller,
  record: OpenedConsentRecord,
): Promise<ConnectShareToken | null> {
  if (record.side === 'source') {
    const tokenId = (
      await shareTokensCitingConsentRecords(tx, record.environmentId, [record.id])
    ).get(record.id);
    return tokenId === undefined
      ? null
      : await getOutboundShareToken(tx, record.environmentId, tokenId);
  }
  if (record.shareTokenId === null) {
    return null;
  }
  try {
    return await crossTenant.getInboundShareToken(tx, caller, record.shareTokenId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return null;
    }
    throw error;
  }
}

/** C237.2: the withdrawal and its effects in `tx`; the caller dispatches the staged events. */
export async function withdrawConsentRecordInTx(
  tx: Db,
  deps: Omit<WithdrawalDeps, 'db'>,
  input: WithdrawalInput,
): Promise<{ record: OpenedConsentRecord; staged: StagedEvent[] }> {
  const now = deps.clock.now();
  const { environmentId, id } = input;
  const locked = await lockConsentRecord(tx, environmentId, id, 'update');
  if (locked === null) {
    throw connectNotFound();
  }
  if (locked.withdrawnAt !== null) {
    throw alreadyWithdrawn();
  }
  const record = await withdrawConsentRecord(tx, environmentId, id, {
    withdrawnAt: now,
    withdrawnVia: input.via,
    withdrawalReason: input.reason,
  });
  if (record === null) {
    throw alreadyWithdrawn();
  }
  const environment = await getEnvironment(tx, environmentId);
  if (environment === null) {
    throw connectNotFound();
  }
  const caller: CrossTenantCaller = {
    organizationId: environment.organizationId,
    environmentId,
    environmentKind: environment.kind,
  };
  const staged: StagedEvent[] = [];
  const connection = await getConsentConnection(tx, caller.organizationId, record.connectionId);
  if (record.outcome === 'accepted' && connection !== null) {
    const sides = {
      sourceOrganizationId: connection.sourceOrganizationId,
      destinationOrganizationId: connection.destinationOrganizationId,
    };
    const actor: TokenActor =
      input.actor.kind === 'principal'
        ? { kind: 'principal', acting: input.actor.acting }
        : { kind: 'system', sourceOrganizationId: connection.sourceOrganizationId };
    const expired = await crossTenant.expireTokenOnWithdrawal(tx, caller, record.id, now);
    if (expired !== null) {
      staged.push(
        ...(await stageTokenChange(deps, tx, actor, expired, {
          source: 'connect/share-token.expired',
          destination: 'connect/share-token.expired',
          audit: 'expired',
          ...sides,
        })),
      );
    } else {
      const token = await authorisedToken(tx, caller, record);
      if (token?.status === 'redeemed') {
        // C237.2: nothing is recalled; the counterparty hears of it and acts on its own copy.
        staged.push(
          ...(await stageTokenChange(deps, tx, actor, token, {
            source: record.side === 'destination' ? 'connect/share-token.consent-withdrawn' : null,
            destination: record.side === 'source' ? 'connect/share-token.consent-withdrawn' : null,
            audit: CONSENT_WITHDRAWN_AUDIT,
            ...sides,
          })),
        );
        if (record.side === 'destination') {
          await markShareCopiesConsentWithdrawn(tx, environmentId, token.id, now);
        }
      }
    }
  }
  const audited = {
    action: 'consent-record.withdrawn',
    resourceType: 'consent-record',
    resourceId: record.id,
    metadata: { via: input.via, side: record.side },
  };
  if (input.actor.kind === 'principal') {
    await deps.audit.record(
      tx,
      auditEntryOf(input.actor.acting.ctx, input.actor.acting.actor, audited),
    );
  } else {
    await appendSystemAuditEntry(tx, environmentId, audited);
  }
  staged.push(await stageConsentRecordEvent(tx, deps, record, 'consent-record.withdrawn'));
  return { record, staged };
}

/** C237.1: the API's (`api`) or the console's (`operator`) withdrawal, answered as the resource. */
export async function withdrawConsentRecordAs(
  deps: WithdrawalDeps,
  acting: Acting,
  id: string,
  options: { via: 'api' | 'operator'; reason: ConsentWithdrawalReason | null },
): Promise<{ data: ConsentRecordResource }> {
  const { record, staged } = await deps.db.transaction((tx) =>
    withdrawConsentRecordInTx(tx, deps, {
      environmentId: acting.ctx.environmentId,
      id,
      via: options.via,
      reason: options.reason,
      actor: { kind: 'principal', acting },
    }),
  );
  await deps.events.dispatch(staged);
  const pii = acting.mask.visible;
  return {
    data: consentRecordResource(await servedConsentRecord(deps.db, record, pii), {
      pii,
      now: deps.clock.now(),
    }),
  };
}
