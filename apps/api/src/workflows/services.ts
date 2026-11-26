/**
 * C143.8 (F05, F11; decision 76): the services a workflow action calls, built once in the worker from
 * the factories `container.ts` uses, so an action reads the same service an API route does.
 */
import type { ApiConfig } from '../config.js';
import { createMailer } from '../mail/index.js';
import { createSandboxMailer, type WorkflowMailBinding } from '../mail/sandbox.js';
import { createAccountsService } from '../services/accounts.js';
import { createAuditLogger } from '../services/audit-log.js';
import type { ApiDependencies } from '../services/context.js';
import { biometricListsGate } from '../services/lists/biometric/index.js';
import { createListService } from '../services/lists/item-writer.js';
import { createRedactionService } from '../services/redaction.js';
import {
  createWorkflowEgressConfig,
  type WorkflowEgressConfig,
} from './actions/https/egress-config.js';
import { createWorkflowMessenger } from './actions/messaging/messenger.js';
import type { WorkflowMessenger } from './actions/messaging/port.js';

/** What an action reaches. Everything else stays with the API process. */
export interface WorkflowServices extends Pick<
  ApiDependencies,
  | 'db'
  | 'keyring'
  | 'storage'
  | 'events'
  | 'queue'
  | 'clock'
  | 'ids'
  | 'flowPublicUrl'
  | 'dashboardPublicUrl'
  | 'accounts'
  | 'redaction'
  | 'audit'
  | 'rateLimiter'
  | 'mailer'
  | 'providers'
  | 'blindIndexKey'
  | 'cache'
  | 'outboundHttp'
  | 'reportLimits'
  | 'reportRuns'
  | 'listItemEmbeds'
  | 'graphQueries'
  | 'listService'
  | 'biometricListsGate'
  // C243.1 (Workflow 11A): the install switch and the redemption producer of Connect's steps.
  | 'connect'
  | 'connectRedeems'
  // C251.2 (Workflow 11B, integration-11b): the install's ceiling for a step's redemption (KP11-12).
  | 'queueInFlightCapMax'
> {
  /** C126.8: every message goes through it. */
  messenger: WorkflowMessenger;
  /** C126.4: what the messenger sends a message with, by environment kind. */
  mail: WorkflowMailBinding;
  /** C123.7, C124.3: what the install says about egress and code; the worker closes its runner. */
  egress: WorkflowEgressConfig;
}

/** What the worker already holds, passed in so nothing is built twice. */
export type WorkflowServicesInfra = Pick<
  WorkflowServices,
  | 'db'
  | 'storage'
  | 'events'
  | 'queue'
  | 'clock'
  | 'ids'
  | 'rateLimiter'
  | 'providers'
  | 'cache'
  | 'outboundHttp'
  | 'reportRuns'
  | 'listItemEmbeds'
  | 'graphQueries'
  | 'connectRedeems'
>;

/**
 * Built once in `startWorkers`, with the worker's publisher (F11).
 *
 * The worker's own config holds the SMTP settings (decision 76: workflow messages are sent from the
 * worker), and the SMS and Slack bindings arrive in `infra.providers`.
 */
export function createWorkflowServices(
  config: ApiConfig,
  infra: WorkflowServicesInfra,
): WorkflowServices {
  const { db, storage, events, clock, ids, rateLimiter, providers, cache } = infra;
  const audit = createAuditLogger();
  const mailer = createMailer({
    smtpUrl: config.operators.smtpUrl,
    from: config.operators.mailFrom,
  });
  const mail: WorkflowMailBinding = {
    sandbox: createSandboxMailer({ cache, clock }),
    production: mailer,
  };
  return {
    ...infra,
    keyring: config.keyring,
    flowPublicUrl: config.flowPublicUrl,
    dashboardPublicUrl: config.operators.dashboardPublicUrl,
    accounts: createAccountsService({ events, ids }),
    redaction: createRedactionService({ db, storage, events, clock, audit }),
    audit,
    mailer,
    mail,
    egress: createWorkflowEgressConfig(config.workflows),
    messenger: createWorkflowMessenger({
      db,
      keyring: config.keyring,
      blindIndexKey: config.blindIndexKey,
      providers,
      mail,
      rateLimiter,
      cache,
      clock,
    }),
    blindIndexKey: config.blindIndexKey,
    reportLimits: config.reports,
    listService: createListService({
      db,
      blindIndexKey: config.blindIndexKey,
      rateLimiter,
      events,
    }),
    biometricListsGate,
    // C231.10, C243.1: Connect's steps answer the one 404 while the install keeps Connect off.
    connect: config.connect,
    // C251.2 (integration-11b): the install's ceiling for the redemptions a step admits (KP11-12).
    queueInFlightCapMax: config.queueInFlightCapMax,
  };
}
