/**
 * The composition root: every adapter, built from the configuration with the fixed factories
 * (`createFileStorage`, `createVerificationQueue`, `createEventPublisher`, `createVisionClient`)
 * and wired into the HTTP API, including the dashboard routes. Nothing connects until it is
 * used: the Postgres pool opens connections on the first query, and the C12 rate limiter's
 * Valkey client on the first limited request. BullMQ queues connect to Valkey when created, so
 * tests inject recording queues instead.
 */
import {
  createDatabase,
  setDefaultKeyring,
  useAuditIpIndexKey,
  type Database,
} from '@openverify/db';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { createDbApiKeyAuthenticator } from './auth/api-key-lookup.js';
import type { ApiConfig } from './config.js';
import { createEventPublisher, type TransactionalEventPublisher } from './events/index.js';
import {
  createListRescreenQueue,
  type ClosableListRescreenQueue,
} from './jobs/list-rescreen-queue.js';
import { createCaseBulkQueue, type ClosableCaseBulkQueue } from './jobs/case-bulk-queue.js';
import {
  createExportQueue,
  createReportBulkQueue,
  type ClosableExportQueue,
  type ClosableReportBulkQueue,
} from './jobs/export-queues.js';
import {
  createCaseAttachmentScanQueue,
  createCaseExportQueue,
  createCaseRenditionQueue,
  type ClosableCaseAttachmentScanQueue,
  type ClosableCaseExportQueue,
  type ClosableCaseRenditionQueue,
} from './jobs/case-file-queues.js';
import {
  createFlowSignalSnapshotQueue,
  type ClosableFlowSignalSnapshotQueue,
} from './jobs/flow-queues.js';
import {
  createIntegrityDecodeQueue,
  type ClosableIntegrityDecodeQueue,
} from './jobs/integrity-queues.js';
import {
  createBullQueue,
  createVerificationQueue,
  type ClosableVerificationQueue,
} from './jobs/index.js';
import type { LoggerSettings } from './logger.js';
import type { SessionNetworkDeps } from './network/evaluate.js';
import {
  createListImportQueue,
  createListItemEmbedQueue,
  type ClosableListImportQueue,
  type ClosableListItemEmbedQueue,
} from './jobs/list-queues.js';
import { createReportRunQueue, type ClosableReportRunQueue } from './jobs/report-queues.js';
import {
  installQueueLimitsOf,
  withReportRunAdmission,
  withVerificationAdmission,
} from './jobs/admitted-producers.js';
import { createGraphQueryQueue, type ClosableGraphQueryQueue } from './jobs/graph-queues.js';
import {
  createWorkflowStepQueue,
  createWorkflowTriggerQueue,
  createWorkflowWaitMatchQueue,
  type ClosableWorkflowStepQueue,
  type ClosableWorkflowTriggerQueue,
  type ClosableWorkflowWaitMatchQueue,
} from './jobs/workflow-queues.js';
import { biometricListsGate } from './services/lists/biometric/index.js';
import { createListService } from './services/lists/item-writer.js';
import { useGraphIndexKey } from './services/graph/keys.js';
import { createCacheRedis, createKeyValueCache } from './cache/index.js';
import { createOutboundHttp, type OutboundHttp } from './http/index.js';
import { createProviderBindings } from './providers/index.js';
import { createMailer } from './mail/index.js';
// api-operators: begin
import { createOperatorAuth, createUserSessionPrincipalResolver } from './operator-auth/index.js';
// api-operators: end
// foundation-11b: begin (Workflow 11B Stage 1b common; review F30)
import { applyStoreTls } from './config/store-tls.js';
import {
  createSharedLoginRateLimiter,
  type LoginRateLimiter,
} from './operator-auth/login-rate-limiter.js';
// foundation-11b: end
import {
  systemClock,
  ulidIdGenerator,
  type Clock,
  type IdGenerator,
  type KeyValueCache,
  type ManagedNetworkSnapshots,
  type NetworkSnapshots,
  type ProviderBindings,
  type RateLimiter,
  type VisionClient,
} from './ports.js';
import {
  closeRateLimitRedis,
  createRateLimiter,
  createRateLimitRedis,
} from './rate-limit/index.js';
import { dashboardRoutes } from './routes/dashboard/index.js';
import { createAccountsService } from './services/accounts.js';
import { createAuditLogger } from './services/audit-log.js';
import type { ApiDependencies } from './services/context.js';
import { createWorkerLogger, type WorkerLogger } from './jobs/logger.js';
import { logPoolErrors } from './pool-errors.js';
import { createRedactionService } from './services/redaction.js';
import { createFileStorage, type ClosableFileStorage } from './storage/index.js';
import { createVisionClient } from './vision/index.js';
import { reconcileWatchlistSources } from './watchlists/reconcile.js';
import { watchlistReconcileOptIn } from './watchlists/un-opt-in.js';
import { createNetworkSnapshots } from './network/snapshots.js';
import { reconcileNetworkSources } from './network/reconcile.js';
import { warnOnPrivatePeers } from './network/private-peers.js';
import {
  createWebhookDeliveryScheduler,
  WEBHOOK_DELIVERY_QUEUE,
  type WebhookDeliveryJob,
  type WebhookDeliveryScheduler,
} from './webhooks/queue.js';
import {
  createConnectRedeemQueue,
  type ClosableConnectRedeemQueue,
} from './jobs/connect-queues.js';
import {
  createAccountExportQueue,
  type ClosableAccountExportQueue,
} from './jobs/account-export-queues.js';

export type ClosableDeliveryScheduler = WebhookDeliveryScheduler & { close(): Promise<void> };

/**
 * C76.4: how long the API's ready waits for the watchlist source rows. The rows are not needed to
 * serve, so a slow reconciliation (a lock or I/O wait under load) must not reach Fastify's
 * onReady hook timeout (10 s), which stops the API.
 */
export const WATCHLIST_RECONCILE_READY_WAIT_MS = 5_000;

/**
 * C92.3 (Workflow 7A): how long the API's ready waits for the network source rows and the first
 * snapshot load, as {@link WATCHLIST_RECONCILE_READY_WAIT_MS} does for the watchlist rows.
 */
export const NETWORK_READY_WAIT_MS = 5_000;

/** Adapters to use instead of building them from the configuration (tests, embedding). */
export interface ContainerOverrides {
  pool?: Pool;
  /** Logs what happens outside a request (a lost database connection); pino by default. */
  logger?: WorkerLogger;
  storage?: ClosableFileStorage;
  verificationQueue?: ClosableVerificationQueue;
  webhookDeliveries?: ClosableDeliveryScheduler;
  /** C74.1 (Phase 6): the `report-run` producer; by default one that connects on first use. */
  reportRuns?: ClosableReportRunQueue;
  /** C100.2 (Workflow 7B): the `list-import` producer; by default one that connects on first use. */
  listImports?: ClosableListImportQueue;
  /** C99.7 (Workflow 7B): the `list-item-embed` producer; the same. */
  listItemEmbeds?: ClosableListItemEmbedQueue;
  /** C102.4 (Workflow 7B): the `graph-query` producer; the same. */
  graphQueries?: ClosableGraphQueryQueue;
  /** C118.1, C119.3 (F02, Workflow 8A): the engine's producers; the same. */
  workflowSteps?: ClosableWorkflowStepQueue;
  workflowTriggers?: ClosableWorkflowTriggerQueue;
  workflowWaitMatches?: ClosableWorkflowWaitMatchQueue;
  /** C127.12: the `list-rescreen` producer; the same. */
  listRescreens?: ClosableListRescreenQueue;
  /** C137.4 (Workflow 8B): the `case-bulk` producer; the same. */
  caseBulk?: ClosableCaseBulkQueue;
  /** C135.3, C135.5, C138.1 (Workflow 8B (F)): the case file producers; the same. */
  caseExports?: ClosableCaseExportQueue;
  caseAttachmentScans?: ClosableCaseAttachmentScanQueue;
  caseRenditions?: ClosableCaseRenditionQueue;
  /** C150.9 (Workflow 9A Stage 1b (S)): the `flow-signal-snapshot` producer; the same. */
  flowSignalSnapshots?: ClosableFlowSignalSnapshotQueue;
  /** C211.4 (Workflow 10B Stage 1b (I)): the `integrity-decode` producer; the same. */
  integrityDecodes?: ClosableIntegrityDecodeQueue;
  /** C234.2 (Workflow 11A Stage 1b (R)): the `connect-redeem` producer; by default one on first use. */
  connectRedeems?: ClosableConnectRedeemQueue;
  /** C253.2 (Workflow 11B Stage 1b (D)): the `account-export` producer; the same. */
  accountExports?: ClosableAccountExportQueue;
  /** C166.1, C166.5 (Workflow 9B Stage 1b (X)): the `export` and `report-bulk` producers; the same. */
  exports?: ClosableExportQueue;
  reportBulk?: ClosableReportBulkQueue;
  vision?: VisionClient;
  clock?: Clock;
  ids?: IdGenerator;
  /** C12 limiter; by default GCRA in the Valkey at `REDIS_URL`. */
  rateLimiter?: RateLimiter;
  /** C54.3: the key-value cache; by default on its own lazy Valkey client at `REDIS_URL`. */
  cache?: ClosableKeyValueCache;
  /** C54.6: the outbound HTTP client factory; by default the vetted undici one. */
  outboundHttp?: OutboundHttp;
  /** C92.3 (Workflow 7A): the network snapshots; by default `createNetworkSnapshots`. */
  networkSnapshots?: ManagedNetworkSnapshots;
  /** C246.1 (Workflow 11B): the console's login limiter; by default `createSharedLoginRateLimiter`. */
  loginRateLimiter?: LoginRateLimiter;
}

/** A key-value cache the container closes with the rest. */
export type ClosableKeyValueCache = KeyValueCache & { close(): Promise<void> };

export type ApiApp = ReturnType<typeof buildApp>;

export interface Container {
  readonly config: ApiConfig;
  readonly pool: Pool;
  readonly db: Database;
  readonly storage: ClosableFileStorage;
  readonly queue: ClosableVerificationQueue;
  readonly events: TransactionalEventPublisher;
  readonly vision: VisionClient;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly rateLimiter: RateLimiter;
  /** C54.3, C63: the API process's providers (`sms`, `database`, `aamva`), per environment kind. */
  readonly providers: ProviderBindings;
  /** C54.3: the key-value cache in Valkey. */
  readonly cache: KeyValueCache;
  /** C54.6: the outbound HTTP client factory. */
  readonly outboundHttp: OutboundHttp;
  /** C92.3 (Workflow 7A): the API process's network snapshots, started when the API is ready. */
  readonly networkSnapshots: NetworkSnapshots;
  /** C93.2 (Workflow 7A): what each session start's network evaluation reads. */
  readonly sessionNetwork: SessionNetworkDeps | undefined;
  /** The HTTP API with every route (server, flow, dashboard), configured from `config`. */
  buildApp(options?: { logger?: LoggerSettings | false }): ApiApp;
  /**
   * Closes the queues, the storage client, the rate limiter's and the cache's Valkey clients,
   * the outbound HTTP agents and the pool; later calls wait for the first.
   */
  close(): Promise<void>;
}

/**
 * The C12 limiter: the injected one, or GCRA on its own lazy Valkey client, which the
 * container closes. It shares no connection with BullMQ, whose blocking commands must not
 * delay a request.
 */
function rateLimiterFor(
  config: ApiConfig,
  overrides: ContainerOverrides,
  clock: Clock,
): { rateLimiter: RateLimiter; close(): Promise<void> } {
  if (overrides.rateLimiter !== undefined) {
    return { rateLimiter: overrides.rateLimiter, close: () => Promise.resolve() };
  }
  const redis = createRateLimitRedis(config.redisUrl);
  return {
    rateLimiter: createRateLimiter({ redis, clock }),
    close: () => closeRateLimitRedis(redis),
  };
}

/** C54.3: the key-value cache on its own lazy Valkey client, which closing releases. */
function closableCache(redisUrl: string): ClosableKeyValueCache {
  const redis = createCacheRedis(redisUrl);
  return { ...createKeyValueCache({ redis }), close: () => closeRateLimitRedis(redis) };
}

/**
 * Builds the adapters for `config` and installs its keyring as the default keyring of the
 * encrypted columns (`setDefaultKeyring`).
 */
export function createContainer(config: ApiConfig, overrides: ContainerOverrides = {}): Container {
  // C249.1 (Workflow 11B; platform-ops' store-tls.ts): the stores' TLS settings, before any client.
  applyStoreTls(config.storeTls);
  setDefaultKeyring(config.keyring);
  // C101.3 (Workflow 7B): the in-transaction graph indexer keys values with this process's key.
  useGraphIndexKey(config.blindIndexKey);
  // C168.6 (Workflow 9B): the audit log's IP index keys addresses with the same key.
  useAuditIpIndexKey(config.blindIndexKey);
  const connection = { url: config.redisUrl };
  const pool = overrides.pool ?? new Pool({ connectionString: config.databaseUrl });
  const logger =
    overrides.logger ?? createWorkerLogger({ name: 'openverify-api', level: config.logLevel });
  logPoolErrors(pool, logger);
  const db = createDatabase(pool);
  const storage = overrides.storage ?? createFileStorage({ driver: 's3', ...config.s3 });
  // C251.1 (Workflow 11B Stage 1b (P), `foundation-11b`'s hook): every process-verification and
  // report-run enqueue asks the admission first (`services/quotas/admit.ts`, quotas').
  const admission = {
    db,
    clock: overrides.clock ?? systemClock,
    // C251.2 (integration-11b): the install's ceiling and workflow-step default, not the contract's 50.
    limits: installQueueLimitsOf(config),
  };
  const queue =
    overrides.verificationQueue ??
    withVerificationAdmission(createVerificationQueue({ connection }), admission);
  const reportRuns =
    overrides.reportRuns ?? withReportRunAdmission(createReportRunQueue({ connection }), admission);
  const listImports = overrides.listImports ?? createListImportQueue({ connection });
  const listItemEmbeds = overrides.listItemEmbeds ?? createListItemEmbedQueue({ connection });
  const graphQueries = overrides.graphQueries ?? createGraphQueryQueue({ connection });
  const deliveries =
    overrides.webhookDeliveries ??
    createWebhookDeliveryScheduler(
      createBullQueue<WebhookDeliveryJob>(WEBHOOK_DELIVERY_QUEUE, { connection }),
    );
  // C118.1, C119.3 (F02): the engine's producers, which connect on first use.
  const workflowSteps = overrides.workflowSteps ?? createWorkflowStepQueue({ connection });
  const workflowTriggers = overrides.workflowTriggers ?? createWorkflowTriggerQueue({ connection });
  const workflowWaitMatches =
    overrides.workflowWaitMatches ?? createWorkflowWaitMatchQueue({ connection });
  const listRescreens = overrides.listRescreens ?? createListRescreenQueue({ connection });
  const caseBulk = overrides.caseBulk ?? createCaseBulkQueue({ connection });
  const caseExports = overrides.caseExports ?? createCaseExportQueue({ connection });
  // C166.1, C166.5 (Workflow 9B Stage 1b (X)): the export and bulk report producers.
  const exportJobs = overrides.exports ?? createExportQueue({ connection });
  const reportBulkJobs = overrides.reportBulk ?? createReportBulkQueue({ connection });
  const caseAttachmentScans =
    overrides.caseAttachmentScans ?? createCaseAttachmentScanQueue({ connection });
  const caseRenditions = overrides.caseRenditions ?? createCaseRenditionQueue({ connection });
  const flowSignalSnapshots =
    overrides.flowSignalSnapshots ?? createFlowSignalSnapshotQueue({ connection });
  const integrityDecodes = overrides.integrityDecodes ?? createIntegrityDecodeQueue({ connection });
  const connectRedeems = overrides.connectRedeems ?? createConnectRedeemQueue({ connection });
  const accountExports = overrides.accountExports ?? createAccountExportQueue({ connection });
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? ulidIdGenerator;
  const events = createEventPublisher({
    db,
    deliveries,
    ids,
    workflowTriggers,
    workflowSteps: workflowWaitMatches,
    listRescreens,
  });
  const vision =
    overrides.vision ??
    createVisionClient({ baseUrl: config.vision.url, serviceToken: config.vision.serviceToken });

  // Phase 2 ports (api-foundation placed each stub factory call in its owner's block).
  // api-lifecycle: begin
  const accounts = createAccountsService({ events, ids });
  const redaction = createRedactionService({
    db,
    storage,
    events,
    clock,
    // `audit` is built in the api-operators block below; it is only read once a request runs.
    audit: { record: (tx, entry) => audit.record(tx, entry) },
  });
  // api-lifecycle: end
  // api-operators: begin
  const { operators } = config;
  const audit = createAuditLogger();
  const mailer = createMailer({ smtpUrl: operators.smtpUrl, from: operators.mailFrom });
  // C246.1 (Workflow 11B; auth-sessions' login-rate-limiter.ts): the login limiter every API
  // instance shares, released with the container.
  const loginLimits =
    overrides.loginRateLimiter === undefined
      ? createSharedLoginRateLimiter({
          redisUrl: config.redisUrl,
          blindIndexKey: config.blindIndexKey,
          clock,
        })
      : { limiter: overrides.loginRateLimiter, close: () => Promise.resolve() };
  // One operator auth for the dashboard routes, so login limits and MFA share their state.
  const operatorAuth = createOperatorAuth({
    db,
    clock,
    ids,
    bffToken: operators.bffToken,
    webauthn: operators.webauthn,
    rateLimiter: loginLimits.limiter,
    // C245.1 (Workflow 11B Stage 1b (A)): the console's session limits.
    sessionTimeouts: config.consoleSessions,
  });
  const userSessions: Pick<ApiDependencies, 'resolveUserSession'> = {
    resolveUserSession: createUserSessionPrincipalResolver({
      db,
      clock,
      sessionTimeouts: config.consoleSessions,
    }),
  };
  // api-operators: end
  const limits = rateLimiterFor(config, overrides, clock);
  const { rateLimiter } = limits;
  // C54.3: the Workflow 5A dependencies. The cache has its own lazy Valkey client, as the
  // limiter has; the providers are the API process's (C63: sms, database, aamva).
  const cache = overrides.cache ?? closableCache(config.redisUrl);
  const outboundHttp = overrides.outboundHttp ?? createOutboundHttp();
  const providers = createProviderBindings(config.providers, {
    clock,
    twilio: config.twilio,
    outboundHttp,
    cache,
    // C93.5 (Workflow 7A): the session evaluation's ipReputation file.
    ipReputation: { mmdbPath: config.network.ipReputationMmdbPath },
  });
  // C92.3, C93.1, C93.2 (Workflow 7A, F41): the API's network snapshots (started when the API is
  // ready, released on close), the trust-mode warnings, and what each session start evaluates.
  const networkSnapshots =
    overrides.networkSnapshots ?? createNetworkSnapshots({ db, storage, clock, logger });
  const sessionNetwork: SessionNetworkDeps = {
    snapshots: networkSnapshots,
    providers,
    trustProxy: config.trustProxy,
    privatePeers: warnOnPrivatePeers(logger, config.trustProxy),
    ids,
    logger,
  };

  const deps: ApiDependencies = {
    db,
    // C160.6 (Workflow 9B): theme logo uploads re-encode through the vision rendition endpoint.
    vision,
    keyring: config.keyring,
    storage,
    events,
    queue,
    clock,
    ids,
    flowPublicUrl: config.flowPublicUrl,
    dashboardPublicUrl: operators.dashboardPublicUrl,
    workflowSteps,
    caseBulk,
    caseExports,
    caseAttachmentScans,
    caseRenditions,
    flowSignalSnapshots,
    exports: exportJobs,
    reportBulk: reportBulkJobs,
    // C135.5 (Workflow 8B (F)): which scanner each environment kind binds, by name.
    attachmentScanners: config.cases.attachmentScanners,
    workflowInFlightCap: config.workflows.inFlightCap,
    workflowAdapters: {
      slackBound: config.workflows.slackBound,
      codeEnabled: config.workflows.codeEnabled,
    },
    flowCorsOrigins: config.flowCorsOrigins,
    // C157.2 (Workflow 9A Stage 1b (F)): the internal embed-policy route's credential.
    flowServerTokens: config.flowServerTokens,
    accounts,
    redaction,
    audit,
    rateLimiter,
    mailer,
    providers,
    blindIndexKey: config.blindIndexKey,
    cache,
    outboundHttp,
    otpSmsMaxPerHourCeiling: config.otpSmsMaxPerHourCeiling,
    // C251.2 (Workflow 11B Stage 1b (P)): the queue caps' install ceiling, for the settings service.
    queueInFlightCapMax: config.queueInFlightCapMax,
    nfc: config.nfc,
    reportLimits: config.reports,
    reportRuns,
    network: sessionNetwork,
    // C96.3, C107.8 (Workflow 7A): the per-environment handoff send budget.
    handoffSendsPerHour: config.handoff.sendsPerHour,
    // C97.4, C99.1, C99.7, C100.2 (Workflow 7B): the list producers and ports.
    listImports,
    // C211.4 (Workflow 10B Stage 1b (I)): the token route's decode producer.
    integrityDecodes,
    // C231.10 (Workflow 11A Stage 1b (C)): the install switch every Connect route and the publish
    // hook read.
    connect: config.connect,
    // C234.2 (Workflow 11A Stage 1b (R)): the redemptions' producer.
    connectRedeems,
    // C253.2 (Workflow 11B Stage 1b (D)): the access exports' producer (quotas' admission).
    accountExports,
    listItemEmbeds,
    // C102.4 (Workflow 7B): the graph-query producer.
    graphQueries,
    listService: createListService({
      db,
      blindIndexKey: config.blindIndexKey,
      rateLimiter,
      events,
    }),
    biometricListsGate,
    ...userSessions,
  };
  const apiKeys = createDbApiKeyAuthenticator({ db, pepper: config.apiKeyPepper, clock });

  let closing: Promise<void> | undefined;
  async function closeAll(): Promise<void> {
    const results = await Promise.allSettled([
      queue.close(),
      reportRuns.close(),
      listImports.close(),
      listItemEmbeds.close(),
      graphQueries.close(),
      workflowSteps.close(),
      workflowTriggers.close(),
      workflowWaitMatches.close(),
      listRescreens.close(),
      caseBulk.close(),
      caseExports.close(),
      exportJobs.close(),
      reportBulkJobs.close(),
      caseAttachmentScans.close(),
      caseRenditions.close(),
      flowSignalSnapshots.close(),
      integrityDecodes.close(),
      connectRedeems.close(),
      accountExports.close(),
      deliveries.close(),
      storage.close(),
      limits.close(),
      loginLimits.close(),
      cache.close(),
      outboundHttp.close(),
      networkSnapshots.close(),
      pool.end(),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason as unknown),
        'Closing the container failed',
      );
    }
  }

  return {
    config,
    pool,
    db,
    storage,
    queue,
    events,
    vision,
    clock,
    ids,
    rateLimiter,
    providers,
    cache,
    outboundHttp,
    networkSnapshots,
    sessionNetwork,
    buildApp(options = {}) {
      const app = buildApp({
        lookupApiKey: apiKeys.lookup,
        onAuthenticated: apiKeys.touch,
        now: () => clock.now(),
        mode: config.mode,
        logger: options.logger ?? { level: config.logLevel },
        trustProxy: config.trustProxy,
        api: deps,
        // C12, C72.5: the per-key `api` limit and the per-environment `reports` limit.
        rateLimits: { api: config.rateLimits.apiPerMinute, reports: config.reports.perMinute },
        apiKeyPepper: config.apiKeyPepper,
        // C250.3, C255.1 (Workflow 11B; platform-ops' hooks): the internal routes' listener and HSTS.
        internalListen: config.internalListen,
        hstsMaxAge: config.hstsMaxAge,
      });
      // C76.4 (V01): the watchlist source rows, reconciled from the manifest when the API is
      // ready, as the built-in roles are. A failure is logged, not fatal: the rows already stored
      // keep working, and the next start reconciles again. Ready waits for it at most
      // WATCHLIST_RECONCILE_READY_WAIT_MS, then lets it finish in the background.
      app.addHook('onReady', async () => {
        const reconciled = (async () => {
          try {
            await reconcileWatchlistSources(db, {
              disabled: config.watchlists.sourcesDisabled,
              clock,
              // C254.1 (Q10 granted; KP11-31): an environment's recorded UN opt-in, while allowed.
              ...(await watchlistReconcileOptIn(db, config.watchlistUnOptInAllowed)),
            });
          } catch (error) {
            app.log.error({ error: (error as Error).name }, 'watchlist sources not reconciled');
          }
          return true;
        })();
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            resolve(false);
          }, WATCHLIST_RECONCILE_READY_WAIT_MS).unref();
        });
        if (!(await Promise.race([reconciled, deadline]))) {
          app.log.warn('watchlist sources still reconciling; the API is ready without them');
        }
        clearTimeout(timer);
      });
      // C92.3, C92.5 (Workflow 7A, F41): the network source rows, then the snapshots. Neither is
      // needed to serve (until they load every network fact reads `list_unavailable`), so ready
      // waits for them at most NETWORK_READY_WAIT_MS and lets them finish in the background. A
      // failure is logged by its name; the next start tries again.
      app.addHook('onReady', async () => {
        const loaded = (async () => {
          try {
            await reconcileNetworkSources(db, { ...config.network, clock });
          } catch (error) {
            app.log.error({ error: (error as Error).name }, 'network sources not reconciled');
          }
          try {
            await networkSnapshots.start();
          } catch (error) {
            app.log.error({ error: (error as Error).name }, 'network snapshots not loaded');
          }
          return true;
        })();
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            resolve(false);
          }, NETWORK_READY_WAIT_MS).unref();
        });
        if (!(await Promise.race([loaded, deadline]))) {
          app.log.warn('network snapshots still loading; the API is ready without them');
        }
        clearTimeout(timer);
      });
      void app.register(dashboardRoutes, {
        prefix: '/api/v1/dashboard',
        db,
        storage,
        keyring: config.keyring,
        // C135.3 (Workflow 8B (F)): an inquiry file's first rendition request.
        caseRenditions,
        // C231.10 (Workflow 11A Stage 1b (C)): the activation route's install switch.
        connect: config.connect,
        // C248.3 (Workflow 11B Stage 1b (A)): the SSO service's outbound client and private issuers.
        sso: {
          outboundHttp,
          privateIssuers: config.sso.privateIssuers,
          production: config.mode === 'production',
        },
        // api-operators: begin
        operatorAuth,
        admin: {
          api: deps,
          dashboardPublicUrl: operators.dashboardPublicUrl,
          // Keep every organization's built-in roles in step with core at startup (C15).
          syncBuiltinRolesOnReady: true,
          // C254.1 (Q10 granted; KP11-31): the UN opt-in's install switch, for its routes.
          watchlistUnOptInAllowed: config.watchlistUnOptInAllowed,
        },
        // api-operators: end
      });
      return app;
    },
    close() {
      closing ??= closeAll();
      return closing;
    },
  };
}
