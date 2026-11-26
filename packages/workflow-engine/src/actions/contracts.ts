/**
 * Every 8A action's config and output schemas, by key (C122.2). The registry's entries read this
 * table (`catalogue.ts`), so a key has one config and one output. Each family's schemas are in its own
 * file, and each is exported by name for the action that implements it.
 */
import type { z } from 'zod';
import {
  calculateConfigSchema,
  calculateOutputSchema,
  runWorkflowConfigSchema,
  runWorkflowOutputSchema,
  scheduleWorkflowConfigSchema,
  scheduleWorkflowOutputSchema,
  updateVariableConfigSchema,
  updateVariableOutputSchema,
} from './control.js';
import { evaluateCodeConfigSchema, evaluateCodeOutputSchema } from './evaluate-code.js';
import {
  runGraphQueryConfigSchema,
  runGraphQueryOutputSchema,
  syncGraphConfigSchema,
  syncGraphOutputSchema,
} from './graph.js';
import { makeHttpsRequestConfigSchema, makeHttpsRequestOutputSchema } from './https.js';
import {
  approveInquiryConfigSchema,
  approveInquiryOutputSchema,
  createInquiryConfigSchema,
  createInquiryOutputSchema,
  declineInquiryConfigSchema,
  declineInquiryOutputSchema,
  markInquiryForReviewConfigSchema,
  markInquiryForReviewOutputSchema,
  sendInquiryLinkConfigSchema,
  sendInquiryLinkOutputSchema,
} from './inquiries.js';
import {
  addFaceListItemConfigSchema,
  addFaceListItemOutputSchema,
  addListItemConfigSchema,
  addListItemOutputSchema,
  getListMatchConfigSchema,
  getListMatchOutputSchema,
} from './lists.js';
import {
  messageOutputSchema,
  sendEmailConfigSchema,
  sendSlackMessageConfigSchema,
  sendSmsConfigSchema,
} from './messages.js';
import {
  copyTagsConfigSchema,
  createTransactionConfigSchema,
  createTransactionOutputSchema,
  fetchObjectConfigSchema,
  fetchObjectOutputSchema,
  findOrCreateAccountConfigSchema,
  findOrCreateAccountOutputSchema,
  redactObjectConfigSchema,
  redactObjectOutputSchema,
  relationConfigSchema,
  relationOutputSchema,
  removeTagConfigSchema,
  tagObjectConfigSchema,
  tagOutputSchema,
  trustDeviceConfigSchema,
  trustDeviceOutputSchema,
  updateObjectConfigSchema,
  updateObjectOutputSchema,
  updateTransactionStatusConfigSchema,
  updateTransactionStatusOutputSchema,
} from './objects.js';
import type { WorkflowActionKey } from './registry.js';
import {
  rerunReportConfigSchema,
  rescreenAccountReportsConfigSchema,
  rescreenAccountReportsOutputSchema,
  rerunReportOutputSchema,
  runReportConfigSchema,
  runReportOutputSchema,
  runVerificationConfigSchema,
  runVerificationOutputSchema,
} from './reports.js';

export interface ActionContract {
  readonly config: z.ZodType;
  readonly output: z.ZodType;
}

export const WORKFLOW_ACTION_CONTRACTS = Object.freeze({
  approve_inquiry: { config: approveInquiryConfigSchema, output: approveInquiryOutputSchema },
  decline_inquiry: { config: declineInquiryConfigSchema, output: declineInquiryOutputSchema },
  mark_inquiry_for_review: {
    config: markInquiryForReviewConfigSchema,
    output: markInquiryForReviewOutputSchema,
  },
  create_inquiry: { config: createInquiryConfigSchema, output: createInquiryOutputSchema },
  send_inquiry_link_email: {
    config: sendInquiryLinkConfigSchema,
    output: sendInquiryLinkOutputSchema,
  },
  send_inquiry_link_sms: {
    config: sendInquiryLinkConfigSchema,
    output: sendInquiryLinkOutputSchema,
  },
  run_report: { config: runReportConfigSchema, output: runReportOutputSchema },
  rerun_report: { config: rerunReportConfigSchema, output: rerunReportOutputSchema },
  rescreen_account_reports: {
    config: rescreenAccountReportsConfigSchema,
    output: rescreenAccountReportsOutputSchema,
  },
  run_verification: { config: runVerificationConfigSchema, output: runVerificationOutputSchema },
  get_list_match: { config: getListMatchConfigSchema, output: getListMatchOutputSchema },
  add_list_item: { config: addListItemConfigSchema, output: addListItemOutputSchema },
  add_face_list_item: { config: addFaceListItemConfigSchema, output: addFaceListItemOutputSchema },
  run_graph_query: { config: runGraphQueryConfigSchema, output: runGraphQueryOutputSchema },
  sync_graph: { config: syncGraphConfigSchema, output: syncGraphOutputSchema },
  find_or_create_account: {
    config: findOrCreateAccountConfigSchema,
    output: findOrCreateAccountOutputSchema,
  },
  create_transaction: {
    config: createTransactionConfigSchema,
    output: createTransactionOutputSchema,
  },
  update_transaction_status: {
    config: updateTransactionStatusConfigSchema,
    output: updateTransactionStatusOutputSchema,
  },
  set_relation: { config: relationConfigSchema, output: relationOutputSchema },
  unset_relation: { config: relationConfigSchema, output: relationOutputSchema },
  trust_device: { config: trustDeviceConfigSchema, output: trustDeviceOutputSchema },
  tag_object: { config: tagObjectConfigSchema, output: tagOutputSchema },
  remove_tag: { config: removeTagConfigSchema, output: tagOutputSchema },
  copy_tags: { config: copyTagsConfigSchema, output: tagOutputSchema },
  fetch_object: { config: fetchObjectConfigSchema, output: fetchObjectOutputSchema },
  update_object: { config: updateObjectConfigSchema, output: updateObjectOutputSchema },
  redact_object: { config: redactObjectConfigSchema, output: redactObjectOutputSchema },
  evaluate_code: { config: evaluateCodeConfigSchema, output: evaluateCodeOutputSchema },
  calculate: { config: calculateConfigSchema, output: calculateOutputSchema },
  update_variable: { config: updateVariableConfigSchema, output: updateVariableOutputSchema },
  run_workflow: { config: runWorkflowConfigSchema, output: runWorkflowOutputSchema },
  schedule_workflow: { config: scheduleWorkflowConfigSchema, output: scheduleWorkflowOutputSchema },
  make_https_request: {
    config: makeHttpsRequestConfigSchema,
    output: makeHttpsRequestOutputSchema,
  },
  send_email: { config: sendEmailConfigSchema, output: messageOutputSchema },
  send_sms: { config: sendSmsConfigSchema, output: messageOutputSchema },
  send_slack_message: { config: sendSlackMessageConfigSchema, output: messageOutputSchema },
} as const satisfies Record<WorkflowActionKey, ActionContract>);
