/**
 * C15, C115.6, C143.5: the attributes every exit masks by name, in one list. The API's mask
 * (`apps/api/src/auth/pii.ts`, `MASKED_ATTRIBUTES`) and the workflow engine's taint of a run's
 * trigger view (`MASKED_ATTRIBUTE_NAMES`) both read it, so a name added here is masked at every exit
 * and tainted in every run (Workflow 8C review K8-11; it was two hand copies, which had drifted).
 * A contract marks some attributes with `.meta`, and this list holds the rest, so taint is at least as
 * wide as masking.
 */
import { PII_CASE_ATTACHMENT_ATTRIBUTES } from './case-attachments.js';
import { PII_CASE_COMMENT_ATTRIBUTES } from './case-comments.js';
import { PII_CASE_ATTRIBUTES } from './cases.js';
import { PII_CONSENT_RECORD_ATTRIBUTES } from './consent-records.js';
import { PII_SHARE_TOKEN_ATTRIBUTES } from './connect.js';
import { PII_DECISION_ATTRIBUTES } from './decisions.js';
import { PII_EXPORT_ATTRIBUTES } from './exports.js';
import { PII_FLOW_SCREEN_ATTRIBUTES } from './flow-embed.js';
import { PII_SIMULATION_PRESET_ATTRIBUTES } from './simulation-presets.js';
import { PII_GRAPH_ATTRIBUTES } from './graph-queries.js';
import { PII_IMPORTER_ATTRIBUTES } from './importers.js';
import { PII_LIST_ATTRIBUTES } from './lists.js';
import { PII_REPORT_BULK_ATTRIBUTES } from './report-bulk.js';
import { PII_REPORT_ATTRIBUTES } from './reports.js';
import { PII_SANDBOX_MESSAGE_ATTRIBUTES } from './sandbox-messages.js';
import { PII_SIGNAL_ATTRIBUTES } from './signal-pii.js';
import { PII_TRANSACTION_ATTRIBUTES } from './transactions.js';
import {
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  PII_VERIFICATION_ATTRIBUTES,
} from './verifications.js';
import { PII_WORKFLOW_RUN_ATTRIBUTES } from './workflow-runs.js';

export const PII_MASKED_ATTRIBUTES: readonly string[] = Object.freeze([
  ...new Set([
    'fields',
    'note',
    'ip-address',
    'user-agent',
    ...GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
    ...PII_VERIFICATION_ATTRIBUTES,
    // C70.3 (Phase 6): every attribute a report, report run or report action marks PII.
    ...PII_REPORT_ATTRIBUTES,
    // C91.6, C107.5 (Workflow 7A): the session's location, the network's address and location,
    // the device's fingerprints and the handoff destination.
    ...PII_SIGNAL_ATTRIBUTES,
    // C97.6, C107.5 (Workflow 7B): every item value but the country code, a match's compared value
    // and dismissal reason, probes and the importer's file. Masked at the attribute level only, so
    // a signal's nested `value` stays.
    ...PII_LIST_ATTRIBUTES,
    ...PII_IMPORTER_ATTRIBUTES,
    // C105.8, C107.5 (Workflow 7B): a transaction's fields, member-wise, and what a body carries.
    ...PII_TRANSACTION_ATTRIBUTES,
    // C102.4, C102.6, C107.5 (Workflow 7B): a graph query's params, member-wise, a body's
    // parameter-map and variable-map, and the unmasked node value. Masked at the attribute level
    // only, so a node's `value` (a random id local to the result, P17) stays.
    ...PII_GRAPH_ATTRIBUTES,
    // C120.6, C143.5 (Workflow 8A): a run's and a step's values, and what a body carries, whole. The
    // run routes mask by the registry's marks first, which is stricter; this is the list a stored
    // log and any other exit fall back on.
    ...PII_WORKFLOW_RUN_ATTRIBUTES,
    // C128.1, C143.5 (P19): a decision's sealed comment.
    ...PII_DECISION_ATTRIBUTES,
    // C126.4, C143.5 (H16): what a sandbox provider recorded of a message.
    ...PII_SANDBOX_MESSAGE_ATTRIBUTES,
    // C136.4, C134.1, C143.5 (Workflow 8B): a case's fields, member-wise, the creator's address and a
    // review request's statement; a comment's message.
    ...PII_CASE_ATTRIBUTES,
    ...PII_CASE_COMMENT_ATTRIBUTES,
    // C135.2, C143.5 (Workflow 8B (F)): an attachment's filename, which a case serves inside its
    // `attachments`; `attributes()` nulls it there.
    ...PII_CASE_ATTACHMENT_ATTRIBUTES,
    // C148.5, C149.4, C174.5 (Workflow 9A Stage 1b (S)): a screen submission's `values`, and the
    // initial fields wherever a document would carry them.
    ...PII_FLOW_SCREEN_ATTRIBUTES,
    'initial-fields',
    // C156.4, C174.5 (Workflow 9A Stage 1b (T)): a simulation preset's scope (review P12).
    ...PII_SIMULATION_PRESET_ATTRIBUTES,
    // C166.1, C166.5, C174.5 (Workflow 9B Stage 1b (X); B19; review P24): an export body's filter and
    // a bulk upload's CSV part.
    ...PII_EXPORT_ATTRIBUTES,
    ...PII_REPORT_BULK_ATTRIBUTES,
    // C233, C236.1 (Workflow 11A; rule 11): a peek's `source-data`, and a consent record's evidence
    // reference and stored text (its address and user agent are `ip-address` and `user-agent`,
    // above).
    ...PII_SHARE_TOKEN_ATTRIBUTES,
    ...PII_CONSENT_RECORD_ATTRIBUTES,
  ]),
]);
