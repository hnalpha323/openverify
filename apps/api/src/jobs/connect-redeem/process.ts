/**
 * C234.2 (Workflow 11A; the `connect-redeem` job). Owner: `api-redeem`; the signature and the worker's
 * registration were placed by `foundation-11a` (Stage 1b (R)).
 *
 * For one `pending` token, one transaction in the destination environment:
 * 1. the request and its actor, read back from the destination's own audit entry of the request
 *    (`connect-share-token.redeem-requested`, ids and keys only; the job carries ids only);
 * 2. the destination consent record FOR SHARE, then, through the cross-tenant module
 *    (`readRedemptionSource`), the connection FOR SHARE, the source consent record FOR SHARE and the
 *    token FOR UPDATE (still `pending`), the policy version it was created under, and the source as
 *    it is now with the copy's material (C234.7: a snapshot at redemption);
 * 3. the re-checks, each ending the token `failed` with its reason: `source_not_found`,
 *    `source_redacted` (C241.1: a source redacted while pending fails here), `source_is_copy`,
 *    `connection_inactive`, `consent_withdrawn`, `consent_expired` (either record past its
 *    `expires-at` now), `consent_scope_exceeded` (a record no longer covers the share, or the rows
 *    about to be copied hold a category outside the token's stored ones: review H04), and
 *    `import_failed` for the limits of C234.9 or a copy the destination refuses;
 * 4. the copy (`clone.ts`, `hydrate.ts`): a clone of an inquiry under the requested template version,
 *    a clone of a verification onto its open inquiry, a hydrate, or `fill-inquiry` (C234.11: the
 *    reserved inquiry's fields hydrated and its verifications cloned onto it);
 * 5. the token `redeemed` with its destination and `redeem-summary` (counts and keys only), the
 *    destination record's subject moved to the destination object, the token id kept as a plain
 *    string (C236.10), and `connect/share-token.outbound-redeemed` and `.inbound-redeemed` with the
 *    audit entries on both sides (`stageTokenChange`).
 * A transient database error is retried three times and then ends `unrecoverable_error`; every
 * failure is final and stages `connect/share-token.failed` on both sides. Objects a rolled-back copy
 * put in storage are deleted. Uncapped in 11A (C234.2); 11B admits it under C251's cap.
 */
import {
  storedSharePolicySchema,
  type RedeemSummary,
  type SharePolicy,
} from '@openverify/contracts';
import {
  cloneProvenance,
  shareableContent,
  shareCategoriesOf,
  sourceIsCopy,
  type SharedContent,
} from '@openverify/core';
import {
  getEnvironment,
  listAuditLogs,
  lockConsentRecord,
  setConsentRecordSubject,
  type ConnectShareToken,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { ulidIdGenerator, type Clock, type FileStorage, type IdGenerator } from '../../ports.js';
import type { ApiDependencies } from '../../services/context.js';
import { createAuditLogger } from '../../services/audit-log.js';
import type { CrossTenantCaller } from '../../services/connect/cross-tenant.js';
import { stageTokenChange } from '../../services/connect/share-tokens.js';
import type { ConnectRedeemJob } from '../connect-queues.js';
import type { WorkerLogger } from '../logger.js';
import {
  REDEEM_REQUESTED_ACTION,
  redemptionCrossTenant,
  type RedemptionCrossTenant,
  type RedemptionRead,
  type RedemptionRequest,
} from '../../services/connect/redeem.js';
import {
  copyRedemptionInTx,
  RedemptionFailure,
  REDEMPTION_LIMITS,
  type RedemptionActor,
} from './copy.js';

/** What the job reads. */
export interface ConnectRedeemDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  keyring: Keyring;
  /** C234.3: a cloned file is re-encrypted under new data keys as a new object. */
  storage: FileStorage;
  /**
   * The events a redemption stages (both sides) and, for a hydrate, the destination's write paths
   * (`ApiDependencies`). The worker passes neither today (a contract deviation for
   * `integration-11a`, one line in `worker.ts`); without them a job fails loudly.
   */
  events?: TransactionalEventPublisher | undefined;
  api?: ApiDependencies | undefined;
  ids?: IdGenerator | undefined;
  /** The cross-tenant entry points (tests pass their own). */
  crossTenant?: RedemptionCrossTenant | undefined;
}

/** What one job did. */
export interface ConnectRedeemResult {
  outcome: 'redeemed' | 'failed' | 'skipped';
  failureReason?: string;
}

export type ProcessConnectRedeem = (
  job: ConnectRedeemJob,
  deps: ConnectRedeemDeps,
) => Promise<ConnectRedeemResult>;

/** C234.2: a transient database error is retried this many times, then `unrecoverable_error`. */
export const REDEEM_TRANSIENT_RETRIES = 3;

/** PostgreSQL's serialization failure and deadlock, and a dropped connection. */
const TRANSIENT_CODES: ReadonlySet<string> = new Set(['40001', '40P01', '57P01', '08006', '08003']);

function isTransient(error: unknown): boolean {
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
  return [...TRANSIENT_CODES].some((code) => text.includes(`"code":"${code}"`));
}

/** The request and its actor, from the destination's audit entry of the request. */
async function requestOf(
  db: Db,
  environmentId: string,
  shareTokenId: string,
): Promise<{ request: RedemptionRequest; actor: RedemptionActor } | null> {
  const entries = await listAuditLogs(db, environmentId, {
    resourceType: 'connect-share-token',
    resourceId: shareTokenId,
  });
  const entry = entries.find(({ action }) => action === REDEEM_REQUESTED_ACTION);
  const request = (entry?.metadata as { request?: RedemptionRequest } | undefined)?.request;
  if (entry === undefined || request === undefined) {
    return null;
  }
  const actor: RedemptionActor =
    entry.actorType === 'api_key' && entry.actorId !== null
      ? { type: 'api-key', id: entry.actorId }
      : entry.actorType === 'user' && entry.actorId !== null
        ? { type: 'user', id: entry.actorId }
        : entry.actorType === 'workflow_run' && entry.actorId !== null
          ? { type: 'workflow-run', id: entry.actorId }
          : null;
  return { request, actor };
}

/** What a finished transaction leaves: its events, and the objects to delete if it rolled back. */
interface Settled {
  result: ConnectRedeemResult;
  staged: StagedEvent[];
}

const sumOf = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);

/** Re-checks of C234.2 on the read, in order; `null` when the redemption may copy. */
function recheck(
  read: RedemptionRead,
  destinationRecord: Awaited<ReturnType<typeof lockConsentRecord>>,
  now: Date,
): RedemptionFailure | null {
  if (read.source === null) {
    return new RedemptionFailure('source_not_found');
  }
  if (read.source.loaded.redacted) {
    return new RedemptionFailure('source_redacted');
  }
  if (sourceIsCopy(read.source.loaded.content)) {
    return new RedemptionFailure('source_is_copy');
  }
  if (read.connectionStatus !== 'active') {
    return new RedemptionFailure('connection_inactive');
  }
  for (const record of [read.sourceConsent, destinationRecord]) {
    if (record?.withdrawnAt !== null || record.redactedAt !== null) {
      return new RedemptionFailure('consent_withdrawn');
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      return new RedemptionFailure('consent_expired');
    }
    const carriesBiometric = read.token.dataCategories.includes('biometric');
    if (
      !read.token.dataCategories.every((category) => record.dataCategories.includes(category)) ||
      (carriesBiometric && !record.explicitBiometric)
    ) {
      return new RedemptionFailure('consent_scope_exceeded');
    }
  }
  return null;
}

/** C234.2 (H04) and C234.9 on the content about to be copied. */
function checkShared(read: RedemptionRead, shared: SharedContent | null): RedemptionFailure | null {
  if (shared === null) {
    return new RedemptionFailure('source_not_found');
  }
  if (
    !shareCategoriesOf(shared).every((category) => read.token.dataCategories.includes(category))
  ) {
    return new RedemptionFailure('consent_scope_exceeded');
  }
  const verifications =
    shared.type === 'inquiry'
      ? shared.verifications
      : shared.type === 'verification'
        ? [shared.verification]
        : [];
  const files = verifications.flatMap((verification) => verification.files);
  const material = read.source?.material.verifications;
  const bytes = sumOf(
    verifications.flatMap((verification) =>
      (material?.get(verification.id)?.files ?? [])
        .filter((file) => verification.files.some(({ id }) => id === file.id))
        .map((file) => file.byteSize),
    ),
  );
  if (
    verifications.length > REDEMPTION_LIMITS.verifications ||
    files.length > REDEMPTION_LIMITS.files ||
    bytes > REDEMPTION_LIMITS.fileBytes
  ) {
    return new RedemptionFailure('import_failed');
  }
  return null;
}

/** Ends a pending token `failed` with `reason`, both sides told; a final token is left alone. */
async function failInTx(
  tx: Db,
  deps: ConnectRedeemDeps,
  events: TransactionalEventPublisher,
  caller: CrossTenantCaller,
  shareTokenId: string,
  reason: string,
  now: Date,
): Promise<Settled> {
  const port = deps.crossTenant ?? redemptionCrossTenant;
  const token = await port.lockInboundShareToken(tx, caller, shareTokenId);
  if (token.status !== 'pending') {
    return { result: { outcome: 'skipped' }, staged: [] };
  }
  const failed = await port.markInboundShareToken(tx, caller, token, {
    status: 'failed',
    failedAt: now,
    failureReason: reason as ConnectShareToken['failureReason'],
    updatedAt: now,
  });
  const staged = await stageTokenChange(
    { events, audit: deps.api?.audit ?? createAuditLogger() },
    tx,
    { kind: 'system', sourceOrganizationId: await organizationOf(tx, token.environmentId) },
    failed,
    {
      source: 'connect/share-token.failed',
      destination: 'connect/share-token.failed',
      audit: 'failed',
      sourceOrganizationId: await organizationOf(tx, token.environmentId),
      destinationOrganizationId: caller.organizationId,
    },
  );
  return { result: { outcome: 'failed', failureReason: reason }, staged };
}

async function organizationOf(db: Db, environmentId: string): Promise<string> {
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    throw new Error('a share token names an environment that is gone');
  }
  return environment.organizationId;
}

/** The redemption's transaction (see the header); a {@link RedemptionFailure} ends it failed. */
async function redeemInTx(
  tx: Db,
  deps: ConnectRedeemDeps,
  events: TransactionalEventPublisher,
  caller: CrossTenantCaller,
  job: ConnectRedeemJob,
  storageKeys: string[],
): Promise<Settled> {
  const now = deps.clock.now();
  const port = deps.crossTenant ?? redemptionCrossTenant;
  const asked = await requestOf(tx, job.environmentId, job.shareTokenId);
  if (asked === null) {
    throw new RedemptionFailure('unrecoverable_error');
  }
  const destinationRecord = await lockConsentRecord(
    tx,
    job.environmentId,
    asked.request['destination-consent-record-id'],
    'share',
  );
  const seen = await port.getInboundShareToken(tx, caller, job.shareTokenId);
  if (seen.status !== 'pending') {
    return { result: { outcome: 'skipped' }, staged: [] };
  }
  const read = await port.readRedemptionSource(tx, caller, seen);
  if (read.token.status !== 'pending') {
    return { result: { outcome: 'skipped' }, staged: [] };
  }
  const refused = recheck(read, destinationRecord, now);
  if (refused !== null) {
    throw refused;
  }
  const policy: SharePolicy = storedSharePolicySchema.parse(read.policy.body);
  const shared = read.source === null ? null : shareableContent(policy, read.source.loaded.content);
  const limited = checkShared(read, shared);
  if (limited !== null) {
    throw limited;
  }
  if (shared === null) {
    throw new RedemptionFailure('source_not_found');
  }
  const sourceOrganizationId = await organizationOf(tx, read.token.environmentId);
  const copy = await copyRedemptionInTx(
    {
      tx,
      deps,
      events,
      ids: deps.ids ?? ulidIdGenerator,
      now,
      environmentId: job.environmentId,
      organizationId: caller.organizationId,
      environmentKind: caller.environmentKind,
      actor: asked.actor,
      storageKeys,
    },
    {
      token: read.token,
      request: asked.request,
      policy,
      shared,
      read,
      provenanceOf: (object) =>
        cloneProvenance({
          shareTokenId: read.token.id,
          sourceOrganizationName: read.sourceOrganizationName,
          sourceEnvironmentKind: read.token.environmentKind,
          sourceCreatedAt: object.createdAt,
          sourceStatus: object.status,
          clonedAt: now,
        }) as unknown as Record<string, unknown>,
    },
  );
  const summary: RedeemSummary = {
    'policy-version': read.policy.version,
    verifications: copy.counts.verifications,
    checks: copy.counts.checks,
    files: copy.counts.files,
    fields: copy.fields.written.length,
    'dropped-fields': copy.fields.dropped,
    'peek-count': read.token.peekCount,
  };
  const redeemed = await port.markInboundShareToken(tx, caller, read.token, {
    status: 'redeemed',
    redeemedAt: now,
    destinationType: copy.destination.type,
    destinationId: copy.destination.id,
    redeemSummary: summary,
    updatedAt: now,
  });
  // C236.10: the destination record follows the copy; the token id stays on it as a plain string.
  await setConsentRecordSubject(
    tx,
    job.environmentId,
    asked.request['destination-consent-record-id'],
    {
      type: copy.destination.type,
      id: copy.destination.id,
    },
  );
  const staged = [
    ...copy.staged,
    ...(await stageTokenChange(
      { events, audit: deps.api?.audit ?? createAuditLogger() },
      tx,
      { kind: 'system', sourceOrganizationId },
      redeemed,
      {
        source: 'connect/share-token.outbound-redeemed',
        destination: 'connect/share-token.inbound-redeemed',
        audit: 'redeemed',
        sourceOrganizationId,
        destinationOrganizationId: caller.organizationId,
      },
    )),
  ];
  return { result: { outcome: 'redeemed' }, staged };
}

/** C234.2: the job (see the header). */
export const processConnectRedeem: ProcessConnectRedeem = async (job, deps) => {
  const events = deps.events ?? deps.api?.events;
  if (events === undefined) {
    throw new Error('connect-redeem needs the event publisher (the worker passes none yet)');
  }
  const environment = await getEnvironment(deps.db, job.environmentId);
  if (environment === null) {
    return { outcome: 'skipped' };
  }
  const caller: CrossTenantCaller = {
    organizationId: environment.organizationId,
    environmentId: environment.id,
    environmentKind: environment.kind,
  };
  let reason: string | null = null;
  for (let attempt = 0; attempt <= REDEEM_TRANSIENT_RETRIES; attempt += 1) {
    const storageKeys: string[] = [];
    try {
      const settled = await deps.db.transaction((tx) =>
        redeemInTx(tx, deps, events, caller, job, storageKeys),
      );
      await events.dispatch(settled.staged);
      if (settled.result.outcome === 'redeemed') {
        deps.logger.info({ shareTokenId: job.shareTokenId }, 'share token redeemed');
      }
      return settled.result;
    } catch (error) {
      await Promise.all(storageKeys.map((key) => deps.storage.delete(key).catch(() => undefined)));
      if (error instanceof RedemptionFailure) {
        reason = error.reason;
        break;
      }
      if (isTransient(error) && attempt < REDEEM_TRANSIENT_RETRIES) {
        continue;
      }
      deps.logger.error(
        { shareTokenId: job.shareTokenId, error: (error as Error).name },
        'share token redemption failed',
      );
      reason = 'unrecoverable_error';
      break;
    }
  }
  const failed = await deps.db.transaction((tx) =>
    failInTx(
      tx,
      deps,
      events,
      caller,
      job.shareTokenId,
      reason ?? 'unrecoverable_error',
      deps.clock.now(),
    ),
  );
  await events.dispatch(failed.staged);
  return failed.result;
};
