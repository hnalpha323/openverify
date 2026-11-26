/**
 * C122.1: `api-actions`' handlers, by `key@version`. `engine/actions.ts` joins this list to the
 * process's table, so a step with no handler errors `provider_not_configured`, never a skip.
 */
import type { ActionHandler } from '../engine/action-port.js';
import { FIND_OR_CREATE_ACCOUNT_HANDLER } from './accounts/find-or-create.js';
import { TRUST_DEVICE_HANDLER } from './devices/trust-action.js';
import { RUN_GRAPH_QUERY_HANDLER } from './graph/run-graph-query.js';
import { SYNC_GRAPH_HANDLER } from './graph/sync-graph.js';
import { CREATE_INQUIRY_HANDLER } from './inquiries/create.js';
import {
  APPROVE_INQUIRY_HANDLER,
  DECLINE_INQUIRY_HANDLER,
  MARK_INQUIRY_FOR_REVIEW_HANDLER,
} from './inquiries/decisions.js';
import {
  SEND_INQUIRY_LINK_EMAIL_HANDLER,
  SEND_INQUIRY_LINK_SMS_HANDLER,
} from './inquiries/links.js';
import { ADD_FACE_LIST_ITEM_HANDLER, ADD_LIST_ITEM_HANDLER } from './lists/add-item.js';
import { GET_LIST_MATCH_HANDLER } from './lists/get-list-match.js';
import { FETCH_OBJECT_HANDLER } from './objects/fetch.js';
import { REDACT_OBJECT_HANDLER } from './objects/redact.js';
import { COPY_TAGS_HANDLER, REMOVE_TAG_HANDLER, TAG_OBJECT_HANDLER } from './objects/tags.js';
import { UPDATE_OBJECT_HANDLER } from './objects/update.js';
import { RERUN_REPORT_HANDLER } from './reports/rerun-report.js';
import { RESCREEN_ACCOUNT_REPORTS_HANDLER } from './reports/rescreen-account-reports.js';
import { RUN_REPORT_HANDLER } from './reports/run-report.js';
import {
  CREATE_TRANSACTION_HANDLER,
  SET_RELATION_HANDLER,
  UNSET_RELATION_HANDLER,
  UPDATE_TRANSACTION_STATUS_HANDLER,
} from './transactions/actions.js';
import { RUN_VERIFICATION_HANDLER } from './verifications/run-verification.js';

export const OBJECT_ACTION_HANDLERS: readonly ActionHandler[] = [
  APPROVE_INQUIRY_HANDLER,
  DECLINE_INQUIRY_HANDLER,
  MARK_INQUIRY_FOR_REVIEW_HANDLER,
  CREATE_INQUIRY_HANDLER,
  SEND_INQUIRY_LINK_EMAIL_HANDLER,
  SEND_INQUIRY_LINK_SMS_HANDLER,
  RUN_REPORT_HANDLER,
  RERUN_REPORT_HANDLER,
  RESCREEN_ACCOUNT_REPORTS_HANDLER,
  RUN_VERIFICATION_HANDLER,
  GET_LIST_MATCH_HANDLER,
  ADD_LIST_ITEM_HANDLER,
  ADD_FACE_LIST_ITEM_HANDLER,
  RUN_GRAPH_QUERY_HANDLER,
  SYNC_GRAPH_HANDLER,
  FIND_OR_CREATE_ACCOUNT_HANDLER,
  CREATE_TRANSACTION_HANDLER,
  UPDATE_TRANSACTION_STATUS_HANDLER,
  SET_RELATION_HANDLER,
  UNSET_RELATION_HANDLER,
  TRUST_DEVICE_HANDLER,
  TAG_OBJECT_HANDLER,
  REMOVE_TAG_HANDLER,
  COPY_TAGS_HANDLER,
  FETCH_OBJECT_HANDLER,
  UPDATE_OBJECT_HANDLER,
  REDACT_OBJECT_HANDLER,
];
