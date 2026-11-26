import { STATUS_CODES } from 'node:http';
import {
  aamvaVerificationResourceSchema,
  accountActionResourceSchema,
  decisionResourceSchema,
  workflowSecretResourceSchema,
  addressLookupReportResourceSchema,
  caseActionResourceSchema,
  caseAssignmentPolicyResourceSchema,
  caseBulkActionResourceSchema,
  caseCalendarResourceSchema,
  caseExportResourceSchema,
  caseCommentResourceSchema,
  caseHeldObjectResourceSchema,
  caseHistoryEntryResourceSchema,
  caseQueueResourceSchema,
  caseResourceSchema,
  caseSlaPolicyResourceSchema,
  caseTemplateResourceSchema,
  caseTemplateVersionResourceSchema,
  customListReportResourceSchema,
  deviceResourceSchema,
  ipAddressReportResourceSchema,
  networkResourceSchema,
  adverseMediaReportResourceSchema,
  businessAdverseMediaReportResourceSchema,
  businessWatchlistReportResourceSchema,
  cryptoAddressWatchlistReportResourceSchema,
  emailAddressReportResourceSchema,
  phoneNumberReportResourceSchema,
  politicallyExposedPersonReportResourceSchema,
  reportActionResourceSchema,
  reportMatchSchema,
  reportRunResourceSchema,
  reportTemplateResourceSchema,
  reportTemplateVersionResourceSchema,
  watchlistReportResourceSchema,
  businessWebsiteVerificationResourceSchema,
  createdWebhookResourceSchema,
  cryptoWalletVerificationResourceSchema,
  databaseBusinessVerificationResourceSchema,
  databaseVerificationResourceSchema,
  documentVerificationResourceSchema,
  emailAddressVerificationResourceSchema,
  eventResourceSchema,
  fieldSchemaSchema,
  fileResourceSchema,
  flowAamvaVerificationResourceSchema,
  flowBusinessWebsiteVerificationResourceSchema,
  flowCryptoWalletVerificationResourceSchema,
  flowDatabaseBusinessVerificationResourceSchema,
  flowDatabaseVerificationResourceSchema,
  flowDocumentVerificationResourceSchema,
  flowEmailAddressVerificationResourceSchema,
  flowGovernmentIdNfcVerificationResourceSchema,
  flowGovernmentIdVerificationResourceSchema,
  flowPhoneNumberVerificationResourceSchema,
  flowSelfieVerificationResourceSchema,
  governmentIdNfcVerificationResourceSchema,
  governmentIdVerificationResourceSchema,
  graphQueryResourceSchema,
  graphQueryTemplateResourceSchema,
  graphQueryTemplateVersionResourceSchema,
  importerResourceSchema,
  inquiryResourceSchema,
  inquiryTemplateResourceSchema,
  listItemResourceSchema,
  listMatchResourceSchema,
  listResourceSchema,
  phoneNumberVerificationResourceSchema,
  PROBLEM_MEDIA_TYPE,
  problemSchema,
  retryHintSchema,
  selfieVerificationResourceSchema,
  transactionLabelResourceSchema,
  transactionResourceSchema,
  transactionTypeResourceSchema,
  transactionTypeVersionResourceSchema,
  verificationCheckSchema,
  verificationConfigSchema,
  userNotificationResourceSchema,
  webhookResourceSchema,
  workflowActionResourceSchema,
  workflowDefinitionSchema,
  workflowDeploymentResourceSchema,
  workflowJsonSchema,
  workflowRecipeResourceSchema,
  workflowResourceSchema,
  workflowRunResourceSchema,
  workflowRunStepResourceSchema,
  workflowTriggerDeliveryResourceSchema,
  workflowVersionResourceSchema,
} from '@openverify/contracts';
import { checkIdSchema, reasonCodeSchema } from '@openverify/core';
import { componentSchema, flowSchema, flowV2Schema } from '@openverify/flow-spec';
import { z } from 'zod';

/**
 * Contract schemas the OpenAPI document names in `components.schemas` and references with
 * `$ref`, instead of repeating them in every operation. A dedicated registry, so the global
 * zod registry other modules see is left alone.
 */
export const openApiComponents = z.registry<{ id: string }>();

const NAMED_SCHEMAS: readonly [string, z.ZodType][] = [
  ['Problem', problemSchema],
  ['CheckId', checkIdSchema],
  ['ReasonCode', reasonCodeSchema],
  ['VerificationCheck', verificationCheckSchema],
  ['RetryHint', retryHintSchema],
  ['Flow', flowSchema],
  // C147, C148 (Workflow 9A): the v2 flow, and its recursive component (a container's children),
  // which must be a named component for its references to resolve (K8-15).
  ['FlowV2', flowV2Schema],
  ['FlowComponent', componentSchema],
  ['VerificationConfig', verificationConfigSchema],
  ['InquiryTemplate', inquiryTemplateResourceSchema],
  ['Inquiry', inquiryResourceSchema],
  ['GovernmentIdVerification', governmentIdVerificationResourceSchema],
  ['SelfieVerification', selfieVerificationResourceSchema],
  // C50.1: the Phase 5 types, so each union references them instead of repeating them.
  ['DocumentVerification', documentVerificationResourceSchema],
  ['DatabaseVerification', databaseVerificationResourceSchema],
  ['AamvaVerification', aamvaVerificationResourceSchema],
  ['PhoneNumberVerification', phoneNumberVerificationResourceSchema],
  ['EmailAddressVerification', emailAddressVerificationResourceSchema],
  ['GovernmentIdNfcVerification', governmentIdNfcVerificationResourceSchema],
  ['CryptoWalletVerification', cryptoWalletVerificationResourceSchema],
  ['DatabaseBusinessVerification', databaseBusinessVerificationResourceSchema],
  ['BusinessWebsiteVerification', businessWebsiteVerificationResourceSchema],
  ['FlowGovernmentIdVerification', flowGovernmentIdVerificationResourceSchema],
  ['FlowSelfieVerification', flowSelfieVerificationResourceSchema],
  ['FlowDocumentVerification', flowDocumentVerificationResourceSchema],
  ['FlowDatabaseVerification', flowDatabaseVerificationResourceSchema],
  ['FlowAamvaVerification', flowAamvaVerificationResourceSchema],
  ['FlowPhoneNumberVerification', flowPhoneNumberVerificationResourceSchema],
  ['FlowEmailAddressVerification', flowEmailAddressVerificationResourceSchema],
  ['FlowGovernmentIdNfcVerification', flowGovernmentIdNfcVerificationResourceSchema],
  ['FlowCryptoWalletVerification', flowCryptoWalletVerificationResourceSchema],
  ['FlowDatabaseBusinessVerification', flowDatabaseBusinessVerificationResourceSchema],
  ['FlowBusinessWebsiteVerification', flowBusinessWebsiteVerificationResourceSchema],
  ['File', fileResourceSchema],
  ['Webhook', webhookResourceSchema],
  ['CreatedWebhook', createdWebhookResourceSchema],
  ['Event', eventResourceSchema],
  // C70 (Phase 6): the report types, their review view, history and templates.
  ['WatchlistReport', watchlistReportResourceSchema],
  ['BusinessWatchlistReport', businessWatchlistReportResourceSchema],
  ['CryptoAddressWatchlistReport', cryptoAddressWatchlistReportResourceSchema],
  ['PoliticallyExposedPersonReport', politicallyExposedPersonReportResourceSchema],
  ['AdverseMediaReport', adverseMediaReportResourceSchema],
  ['BusinessAdverseMediaReport', businessAdverseMediaReportResourceSchema],
  ['EmailAddressReport', emailAddressReportResourceSchema],
  ['PhoneNumberReport', phoneNumberReportResourceSchema],
  ['AddressLookupReport', addressLookupReportResourceSchema],
  ['ReportMatch', reportMatchSchema],
  ['ReportRun', reportRunResourceSchema],
  ['ReportAction', reportActionResourceSchema],
  ['ReportTemplate', reportTemplateResourceSchema],
  ['ReportTemplateVersion', reportTemplateVersionResourceSchema],
  // Phase 7 (Workflow 7A Stage 1a): the ip-address report (C106.1) and the network (C91.3), so
  // the report union and the session payloads reference them.
  ['IpAddressReport', ipAddressReportResourceSchema],
  ['Network', networkResourceSchema],
  ['Device', deviceResourceSchema],
  // C97, C99, C100, C106.2 (Workflow 7B): lists, items, matches, importers and the custom-list report.
  ['List', listResourceSchema],
  ['ListItem', listItemResourceSchema],
  ['ListMatch', listMatchResourceSchema],
  ['Importer', importerResourceSchema],
  ['CustomListReport', customListReportResourceSchema],
  // C104, C105 (Workflow 7B): the field-schema union, which refers to itself, and the resources.
  ['FieldSchema', fieldSchemaSchema],
  ['TransactionType', transactionTypeResourceSchema],
  ['TransactionTypeVersion', transactionTypeVersionResourceSchema],
  ['Transaction', transactionResourceSchema],
  ['TransactionLabel', transactionLabelResourceSchema],
  // C102 (Workflow 7B): the graph.
  ['GraphQuery', graphQueryResourceSchema],
  ['GraphQueryTemplate', graphQueryTemplateResourceSchema],
  ['GraphQueryTemplateVersion', graphQueryTemplateVersionResourceSchema],
  // C112-C122 (Workflow 8A). JSON values are recursive, so they have one name.
  ['JsonValue', workflowJsonSchema],
  ['Workflow', workflowResourceSchema],
  ['WorkflowDefinition', workflowDefinitionSchema],
  ['WorkflowVersion', workflowVersionResourceSchema],
  ['WorkflowDeployment', workflowDeploymentResourceSchema],
  ['WorkflowRun', workflowRunResourceSchema],
  ['WorkflowRunStep', workflowRunStepResourceSchema],
  ['WorkflowTriggerDelivery', workflowTriggerDeliveryResourceSchema],
  ['WorkflowAction', workflowActionResourceSchema],
  ['WorkflowRecipe', workflowRecipeResourceSchema],
  ['AccountAction', accountActionResourceSchema],
  ['Decision', decisionResourceSchema],
  ['WorkflowSecret', workflowSecretResourceSchema],
  // C129-C140 (Workflow 8B).
  ['Case', caseResourceSchema],
  ['CaseTemplate', caseTemplateResourceSchema],
  ['CaseTemplateVersion', caseTemplateVersionResourceSchema],
  ['CaseComment', caseCommentResourceSchema],
  ['CaseAction', caseActionResourceSchema],
  ['CaseHistoryEntry', caseHistoryEntryResourceSchema],
  ['CaseHeldObject', caseHeldObjectResourceSchema],
  ['CaseBulkAction', caseBulkActionResourceSchema],
  ['UserNotification', userNotificationResourceSchema],
  // C132, C133 (Workflow 8B, the (Q) family).
  ['CaseQueue', caseQueueResourceSchema],
  ['CaseAssignmentPolicy', caseAssignmentPolicyResourceSchema],
  ['CaseSlaPolicy', caseSlaPolicyResourceSchema],
  ['CaseCalendar', caseCalendarResourceSchema],
  // C135, C138 (Workflow 8B, the (F) family).
  ['CaseExport', caseExportResourceSchema],
];
for (const [id, schema] of NAMED_SCHEMAS) {
  openApiComponents.add(schema, { id });
}

/** An error response as the problem-details handler sends it (RFC 9457). */
export interface ProblemResponse {
  description: string;
  content: { [PROBLEM_MEDIA_TYPE]: { schema: typeof problemSchema } };
}

/**
 * Route `response` entries documenting `application/problem+json` errors, for example
 * `...problemResponses(400, 404)`. Fastify also serializes those errors with the schema.
 */
export function problemResponses<const S extends number>(
  ...statuses: readonly S[]
): Record<S, ProblemResponse> {
  const entries = statuses.map((status) => [
    status,
    {
      description: STATUS_CODES[status] ?? 'Error',
      content: { [PROBLEM_MEDIA_TYPE]: { schema: problemSchema } },
    },
  ]);
  return Object.fromEntries(entries) as Record<S, ProblemResponse>;
}

/** `Cache-Control` of responses that carry a credential or other one-time secret. */
export const NO_STORE = 'no-store';
