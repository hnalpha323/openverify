/**
 * C240.5 (reviews P24, F22; verification V04; Workflow 11A): the one cross-tenant path. Every read
 * and write of another environment's rows goes through this module, which takes a token or a
 * connection already bound to the caller (its organisation, its side, its environment) and refuses
 * anything else with the one generic 404 (`connectNotFound`). It alone imports the Connect
 * repositories' cross-environment functions (`@openverify/db/cross-env`) and the counterparty entry
 * points of the event and audit writers (`./counterparty-events.js`, `./audit.js`): the ESLint rule
 * (`packages/config/eslint/phase5-rules.js`) and `cross-tenant.source.test.ts` hold the boundary.
 *
 * Declared by `foundation-11a`, built by `api-connect` (its file). `api-redeem` and `api-consent`
 * call it; a new entry point here is the only way to reach another environment.
 */
import {
  connectConnectionsCrossEnv,
  connectSharePoliciesCrossEnv,
  connectShareTokensCrossEnv,
  consentRecordsCrossEnv,
} from '@openverify/db/cross-env';
import { storedSharePolicySchema, type SharePolicy } from '@openverify/contracts';
import {
  lockConnectionForShare,
  lockConsentRecord,
  type OpenedConsentRecord,
} from '@openverify/db';
import type {
  ConnectConnectionRecord,
  ConnectSharePolicy,
  ConnectShareToken,
  Db,
  Page,
  ShareTokenChanges,
  ShareTokenFacts,
} from '@openverify/db';
import type { ShareSourceContent } from '@openverify/core';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import {
  appendCounterpartyAuditEntries,
  type CounterpartyActor,
  type CounterpartyAuditEntry,
} from './audit.js';
import { stageCounterpartyEvents, type CounterpartyEvent } from './counterparty-events.js';
import { connectNotFound } from './not-found.js';
import { loadRedemptionMaterial, type RedemptionMaterial } from './clone.js';
import { ConnectProblemError } from './problems.js';
import { loadShareSource, type LoadedShareSource } from './peek.js';

export type { CounterpartyActor, CounterpartyAuditEntry, CounterpartyEvent };

/** Who is asking: the caller's organisation and environment (from its principal). */
export interface CrossTenantCaller {
  organizationId: string;
  environmentId: string;
  environmentKind: 'sandbox' | 'production';
}

/**
 * C234.2 (C287.2's lock order: the connection, the consent records, the token): what a redemption
 * re-reads under its locks, in the destination's transaction. Every member is `null` when its row is
 * gone; the job decides the failure reason from them (`source_not_found`, `source_redacted`,
 * `source_is_copy`, `connection_inactive`, `consent_withdrawn`, `consent_expired`).
 */
export interface RedemptionSource {
  /** The token, FOR UPDATE, inbound to the caller's environment. */
  token: ConnectShareToken;
  /** The connection, FOR SHARE (a deactivation waits for the redemption's commit). */
  connection: ConnectConnectionRecord;
  /** The policy version the token was created under, parsed. */
  policy: SharePolicy;
  /** The source-side record the token cites, FOR SHARE in the source environment. */
  sourceConsent: OpenedConsentRecord | null;
  /** The destination-side record the redemption cited, FOR SHARE in the caller's environment. */
  destinationConsent: OpenedConsentRecord | null;
  /** The source's current rows (redacted or not: the job refuses a redacted one), or `null`. */
  source: LoadedShareSource | null;
  /** The source organisation's name, NFC, for the copy's provenance (C235.1). */
  sourceOrganizationName: string;
  /** The version of the policy the token was created under (its `redeem-summary`). */
  policyVersion: number;
  /** C234.2: the copy's material of the shareable verifications; `null` when the source is gone. */
  material: RedemptionMaterial | null;
}

/** C253.2 (11B's access export): the shares touching a person's objects in one environment. */
export interface SharesTouching {
  /** Tokens whose source, destination copy or reserved inquiry is one of the objects. */
  tokens: ConnectShareToken[];
  /** The environment's own consent records about the objects or citing those tokens. */
  consentRecords: OpenedConsentRecord[];
}

/** C232.2's query of the caller's tokens: both directions unless `direction` names one. */
export interface ShareTokenListQuery {
  direction?: 'outbound' | 'inbound' | undefined;
  connectionIds?: readonly string[] | undefined;
  statuses?: readonly ConnectShareToken['status'][] | undefined;
  after?: string | undefined;
  size?: number | undefined;
}

export interface CrossTenant {
  /** C232.3: an inbound token of the caller's environment, or the one 404. */
  getInboundShareToken(db: Db, caller: CrossTenantCaller, id: string): Promise<ConnectShareToken>;
  /**
   * C232.2: the caller's outbound tokens and the tokens inbound to its environment, newest first
   * (C1). An inbound token's row lives in the source environment, hence here.
   */
  listInboundShareTokens(
    db: Db,
    caller: CrossTenantCaller,
    query: ShareTokenListQuery,
  ): Promise<Page<ConnectShareToken>>;
  /**
   * C233.4: the source's current rows for a peek of a token inbound to the caller, read at request
   * time, never cached; `null` when the source is gone or redacted.
   */
  readPeekSource(
    db: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
  ): Promise<ShareSourceContent | null>;
  /** C233.5, C234.1: an inbound token FOR UPDATE (the destination's peek and redemption), or 404. */
  lockInboundShareToken(tx: Db, caller: CrossTenantCaller, id: string): Promise<ConnectShareToken>;
  /** C233.5: one more peek of an inbound token the caller holds FOR UPDATE. */
  countPeek(
    tx: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
    now: Date,
  ): Promise<ConnectShareToken>;
  /**
   * C234.2: the redemption's re-read of the source, the connection (FOR SHARE) and both consent
   * records (FOR SHARE), in the lock order connection, consent records, token.
   */
  readRedemptionSource(
    tx: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
  ): Promise<RedemptionSource>;
  /**
   * C234.1, C234.2 (integration-11a): the destination's change of an inbound token it holds FOR
   * UPDATE (pending, then redeemed or failed with its summary). Refused with the one 404 unless the
   * token is inbound to the caller's environment.
   */
  markInboundShareToken(
    tx: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
    changes: ShareTokenChanges,
  ): Promise<ConnectShareToken>;
  /**
   * C238.5 (integration-11a): reserves an inbound token the caller holds FOR UPDATE for the inquiry
   * created with `meta.share-token-id`; 409 `share_token_in_use` when another inquiry holds it.
   */
  reserveInboundShareToken(
    tx: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
    inquiryId: string,
  ): Promise<ConnectShareToken>;
  /**
   * C239.1: the counterparty's events, staged in the transaction of the change, with an empty cause.
   * With `publisher`, the caller dispatches the returned events after its commit; without it they
   * wait for their sweeps (the rows are the outbox).
   */
  stageCounterpartyEvents(
    tx: Db,
    events: readonly CounterpartyEvent[],
    publisher?: TransactionalEventPublisher,
  ): Promise<StagedEvent[]>;
  /** C240.4: the counterparty's audit entries, actor `{organization-id, kind}` only. */
  appendCounterpartyAudit(tx: Db, entries: readonly CounterpartyAuditEntry[]): Promise<void>;
  /**
   * C231.4: a deactivation, by either side, expires the connection's `created` tokens (both
   * environment kinds of the source). The caller holds the connection FOR UPDATE.
   */
  expireTokensOnDeactivation(
    tx: Db,
    caller: CrossTenantCaller,
    connection: ConnectConnectionRecord,
    now: Date,
  ): Promise<ConnectShareToken[]>;
  /**
   * C237.2: a withdrawal of a consent record of the caller's environment expires the `created`
   * token that cites it: as the source record (`consent-record-id`), or as the destination record
   * naming an inbound token. The caller holds the record FOR UPDATE.
   */
  expireTokenOnWithdrawal(
    tx: Db,
    caller: CrossTenantCaller,
    consentRecordId: string,
    now: Date,
  ): Promise<ConnectShareToken | null>;
  /**
   * C253.2 (11B's access export): the tokens touching these objects on either side, and the
   * environment's own consent records about them, so `dsar-export` only calls this.
   */
  listSharesTouching(
    db: Db,
    environmentId: string,
    objectIds: readonly string[],
  ): Promise<SharesTouching>;
  /** C230.2: both organisations' names, for a connection the caller is a side of. */
  connectionOrganizationNames(
    db: Db,
    caller: CrossTenantCaller,
    connection: ConnectConnectionRecord,
  ): Promise<{ source: string; destination: string }>;
  /** C239.1, C240.4: the other side's environments, where its events and audit entries go. */
  counterpartyEnvironments(
    db: Db,
    caller: CrossTenantCaller,
    connection: ConnectConnectionRecord,
  ): Promise<{ id: string; kind: 'sandbox' | 'production' }[]>;
  /** C232.1 (connect R13): the destination's environment of the caller's kind, or null. */
  destinationEnvironmentOfKind(
    db: Db,
    caller: CrossTenantCaller,
    connection: ConnectConnectionRecord,
  ): Promise<string | null>;
  /**
   * C231.1, C231.10: whether the organisation a create names exists and has opted in to inbound
   * connections. One answer for both refusals, so a create is no oracle.
   */
  acceptsInboundConnections(db: Db, organizationId: string): Promise<boolean>;
  /** C232.3: what the destination sees beside its inbound tokens (version, source consent). */
  inboundShareTokenFacts(
    db: Db,
    caller: CrossTenantCaller,
    ids: readonly string[],
  ): Promise<Map<string, ShareTokenFacts>>;
  /** C233.1, C234.1: the policy version an inbound token was created under, or the one 404. */
  inboundShareTokenPolicy(
    db: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
  ): Promise<ConnectSharePolicy>;
}

/** The connection is the caller's: its organisation is a side of it. */
function assertSide(caller: CrossTenantCaller, connection: ConnectConnectionRecord): void {
  if (
    connection.sourceOrganizationId !== caller.organizationId &&
    connection.destinationOrganizationId !== caller.organizationId
  ) {
    throw connectNotFound();
  }
}

/** The organisation on the other side (a self-connection's is the caller's own). */
const counterpartyOf = (caller: CrossTenantCaller, connection: ConnectConnectionRecord): string =>
  connection.sourceOrganizationId === caller.organizationId
    ? connection.destinationOrganizationId
    : connection.sourceOrganizationId;

/** The module's entry points. */
export const crossTenant: CrossTenant = {
  async getInboundShareToken(db, caller, id) {
    const token = await connectShareTokensCrossEnv.getInboundShareToken(
      db,
      caller.environmentId,
      id,
    );
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token === null) {
      throw connectNotFound();
    }
    return token;
  },
  listInboundShareTokens: (db, caller, query) =>
    connectShareTokensCrossEnv.listShareTokensOfEnvironment(
      db,
      caller.environmentId,
      {
        direction: query.direction,
        connectionIds: query.connectionIds,
        statuses: query.statuses,
      },
      { after: query.after, size: query.size },
    ),
  async readPeekSource(db, caller, token) {
    if (token.destinationEnvironmentId !== caller.environmentId) {
      throw connectNotFound();
    }
    const loaded = await loadShareSource(db, token.environmentId, token.sourceType, token.sourceId);
    return loaded === null || loaded.redacted ? null : loaded.content;
  },
  async lockInboundShareToken(tx, caller, id) {
    const token = await connectShareTokensCrossEnv.lockInboundShareTokenForUpdate(
      tx,
      caller.environmentId,
      id,
    );
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token === null) {
      throw connectNotFound();
    }
    return token;
  },
  countPeek: (tx, caller, token, now) =>
    connectShareTokensCrossEnv.updateInboundShareToken(tx, caller.environmentId, token.id, {
      peekCount: token.peekCount + 1,
      updatedAt: now,
    }),
  async readRedemptionSource(tx, caller, token) {
    if (token.destinationEnvironmentId !== caller.environmentId) {
      throw connectNotFound();
    }
    const connection = await lockConnectionForShare(tx, caller.organizationId, token.connectionId);
    if (connection === null) {
      throw connectNotFound();
    }
    const sourceConsent = await consentRecordsCrossEnv.lockSourceConsentRecordForShare(
      tx,
      token.environmentId,
      token.consentRecordId,
    );
    const destinationConsent =
      token.destinationConsentRecordId === null
        ? null
        : await lockConsentRecord(
            tx,
            caller.environmentId,
            token.destinationConsentRecordId,
            'share',
          );
    const locked = await connectShareTokensCrossEnv.lockInboundShareTokenForUpdate(
      tx,
      caller.environmentId,
      token.id,
    );
    if (locked === null) {
      throw connectNotFound();
    }
    const policy = await connectSharePoliciesCrossEnv.getInboundTokenPolicy(
      tx,
      caller.environmentId,
      token.id,
    );
    const names = await connectConnectionsCrossEnv.connectionOrganizationNames(tx, connection.id);
    if (policy === null || names === null) {
      throw connectNotFound();
    }
    const source = await loadShareSource(
      tx,
      locked.environmentId,
      locked.sourceType,
      locked.sourceId,
    );
    return {
      token: locked,
      connection,
      policy: storedSharePolicySchema.parse(policy.body),
      sourceConsent,
      destinationConsent,
      source,
      sourceOrganizationName: names.source.normalize('NFC'),
      policyVersion: policy.version,
      material:
        source === null
          ? null
          : await loadRedemptionMaterial(
              tx,
              locked.environmentId,
              source.content.type === 'inquiry'
                ? source.content.verifications.map(({ id }) => id)
                : source.content.type === 'verification'
                  ? [source.content.verification.id]
                  : [],
            ),
    };
  },
  async markInboundShareToken(tx, caller, token, changes) {
    if (token.destinationEnvironmentId !== caller.environmentId) {
      throw connectNotFound();
    }
    return connectShareTokensCrossEnv.updateInboundShareToken(
      tx,
      caller.environmentId,
      token.id,
      changes,
    );
  },
  async reserveInboundShareToken(tx, caller, token, inquiryId) {
    if (token.destinationEnvironmentId !== caller.environmentId) {
      throw connectNotFound();
    }
    if (token.reservedInquiryId !== null && token.reservedInquiryId !== inquiryId) {
      throw new ConnectProblemError(
        'share_token_in_use',
        'The share token is reserved for another inquiry.',
      );
    }
    return connectShareTokensCrossEnv.updateInboundShareToken(tx, caller.environmentId, token.id, {
      reservedInquiryId: inquiryId,
      updatedAt: token.updatedAt,
    });
  },
  stageCounterpartyEvents: (tx, events, publisher) =>
    stageCounterpartyEvents(tx, events, publisher),
  appendCounterpartyAudit: (tx, entries) => appendCounterpartyAuditEntries(tx, entries),
  async expireTokensOnDeactivation(tx, caller, connection, now) {
    assertSide(caller, connection);
    return connectShareTokensCrossEnv.expireCreatedTokensOfConnection(tx, connection.id, now);
  },
  expireTokenOnWithdrawal: (tx, caller, consentRecordId, now) =>
    connectShareTokensCrossEnv.expireCreatedTokenCitingConsentRecord(
      tx,
      caller.environmentId,
      consentRecordId,
      now,
    ),
  async listSharesTouching(db, environmentId, objectIds) {
    const tokens = await connectShareTokensCrossEnv.listSharesTouching(
      db,
      environmentId,
      objectIds,
    );
    const consentRecords = await consentRecordsCrossEnv.listConsentRecordsTouching(
      db,
      environmentId,
      [...objectIds, ...tokens.map((token) => token.id)],
    );
    return { tokens, consentRecords };
  },
  async connectionOrganizationNames(db, caller, connection) {
    assertSide(caller, connection);
    const names = await connectConnectionsCrossEnv.connectionOrganizationNames(db, connection.id);
    if (names === null) {
      throw connectNotFound();
    }
    return {
      source: names.source.normalize('NFC'),
      destination: names.destination.normalize('NFC'),
    };
  },
  async counterpartyEnvironments(db, caller, connection) {
    assertSide(caller, connection);
    return connectConnectionsCrossEnv.counterpartyEnvironments(
      db,
      connection.id,
      counterpartyOf(caller, connection),
    );
  },
  async destinationEnvironmentOfKind(db, caller, connection) {
    if (connection.sourceOrganizationId !== caller.organizationId) {
      throw connectNotFound();
    }
    return connectConnectionsCrossEnv.destinationEnvironmentOfKind(
      db,
      connection.id,
      caller.environmentKind,
    );
  },
  async acceptsInboundConnections(db, organizationId) {
    return (await connectConnectionsCrossEnv.inboundOrganization(db, organizationId)) !== null;
  },
  inboundShareTokenFacts: (db, caller, ids) =>
    connectShareTokensCrossEnv.inboundShareTokenFacts(db, caller.environmentId, ids),
  async inboundShareTokenPolicy(db, caller, token) {
    const policy =
      token.destinationEnvironmentId === caller.environmentId
        ? await connectSharePoliciesCrossEnv.getInboundTokenPolicy(
            db,
            caller.environmentId,
            token.id,
          )
        : null;
    if (policy === null) {
      throw connectNotFound();
    }
    return policy;
  },
};

/** The repositories this module reaches (kept so the boundary is not vacuous). */
export const CROSS_ENV_REPOSITORIES = Object.freeze({
  connections: connectConnectionsCrossEnv,
  policies: connectSharePoliciesCrossEnv,
  shareTokens: connectShareTokensCrossEnv,
  consentRecords: consentRecordsCrossEnv,
});
