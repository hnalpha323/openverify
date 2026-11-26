/**
 * C54.1: the per-type hooks of the `process-verification` job. `process-verification.ts` calls
 * only these, so each Phase 5 type's builder fills in its own file here and never edits the job:
 *
 * | Hook | When | What |
 * |---|---|---|
 * | `evaluate` | before any write | the type's check results (and whatever its decision hooks need, `state`); `skip` moves the verification to `skipped` instead of deciding it |
 * | `persistInDecisionTx` | in the decision transaction, after the checks are written | the type's own rows; it stages the `verification.*` event (`ctx.verificationEvent()`) where its payload must see them, and returns every event it staged, in order |
 * | `afterCommit` | after that transaction committed and its events were dispatched | work that must not hold the locks (a server file, C54.1) |
 * | `onProcessingFailed` | in the transaction that fails a verification whose processing cannot finish | the type's sub-resources (a selfie's submitted capture errors) |
 * | `onInquiryVerificationDecided` | in the decision transaction of every verification of the inquiry, any type | C59.6: the silent AAMVA attempt a government ID decision creates or skips |
 *
 * Every hook follows the C40.6 lock order: the inquiry is locked and checked unredacted first,
 * then the verification; a hook locks its sub-resources after them. Jobs a hook creates are
 * enqueued only after the commit.
 *
 * `runnable` is false for a type whose job is not built yet: the flow API then refuses to create
 * one (422) and the job refuses to judge one (`unsupported_verification`), so no verification is
 * judged by another type's checks or waits for a job that cannot decide it.
 */
import type { SupportedVerificationType } from '@openverify/contracts';
import type { CheckResult, InquiryStatus, VerificationTemplateConfig } from '@openverify/core';
import type { Db, Inquiry, StoredFile, VerificationWithChecks } from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type { StagedEvent } from '../../events/index.js';
import type { EnvironmentKind, ProcessVerificationJob } from '../../ports.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import { aamvaJob } from './aamva.js';
import { businessWebsiteJob } from './business-website.js';
import { cryptoWalletJob } from './crypto-wallet.js';
import { databaseBusinessJob } from './database-business.js';
import { databaseJob } from './database.js';
import { documentJob } from './document.js';
import { emailAddressJob } from './email-address.js';
import { governmentIdNfcJob } from './government-id-nfc.js';
import { governmentIdJob } from './government-id.js';
import { phoneNumberJob } from './phone-number.js';
import { selfieJob } from './selfie.js';

/** What a type's evaluator is given: one attempt of the job (C30.3). */
export interface TypeEvaluationJob {
  environmentId: string;
  environmentKind: EnvironmentKind;
  inquiry: Inquiry;
  verificationId: string;
  /** The verification as the job read it, `submitted`. */
  verification: VerificationWithChecks;
  files: readonly StoredFile[];
  /** The type's configuration in the inquiry's pinned template version (C11). */
  config: VerificationTemplateConfig;
  /** The pinned template version's flow. */
  flow: Flow;
  /** BullMQ will not retry this attempt: a vision or provider failure goes on the checks. */
  lastAttempt: boolean;
  now: Date;
}

/** A type's check results, and the state its decision hooks read. */
export interface TypeEvaluation<State> {
  results: CheckResult[];
  /**
   * Vision could not read an upload, so only the image checks answered (`image_unreadable`): a
   * decision that is not `failed` then has nothing to stand on (`image_unreadable` job failure).
   */
  unreadable?: boolean | undefined;
  /** What `persistInDecisionTx` and `afterCommit` need, such as a government ID's extraction. */
  state: State;
  /**
   * C50.7, C59.5: the verification is not decided but moved `submitted -> skipped`, with its
   * checks and `verification.skipped` (only the AAMVA job, for a jurisdiction outside DLDV).
   */
  skip?: boolean | undefined;
}

/**
 * The status a decision gives; `submitted` while a check is still pending, `skipped` when the
 * type's evaluation asked for it (`TypeEvaluation.skip`).
 */
export type DecidedStatus = 'passed' | 'failed' | 'needs_review' | 'skipped' | 'submitted';

/** The decision transaction, as a type's `persistInDecisionTx` sees it. */
export interface DecisionContext<State> {
  deps: ProcessVerificationDeps;
  environmentId: string;
  inquiry: Inquiry;
  /** The inquiry's status under its lock (`null` only for a row that vanished). */
  inquiryStatus: InquiryStatus | null;
  verificationId: string;
  /** The verification's new status; `submitted` when the decision is still pending. */
  status: DecidedStatus;
  results: readonly CheckResult[];
  config: VerificationTemplateConfig;
  flow: Flow;
  files: readonly StoredFile[];
  state: State;
  now: Date;
  /**
   * Stages the `verification.*` event of the decision (none while `submitted`) with the
   * verification as it stands in the transaction, so it carries what the hook wrote before.
   */
  verificationEvent(): Promise<StagedEvent[]>;
}

/** After the decision committed. */
export interface AfterCommitContext<State> {
  deps: ProcessVerificationDeps;
  environmentId: string;
  inquiryId: string;
  verificationId: string;
  status: DecidedStatus;
  state: State;
}

/** The transaction that fails a verification whose processing cannot finish (C7). */
export interface ProcessingFailedContext {
  deps: ProcessVerificationDeps;
  environmentId: string;
  inquiryId: string;
  verificationId: string;
  now: Date;
}

/** C59.6: a verification of the inquiry was just decided, in this transaction. */
export interface InquiryVerificationDecidedContext {
  deps: ProcessVerificationDeps;
  environmentId: string;
  inquiry: Inquiry;
  /** The inquiry's status under its lock (`null` only for a row that vanished). */
  inquiryStatus: InquiryStatus | null;
  /** The pinned template version's flow. */
  flow: Flow;
  /** The decided verification, with its new status and checks. */
  decided: VerificationWithChecks;
  now: Date;
}

/** What a decision hook did: the events it staged, and the verifications to enqueue. */
export interface InquiryDecisionHookResult {
  staged: StagedEvent[];
  /** Verifications it moved to `submitted`, enqueued once the transaction committed. */
  enqueue: ProcessVerificationJob[];
  /**
   * C151.2 (Workflow 9A Stage 1b (S)): a flow advance's after-commit work (`runFlowAfterCommit`),
   * such as the silent AAMVA attempt's step exit; run once the transaction committed.
   */
  flowAfter?: (() => Promise<void>)[];
}

/** One verification type's job (C54.1). `State` passes from `evaluate` to the decision hooks. */
export interface VerificationTypeJob<State = unknown> {
  readonly type: SupportedVerificationType;
  /** False until the type's job is built (see the file header). */
  readonly runnable: boolean;
  evaluate(deps: ProcessVerificationDeps, job: TypeEvaluationJob): Promise<TypeEvaluation<State>>;
  persistInDecisionTx(tx: Db, ctx: DecisionContext<State>): Promise<StagedEvent[]>;
  afterCommit?(ctx: AfterCommitContext<State>): Promise<void>;
  onProcessingFailed(tx: Db, ctx: ProcessingFailedContext): Promise<StagedEvent[]>;
  onInquiryVerificationDecided?(
    tx: Db,
    ctx: InquiryVerificationDecidedContext,
  ): Promise<InquiryDecisionHookResult>;
}

/** Every type's job, one file each under `jobs/types/`. */
export const VERIFICATION_TYPE_JOBS: Readonly<
  Record<SupportedVerificationType, VerificationTypeJob>
> = Object.freeze({
  government_id: governmentIdJob,
  selfie: selfieJob,
  document: documentJob,
  database: databaseJob,
  aamva: aamvaJob,
  phone_number: phoneNumberJob,
  email_address: emailAddressJob,
  government_id_nfc: governmentIdNfcJob,
  crypto_wallet: cryptoWalletJob,
  database_business: databaseBusinessJob,
  business_website: businessWebsiteJob,
});

/** The job of `type`. */
export function verificationTypeJob(type: SupportedVerificationType): VerificationTypeJob {
  return VERIFICATION_TYPE_JOBS[type];
}

/** Whether this server runs verifications of `type` end to end yet (its job is built). */
export function isRunnableVerificationType(type: SupportedVerificationType): boolean {
  return VERIFICATION_TYPE_JOBS[type].runnable;
}
