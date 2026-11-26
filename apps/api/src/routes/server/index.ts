import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { accountActionRoutes } from './account-actions.js';
import { accountTypeRoutes } from './account-types.js';
import { accountRoutes } from './accounts.js';
import { apiKeyRoutes } from './api-keys.js';
import { apiLogRoutes } from './api-logs.js';
import { deviceTrustRoutes } from './device-trust.js';
import { deviceRoutes } from './devices.js';
import { inquiryDecisionRoutes } from './inquiry-decisions.js';
import { eventRoutes } from './events.js';
import { graphQueryRoutes } from './graph-queries.js';
import { graphQueryTemplateVersionRoutes } from './graph-query-template-versions.js';
import { graphQueryTemplateRoutes } from './graph-query-templates.js';
import { importerRoutes } from './importers.js';
import { inquiryRoutes } from './inquiries.js';
import { inquirySessionRoutes } from './inquiry-sessions.js';
import { inquiryTemplateVersionRoutes } from './inquiry-template-versions.js';
import { inquiryTemplateRoutes } from './inquiry-templates.js';
import { inquiryTemplateTranslationRoutes } from './inquiry-template-translations.js';
import { deploymentRoutes } from './deployments.js';
import { themeSetRoutes } from './theme-sets.js';
import { exportRoutes } from './exports.js';
import { reportBulkRoutes } from './reports-bulk.js';
import { webhookDeliverySearchRoutes } from './webhook-delivery-search.js';
import { analyticsRoutes } from './analytics.js';
import { listItemRoutes } from './list-items.js';
import { listMatchRoutes } from './list-matches.js';
import { listRoutes } from './lists.js';
import { rateLimitRoutes } from './rate-limits.js';
import { connectConnectionRoutes } from './connect-connections.js';
import { connectConsentRecordRoutes } from './connect-consent-records.js';
import { connectRedeemRoutes } from './connect-redeem.js';
import { accountExportRoutes } from './account-exports.js';
import { connectShareTokenRoutes } from './connect-share-tokens.js';
import { reportTemplateVersionRoutes } from './report-template-versions.js';
import { reportTemplateRoutes } from './report-templates.js';
import { reportRoutes } from './reports.js';
import { sandboxMessageRoutes } from './sandbox-messages.js';
import { transactionTypeVersionRoutes } from './transaction-type-versions.js';
import { transactionTypeRoutes } from './transaction-types.js';
import { transactionRoutes } from './transactions.js';
import { userAuditLogRoutes } from './user-audit-logs.js';
import { verificationRoutes } from './verifications.js';
import { webhookDeliveryRoutes } from './webhook-deliveries.js';
import { webhookRoutes } from './webhooks.js';
import { workflowActionRoutes } from './workflow-actions.js';
import { workflowRecipeRoutes } from './workflow-recipes.js';
import { workflowRunRoutes } from './workflow-runs.js';
import { workflowSecretRoutes } from './workflow-secrets.js';
import { workflowTestRunRoutes } from './workflow-test-runs.js';
import { workflowTriggerRoutes } from './workflow-triggers.js';
import { workflowVersionRoutes } from './workflow-versions.js';
import { workflowRoutes } from './workflows.js';
import { caseActionRoutes } from './case-actions.js';
import { caseChecklistRoutes } from './case-checklists.js';
import { caseCommentRoutes } from './case-comments.js';
import { caseAttachmentRoutes } from './case-attachments.js';
import { caseExportRoutes } from './case-exports.js';
import { casePrintRoutes } from './case-print.js';
import { caseTemplateRoutes } from './case-templates.js';
import { caseRoutes } from './cases.js';
import { inquiryReviewRequestRoutes } from './inquiry-review-requests.js';
import { caseAssignmentPolicyRoutes } from './case-assignment-policies.js';
import { caseAssignmentRoutes } from './case-assignment.js';
import { caseCalendarRoutes } from './case-calendars.js';
import { caseQueueRoutes } from './case-queues.js';
import { caseSlaPolicyRoutes } from './case-sla-policies.js';

/**
 * The server API (contracts C2 and C10-C15), registered under `/api/v1`. Every route
 * authenticates a principal (an API key or a dashboard user session, C12) with the app-wide
 * hook, requires its permission (`config.scopes`), and scopes every query to the principal's
 * environment: another environment's resources answer 404.
 *
 * Every Phase 2 resource plugin is registered here already, so its owner only fills in its own
 * file.
 */
export const serverRoutes: FastifyPluginAsyncZod<ApiDependencies> = async (app, options) => {
  const deps = dependenciesOf(options);
  await app.register(inquiryTemplateRoutes, deps);
  await app.register(inquiryTemplateVersionRoutes, deps);
  // C162.7, C154.7 (Workflow 9A Stage 1b (T)): frozen by `foundation-9a`, built by `api-templates`.
  await app.register(inquiryTemplateTranslationRoutes, deps);
  await app.register(deploymentRoutes, deps);
  // C160 (Workflow 9A Stage 1b (H)): frozen at 501 for api-themes (Workflow 9B).
  await app.register(themeSetRoutes, deps);
  await app.register(inquiryRoutes, deps);
  await app.register(inquirySessionRoutes, deps);
  // C91.2 (Workflow 7A): the devices, in their owner's file.
  await app.register(deviceRoutes, deps);
  // C127.9, C128 (Workflow 8A (A)): frozen by `foundation-8a`, built by `api-actions`.
  await app.register(deviceTrustRoutes, deps);
  await app.register(inquiryDecisionRoutes, deps);
  await app.register(verificationRoutes, deps);
  await app.register(accountRoutes, deps);
  await app.register(accountTypeRoutes, deps);
  await app.register(webhookRoutes, deps);
  await app.register(webhookDeliveryRoutes, deps);
  await app.register(eventRoutes, deps);
  await app.register(apiKeyRoutes, deps);
  await app.register(apiLogRoutes, deps);
  await app.register(rateLimitRoutes, deps);
  // C231-C234 (Workflow 11A Stage 1b (C)): frozen by `foundation-11a` behind the install switch,
  // built by `api-connect` (connections, share tokens, peek) and `api-redeem` (redeem).
  await app.register(connectConnectionRoutes, deps);
  await app.register(connectShareTokenRoutes, deps);
  await app.register(connectRedeemRoutes, deps);
  // C236, C237 (Workflow 11A Stage 1b (K)): frozen by `foundation-11a`, built by `api-consent`.
  await app.register(connectConsentRecordRoutes, deps);
  // C253.1 (Workflow 11B Stage 1b (D)): frozen by `foundation-11b`, built by `dsar-export`.
  await app.register(accountExportRoutes, deps);
  await app.register(userAuditLogRoutes, deps);
  // C72.1 (Phase 6, Workflow 6A Stage 1b): the report routes, built by api-reports.
  await app.register(reportRoutes, deps);
  await app.register(reportTemplateRoutes, deps);
  await app.register(reportTemplateVersionRoutes, deps);
  // C97.1, C99.3, C100.1 (Workflow 7B Stage 1b (L)): the list, item, match and importer routes,
  // built by api-lists and api-importers.
  await app.register(listRoutes, deps);
  await app.register(listItemRoutes, deps);
  await app.register(listMatchRoutes, deps);
  await app.register(importerRoutes, deps);
  // C104.1, C105.2 (Workflow 7B Stage 1b (T)): the transaction type, version and transaction
  // routes, built by api-transactions.
  await app.register(transactionTypeRoutes, deps);
  await app.register(transactionTypeVersionRoutes, deps);
  await app.register(transactionRoutes, deps);
  // C102.1, C102.4, C102.6, C103 (Workflow 7B Stage 1b (G)): the graph query, template and version
  // routes, built by api-graph.
  await app.register(graphQueryTemplateRoutes, deps);
  await app.register(graphQueryTemplateVersionRoutes, deps);
  await app.register(graphQueryRoutes, deps);
  // C112.6, C118.7, C120 (Workflow 8A Stage 1b (E)): the engine family, each in its owner's file.
  await app.register(workflowRoutes, deps);
  await app.register(workflowVersionRoutes, deps);
  await app.register(workflowRecipeRoutes, deps);
  await app.register(workflowTriggerRoutes, deps);
  await app.register(accountActionRoutes, deps);
  await app.register(workflowRunRoutes, deps);
  await app.register(workflowTestRunRoutes, deps);
  await app.register(workflowActionRoutes, deps);
  // C125.2, C126.4 (Workflow 8A Stage 1b (X)): the secrets and the sandbox message searches.
  await app.register(workflowSecretRoutes, deps);
  await app.register(sandboxMessageRoutes, deps);
  // C129.5, C128.7, C138.3, C140.1 (Workflow 8B Stage 1b (C)): the case family, each in its owner's
  // file (`api-cases`, `api-case-workflows`, `api-case-files`). The notifications are the dashboard
  // API's (`routes/dashboard/notifications.ts`).
  await app.register(caseRoutes, deps);
  await app.register(caseTemplateRoutes, deps);
  await app.register(caseCommentRoutes, deps);
  await app.register(casePrintRoutes, deps);
  await app.register(caseActionRoutes, deps);
  await app.register(inquiryReviewRequestRoutes, deps);
  // Workflow 8B (Q) (C132, C133): frozen by `foundation-8b`, built by `api-queues-sla`.
  await app.register(caseQueueRoutes, deps);
  await app.register(caseAssignmentRoutes, deps);
  await app.register(caseAssignmentPolicyRoutes, deps);
  await app.register(caseSlaPolicyRoutes, deps);
  await app.register(caseCalendarRoutes, deps);
  // Workflow 8B (F) (C135, C138): frozen by `foundation-8b`, built by `api-case-files`.
  await app.register(caseAttachmentRoutes, deps);
  await app.register(caseExportRoutes, deps);
  // C164.8 (Workflow 9B Stage 1b (A)): the aggregates API, frozen for `api-analytics`.
  await app.register(analyticsRoutes, deps);
  // C165.4, C166 (Workflow 9B Stage 1b (X)): exports, bulk reports and the delivery search, frozen
  // for `api-exports`.
  await app.register(exportRoutes, deps);
  await app.register(reportBulkRoutes, deps);
  await app.register(webhookDeliverySearchRoutes, deps);
  // C172.2 (Workflow 9B Stage 1b (C)): a case's checklist, frozen for `api-cases-reports`.
  await app.register(caseChecklistRoutes, deps);
};
