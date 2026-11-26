/**
 * C234.3-C234.6, C234.9, C234.11, C235.4 (Workflow 11A, `api-redeem`): the destination's copy of a
 * redemption, in the job's transaction, by the request's mode:
 *
 * - **clone of an inquiry:** a new inquiry under the requested template version (or the template's
 *   current one), its account by `account-id`, by `auto-create-account-reference-id` (found or
 *   created) or a new one; its fields the share's, matched by name (and `field-mappings`) to the
 *   version's declared fields, the others dropped and listed; its `provenance`; each shareable
 *   verification cloned onto it (`clone.ts`). It is made with the repository, never with
 *   `transitionInquiryInTx`, so no signal computation, list screening or graph index row is queued
 *   for it (Stage 1a amendment 17); its events (`inquiry.created`, `.started` and the outcome's) are
 *   staged here, each carrying `provenance` (C235.7(a)). Its status follows C235.4: with
 *   `accept-cloned-results` off, or a fresh listed cloned failure, it goes to review; otherwise the
 *   destination's rules decide with the counted clones (`decideInquiryOutcome`), and it stays
 *   `pending` while they ask for more.
 * - **clone of a verification:** cloned onto the open inquiry the request names; an inquiry that is
 *   no longer open ends `import_failed`.
 * - **hydrate:** `hydrate.ts` into the destination account, inquiry or transaction.
 * - **fill-inquiry** (C234.11): the reserved inquiry's fields hydrated (its `connect-hydrate`
 *   provenance) and every shareable verification cloned onto it; with `accept-cloned-results` off a
 *   clone neither satisfies nor fails a step, and the inquiry does not move.
 */
import { transitionInquiry, type InquiryStatus } from '@openverify/core';
import {
  createInquiry,
  getInquiry,
  getInquiryTemplate,
  getInquiryTemplateVersion,
  inquiries,
  listInquiryVerifications,
  lockInquiry,
  transitionInquiryStatus,
  type ConnectShareToken,
  type Db,
} from '@openverify/db';
import type { AuditActor, SharePolicy } from '@openverify/contracts';
import {
  resolveHydrateMappings,
  type SharedContent,
  type SharedVerification,
} from '@openverify/core';
import { and, eq } from 'drizzle-orm';
import { UNMASKED } from '../../auth/pii.js';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { requiredVerificationsForInquiry } from '../../flow-engine/required.js';
import type { IdGenerator } from '../../ports.js';
import {
  cloneVerificationsInTx,
  emptyCloneCounts,
  type CloneCounts,
} from '../../services/connect/clone.js';
import {
  clonedInquiryReview,
  countedVerifications,
} from '../../services/connect/cloned-results.js';
import {
  HydrateImportFailedError,
  hydrateInTx,
  type HydrateTarget,
} from '../../services/connect/hydrate.js';
import type { RedemptionRead, RedemptionRequest } from '../../services/connect/redeem.js';
import { inquiryResourceOf } from '../../services/inquiries.js';
import { safeStoredFlowView } from '../../services/stored-flow.js';
import { decideInquiryOutcome, isRetryableFailure } from '../inquiry-outcome.js';
import type { ConnectRedeemDeps } from './process.js';

/** C234.9 (provisional, ours; basis: the C10 upload limits): per redemption. */
export const REDEMPTION_LIMITS = Object.freeze({
  verifications: 50,
  files: 200,
  fileBytes: 512 * 1024 * 1024,
});

/** A failure the token ends with (`SHARE_TOKEN_FAILURE_REASON_VALUES`). */
export class RedemptionFailure extends Error {
  readonly reason: NonNullable<ConnectShareToken['failureReason']>;

  constructor(reason: NonNullable<ConnectShareToken['failureReason']>) {
    super(`redemption failed: ${reason}`);
    this.name = 'RedemptionFailure';
    this.reason = reason;
  }
}

/** Who asked for the redemption: a principal, or `null` for the flow's client-side redemption. */
export type RedemptionActor = AuditActor | null;

export interface CopyContext {
  tx: Db;
  deps: ConnectRedeemDeps;
  events: TransactionalEventPublisher;
  ids: IdGenerator;
  now: Date;
  environmentId: string;
  organizationId: string;
  environmentKind: 'sandbox' | 'production';
  actor: RedemptionActor;
  /** Objects put in storage, to delete when the transaction rolls back. */
  storageKeys: string[];
}

export interface CopyInput {
  token: ConnectShareToken;
  request: RedemptionRequest;
  policy: SharePolicy;
  shared: SharedContent;
  read: RedemptionRead;
  provenanceOf: (object: { createdAt: Date; status: string }) => Record<string, unknown>;
}

export interface CopyOutcome {
  destination: { type: 'inquiry' | 'account' | 'transaction'; id: string };
  counts: CloneCounts;
  fields: { written: string[]; dropped: string[] };
  staged: StagedEvent[];
}

const sharedVerificationsOf = (shared: SharedContent): readonly SharedVerification[] =>
  shared.type === 'inquiry'
    ? shared.verifications
    : shared.type === 'verification'
      ? [shared.verification]
      : [];

async function cloneOnto(
  context: CopyContext,
  input: CopyInput,
  inquiryId: string,
): Promise<CloneCounts> {
  const material = input.read.source?.material.verifications ?? new Map();
  const counts = await cloneVerificationsInTx(
    {
      tx: context.tx,
      environmentId: context.environmentId,
      storage: context.deps.storage,
      keyring: context.deps.keyring,
      ids: context.ids,
      provenanceOf: input.provenanceOf,
      extractedData: input.policy.verifications['extracted-data'],
    },
    inquiryId,
    sharedVerificationsOf(input.shared),
    material,
  );
  context.storageKeys.push(...counts.storageKeys);
  return counts;
}

/** Stages one inquiry event about a copy, with its provenance (C235.7(a)). */
async function stageInquiryEvent(
  context: CopyContext,
  inquiryId: string,
  name: string,
  meta?: Record<string, unknown>,
): Promise<StagedEvent> {
  const inquiry = await getInquiry(context.tx, context.environmentId, inquiryId);
  if (inquiry === null) {
    throw new Error('a cloned inquiry is gone within its redemption');
  }
  const resource = await inquiryResourceOf(context.tx, context.environmentId, inquiry, UNMASKED);
  return context.events.stage(context.tx, {
    environmentId: context.environmentId,
    name: name as never,
    payload: { data: resource, ...(meta === undefined ? {} : { meta }) },
  });
}

/** Moves a cloned inquiry along the state machine, staging each move's events. */
async function moveInquiry(
  context: CopyContext,
  inquiryId: string,
  path: readonly InquiryStatus[],
): Promise<StagedEvent[]> {
  const staged: StagedEvent[] = [];
  for (const [index, to] of path.entries()) {
    const from = path[index - 1];
    if (from === undefined) {
      continue;
    }
    const name = transitionInquiry(from, to);
    const moved = await transitionInquiryStatus(context.tx, context.environmentId, inquiryId, {
      from,
      to,
      at: context.now,
    });
    if (moved === null) {
      throw new Error('a cloned inquiry changed within its redemption');
    }
    staged.push(await stageInquiryEvent(context, inquiryId, name));
    staged.push(await stageInquiryEvent(context, inquiryId, 'inquiry.transitioned', { from, to }));
  }
  return staged;
}

/** C235.4: the status a cloned inquiry ends its redemption in, with the events of the moves. */
async function settleClone(context: CopyContext, inquiryId: string): Promise<StagedEvent[]> {
  const inquiry = await getInquiry(context.tx, context.environmentId, inquiryId);
  if (inquiry === null) {
    throw new Error('a cloned inquiry is gone within its redemption');
  }
  const staged = await moveInquiry(context, inquiryId, ['created', 'pending']);
  const review = await clonedInquiryReview(context.tx, inquiry, context.now);
  if (review === null || review.status === 'needs_review') {
    return [
      ...staged,
      ...(await moveInquiry(context, inquiryId, ['pending', 'completed', 'needs_review'])),
    ];
  }
  const version = await getInquiryTemplateVersion(
    context.tx,
    context.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const flow = safeStoredFlowView(version?.flow);
  if (flow === null) {
    return staged;
  }
  const verifications = await countedVerifications(
    context.tx,
    inquiry,
    await listInquiryVerifications(context.tx, context.environmentId, inquiryId),
    context.now,
  );
  const outcome = decideInquiryOutcome(
    await requiredVerificationsForInquiry(context.tx, inquiry, flow),
    verifications.map((verification) => ({
      id: verification.id,
      type: verification.type,
      status: verification.status,
      retryable: isRetryableFailure(verification.checks),
      sourceVerificationId: null,
    })),
  );
  switch (outcome) {
    case null:
      return staged;
    case 'failed':
      // A cloned failure never fails the inquiry by itself (C235.4): review.
      return [
        ...staged,
        ...(await moveInquiry(context, inquiryId, ['pending', 'completed', 'needs_review'])),
      ];
    case 'needs_review':
      return [
        ...staged,
        ...(await moveInquiry(context, inquiryId, ['pending', 'completed', 'needs_review'])),
      ];
    case 'completed':
      return [...staged, ...(await moveInquiry(context, inquiryId, ['pending', 'completed']))];
  }
}

/** The share's fields matched to the version's declared fields (`resolveHydrateMappings`). */
async function clonedFieldsOf(
  context: CopyContext,
  input: CopyInput,
  versionId: string,
): Promise<{ fields: Record<string, unknown>; written: string[]; dropped: string[] }> {
  if (input.shared.type !== 'inquiry') {
    return { fields: {}, written: [], dropped: [] };
  }
  const version = await getInquiryTemplateVersion(context.tx, context.environmentId, versionId);
  const schemas = Array.isArray(version?.fieldSchemas) ? version.fieldSchemas : [];
  const resolution = resolveHydrateMappings({
    allowlist: input.policy.fields.inquiry,
    source: input.shared.object.fields.map(({ key, type, value }) => ({ key, type, value })),
    destination: schemas.flatMap((schema) => {
      const { key, type } = (schema ?? {}) as { key?: unknown; type?: unknown };
      return typeof key === 'string' && typeof type === 'string'
        ? [{ name: key, type: type as never, writeOnce: false, filled: false }]
        : [];
    }),
    mappings: input.request['field-mappings'],
  });
  if (resolution.failures.length > 0) {
    throw new RedemptionFailure('import_failed');
  }
  return {
    fields: Object.fromEntries(
      resolution.writes.map((write) => [write.destinationName, write.value]),
    ),
    written: resolution.writes.map(({ destinationName }) => destinationName),
    dropped: [...resolution.dropped],
  };
}

/** C234.3: a new inquiry under the requested template version, a clone of the source's. */
async function cloneInquiry(context: CopyContext, input: CopyInput): Promise<CopyOutcome> {
  const { tx, environmentId } = context;
  const { request } = input;
  const template = await getInquiryTemplate(
    tx,
    environmentId,
    request['inquiry-template-id'] ?? '',
  );
  if (template === null || template.status === 'archived') {
    throw new RedemptionFailure('import_failed');
  }
  const versionId = request['inquiry-template-version-id'] ?? template.currentVersion.id;
  const fields = await clonedFieldsOf(context, input, versionId);
  const id = context.ids.newId('inq');
  await createInquiry(tx, environmentId, {
    id,
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: versionId,
    ...(request['account-id'] === null ? {} : { accountId: request['account-id'] }),
    ...(request['auto-create-account-reference-id'] === null
      ? {}
      : { referenceId: request['auto-create-account-reference-id'] }),
    fields: fields.fields,
  });
  const source = input.shared.type === 'inquiry' ? input.shared.object : null;
  const createdAt = source?.base['created-at'];
  const sourceStatus = source?.base.status;
  await tx
    .update(inquiries)
    .set({
      provenance: input.provenanceOf({
        createdAt: typeof createdAt === 'string' ? new Date(createdAt) : context.now,
        status: typeof sourceStatus === 'string' ? sourceStatus : 'completed',
      }) as never,
    })
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, id)));
  const staged = [await stageInquiryEvent(context, id, 'inquiry.created')];
  const counts = await cloneOnto(context, input, id);
  staged.push(...(await settleClone(context, id)));
  return {
    destination: { type: 'inquiry', id },
    counts,
    fields: { written: fields.written, dropped: fields.dropped },
    staged,
  };
}

/** C234.4: a clone of a verification onto the open inquiry the request names. */
async function cloneVerification(context: CopyContext, input: CopyInput): Promise<CopyOutcome> {
  const inquiryId = input.request['inquiry-id'] ?? '';
  const status = await lockInquiry(context.tx, context.environmentId, inquiryId);
  if (status !== 'created' && status !== 'pending') {
    throw new RedemptionFailure('import_failed');
  }
  const counts = await cloneOnto(context, input, inquiryId);
  return {
    destination: { type: 'inquiry', id: inquiryId },
    counts,
    fields: { written: [], dropped: [] },
    staged: [],
  };
}

/** C234.5, C234.11: a hydrate into the target, as the request's principal. */
async function hydrate(
  context: CopyContext,
  input: CopyInput,
  target: HydrateTarget,
): Promise<{ written: string[]; dropped: string[]; staged: StagedEvent[] }> {
  if (input.shared.type === 'verification') {
    return { written: [], dropped: [], staged: [] };
  }
  const api = context.deps.api;
  if (api === undefined || context.actor === null) {
    throw new RedemptionFailure('unrecoverable_error');
  }
  const staged: StagedEvent[] = [];
  try {
    const outcome = await hydrateInTx(
      {
        tx: context.tx,
        deps: api,
        acting: {
          ctx: { organizationId: context.organizationId, environmentId: context.environmentId },
          actor: context.actor,
          mask: UNMASKED,
          environmentKind: context.environmentKind,
        },
        staged,
        shareTokenId: input.token.id,
        sourceOrganizationName: input.read.sourceOrganizationName,
        now: context.now,
      },
      target,
      {
        allowlist: input.policy.fields[input.shared.type],
        fields: input.shared.object.fields,
        mappings: input.request['field-mappings'],
      },
    );
    return { ...outcome, staged };
  } catch (error) {
    if (error instanceof HydrateImportFailedError) {
      throw new RedemptionFailure('import_failed');
    }
    throw error;
  }
}

/** The copy of a redemption by its mode (see the header). */
export async function copyRedemptionInTx(
  context: CopyContext,
  input: CopyInput,
): Promise<CopyOutcome> {
  const { request, token } = input;
  switch (request.mode) {
    case 'clone':
      return token.sourceType === 'verification'
        ? cloneVerification(context, input)
        : cloneInquiry(context, input);
    case 'hydrate': {
      const target: HydrateTarget = {
        type: request['destination-type'] ?? 'inquiry',
        id: request['destination-id'] ?? '',
      };
      const fields = await hydrate(context, input, target);
      return {
        destination: target,
        counts: emptyCloneCounts(),
        fields: { written: fields.written, dropped: fields.dropped },
        staged: fields.staged,
      };
    }
    case 'fill-inquiry': {
      const inquiryId = request['destination-id'] ?? '';
      const status = await lockInquiry(context.tx, context.environmentId, inquiryId);
      if (status !== 'created' && status !== 'pending') {
        throw new RedemptionFailure('import_failed');
      }
      const fields =
        context.actor === null
          ? { written: [], dropped: [], staged: [] }
          : await hydrate(context, input, { type: 'inquiry', id: inquiryId });
      const counts = await cloneOnto(context, input, inquiryId);
      return {
        destination: { type: 'inquiry', id: inquiryId },
        counts,
        fields: { written: fields.written, dropped: fields.dropped },
        staged: fields.staged,
      };
    }
  }
}
