/**
 * Ports: the seams between the HTTP routes, the background worker and infrastructure, fixed
 * before each phase's Stage 2 so agents can build both sides in parallel.
 *
 * | Port | Factory (fixed name) | Owner |
 * |---|---|---|
 * | `FileStorage` | `createFileStorage` in `storage/index.ts` | api-http |
 * | `VerificationQueue` | `createVerificationQueue` in `jobs/index.ts` | api-worker |
 * | `EventPublisher` | `createEventPublisher` in `events/index.ts` | api-worker |
 * | `VisionClient` | `createVisionClient` in `vision/index.ts` | api-worker |
 * | `PrincipalResolver` (user sessions) | `createUserSessionPrincipalResolver` in `operator-auth/principal-resolver.ts` | api-operators |
 * | `AccountsService` | `createAccountsService` in `services/accounts.ts` | api-lifecycle |
 * | `RedactionService` | `createRedactionService` in `services/redaction.ts` | api-lifecycle |
 * | `AuditLogger` | `createAuditLogger` in `services/audit-log.ts` | api-operators |
 * | `RateLimiter` | `createRateLimiter` in `rate-limit/index.ts` | api-platform |
 * | `Mailer` | `createMailer` in `mail/index.ts` | api-operators |
 *
 * Owners replace the stub bodies and add the options their factories need; wiring the
 * factories into the server and worker entry points is the integration step. The interfaces
 * here are locked by `docs/plans/phase-1.plan.md` and `docs/plans/phase-2.plan.md`.
 */
import {
  newId,
  type AcceptedImageMimeType,
  type AuditActor,
  type EventName,
  type EventPayload,
  type Id,
  type IdPrefix,
  type OtpLimitName,
  type RateLimitPolicy,
} from '@openverify/contracts';
import type {
  AamvaLookupResult,
  AgeEstimateResult,
  PhoneIntelligenceLookup,
  PublicFigureResult,
} from '@openverify/checks';
import type {
  ExtractedFields,
  ImportErrorCode,
  ListNotApplicableReason,
  ListUnscreenedReason,
  Permission,
} from '@openverify/core';
import type {
  Db,
  EventCause,
  IdClass,
  ListItemCreatorType,
  ListItemRedaction,
} from '@openverify/db';
import type { FastifyRequest } from 'fastify';
import type { StagedEvent } from './events/index.js';

/** Agents that own a stub: Phase 1, then Phase 2 (Workflow 2A Stage 2). */
export type StubOwner =
  | 'api-http'
  | 'api-worker'
  | 'dashboard'
  | 'api-inquiries'
  | 'api-lifecycle'
  | 'api-platform'
  | 'api-integrations'
  | 'api-operators';

/** Thrown by a stub whose real implementation has not landed yet. */
export class NotImplementedError extends Error {
  override name = 'NotImplementedError';
  readonly feature: string;
  readonly owner: StubOwner;

  constructor(feature: string, owner: StubOwner) {
    super(`${feature} is not implemented yet (owner: ${owner})`);
    this.feature = feature;
    this.owner = owner;
  }
}

// Storage ---------------------------------------------------------------------

/**
 * S3-compatible object storage for uploaded files. Implementations only ever handle opaque
 * ciphertext: callers encrypt each file with its own data key (`encryptBytes` in
 * `@openverify/db`) before `put`, and decrypt after `get`. Keys are chosen by the caller,
 * for example `<environment id>/<file id>`, and must never contain PII.
 */
export interface FileStorage {
  /** Stores `ciphertext` under `key`, replacing any existing object. */
  put(key: string, ciphertext: Uint8Array): Promise<void>;
  /** The ciphertext stored under `key`, or `null` when there is none. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes the object under `key`. Succeeds when it does not exist. */
  delete(key: string): Promise<void>;
}

// Jobs ------------------------------------------------------------------------

export interface ProcessVerificationJob {
  environmentId: string;
  /** `ver_...` of a verification in status `submitted`. */
  verificationId: string;
}

/** BullMQ (Valkey) queue feeding the worker. */
export interface VerificationQueue {
  /**
   * Enqueues the `process-verification` job: decrypt the files, call vision, evaluate the
   * checks, decide the verification and move the inquiry. Idempotent per verification (the
   * job id is the verification id), so a repeated submit never processes twice.
   */
  enqueueProcessVerification(job: ProcessVerificationJob): Promise<void>;
}

/** C74.1 (Phase 6): one `report-run` job. Ids only; the worker reads the rest under its claim. */
export interface ReportRunJob {
  environmentId: string;
  /** `rep_...`. */
  reportId: string;
  /** `rpr_...`, also the job id, so a run waiting, delayed or active is not added twice. */
  runId: string;
}

/**
 * C74.1, C84.2: the `report-run` producer: the API after a creation or a `run` call commits, and
 * the worker's sweep (the outbox of every other run). Its jobs are removed when they complete or
 * fail (V02): the run row is the record, and a kept job id would make a later add a no-op.
 */
export interface ReportRunQueue {
  enqueueReportRun(job: ReportRunJob): Promise<void>;
}

/**
 * C90.5 (Workflow 7A): one `inquiry-signals` job, its id the inquiry id. Ids only: the job reads
 * the stored session facts and the sealed signal bodies under the outbox row.
 */
export interface InquirySignalsJob {
  environmentId: string;
  /** `inq_...`, also the job id, so an inquiry waiting, delayed or active is not added twice. */
  inquiryId: string;
}

/**
 * C90.5: the `inquiry-signals` producer: the worker's `inquiry-signals-sweep`, which enqueues the
 * pending outbox rows. Its jobs are removed when they complete or fail: the outbox row is the
 * record, and a kept job id would make a later add a no-op.
 */
export interface InquirySignalsQueue {
  enqueueInquirySignals(job: InquirySignalsJob): Promise<void>;
}

/**
 * C211.4 (Workflow 10B Stage 1b (I)): one `integrity-decode` job, its id the challenge id. Ids only:
 * the job reads the token sealed in the challenge's row (`inquiry_integrity_challenges.token`), never
 * from the queue.
 */
export interface IntegrityDecodeJob {
  environmentId: string;
  /** `ich_...`, also the job id, so a challenge's token is decoded once. */
  challengeId: string;
}

/** C211.4: the `integrity-decode` producer: `POST /flow/integrity-tokens` after its commit. */
export interface IntegrityDecodeQueue {
  enqueueIntegrityDecode(job: IntegrityDecodeJob): Promise<void>;
}

/**
 * C150.9 (Workflow 9A Stage 1b (S)): one `flow-signal-snapshot` job: the `flow-provisional` signals a
 * branch entry waits for. Ids and registry names only; the job reads the stored session facts.
 */
export interface FlowSignalSnapshotJob {
  environmentId: string;
  inquiryId: string;
  /** The branch's entry in the step record. */
  stepRecordSeq: number;
  /** The registry names the branch's `waitFor` lists, such as `inquiry/vpn_detected`. */
  names: readonly string[];
}

/**
 * C150.9: the `flow-signal-snapshot` producer (`requestSignalSnapshot`, `api-flow-actions`), in the
 * API and the worker. One job per branch entry, so a repeated request is not added twice.
 */
export interface FlowSignalSnapshotQueue {
  enqueueFlowSignalSnapshot(job: FlowSignalSnapshotJob): Promise<void>;
}

/**
 * C163.2, C174.3 (Workflow 9B Stage 1b (A)): one `analytics-rebuild` job: an environment whose open
 * days are recomputed in its current reporting zone (after a zone change). Its id only: the job reads
 * the zone and the settle window when it runs, so a repeated job is harmless.
 */
export interface AnalyticsRebuildJob {
  environmentId: string;
}

/** C163.2: the `analytics-rebuild` producer (`jobs/analytics-queues.ts`), in the worker. */
export interface AnalyticsRebuildQueue {
  enqueueAnalyticsRebuild(job: AnalyticsRebuildJob): Promise<void>;
}

/** C166.1 (Workflow 9B Stage 1b (X)): one `exports` row to cut. */
export interface ExportJob {
  environmentId: string;
  exportId: string;
}

/** The `export` producer (`jobs/export-queues.ts`); the job id is the `exp_` id. */
export interface ExportQueue {
  enqueueExport(job: ExportJob): Promise<void>;
}

/** C166.5 (Workflow 9B Stage 1b (X)): one `report_bulk_jobs` row to run. */
export interface ReportBulkJob {
  environmentId: string;
  reportBulkJobId: string;
}

/** The `report-bulk` producer (`jobs/export-queues.ts`); the job id is the `rbulk_` id. */
export interface ReportBulkQueue {
  enqueueReportBulk(job: ReportBulkJob): Promise<void>;
}

/** C99.4 (Workflow 7B): one `list-screen` job per inquiry. */
export interface ListScreenJob {
  environmentId: string;
  /** `inq_...`, also the job id, so an inquiry waiting, delayed or active is not added twice. */
  inquiryId: string;
}

/** C99.4: the `list-screen` producer: the `list-screen-sweep` enqueues the pending outbox rows. */
export interface ListScreenQueue {
  enqueueListScreen(job: ListScreenJob): Promise<void>;
}

/** C100.2 (Workflow 7B): one `list-import` job per importer. */
export interface ListImportJob {
  environmentId: string;
  /** `mprt_...`, also the job id. */
  importerId: string;
}

/** C100.2: the `list-import` producer: the importer route and the `list-import-sweep`. */
export interface ListImportQueue {
  enqueueListImport(job: ListImportJob): Promise<void>;
}

/** C99.7 (Workflow 7B): one `list-item-embed` job per pending face or background item. */
export interface ListItemEmbedJob {
  environmentId: string;
  /** `lifc_...` or `lisb_...`, also the job id. */
  itemId: string;
}

/** C99.7: the `list-item-embed` producer: the item route and the `list-item-embed-sweep`. */
export interface ListItemEmbedQueue {
  enqueueListItemEmbed(job: ListItemEmbedJob): Promise<void>;
}

/** C101.3 (Workflow 7B): one `graph-index` job per inquiry, from its outbox row. */
export interface GraphIndexJob {
  environmentId: string;
  /** `inq_...`, also the job id, so an inquiry waiting, delayed or active is not added twice. */
  inquiryId: string;
}

/** C101.3: the `graph-index` producer: the `graph-index-sweep` enqueues the pending outbox rows. */
export interface GraphIndexQueue {
  enqueueGraphIndex(job: GraphIndexJob): Promise<void>;
}

/** C102.4 (Workflow 7B): one `graph-query` job per asynchronous query run. */
export interface GraphQueryJob {
  environmentId: string;
  /** `grphq_...`, also the job id. */
  graphQueryId: string;
}

/**
 * C102.4: the `graph-query` producer: `POST /graph-queries` and `/rerun` after their commit, and
 * the `graph-query-sweep`, which re-enqueues a query that could not claim its template (F40).
 */
export interface GraphQueryQueue {
  enqueueGraphQuery(job: GraphQueryJob): Promise<void>;
}

/** C99.9 (H09): one configured list the lookup could not read, and why. */
export interface CompromisedIdUnscreened {
  'list-id': string;
  reason: ListUnscreenedReason;
}

/** C99.9: the input of `id_compromised_detection`. */
export interface CompromisedIdAnswer {
  matched: boolean;
  unscreened: CompromisedIdUnscreened[];
}

/**
 * C99.9 (Workflow 7B): an exact match of the extraction's number and class against every active
 * government ID number list with `use-for-compromised-ids`. It answers `null` with no such list,
 * and the check's input then stays absent, as without a lookup. Owner: `api-lists`.
 */
export interface CompromisedIdLookup {
  lookup(input: {
    environmentId: string;
    inquiryId: string;
    verificationId: string;
    identificationNumber: string;
    idClass: IdClass | null;
  }): Promise<CompromisedIdAnswer | null>;
}

/** C99.1 (F08): what writes one item: the value as entered, keyed by the writer. */
export interface ListItemToWrite {
  /** The item's attributes by kind (C97.1), as the create body and the importer's row carry them. */
  attributes: Readonly<Record<string, unknown>>;
  creator: { type: ListItemCreatorType; id: string };
}

/** C99.1: an item the writer refused: a code and a position, never a value (C100.4). */
export interface ListItemRefusal {
  index: number;
  code: ImportErrorCode;
}

export interface ListItemWriteResult {
  inserted: { id: string }[];
  /** Rows already live in the list (H30). */
  alreadyPresent: number;
  refused: ListItemRefusal[];
}

/**
 * C99.1 (F08): writes items in `tx`, used by the importer through the staging table. Refusals never
 * throw, so `all-or-nothing` and `skip-invalid` both read one answer. Owner: `api-lists`.
 */
export interface ListItemWriter {
  insertItems(
    tx: Db,
    input: { environmentId: string; listId: string; items: readonly ListItemToWrite[] },
  ): Promise<ListItemWriteResult>;
}

/**
 * C99.1, C103 (F08): one item created through the list's rules, used by the graph's add-to-list.
 * Owner: `api-lists`. A face or background list is refused by the caller (P16).
 */
export interface ListService {
  createItem(input: {
    environmentId: string;
    listId: string;
    item: ListItemToWrite;
  }): Promise<{ id: string; alreadyPresent: boolean }>;
  /**
   * C122.2, C117.5 (Stage 1a amendment 5): the same in the caller's transaction, for `add_list_item`:
   * it takes no `lists-write` token, and `list.updated` is the caller's.
   */
  createItemInTx(
    tx: Db,
    input: { environmentId: string; listId: string; item: ListItemToWrite },
  ): Promise<{ id: string; alreadyPresent: boolean }>;
}

/** One selected face or background list. */
export interface BiometricListSelection {
  id: string;
  kind: 'face' | 'selfie-background';
  version: number;
}

/** C99.1, C99.7: one advisory biometric match. */
export interface BiometricListMatch {
  listId: string;
  listItemId: string;
  listVersion: number;
  method: 'face_cosine' | 'background';
  score: number;
}

/** C99.7: every result states the count compared and the best score. */
export interface BiometricListComparison {
  listId: string;
  compared: number;
  bestScore: number | null;
}

export interface BiometricListOutcome {
  matches: BiometricListMatch[];
  unscreened: { 'list-id': string; reason: ListUnscreenedReason }[];
  compared: BiometricListComparison[];
  /**
   * C99.1 (H16): the lists read for an inquiry with no selfie: screened, with nothing to compare, so
   * they never make a screening partial. Absent from an outcome with none.
   */
  notApplicable?: { 'list-id': string; reason: ListNotApplicableReason }[];
}

/**
 * C99.7 (F08): scores the inquiry's centre selfie against the selected lists, advisory only. It
 * needs the probed inquiry's `consent.biometric-matching`; without it each list is `unscreened`
 * with `consent_not_given`. Owner: `api-biometric-lists`.
 */
export interface BiometricListMatcher {
  match(input: {
    environmentId: string;
    inquiryId: string;
    lists: readonly BiometricListSelection[];
    /**
     * C30.3: `false` while the job has attempts left, so a vision failure a retry may cure rejects
     * for BullMQ's backoff; by default it is recorded as `probe_unavailable`.
     */
    lastAttempt?: boolean | undefined;
  }): Promise<BiometricListOutcome>;
}

/**
 * C98.4, C99.7 (F08): redacts the face and background items an inquiry was the source of, in the
 * inquiry redaction's transaction, and returns the envelope objects to delete after the commit.
 * Owner: `api-biometric-lists`.
 */
export interface BiometricItemRedactor {
  redactBySource(
    tx: Db,
    input: { environmentId: string; inquiryId: string; at: Date },
  ): Promise<ListItemRedaction>;
}

/** C97.4 (F16): whether `biometric-lists-basis` is set. Owner: `api-biometric-lists`. */
export interface BiometricListsGate {
  isAcknowledged(db: Db, environmentId: string): Promise<boolean>;
}

/** C74.4 (Phase 6): one `report-rescreen` job, keyed `rescreen-<sync id>`. */
export interface ReportRescreenJob {
  /** `watchlist_syncs.id` of an applied sync whose `rescreen_state` is `pending`. */
  syncId: number;
}

/**
 * C74.4 (V05): the `report-rescreen` producer, over its own Valkey connection in the sync CLI,
 * the refresh job and `seed:dev`, and in the worker's sweep (`recoverPendingRescreens`). Jobs are
 * removed when they complete or fail; the sync's `rescreen_state` is the record.
 */
export interface ReportRescreenQueue {
  enqueueReportRescreen(job: ReportRescreenJob): Promise<void>;
}

// Events ----------------------------------------------------------------------

export interface PublishEventInput {
  environmentId: string;
  name: EventName;
  /** The resource the event is about, built with the `@openverify/contracts` builders. */
  payload: EventPayload;
  /**
   * C121.3 (Workflow 8A): the internal cause, never in a payload. Left out, `stage()` reads the
   * request-scoped context (`events/cause-context.ts`), so no call site passes it.
   */
  cause?: EventCause | undefined;
}

export interface EventPublisher {
  /**
   * Writes the `events` row, then fans out: one `webhook_deliveries` row and delivery job per
   * enabled webhook of the environment subscribed to `name` (`webhookWantsEvent`).
   * @returns the new event id (`evt_...`).
   */
  publish(input: PublishEventInput): Promise<string>;
}

// Workflow engine (C117.9, C118.1, C119.3) -------------------------------------
//
// Jobs carry ids alone (C117.9): the rows are the record, and Valkey only wakes a step up.

/** C117.9: one claim attempt of a step; its job id is `<step id>-<attempt>`. */
export interface WorkflowStepJob {
  environmentId: string;
  runId: string;
  stepId: string;
  attempt: number;
}

export interface WorkflowStepEnqueueOptions {
  /** C117.8: `workflow-step-batch`, for schedules, recurring ticks and fan-outs. */
  batch?: boolean | undefined;
  /** C117.9: a BullMQ delay, only when the due time is within the hour. */
  delayMs?: number | undefined;
}

/** The `workflow-step` and `workflow-step-batch` producers. */
export interface WorkflowStepQueue {
  enqueueWorkflowStep(job: WorkflowStepJob, options?: WorkflowStepEnqueueOptions): Promise<void>;
}

/** C118.1: one `workflow_trigger_deliveries` row. */
export interface WorkflowTriggerJob {
  environmentId: string;
  deliveryId: string;
}

/** The `workflow-trigger` producer. */
export interface WorkflowTriggerQueue {
  enqueueWorkflowTrigger(job: WorkflowTriggerJob): Promise<void>;
}

/** C119.3: one `workflow_wait_candidates` row. */
export interface WorkflowWaitMatchJob {
  environmentId: string;
  eventId: string;
}

/** The `workflow-wait-match` producer. */
export interface WorkflowWaitMatchQueue {
  enqueueWorkflowWaitMatch(job: WorkflowWaitMatchJob): Promise<void>;
}

/** C127.12: one `list_rescreen_requests` row. */
export interface ListRescreenJob {
  environmentId: string;
  listId: string;
  listVersion: number;
}

/** The `list-rescreen` producer (C127.12). */
export interface ListRescreenQueue {
  enqueueListRescreen(job: ListRescreenJob): Promise<void>;
}

/** C137.4 (Workflow 8B): one `case_bulk_actions` row. */
export interface CaseBulkJob {
  environmentId: string;
  bulkActionId: string;
}

/** The `case-bulk` producer (C137.4, C143.2). */
export interface CaseBulkQueue {
  enqueueCaseBulkAction(job: CaseBulkJob): Promise<void>;
}

/** C138.1 (Workflow 8B (F)): one `case_exports` row to write. */
export interface CaseExportJob {
  environmentId: string;
  caseExportId: string;
}

/** The `case-export` producer (C138.1, C143.2); the job id is the `cexp_` id. */
export interface CaseExportQueue {
  enqueueCaseExport(job: CaseExportJob): Promise<void>;
}

/** C135.5 (Workflow 8B (F)): one `case_attachments` row to scan. */
export interface CaseAttachmentScanJob {
  environmentId: string;
  caseAttachmentId: string;
}

/** The `case-attachment-scan` producer (C135.5, C143.2); the job id is the `catt_` id. */
export interface CaseAttachmentScanQueue {
  enqueueCaseAttachmentScan(job: CaseAttachmentScanJob): Promise<void>;
}

/**
 * C135.3 (Workflow 8B (F)): one source to render, an inquiry's file (`file_`) or an attachment
 * (`catt_`).
 */
export interface CaseRenditionJob {
  environmentId: string;
  sourceId: string;
}

/** The `case-rendition` producer (C135.3, C143.2); the job id is the source's id. */
export interface CaseRenditionQueue {
  enqueueCaseRendition(job: CaseRenditionJob): Promise<void>;
}

// Vision (contract C6) -------------------------------------------------------
//
// Types mirror the vision service's snake_case JSON. The api-worker's client validates every
// response with zod before returning it, against contracts/fixtures/vision/*.json.

/** Model identifiers, e.g. `{ detector: 'yunet-2026may', recognizer: 'sface-2021dec' }`. */
export interface VisionModelVersions {
  readonly detector: string;
  readonly recognizer: string;
  readonly [model: string]: string;
}

/** Image quality measurements and the service's threshold verdicts. */
export interface VisionQuality {
  blur_score: number;
  is_blurry: boolean;
  glare_ratio: number;
  has_glare: boolean;
  brightness: number;
  is_too_dark: boolean;
  is_too_bright: boolean;
}

/** `[x, y, width, height]` in pixels of the submitted image. */
export type BoundingBox = readonly [x: number, y: number, width: number, height: number];

export interface VisionDetectedFace {
  bbox: BoundingBox;
  score: number;
}

export interface VisionFace extends VisionDetectedFace {
  /**
   * 128-dimension SFace embedding. Biometric data: compare it in memory (face match) and
   * never persist or log it in Phase 1.
   */
  embedding: readonly number[];
}

/** An `(x, y)` point, and four corners clockwise from the top left (C32.1). */
export type VisionPoint = readonly [x: number, y: number];
export type VisionQuad = readonly [VisionPoint, VisionPoint, VisionPoint, VisionPoint];

/** C32.1 `document`: the outline on the upload and the rectified size. */
export interface VisionDocumentDetection {
  found: boolean;
  quad: VisionQuad | null;
  /** `text_layout` (Phase 12A): an outline fitted from the text lines and the portrait. */
  method: 'contour' | 'lines' | 'full_frame' | 'text_layout' | 'none';
  rectified_size: readonly [width: number, height: number] | null;
  aspect_ratio: number | null;
  area_ratio: number | null;
}

/** C32.1 `document_quality`, measured on the rectified document. */
export interface VisionDocumentQuality {
  blur_score: number;
  tenengrad: number;
  width_px: number;
  height_px: number;
  glare_ratio_text: number | null;
  glare_ratio_portrait: number | null;
}

/**
 * One visual-zone OCR line (C32.1): PII. Compare and extract in memory; never log or store it
 * (C32.5, the API stores only the C31 extraction).
 */
export interface VisionTextLine {
  text: string;
  confidence: number;
  box: BoundingBox;
  stroke_width_mean: number | null;
  stroke_width_cv: number | null;
}

/** C32.1 `mrz`: raw lines of `[A-Z0-9<]`; parsing and check digits are TypeScript's. PII. */
export interface VisionMrzReading {
  found: boolean;
  format_guess: 'TD1' | 'TD2' | 'TD3' | 'MRVA' | 'MRVB' | null;
  lines: readonly string[];
  line_confidences: readonly number[];
  box: BoundingBox | null;
}

/** A decoded barcode (zxing-cpp, plain text mode), with its raw bytes. PII. */
export interface VisionBarcode {
  format: string;
  bytes_b64: string;
  text: string;
  quad: VisionQuad;
}

export interface VisionPortraitClarity {
  face_width_px: number;
  sharpness: number;
  landmarks_score: number;
}

/** C32.1 raw forensic scores; GPS values never leave the vision service. */
export interface VisionForensics {
  exif: { software: string | null; make: string | null; model: string | null; has_gps: boolean };
  jpeg: {
    quality_estimate: number | null;
    standard_tables: boolean | null;
    double_compression_score: number | null;
  } | null;
  ela_score: number;
  moire_score: number;
  screen_grid_score: number;
  chroma: { mean_saturation: number; colorfulness: number };
  color_cast_score: number;
  copy_move_score: number;
  portrait_boundary_score: number | null;
  star_glyph: { found: boolean; score: number; box: BoundingBox | null };
}

export interface GovernmentIdSideAnalysis {
  quality: VisionQuality;
  faces: readonly VisionDetectedFace[];
  /** The ID portrait; always `null` on the back. */
  portrait: VisionFace | null;
  document: VisionDocumentDetection;
  document_quality: VisionDocumentQuality | null;
  text: readonly VisionTextLine[];
  mrz: VisionMrzReading;
  barcodes: readonly VisionBarcode[];
  /** Front only. */
  portrait_clarity: VisionPortraitClarity | null;
  /** `null` when the forensic measurements could not be taken. */
  forensics: VisionForensics | null;
  /** 16 lowercase hex characters, or `null` without a rectified document. */
  phash: string | null;
}

/** C6 model versions plus the OCR models (C32.1), `null` while no OCR model ran. */
export interface GovernmentIdModelVersions {
  readonly detector: string;
  readonly recognizer: string;
  readonly text_detector: string | null;
  readonly text_recognizer: string | null;
  readonly [model: string]: string | null;
}

/** `POST /v1/analyze/government-id` response (C6, C32.1). */
export interface GovernmentIdAnalysis {
  model_versions: GovernmentIdModelVersions;
  sides: {
    front: GovernmentIdSideAnalysis;
    back: GovernmentIdSideAnalysis | null;
  };
}

/** A selfie face with YuNet's five landmarks in image pixels (C41.1). */
export interface VisionSelfieFace extends VisionDetectedFace {
  /** Right eye, left eye, nose tip, right and left mouth corners (the subject's sides). */
  landmarks: readonly [VisionPoint, VisionPoint, VisionPoint, VisionPoint, VisionPoint];
}

/** C41.1 measurements of a selfie pose; each is `null` when it was not measured. */
export interface VisionFaceQuality {
  box: BoundingBox;
  width_px: number;
  height_ratio: number;
  center_offset: readonly [dx: number, dy: number];
  /** Laplacian variance of the face region resized to 112 pixels wide. */
  blur_score: number;
  brightness: number;
  /** Saturated share of the face region without the eyes. */
  glare_ratio: number;
}

export interface VisionHeadPose {
  /** `(x_nose - x_eye_mid) / inter-ocular distance`, de-rolled; positive is the user's left. */
  yaw_ratio: number;
  roll_deg: number;
  yaw_deg: number | null;
  pitch_deg: number | null;
  method: 'yunet-5pt';
}

export interface VisionPassiveLiveness {
  v2: number;
  v1se: number;
  /** Mean P(real) of the two MiniFASNet models. */
  mean: number;
  effective_scales: { v2: number; v1se: number };
}

export interface VisionOcclusion {
  covering: {
    score: number;
    skin_fraction_ratio: number;
    texture_ratio: number;
    delta_e: number;
    forehead_valid: boolean;
  };
  glasses: {
    score: number;
    rim_edge_energy: number;
    lens_highlight_ratio: number;
    bridge_edge_density: number;
  };
}

export interface VisionSyntheticScores {
  spectral_tail_deviation: number | null;
  residual_peak_ratio: number | null;
  noise_inconsistency: number | null;
  jpeg_grid_misalignment: number | null;
  canonical_landmark_distance: number | null;
  /** XMP `DigitalSourceType` of an upload (`source: upload` only). */
  digital_source_type: string | null;
}

/** The centre's background layout (research §8). Personal data: never logged. */
export interface VisionBackgroundLayout {
  /** 48 cells x mean Lab. */
  layout: readonly number[];
  /** 48 characters of `0`/`1`: the cells the person mask left visible. */
  valid_cells: string;
  coverage: number;
}

export interface VisionPoseConsistency {
  pose: 'left' | 'right';
  face_cosine_to_center: number | null;
  planarity: {
    tracked_points: number;
    median_residual_ratio: number;
    p90_residual_ratio: number;
  } | null;
  registered_ssim: number | null;
  raw_ssim: number | null;
  /** `null` when not measured. */
  duplicate_of_center: boolean | null;
}

export interface SelfiePoseAnalysis {
  quality: VisionQuality;
  faces: readonly VisionSelfieFace[];
  /** The main face, or `null` when none was found. */
  face: VisionFace | null;
  /** EXIF-upright size of the pose image (C41.1). */
  image: { width: number; height: number };
  face_quality: VisionFaceQuality | null;
  head_pose: VisionHeadPose | null;
  passive_liveness: VisionPassiveLiveness | null;
  occlusion: VisionOcclusion | null;
  synthetic: VisionSyntheticScores | null;
  /** Centre only. */
  background: VisionBackgroundLayout | null;
}

/** The C6 model versions, plus the anti-spoofing models (`null` while unused). */
export interface SelfieModelVersions {
  detector: string;
  recognizer: string;
  anti_spoof_v2: string | null;
  anti_spoof_v1se: string | null;
}

/** `POST /v1/analyze/selfie` response (C41.1). */
export interface SelfieAnalysis {
  model_versions: SelfieModelVersions;
  poses: {
    center: SelfiePoseAnalysis;
    left: SelfiePoseAnalysis | null;
    right: SelfiePoseAnalysis | null;
  };
  /** One entry per side pose present. */
  consistency: readonly VisionPoseConsistency[];
}

/** `POST /v1/compare/background` response (C41.2): one result per candidate sent. */
export interface BackgroundComparison {
  results: readonly {
    index: number;
    good_matches: number;
    inliers: number;
    inlier_ratio: number;
  }[];
}

/** How the selfie was taken, as `/v1/analyze/selfie`'s `source` field (C41.1). */
export type SelfieSource = 'camera' | 'upload';

// C60.1, C60.4: document analysis (Phase 5, Workflow 5B) -------------------------------------
// Vision measures; the document checks classify, extract and decide (C60.5, C60.6). `null` is
// "not measured". Text-layer and OCR lines and XMP values are PII: compare and extract in memory,
// never log them; the API stores only the C53.3 extraction.

/** Why a text-layer line is not visible (C60.1). */
export type VisionHiddenReason =
  'render_mode_invisible' | 'clipped' | 'off_page' | 'covered' | 'background_fill' | 'too_small';

/** One line of a PDF page's text layer, visible or not. PII. */
export interface VisionTextLayerLine {
  text: string;
  box: BoundingBox;
  /** Indexes into `pdf.fonts`. */
  font_ids: readonly number[];
  font_size_pt: number | null;
  visible: boolean;
  /** `null` exactly when visible. */
  hidden_reason: VisionHiddenReason | null;
}

/** One OCR line of a page raster. PII. */
export interface VisionDocumentOcrLine {
  text: string;
  confidence: number;
  box: BoundingBox;
}

export interface VisionDocumentPage {
  /** 1-based. */
  number: number;
  /** The raster read, in pixels; every box is in it. */
  width: number;
  height: number;
  /** The PDF page box in points; `null` for a photo. */
  width_pt: number | null;
  height_pt: number | null;
  text_layer: readonly VisionTextLayerLine[];
  ocr: readonly VisionDocumentOcrLine[];
  /** `null` unless the page has both a text layer and OCR lines. */
  text_layer_ocr_agreement: number | null;
}

export interface VisionXmpFields {
  creator_tool: string | null;
  producer: string | null;
  /** ISO 8601. */
  create_date: string | null;
  modify_date: string | null;
  metadata_date: string | null;
  document_id: string | null;
  instance_id: string | null;
  history_agents: readonly string[];
}

export interface VisionPdfFont {
  /** Its position in `pdf.fonts`. */
  id: number;
  base_name: string;
  subset_tag: string | null;
  embedded: boolean;
}

/** The dangerous actions only (a GoTo `/OpenAction` is not counted). */
export interface VisionPdfActions {
  javascript: number;
  launch: number;
  submit_form: number;
  goto_remote: number;
  rich_media: number;
  embedded_files: number;
}

export interface VisionPdfMeasurements {
  producer: string | null;
  creator: string | null;
  creation_date: string | null;
  modification_date: string | null;
  xmp: VisionXmpFields | null;
  linearized: boolean;
  /** Incremental-update sections, a linearized first-page section not counted. */
  revisions: number;
  xref_repaired: boolean;
  eof_markers: number;
  bytes_after_last_eof: number;
  object_streams: number;
  fonts: readonly VisionPdfFont[];
  annotations: number;
  form_fields: number;
  actions: VisionPdfActions;
  signatures: number;
  edits_after_signature: boolean;
}

export interface VisionDocumentImageMeasurements {
  exif_software: string | null;
  exif_datetime_original: string | null;
  exif_datetime: string | null;
  jpeg_quality: number | null;
  double_compression_score: number | null;
  ela_text_cell_score: number | null;
  copy_move_score: number | null;
}

export interface DocumentModelVersions {
  text_detector: string | null;
  text_recognizer: string | null;
  pdf_renderer: string | null;
  pdf_parser: string | null;
}

/** `POST /v1/analyze/document` response (C60.1). */
export interface DocumentAnalysis {
  model_versions: DocumentModelVersions;
  source: 'pdf' | 'image';
  page_count: number;
  /** The first three pages and the last, 1-based. */
  analysed_pages: readonly number[];
  /** One per analysed page, in order. */
  pages: readonly VisionDocumentPage[];
  /** Set exactly for a PDF. */
  pdf: VisionPdfMeasurements | null;
  image: VisionDocumentImageMeasurements | null;
}

/** A decrypted document sent to vision (C60.1, C60.4): a PDF, or a photo of one. */
export interface VisionDocument {
  bytes: Uint8Array;
  /** The type sniffed at upload (`detectUploadMimeType`). */
  mimeType: AcceptedImageMimeType | 'application/pdf';
}

/**
 * Workflow 11B (ingestion-11b): `POST /v1/count/document-pages`'s answer, a PDF's page count from
 * vision's guarded child (`contracts/fixtures/vision/pdf-page-count.json` holds its bounds).
 */
export interface VisionPageCount {
  pageCount: number;
}

/**
 * Workflow 11B: the vision client's page count, apart from {@link VisionClient} so the worker's
 * test doubles need not grow; `createVisionClient` answers both. Vision answers 422 with C60.1's
 * `pdf_encrypted`, `pdf_unprocessable` or `too_many_pages`, 415, 413, or 503
 * `guarded_worker_failed` (each on the rejected `VisionServiceError`).
 */
export interface VisionPageCounter {
  countDocumentPages(input: { document: VisionDocument }): Promise<VisionPageCount>;
}

/** A chip's DG2 portrait (C60.4): JPEG, or JPEG 2000 (a JP2 file or a raw J2K codestream). */
export interface VisionPortrait {
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/jp2';
}

/** `POST /v1/embed/face` response. */
export interface FaceEmbeddingResult {
  model_versions: VisionModelVersions;
  face: VisionFace | null;
  face_count: number;
}

/** A decrypted image sent to the vision service. */
export interface VisionImage {
  bytes: Uint8Array;
  /** The type sniffed at upload (`detectImageMimeType`). */
  mimeType: AcceptedImageMimeType;
}

/**
 * Client for the internal vision service, authenticated with `x-service-token`. Methods
 * reject when the service fails or answers with something that does not match C6.
 */
export interface VisionClient {
  analyzeGovernmentId(input: {
    front: VisionImage;
    back?: VisionImage | undefined;
  }): Promise<GovernmentIdAnalysis>;
  analyzeSelfie(input: {
    center: VisionImage;
    left?: VisionImage | undefined;
    right?: VisionImage | undefined;
    /** C41.1: vision reads an upload's XMP digital source type; defaults to `camera`. */
    source?: SelfieSource | undefined;
  }): Promise<SelfieAnalysis>;
  /**
   * C41.2: ORB + RANSAC on background pixels of `probe` against up to five candidates (the
   * centre files of earlier verifications). Results come back by candidate index.
   */
  compareBackground(input: {
    probe: VisionImage;
    candidates: readonly VisionImage[];
  }): Promise<BackgroundComparison>;
  /**
   * Embeds the main face of `image`. `subject` says what the image is (Workflow 3B review,
   * K101): `document` for a stored government ID front, whose portrait is the largest face
   * inside the document's quad; no subject for a selfie (vision's default, the largest face).
   */
  embedFace(
    input:
      | { image: VisionImage; subject?: Exclude<FaceEmbeddingSubject, 'chip'> | undefined }
      | { image: VisionPortrait; subject: 'chip' },
  ): Promise<FaceEmbeddingResult>;
  /**
   * C60.1: every measurement of a PDF or a photo of a document. Vision answers 415, 413, 422
   * (`pdf_encrypted`, `pdf_unprocessable`, `too_many_pages`, the `code` on the error) or 503
   * (`guarded_worker_failed`) when it cannot.
   */
  analyzeDocument(input: { document: VisionDocument }): Promise<DocumentAnalysis>;
  /** C60.4: page `page` (1-based) as a PNG of at most 1,600 px a side (the `document-preview`). */
  renderDocumentPage(input: { document: VisionDocument; page: number }): Promise<Uint8Array>;
  /** C60.4: a chip portrait as a PNG of at most 640 px a side (the `chip-portrait`). */
  convertPortrait(input: { portrait: VisionPortrait }): Promise<Uint8Array>;
  /**
   * C99.7 (Workflow 7B): a selfie as a PNG of at most 640 px a side with every person painted out,
   * what a selfie-background list item keeps. Vision answers 422 `no_face_found` without a face.
   */
  maskBackground(input: { image: VisionImage }): Promise<Uint8Array>;
  /**
   * C135.3 (Workflow 8B, F36): what a reviewer may see of a file, on vision's own limiter lane: an
   * image upright and without metadata, re-encoded as JPEG or PNG, or a PDF's first 20 pages as PNG
   * images. The bytes are a person's data: never logged, and stored sealed beside their source.
   */
  createRendition(input: { source: VisionDocument }): Promise<VisionRendition>;
}

/** C135.3: one page of a rendition, its base64 decoded. */
export interface VisionRenditionPage {
  /** 1-based; an image is page 1. */
  page: number;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: Uint8Array;
}

/** C135.3: what `createRendition` answers. */
export interface VisionRendition {
  source: 'image' | 'pdf';
  /** Pages of the source: 1 for an image; a PDF's whole count, rendered or not. */
  pageCount: number;
  /** A PDF holds more pages than the 20 rendered. */
  truncated: boolean;
  pages: readonly VisionRenditionPage[];
}

/**
 * What `/v1/embed/face` is given (its multipart `subject` field; vision defaults to `selfie`):
 * a selfie, a government ID front (`document`), or a chip's DG2 portrait (`chip`, C60.4).
 */
export type FaceEmbeddingSubject = 'selfie' | 'document' | 'chip';

// Providers (contracts C35, C44; ADR 0002 §3d, §3e) ----------------------------
//
// The A-tier government ID checks ask a provider: AAMVA DLDV (`id_aamva_database_lookup`), a
// public-figure gallery (`id_public_figure_detection`) and an age estimator
// (`id_age_inconsistency_detection`); the A-tier selfie checks ask theirs (C44, below). Phase 3
// and 4 ship only deterministic sandbox providers (`providers/sandbox.ts`); a real adapter
// implements the same port and is bound per environment kind by configuration
// (`OPENVERIFY_PROVIDER_<KIND>_<SANDBOX|PRODUCTION>`, `providers/index.ts`). Government ID
// requests carry the extraction (PII): an adapter sends a provider only what it needs and never
// logs it. An adapter failure throws (a `ProviderError` says whether a retry can help).

/** The provider kinds of the A-tier government ID checks. */
export const GOVERNMENT_ID_PROVIDER_KINDS = ['aamva', 'publicFigure', 'ageEstimate'] as const;
export type GovernmentIdProviderKind = (typeof GOVERNMENT_ID_PROVIDER_KINDS)[number];

/** How results are labelled (C29.2 `provenance.provider`). */
export interface ProviderIdentity {
  readonly id: string;
  /** True for a sandbox provider, which configuration never binds to production. */
  readonly sandbox: boolean;
}

/** An AAMVA DLDV request: the card's jurisdiction and what the document showed (PII). */
export interface AamvaLookupRequest {
  /** The two-letter AAMVA jurisdiction of the card's IIN, or `null` when not established. */
  jurisdiction: string | null;
  fields: ExtractedFields;
}

export interface AamvaLookupProvider extends ProviderIdentity {
  lookup(request: AamvaLookupRequest): Promise<AamvaLookupResult>;
}

/** A public-figure request: the ID portrait (its embedding is biometric data) and the fields. */
export interface PublicFigureRequest {
  portrait: VisionFace | null;
  fields: ExtractedFields;
}

export interface PublicFigureProvider extends ProviderIdentity {
  match(request: PublicFigureRequest): Promise<PublicFigureResult>;
}

/** An age-estimation request: the decrypted front, its portrait and the fields (PII). */
export interface AgeEstimateRequest {
  front: VisionImage;
  portrait: VisionFace | null;
  fields: ExtractedFields;
}

export interface AgeEstimateProvider extends ProviderIdentity {
  estimate(request: AgeEstimateRequest): Promise<AgeEstimateResult>;
}

/** The providers bound in one environment kind; a missing one is not configured. */
export interface GovernmentIdProviders {
  aamva?: AamvaLookupProvider | undefined;
  publicFigure?: PublicFigureProvider | undefined;
  ageEstimate?: AgeEstimateProvider | undefined;
}

/**
 * C44: the selfie A-tier ports, bound per environment kind through `OPENVERIFY_PROVIDER_*`
 * (`providers/index.ts`); sandbox providers are refused in production at startup. A real adapter
 * receives the centre image bytes only, as its one argument, and returns an allowlisted shape; a
 * sandbox provider also receives the {@link SandboxSelfieContext}. The raw response is never kept.
 */
export const SELFIE_PROVIDER_KINDS = [
  'selfieAgeEstimate',
  'selfiePublicFigure',
  'suspiciousEntity',
] as const;
export type SelfieProviderKind = (typeof SELFIE_PROVIDER_KINDS)[number];

/** What a selfie port receives: the centre image only, no ids or metadata (C44). */
export interface SelfieProviderRequest {
  image: VisionImage;
}

/**
 * Given only to a provider whose identity has `sandbox: true` (C44 minimisation): the inquiry's
 * `reference-id` and the compared ID's birthdate (`YYYY-MM-DD`), which its magic values read.
 */
export interface SandboxSelfieContext {
  referenceId: string | null;
  birthdate: string | null;
}

/** The allowlisted answers of the selfie ports (C44); a raw provider response is never kept. */
export interface SelfieAgeEstimate {
  age: number;
}
export interface SelfiePublicFigureMatch {
  match: boolean;
  score: number;
}
export interface SuspiciousEntityAssessment {
  flagged: boolean;
  /** The provider's suspicion in [0, 1]. */
  score: number;
}

/** A real adapter: the centre image only, one argument (C44). */
export interface SelfieAgeEstimateProvider extends ProviderIdentity {
  readonly sandbox: false;
  estimateAge(request: SelfieProviderRequest): Promise<SelfieAgeEstimate>;
}

export interface SelfiePublicFigureProvider extends ProviderIdentity {
  readonly sandbox: false;
  matchPublicFigure(request: SelfieProviderRequest): Promise<SelfiePublicFigureMatch>;
}

export interface SuspiciousEntityProvider extends ProviderIdentity {
  readonly sandbox: false;
  assess(request: SelfieProviderRequest): Promise<SuspiciousEntityAssessment>;
}

/** A sandbox provider: the same request, plus the {@link SandboxSelfieContext} (C44). */
export interface SandboxSelfieAgeEstimateProvider extends ProviderIdentity {
  readonly sandbox: true;
  estimateAge(
    request: SelfieProviderRequest,
    context: SandboxSelfieContext,
  ): Promise<SelfieAgeEstimate>;
}

export interface SandboxSelfiePublicFigureProvider extends ProviderIdentity {
  readonly sandbox: true;
  matchPublicFigure(
    request: SelfieProviderRequest,
    context: SandboxSelfieContext,
  ): Promise<SelfiePublicFigureMatch>;
}

export interface SandboxSuspiciousEntityProvider extends ProviderIdentity {
  readonly sandbox: true;
  assess(
    request: SelfieProviderRequest,
    context: SandboxSelfieContext,
  ): Promise<SuspiciousEntityAssessment>;
}

export interface SelfieProviders {
  selfieAgeEstimate?: SelfieAgeEstimateProvider | SandboxSelfieAgeEstimateProvider | undefined;
  selfiePublicFigure?: SelfiePublicFigureProvider | SandboxSelfiePublicFigureProvider | undefined;
  suspiciousEntity?: SuspiciousEntityProvider | SandboxSuspiciousEntityProvider | undefined;
}

export type EnvironmentKind = 'sandbox' | 'production';

// Phase 5, Workflow 5A provider ports (C55.10, C57.5, C59.1, C63) ------------------------------
//
// As C44: a real adapter receives only its port's request fields, as one argument; a sandbox
// provider (`sandbox: true`, never bound to production) also receives a context its documented
// magic values read. An adapter failure throws an error carrying a code and `retryable` only,
// never a provider body, a destination or a URL (C53.8).

/** C55.10: one SMS to send. `to` is E.164; `body` holds the code, so never log it. */
export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsSendResult {
  /** The provider's id of the accepted message, when it gives one. */
  providerMessageId?: string | undefined;
}

/** A real SMS adapter (`twilio`): the message only. */
export interface SmsSender extends ProviderIdentity {
  readonly sandbox: false;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

/**
 * Given only to the sandbox sender (C55.10): it sends nothing and keeps `{ destination index,
 * code, sent-at }` in the sandbox sink of the environment, for `sandbox:read` keys (C55.11).
 */
export interface SandboxSmsContext {
  environmentId: string;
  /** The destination's blind index (`otpDestinationIndex`). */
  destinationIndex: string;
  /** The code the message carries. */
  code: string;
}

export interface SandboxSmsSender extends ProviderIdentity {
  readonly sandbox: true;
  send(message: SmsMessage, context: SandboxSmsContext): Promise<SmsSendResult>;
}

/** C53.8: an SMS adapter failed. A code and `retryable` only: no body, number or URL. */
export class SmsSendError extends Error {
  override name = 'SmsSendError';
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, options: { retryable: boolean }) {
    super(`SMS sending failed (${code})`);
    this.code = code;
    this.retryable = options.retryable;
  }
}

/**
 * C59.1: what a database provider is asked: the country and the fields the step collected
 * (`name-first`, `birthdate`, `address-street-1`, …, as the inputs body names them). PII.
 */
export interface DatabaseLookupRequest {
  country: string;
  fields: Readonly<Record<string, string>>;
}

/** C59.1: the record a source holds, in memory only; any member may be absent. PII. */
export interface DatabaseRecord {
  'name-first'?: string | undefined;
  'name-middle'?: string | undefined;
  'name-last'?: string | undefined;
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  birthdate?: string | undefined;
  'address-street-1'?: string | undefined;
  'address-street-2'?: string | undefined;
  'address-city'?: string | undefined;
  'address-subdivision'?: string | undefined;
  'address-postal-code'?: string | undefined;
  'address-country-code'?: string | undefined;
  /** Whether the source matched the identification number it was given; it never returns one. */
  'identification-number-match'?: boolean | undefined;
  'phone-number'?: string | undefined;
  'email-address'?: string | undefined;
}

export type DatabaseLookupResult =
  | { outcome: 'found'; record: DatabaseRecord; authoritative: boolean }
  | { outcome: 'not_found'; authoritative: boolean }
  | { outcome: 'unsupported_country' };

export interface DatabaseProvider extends ProviderIdentity {
  readonly sandbox: false;
  lookup(request: DatabaseLookupRequest): Promise<DatabaseLookupResult>;
}

/** Given only to the sandbox database provider (C59.2): its magic tokens. */
export interface SandboxDatabaseContext {
  referenceId: string | null;
}

export interface SandboxDatabaseProvider extends ProviderIdentity {
  readonly sandbox: true;
  lookup(
    request: DatabaseLookupRequest,
    context: SandboxDatabaseContext,
  ): Promise<DatabaseLookupResult>;
}

/** C57.5: an `eth_call`, bounded (gas 500,000, one call per submit). */
export interface EvmCallRequest {
  /** `0x` + 40 hex. */
  to: string;
  /** ABI-encoded call data, `0x` hex. */
  data: string;
  gas: number;
}

/**
 * C57.4, C57.5: an EVM node per chain (`json-rpc` over the outbound client, or `sandbox`). Each
 * answer is the node's `0x` hex result.
 */
export interface EvmRpcProvider extends ProviderIdentity {
  getCode(chainId: string, address: string): Promise<string>;
  call(chainId: string, request: EvmCallRequest): Promise<string>;
}

/** C59.1, C55.10, C57.5: the Workflow 5A providers one environment kind binds. */
export interface Phase5AProviders {
  /** Bound in the API, where codes are sent (C55.1), and the worker, for workflow messages (C126.6). */
  sms?: SmsSender | SandboxSmsSender | undefined;
  database?: DatabaseProvider | SandboxDatabaseProvider | undefined;
  /** Bound in the worker only, which runs the crypto job. */
  evmRpc?: EvmRpcProvider | undefined;
}

// Phase 5, Workflow 5B provider ports (C61, C63) ------------------------------------------------
//
// As C44 and the 5A ports: a real adapter receives only its port's request fields, as one
// argument, through the outbound HTTP client; an adapter failure throws a `ProviderError` with a
// code and `retryable` only. The registries' answers are personal data where they name officers,
// PSCs or a sole trader: kept in memory, never cached or logged (C53.5, C61.2).

/** C61.1: the registries a `businessRegistry` binding may name, beside `sandbox`. */
export type BusinessRegistrySource = 'gleif' | 'companies-house' | 'sec-edgar';

/** C61.1: what a registry is asked, from the business body (C52.3). PII (a sole trader's name). */
export interface BusinessRegistryRequest {
  /** ISO 3166-1 alpha-2. */
  country: string;
  businessName: string;
  /**
   * Workflow 5C review K6 (owner decision 7 after Workflow 5B): read the officers and persons with
   * significant control too. Set only when the step collects associated persons and their check
   * runs; absent, a register reads none (data minimisation, GDPR Art. 5(1)(c)).
   */
  withPersons?: boolean | undefined;
  registrationNumber?: string | undefined;
  /** ISO 17442. */
  lei?: string | undefined;
  address?:
    | {
        street1?: string | undefined;
        city?: string | undefined;
        subdivision?: string | undefined;
        postalCode?: string | undefined;
      }
    | undefined;
}

/** C61.7: an officer or person with significant control. Personal data: never cached. */
export interface BusinessPerson {
  name: string;
  /** `YYYY-MM`, the only part of a birth date the register publishes; `null` when none. */
  birthMonth: string | null;
  role: 'officer' | 'psc';
  /** Still in post (not resigned, not ceased). */
  active: boolean;
}

/** C61.1: a register's record of the business. */
export interface BusinessRecord {
  source: BusinessRegistrySource | 'sandbox';
  recordId: string;
  legalName: string;
  /** Previous, trading and transliterated names. */
  otherNames: readonly string[];
  /** The source's own status value (C61.2 maps it), `null` when the source has none. */
  status: string | null;
  statusDetail?: string | null | undefined;
  registeredAddress?:
    | {
        lines: readonly string[];
        city: string | null;
        region: string | null;
        postalCode: string | null;
        country: string | null;
      }
    | null
    | undefined;
  jurisdiction?: string | null | undefined;
  registrationNumber?: string | null | undefined;
  /** Officers and PSCs, when the source publishes them; re-queried, never cached (C61.2). */
  persons?: readonly BusinessPerson[] | undefined;
}

/** C61.1: a register's answer. `authoritative`: a miss there means the business is not on it. */
export type BusinessRegistryLookupResult =
  | {
      outcome: 'found';
      record: BusinessRecord;
      authoritative: boolean;
      /** Whether the source publishes officers or PSCs (`source_has_no_persons` otherwise). */
      personsAvailable: boolean;
    }
  | { outcome: 'not_found'; authoritative: boolean }
  | { outcome: 'unsupported_country' };

/** A real register (`gleif`, `companies-house`, `sec-edgar`), through the outbound client. */
export interface BusinessRegistryProvider extends ProviderIdentity {
  readonly sandbox: false;
  readonly source: BusinessRegistrySource;
  lookup(request: BusinessRegistryRequest): Promise<BusinessRegistryLookupResult>;
}

/** C61.6: the sandbox register, its answers read from the registration number's last four. */
export interface SandboxBusinessRegistryProvider extends ProviderIdentity {
  readonly sandbox: true;
  lookup(request: BusinessRegistryRequest): Promise<BusinessRegistryLookupResult>;
}

/** C61.4: the domain to age: the URL's host, lower-case, as ASCII (punycode). */
export interface DomainAgeRequest {
  host: string;
}

/**
 * C61.4: when the domain was registered, from the registry that answered for exactly the host or
 * the host without a leading `www.`; any other answer is `unavailable` (`subdomain`).
 */
export type DomainAgeResult =
  | { outcome: 'registered'; registeredAt: Date; domain: string }
  | {
      outcome: 'unavailable';
      reason: 'no_rdap_service' | 'not_found' | 'subdomain' | 'no_registration_date';
    };

export interface DomainAgeProvider extends ProviderIdentity {
  age(request: DomainAgeRequest): Promise<DomainAgeResult>;
}

/** C61.5: the site to look up in the operator's feeds. */
export interface MaliciousWebsiteRequest {
  host: string;
  url: string;
}

/** C61.5: what the loaded feeds say; `no_feeds` is `provider_not_configured`, `stale` an error. */
export type MaliciousWebsiteResult =
  | {
      outcome: 'listed';
      categories: readonly ('malware' | 'phishing' | 'spam_source')[];
      /** The ids of the feeds that list it. */
      feeds: readonly string[];
    }
  | { outcome: 'not_listed'; feeds: readonly string[] }
  | { outcome: 'no_feeds' }
  | { outcome: 'stale'; feeds: readonly string[] };

export interface MaliciousWebsiteProvider extends ProviderIdentity {
  check(request: MaliciousWebsiteRequest): Promise<MaliciousWebsiteResult>;
}

/** C61.5: backlinks to a domain (sandbox only in this version). */
export interface BacklinkRequest {
  host: string;
}

export interface BacklinkProvider extends ProviderIdentity {
  readonly sandbox: true;
  count(request: BacklinkRequest): Promise<{ count: number }>;
}

/** C61, C63: the Workflow 5B providers one environment kind binds, in the worker only. */
export interface Phase5BProviders {
  /**
   * The bound registers in the C61.1 order of asking (the national one for the country, then
   * GLEIF), or the sandbox register alone.
   */
  businessRegistry?:
    readonly BusinessRegistryProvider[] | SandboxBusinessRegistryProvider | undefined;
  domainAge?: DomainAgeProvider | undefined;
  maliciousWebsite?: MaliciousWebsiteProvider | undefined;
  backlink?: BacklinkProvider | undefined;
}

// Phase 6 (C81-C83): the report provider ports. `api-providers` builds the adapters and the
// sandbox providers behind them; the shapes are frozen by `foundation-6` (Stage 1b).

/** C81.4: one article as the adverse-media provider returns it (never a body, image or snippet). */
export interface AdverseMediaArticle {
  url: string;
  domain: string;
  /** When the index saw the article (GDELT returns no publication date, H13). */
  seenAt: Date;
  language: string | null;
  sourceCountry: string | null;
  /** At most 200 characters, shown only as link text. */
  title: string;
}

/** C81.2: one search, built only by `gdeltQuery` (V10) from the subject and the lexicon. */
export interface AdverseMediaSearch {
  /** The normalised name tokens (letters and digits only), as one phrase. */
  nameTokens: readonly string[];
  /**
   * Owner decision 5 (b): the asking environment, whose share of the GDELT budget the search
   * takes; a caller that names none takes the install's (`install`).
   */
  environmentId?: string | undefined;
  /** Owner decision 5 (b): every screened name, `nameTokens` first; absent, that one phrase. */
  names?: readonly (readonly string[])[] | undefined;
  /** The template's category terms (the authored lexicon, C81.3). */
  terms: readonly string[];
  /** ISO 3166-1 alpha-2 (`sourcecountry:` from a fixed table). */
  country?: string | undefined;
  /** At most 250 records (C81.2, H12). */
  maxRecords: number;
  signal?: AbortSignal | undefined;
}

/** C81.2: the articles, whether the record cap was filled, or a wait for the shared budget. */
export type AdverseMediaSearchResult =
  | { outcome: 'articles'; articles: readonly AdverseMediaArticle[]; truncated: boolean }
  | { outcome: 'wait'; retryAt: Date };

export interface AdverseMediaProvider extends ProviderIdentity {
  search(request: AdverseMediaSearch): Promise<AdverseMediaSearchResult>;
}

/** C82.1: breach exposure of one address (HIBP makes it "Subscriber Data", P16). */
export interface EmailIntelligenceResult {
  breachCount: number;
  latestBreachAt: Date | null;
}

export interface EmailIntelligenceProvider extends ProviderIdentity {
  breaches(request: { emailAddress: string }): Promise<EmailIntelligenceResult>;
}

/** C82.2: the network's line type and the carrier, SIM swap and porting facts. */
export interface PhoneIntelligenceResult {
  carrier: string | null;
  lineType:
    'mobile' | 'landline' | 'fixedVoip' | 'nonFixedVoip' | 'prepaid' | 'payphone' | 'other' | null;
  simSwappedAt: Date | null;
  portedAt: Date | null;
  reachable: boolean | null;
  /**
   * Owner decision 5 (c): what the provider checked, in the risk rule's terms, so "not checked" is
   * never read as "no SIM swap". Without it, the dates above are read conservatively.
   */
  lookup?: PhoneIntelligenceLookup | undefined;
}

export interface PhoneIntelligenceProvider extends ProviderIdentity {
  lookup(request: { phoneNumber: string }): Promise<PhoneIntelligenceResult>;
}

/** C82.3 (P16): the normalised components only; an addressee only with `send-addressee`. */
export interface AddressVerificationRequest {
  street1: string;
  street2?: string | undefined;
  city: string;
  subdivision: string;
  postalCode: string;
  /** `US` only: any other country is never sent (`unsupported_country`). */
  countryCode: 'US';
  addressee?: string | undefined;
}

/** C82.3: the DPV, RDI, CMRA, vacancy and other fields of the public shape, by attribute name. */
export interface AddressVerificationResult {
  fields: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AddressVerificationProvider extends ProviderIdentity {
  verify(request: AddressVerificationRequest): Promise<AddressVerificationResult>;
}

/** C83: the report providers one environment kind binds, in the worker only. */
export interface Phase6Providers {
  adverseMedia?: AdverseMediaProvider | undefined;
  emailIntelligence?: EmailIntelligenceProvider | undefined;
  phoneIntelligence?: PhoneIntelligenceProvider | undefined;
  addressVerification?: AddressVerificationProvider | undefined;
  cryptoExposure?: CryptoExposureProvider | undefined;
}

/** C93.5 (Phase 7, Workflow 7A): the port read by both the API (sessions) and the worker (reports). */
export interface Phase7Providers {
  ipReputation?: IpReputationProvider | undefined;
}

// Phase 8, Workflow 8A provider ports (C126.3) ---------------------------------------------------

/**
 * C126.3: one message to a Slack incoming webhook. `webhookUrl` is a workflow secret resolved for
 * this request and nothing else (C125.5), so it is never logged, stored or put in an error.
 */
export interface SlackMessage {
  webhookUrl: string;
  text: string;
}

export interface SlackSendResult {
  /** The provider's id of the accepted message, when it gives one; an incoming webhook does not. */
  providerMessageId?: string | undefined;
}

/** A real Slack adapter (`incoming-webhook`): the message only. */
export interface SlackSender extends ProviderIdentity {
  readonly sandbox: false;
  send(message: SlackMessage): Promise<SlackSendResult>;
}

/**
 * Given only to the sandbox sender (C126.4): which secret it would have posted through, by id, and
 * the step recording it. A sandbox record never holds the URL.
 */
export interface SandboxSlackContext {
  environmentId: string;
  secretId: string;
  workflowRunId: string;
  stepId: string;
  messageRef: string;
}

/** Records and posts nothing, so it is never handed the URL (C126.4, C125.5). */
export interface SandboxSlackSender extends ProviderIdentity {
  readonly sandbox: true;
  send(
    message: Omit<SlackMessage, 'webhookUrl'>,
    context: SandboxSlackContext,
  ): Promise<SlackSendResult>;
}

/**
 * C126.3, C126.5: a Slack adapter failed. A code, `retryable` (proof of non-delivery only) and
 * Slack's `Retry-After`: no body, URL or message.
 */
export class SlackSendError extends Error {
  override name = 'SlackSendError';
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: string, options: { retryable: boolean; retryAfterSeconds?: number }) {
    super(`Slack sending failed (${code})`);
    this.code = code;
    this.retryable = options.retryable;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/**
 * C135.5 (Workflow 8B (F); P23, H20): what a scanner said of an attachment's bytes. Only `clean` is
 * ever served; a clamd answer that is not a clean one, a size-limit refusal included, is `error`.
 */
export interface AttachmentScanResult {
  verdict: 'clean' | 'infected' | 'error';
  provider: 'sandbox' | 'clamd';
}

/**
 * C135.5 (decision 66): the attachment scanner, bound in the worker, where the `case-attachment-scan`
 * job runs. `none` binds nothing, so every attachment is `not_scanned`.
 */
export interface AttachmentScanner {
  readonly provider: 'sandbox' | 'clamd';
  /** Scans the plaintext bytes; the attachment's id is for the provider's log alone. */
  scan(input: { attachmentId: string; bytes: Uint8Array }): Promise<AttachmentScanResult>;
}

/** C126.3, C126.6, C135.5: the Phase 8 providers, bound in the worker, where steps and jobs run. */
export interface Phase8Providers {
  slack?: SlackSender | SandboxSlackSender | undefined;
  attachmentScanner?: AttachmentScanner | undefined;
}

// Phase 10, Workflow 10B provider ports (C211.4) ------------------------------------------------

/**
 * C211.4 (Workflow 10B Stage 1b (I)): what decoding one integrity token takes: the token as the
 * device sent it and the request hash of the challenge it was bound to. The token is never logged,
 * stored outside its sealed column, or put in an error.
 */
export interface DeviceIntegrityDecodeRequest {
  token: string;
  requestHash: string;
}

/**
 * C211.4: a decoded verdict, as `api-integrity` defines it: only the fixed projection (the
 * device-recognition labels, app recognition, the boolean of each server check); every other member
 * of the provider's answer is dropped before this. `api-integrity` may narrow it while nothing reads it.
 */
export type DeviceIntegrityVerdict = Readonly<Record<string, unknown>>;

/**
 * C211.4: the `deviceIntegrity` provider: `play-integrity` decodes through Google's
 * `decodeIntegrityToken` with the operator's service account (in the `integrity-decode` job, never in
 * a request), `sandbox` answers from the magic tokens. Built by `api-integrity`
 * (`services/device-integrity/`); bound by the API (the session's `integrity` member reads whether a
 * provider is bound) and the worker (the decode).
 */
export interface DeviceIntegrityProvider extends ProviderIdentity {
  readonly name: 'play-integrity' | 'sandbox';
  decode(request: DeviceIntegrityDecodeRequest): Promise<DeviceIntegrityVerdict>;
}

/** C211.4 (Workflow 10B): the port read by both the API (the session's member) and the worker. */
export interface Phase10Providers {
  deviceIntegrity?: DeviceIntegrityProvider | undefined;
}

/**
 * Every provider one environment kind binds: the C35 government ID, the C44 selfie, the
 * Workflow 5A and 5B ports, the Phase 6 report ports, the Phase 7 `ipReputation`, Phase 8's
 * `slack` and `attachmentScanner` (C135.5) and Phase 10's `deviceIntegrity` (C211.4).
 */
export type BoundProviders = GovernmentIdProviders &
  SelfieProviders &
  Phase5AProviders &
  Phase5BProviders &
  Phase6Providers &
  Phase7Providers &
  Phase8Providers &
  Phase10Providers;

/** C35, C44: the providers bound per environment kind. */
export type ProviderBindings = Readonly<Record<EnvironmentKind, BoundProviders>>;

// Time and identifiers -------------------------------------------------------

/** Injectable clock, so tests control expiry, timestamps and webhook signatures. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Injectable ID source, so tests can predict `<prefix>_<ULID>` IDs. */
export interface IdGenerator {
  newId<P extends IdPrefix>(prefix: P): Id<P>;
}

export const ulidIdGenerator: IdGenerator = { newId: (prefix) => newId(prefix) };

// Principals (contract C12) ----------------------------------------------------

/**
 * Who a server API request acts for, set by the auth plugin as `request.principal`. An API key
 * holds its scopes as permissions; a dashboard user holds the union of its roles' permissions
 * and acts in its session's current environment. Every query is scoped to `environmentId`.
 */
export type Principal =
  | {
      kind: 'api-key';
      apiKeyId: string;
      organizationId: string;
      environmentId: string;
      environmentKind: 'sandbox' | 'production';
      permissions: ReadonlySet<Permission>;
      /**
       * True for a key minted or cloned by a principal without `pii:view`: it sees PII masked
       * as its creator did (Workflow 2B F001). Absent for every other key, which sees PII.
       */
      piiMasked?: boolean;
      /**
       * C169.3 (Workflow 9B Stage 1b (W)): the key's `attribute-blocklist`, the attributes removed
       * from every document served to it (`applyKeyAttributeBlocklist`). Absent when it has none.
       */
      attributeBlocklist?: readonly string[];
    }
  | {
      kind: 'user';
      userId: string;
      userSessionId: string;
      organizationId: string;
      environmentId: string;
      environmentKind: 'sandbox' | 'production';
      permissions: ReadonlySet<Permission>;
      /** False while the organization requires MFA and this session has not satisfied it. */
      mfaSatisfied: boolean;
    };

export type ApiKeyPrincipal = Extract<Principal, { kind: 'api-key' }>;
export type UserPrincipal = Extract<Principal, { kind: 'user' }>;

/**
 * Resolves a bearer token to the principal it authenticates, or `null` when the token is
 * unknown, expired or revoked (the plugin then answers a generic 401). It may throw an
 * `AppError` to refuse with its own problem. The auth plugin picks the resolver by token
 * prefix: `ov_sbx_` and `ov_prod_` go to API keys, `ovu_` to dashboard user sessions.
 */
export type PrincipalResolver = (
  token: string,
  request: FastifyRequest,
) => Promise<Principal | null>;

/** The C15 audit `actor` of a principal: the API key, or the user (not the session). */
export function actorOf(principal: Principal): AuditActor {
  return principal.kind === 'user'
    ? { type: 'user', id: principal.userId }
    : { type: 'api-key', id: principal.apiKeyId };
}

// Service context -------------------------------------------------------------

/**
 * The tenant a service call acts in, and the request metadata its audit entries record.
 * Routes build it with `serviceContextOf` (`services/context.ts`); background jobs build it
 * from the rows they process and leave the request metadata out.
 */
export interface ServiceContext {
  organizationId: string;
  /** Every query of the call is scoped to this environment. */
  environmentId: string;
  /** `x-request-id` of the HTTP request. */
  requestId?: string | undefined;
  /** The client's address and user agent. PII: audit entries store them encrypted. */
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

// Accounts and redaction (contracts C13 and C16) ------------------------------

export interface ResolveInquiryAccountInput {
  accountId?: string | undefined;
  referenceId?: string | undefined;
}

export interface AccountsService {
  /**
   * The account of a new inquiry (C13), resolved with `tx`, the transaction that creates the
   * inquiry:
   * 1. `accountId`, which must be an account of `ctx.environmentId`;
   * 2. otherwise the account with `referenceId`, created when there is none;
   * 3. otherwise a new account.
   * Events it stages in `tx` (`account.created` for a new account) are appended to `staged`
   * when given, so the caller dispatches them after its commit with its own events instead of
   * leaving them to the dispatcher's sweep (Workflow 2B K002).
   * @returns the account id (`acc_...`).
   * @throws {NotFoundError} when `accountId` is not an account of the environment.
   */
  resolveForInquiry(
    tx: Db,
    ctx: ServiceContext,
    input: ResolveInquiryAccountInput,
    staged?: StagedEvent[],
  ): Promise<string>;
}

export interface RedactionResult {
  /** When the object was redacted: now, or the earlier time when it already was. */
  redactedAt: Date;
  /** True when it had been redacted before this call, which then changed nothing. */
  alreadyRedacted: boolean;
  /**
   * C152.4, C152.8 (Workflow 9A; V08): for an inquiry, the accounts its flow's
   * `update_account_fields` actions copied to, with the keys (never the values), read before its
   * action rows were deleted; redaction does not reach those copies. Absent when there are none.
   */
  flowCopyTargets?: readonly { accountId: string; keys: readonly string[] }[];
}

/**
 * Irreversible, idempotent redaction (C16): files deleted from storage, PII columns nulled,
 * check details emptied and stored event payloads stubbed; later PII requests answer 410.
 * `actor` is the principal that asked, or `null` for a background job such as retention.
 */
export interface RedactionService {
  /** @throws {NotFoundError} when the inquiry is not in `ctx.environmentId`. */
  redactInquiry(
    ctx: ServiceContext,
    inquiryId: string,
    actor: AuditActor | null,
  ): Promise<RedactionResult>;
  /**
   * Redacts the account and every inquiry it holds.
   * @throws {NotFoundError} when the account is not in `ctx.environmentId`.
   */
  redactAccount(
    ctx: ServiceContext,
    accountId: string,
    actor: AuditActor | null,
  ): Promise<RedactionResult>;
  /**
   * C73.5, C73.6: redacts one report (`DELETE /reports/:id`, the report retention), through the
   * report redaction hook (`services/reports/redaction.ts`).
   * @throws {NotFoundError} when the report is not in `ctx.environmentId`.
   */
  redactReport(
    ctx: ServiceContext,
    reportId: string,
    actor: AuditActor | null,
  ): Promise<RedactionResult>;
  /**
   * C105.5: redacts one transaction (`DELETE /transactions/:id`, the transaction retention), through
   * the hook `services/transactions/redaction.ts`.
   * @throws {NotFoundError} when the transaction is not in `ctx.environmentId`.
   */
  redactTransaction(
    ctx: ServiceContext,
    transactionId: string,
    actor: AuditActor | null,
    options?: TransactionRedactionRequest,
  ): Promise<RedactionResult>;
  /**
   * C139.1 (Workflow 8B): redacts one case (`DELETE /cases/:id`, `redact_object`, the case
   * retention) through `redactCasesInTx` (`services/cases/redaction.ts`, `api-cases`), with its runs
   * (C120.9). Held objects are not redacted with it.
   * @throws {NotFoundError} when the case is not in `ctx.environmentId`.
   */
  redactCase(
    ctx: ServiceContext,
    caseId: string,
    actor: AuditActor | null,
  ): Promise<RedactionResult>;
}

/** C105.5, P21: what a transaction's redaction was asked for. */
export interface TransactionRedactionRequest {
  /** `meta.include-never`: an audited override that takes the `never` fields too. */
  includeNever?: boolean;
}

// Audit log (contract C15) ---------------------------------------------------

export interface AuditEntry {
  environmentId: string;
  organizationId: string;
  actor: AuditActor;
  /** Dotted kebab-case action, such as `inquiry.approved` (contracts `auditActionSchema`). */
  action: string;
  /** Such as `inquiry` or `user-session`. */
  resourceType: string;
  resourceId: string;
  /** Encrypted at rest. */
  ipAddress?: string | undefined;
  /** Encrypted at rest. */
  userAgent?: string | undefined;
  /** `x-request-id` of the request that made the change. */
  requestId?: string | undefined;
  /** Details of the action. Never PII. */
  metadata?: Record<string, unknown> | undefined;
}

export interface AuditLogger {
  /**
   * Appends `entry` with `db`. Pass the transaction of the change it records, so a change is
   * never committed without its entry.
   */
  record(db: Db, entry: AuditEntry): Promise<void>;
}

// Rate limiting (contract C12) ----------------------------------------------

/**
 * Workflow 5C review K4: the install-wide pacing of a provider's requests (C61.2, C61.4), such
 * as `pacing:gleif`, named apart from the API policies and the OTP limits.
 */
export type ProviderPacingLimitName = `pacing:${string}`;

/**
 * A limit to apply: `limit` requests per `windowSeconds` for each key, by GCRA. C55.7 (a C12
 * amendment): the OTP limits are rules too, named outside the `RATE_LIMIT_POLICIES` enum, and so
 * is the providers' pacing (Workflow 5C review K4).
 */
export interface RateLimitRule {
  name: RateLimitPolicy | OtpLimitName | ProviderPacingLimitName;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  /** Requests left in the window after this one. */
  remaining: number;
  /** When the window is full again. */
  resetAt: Date;
  /** Whole seconds until a refused request may be retried; 0 when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /**
   * Counts one request for `key` under `policy`, atomically (one Lua script in Valkey).
   * Rejects when the store is unavailable; callers then fail open (C12).
   */
  consume(key: string, policy: RateLimitRule): Promise<RateLimitDecision>;
  /**
   * C240.3, Workflow 11B Stage 1a amendment 22 (KP11-11; integration-11b): the state of `key`'s bucket
   * under `policy` without counting a request (one read-only Lua script): `remaining` is what the
   * caller may still send now. Rejects when the store is unavailable. Optional on the port, so the
   * many test limiters that only count keep their shape; the production limiter implements it.
   */
  peek?(key: string, policy: RateLimitRule): Promise<RateLimitDecision>;
}

// Mail ----------------------------------------------------------------------

export interface MailMessage {
  /**
   * C55.8: an address object, so nodemailer never parses a display name out of a string. Only
   * a validated address reaches it.
   */
  to: { address: string };
  subject: string;
  text: string;
  html?: string | undefined;
  /**
   * C169.8 (Workflow 9B Stage 1b (W); contracts B33): the sending environment's `mail-sender-name`, a
   * display name put before the install-wide From address (`formatSender`, `mail/sender-name.ts`).
   * Absent or `null`: the install-wide From as it is.
   */
  senderName?: string | null | undefined;
}

/** Outgoing email: invitations (C15) and email codes (C55). SMTP in production, Mailpit in development. */
export interface Mailer {
  /** C54.3: whether an SMTP server is set, so the OTP channel guard can refuse email steps (C55.10). */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

// Key-value cache and DNS (C54.3) ---------------------------------------------

/**
 * C54.3: a small key-value store in Valkey for the Phase 5 caches and the sandbox SMS sink. Values
 * are strings the caller encodes; keys never hold PII (hash it first). Every call rejects when
 * Valkey is down, and each caller decides what that means (the OTP limits fail closed).
 */
export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Prepends `value` to the list at `key`, keeps its newest `maxLength` entries and sets the
   * list's TTL, atomically.
   */
  pushCapped(key: string, value: string, maxLength: number, ttlSeconds: number): Promise<void>;
  /** The list at `key`, newest first, at most `limit` entries. */
  listRange(key: string, limit: number): Promise<string[]>;
  /**
   * K8-8 (C124.7): takes lease `leaseId` at `key` when fewer than `limit` live leases are held there,
   * atomically for every process sharing the store; a lease lapses after `ttlSeconds` unless given
   * back, so a crashed holder frees its place. Answers whether it was taken.
   */
  acquireLease(key: string, leaseId: string, limit: number, ttlSeconds: number): Promise<boolean>;
  /** Gives lease `leaseId` at `key` back; one already lapsed is no change. */
  releaseLease(key: string, leaseId: string): Promise<void>;
}

/** C56, C61.3: one MX record. */
export interface MxRecord {
  exchange: string;
  priority: number;
}

/**
 * C54.3: the worker's DNS resolver (`node:dns/promises` `Resolver`, 3 s, 2 tries). Failures throw
 * a `DnsResolverError` naming the kind of failure only, never the host name.
 */
export interface DnsResolver {
  resolveMx(hostname: string): Promise<MxRecord[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  /**
   * C85.2: the TXT records of a name, each as its character strings (4 KiB cap per answer, the MX
   * error mapping and cache: 1 h positive, 5 min negative; `dns/txt.ts`, built by `api-providers`).
   */
  resolveTxt(hostname: string): Promise<string[][]>;
}

// Phase 6 (C83): the crypto exposure port --------------------------------------------------

/** C83: the address a crypto exposure provider rates. */
export interface CryptoExposureRequest {
  /** CAIP-2 (C57.1), or `unknown` (C79.3). */
  chainId: string;
  /** The canonical address (C79.3). */
  address: string;
}

/** C83: what the provider knows; `unavailable` is never a pass. */
export type CryptoExposureResult =
  | {
      outcome: 'rated';
      /** The provider's own categories, such as `sanctioned_entity`. */
      categories: readonly string[];
      /** Direct and indirect exposure shares, 0-1. */
      direct: number;
      indirect: number;
      /**
       * Owner decision 5 (a): the indirect exposure's distance in hops, an integer >= 1, when the
       * provider states it; without it the served distance is 1 ("at least one hop").
       */
      hops?: number | undefined;
    }
  | { outcome: 'unavailable'; reason: 'unsupported_chain' | 'not_found' };

/**
 * C83, F19: the `cryptoExposure` provider (`sandbox` only in Phase 6), called by the crypto job's
 * optional exposure step (`jobs/report-types/crypto-address-watchlist.ts`, `api-reports`) through
 * this port; `api-providers` delivers the provider.
 */
export interface CryptoExposureProvider extends ProviderIdentity {
  exposure(request: CryptoExposureRequest): Promise<CryptoExposureResult>;
}

/**
 * C93.5 (Workflow 7A): what the `ipReputation` provider answers for one address, in the shape
 * `@openverify/signals/network`'s `IpReputationAnswer` takes beside the provider's identity.
 * Commercial anonymous-IP files flag addresses rather than clear them, so `value` is `false` only
 * where the file positively records a negative; otherwise it is `null` (`not_in_provider_data`),
 * which the session's `is-proxy` serves as `null` (C90.3: never an unrecorded `false`).
 */
export interface IpReputationAnswer {
  /** `true` flagged, `false` a recorded negative, `null` not in the provider's data. */
  value: boolean | null;
  /** The file's own kind of anonymiser (`proxy`, `residential_proxy`, `hosting`...), if any. */
  proxyType: string | null;
  /** The file's connection type, the session's `ip-connection-type` when no provider range holds it. */
  connectionType: string | null;
}

/**
 * C93.5, decision 8 (Workflow 7A): the `ipReputation` provider, `mmdb-file` (an operator-licensed
 * MMDB read from `OPENVERIFY_IP_REPUTATION_MMDB_PATH`) or `sandbox` (the magic addresses of C93.6).
 * A lookup is local and synchronous: nothing leaves the process. Built by `api-network`
 * (`providers/ip-reputation/`); bound by both the API and the worker.
 */
export interface IpReputationProvider extends ProviderIdentity {
  lookup(address: string): IpReputationAnswer;
}

/**
 * C92.3 (Workflow 7A): one applied network snapshot held in memory, loaded from
 * `network/<source>/<sha256>` and re-checked against `network_sources.last_sha256`. `data` is the
 * parsed publication `@openverify/signals/network` reads (an MMDB reader or an interval set); the
 * port keeps it opaque, so the lookups stay pure functions of `network-data`'s.
 */
export interface NetworkSnapshot {
  sourceId: string;
  /** Never read for a production environment (C92.3, H26). */
  sandboxOnly: boolean;
  syncId: number;
  publishedAt: Date | null;
  /** When the sync applied it: what an undated publication is dated by (R004). */
  appliedAt?: Date | null;
  sha256: string;
  /** The last successful check, which freshness counts from (C92.4). */
  checkedAt: Date | null;
  /** The bytes held, for the memory figures of C92.3. */
  bytes: number;
  data: unknown;
}

/**
 * C92.3 (Workflow 7A, F41): the in-memory network snapshots of one process (the API and the worker
 * each hold one). `api-network` builds the loader (`network/snapshots.ts`): it loads every enabled
 * source at startup, re-checks the rows every 60 s, swaps a changed source atomically, one at a
 * time, and releases the old snapshot after the swap.
 */
export interface NetworkSnapshots {
  /**
   * The current snapshot of every source an environment of `kind` may read: production never sees
   * a `sandboxOnly` source. The answer is an immutable view; a swap gives a new one.
   */
  current(kind: EnvironmentKind): readonly NetworkSnapshot[];
  /**
   * R002: the sources an environment of `kind` should read that hold no snapshot: never applied, or
   * not loadable. Their facts then read as a gap, never as "not listed".
   */
  unloaded?(kind: EnvironmentKind): readonly string[];
}

/** {@link NetworkSnapshots} with the lifecycle the container and the worker drive. */
export interface ManagedNetworkSnapshots extends NetworkSnapshots {
  /** Loads every enabled source, then starts the 60 s re-check; resolves once the first load ends. */
  start(): Promise<void>;
  /** Stops the re-check and releases every snapshot; later calls do nothing. */
  close(): Promise<void>;
}
