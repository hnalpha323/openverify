/**
 * The golden fixtures in `contracts/fixtures/` are shared with the Python (pydantic) and Kotlin
 * (kotlinx.serialization) suites, so a contract change shows up in every language at once.
 */
import { createHmac } from 'node:crypto';
import {
  analyticsCasesDocumentSchema,
  analyticsChecksDocumentSchema,
  analyticsFunnelDocumentSchema,
  analyticsInquiriesDocumentSchema,
  analyticsSignalsDocumentSchema,
  analyticsVerificationsDocumentSchema,
} from './analytics.js';
import {
  grantableDocumentSchema,
  revokeOtherSessionsResponseSchema,
  stepUpResponseSchema,
  userEffectivePermissionsDocumentSchema,
  userRoleAssignmentsDocumentSchema,
  userSessionListDocumentSchema,
} from './access.js';
import { exportDocumentSchema, exportListDocumentSchema } from './exports.js';
import { caseChecklistStateDocumentSchema } from './cases.js';
import { printAuditDocumentSchema } from './print-audits.js';
import { userDocumentSchema } from './users.js';
import { webhookDocumentSchema } from './webhooks.js';
import { reportBulkJobDocumentSchema } from './report-bulk.js';
import { savedViewDocumentSchema, savedViewListDocumentSchema } from './saved-views.js';
import {
  BUILTIN_ROLES,
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  getCheckDefinition,
} from '@openverify/core';
import { parseFlow } from '@openverify/flow-spec';
import { flowChipChallengeResponseSchema } from './chip-challenges.js';
import { flowIntegrityChallengeSchema } from './flow-integrity.js';
import { flowClientUnableResponseSchema, flowSandboxChipResponseSchema } from './flow-nfc.js';
import { deploymentDocumentSchema, deploymentListDocumentSchema } from './deployments.js';
import { inquiryTemplateTranslationsDocumentSchema } from './inquiry-template-translations.js';
import { simulationPresetListDocumentSchema } from './simulation-presets.js';
import {
  templatePreviewDocumentSchema,
  templateSimulationDocumentSchema,
  templateUsageDocumentSchema,
  templateVersionDiffDocumentSchema,
  templateVersionValidationDocumentSchema,
} from './template-routes.js';
import { inquiryTemplateVersionSummaryDocumentSchema } from './template-version-events.js';
import {
  themeAssetDocumentSchema,
  themeSetDocumentSchema,
  themeSetListDocumentSchema,
  themeSetRevisionListDocumentSchema,
} from './theme-sets.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { accountTypeDocumentSchema } from './account-types.js';
import {
  caseActionDocumentSchema,
  caseAvailableActionListDocumentSchema,
  runCaseActionDocumentSchema,
} from './case-actions.js';
import { caseCommentDocumentSchema } from './case-comments.js';
import { caseTemplateDocumentSchema, caseTemplateVersionDocumentSchema } from './case-templates.js';
import {
  caseBulkActionDocumentSchema,
  caseDocumentSchema,
  caseHeldObjectListDocumentSchema,
  caseHistoryListDocumentSchema,
  caseIncludeDocumentSchema,
  caseSearchDocumentSchema,
  nextCaseDocumentSchema,
} from './cases.js';
import { caseQueueDocumentSchema } from './case-queues.js';
import {
  caseAssignmentPolicyDocumentSchema,
  caseSlaPolicyDocumentSchema,
} from './case-policies.js';
import { caseCalendarDocumentSchema, caseCalendarImportDocumentSchema } from './case-calendars.js';
import { renditionPendingDocumentSchema } from './case-attachments.js';
import { caseExportBundleSchema, caseExportDocumentSchema } from './case-exports.js';
import {
  notificationPreferencesDocumentSchema,
  userNotificationListDocumentSchema,
} from './user-notifications.js';
import { accountDocumentSchema } from './accounts.js';
import { decisionDocumentSchema, decisionListDocumentSchema } from './decisions.js';
import {
  sandboxEmailSearchResponseSchema,
  sandboxSlackSearchResponseSchema,
  sandboxWorkflowSmsSearchResponseSchema,
} from './sandbox-messages.js';
import { workflowSecretDocumentSchema } from './workflow-secrets.js';
import { apiKeyDocumentSchema, rotatedApiKeyDocumentSchema } from './api-keys.js';
import { apiLogDocumentSchema } from './api-logs.js';
import { eventDocumentSchema } from './events.js';
import { deviceDocumentSchema } from './devices.js';
import { flowSessionResponseSchema } from './flow-api.js';
import { flowSignalsSchema } from './flow-signals.js';
import {
  accountGraphComponentDocumentSchema,
  graphNodeValueDocumentSchema,
  graphQueryActionResultDocumentSchema,
  graphQueryDocumentSchema,
  graphQueryTemplateDocumentSchema,
  graphQueryTemplateVersionDocumentSchema,
} from './graph-queries.js';
import { importerDocumentSchema, importerErrorListDocumentSchema } from './importers.js';
import {
  listItemListDocumentSchema,
  listMatchDocumentSchema,
  listResourceDocumentSchema,
  matchListsResponseSchema,
} from './lists.js';
import { inquiryDocumentSchema } from './inquiries.js';
import { inquirySessionIncludeDocumentSchema } from './inquiry-sessions.js';
import { inquiryTemplateVersionDocumentSchema } from './inquiry-template-versions.js';
import {
  createInquiryTemplateAttributesSchema,
  defaultInquiryTemplateAttributes,
} from './inquiry-templates.js';
import { PHASE1_CHECKS } from './phase1-checks.js';
import {
  CASE_PROBLEM_STATUSES,
  PHASE5_PROBLEM_CODES,
  PHASE5_PROBLEM_STATUSES,
  GRAPH_PROBLEM_STATUSES,
  WORKFLOW_PROBLEM_STATUSES,
  LIST_PROBLEM_STATUSES,
  REPORT_PROBLEM_CODES,
  REPORT_PROBLEM_STATUSES,
  SIGNAL_PROBLEM_STATUSES,
  TRANSACTION_PROBLEM_STATUSES,
  problemSchema,
  problemValidationErrorSchema,
} from './problem.js';
import {
  reportTemplateDocumentSchema,
  reportTemplateVersionDocumentSchema,
} from './report-templates.js';
import { reportDocumentSchema, reportHistoryDocumentSchema } from './reports.js';
import { dashboardWatchlistSourcesSchema } from './watchlist-sources.js';
import { rateLimitListDocumentSchema } from './rate-limits.js';
import { REDACTED_VALUE } from './redaction.js';
import { roleDocumentSchema } from './roles.js';
import { SELFIE_CAPTURE_PROBLEM_CODES, selfieCaptureDocumentSchema } from './selfie-captures.js';
import { IDS, listFixtures, readFixture } from './test-support.js';
import {
  transactionDocumentSchema,
  transactionLabelDocumentSchema,
  transactionLabelListDocumentSchema,
  transactionRelationListDocumentSchema,
  transactionStatusChangeListDocumentSchema,
  transactionTypeDocumentSchema,
  transactionTypeVersionDocumentSchema,
} from './transactions.js';
import { dashboardTrustAnchorsSchema } from './trust-anchors.js';
import {
  accountActionDocumentSchema,
  accountAvailableActionListDocumentSchema,
  runAccountActionDocumentSchema,
} from './account-actions.js';
import {
  workflowActionListDocumentSchema,
  workflowRecipeListDocumentSchema,
} from './workflow-actions.js';
import {
  workflowManualRunsDocumentSchema,
  workflowRunDocumentSchema,
  workflowRunStepListDocumentSchema,
  workflowTriggerDeliveryListDocumentSchema,
} from './workflow-runs.js';
import {
  workflowDefinitionCheckDocumentSchema,
  workflowDeploymentDocumentSchema,
  workflowDocumentSchema,
  workflowVersionDiffDocumentSchema,
  workflowVersionDocumentSchema,
} from './workflows.js';
import { userAuditLogDocumentSchema } from './user-audit-logs.js';
import { VERIFICATION_RESOURCE_TYPES } from './verification-types.js';
import { verificationDocumentSchema } from './verifications.js';
import { webhookDeliveryDocumentSchema } from './webhook-deliveries.js';

/** Every C8 and C20 API fixture and the schema that validates it. */
const API_FIXTURES: Record<string, z.ZodType> = {
  // C8 (Phase 1), updated to what Phase 2 servers send.
  'flow-session.json': flowSessionResponseSchema,
  // C151.5, C151.6, C178.1 (Workflow 9A Stage 1a (F)): what a spec-1 and a spec-2 client receive.
  'flow-session-v1-projection.json': flowSessionResponseSchema,
  'flow-session-v2.json': flowSessionResponseSchema,
  // C96.3, owner decision 1 after 7A: the issuing session while the phone works.
  'flow-session-handed-off.json': flowSessionResponseSchema,
  // C128.7 (Workflow 8A): a declined inquiry, with its contest route.
  'flow-session-declined.json': flowSessionResponseSchema,
  // C200.2, C221.12 (Workflow 10A Stage 1a (S)): the environment's display name, served NFC.
  'flow-session-organization.json': flowSessionResponseSchema,
  // Workflow 10B (C211.3)
  'flow-integrity-challenge.json': flowIntegrityChallengeSchema,
  // Workflow 10C (C207.1, C207.9, C208.1, C221.1): the chip challenge, the client-unable and
  // sandbox-chip answers, and the session at an nfc step for a web client and for an SDK client.
  'flow-chip-challenge.json': flowChipChallengeResponseSchema,
  'flow-client-unable.json': flowClientUnableResponseSchema,
  'flow-sandbox-chip.json': flowSandboxChipResponseSchema,
  'flow-session-nfc.json': flowSessionResponseSchema,
  'flow-session-nfc-sdk.json': flowSessionResponseSchema,
  // C237.6, C238.3 (Workflow 11A Stage 1a (K)): the session at a share_consent step, with the
  // withdrawable consents; the SDK decodes it.
  'flow-session-share-consent.json': flowSessionResponseSchema,
  // C128.1 (Workflow 8A): the record, and one subject's list.
  'decision.json': decisionDocumentSchema,
  // C150.7 (Workflow 9A Stage 1a): a flow failure's record.
  'decision-flow-failure.json': decisionDocumentSchema,
  'decisions.json': decisionListDocumentSchema,
  'event-inquiry-declined.json': eventDocumentSchema,
  // C125, C126.4 (Workflow 8A).
  'workflow-secret.json': workflowSecretDocumentSchema,
  'sandbox-email-messages.json': sandboxEmailSearchResponseSchema,
  'sandbox-slack-messages.json': sandboxSlackSearchResponseSchema,
  'sandbox-workflow-sms-messages.json': sandboxWorkflowSmsSearchResponseSchema,
  // C94.2, C94.7 (Phase 7): the Android signal body.
  'flow-signals.json': flowSignalsSchema,
  // C91.2 (Phase 7).
  'device.json': deviceDocumentSchema,
  'inquiry-with-verifications.json': inquiryDocumentSchema,
  'inquiry.json': inquiryDocumentSchema,
  'problem.json': problemSchema,
  'verification-government-id.json': verificationDocumentSchema,
  'verification-selfie.json': verificationDocumentSchema,
  'webhook-event-inquiry-completed.json': eventDocumentSchema,
  // C20 (Phase 2).
  'account.json': accountDocumentSchema,
  'account-type.json': accountTypeDocumentSchema,
  'inquiry-template-version.json': inquiryTemplateVersionDocumentSchema,
  // Workflow 9A Stage 1a (T): a flow-spec 2 draft, the summary events carry, and the C154 routes.
  'inquiry-template-version-v2.json': inquiryTemplateVersionDocumentSchema,
  'inquiry-template-version-summary.json': inquiryTemplateVersionSummaryDocumentSchema,
  'inquiry-flow-outcome.json': inquiryDocumentSchema,
  'deployment.json': deploymentDocumentSchema,
  'deployments.json': deploymentListDocumentSchema,
  'inquiry-template-translations.json': inquiryTemplateTranslationsDocumentSchema,
  'inquiry-template-usage.json': templateUsageDocumentSchema,
  'simulation-presets.json': simulationPresetListDocumentSchema,
  'template-preview.json': templatePreviewDocumentSchema,
  'template-simulation.json': templateSimulationDocumentSchema,
  'template-version-diff.json': templateVersionDiffDocumentSchema,
  'template-version-validation.json': templateVersionValidationDocumentSchema,
  // Workflow 9A Stage 1a (H): theme sets, their revisions and assets (C160.1, C160.5, C160.6).
  'theme-set.json': themeSetDocumentSchema,
  'theme-sets.json': themeSetListDocumentSchema,
  'theme-set-revisions.json': themeSetRevisionListDocumentSchema,
  'theme-asset.json': themeAssetDocumentSchema,
  'theme-asset-font.json': themeAssetDocumentSchema,
  // Workflow 9B Stage 1a (A): the six suppressed answers of the aggregates API (C164.8).
  'analytics-inquiries.json': analyticsInquiriesDocumentSchema,
  'analytics-funnel.json': analyticsFunnelDocumentSchema,
  'analytics-verifications.json': analyticsVerificationsDocumentSchema,
  'analytics-checks.json': analyticsChecksDocumentSchema,
  'analytics-cases.json': analyticsCasesDocumentSchema,
  'analytics-signals.json': analyticsSignalsDocumentSchema,
  // Workflow 9B Stage 1a (X): exports, saved views and a bulk report job (C165, C166).
  'export.json': exportDocumentSchema,
  'exports.json': exportListDocumentSchema,
  'saved-view.json': savedViewDocumentSchema,
  'saved-views.json': savedViewListDocumentSchema,
  'report-bulk-job.json': reportBulkJobDocumentSchema,
  // Workflow 9B Stage 1a (U): roles per environment, grants, step-up, sessions, the users list.
  'user-role-assignments.json': userRoleAssignmentsDocumentSchema,
  // Workflow 9D (K9-22, DS8): what a user's assignments give, per environment.
  'user-effective-permissions.json': userEffectivePermissionsDocumentSchema,
  'grantable.json': grantableDocumentSchema,
  'step-up.json': stepUpResponseSchema,
  'user-sessions.json': userSessionListDocumentSchema,
  'user-sessions-revoked.json': revokeOtherSessionsResponseSchema,
  'user-mfa-status.json': userDocumentSchema,
  // Workflow 9B Stage 1a (W): key rotation and the new key, webhook and notification members.
  'api-key-phase9b.json': apiKeyDocumentSchema,
  'api-key-rotated.json': rotatedApiKeyDocumentSchema,
  'webhook-phase9b.json': webhookDocumentSchema,
  'user-notifications-phase9b.json': userNotificationListDocumentSchema,
  'notification-preferences.json': notificationPreferencesDocumentSchema,
  // Workflow 9B Stage 1a (C): case and report completions, the print audit, the node expansion.
  'case-template-version-phase9b.json': caseTemplateVersionDocumentSchema,
  'case-checklist-state.json': caseChecklistStateDocumentSchema,
  'report-watchlist-phase9b.json': reportDocumentSchema,
  'verification-files.json': verificationDocumentSchema,
  'print-audit.json': printAuditDocumentSchema,
  'graph-query-expanded.json': graphQueryDocumentSchema,
  // Workflow 9B Stage 1a (F): the session links and the per-inquiry expiry windows.
  'flow-session-links.json': flowSessionResponseSchema,
  'inquiry-expiry-windows.json': inquiryDocumentSchema,
  'event-inquiry-template-version-created.json': eventDocumentSchema,
  'event-inquiry-template-version-published.json': eventDocumentSchema,
  'event-deployment-completed.json': eventDocumentSchema,
  'event-inquiry-completed.json': eventDocumentSchema,
  // C91 (Phase 7): the session with its network facts, and the network row included.
  'inquiry-session.json': inquirySessionIncludeDocumentSchema,
  'webhook-delivery.json': webhookDeliveryDocumentSchema,
  'api-log.json': apiLogDocumentSchema,
  'api-key.json': apiKeyDocumentSchema,
  'role.json': roleDocumentSchema,
  'user-audit-log.json': userAuditLogDocumentSchema,
  // Owner decisions 3 after 7A and 5 after 7B: an entry no principal wrote.
  'user-audit-log-system.json': userAuditLogDocumentSchema,
  'rate-limit.json': rateLimitListDocumentSchema,
  'event-inquiry-approved.json': eventDocumentSchema,
  'event-account-consolidated.json': eventDocumentSchema,
  // C40 (Phase 4): the server-only selfie capture resource.
  'selfie.json': selfieCaptureDocumentSchema,
  // C50.6 (Phase 5): a golden full resource of each new verification type.
  'verification-document.json': verificationDocumentSchema,
  'verification-database.json': verificationDocumentSchema,
  'verification-aamva.json': verificationDocumentSchema,
  'verification-phone-number.json': verificationDocumentSchema,
  'verification-email-address.json': verificationDocumentSchema,
  'verification-government-id-nfc.json': verificationDocumentSchema,
  'verification-crypto-wallet.json': verificationDocumentSchema,
  'verification-database-business.json': verificationDocumentSchema,
  'verification-business-website.json': verificationDocumentSchema,
  // C62.10 (Workflow 5B Stage 1): the console view of the CSCA trust store.
  'dashboard-trust-anchors.json': dashboardTrustAnchorsSchema,
  // C70 (Phase 6): a golden report of each type, a template, a version, a history and the
  // console's watchlist sources.
  'report-watchlist.json': reportDocumentSchema,
  'report-business-watchlist.json': reportDocumentSchema,
  'report-crypto-address-watchlist.json': reportDocumentSchema,
  'report-politically-exposed-person.json': reportDocumentSchema,
  'report-adverse-media.json': reportDocumentSchema,
  'report-business-adverse-media.json': reportDocumentSchema,
  'report-email-address.json': reportDocumentSchema,
  'report-phone-number.json': reportDocumentSchema,
  'report-address-lookup.json': reportDocumentSchema,
  'report-ip-address.json': reportDocumentSchema,
  'report-template.json': reportTemplateDocumentSchema,
  'report-template-version.json': reportTemplateVersionDocumentSchema,
  'report-history.json': reportHistoryDocumentSchema,
  'dashboard-watchlist-sources.json': dashboardWatchlistSourcesSchema,
  // C97, C99, C100, C106.2 (Workflow 7B): a list, one item of every kind, an importer and its
  // errors, a match, an on-demand answer and the custom-list report.
  'list.json': listResourceDocumentSchema,
  'list-items.json': listItemListDocumentSchema,
  'importer.json': importerDocumentSchema,
  'importer-errors.json': importerErrorListDocumentSchema,
  'list-match.json': listMatchDocumentSchema,
  'list-match-result.json': matchListsResponseSchema,
  'report-custom-list.json': reportDocumentSchema,
  // C104, C105 (Workflow 7B): a type, a version, a transaction and a label.
  'transaction-type.json': transactionTypeDocumentSchema,
  'transaction-type-version.json': transactionTypeVersionDocumentSchema,
  'transaction.json': transactionDocumentSchema,
  'transaction-label.json': transactionLabelDocumentSchema,
  // Owner decision 8 after 7B: a transaction's status history and its labels.
  'transaction-status-changes.json': transactionStatusChangeListDocumentSchema,
  'transaction-labels.json': transactionLabelListDocumentSchema,
  // K7C-2: a transaction's relations, an account and a transaction.
  'transaction-relations.json': transactionRelationListDocumentSchema,
  // C102, C103 (Workflow 7B): a template, a version, a query, an unmasked node and a bulk answer.
  'graph-query-template.json': graphQueryTemplateDocumentSchema,
  'graph-query-template-version.json': graphQueryTemplateVersionDocumentSchema,
  'graph-query.json': graphQueryDocumentSchema,
  'graph-node-value.json': graphNodeValueDocumentSchema,
  'graph-query-action-result.json': graphQueryActionResultDocumentSchema,
  // K7B-2 (C101.6): an account's component.
  'account-graph-component.json': accountGraphComponentDocumentSchema,
  // C112, C116 (Workflow 8A): a workflow, a version with every node type, its diff and a rollout.
  'workflow.json': workflowDocumentSchema,
  'workflow-version.json': workflowVersionDocumentSchema,
  'workflow-version-diff.json': workflowVersionDiffDocumentSchema,
  'workflow-definition-check.json': workflowDefinitionCheckDocumentSchema,
  'workflow-deployment.json': workflowDeploymentDocumentSchema,
  // C117, C118, C120: a run, its steps with a trigger file, deliveries and manual runs.
  'workflow-run.json': workflowRunDocumentSchema,
  'workflow-run-steps.json': workflowRunStepListDocumentSchema,
  'workflow-trigger-deliveries.json': workflowTriggerDeliveryListDocumentSchema,
  'workflow-manual-runs.json': workflowManualRunsDocumentSchema,
  // C118.7: an account action, the form a viewer sees, and the public answer.
  'account-action.json': accountActionDocumentSchema,
  'account-available-actions.json': accountAvailableActionListDocumentSchema,
  'account-run-action.json': runAccountActionDocumentSchema,
  // C122.4, C140.5: the catalogue and the recipes.
  'workflow-actions.json': workflowActionListDocumentSchema,
  'workflow-recipes.json': workflowRecipeListDocumentSchema,
  // C112.7, C127.12, C128.6 (Workflow 8A): a golden payload of each new event.
  'event-workflow-published.json': eventDocumentSchema,
  'event-workflow-paused.json': eventDocumentSchema,
  'event-workflow-version-published.json': eventDocumentSchema,
  'event-workflow-run-created.json': eventDocumentSchema,
  'event-workflow-run-resumed.json': eventDocumentSchema,
  'event-workflow-run-errored.json': eventDocumentSchema,
  'event-workflow-run-completed.json': eventDocumentSchema,
  'event-workflow-run-canceled.json': eventDocumentSchema,
  'event-list-updated.json': eventDocumentSchema,
  'event-inquiry-reopened.json': eventDocumentSchema,
  // C129, C131, C136, C137, C140 (Workflow 8B): a case, what reads it, and its configuration.
  'case.json': caseDocumentSchema,
  'case-included.json': caseIncludeDocumentSchema,
  'case-search.json': caseSearchDocumentSchema,
  'case-history.json': caseHistoryListDocumentSchema,
  'case-held-objects.json': caseHeldObjectListDocumentSchema,
  'case-bulk-action.json': caseBulkActionDocumentSchema,
  'case-template.json': caseTemplateDocumentSchema,
  'case-template-version.json': caseTemplateVersionDocumentSchema,
  'case-comment.json': caseCommentDocumentSchema,
  'case-action.json': caseActionDocumentSchema,
  'case-available-actions.json': caseAvailableActionListDocumentSchema,
  'case-run-action.json': runCaseActionDocumentSchema,
  // C132, C133 (Workflow 8B, the (Q) family): the next case, queues, policies and calendars.
  'case-next.json': nextCaseDocumentSchema,
  'case-queue.json': caseQueueDocumentSchema,
  'case-assignment-policy.json': caseAssignmentPolicyDocumentSchema,
  'case-sla-policy.json': caseSlaPolicyDocumentSchema,
  'case-calendar.json': caseCalendarDocumentSchema,
  'case-calendar-import.json': caseCalendarImportDocumentSchema,
  // C135, C138 (Workflow 8B, the (F) family): an export, a JSON export's file, a rendition not made.
  'case-export.json': caseExportDocumentSchema,
  'case-export-bundle.json': caseExportBundleSchema,
  'case-rendition-pending.json': renditionPendingDocumentSchema,
  'user-notifications.json': userNotificationListDocumentSchema,
  // C129.6 (Workflow 8B): a golden payload of each case event, with no value of its subject in it.
  'event-case-created.json': eventDocumentSchema,
  'event-case-assigned.json': eventDocumentSchema,
  'event-case-resolved.json': eventDocumentSchema,
  'event-case-reopened.json': eventDocumentSchema,
  'event-case-status-updated.json': eventDocumentSchema,
  'event-case-queue-updated.json': eventDocumentSchema,
  'event-case-updated-fields.json': eventDocumentSchema,
  'event-case-updated-tags.json': eventDocumentSchema,
  'event-case-sla-expired.json': eventDocumentSchema,
  'event-case-exported.json': eventDocumentSchema,
  'event-case-redacted.json': eventDocumentSchema,
  'event-case-updated.json': eventDocumentSchema,
  'event-case-print-initiated.json': eventDocumentSchema,
  'event-case-comment-created.json': eventDocumentSchema,
  'event-case-template-deleted-field.json': eventDocumentSchema,
};

type Json = Record<string, unknown>;

function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(strings);
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [key, ...strings(item)]);
  }
  return [];
}

describe('API golden fixtures (C8, C20)', () => {
  it('are exactly the C8 and C20 lists, each with a validating schema', () => {
    expect(listFixtures('api')).toEqual(Object.keys(API_FIXTURES).sort());
  });

  it.each(Object.entries(API_FIXTURES))('%s parses and re-serializes unchanged', (file, schema) => {
    const raw = readFixture(`api/${file}`);
    const parsed = schema.parse(raw);
    expect(parsed).toEqual(raw);
    // fastify-type-provider-zod serializes responses with z.encode.
    expect(z.encode(schema, parsed)).toEqual(raw);
  });

  it.each([...Object.keys(API_FIXTURES), '../flows/default-gov-id-selfie.json'])(
    '%s holds synthetic data only',
    (file) => {
      const text = strings(readFixture(`api/${file}`));
      for (const value of text) {
        // An email address (a dotted domain after the `@`) is a synthetic one; a model id such as
        // `disposable-email-domains@6fcca80` (a name and a commit) is no address.
        if (/@[^@\s]+\.[^@\s]+$/u.test(value)) {
          expect(value).toMatch(/@example\.test$/);
        }
        expect(value).not.toMatch(/embedding/i);
      }
    },
  );

  it.each(VERIFICATION_RESOURCE_TYPES)(
    'has a golden %s resource, served as Phase 5 servers serve it (C50.6)',
    (type) => {
      const file = `verification-${type.slice('verification/'.length)}.json`;
      const { data } = verificationDocumentSchema.parse(readFixture(`api/${file}`));
      expect(data.type).toBe(type);
      for (const check of data.attributes.checks) {
        expect(check.category, `${file} ${check.name}`).toBe(
          getCheckDefinition(check.name)?.category,
        );
      }
    },
  );

  it('inquiry.json is a new inquiry without verifications', () => {
    const { data } = inquiryDocumentSchema.parse(readFixture('api/inquiry.json'));
    expect(data.attributes).toMatchObject({ status: 'created', 'reference-id': 'ref-test-001' });
    expect(data.relationships.verifications.data).toEqual([]);
  });

  it('inquiry-with-verifications.json includes exactly the related verifications', () => {
    const document = inquiryDocumentSchema.parse(
      readFixture('api/inquiry-with-verifications.json'),
    );
    expect(document.data.attributes.status).toBe('completed');
    expect(document.included?.map(({ type, id }) => ({ type, id }))).toEqual(
      document.data.relationships.verifications.data,
    );
    for (const verification of document.included ?? []) {
      expect(verification.relationships.inquiry.data.id).toBe(document.data.id);
    }
  });

  it.each([
    ['verification-government-id.json', 'verification/government-id'],
    ['verification-selfie.json', 'verification/selfie'],
  ])('%s is a %s', (file, type) => {
    expect(verificationDocumentSchema.parse(readFixture(`api/${file}`)).data.type).toBe(type);
  });

  it('verification-government-id.json shows the current default thresholds (K103)', () => {
    const { data } = verificationDocumentSchema.parse(
      readFixture('api/verification-government-id.json'),
    );
    const shown = data.attributes.checks.flatMap((check) =>
      Object.entries(check.provenance?.thresholds ?? {})
        .filter(([key]) => GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS[check.name]?.[key] !== undefined)
        .map(([key, value]) => [check.name, key, value] as const),
    );
    expect(shown.length).toBeGreaterThan(0);
    for (const [name, key, value] of shown) {
      expect({ name, key, value }).toEqual({
        name,
        key,
        value: GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS[name]?.[key],
      });
    }
  });

  it('flow-session.json carries the default flow', () => {
    const session = flowSessionResponseSchema.parse(readFixture('api/flow-session.json'));
    expect(session.flow).toEqual(defaultInquiryTemplateAttributes().flow);
  });

  it('webhook-event-inquiry-completed.json delivers a completed inquiry', () => {
    const { data } = eventDocumentSchema.parse(
      readFixture('api/webhook-event-inquiry-completed.json'),
    );
    expect(data.attributes.name).toBe('inquiry.completed');
    expect(data.attributes.payload.data).toMatchObject({
      type: 'inquiry',
      attributes: { status: 'completed' },
    });
  });

  it('problem.json is a validation problem', () => {
    const problem = problemSchema.parse(readFixture('api/problem.json'));
    expect(problem).toMatchObject({ type: 'about:blank', status: 400 });
    expect(problem.errors?.length).toBeGreaterThan(0);
  });
});

describe('Phase 1 fixtures carry what Phase 2 servers send (C10, C14, C19)', () => {
  const phase2InquiryAttributes = ['tags', 'note', 'expires-at', 'redacted-at', 'decisioned-at'];

  it.each(['inquiry.json', 'inquiry-with-verifications.json'])(
    '%s has the C10 attributes and its account',
    (file) => {
      const { data } = inquiryDocumentSchema.parse(readFixture(`api/${file}`));
      for (const name of phase2InquiryAttributes) {
        expect(data.attributes).toHaveProperty([name]);
      }
      expect(data.relationships.account?.data).toMatchObject({ type: 'account' });
    },
  );

  it('webhook-event-inquiry-completed.json is not simulated and carries a Phase 2 inquiry', () => {
    const { data } = eventDocumentSchema.parse(
      readFixture('api/webhook-event-inquiry-completed.json'),
    );
    expect(data.attributes.simulated).toBe(false);
    for (const name of phase2InquiryAttributes) {
      expect(data.attributes.payload.data.attributes).toHaveProperty([name]);
    }
  });

  it('flow-session.json names the environment kind', () => {
    const session = flowSessionResponseSchema.parse(readFixture('api/flow-session.json'));
    expect(session.environment).toEqual({ kind: 'sandbox' });
  });
});

describe('C20 fixtures', () => {
  it('account.json is an active account of the default type with its inquiry', () => {
    const { data } = accountDocumentSchema.parse(readFixture('api/account.json'));
    expect(data.attributes).toMatchObject({ status: 'active', 'consolidated-into': null });
    expect(data.relationships.inquiries.data.length).toBeGreaterThan(0);
    const inquiry = inquiryDocumentSchema.parse(readFixture('api/inquiry.json')).data;
    expect(inquiry.relationships.account?.data?.id).toBe(data.id);
  });

  it('account-type.json is the seeded user type, and account.json fits its schema', () => {
    const { data } = accountTypeDocumentSchema.parse(readFixture('api/account-type.json'));
    expect(data.attributes.name).toBe('user');
    const account = accountDocumentSchema.parse(readFixture('api/account.json')).data;
    expect(account.relationships['account-type'].data.id).toBe(data.id);
    for (const key of Object.keys(account.attributes.fields)) {
      expect(data.attributes['fields-schema']).toHaveProperty([key]);
    }
  });

  it('inquiry-template-version.json is a published v2 version with check config', () => {
    const { data } = inquiryTemplateVersionDocumentSchema.parse(
      readFixture('api/inquiry-template-version.json'),
    );
    expect(data.attributes).toMatchObject({ status: 'published', 'version-number': 2 });
    expect(JSON.stringify(data.attributes['verification-config'])).toContain('"config"');
  });

  it('inquiry-session.json is an active session of the fixture inquiry', () => {
    const { data } = inquirySessionIncludeDocumentSchema.parse(
      readFixture('api/inquiry-session.json'),
    );
    expect(data.attributes.status).toBe('active');
    expect(data.relationships.inquiry.data.id).toBe(
      inquiryDocumentSchema.parse(readFixture('api/inquiry.json')).data.id,
    );
  });

  it('webhook-delivery.json retried after a failed first attempt', () => {
    const { data } = webhookDeliveryDocumentSchema.parse(readFixture('api/webhook-delivery.json'));
    expect(data.attributes.status).toBe('pending');
    expect(data.attributes.attempts[0]?.['response-status']).toBe(503);
  });

  it('api-log.json stores redacted secrets, never the session token or flow URL', () => {
    const { data } = apiLogDocumentSchema.parse(readFixture('api/api-log.json'));
    const body = JSON.stringify(data.attributes['response-body']);
    expect(body).toContain(REDACTED_VALUE);
    expect(body).not.toMatch(/ovs_|session-token=/);
  });

  it('api-key.json shows a token prefix only', () => {
    const { data } = apiKeyDocumentSchema.parse(readFixture('api/api-key.json'));
    expect(data.attributes['token-prefix']).toMatch(/^ov_sbx_[A-Za-z0-9_-]{4}$/);
  });

  it('role.json is the built-in reviewer role', () => {
    const { data } = roleDocumentSchema.parse(readFixture('api/role.json'));
    expect(data.attributes).toMatchObject({ key: 'reviewer', builtin: true });
    expect(data.attributes.permissions).toEqual(BUILTIN_ROLES.reviewer.permissions);
  });

  it('user-audit-log.json records an approval by a user', () => {
    const { data } = userAuditLogDocumentSchema.parse(readFixture('api/user-audit-log.json'));
    expect(data.attributes).toMatchObject({
      action: 'inquiry.approved',
      actor: { type: 'user' },
      'resource-type': 'inquiry',
    });
  });

  it('rate-limit.json lists the api policy', () => {
    const { data } = rateLimitListDocumentSchema.parse(readFixture('api/rate-limit.json'));
    expect(data.map(({ id }) => id)).toEqual(['api']);
  });

  it('event-inquiry-approved.json delivers an approved, decisioned inquiry', () => {
    const { data } = eventDocumentSchema.parse(readFixture('api/event-inquiry-approved.json'));
    expect(data.attributes).toMatchObject({ name: 'inquiry.approved', simulated: false });
    expect(data.attributes.payload.data).toMatchObject({
      type: 'inquiry',
      attributes: { status: 'approved' },
    });
    expect(data.attributes.payload.data).toMatchObject({
      attributes: { 'decisioned-at': data.attributes['created-at'] },
    });
  });

  it('event-account-consolidated.json moves archived sources into the target account', () => {
    const { data } = eventDocumentSchema.parse(readFixture('api/event-account-consolidated.json'));
    expect(data.attributes.name).toBe('account.consolidated');
    const { payload } = data.attributes;
    expect(payload.data.type).toBe('account');
    const sources = 'included' in payload ? (payload.included ?? []) : [];
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toMatchObject({
        type: 'account',
        attributes: { status: 'archived', 'consolidated-into': payload.data.id },
      });
    }
  });
});

describe('Workflow 2E fixtures (C25)', () => {
  it.each(['inquiry.json', 'inquiry-with-verifications.json'])(
    '%s names its pinned template version (C25.4)',
    (file) => {
      const { data } = inquiryDocumentSchema.parse(readFixture(`api/${file}`));
      expect(data.relationships).toMatchObject({
        'inquiry-template-version': {
          data: { type: 'inquiry-template-version', id: IDS.templateVersion },
        },
      });
    },
  );

  it('api-key.json says whether the key sees PII masked (C25.6)', () => {
    const { data } = apiKeyDocumentSchema.parse(readFixture('api/api-key.json'));
    expect(data.attributes).toMatchObject({ 'pii-masked': false });
  });

  const reasons: Record<string, string> = {
    'session-canceled-inquiry-expired.json': 'inquiry_expired',
    'session-canceled-inquiry-finished.json': 'inquiry_finished',
    'session-canceled-inquiry-redacted.json': 'inquiry_redacted',
  };

  /** Workflow 4B review K202: one golden 409 per C40 problem code. */
  const selfieCaptureCodes: Record<string, (typeof SELFIE_CAPTURE_PROBLEM_CODES)[number]> = {
    'selfie-capture-incomplete.json': 'selfie_capture_incomplete',
    'selfie-capture-invalid.json': 'selfie_capture_invalid',
    'selfie-capture-limit.json': 'selfie_capture_limit',
    'selfie-capture-required.json': 'selfie_capture_required',
  };

  it('problems/ holds one session_canceled problem per reason (C25.8) and one selfie capture problem per C40 code (K202)', () => {
    expect(listFixtures('problems')).toEqual(
      [...Object.keys(reasons), ...Object.keys(selfieCaptureCodes)].sort(),
    );
    expect(Object.values(selfieCaptureCodes).sort()).toEqual(
      [...SELFIE_CAPTURE_PROBLEM_CODES].sort(),
    );
  });

  it.each(Object.entries(selfieCaptureCodes))(
    'problems/%s is the 409 Conflict with code %s (K202)',
    (file, code) => {
      const raw = readFixture(`problems/${file}`);
      const problem = problemSchema.parse(raw);
      expect(problem).toEqual(raw);
      expect(problem).toMatchObject({ type: 'about:blank', title: 'Conflict', status: 409, code });
      expect(problem).not.toHaveProperty('reason');
      expect(problem.instance).toMatch(
        new RegExp(`^/api/v1/flow/verifications/${IDS.selfie}/(files|submit|selfies)$`),
      );
      expect(z.encode(problemSchema, problem)).toEqual(raw);
    },
  );

  it.each(Object.entries(reasons))('problems/%s carries reason %s', (file, reason) => {
    const raw = readFixture(`problems/${file}`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({ status: 401, code: 'session_canceled', reason });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
  });
});

/** C52.7: the frozen Phase 5 problem codes, one golden problem each, and the status it answers. */
const PHASE5_PROBLEMS: Readonly<Record<string, number>> = {
  inputs_required: 409,
  verification_created_by_server: 409,
  otp_channel_not_configured: 422,
  otp_destination_invalid: 422,
  otp_destination_not_allowed: 422,
  otp_resend_too_soon: 429,
  otp_rate_limited: 429,
  otp_delivery_failed: 502,
  otp_not_sent: 409,
  otp_incorrect: 422,
  otp_expired: 409,
  otp_code_exhausted: 409,
  otp_attempts_exhausted: 409,
  otp_not_confirmed: 409,
  otp_already_confirmed: 409,
  crypto_chain_not_offered: 422,
  crypto_address_invalid: 422,
  crypto_expected_address_mismatch: 422,
  crypto_challenge_invalid: 409,
  chip_challenge_invalid: 409,
  chip_data_required: 409,
  provider_not_configured: 422,
};

const TITLES: Readonly<Record<number, string>> = {
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  502: 'Bad Gateway',
};

describe('problems/flow/ (C52.7)', () => {
  it('freezes the Phase 5 problem codes with their statuses', () => {
    expect(PHASE5_PROBLEM_STATUSES).toEqual(PHASE5_PROBLEMS);
    expect(PHASE5_PROBLEM_CODES).toEqual(Object.keys(PHASE5_PROBLEMS));
  });

  it('holds one golden problem per code, named by it', () => {
    // Workflow 10B (C221.6): integrity_challenge_invalid's golden sits beside the Phase 5 ones.
    expect(listFixtures('problems/flow')).toEqual(
      [
        ...Object.keys(PHASE5_PROBLEMS),
        'integrity_challenge_invalid',
        // Workflow 10C (C221.6): the client-unable and sandbox-chip problems.
        'client_unable_not_allowed',
        'sandbox_chip_anchor_missing',
        'sandbox_chip_scenario_unavailable',
      ]
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(PHASE5_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/flow/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({ type: 'about:blank', title: TITLES[status], status, code });
    expect(problem).not.toHaveProperty('reason');
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    // C53.8: a problem never carries an entered value, a destination or a code.
    expect(problem.detail).not.toMatch(/[0-9]{4}|@/);
  });

  it('give the client what it needs to wait or retry', () => {
    expect(readFixture('problems/flow/otp-resend-too-soon.json')).toHaveProperty(
      'resend-available-at',
    );
    expect(readFixture('problems/flow/otp-incorrect.json')).toMatchObject({
      'attempts-remaining': 4,
    });
  });
});

/** C72.4: the frozen report problem codes, one golden problem each, and the status it answers. */
const REPORT_PROBLEMS: Readonly<Record<string, number>> = {
  report_query_invalid: 422,
  report_template_not_published: 422,
  report_type_mismatch: 422,
  report_not_reviewable: 409,
  report_not_recurrable: 409,
  report_no_scheduled_run: 409,
  report_match_not_found: 404,
  report_match_superseded: 409,
  report_redacted: 410,
  report_recurring_limit: 422,
  watchlist_source_unknown: 422,
  watchlist_source_not_allowed: 422,
  watchlist_sources_empty: 422,
};

const REPORT_TITLES: Readonly<Record<number, string>> = {
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Content',
};

describe('problems/reports/ (C72.4)', () => {
  it('freezes the report problem codes with their statuses', () => {
    expect(REPORT_PROBLEM_STATUSES).toEqual(REPORT_PROBLEMS);
    expect(REPORT_PROBLEM_CODES).toEqual(Object.keys(REPORT_PROBLEMS));
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures('problems/reports')).toEqual(
      Object.keys(REPORT_PROBLEMS)
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(REPORT_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/reports/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: REPORT_TITLES[status],
      status,
      code,
    });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    // A problem never carries a screened name, a list entry or an address.
    expect(problem.detail).not.toMatch(/[0-9]{4}|@|Avery|Quillfeather/);
  });

  it('points the report-config publish refusal at its entry (F07) and a bad query at its member', () => {
    expect(readFixture('problems/reports/report-template-not-published.json')).toMatchObject({
      errors: [{ pointer: '/data/attributes/report-config/on-completion/0' }],
    });
    expect(readFixture('problems/reports/report-query-invalid.json')).toMatchObject({
      errors: [{ pointer: expect.stringMatching(/^\/data\/attributes\/query\//) as unknown }],
    });
    expect(readFixture('problems/reports/watchlist-sources-empty.json')).toMatchObject({
      errors: [{ pointer: '/data/attributes/config/search-lists' }],
    });
  });
});

describe('flows/default-gov-id-selfie.json (C7, C8)', () => {
  const fixture = readFixture('flows/default-gov-id-selfie.json') as Json;

  it('is the only flow fixture', () => {
    expect(listFixtures('flows')).toEqual(['default-gov-id-selfie.json']);
  });

  it('holds create-template attributes whose flow passes parseFlow', () => {
    expect(Object.keys(fixture)).toEqual(['name', 'flow', 'verification-config']);
    expect(() => parseFlow(fixture.flow)).not.toThrow();
    expect(createInquiryTemplateAttributesSchema.parse(fixture)).toEqual(fixture);
  });

  it('requires the C7 selfie checks and the C36 government ID image, MRZ and logic checks', () => {
    const config = createInquiryTemplateAttributesSchema.parse(fixture)['verification-config'];
    const required = [config['government-id'], config.selfie].flatMap((typeConfig) =>
      Object.entries(typeConfig?.checks ?? {})
        .filter(([, { enabled, required: isRequired }]) => enabled && isRequired)
        .map(([id]) => id),
    );
    // C36: the Phase 1 government ID checks stay required, among the image and capture group.
    expect(required).toEqual(expect.arrayContaining([...PHASE1_CHECKS.government_id]));
    expect(required).toEqual(expect.arrayContaining([...PHASE1_CHECKS.selfie]));
    expect(required).toContain('id_mrz_inconsistency_detection');
    expect(required).toContain('id_compromised_detection');
    expect(required).not.toContain('id_tamper_detection');
  });

  it('matches defaultInquiryTemplateAttributes()', () => {
    expect(fixture).toEqual(defaultInquiryTemplateAttributes());
  });
});

/** C5 and C14: the signing vectors shared with `packages/node` and other languages. */
const vectorsSchema = z.strictObject({
  $comment: z.string(),
  scheme: z.record(z.string(), z.unknown()),
  sign: z.array(
    z.strictObject({
      name: z.string(),
      secret: z.string(),
      timestamp: z.int(),
      body: z.string(),
      signature: z.string().regex(/^[0-9a-f]{64}$/),
      header: z.string(),
    }),
  ),
  signMultiple: z.array(
    z.strictObject({
      name: z.string(),
      secrets: z.array(z.string()).min(2),
      timestamp: z.int(),
      body: z.string(),
      header: z.string(),
    }),
  ),
  verify: z.array(
    z.strictObject({
      name: z.string(),
      secrets: z.array(z.string()).min(1),
      body: z.string(),
      header: z.string(),
      now: z.int(),
      toleranceSeconds: z.int().optional(),
      expected: z.union([
        z.strictObject({ valid: z.literal(true) }),
        z.strictObject({
          valid: z.literal(false),
          reason: z.enum([
            'malformed_header',
            'no_matching_signature',
            'timestamp_outside_tolerance',
          ]),
        }),
      ]),
    }),
  ),
});

const hmac = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret)
    .update(`${String(timestamp)}.${body}`, 'utf8')
    .digest('hex');

describe('webhooks/signature-vectors.json (C5, C14)', () => {
  const vectors = vectorsSchema.parse(readFixture('webhooks/signature-vectors.json'));

  it('has unique vector names', () => {
    for (const list of [vectors.sign, vectors.signMultiple, vectors.verify]) {
      const names = list.map(({ name }) => name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it.each(vectors.sign)('$name signs as an independent HMAC computes', (vector) => {
    expect(vector.signature).toBe(hmac(vector.secret, vector.timestamp, vector.body));
    expect(vector.header).toBe(`t=${String(vector.timestamp)},v1=${vector.signature}`);
  });

  it.each(vectors.signMultiple)('$name lists one v1 per secret, in order', (vector) => {
    const signatures = vector.secrets.map(
      (secret) => `v1=${hmac(secret, vector.timestamp, vector.body)}`,
    );
    expect(vector.header).toBe(`t=${String(vector.timestamp)},${signatures.join(' ')}`);
  });

  it('signs a rotation with the new secret first and the previous one second (C14)', () => {
    const rotation = vectors.signMultiple.find(
      ({ name }) => name === 'rotation-new-then-previous-secret',
    );
    expect(rotation?.secrets).toEqual([
      'wbhsec_test_ONLY_not_a_real_secret_000000000000004',
      'wbhsec_test_ONLY_not_a_real_secret_000000000000001',
    ]);
  });

  it('verifies a dual-signed delivery with either secret, or both, during the overlap', () => {
    const dual = vectors.verify.filter(({ name }) => name.startsWith('dual-'));
    expect(dual.map(({ name }) => name)).toEqual([
      'dual-valid-with-new-secret',
      'dual-valid-with-previous-secret',
      'dual-valid-receiver-holds-both',
      'dual-valid-signatures-in-either-order',
      'dual-wrong-secret',
      'dual-tampered-body',
      'dual-too-old',
    ]);
  });

  // The C5 grammar: no leading zeros, at most 12 digits, and 1 to 8 space-separated v1 values.
  it('keeps every verify vector consistent with an independent HMAC', () => {
    for (const vector of vectors.verify) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      const match = /^t=(0|[1-9]\d{0,11}),(v1=[0-9a-fA-F]{64}(?: v1=[0-9a-fA-F]{64}){0,7})$/.exec(
        vector.header,
      );
      if (match === null) {
        expect(vector.expected, vector.name).toEqual({ valid: false, reason: 'malformed_header' });
        continue;
      }
      const timestamp = Number(match[1]);
      const given = (match[2] ?? '').split(' ').map((part) => part.slice(3).toLowerCase());
      const matches = vector.secrets.some((secret) =>
        given.includes(hmac(secret, timestamp, vector.body)),
      );
      const fresh = Math.abs(vector.now - timestamp) <= (vector.toleranceSeconds ?? 300);
      const expected = !matches
        ? { valid: false, reason: 'no_matching_signature' }
        : fresh
          ? { valid: true }
          : { valid: false, reason: 'timestamp_outside_tolerance' };
      expect(vector.expected, vector.name).toEqual(expected);
    }
  });
});

/**
 * Workflow 7A Stage 1a (C90, C91, C94, C96): the frozen signal, session and handoff problem codes,
 * one golden problem each in `problems/signals/`, and the status it answers.
 */
const SIGNAL_PROBLEMS: Readonly<Record<string, number>> = {
  unknown_signal: 422,
  signal_not_reviewable: 422,
  signal_rule_invalid: 422,
  provider_not_bound: 422,
  basis_required: 422,
  sandbox_only_value: 422,
  consent_required: 409,
  consent_text_missing: 422,
  consent_key_conflicts_with_exempt: 422,
  filter_required: 400,
  session_limit_reached: 409,
  sms_not_configured: 422,
  display_name_required: 422,
  destination_not_confirmed: 422,
  handoff_method_not_allowed: 422,
  handoff_not_available: 409,
  handoff_token_invalid: 410,
  session_handed_off: 409,
  continue_here_not_allowed: 409,
  handoff_not_redeemed: 409,
  handoff_send_limited: 429,
};

const SIGNAL_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
};

describe('problems/signals/ (Workflow 7A)', () => {
  it('freezes the signal, session and handoff problem codes with their statuses', () => {
    expect(SIGNAL_PROBLEM_STATUSES).toEqual(SIGNAL_PROBLEMS);
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures('problems/signals')).toEqual(
      Object.keys(SIGNAL_PROBLEMS)
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(SIGNAL_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/signals/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: SIGNAL_TITLES[status],
      status,
      code,
    });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    // A problem never carries an address, a fingerprint, a destination or a token.
    expect(problem.detail).not.toMatch(/[0-9]{4}|@|ovh_|[0-9]+\.[0-9]+\.[0-9]+/);
  });

  it('points the publish refusals at their member', () => {
    expect(readFixture('problems/signals/unknown-signal.json')).toMatchObject({
      errors: [{ pointer: '/data/attributes/signal-config/collect/0' }],
    });
    expect(readFixture('problems/signals/signal-not-reviewable.json')).toMatchObject({
      errors: [{ pointer: '/data/attributes/signal-config/review-rules/0/signal' }],
    });
  });

  it('answers every handoff token failure with one uniform 410 (C96.3, P28)', () => {
    expect(readFixture('problems/signals/handoff-token-invalid.json')).toMatchObject({
      status: 410,
      detail: 'This link or code is no longer valid. Start again on the other device.',
    });
  });
});

/**
 * Workflow 7B Stage 1a (C97-C100, C106.2): the list and importer problem codes, one golden problem
 * each in `problems/lists/`. No problem carries a value (C100.4).
 */
const LIST_PROBLEMS: Readonly<Record<string, number>> = {
  biometric_lists_not_acknowledged: 409,
  consent_not_given: 422,
  kind_not_collected: 422,
  list_archived: 409,
  list_kind_mismatch: 422,
  list_limit_reached: 409,
  list_item_exists: 409,
  list_match_not_open: 409,
  retention_exceeds_consent: 422,
  invalid_value: 422,
  unparseable_phone: 422,
  host_bits_set: 422,
  out_of_range: 422,
  unsupported_class: 422,
  report_lists_required: 422,
  report_list_unavailable: 422,
};

const FAMILY_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Content Too Large',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
};

describe('problems/lists/ (Workflow 7B)', () => {
  it('freezes the list and importer problem codes with their statuses', () => {
    expect(LIST_PROBLEM_STATUSES).toEqual(LIST_PROBLEMS);
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures('problems/lists')).toEqual(
      Object.keys(LIST_PROBLEMS)
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(LIST_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/lists/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: FAMILY_TITLES[status],
      status,
      code,
    });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    // A problem never carries a value: a list value, an address, a number or an email.
    expect(problem.detail).not.toMatch(/[0-9]{4}|@|[0-9]+\.[0-9]+\.[0-9]+/);
  });

  it('points an item refusal at its member', () => {
    expect(readFixture('problems/lists/host-bits-set.json')).toMatchObject({
      errors: [{ pointer: '/data/attributes/value' }],
    });
  });
});

/**
 * Workflow 7B Stage 1a (C104, C105): the transaction problem codes, one golden problem each in
 * `problems/transactions/`. No problem carries a field value (C107.5).
 */
const TRANSACTION_PROBLEMS: Readonly<Record<string, number>> = {
  card_number_refused: 422,
  status_does_not_exist: 422,
  field_write_once: 409,
  field_schema_invalid: 422,
  relation_target_unsupported: 422,
  relation_schema_unknown: 422,
  related_object_not_found: 422,
  relation_cardinality_exceeded: 422,
  related_objects_limit: 422,
  transaction_type_archived: 409,
  transaction_type_not_published: 422,
  transaction_type_version_not_draft: 409,
  transaction_redacted: 410,
  transaction_file_too_large: 413,
  transaction_file_refused: 422,
  platform_file_not_allowed: 403,
};

describe('problems/transactions/ (Workflow 7B)', () => {
  it('freezes the transaction problem codes with their statuses', () => {
    expect(TRANSACTION_PROBLEM_STATUSES).toEqual(TRANSACTION_PROBLEMS);
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures('problems/transactions')).toEqual(
      Object.keys(TRANSACTION_PROBLEMS)
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(TRANSACTION_PROBLEMS))(
    'carries code %s with status %d',
    (code, status) => {
      const raw = readFixture(`problems/transactions/${code.replaceAll('_', '-')}.json`);
      const problem = problemSchema.parse(raw);
      expect(problem).toEqual(raw);
      expect(problem).toMatchObject({
        type: 'about:blank',
        title: FAMILY_TITLES[status],
        status,
        code,
      });
      expect(z.encode(problemSchema, problem)).toEqual(raw);
      expect(problem.detail).not.toMatch(/[0-9]{4}|@/);
    },
  );

  it('points a card refusal at its position (C104.4)', () => {
    expect(readFixture('problems/transactions/card-number-refused.json')).toMatchObject({
      errors: [{ pointer: '/data/attributes/fields/order_id' }],
    });
  });
});

/**
 * Workflow 7B Stage 1a (C102, C103): the graph problem codes, one golden problem each in
 * `problems/graph/`. No problem carries a parameter or a value (C107.5).
 */
const GRAPH_PROBLEMS: Readonly<Record<string, number>> = {
  weak_kind_not_allowed: 422,
  graph_parameter_unbound: 422,
  graph_parameter_missing: 422,
  graph_parameter_not_allowed: 403,
  graph_template_archived: 409,
  graph_template_not_published: 422,
  graph_template_version_not_draft: 409,
  graph_query_not_cancellable: 409,
  graph_query_redacted: 410,
  graph_sync_limited: 429,
  graph_node_not_found: 404,
  selection_too_large: 422,
  biometric_list_not_bulk: 422,
};

describe('problems/graph/ (Workflow 7B)', () => {
  it('freezes the graph problem codes with their statuses', () => {
    expect(GRAPH_PROBLEM_STATUSES).toEqual(GRAPH_PROBLEMS);
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures('problems/graph')).toEqual(
      Object.keys(GRAPH_PROBLEMS)
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(GRAPH_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/graph/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: FAMILY_TITLES[status],
      status,
      code,
    });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    expect(problem.detail).not.toMatch(/[0-9]{4}|@/);
  });
});

/**
 * Workflow 8A Stage 1a (C112.8): the workflow problem codes, one golden problem each in
 * `problems/workflows/`. No problem echoes a received value (C143.5): a pointer names a position,
 * a detail names a rule, and only ids, scopes, keys and step ids appear.
 */
const WORKFLOW_PROBLEMS: Readonly<Record<string, number>> = {
  definition_invalid: 422,
  version_locked: 409,
  draft_missing: 409,
  draft_exists: 409,
  rollout_in_progress: 409,
  promote_unresolved: 422,
  publish_grant_missing: 403,
  publish_acknowledgement_missing: 422,
  publish_trigger_fanout_exceeded: 422,
  trigger_input_invalid: 422,
  workflow_not_running: 409,
  run_not_resumable: 409,
  run_not_cancelable: 409,
  test_runs_sandbox_only: 403,
  secret_reference_invalid: 422,
  secret_value_missing: 422,
  secret_in_use: 409,
  human_review_pending: 409,
};

describe('problems/workflows/ (Workflow 8A)', () => {
  it('freezes the workflow problem codes with their statuses', () => {
    expect(WORKFLOW_PROBLEM_STATUSES).toEqual(WORKFLOW_PROBLEMS);
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures('problems/workflows')).toEqual(
      Object.keys(WORKFLOW_PROBLEMS)
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(WORKFLOW_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/workflows/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: FAMILY_TITLES[status],
      status,
      code,
    });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    expect(problem.detail).not.toMatch(/[0-9]{4}|@/);
  });

  it('points a definition error into the definition, with its rule (C113.6)', () => {
    expect(readFixture('problems/workflows/definition-invalid.json')).toMatchObject({
      errors: [
        { location: 'definition', pointer: '/steps/3/config/url', code: 'pii_in_url' },
        { location: 'definition', pointer: '/edges/7', code: 'edge_target_missing' },
      ],
    });
  });

  it('names what a publish lacks: the scopes, and each acknowledgement (C116.4)', () => {
    expect(readFixture('problems/workflows/publish-grant-missing.json')).toMatchObject({
      'missing-scopes': ['transactions:write'],
    });
    expect(readFixture('problems/workflows/publish-acknowledgement-missing.json')).toMatchObject({
      errors: [
        { location: 'body', pointer: '/meta/acknowledgements', detail: 'egress:notify_team' },
      ],
    });
  });

  it('says what blocks a resume, and at which step (C120.3)', () => {
    expect(readFixture('problems/workflows/run-not-resumable.json')).toMatchObject({
      'blocked-by': 'unknown_effect',
      'step-id': 'notify_team',
    });
  });

  it('answers a trigger input with its pointer alone (C118.2)', () => {
    const raw = readFixture('problems/workflows/trigger-input-invalid.json');
    expect(raw).toMatchObject({ source: { pointer: '/data/attributes/fields/reference_id' } });
  });

  it('names each reference a promote could not resolve (C112.2)', () => {
    expect(readFixture('problems/workflows/promote-unresolved.json')).toMatchObject({
      errors: [
        {
          location: 'definition',
          pointer: '/steps/2/config/list-id',
          code: 'reference_unresolved',
        },
      ],
    });
  });
});

/**
 * Workflow 8B Stage 1a (C129.7): the case problem codes, one golden problem each in
 * `problems/cases/`. No problem carries a field value, a comment, a filename or an address: a pointer
 * names a position, and only ids, status keys and dates appear.
 */
const CASE_PROBLEMS: Readonly<Record<string, number>> = {
  case_transition_refused: 422,
  case_comment_required: 422,
  case_status_tag_required: 422,
  case_resolution_invalid: 422,
  case_objects_limit: 422,
  object_type_unsupported: 422,
  object_already_attached: 409,
  case_attachment_limit: 422,
  attachment_type_refused: 422,
  attachment_infected: 409,
  attachment_scan_pending: 409,
  case_assignee_ineligible: 422,
  case_version_conflict: 409,
  sla_out_of_range: 422,
  calendar_invalid: 422,
  export_too_large: 422,
  case_redacted: 410,
  case_template_archived: 409,
  case_template_not_published: 422,
  case_template_version_not_draft: 409,
  case_template_key_taken: 409,
  case_bulk_too_large: 422,
  // The (F) family: a file vision could not render (C135.3).
  rendition_unavailable: 422,
  // Workflow 9B (C172.2, C172.3, C172.5): the case completions.
  case_checklist_incomplete: 422,
  case_fields_required: 422,
  case_action_not_available: 403,
  // K8-27 (Workflow 9B (C)): the case refusals Phase 8 answered unnamed.
  case_template_invalid: 422,
  case_search_invalid: 422,
  attachment_scan_failed: 409,
};

describe('problems/cases/ (Workflow 8B)', () => {
  it('freezes the case problem codes with their statuses', () => {
    expect(CASE_PROBLEM_STATUSES).toEqual(CASE_PROBLEMS);
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures('problems/cases')).toEqual(
      Object.keys(CASE_PROBLEMS)
        .map((code) => `${code.replaceAll('_', '-')}.json`)
        .sort(),
    );
  });

  it.each(Object.entries(CASE_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/cases/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: FAMILY_TITLES[status],
      status,
      code,
    });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    expect(problem.detail).not.toMatch(/[0-9]{4}|@/);
  });

  it('points a refused transition at the status it named (C131.1)', () => {
    expect(readFixture('problems/cases/case-transition-refused.json')).toMatchObject({
      errors: [{ location: 'body', pointer: '/meta/status' }],
    });
  });

  it("names a calendar's dates and the lock version a caller lost to (C133.3, C131.2)", () => {
    expect(readFixture('problems/cases/calendar-invalid.json')).toMatchObject({
      dates: ['2026-11-01', '2027-03-14'],
    });
    expect(readFixture('problems/cases/case-version-conflict.json')).toMatchObject({
      'lock-version': 7,
    });
  });
});

describe('the problem error member (C113.6)', () => {
  it('keeps its three members, and takes an optional rule code', () => {
    const error = { location: 'body', pointer: '/data/attributes/name', detail: 'is required' };
    expect(problemValidationErrorSchema.parse(error)).toEqual(error);
    expect(problemValidationErrorSchema.parse({ ...error, code: 'pii_in_url' })).toEqual({
      ...error,
      code: 'pii_in_url',
    });
    expect(problemValidationErrorSchema.safeParse({ ...error, code: 'Not A Code' }).success).toBe(
      false,
    );
  });
});
