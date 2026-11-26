import type { AuditActor } from '@openverify/contracts';
import type { FlowServerTokens } from '../auth/flow-server-token.js';
import type { Db, Keyring } from '@openverify/db';
import type { CaseSettings, ConnectInstallSettings, NfcSettings, ReportLimits } from '../config.js';
import type { TransactionalEventPublisher } from '../events/index.js';
import type { OutboundHttp } from '../http/index.js';
import type { SessionNetworkDeps } from '../network/evaluate.js';
import type {
  AccountsService,
  AuditEntry,
  AuditLogger,
  Clock,
  FileStorage,
  IdGenerator,
  IntegrityDecodeQueue,
  KeyValueCache,
  Mailer,
  Principal,
  PrincipalResolver,
  ProviderBindings,
  RateLimiter,
  RedactionService,
  BiometricListsGate,
  GraphQueryQueue,
  ListImportQueue,
  ListItemEmbedQueue,
  ListService,
  ReportRunQueue,
  ServiceContext,
  VerificationQueue,
  WorkflowStepQueue,
  CaseAttachmentScanQueue,
  CaseBulkQueue,
  CaseExportQueue,
  CaseRenditionQueue,
  ExportQueue,
  FlowSignalSnapshotQueue,
  ReportBulkQueue,
  VisionClient,
  VisionPageCounter,
} from '../ports.js';
import type { WorkflowAdapterFacts } from '../workflows/adapters.js';
import { checkedCaseAuditMetadata } from './cases/audit.js';
import type { ConnectRedeemQueue } from '../jobs/connect-queues.js';
import type { AccountExportQueue } from '../jobs/account-export-queues.js';

/**
 * What the server API (C2, C10-C16) and flow API (C3) routes need. The container builds the
 * real adapters from the configuration; unit tests pass PGlite, in-memory storage and the
 * recording fakes of `test-support/fakes.ts`.
 */
export interface ApiDependencies {
  db: Db;
  /** Seals uploaded files (`encryptBytes`); the same keyring the encrypted columns use. */
  keyring: Keyring;
  storage: FileStorage;
  /**
   * Stage an event in the transaction that makes the change it announces, then dispatch it
   * after the commit, so a change is never committed without its event (C5).
   */
  events: TransactionalEventPublisher;
  queue: VerificationQueue;
  clock: Clock;
  ids: IdGenerator;
  /** `OPENVERIFY_FLOW_PUBLIC_URL`: the base of hosted-flow links. */
  flowPublicUrl: string;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`, resolved: undefined in production without it. */
  dashboardPublicUrl?: string | undefined;
  /** Browser origins allowed to call the flow API (CORS). */
  flowCorsOrigins: readonly string[];
  /**
   * C157.2 (Workflow 9A Stage 1b (F)): `OPENVERIFY_FLOW_SERVER_TOKEN` and its `_PREVIOUS`, which the
   * internal embed-policy route accepts; absent or `null`, that route accepts nothing.
   */
  flowServerTokens?: FlowServerTokens | null | undefined;
  /** C13: the account of every new inquiry (`AccountsService.resolveForInquiry`). */
  accounts: AccountsService;
  /** C16: inquiry and account redaction. */
  redaction: RedactionService;
  /** C15: user audit log entries for every state-changing call. */
  audit: AuditLogger;
  /** C12: GCRA limits in Valkey. */
  rateLimiter: RateLimiter;
  /** C15: invitation emails; C55: email codes (`configured` says whether SMTP is set). */
  mailer: Mailer;
  /**
   * C54.3, C63: the providers this process binds, per environment kind (`createProviderBindings`):
   * the SMS sender, and the database and AAMVA bindings the publish rules read.
   */
  providers: ProviderBindings;
  /** C31.8, C53.4: the blind index key (`OPENVERIFY_BLIND_INDEX_KEY`), for the OTP destination index. */
  blindIndexKey: Uint8Array;
  /** C54.3: the key-value cache in Valkey (the sandbox SMS sink, C55.11). */
  cache: KeyValueCache;
  /** C54.6: the outbound HTTP client factory (Twilio, C55.10). */
  outboundHttp: OutboundHttp;
  /** C55.7: the install ceiling of `otp-sms-max-per-hour` (`OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`). */
  otpSmsMaxPerHourCeiling: number;
  /**
   * C251.2 (Workflow 11B Stage 1b (P); Stage 1a amendment 17): `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`,
   * the install ceiling of every per-environment queue cap, which the settings service holds a cap to
   * (`quotas`'). The container always wires it; absent, `QUEUE_IN_FLIGHT_CAP.ceilingDefault`.
   */
  queueInFlightCapMax?: number | undefined;
  /**
   * C62.7: the trust-store settings this process reads (`OPENVERIFY_TRUST_ANCHOR_REFRESH`,
   * `OPENVERIFY_NFC_ALLOW_ICAO_CRLS`), which the console reports (Workflow 5C review K13).
   */
  nfc: NfcSettings;
  /**
   * C72.5 (P09, V09): the per-environment report limits (`OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE`,
   * `OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT`, `OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY`)
   * the report routes enforce (`api-reports`).
   */
  reportLimits: ReportLimits;
  /**
   * C72.1, C74.5 (Phase 6): the `report-run` producer; the report routes enqueue a run after the
   * transaction that created it commits (creation, `run`, a resume catch-up).
   */
  reportRuns: ReportRunQueue;
  /**
   * C93.2 (Phase 7, Workflow 7A): what the session start's network evaluation reads (the snapshots,
   * the providers, the trust mode, the private-peer watch). The container always wires it; a test
   * that leaves it out starts sessions without evaluating their address.
   */
  network?: SessionNetworkDeps | undefined;
  /**
   * C96.3 (Workflow 7A): the email and SMS handoff sends an environment may make per hour
   * (`OPENVERIFY_HANDOFF_SENDS_PER_HOUR`); `flow-handoff` applies `DEFAULT_HANDOFF_SENDS_PER_HOUR`
   * (`config.ts`) when it is absent.
   */
  handoffSendsPerHour?: number | undefined;
  /**
   * C100.2 (Workflow 7B): the `list-import` producer of the importer route. The container always
   * wires it; without it the `list-import-sweep` still recovers a new import.
   */
  listImports?: ListImportQueue | undefined;
  /**
   * C211.4 (Workflow 10B Stage 1b (I)): the `integrity-decode` producer, which
   * `POST /flow/integrity-tokens` (`api-integrity`) enqueues once the token is sealed. The container
   * always wires it.
   */
  integrityDecodes?: IntegrityDecodeQueue | undefined;
  /**
   * C231.10 (Workflow 11A Stage 1b (C)): the install switch (`OPENVERIFY_CONNECT_ENABLED`). Absent or
   * off, every Connect route answers the one generic 404 and a `share_consent` step fails publish.
   * The container always wires it from the configuration.
   */
  connect?: ConnectInstallSettings | undefined;
  /**
   * C234.2 (Workflow 11A Stage 1b (R)): the `connect-redeem` producer, which the redeem route and the
   * client-side redemption (`api-redeem`, `api-consent`) enqueue once the token is `pending`. The
   * container always wires it.
   */
  connectRedeems?: ConnectRedeemQueue | undefined;
  /**
   * C253.2 (Workflow 11B Stage 1b (D)): the `account-export` producer, which `quotas`' admission
   * enqueues once it admits a held export. The container always wires it.
   */
  accountExports?: AccountExportQueue | undefined;
  /** C99.7 (Workflow 7B): the `list-item-embed` producer of the face and background item routes. */
  listItemEmbeds?: ListItemEmbedQueue | undefined;
  /**
   * C102.4 (Workflow 7B): the `graph-query` producer of `POST /graph-queries` and `/rerun`. The
   * container always wires it; without it the `graph-query-sweep` still runs a submitted query.
   */
  graphQueries?: GraphQueryQueue | undefined;
  /** C99.1 (F08): one item through the list's rules, for the graph's add-to-list (`api-lists`). */
  listService?: ListService | undefined;
  /** C97.4 (F16): whether `biometric-lists-basis` is set (`api-biometric-lists`). */
  biometricListsGate?: BiometricListsGate | undefined;
  /**
   * C117.9: the `workflow-step` producer. A run a route starts, resumes or tests is enqueued after
   * its commit; without it the `workflow-step-sweep` still picks the step up, within 15 s.
   */
  workflowSteps?: WorkflowStepQueue | undefined;
  /** C117.8: `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP`, which an environment's setting overrides. */
  workflowInFlightCap?: number | undefined;
  /**
   * C122.5 (Stage 1b amendment 52): what the worker's adapters are, as facts: steps run there, and
   * this process binds neither Slack nor the code runner.
   */
  workflowAdapters?: WorkflowAdapterFacts | undefined;
  /** C137.4 (Workflow 8B): the `case-bulk` producer, which `POST /cases/bulk` enqueues after commit. */
  caseBulk?: CaseBulkQueue | undefined;
  /** C138.1 (Workflow 8B (F)): the `case-export` producer, which `POST /case-exports` enqueues. */
  caseExports?: CaseExportQueue | undefined;
  /** C135.5: the `case-attachment-scan` producer, which an upload enqueues with a scanner bound. */
  caseAttachmentScans?: CaseAttachmentScanQueue | undefined;
  /** C135.3: the `case-rendition` producer: an upload, and an inquiry file's first request. */
  caseRenditions?: CaseRenditionQueue | undefined;
  /**
   * C150.9 (Workflow 9A Stage 1b (S)): the `flow-signal-snapshot` producer, which
   * `requestSignalSnapshot` (`flow-actions/signal-snapshot.ts`) enqueues once a branch reading
   * signals is entered.
   */
  flowSignalSnapshots?: FlowSignalSnapshotQueue | undefined;
  /**
   * C135.5: the attachment scanner each environment kind binds, by name (`config.cases`); absent, none
   * is bound and every attachment is `not_scanned`.
   */
  attachmentScanners?: CaseSettings['attachmentScanners'] | undefined;
  /**
   * C166.1, C166.5 (Workflow 9B Stage 1b (X)): the `export` and `report-bulk` producers, which
   * `POST /exports` and `POST /reports/bulk` enqueue on after their commit (`api-exports`).
   */
  exports?: ExportQueue | undefined;
  reportBulk?: ReportBulkQueue | undefined;
  /**
   * C160.6 (Workflow 9B, integration-9b): the vision service's rendition endpoint, which a theme
   * logo upload re-encodes through synchronously. Absent, the upload answers 503.
   */
  vision?: (Pick<VisionClient, 'createRendition'> & Partial<VisionPageCounter>) | undefined;
  /**
   * Resolves `ovu_` dashboard user sessions on the server API (C12). Absent until the
   * operators' resolver is wired; user sessions are then refused with 401.
   */
  resolveUserSession?: PrincipalResolver | undefined;
}

/**
 * Exactly the dependencies, from plugin options that may also carry Fastify's own register
 * options (such as `prefix`), so they can be passed on to child plugins safely.
 */
export function dependenciesOf(options: ApiDependencies): ApiDependencies {
  return {
    db: options.db,
    keyring: options.keyring,
    storage: options.storage,
    events: options.events,
    queue: options.queue,
    clock: options.clock,
    ids: options.ids,
    flowPublicUrl: options.flowPublicUrl,
    dashboardPublicUrl: options.dashboardPublicUrl,
    flowCorsOrigins: options.flowCorsOrigins,
    flowServerTokens: options.flowServerTokens,
    accounts: options.accounts,
    redaction: options.redaction,
    audit: options.audit,
    rateLimiter: options.rateLimiter,
    mailer: options.mailer,
    providers: options.providers,
    blindIndexKey: options.blindIndexKey,
    cache: options.cache,
    outboundHttp: options.outboundHttp,
    otpSmsMaxPerHourCeiling: options.otpSmsMaxPerHourCeiling,
    ...(options.queueInFlightCapMax === undefined
      ? {}
      : { queueInFlightCapMax: options.queueInFlightCapMax }),
    nfc: options.nfc,
    reportLimits: options.reportLimits,
    reportRuns: options.reportRuns,
    ...(options.network === undefined ? {} : { network: options.network }),
    ...(options.handoffSendsPerHour === undefined
      ? {}
      : { handoffSendsPerHour: options.handoffSendsPerHour }),
    ...(options.listImports === undefined ? {} : { listImports: options.listImports }),
    ...(options.integrityDecodes === undefined
      ? {}
      : { integrityDecodes: options.integrityDecodes }),
    ...(options.connect === undefined ? {} : { connect: options.connect }),
    ...(options.connectRedeems === undefined ? {} : { connectRedeems: options.connectRedeems }),
    ...(options.accountExports === undefined ? {} : { accountExports: options.accountExports }),
    ...(options.listItemEmbeds === undefined ? {} : { listItemEmbeds: options.listItemEmbeds }),
    ...(options.graphQueries === undefined ? {} : { graphQueries: options.graphQueries }),
    ...(options.listService === undefined ? {} : { listService: options.listService }),
    ...(options.workflowSteps === undefined ? {} : { workflowSteps: options.workflowSteps }),
    ...(options.workflowInFlightCap === undefined
      ? {}
      : { workflowInFlightCap: options.workflowInFlightCap }),
    ...(options.workflowAdapters === undefined
      ? {}
      : { workflowAdapters: options.workflowAdapters }),
    ...(options.caseBulk === undefined ? {} : { caseBulk: options.caseBulk }),
    ...(options.caseExports === undefined ? {} : { caseExports: options.caseExports }),
    ...(options.exports === undefined ? {} : { exports: options.exports }),
    ...(options.reportBulk === undefined ? {} : { reportBulk: options.reportBulk }),
    ...(options.vision === undefined ? {} : { vision: options.vision }),
    ...(options.caseAttachmentScans === undefined
      ? {}
      : { caseAttachmentScans: options.caseAttachmentScans }),
    ...(options.caseRenditions === undefined ? {} : { caseRenditions: options.caseRenditions }),
    ...(options.flowSignalSnapshots === undefined
      ? {}
      : { flowSignalSnapshots: options.flowSignalSnapshots }),
    ...(options.attachmentScanners === undefined
      ? {}
      : { attachmentScanners: options.attachmentScanners }),
    ...(options.biometricListsGate === undefined
      ? {}
      : { biometricListsGate: options.biometricListsGate }),
    ...(options.resolveUserSession === undefined
      ? {}
      : { resolveUserSession: options.resolveUserSession }),
  };
}

/** Request metadata recorded with audit entries: the request id, client address and agent. */
export interface RequestMetadata {
  requestId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * The service context of a call made for `principal`: its organization and environment, plus
 * the request metadata audit entries record. Callers choose the client address (for example
 * `request.ip`, which honours the trust-proxy setting).
 */
export function serviceContextOf(
  principal: Principal,
  metadata: RequestMetadata = {},
): ServiceContext {
  return {
    organizationId: principal.organizationId,
    environmentId: principal.environmentId,
    ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId }),
    ...(metadata.ipAddress === undefined ? {} : { ipAddress: metadata.ipAddress }),
    ...(metadata.userAgent === undefined ? {} : { userAgent: metadata.userAgent }),
  };
}

/** What an audit entry records about the action itself. */
export interface AuditedAction {
  /** Dotted kebab-case action, such as `inquiry.approved`. */
  action: string;
  resourceType: string;
  resourceId: string;
  /** Never PII. */
  metadata?: Record<string, unknown> | undefined;
}

/** The C15 audit entry of `action` by `actor`, with the tenant and metadata of `ctx`. */
export function auditEntryOf(
  ctx: ServiceContext,
  actor: AuditActor,
  action: AuditedAction,
): AuditEntry {
  return {
    environmentId: ctx.environmentId,
    organizationId: ctx.organizationId,
    actor,
    action: action.action,
    resourceType: action.resourceType,
    resourceId: action.resourceId,
    ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
    ...(ctx.ipAddress === undefined ? {} : { ipAddress: ctx.ipAddress }),
    ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
    ...(action.metadata === undefined
      ? {}
      : // K8-22: a case action's metadata is held to its strict schema (P19).
        { metadata: checkedCaseAuditMetadata(action.action, action.metadata) }),
  };
}
