/**
 * C234 (Workflow 11A, `api-redeem`): redeeming a share token, as the destination.
 *
 * **The synchronous part** ({@link redeemShareTokenInTx}; the route, the `redeem_share_token`
 * workflow action and nothing else call it): in the lock order of C287.2 (connection, consent
 * records, token) and in this order of checks, each with its problem:
 * 1. the body's rules: 422 `share_redeem_meta_conflict` (`shareRedeemMetaConflicts`' pointers);
 * 2. the token is inbound to the caller's environment (the one 404 otherwise: a token is bound to
 *    one destination environment, so the other kind's caller gets the same 404, review P25);
 * 3. the pairing of its source with the mode and destination: 422 `share_redeem_mode_invalid`;
 * 4. the connection is `active`: 409 `connection_not_active`;
 * 5. the token is `created` and unexpired: 409 `share_token_already_redeemed` (`pending`,
 *    `redeemed`), `share_token_expired`, `share_token_not_redeemable` (`failed`);
 * 6. the destination exists in the caller's environment: 422 `destination_not_found` with its
 *    pointer (the template and its version, the account, the account type, the inquiry or the
 *    hydrate's destination); a verification's inquiry is open: 409 `destination_inquiry_not_open`;
 * 7. the destination consent record (review P02), with `connect-logic`'s
 *    `destinationConsentRefusal`: 422 `consent_required` with its `reason`;
 * 8. the token's reserved inquiry recorded no decline: 409 `consent_declined_in_flow` (C238.1).
 * Then the token is `pending` (with its mode, destination and the destination record), the request
 * is audited in the caller's environment (keys and ids only, never a value), and the caller enqueues
 * the `connect-redeem` job after its commit. An `Idempotency-Key` repeat is answered by the C12
 * plugin with the first answer.
 *
 * **The job** ({@link runRedemption}): see `jobs/connect-redeem/process.ts`.
 *
 * Every read or write of the source environment's rows goes through `cross-tenant.ts` (rule 20(a)),
 * reached here only through {@link RedemptionCrossTenant}, which `redemptionCrossTenant` binds to
 * it (`markInboundShareToken`, and `readRedemptionSource` mapped to {@link RedemptionRead}; built by
 * integration-11a from `api-redeem`'s contract deviations).
 */
import {
  QUEUE_IN_FLIGHT_CAP,
  shareRedeemMetaConflicts,
  shareRedeemModeOf,
  shareRedeemPairAllowed,
  storedSharePolicySchema,
  type RedeemShareTokenBody,
  type RedeemShareTokenMeta,
  type ShareRedeemMode,
  type ShareTokenResource,
} from '@openverify/contracts';
import {
  destinationConsentRefusal,
  type ConsentRecordFacts,
  type ConsentRequiredReason,
} from '@openverify/core';
import {
  appendAuditLog,
  getAccount,
  getAccountType,
  getConnectionOfOrganization,
  getInquiry,
  getInquiryTemplate,
  getInquiryTemplateVersion,
  getTransaction,
  listInquiryFlowConsents,
  lockConsentRecord,
  type ConnectShareToken,
  type Db,
  type NewConnectShareToken,
  type OpenedConsentRecord,
} from '@openverify/db';
import type { StagedEvent } from '../../events/index.js';
import type { ConnectRedeemJob } from '../../jobs/connect-queues.js';
import { storedActorOf } from '../audit-log.js';
import type { ApiDependencies } from '../context.js';
import type { Acting } from '../inquiries.js';
import { callerOf, type ConnectActing } from './connections.js';
import type { RedemptionMaterial } from './clone.js';
import { crossTenant, type CrossTenantCaller } from './cross-tenant.js';
import { connectNotFound } from './not-found.js';
import type { LoadedShareSource } from './peek.js';
import { ConnectProblemError } from './problems.js';
import { getShareTokenDocument } from './share-tokens.js';

import { admitOnProduce } from '../quotas/admit.js';
/** The audit action of a redemption request, in the destination environment (C240.4). */
export const REDEEM_REQUESTED_ACTION = 'connect-share-token.redeem-requested';

/** Who redeems: the caller of the route or the workflow step (C243.1's `ConnectActionCaller`). */
export interface RedeemCaller {
  readonly deps: ApiDependencies;
  readonly acting: Acting & Pick<ConnectActing, 'principal'>;
  readonly now: Date;
}

/** What the synchronous part answers: the token as the destination sees it, and the job. */
export interface RedeemAnswer {
  token: ShareTokenResource;
  staged: StagedEvent[];
  /** Enqueue after the commit (`deps.connectRedeems.enqueueConnectRedeem`). */
  job: ConnectRedeemJob;
}

/**
 * C234.1, C234.11: what a redemption asked for, stored in the destination's audit entry of the
 * request (ids and keys only, never a value) and read back by the job, which carries ids only.
 */
export interface RedemptionRequest {
  mode: ShareRedeemMode;
  'destination-type': 'inquiry' | 'account' | 'transaction' | null;
  'destination-id': string | null;
  'inquiry-template-id': string | null;
  'inquiry-template-version-id': string | null;
  'account-id': string | null;
  /** A clone of a verification attaches to this open destination inquiry (C234.4). */
  'inquiry-id': string | null;
  'auto-create-account-reference-id': string | null;
  'auto-create-account-type-id': string | null;
  'field-mappings': { 'source-field-name': string; 'destination-field-name': string }[];
  'destination-consent-record-id': string;
}

/** The changes the destination makes to an inbound token (status and redemption facts). */
export type InboundTokenChanges = Pick<
  Partial<NewConnectShareToken>,
  | 'status'
  | 'pendingAt'
  | 'redeemedAt'
  | 'failedAt'
  | 'failureReason'
  | 'redeemMode'
  | 'destinationType'
  | 'destinationId'
  | 'destinationConsentRecordId'
  | 'redeemSummary'
> & { updatedAt: Date };

/**
 * C234.2: the redemption's re-read of the source side under the lock order (connection FOR SHARE,
 * the source consent record FOR SHARE, the token FOR UPDATE), through `cross-tenant.ts`.
 */
export interface RedemptionRead {
  token: ConnectShareToken;
  connectionStatus: string;
  /** The policy version the token was created under (`storedSharePolicySchema`). */
  policy: { version: number; body: unknown };
  /** The source-side record the token cites, locked FOR SHARE; `null` when it is gone. */
  sourceConsent: OpenedConsentRecord | null;
  sourceOrganizationName: string;
  /**
   * The source as `api-connect`'s `loadShareSource` reads it, with the copy's material
   * (`loadRedemptionMaterial`); `null` when it is gone.
   */
  source: {
    loaded: LoadedShareSource;
    material: RedemptionMaterial;
  } | null;
}

/** What the redemption needs of the other side; {@link redemptionCrossTenant} binds it. */
export interface RedemptionCrossTenant {
  getInboundShareToken(db: Db, caller: CrossTenantCaller, id: string): Promise<ConnectShareToken>;
  lockInboundShareToken(tx: Db, caller: CrossTenantCaller, id: string): Promise<ConnectShareToken>;
  /** The destination's change of a token it holds FOR UPDATE. */
  markInboundShareToken(
    tx: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
    changes: InboundTokenChanges,
  ): Promise<ConnectShareToken>;
  readRedemptionSource(
    tx: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
  ): Promise<RedemptionRead>;
}

/** The production binding of {@link RedemptionCrossTenant} to `cross-tenant.ts`. */
export const redemptionCrossTenant: RedemptionCrossTenant = {
  getInboundShareToken: (db, caller, id) => crossTenant.getInboundShareToken(db, caller, id),
  lockInboundShareToken: (tx, caller, id) => crossTenant.lockInboundShareToken(tx, caller, id),
  markInboundShareToken: (tx, caller, token, changes) =>
    crossTenant.markInboundShareToken(tx, caller, token, changes),
  async readRedemptionSource(tx, caller, token) {
    const read = await crossTenant.readRedemptionSource(tx, caller, token);
    return {
      token: read.token,
      connectionStatus: read.connection.status,
      policy: { version: read.policyVersion, body: read.policy },
      sourceConsent: read.sourceConsent,
      sourceOrganizationName: read.sourceOrganizationName,
      source:
        read.source === null || read.material === null
          ? null
          : { loaded: read.source, material: read.material },
    };
  },
};

const META = '/meta';

function destinationNotFound(pointer: string): ConnectProblemError {
  return new ConnectProblemError(
    'destination_not_found',
    'The redemption’s destination was not found.',
    { errors: [{ location: 'body', pointer, detail: 'destination_not_found' }] },
  );
}

function consentRequired(reason: ConsentRequiredReason): ConnectProblemError {
  return new ConnectProblemError(
    'consent_required',
    'The destination consent record does not cover this share.',
    {
      reason,
      errors: [
        {
          location: 'body',
          pointer: `${META}/destination-consent-record-id`,
          detail: `consent_required: ${reason}`,
        },
      ],
    },
  );
}

/** The served type of a hydrate's destination, by its id's prefix. */
const DESTINATION_TYPE_OF_PREFIX: Readonly<Record<string, 'inquiry' | 'account' | 'transaction'>> =
  Object.freeze({ inq: 'inquiry', acc: 'account', txn: 'transaction' });

/** C234.1: the request as the job will read it back (ids and keys only). */
export function redemptionRequestOf(body: RedeemShareTokenBody): RedemptionRequest {
  const mode = shareRedeemModeOf(body);
  const meta: RedeemShareTokenMeta = body.meta;
  const destinationId = body.data?.attributes['destination-id'] ?? null;
  return {
    mode,
    'destination-type':
      destinationId === null
        ? null
        : (DESTINATION_TYPE_OF_PREFIX[destinationId.split('_')[0] ?? ''] ?? null),
    'destination-id': destinationId,
    'inquiry-template-id': meta['inquiry-template-id'] ?? null,
    'inquiry-template-version-id': meta['inquiry-template-version-id'] ?? null,
    'account-id': meta['account-id'] ?? null,
    'inquiry-id': meta['inquiry-id'] ?? null,
    'auto-create-account-reference-id': meta['auto-create-account-reference-id'] ?? null,
    'auto-create-account-type-id': meta['auto-create-account-type-id'] ?? null,
    'field-mappings': (meta['field-mappings'] ?? []).map((mapping) => ({ ...mapping })),
    'destination-consent-record-id': meta['destination-consent-record-id'],
  };
}

/** The consent facts `connect-logic`'s coverage reads, of a stored record. */
export function consentFactsOf(record: OpenedConsentRecord): ConsentRecordFacts {
  return {
    side: record.side,
    outcome: record.outcome,
    method: record.method,
    purpose: record.purpose,
    subject:
      record.subjectType === null || record.subjectId === null
        ? null
        : { type: record.subjectType, id: record.subjectId },
    shareTokenId: record.shareTokenId,
    recipientOrganizationId: record.recipientOrganizationId,
    categories: [...record.dataCategories] as ConsentRecordFacts['categories'],
    explicitBiometric: record.explicitBiometric,
    expiresAt: record.expiresAt,
    withdrawnAt: record.withdrawnAt,
    redactedAt: record.redactedAt,
  };
}

/** C234.1: the token's status, as the synchronous part refuses it. */
function refuseStatus(token: ConnectShareToken, now: Date): void {
  switch (token.status) {
    case 'pending':
    case 'redeemed':
      throw new ConnectProblemError(
        'share_token_already_redeemed',
        'The share token was already redeemed.',
      );
    case 'expired':
      throw new ConnectProblemError('share_token_expired', 'The share token has expired.');
    case 'failed':
      throw new ConnectProblemError(
        'share_token_not_redeemable',
        'The share token failed and cannot be redeemed.',
      );
    case 'created':
      if (token.expiresAt.getTime() <= now.getTime()) {
        throw new ConnectProblemError('share_token_expired', 'The share token has expired.');
      }
  }
}

/** C234.1 step 6: the destination of the request exists (and an attached inquiry is open). */
async function checkDestination(
  tx: Db,
  environmentId: string,
  token: ConnectShareToken,
  request: RedemptionRequest,
): Promise<void> {
  if (request['account-id'] !== null) {
    if ((await getAccount(tx, environmentId, request['account-id'])) === null) {
      throw destinationNotFound(`${META}/account-id`);
    }
  }
  if (request['auto-create-account-type-id'] !== null) {
    if (
      (await getAccountType(tx, environmentId, request['auto-create-account-type-id'])) === null
    ) {
      throw destinationNotFound(`${META}/auto-create-account-type-id`);
    }
  }
  if (request.mode === 'hydrate') {
    const id = request['destination-id'] ?? '';
    const found =
      request['destination-type'] === 'inquiry'
        ? await getInquiry(tx, environmentId, id)
        : request['destination-type'] === 'account'
          ? await getAccount(tx, environmentId, id)
          : request['destination-type'] === 'transaction'
            ? await getTransaction(tx, environmentId, id)
            : null;
    if (found === null) {
      throw destinationNotFound('/data/attributes/destination-id');
    }
    return;
  }
  if (token.sourceType === 'verification') {
    const inquiryId = request['inquiry-id'];
    const inquiry = inquiryId === null ? null : await getInquiry(tx, environmentId, inquiryId);
    if (inquiry === null) {
      throw destinationNotFound(`${META}/inquiry-id`);
    }
    if (inquiry.status !== 'created' && inquiry.status !== 'pending') {
      throw new ConnectProblemError(
        'destination_inquiry_not_open',
        'The destination inquiry is no longer open.',
      );
    }
    return;
  }
  const templateId = request['inquiry-template-id'];
  const template =
    templateId === null ? null : await getInquiryTemplate(tx, environmentId, templateId);
  if (template === null || template.status === 'archived') {
    throw destinationNotFound(`${META}/inquiry-template-id`);
  }
  const versionId = request['inquiry-template-version-id'];
  if (versionId !== null) {
    const version = await getInquiryTemplateVersion(tx, environmentId, versionId);
    if (version?.inquiryTemplateId !== template.id || version.status === 'draft') {
      throw destinationNotFound(`${META}/inquiry-template-version-id`);
    }
  }
}

/**
 * C234.1: the synchronous part of a redemption, in `tx` (see the header). Answers the token as the
 * destination sees it (`pending`) and the job to enqueue after the commit.
 */
export async function redeemShareTokenInTx(
  tx: Db,
  caller: RedeemCaller,
  shareTokenId: string,
  body: RedeemShareTokenBody,
  port: RedemptionCrossTenant = redemptionCrossTenant,
): Promise<RedeemAnswer> {
  const { acting, now } = caller;
  const conflicts = shareRedeemMetaConflicts(body);
  if (conflicts.length > 0) {
    throw new ConnectProblemError(
      'share_redeem_meta_conflict',
      'The redemption names members that exclude each other.',
      {
        errors: conflicts.map((pointer) => ({
          location: 'body',
          pointer,
          detail: 'share_redeem_meta_conflict',
        })),
      },
    );
  }
  const request = redemptionRequestOf(body);
  const crossCaller = callerOf(acting);
  const { environmentId, organizationId } = acting.ctx;
  // Read without a lock first, to learn the connection: the lock order is connection, consent
  // records, token (C287.2).
  const seen = await port.getInboundShareToken(tx, crossCaller, shareTokenId);
  const destinationType = request.mode === 'hydrate' ? request['destination-type'] : null;
  if (!shareRedeemPairAllowed(seen.sourceType, request.mode, destinationType)) {
    throw new ConnectProblemError(
      'share_redeem_mode_invalid',
      'This source cannot be redeemed into this destination.',
    );
  }
  const connection = await getConnectionOfOrganization(tx, organizationId, seen.connectionId);
  if (connection === null) {
    throw connectNotFound();
  }
  if (connection.status !== 'active') {
    throw new ConnectProblemError('connection_not_active', 'The connection is not active.');
  }
  const record = await lockConsentRecord(
    tx,
    environmentId,
    request['destination-consent-record-id'],
    'update',
  );
  const token = await port.lockInboundShareToken(tx, crossCaller, shareTokenId);
  refuseStatus(token, now);
  await checkDestination(tx, environmentId, token, request);
  const policy = await crossTenant.inboundShareTokenPolicy(tx, crossCaller, token);
  const purpose = storedSharePolicySchema.parse(policy.body).purpose;
  const refusal = destinationConsentRefusal(record === null ? null : consentFactsOf(record), {
    shareTokenId: token.id,
    recipientOrganizationId: organizationId,
    purpose,
    categories: [...token.dataCategories] as ConsentRecordFacts['categories'],
    citedByAnotherRedemption: false,
    now,
  });
  if (refusal !== null) {
    throw consentRequired(refusal);
  }
  if (token.reservedInquiryId !== null) {
    const consents = await listInquiryFlowConsents(tx, environmentId, token.reservedInquiryId);
    if (
      consents.some((consent) => consent.side === 'destination' && consent.outcome === 'declined')
    ) {
      throw new ConnectProblemError(
        'consent_declined_in_flow',
        'A decline witnessed in the flow stands for this share.',
      );
    }
  }
  try {
    await port.markInboundShareToken(tx, crossCaller, token, {
      status: 'pending',
      pendingAt: now,
      redeemMode: request.mode,
      destinationType: request.mode === 'hydrate' ? request['destination-type'] : 'inquiry',
      destinationId:
        request.mode === 'hydrate'
          ? request['destination-id']
          : token.sourceType === 'verification'
            ? request['inquiry-id']
            : null,
      destinationConsentRecordId: request['destination-consent-record-id'],
      updatedAt: now,
    });
  } catch (error) {
    if (
      JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})).includes(
        'connect_share_tokens_destination_consent_record_id_key',
      )
    ) {
      throw consentRequired('already_used');
    }
    throw error;
  }
  // C240.4: the request, audited in the caller's environment with its actor, ids and keys only.
  // Written to the audit log itself (not through `deps.audit`), because the job, which carries ids
  // only, reads the request and its actor back from this entry (`redemptionRequestEntry`).
  await appendAuditLog(tx, environmentId, {
    ...storedActorOf(acting.actor),
    action: REDEEM_REQUESTED_ACTION,
    resourceType: 'connect-share-token',
    resourceId: token.id,
    requestId: acting.ctx.requestId ?? null,
    metadata: { 'connection-id': token.connectionId, request },
  });
  const document = await getShareTokenDocument({ db: tx }, acting, token.id);
  return {
    token: document.data,
    staged: [],
    job: { environmentId, shareTokenId: token.id },
  };
}

/** C234.1: the route's redemption: the synchronous part, then the job after the commit. */
export async function redeemShareToken(
  deps: ApiDependencies,
  acting: RedeemCaller['acting'],
  shareTokenId: string,
  body: RedeemShareTokenBody,
): Promise<{ data: ShareTokenResource }> {
  const answer = await deps.db.transaction((tx) =>
    redeemShareTokenInTx(tx, { deps, acting, now: deps.clock.now() }, shareTokenId, body),
  );
  await deps.events.dispatch(answer.staged);
  await enqueueRedemption(deps, answer.job);
  return { data: answer.token };
}

/**
 * After the commit: the `connect-redeem` job (its id is the token's, so a repeat is one job), admitted
 * under the destination environment's cap (KP11-12, C234.2, C251.1; integration-11b) through quotas'
 * `admitOnProduce`: a held token is stamped `admitted_at` and enqueued while the destination is below
 * its cap; at the cap it stays pending and unstamped, nothing is enqueued, and the worker's fair quota
 * sweep admits it when a slot frees. An admitted token whose enqueue fails is re-enqueued by the quota
 * recovery (KP11-17). The server redeem, the flow's share-consent accept and the `redeem_share_token`
 * action all enqueue through here.
 */
export async function enqueueRedemption(
  deps: Pick<ApiDependencies, 'connectRedeems' | 'db' | 'clock' | 'queueInFlightCapMax'>,
  job: ConnectRedeemJob,
): Promise<void> {
  const producer = deps.connectRedeems;
  if (producer === undefined) {
    throw new Error('The connect-redeem queue is not configured');
  }
  const admitted = await admitOnProduce(
    {
      db: deps.db,
      clock: deps.clock,
      limits: { ceiling: deps.queueInFlightCapMax ?? QUEUE_IN_FLIGHT_CAP.ceilingDefault },
    },
    { queue: 'connect-redeem', environmentId: job.environmentId, id: job.shareTokenId },
  );
  if (admitted) {
    await producer.enqueueConnectRedeem(job);
  }
}

/**
 * C234.11, C238.4 (`api-consent`'s destination-side accept calls it, in the exit's transaction): the
 * client-side redemption into the open inquiry the token is reserved for, from an inquiry or a
 * verification source only. Checks, in order: the token inbound to the environment (the one 404),
 * the pairing (422 `share_redeem_mode_invalid`), the connection `active` (409
 * `connection_not_active`), the token `created` and unexpired (409, as {@link redeemShareTokenInTx}),
 * the token reserved for this inquiry (the one 404 otherwise), the inquiry open (409
 * `destination_inquiry_not_open`) and the destination record covering the share (422
 * `consent_required`). The token is then `pending` in `fill-inquiry` mode; the request is audited with
 * `actor` (the principal that created the inquiry with `meta.share-token-id`, or `null` for the
 * system), and the caller enqueues `job` after its commit. With `actor` `null` the job clones the
 * verifications and leaves the fields unhydrated (a hydrate writes as a principal).
 */
export async function requestFillInquiryRedemptionInTx(
  tx: Db,
  input: {
    deps: Pick<ApiDependencies, 'clock'>;
    caller: CrossTenantCaller;
    actor: Acting['actor'] | null;
    request: {
      'share-token-id': string;
      'inquiry-id': string;
      'destination-consent-record-id': string;
    };
    now: Date;
  },
  port: RedemptionCrossTenant = redemptionCrossTenant,
): Promise<{ job: ConnectRedeemJob; token: ConnectShareToken }> {
  const { caller, now } = input;
  const seen = await port.getInboundShareToken(tx, caller, input.request['share-token-id']);
  if (!shareRedeemPairAllowed(seen.sourceType, 'fill-inquiry', 'inquiry')) {
    throw new ConnectProblemError(
      'share_redeem_mode_invalid',
      'This source cannot fill an inquiry.',
    );
  }
  const connection = await getConnectionOfOrganization(
    tx,
    caller.organizationId,
    seen.connectionId,
  );
  if (connection === null) {
    throw connectNotFound();
  }
  if (connection.status !== 'active') {
    throw new ConnectProblemError('connection_not_active', 'The connection is not active.');
  }
  const record = await lockConsentRecord(
    tx,
    caller.environmentId,
    input.request['destination-consent-record-id'],
    'update',
  );
  const token = await port.lockInboundShareToken(tx, caller, seen.id);
  refuseStatus(token, now);
  if (token.reservedInquiryId !== input.request['inquiry-id']) {
    throw connectNotFound();
  }
  const inquiry = await getInquiry(tx, caller.environmentId, input.request['inquiry-id']);
  if (inquiry === null) {
    throw connectNotFound();
  }
  if (inquiry.status !== 'created' && inquiry.status !== 'pending') {
    throw new ConnectProblemError(
      'destination_inquiry_not_open',
      'The destination inquiry is no longer open.',
    );
  }
  const policy = await crossTenant.inboundShareTokenPolicy(tx, caller, token);
  const refusal = destinationConsentRefusal(record === null ? null : consentFactsOf(record), {
    shareTokenId: token.id,
    recipientOrganizationId: caller.organizationId,
    purpose: storedSharePolicySchema.parse(policy.body).purpose,
    categories: [...token.dataCategories] as ConsentRecordFacts['categories'],
    citedByAnotherRedemption: false,
    now,
  });
  if (refusal !== null) {
    throw consentRequired(refusal);
  }
  const marked = await port.markInboundShareToken(tx, caller, token, {
    status: 'pending',
    pendingAt: now,
    redeemMode: 'fill-inquiry',
    destinationType: 'inquiry',
    destinationId: inquiry.id,
    destinationConsentRecordId: input.request['destination-consent-record-id'],
    updatedAt: now,
  });
  const request: RedemptionRequest = {
    mode: 'fill-inquiry',
    'destination-type': 'inquiry',
    'destination-id': inquiry.id,
    'inquiry-template-id': null,
    'inquiry-template-version-id': null,
    'account-id': null,
    'inquiry-id': inquiry.id,
    'auto-create-account-reference-id': null,
    'auto-create-account-type-id': null,
    'field-mappings': [],
    'destination-consent-record-id': input.request['destination-consent-record-id'],
  };
  await appendAuditLog(tx, caller.environmentId, {
    ...(input.actor === null ? { actorType: 'system' as const } : storedActorOf(input.actor)),
    action: REDEEM_REQUESTED_ACTION,
    resourceType: 'connect-share-token',
    resourceId: token.id,
    metadata: { 'connection-id': token.connectionId, request },
  });
  return { job: { environmentId: caller.environmentId, shareTokenId: token.id }, token: marked };
}
