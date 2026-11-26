/**
 * C232, C233 (Workflow 11A, `api-connect`): share tokens and their peek.
 *
 * - Create (the source, C232.1): every check in the contract's order, each with its problem; the
 *   categories the share carries now are stored on the token (C230.4, review H04); one consent record
 *   authorises one token. Lock order: the connection FOR SHARE, the consent record FOR UPDATE, then
 *   the token is written (C287.2).
 * - List (C232.2), retrieve per side (C232.3), expire (the source, C232.4).
 * - Peek (the destination, C233): `connect-share-tokens:peek` and, for a user, `pii:view`; a
 *   `created` token over an `active` connection; at most {@link SHARE_TOKEN_PEEK_LIMIT} peeks,
 *   counted under the token row lock; built at read time through the cross-tenant module; audited on
 *   both sides, never with a value.
 * - Expiry by deactivation (C231.4) and by time (C232.5, `jobs/connect-token-expiry.ts`).
 *
 * Every token the caller may not see is the one generic 404 (C232.8, `connectNotFound`). Every
 * change stages its `connect/share-token.*` events on both sides (C239.1) and its audit entries on
 * both sides (C240.4) in the transaction of the change.
 */
import {
  SHARE_TOKEN_EXPIRES_IN_SECONDS,
  SHARE_TOKEN_PEEK_LIMIT,
  filterValues,
  idSchema,
  resolveConnectSettings,
  shareTokenStatusSchema,
  storedSharePolicySchema,
  type CreateShareTokenBody,
  type EventName,
  type ListShareTokensQuery,
  type ShareTokenResource,
  type SharePolicy,
  type SourceData,
} from '@openverify/contracts';
import {
  SHARE_CATEGORIES,
  shareCategoriesOf,
  shareSourceRefusal,
  shareableContent,
  sourceConsentRefusal,
  sourceIsCopy,
  sourceNotDecided,
  type ConsentRequiredReason,
  type ShareCategory,
} from '@openverify/core';
import {
  appendAuditLog,
  createShareToken,
  getConnectionOfOrganization,
  getEnvironment,
  getOutboundShareToken,
  getSharePoliciesOfConnection,
  getVerification,
  lockConnectionForShare,
  lockConsentRecordForNewShareToken,
  lockOutboundShareTokenForUpdate,
  outboundShareTokenFacts,
  shareTokenCitingConsentRecord,
  updateOutboundShareToken,
  type ConnectConnectionRecord,
  type ConnectShareToken,
  type Db,
  type ShareTokenFacts,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { PermissionDeniedError, UnprocessableContentError } from '../../errors.js';
import type { AuditLogger, Clock, IdGenerator, Principal } from '../../ports.js';
import { auditEntryOf } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import {
  callerOf,
  counterpartyActorOf,
  principalOf,
  type ConnectActing,
  type ExpireTokensOnDeactivation,
} from './connections.js';
import { crossTenant, type CounterpartyActor, type CrossTenantCaller } from './cross-tenant.js';
import { connectNotFound } from './not-found.js';
import { SHARE_SOURCE_TYPE_OF_PREFIX, loadShareSource, peekEnvelopeOf } from './peek.js';
import { ConnectProblemError } from './problems.js';

/** What the token service needs. */
export interface ShareTokenDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  events: TransactionalEventPublisher;
  audit: AuditLogger;
}

const ID_POINTER = {
  connection: '/data/attributes/connection-id',
  source: '/data/attributes/source-id',
  consent: '/data/attributes/consent-record-id',
  expires: '/data/attributes/expires-in-seconds',
} as const;

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

type ShareObjectIdentifier = NonNullable<ShareTokenResource['relationships']['source']>['data'];

/** The served identifier of a share's source or a redemption's destination. */
async function objectIdentifierOf(
  db: Db,
  environmentId: string,
  type: ConnectShareToken['sourceType'],
  id: string,
): Promise<ShareObjectIdentifier | null> {
  if (type !== 'verification') {
    return { type, id };
  }
  const verification = await getVerification(db, environmentId, id);
  if (verification === null) {
    return null;
  }
  return {
    type: `verification/${verification.type.replaceAll('_', '-')}`,
    id,
  } as ShareObjectIdentifier;
}

/** C232.3, C233: what a token's resource is built from besides the row. */
export interface ShareTokenView {
  token: ConnectShareToken;
  facts: ShareTokenFacts;
  /** `outbound`: the source's view (a self-connection's too); `inbound`: the destination's. */
  direction: 'outbound' | 'inbound';
  source?: ShareObjectIdentifier | null;
  destination?: ShareObjectIdentifier | null;
  sourceData?: SourceData;
}

/**
 * C232.3: the token as one side sees it. The source sees `creator`, `source` and `consent-record`;
 * the destination none of them, and `destination` once redeemed (connect R10); both see the
 * categories and the source consent's method, coverage and digest (review P03), never its evidence
 * or subject. A self-connection's token is the source's view with `destination` as well.
 */
export function shareTokenResourceOf(view: ShareTokenView): ShareTokenResource {
  const { token, facts, direction } = view;
  const outbound = direction === 'outbound';
  const categories = SHARE_CATEGORIES.filter((category) =>
    facts.consentCategories.includes(category),
  );
  const destinationShown =
    token.status === 'redeemed' &&
    view.destination !== undefined &&
    view.destination !== null &&
    (!outbound || token.environmentId === token.destinationEnvironmentId);
  return {
    type: 'connect/share-token',
    id: token.id,
    attributes: {
      status: token.status,
      direction,
      'source-type': token.sourceType,
      'environment-kind': token.environmentKind,
      'share-policy-version': facts.policyVersion,
      'data-categories': SHARE_CATEGORIES.filter((category) =>
        token.dataCategories.includes(category),
      ),
      'source-consent': {
        method: facts.consentMethod,
        witnessed: facts.consentMethod === 'flow',
        categories,
        'explicit-biometric': facts.consentExplicitBiometric,
        'text-sha256': facts.consentTextSha256,
      },
      'redeem-mode': token.redeemMode ?? null,
      'redeem-summary': (token.redeemSummary ??
        null) as ShareTokenResource['attributes']['redeem-summary'],
      'peek-count': token.peekCount,
      'failure-reason': token.failureReason ?? null,
      'expiry-reason': token.expiryReason ?? null,
      'created-at': token.createdAt.toISOString(),
      'updated-at': token.updatedAt.toISOString(),
      'expires-at': token.expiresAt.toISOString(),
      'pending-at': iso(token.pendingAt),
      'redeemed-at': iso(token.redeemedAt),
      'expired-at': iso(token.expiredAt),
      'failed-at': iso(token.failedAt),
      ...(view.sourceData === undefined ? {} : { 'source-data': view.sourceData }),
    },
    relationships: {
      connection: {
        data: {
          type: 'connect/connection',
          id: token.connectionId,
        },
      },
      ...(outbound
        ? {
            creator: {
              data: {
                type:
                  token.creatorType === 'workflow'
                    ? 'workflow-run'
                    : token.creatorType === 'user'
                      ? 'user'
                      : 'api-key',
                id: token.creatorId,
              },
            },
            ...(view.source === undefined || view.source === null
              ? {}
              : { source: { data: view.source } }),
            'consent-record': {
              data: { type: 'consent-record', id: token.consentRecordId },
            },
          }
        : {}),
      ...(destinationShown && view.destination !== undefined && view.destination !== null
        ? { destination: { data: view.destination } }
        : {}),
    },
  };
}

/** The views of tokens the caller holds, each from its side (outbound in its environment). */
async function viewsOf(
  db: Db,
  caller: CrossTenantCaller,
  tokens: readonly ConnectShareToken[],
): Promise<ShareTokenView[]> {
  const outboundIds = tokens
    .filter((token) => token.environmentId === caller.environmentId)
    .map((token) => token.id);
  const inboundIds = tokens
    .filter((token) => token.environmentId !== caller.environmentId)
    .map((token) => token.id);
  const facts = new Map([
    ...(await outboundShareTokenFacts(db, caller.environmentId, outboundIds)),
    ...(await crossTenant.inboundShareTokenFacts(db, caller, inboundIds)),
  ]);
  const views: ShareTokenView[] = [];
  for (const token of tokens) {
    const tokenFacts = facts.get(token.id);
    if (tokenFacts === undefined) {
      throw connectNotFound();
    }
    const direction = token.environmentId === caller.environmentId ? 'outbound' : 'inbound';
    const destinationHere =
      token.status === 'redeemed' &&
      token.destinationId !== null &&
      token.destinationType !== null &&
      token.destinationEnvironmentId === caller.environmentId;
    views.push({
      token,
      facts: tokenFacts,
      direction,
      ...(direction === 'outbound'
        ? {
            source: await objectIdentifierOf(
              db,
              caller.environmentId,
              token.sourceType,
              token.sourceId,
            ),
          }
        : {}),
      ...(destinationHere && token.destinationId !== null && token.destinationType !== null
        ? {
            destination: await objectIdentifierOf(
              db,
              caller.environmentId,
              token.destinationType,
              token.destinationId,
            ),
          }
        : {}),
    });
  }
  return views;
}

/** The token's facts as the side `environmentId` holds them (for an event payload). */
async function sideViewOf(
  db: Db,
  token: ConnectShareToken,
  side: 'source' | 'destination',
): Promise<ShareTokenView> {
  const caller: CrossTenantCaller = {
    organizationId: '',
    environmentId: side === 'source' ? token.environmentId : token.destinationEnvironmentId,
    environmentKind: token.environmentKind,
  };
  const facts =
    side === 'source'
      ? await outboundShareTokenFacts(db, token.environmentId, [token.id])
      : await crossTenant.inboundShareTokenFacts(db, caller, [token.id]);
  const tokenFacts = facts.get(token.id);
  if (tokenFacts === undefined) {
    throw new Error(`Share token ${token.id} has no consent record`);
  }
  return {
    token,
    facts: tokenFacts,
    direction: side === 'source' ? 'outbound' : 'inbound',
    ...(side === 'source'
      ? {
          source: await objectIdentifierOf(
            db,
            token.environmentId,
            token.sourceType,
            token.sourceId,
          ),
        }
      : {}),
  };
}

/** Who acted on a token: a principal, or the system (the minute sweep). */
export type TokenActor =
  { kind: 'principal'; acting: ConnectActing } | { kind: 'system'; sourceOrganizationId: string };

/** The audit action of a token change (C240.4). */
export type ShareTokenAuditAction = 'created' | 'peeked' | 'redeemed' | 'expired' | 'failed';

/**
 * C239.1, C240.4: a token change's events and audit entries on both sides, in `tx`. The source side
 * is the token's environment, the destination side its destination environment; a side of the
 * actor's organisation is written as its own (events through `events`, the entry naming the actor),
 * the other through the cross-tenant module (the entry naming only `{organization-id, kind}`). A
 * self-connection's token has one environment for both sides: it gets each event once per name and
 * one audit entry.
 */
export async function stageTokenChange(
  deps: Pick<ShareTokenDeps, 'events' | 'audit'>,
  tx: Db,
  actor: TokenActor,
  token: ConnectShareToken,
  change: {
    source: EventName | null;
    destination: EventName | null;
    audit: ShareTokenAuditAction;
    sourceOrganizationId: string;
    destinationOrganizationId: string;
  },
): Promise<StagedEvent[]> {
  const sides = [
    {
      side: 'source' as const,
      environmentId: token.environmentId,
      organizationId: change.sourceOrganizationId,
      name: change.source,
    },
    {
      side: 'destination' as const,
      environmentId: token.destinationEnvironmentId,
      organizationId: change.destinationOrganizationId,
      name: change.destination,
    },
  ];
  const self = token.environmentId === token.destinationEnvironmentId;
  const actorOrganization =
    actor.kind === 'principal' ? actor.acting.ctx.organizationId : change.sourceOrganizationId;
  const counterpartyActor: CounterpartyActor =
    actor.kind === 'principal'
      ? counterpartyActorOf(actor.acting)
      : { 'organization-id': change.sourceOrganizationId, kind: 'system' };
  const staged: StagedEvent[] = [];
  const action = `connect-share-token.${change.audit}`;
  for (const side of sides) {
    if (self && side.side === 'destination' && side.name === change.source) {
      continue;
    }
    const own = side.organizationId === actorOrganization;
    if (side.name !== null) {
      const view = await sideViewOf(tx, token, self ? 'source' : side.side);
      const payload = {
        data: shareTokenResourceOf(self ? { ...view, direction: 'outbound' } : view),
      };
      if (own) {
        staged.push(
          await deps.events.stage(tx, {
            environmentId: side.environmentId,
            name: side.name,
            payload,
          }),
        );
      } else {
        staged.push(
          ...(await crossTenant.stageCounterpartyEvents(
            tx,
            [{ environmentId: side.environmentId, name: side.name, payload }],
            deps.events,
          )),
        );
      }
    }
    if (self && side.side === 'destination') {
      continue;
    }
    if (own && actor.kind === 'principal') {
      await deps.audit.record(tx, {
        ...auditEntryOf(actor.acting.ctx, actor.acting.actor, {
          action,
          resourceType: 'connect-share-token',
          resourceId: token.id,
          metadata: { 'connection-id': token.connectionId },
        }),
        environmentId: side.environmentId,
      });
    } else if (own) {
      await appendAuditLog(tx, side.environmentId, {
        actorType: 'system',
        action,
        resourceType: 'connect-share-token',
        resourceId: token.id,
        metadata: { 'connection-id': token.connectionId },
      });
    } else {
      await crossTenant.appendCounterpartyAudit(tx, [
        {
          environmentId: side.environmentId,
          action,
          actor: counterpartyActor,
          resourceType: 'connect-share-token',
          resourceId: token.id,
          details: { 'connection-id': token.connectionId },
        },
      ]);
    }
  }
  return staged;
}

/** C232.1's 422 `consent_required` with its reason. */
function consentRequired(reason: ConsentRequiredReason): ConnectProblemError {
  return new ConnectProblemError(
    'consent_required',
    'The consent record does not cover this share.',
    {
      reason,
      errors: [
        { location: 'body', pointer: ID_POINTER.consent, detail: `consent_required: ${reason}` },
      ],
    },
  );
}

/** A unique violation of the one-consent-one-token index (a concurrent create citing it). */
const consentTaken = (error: unknown): boolean =>
  JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})).includes(
    'connect_share_tokens_consent_record_id_key',
  );

/** The policy version a token is created under: the connection's current (accepted) one. */
async function currentPolicyOf(
  db: Db,
  connection: ConnectConnectionRecord,
): Promise<{ id: string; body: SharePolicy }> {
  const [policy] = await getSharePoliciesOfConnection(db, connection.id, [
    connection.currentPolicyId ?? '',
  ]);
  if (policy === undefined) {
    throw new Error(`Connection ${connection.id} has no current policy version`);
  }
  return { id: policy.id, body: storedSharePolicySchema.parse(policy.body) };
}

/**
 * C232.1: a token in the source environment, `created`, `direction: outbound`, with the categories
 * the share carries now. Checks, in this order: the connection (the one 404, 409
 * `connection_not_active`); the destination's environment of the caller's kind (422
 * `environment_kind_mismatch`); the source (the one 404, 409 `source_redacted`,
 * `source_not_decided`, `source_is_copy`); the policy (422 `share_source_not_allowed`,
 * `share_source_not_supported` for a report); the consent record (422 `consent_required` with its
 * reason); the lifetime (422 `share_token_outlives_consent`).
 */
export async function createShareTokenFor(
  deps: ShareTokenDeps,
  acting: ConnectActing,
  attributes: CreateShareTokenBody['data']['attributes'],
): Promise<{ data: ShareTokenResource }> {
  const now = deps.clock.now();
  const { document, staged } = await deps.db.transaction((tx) =>
    createShareTokenInTx(deps, tx, acting, attributes, now),
  );
  await deps.events.dispatch(staged);
  return document;
}

/**
 * {@link createShareTokenFor} in the caller's transaction (a workflow step's, C243.1): the events it
 * stages are returned, for the caller to dispatch after its commit.
 */
export async function createShareTokenInTx(
  deps: Pick<ShareTokenDeps, 'ids' | 'events' | 'audit'>,
  tx: Db,
  acting: ConnectActing,
  attributes: CreateShareTokenBody['data']['attributes'],
  now: Date,
): Promise<{ document: { data: ShareTokenResource }; staged: StagedEvent[] }> {
  const caller = callerOf(acting);
  try {
    return await (async () => {
      const environment = await getEnvironment(tx, caller.environmentId);
      const maxSeconds = resolveConnectSettings(environment?.settings ?? {})[
        'share-token-max-seconds'
      ];
      const connection = await lockConnectionForShare(
        tx,
        caller.organizationId,
        attributes['connection-id'],
      );
      if (connection?.sourceOrganizationId !== caller.organizationId) {
        throw connectNotFound();
      }
      if (connection.status !== 'active') {
        throw new ConnectProblemError(
          'connection_not_active',
          'The connection is not active; the destination must activate it first.',
        );
      }
      const destinationEnvironmentId = await crossTenant.destinationEnvironmentOfKind(
        tx,
        caller,
        connection,
      );
      if (destinationEnvironmentId === null) {
        throw new ConnectProblemError(
          'environment_kind_mismatch',
          `The destination has no ${caller.environmentKind} environment: shares go sandbox to sandbox and production to production.`,
          {
            errors: [
              {
                location: 'body',
                pointer: ID_POINTER.connection,
                detail: `no ${caller.environmentKind} environment at the destination`,
              },
            ],
          },
        );
      }
      const prefix = attributes['source-id'].split('_')[0] ?? '';
      const sourceType = SHARE_SOURCE_TYPE_OF_PREFIX[prefix];
      if (sourceType === undefined) {
        if (prefix === 'rep') {
          throw new ConnectProblemError(
            'share_source_not_supported',
            'A report cannot be shared; share the inquiry or the account it is about.',
            {
              errors: [
                { location: 'body', pointer: ID_POINTER.source, detail: 'not a shareable source' },
              ],
            },
          );
        }
        throw connectNotFound();
      }
      const loaded = await loadShareSource(
        tx,
        caller.environmentId,
        sourceType,
        attributes['source-id'],
      );
      if (loaded === null) {
        throw connectNotFound();
      }
      if (loaded.redacted) {
        throw new ConnectProblemError('source_redacted', 'The source was redacted.');
      }
      if (sourceNotDecided(loaded.content)) {
        throw new ConnectProblemError(
          'source_not_decided',
          'The verification is not decided yet; only a passed or failed verification is shared.',
        );
      }
      if (sourceIsCopy(loaded.content)) {
        throw new ConnectProblemError(
          'source_is_copy',
          'The source is, or holds, a copy made by a share; a copy is never shared on.',
        );
      }
      const policy = await currentPolicyOf(tx, connection);
      const refusal = shareSourceRefusal(policy.body, {
        type: sourceType,
        ...(loaded.content.type === 'verification'
          ? { verificationType: loaded.content.verification.type }
          : {}),
      });
      const shared = refusal === null ? shareableContent(policy.body, loaded.content) : null;
      if (shared === null) {
        throw new ConnectProblemError(
          'share_source_not_allowed',
          'The connection’s share policy does not share this source.',
          {
            errors: [
              { location: 'body', pointer: ID_POINTER.source, detail: 'not shared by the policy' },
            ],
          },
        );
      }
      const categories: ShareCategory[] = shareCategoriesOf(shared);
      const record = await lockConsentRecordForNewShareToken(
        tx,
        caller.environmentId,
        attributes['consent-record-id'],
      );
      const reason = sourceConsentRefusal(
        record === null
          ? null
          : {
              side: record.side,
              outcome: record.outcome,
              method: record.method,
              purpose: record.purpose,
              subject:
                record.subjectType === null || record.subjectId === null
                  ? null
                  : { type: record.subjectType, id: record.subjectId },
              shareTokenId: await shareTokenCitingConsentRecord(
                tx,
                caller.environmentId,
                record.id,
              ),
              recipientOrganizationId: record.recipientOrganizationId,
              categories: record.dataCategories as ShareCategory[],
              explicitBiometric: record.explicitBiometric,
              expiresAt: record.expiresAt,
              withdrawnAt: record.withdrawnAt,
              redactedAt: record.redactedAt,
            },
        {
          source: {
            type: sourceType,
            id: attributes['source-id'],
            holdingInquiryId: loaded.holdingInquiryId,
          },
          recipientOrganizationId: connection.destinationOrganizationId,
          purpose: policy.body.purpose,
          categories,
          attestedConsent: policy.body['attested-consent'],
          shareTokenId: null,
          now,
        },
      );
      if (reason !== null || record === null) {
        throw consentRequired(reason ?? 'missing');
      }
      const requested = attributes['expires-in-seconds'];
      if (requested !== undefined && requested > maxSeconds) {
        throw new UnprocessableContentError(
          `expires-in-seconds is at most this environment’s share-token-max-seconds, ${String(maxSeconds)}.`,
          [
            {
              location: 'body',
              pointer: ID_POINTER.expires,
              detail: `must be at most ${String(maxSeconds)}`,
            },
          ],
        );
      }
      const byLifetime = new Date(
        now.getTime() +
          1000 * (requested ?? Math.min(SHARE_TOKEN_EXPIRES_IN_SECONDS.default, maxSeconds)),
      );
      if (requested !== undefined && byLifetime.getTime() > record.expiresAt.getTime()) {
        throw new ConnectProblemError(
          'share_token_outlives_consent',
          'The token would outlive the consent record it cites.',
          {
            errors: [
              {
                location: 'body',
                pointer: ID_POINTER.expires,
                detail: `the consent expires at ${record.expiresAt.toISOString()}`,
              },
            ],
          },
        );
      }
      const expiresAt =
        byLifetime.getTime() > record.expiresAt.getTime() ? record.expiresAt : byLifetime;
      const token = await createShareToken(tx, caller.environmentId, {
        id: deps.ids.newId('cnst'),
        connectionId: connection.id,
        policyId: policy.id,
        environmentKind: caller.environmentKind,
        destinationEnvironmentId,
        sourceType,
        sourceId: attributes['source-id'],
        consentRecordId: record.id,
        dataCategories: categories,
        explicitBiometric: categories.includes('biometric'),
        creatorType: acting.actor.type === 'workflow-run' ? 'workflow' : acting.actor.type,
        creatorId: acting.actor.id,
        expiresAt,
        createdAt: now,
      });
      const staged = await stageTokenChange(deps, tx, { kind: 'principal', acting }, token, {
        source: 'connect/share-token.outbound-created',
        destination: 'connect/share-token.inbound-created',
        audit: 'created',
        sourceOrganizationId: connection.sourceOrganizationId,
        destinationOrganizationId: connection.destinationOrganizationId,
      });
      const [view] = await viewsOf(tx, caller, [token]);
      if (view === undefined) {
        throw connectNotFound();
      }
      return { document: { data: shareTokenResourceOf(view) }, staged };
    })();
  } catch (error) {
    if (consentTaken(error)) {
      throw consentRequired('already_used');
    }
    throw error;
  }
}

/** C232.2: outbound and inbound tokens of the caller's environment, newest first; no peek. */
export async function listShareTokens(
  deps: Pick<ShareTokenDeps, 'db'>,
  acting: ConnectActing,
  query: ListShareTokensQuery,
): Promise<{ data: ShareTokenResource[]; links: { next: string | null } }> {
  const caller = callerOf(acting);
  const request = pageRequest(query);
  const page = await withCursor(() =>
    crossTenant.listInboundShareTokens(deps.db, caller, {
      direction: query['filter[direction]'],
      connectionIds: filterValues(query['filter[connection-id]'], idSchema('cxn')),
      statuses: filterValues(query['filter[status]'], shareTokenStatusSchema),
      after: request.after,
      size: request.size,
    }),
  );
  const views = await viewsOf(deps.db, caller, page.items);
  const filters = {
    'filter[connection-id]': query['filter[connection-id]'],
    'filter[status]': query['filter[status]'],
    'filter[direction]': query['filter[direction]'],
  };
  return {
    data: views.map(shareTokenResourceOf),
    links: { next: nextLink('/api/v1/connect/share-tokens', filters, query, page.next) },
  };
}

/** The token as the caller sees it: outbound in its environment, else inbound to it, else 404. */
async function findVisibleToken(
  db: Db,
  caller: CrossTenantCaller,
  id: string,
): Promise<ConnectShareToken> {
  return (
    (await getOutboundShareToken(db, caller.environmentId, id)) ??
    (await crossTenant.getInboundShareToken(db, caller, id))
  );
}

/** C232.3: one token as the caller's side sees it, or the one 404. */
export async function getShareTokenDocument(
  deps: Pick<ShareTokenDeps, 'db'>,
  acting: ConnectActing,
  id: string,
): Promise<{ data: ShareTokenResource }> {
  const caller = callerOf(acting);
  const [view] = await viewsOf(deps.db, caller, [await findVisibleToken(deps.db, caller, id)]);
  if (view === undefined) {
    throw connectNotFound();
  }
  return { data: shareTokenResourceOf(view) };
}

/** The connection a token of the caller's organisation is on (bound by the token). */
async function connectionOfToken(
  db: Db,
  caller: CrossTenantCaller,
  token: ConnectShareToken,
): Promise<ConnectConnectionRecord> {
  const connection = await getConnectionOfOrganization(
    db,
    caller.organizationId,
    token.connectionId,
  );
  if (connection === null) {
    throw connectNotFound();
  }
  return connection;
}

/**
 * C232.4: the source only; `created` to `expired` with `expiry-reason: source_expired`.
 * @throws {ConnectProblemError} 409 `share_token_not_expirable` in any other status.
 */
export async function expireShareToken(
  deps: ShareTokenDeps,
  acting: ConnectActing,
  id: string,
): Promise<{ data: ShareTokenResource }> {
  const now = deps.clock.now();
  const { document, staged } = await deps.db.transaction((tx) =>
    expireShareTokenInTx(deps, tx, acting, id, now),
  );
  await deps.events.dispatch(staged);
  return document;
}

/** {@link expireShareToken} in the caller's transaction (a workflow step's, C243.1). */
export async function expireShareTokenInTx(
  deps: Pick<ShareTokenDeps, 'events' | 'audit'>,
  tx: Db,
  acting: ConnectActing,
  id: string,
  now: Date,
): Promise<{ document: { data: ShareTokenResource }; staged: StagedEvent[] }> {
  const caller = callerOf(acting);
  {
    const token = await lockOutboundShareTokenForUpdate(tx, caller.environmentId, id);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token === null) {
      throw connectNotFound();
    }
    if (token.status !== 'created') {
      throw new ConnectProblemError(
        'share_token_not_expirable',
        `Only a created token can be expired; this one is ${token.status}.`,
      );
    }
    const connection = await connectionOfToken(tx, caller, token);
    const expired = await updateOutboundShareToken(tx, caller.environmentId, id, {
      status: 'expired',
      expiryReason: 'source_expired',
      expiredAt: now,
      updatedAt: now,
    });
    const events = await stageTokenChange(deps, tx, { kind: 'principal', acting }, expired, {
      source: 'connect/share-token.expired',
      destination: 'connect/share-token.expired',
      audit: 'expired',
      sourceOrganizationId: connection.sourceOrganizationId,
      destinationOrganizationId: connection.destinationOrganizationId,
    });
    const [view] = await viewsOf(tx, caller, [expired]);
    if (view === undefined) {
      throw connectNotFound();
    }
    return { document: { data: shareTokenResourceOf(view) }, staged: events };
  }
}

/**
 * C231.4: the deactivation's hook. Every `created` token of the connection expires
 * (`connection_deactivated`) in the deactivation's transaction, through the cross-tenant module
 * (the tokens live in the source's environments), with `connect/share-token.expired` and the audit
 * entries on both sides.
 */
export function expireTokensOnDeactivation(
  deps: Pick<ShareTokenDeps, 'events' | 'audit'>,
): ExpireTokensOnDeactivation {
  return async (tx, acting, connection, now) => {
    const caller = callerOf(acting);
    const expired = await crossTenant.expireTokensOnDeactivation(tx, caller, connection, now);
    const staged: StagedEvent[] = [];
    for (const token of expired) {
      staged.push(
        ...(await stageTokenChange(deps, tx, { kind: 'principal', acting }, token, {
          source: 'connect/share-token.expired',
          destination: 'connect/share-token.expired',
          audit: 'expired',
          sourceOrganizationId: connection.sourceOrganizationId,
          destinationOrganizationId: connection.destinationOrganizationId,
        })),
      );
    }
    return staged;
  };
}

/**
 * C233: the destination's peek. Scope `connect-share-tokens:peek` and, for a user, `pii:view` (403);
 * the token inbound to the caller's environment (else the one 404); `created` (409
 * `share_token_not_redeemable`) over an `active` connection (409 `connection_not_active`); at most
 * {@link SHARE_TOKEN_PEEK_LIMIT} peeks, counted under the token row lock (429
 * `share_token_peek_limit`). The envelope is built from the source's current rows through the
 * cross-tenant module; the audit entries name the peek on both sides, never a value.
 */
export async function peekShareToken(
  deps: ShareTokenDeps,
  acting: ConnectActing,
  id: string,
): Promise<{ data: ShareTokenResource }> {
  assertMayPeek(principalOf(acting));
  const caller = callerOf(acting);
  const now = deps.clock.now();
  const { document, staged } = await deps.db.transaction(async (tx) => {
    const token = await crossTenant.lockInboundShareToken(tx, caller, id);
    const connection = await connectionOfToken(tx, caller, token);
    if (token.status !== 'created') {
      throw new ConnectProblemError(
        'share_token_not_redeemable',
        `Only a created token can be peeked; this one is ${token.status}.`,
      );
    }
    if (connection.status !== 'active') {
      throw new ConnectProblemError('connection_not_active', 'The connection is not active.');
    }
    if (token.peekCount >= SHARE_TOKEN_PEEK_LIMIT) {
      throw new ConnectProblemError(
        'share_token_peek_limit',
        `A token is peeked at most ${String(SHARE_TOKEN_PEEK_LIMIT)} times.`,
      );
    }
    const counted = await crossTenant.countPeek(tx, caller, token, now);
    const policy = storedSharePolicySchema.parse(
      (await crossTenant.inboundShareTokenPolicy(tx, caller, counted)).body,
    );
    const content = await crossTenant.readPeekSource(tx, caller, counted);
    const sourceData = content === null ? null : peekEnvelopeOf(policy, content);
    const events = await stageTokenChange(deps, tx, { kind: 'principal', acting }, counted, {
      source: null,
      destination: null,
      audit: 'peeked',
      sourceOrganizationId: connection.sourceOrganizationId,
      destinationOrganizationId: connection.destinationOrganizationId,
    });
    const [view] = await viewsOf(tx, caller, [counted]);
    if (view === undefined) {
      throw connectNotFound();
    }
    return {
      document: {
        data: shareTokenResourceOf({
          ...view,
          ...(sourceData === null ? {} : { sourceData }),
        }),
      },
      staged: events,
    };
  });
  await deps.events.dispatch(staged);
  return document;
}

/** C233.1: the peek scope, and `pii:view` for a user (a peek holds the source's values). */
function assertMayPeek(principal: Principal): void {
  const missing = [
    ...(principal.permissions.has('connect-share-tokens:peek')
      ? []
      : ['connect-share-tokens:peek']),
    ...(principal.kind === 'user' && !principal.permissions.has('pii:view') ? ['pii:view'] : []),
  ];
  if (missing.length > 0) {
    throw new PermissionDeniedError(
      `Peeking at a share token needs ${missing.join(' and ')}.`,
      missing,
    );
  }
}
