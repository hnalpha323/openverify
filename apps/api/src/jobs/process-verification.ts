/**
 * The `process-verification` job (contract C7):
 *
 * 1. load the submitted verification, its inquiry and the inquiry's template version;
 * 2. decrypt the files (`FileStorage` + `decryptBytes`, the file id as context) and check
 *    them against their stored SHA-256;
 * 3. call vision; for a government ID, build the C31 extraction, look up its history and
 *    references and ask the bound providers (`government-id.ts`); for a selfie whose template
 *    compares faces, also re-embed the front of the inquiry's latest passed, submitted or
 *    needs_review government ID with `/v1/embed/face`, because embeddings are never stored;
 * 4. evaluate the checks the template enables and decide the verification (C30); thresholds the
 *    pinned version configures on a check (C11) are applied to vision's raw scores, and a check
 *    without `config` keeps vision's defaults;
 * 5. store the checks, the status and a government ID's extraction (encrypted fields, blind
 *    index, pHash; its country and class where the user chose none), and publish
 *    `verification.passed` or `.failed` (`needs_review`, C30.4, publishes no verification event);
 *    a type whose evaluation asks for a skip (`TypeEvaluation.skip`, only AAMVA outside DLDV,
 *    C50.7, C59.5) moves it `submitted -> skipped` instead, with `verification.skipped`;
 * 6. move the inquiry to `completed` or `failed` once the flow's verifications allow it
 *    (`decideInquiryOutcome`), publishing `inquiry.completed` or `inquiry.failed`; with a
 *    verification under review, `completed` then `needs_review` in one transaction, publishing
 *    `inquiry.completed` then `inquiry.marked-for-review` (C30.5).
 *
 * When vision cannot read an uploaded image (413, 415 or 422), the image quality checks fail
 * with `image_unreadable` (`unreadableImageChecks`): a decided, retryable failure the user can
 * fix with a new photo. A vision or provider failure is retried while attempts remain; on the
 * last attempt (`{ lastAttempt }`), and at once for a vision answer that breaks the contract, it
 * is recorded on the checks that needed it (C30.3, `attempts.ts`). When processing cannot finish
 * for another reason (a permanent job failure, or the last attempt of another transient one),
 * the worker calls `failVerificationAfterError`, so no verification stays `submitted` for good.
 *
 * Every status change goes through the C10 state machines: verifications with
 * `moveVerification`, the inquiry with `transitionInquiryInTx`, which also stages
 * `inquiry.transitioned` and cancels the inquiry's active sessions once it is decided.
 *
 * Status changes and their events are written in one transaction; webhook jobs are enqueued
 * after it commits. Step 6 runs in its own transaction after step 5 has committed, so of two
 * verifications finishing at the same time at least one sees the other's result, and the
 * conditional status update lets only one of them move the inquiry. Step 6 is idempotent and
 * also runs when the job finds its verification already processed, which repairs a crash
 * between the two steps on retry.
 *
 * Decrypted images are wiped after the vision call. Neither images nor embeddings are
 * stored or logged; check metadata holds scores only.
 */
import {
  checkRequirementFor,
  toApiVerificationType,
  verificationConfigSchema,
  verificationStatusForDecision,
  type VerificationConfig,
} from '@openverify/contracts';
import {
  DomainError,
  decideVerification,
  type InquiryStatus,
  type VerificationEventName,
} from '@openverify/core';
import {
  getEnvironment,
  getInquiry,
  getInquiryTemplateVersion,
  getVerification,
  listVerificationFiles,
  lockInquiry,
  replaceVerificationChecks,
  type Db,
  type Inquiry,
  type Keyring,
} from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import { safeStoredFlowView } from '../services/stored-flow.js';
import { ZodError } from 'zod';
import { requestRenditionsForFiles } from '../services/cases/attachments/renditions.js';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import type { OutboundHttp } from '../http/index.js';
import type {
  CaseRenditionQueue,
  Clock,
  CompromisedIdLookup,
  DnsResolver,
  EnvironmentKind,
  FileStorage,
  KeyValueCache,
  ProcessVerificationJob,
  ProviderBindings,
  RateLimiter,
  VerificationQueue,
  FlowSignalSnapshotQueue,
  VisionClient,
} from '../ports.js';
import { advanceFlowInTx, NO_FLOW_ADVANCE, runFlowAfterCommit } from '../flow-engine/advance.js';
import { settleInquiry } from '../services/inquiry-settlement.js';
import { isInquiryRedacted } from '../services/redaction.js';
import { moveVerification, stageVerificationEvent } from '../services/verifications.js';
import { VisionError } from '../vision/index.js';
import { PermanentJobError } from './errors.js';
import type { WorkerLogger } from './logger.js';
import {
  VERIFICATION_TYPE_JOBS,
  verificationTypeJob,
  type DecidedStatus,
  type InquiryDecisionHookResult,
  type TypeEvaluationJob,
} from './types/index.js';

export { PermanentJobError } from './errors.js';

export interface ProcessVerificationDeps {
  db: Db;
  storage: FileStorage;
  /** Unwraps the files' data keys. */
  keyring: Keyring;
  vision: VisionClient;
  events: TransactionalEventPublisher;
  clock: Clock;
  logger: WorkerLogger;
  /** Face match threshold; defaults to `FACE_MATCH_DEFAULTS.threshold` (C39.3). */
  faceMatchThreshold?: number;
  /** C31.8 key of the identification-number blind index (`OPENVERIFY_BLIND_INDEX_KEY`). */
  blindIndexKey?: Uint8Array | undefined;
  /** C35 providers per environment kind; none bound when omitted. */
  providers?: ProviderBindings | undefined;
  /** C99.9 (Workflow 7B): the lookup of `id_compromised_detection`. */
  compromisedIds?: CompromisedIdLookup | undefined;
  /** C54.3: the Phase 5 caches in Valkey (MX answers, registry records, RDAP dates, feeds). */
  cache?: KeyValueCache | undefined;
  /** C54.6: the outbound HTTP client factory (the EVM RPC, registries, RDAP, feeds). */
  outboundHttp?: OutboundHttp | undefined;
  /** C54.3, C56, C61.3: the MX and website lookups. */
  dnsResolver?: DnsResolver | undefined;
  /** C54.3: the GCRA limiter in Valkey, for the install-wide provider limits (C61.2). */
  rateLimiter?: RateLimiter | undefined;
  /** C59.6: enqueues the job of a verification a decision hook created after its commit. */
  queue?: VerificationQueue | undefined;
  /**
   * C150.9 (Workflow 9A Stage 1b (S)): the `flow-signal-snapshot` producer, through which the flow
   * engine asks, after the decision's commit, for the snapshot of a branch the decision entered.
   */
  flowSignalSnapshots?: FlowSignalSnapshotQueue | undefined;
  /**
   * C135.3 (Workflow 8B (F), V27): the `case-rendition` producer, through which the job asks for its
   * files' renditions after its commit; none are asked for without it, and the first view makes one.
   */
  renditions?: CaseRenditionQueue | undefined;
}

/** How this attempt of the job runs (C30.3). */
export interface ProcessVerificationOptions {
  /**
   * BullMQ will not retry this attempt: a vision or provider failure is then recorded on the
   * checks that need it (`execution_error`) instead of being thrown for a retry.
   */
  lastAttempt?: boolean | undefined;
}

export type ProcessVerificationResult =
  | { outcome: 'skipped'; reason: 'not_found' }
  | { outcome: 'skipped'; reason: 'not_submitted'; inquiryStatus: InquiryStatus }
  | {
      outcome: 'processed';
      /** `skipped` when the type's evaluation asked for it (C50.7, C59.5). */
      verificationStatus: DecidedStatus;
      inquiryStatus: InquiryStatus;
    };

export type FailVerificationResult =
  | { outcome: 'skipped'; reason: 'not_found' }
  | { outcome: 'skipped'; reason: 'not_submitted'; inquiryStatus: InquiryStatus }
  | { outcome: 'failed'; inquiryStatus: InquiryStatus };

/**
 * Whether retrying the job cannot help: a permanent job error, a vision response that is
 * not retryable, a domain rule (invalid configuration, malformed embedding) or data that
 * does not satisfy a contract. Anything else (outages, database errors) is retried.
 */
export function isPermanentJobFailure(error: unknown): error is Error {
  return (
    error instanceof PermanentJobError ||
    (error instanceof VisionError && !error.retryable) ||
    error instanceof DomainError ||
    error instanceof ZodError
  );
}

interface Template {
  flow: Flow;
  config: VerificationConfig;
}

async function loadTemplate(db: Db, environmentId: string, inquiry: Inquiry): Promise<Template> {
  const version = await getInquiryTemplateVersion(
    db,
    environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  // Workflow 9A Stage 1b (S): either flow-spec version, read through the v1 view.
  const flow = safeStoredFlowView(version?.flow);
  const config = verificationConfigSchema.safeParse(version?.verificationConfig);
  if (flow === null || !config.success) {
    throw new PermanentJobError('invalid_template');
  }
  return { flow, config: config.data };
}

/** The kind of the verification's environment (C30.7, C35). */
async function environmentKindOf(db: Db, environmentId: string): Promise<EnvironmentKind> {
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    throw new PermanentJobError('unsupported_verification');
  }
  return environment.kind;
}

/**
 * C59.6: runs every type's `onInquiryVerificationDecided` hook in the decision transaction of
 * `decided` (read back with its new status and checks), and gathers what they staged and want
 * enqueued.
 */
async function runDecisionHooks(
  tx: Db,
  deps: ProcessVerificationDeps,
  context: {
    environmentId: string;
    inquiry: Inquiry;
    inquiryStatus: InquiryStatus | null;
    flow: Flow;
  },
  verificationId: string,
): Promise<InquiryDecisionHookResult> {
  const result: InquiryDecisionHookResult = { staged: [], enqueue: [] };
  const decided = await getVerification(tx, context.environmentId, verificationId);
  if (decided === null) {
    return result;
  }
  for (const typeJob of Object.values(VERIFICATION_TYPE_JOBS)) {
    const hooked = await typeJob.onInquiryVerificationDecided?.(tx, {
      deps,
      ...context,
      decided,
      now: deps.clock.now(),
    });
    result.staged.push(...(hooked?.staged ?? []));
    result.enqueue.push(...(hooked?.enqueue ?? []));
    if (hooked?.flowAfter !== undefined) {
      (result.flowAfter ??= []).push(...hooked.flowAfter);
    }
  }
  return result;
}

/**
 * Dispatches a committed decision's events, then enqueues the verifications its hooks created.
 * A failed enqueue is logged with ids only: the decision stands, and the created verification
 * waits in `submitted` until the repair sweep enqueues it again, two minutes after its
 * submission (Workflow 5C review K1, `jobs/repeatable/submitted-verifications.ts`).
 */
async function afterDecision(
  deps: ProcessVerificationDeps,
  hooked: InquiryDecisionHookResult,
): Promise<void> {
  await deps.events.dispatch(hooked.staged);
  await runFlowAfterCommit({ staged: [], after: hooked.flowAfter ?? [] });
  for (const job of hooked.enqueue) {
    try {
      if (deps.queue === undefined) {
        throw new Error('no verification queue is configured');
      }
      await deps.queue.enqueueProcessVerification(job);
    } catch (error) {
      deps.logger.error(
        { verificationId: job.verificationId, error: (error as Error).name },
        'verification a decision hook created was not enqueued',
      );
    }
  }
}

/**
 * The type's configuration in the pinned version.
 * @throws {PermanentJobError} `invalid_template` when the version configures no such type.
 */
function typeConfigOf(
  template: Template,
  verification: { type: Parameters<typeof toApiVerificationType>[0] },
) {
  const config = template.config[toApiVerificationType(verification.type)];
  if (config === undefined) {
    throw new PermanentJobError('invalid_template');
  }
  return config;
}

/**
 * Processes one submitted verification through its type's hooks (`jobs/types/`, C54.1).
 * @throws {PermanentJobError} (and other {@link isPermanentJobFailure} errors) when retrying
 * cannot help; any other error is transient. Either way nothing has been changed.
 */
export async function processVerification(
  job: ProcessVerificationJob,
  deps: ProcessVerificationDeps,
  options: ProcessVerificationOptions = {},
): Promise<ProcessVerificationResult> {
  const { db, logger } = deps;
  const { environmentId, verificationId } = job;
  const verification = await getVerification(db, environmentId, verificationId);
  if (verification === null) {
    logger.warn({ verificationId }, 'verification not found; nothing to process');
    return { outcome: 'skipped', reason: 'not_found' };
  }
  const { inquiryId, type } = verification;
  const typeJob = verificationTypeJob(type);
  const inquiry = await getInquiry(db, environmentId, inquiryId);
  if (inquiry === null || !typeJob.runnable) {
    throw new PermanentJobError('unsupported_verification');
  }
  const template = await loadTemplate(db, environmentId, inquiry);
  if (verification.status !== 'submitted') {
    const inquiryStatus = await settleInquiry(deps, environmentId, inquiryId, template.flow);
    return { outcome: 'skipped', reason: 'not_submitted', inquiryStatus };
  }

  const files = await listVerificationFiles(db, environmentId, [verificationId]);
  const config = typeConfigOf(template, verification);
  const evaluationJob: TypeEvaluationJob = {
    environmentId,
    environmentKind: await environmentKindOf(db, environmentId),
    inquiry,
    verificationId,
    verification,
    files,
    config,
    flow: template.flow,
    lastAttempt: options.lastAttempt === true,
    now: deps.clock.now(),
  };
  const { results, unreadable, state, skip } = await typeJob.evaluate(deps, evaluationJob);
  const decision = decideVerification(results, config);
  if (unreadable === true && decision.status !== 'failed') {
    // The template requires no image quality check that could fail: nothing to decide on.
    throw new PermanentJobError('image_unreadable');
  }
  // C50.7, C59.5: a type may skip instead of deciding (AAMVA, a jurisdiction outside DLDV).
  const status: DecidedStatus =
    skip === true ? 'skipped' : verificationStatusForDecision(decision.status);
  const now = deps.clock.now();

  const staged = await db.transaction(async (tx) => {
    // The inquiry first, as its C16 redaction locks it (Workflow 3B review, G002): a redaction
    // that committed during the analysis leaves nothing to write, not even the extraction or an
    // event carrying it; one that starts now waits for this commit, then redacts what it wrote.
    // Then the verification, then the type's sub-resources (C40.6).
    const inquiryStatus = await lockInquiry(tx, environmentId, inquiryId);
    if (await isInquiryRedacted(tx, environmentId, inquiryId)) {
      throw new PermanentJobError('inquiry_redacted');
    }
    // An undecided verification stays `submitted`: the API already announced that.
    let name: VerificationEventName | null = null;
    if (status !== 'submitted') {
      const moved = await moveVerification(
        tx,
        { ...verification, status: 'submitted' },
        status,
        now,
      );
      if (moved === null) {
        return null;
      }
      name = moved.event;
    }
    await replaceVerificationChecks(
      tx,
      environmentId,
      verificationId,
      results.map((result) => ({
        name: result.name,
        status: result.status,
        type: result.type,
        requirement: checkRequirementFor(config.checks[result.name]?.required === true),
        reasons: result.reasons,
        metadata: result.metadata,
        stage: result.stage,
        confidence: result.confidence,
        provenance: result.provenance,
      })),
    );
    const persisted = await typeJob.persistInDecisionTx(tx, {
      deps,
      environmentId,
      inquiry,
      inquiryStatus,
      verificationId,
      status,
      results,
      config,
      flow: template.flow,
      files,
      state,
      now,
      async verificationEvent(): Promise<StagedEvent[]> {
        const row = await getVerification(tx, environmentId, verificationId);
        // The files as they are now: a type's decision may have written one (the document's
        // preview, the chip portrait), and the event names what a later read lists.
        const fileIds = (await listVerificationFiles(tx, environmentId, [verificationId])).map(
          (file) => file.id,
        );
        return name === null || row === null
          ? []
          : [await stageVerificationEvent(tx, deps.events, name, row, fileIds)];
      },
    });
    const hooked =
      status === 'submitted'
        ? { staged: [], enqueue: [] }
        : await runDecisionHooks(
            tx,
            deps,
            { environmentId, inquiry, inquiryStatus, flow: template.flow },
            verificationId,
          );
    // C151.2 (Workflow 9A Stage 1b (S)): a decision is the exit of the step it was the attempt of,
    // advanced in this transaction (`advanceFlowInTx`, `api-flow-engine`).
    const advanced =
      status === 'submitted'
        ? NO_FLOW_ADVANCE
        : await advanceFlowInTx(
            tx,
            deps,
            { environmentId, inquiryId },
            {
              kind: 'verification-decided',
              verificationId,
              verificationType: verification.type,
              status,
              origin: 'flow',
            },
          );
    return { persisted, hooked, advanced };
  });
  if (staged === null) {
    // Another job decided this verification first.
    const inquiryStatus = await settleInquiry(deps, environmentId, inquiryId, template.flow);
    return { outcome: 'skipped', reason: 'not_submitted', inquiryStatus };
  }
  await deps.events.dispatch(staged.persisted);
  await afterDecision(deps, staged.hooked);
  await deps.events.dispatch(staged.advanced.staged);
  await runFlowAfterCommit(staged.advanced);
  await typeJob.afterCommit?.({ deps, environmentId, inquiryId, verificationId, status, state });
  // C135.3 (V27, inventory 13.1; `api-case-files`): the renditions of the verification's files,
  // read again because the decision may have written one (a document's preview). A failed request
  // fails nothing: the console's first view makes the rendition.
  await requestRenditionsForFiles(
    { db, renditions: deps.renditions, logger },
    {
      environmentId,
      fileIds: (await listVerificationFiles(db, environmentId, [verificationId])).map(
        (file) => file.id,
      ),
    },
  ).catch((error: unknown) => {
    logger.warn(
      { verificationId, error: (error as Error).name },
      'renditions could not be requested',
    );
  });
  logger.info(
    {
      verificationId,
      inquiryId,
      type,
      status,
      failingChecks: decision.failingCheckIds,
      pendingChecks: decision.pendingCheckIds,
    },
    'verification processed',
  );
  const inquiryStatus =
    status === 'submitted'
      ? inquiry.status
      : await settleInquiry(deps, environmentId, inquiryId, template.flow);
  return { outcome: 'processed', verificationStatus: status, inquiryStatus };
}

/** The inquiry's status after settling it, or as it is when its template cannot be read. */
async function settleIfPossible(
  deps: ProcessVerificationDeps,
  environmentId: string,
  inquiryId: string,
): Promise<InquiryStatus> {
  const inquiry = await getInquiry(deps.db, environmentId, inquiryId);
  if (inquiry === null) {
    throw new PermanentJobError('unsupported_verification');
  }
  let template: Template;
  try {
    template = await loadTemplate(deps.db, environmentId, inquiry);
  } catch (error) {
    if (error instanceof PermanentJobError) {
      return inquiry.status;
    }
    throw error;
  }
  return settleInquiry(deps, environmentId, inquiryId, template.flow);
}

/**
 * Fails a submitted verification whose processing cannot finish: a permanent job failure, or
 * a transient one on the job's last attempt. Nothing enqueues the job again, so without this
 * the verification would stay `submitted` and its inquiry `pending` for good.
 *
 * No check result is written: none was decided, and none is invented. A failure without a
 * failed `user_behavior` check is not retryable (C7), so the inquiry fails with it, and
 * `verification.failed` and `inquiry.failed` are published, then whatever the type's
 * `onProcessingFailed` hook stages (a selfie's capture errors, C40.8). A verification that is no
 * longer `submitted` is left as it is (its inquiry is settled again), so a repeat does nothing.
 * @param cause what went wrong, as an error class or code; it is logged, never stored.
 */
export async function failVerificationAfterError(
  job: ProcessVerificationJob,
  deps: ProcessVerificationDeps,
  cause: string,
): Promise<FailVerificationResult> {
  const { db, events, logger } = deps;
  const { environmentId, verificationId } = job;
  const verification = await getVerification(db, environmentId, verificationId);
  if (verification === null) {
    return { outcome: 'skipped', reason: 'not_found' };
  }
  const { inquiryId } = verification;
  const fileIds = (await listVerificationFiles(db, environmentId, [verificationId])).map(
    (file) => file.id,
  );
  if (verification.status !== 'submitted') {
    const inquiryStatus = await settleIfPossible(deps, environmentId, inquiryId);
    return { outcome: 'skipped', reason: 'not_submitted', inquiryStatus };
  }
  const staged = await db.transaction(async (tx) => {
    // C40.6: the inquiry, then the verification, then its sub-resources. A redacted inquiry still
    // gets its verification failed without data (G002).
    const inquiryStatus = await lockInquiry(tx, environmentId, inquiryId);
    const now = deps.clock.now();
    const moved = await moveVerification(tx, verification, 'failed', now);
    if (moved?.event == null) {
      return null;
    }
    const written = [
      await stageVerificationEvent(
        tx,
        events,
        moved.event,
        { ...moved.verification, checks: verification.checks },
        fileIds,
      ),
    ];
    written.push(
      ...(await verificationTypeJob(verification.type).onProcessingFailed(tx, {
        deps,
        environmentId,
        inquiryId,
        verificationId,
        now,
      })),
    );
    // C59.6: a failed verification is a decision too.
    const inquiry = await getInquiry(tx, environmentId, inquiryId);
    const template =
      inquiry === null ? null : await loadTemplate(tx, environmentId, inquiry).catch(() => null);
    const hooked =
      inquiry === null || template === null
        ? { staged: [], enqueue: [] }
        : await runDecisionHooks(
            tx,
            deps,
            { environmentId, inquiry, inquiryStatus, flow: template.flow },
            verificationId,
          );
    // C151.2 (Workflow 9A Stage 1b (S)): a failure is a decision, so the step's exit too.
    const advanced = await advanceFlowInTx(
      tx,
      deps,
      { environmentId, inquiryId },
      {
        kind: 'verification-decided',
        verificationId,
        verificationType: verification.type,
        status: 'failed',
        origin: 'flow',
      },
    );
    return { written, hooked, advanced };
  });
  if (staged === null) {
    const inquiryStatus = await settleIfPossible(deps, environmentId, inquiryId);
    return { outcome: 'skipped', reason: 'not_submitted', inquiryStatus };
  }
  await events.dispatch(staged.written);
  await afterDecision(deps, staged.hooked);
  await events.dispatch(staged.advanced.staged);
  await runFlowAfterCommit(staged.advanced);
  logger.warn(
    { verificationId, inquiryId, cause },
    'verification failed: its processing cannot finish',
  );
  return {
    outcome: 'failed',
    inquiryStatus: await settleIfPossible(deps, environmentId, inquiryId),
  };
}
