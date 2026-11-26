/**
 * Every column that holds ciphertext, for the KEK rewrap (C16) and for the redaction and
 * schema tests. Keep it in step with the tables: `schema-v2.test.ts` lists the expected set.
 */

/**
 * How a column binds its ciphertext:
 * - `static`: Phase 1 `encrypted()` / `encryptedJson()`, AAD context `<table>.<column>`
 *   (for `inquiry_sessions.consent`, the IP and user agent inside the jsonb);
 * - `row`: schema v2 {@link import('./sealed.js').sealValue}, AAD context
 *   `<table>.<column>#<row id>`;
 * - `file`: `files.wrapped_dek`, the wrapped DEK of an object in storage (`encryptBytes`).
 */
export type EncryptedColumnAad = 'static' | 'row' | 'file';

export interface EncryptedColumn {
  table: string;
  column: string;
  aad: EncryptedColumnAad;
}

export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  // Workflow 11B Stage 1b (D) (C253.2): an access export's sealed manifest, its wrapped data key.
  { table: 'account_exports', column: 'wrapped_dek', aad: 'file' },
  { table: 'accounts', column: 'fields', aad: 'row' },
  { table: 'api_logs', column: 'ip', aad: 'row' },
  { table: 'api_logs', column: 'user_agent', aad: 'row' },
  { table: 'api_logs', column: 'query', aad: 'row' },
  { table: 'api_logs', column: 'request_body', aad: 'row' },
  { table: 'api_logs', column: 'response_body', aad: 'row' },
  { table: 'audit_logs', column: 'ip', aad: 'static' },
  { table: 'audit_logs', column: 'user_agent', aad: 'row' },
  { table: 'business_registry_records', column: 'record', aad: 'row' },
  { table: 'chip_challenges', column: 'aa_response', aad: 'row' },
  { table: 'chip_challenges', column: 'device_report', aad: 'row' },
  { table: 'chip_reads', column: 'fields', aad: 'row' },
  { table: 'chip_reads', column: 'sod_signature', aad: 'row' },
  // Workflow 11A Stage 1b (C) (C230.5, C231.3): a connection's data-sharing agreement reference.
  { table: 'connect_connections', column: 'agreement_reference', aad: 'row' },
  // Workflow 11A Stage 1b (K) (C230.5, C236): a consent record's evidence and attested text, bound to
  // its id; a flow text's body, bound to `<environment id>:<sha256>` (P11).
  { table: 'consent_records', column: 'attested_text_body', aad: 'row' },
  { table: 'consent_records', column: 'evidence_ip', aad: 'row' },
  { table: 'consent_records', column: 'evidence_user_agent', aad: 'row' },
  { table: 'consent_records', column: 'evidence_reference', aad: 'row' },
  { table: 'consent_texts', column: 'body', aad: 'row' },
  { table: 'crypto_challenges', column: 'message', aad: 'row' },
  { table: 'crypto_challenges', column: 'signature', aad: 'row' },
  { table: 'crypto_challenges', column: 'signed_message', aad: 'row' },
  { table: 'crypto_challenges', column: 'wallet_address', aad: 'row' },
  { table: 'document_extractions', column: 'fields', aad: 'row' },
  { table: 'events', column: 'payload', aad: 'static' },
  // Workflow 9B Stage 1b (X) (C166.1, C174.5): an export's request (its filter's values) and its file.
  { table: 'exports', column: 'request', aad: 'row' },
  { table: 'exports', column: 'wrapped_dek', aad: 'file' },
  { table: 'face_templates', column: 'template', aad: 'row' },
  { table: 'files', column: 'wrapped_dek', aad: 'file' },
  { table: 'government_id_extractions', column: 'fields', aad: 'row' },
  // Phase 7, Workflow 7B (C102.4, C102.7): a graph query's bound parameters, which name people.
  { table: 'graph_queries', column: 'params', aad: 'row' },
  { table: 'idempotency_keys', column: 'response_body', aad: 'row' },
  // Phase 7 (C100.2): the importer's envelope object; `files` requires a verification.
  { table: 'importers', column: 'wrapped_dek', aad: 'file' },
  { table: 'inquiries', column: 'fields', aad: 'static' },
  { table: 'inquiries', column: 'note', aad: 'row' },
  // Workflow 9A Stage 1b (S) (C149.4, C174.5): the fields set at creation.
  { table: 'inquiries', column: 'initial_fields', aad: 'row' },
  // Phase 7 (C94.2, P19): a signal body's collector components and its behaviour aggregates.
  { table: 'inquiry_session_signals', column: 'behaviour', aad: 'row' },
  { table: 'inquiry_session_signals', column: 'components', aad: 'row' },
  // Workflow 10B Stage 1b (I) (C211.3, C211.4, C221.3): a device's integrity token until its decode,
  // and the verdict's fixed projection.
  { table: 'inquiry_integrity_challenges', column: 'token', aad: 'row' },
  { table: 'inquiry_integrity_verdicts', column: 'verdict', aad: 'row' },
  { table: 'inquiry_sessions', column: 'consent', aad: 'static' },
  { table: 'inquiry_sessions', column: 'ip', aad: 'row' },
  // Phase 7 (C91.1, C91.6): the session's and the network's IP location, and the network's address.
  { table: 'inquiry_sessions', column: 'location', aad: 'row' },
  { table: 'inquiry_sessions', column: 'user_agent', aad: 'row' },
  // Phase 7, Workflow 7B (C98.1, C98.3, C99.3, C100.2, P18): the staged import rows, an item's
  // sealed copy of a face template, its masked background object, the item as entered, and a
  // match's compared value and dismissal reason.
  { table: 'list_import_rows', column: 'value', aad: 'row' },
  { table: 'list_item_backgrounds', column: 'masked_file_wrapped_dek', aad: 'file' },
  { table: 'list_item_faces', column: 'template', aad: 'row' },
  { table: 'list_items', column: 'value', aad: 'row' },
  { table: 'list_matches', column: 'matched_value', aad: 'row' },
  { table: 'list_matches', column: 'reason', aad: 'row' },
  { table: 'mfa_factors', column: 'totp_secret', aad: 'row' },
  { table: 'networks', column: 'ip', aad: 'row' },
  { table: 'networks', column: 'location', aad: 'row' },
  { table: 'otp_challenges', column: 'destination', aad: 'row' },
  // Phase 6 (C73.4): a report's query and result, an action's details, a match's snapshot.
  { table: 'report_actions', column: 'details', aad: 'row' },
  { table: 'report_matches', column: 'snapshot', aad: 'row' },
  // Workflow 9B Stage 1b (X) (C166.5, C174.5; review P24): a bulk job's uploaded CSV.
  { table: 'report_bulk_jobs', column: 'wrapped_dek', aad: 'file' },
  { table: 'reports', column: 'query', aad: 'row' },
  { table: 'reports', column: 'result', aad: 'row' },
  { table: 'selfie_captures', column: 'device', aad: 'row' },
  // Phase 7, Workflow 7B (C105.1, C105.4): a file field's name and its envelope object, and a
  // transaction's fields.
  { table: 'transaction_files', column: 'filename', aad: 'row' },
  { table: 'transaction_files', column: 'wrapped_dek', aad: 'file' },
  { table: 'transactions', column: 'fields', aad: 'row' },
  // Phase 8, Workflow 8A (C117.2, C118.2, C118.3): a run's values, a step's, an effect's result, a
  // trigger file's envelope and name, and a scheduled run's mapped inputs.
  { table: 'workflow_runs', column: 'trigger_snapshot', aad: 'row' },
  { table: 'workflow_runs', column: 'inputs', aad: 'row' },
  { table: 'workflow_runs', column: 'variables', aad: 'row' },
  { table: 'workflow_runs', column: 'outputs', aad: 'row' },
  { table: 'workflow_run_steps', column: 'input', aad: 'row' },
  { table: 'workflow_run_steps', column: 'output', aad: 'row' },
  { table: 'workflow_run_steps', column: 'console', aad: 'row' },
  { table: 'workflow_step_effects', column: 'result', aad: 'row' },
  { table: 'workflow_run_files', column: 'filename', aad: 'row' },
  { table: 'workflow_run_files', column: 'wrapped_dek', aad: 'file' },
  { table: 'scheduled_runs', column: 'inputs', aad: 'row' },
  // C128.1 (Workflow 8A (A)): a decision's comment; the rest of the record is codes and ids.
  { table: 'inquiry_decisions', column: 'comment', aad: 'row' },
  // C125.1 (Workflow 8A (X)): a workflow secret's value, and its previous value in a rotation.
  { table: 'workflow_secret_values', column: 'value', aad: 'row' },
  { table: 'workflow_secret_values', column: 'previous_value', aad: 'row' },
  // C136.4, C134.1, C137.4 (Workflow 8B (C)): a case's fields, a comment's message and a bulk
  // action's request.
  { table: 'cases', column: 'fields', aad: 'row' },
  { table: 'case_comments', column: 'message', aad: 'row' },
  { table: 'case_bulk_actions', column: 'request', aad: 'row' },
  // C135.2, C135.3, C138.1 (Workflow 8B (F)): an attachment's name and its object, a rendition page's
  // object, and an export's request and its file.
  { table: 'case_attachments', column: 'original_filename', aad: 'row' },
  { table: 'case_attachments', column: 'wrapped_dek', aad: 'file' },
  { table: 'case_exports', column: 'request', aad: 'row' },
  { table: 'case_exports', column: 'wrapped_dek', aad: 'file' },
  { table: 'rendition_pages', column: 'wrapped_dek', aad: 'file' },
  { table: 'verification_inputs', column: 'values', aad: 'row' },
  // Workflow 9A Stage 1b (T) (C156.4, C174.5): a user's simulation preset scope.
  { table: 'simulation_presets', column: 'scope', aad: 'row' },
  // Workflow 11B Stage 1b (A) (C248.3, C248.4; review P35, Stage 1a amendment 11): a provider's client
  // secret, bound to its id, and a login state's nonce and PKCE verifier, bound to its binding digest.
  { table: 'sso_login_states', column: 'code_verifier', aad: 'row' },
  { table: 'sso_login_states', column: 'nonce', aad: 'row' },
  { table: 'sso_providers', column: 'client_secret', aad: 'row' },
  // Workflow 9A Stage 1b (H) (C160.6, C174.5): a theme asset's envelope in storage.
  { table: 'theme_assets', column: 'wrapped_dek', aad: 'file' },
  { table: 'webhooks', column: 'custom_headers', aad: 'row' },
  { table: 'webhooks', column: 'previous_secret', aad: 'row' },
  { table: 'webhooks', column: 'secret', aad: 'static' },
];

/** The row-bound AAD names (`<table>.<column>`) the repositories seal with. */
export const SEALED = {
  accountFields: 'accounts.fields',
  apiLogIp: 'api_logs.ip',
  apiLogUserAgent: 'api_logs.user_agent',
  apiLogQuery: 'api_logs.query',
  apiLogRequestBody: 'api_logs.request_body',
  apiLogResponseBody: 'api_logs.response_body',
  governmentIdExtractionFields: 'government_id_extractions.fields',
  faceTemplate: 'face_templates.template',
  selfieCaptureDevice: 'selfie_captures.device',
  auditLogUserAgent: 'audit_logs.user_agent',
  idempotencyResponseBody: 'idempotency_keys.response_body',
  inquiryNote: 'inquiries.note',
  // Workflow 9A Stage 1b (S) (C149.4): the fields set at creation, never changed.
  inquiryInitialFields: 'inquiries.initial_fields',
  // Workflow 9A Stage 1b (T) (C156.4, C174.5): a user's simulation preset scope.
  simulationPresetScope: 'simulation_presets.scope',
  inquirySessionIp: 'inquiry_sessions.ip',
  // Workflow 10B Stage 1b (I) (C211.3, C211.4): the token bound to its challenge's id, the verdict
  // to its inquiry's id.
  integrityChallengeToken: 'inquiry_integrity_challenges.token',
  integrityVerdict: 'inquiry_integrity_verdicts.verdict',
  inquirySessionUserAgent: 'inquiry_sessions.user_agent',
  mfaTotpSecret: 'mfa_factors.totp_secret',
  // Phase 5, Workflow 5A (C53.2, C53.4).
  verificationInputValues: 'verification_inputs.values',
  otpChallengeDestination: 'otp_challenges.destination',
  cryptoChallengeWalletAddress: 'crypto_challenges.wallet_address',
  cryptoChallengeMessage: 'crypto_challenges.message',
  cryptoChallengeSignature: 'crypto_challenges.signature',
  cryptoChallengeSignedMessage: 'crypto_challenges.signed_message',
  // Phase 5, Workflow 5B (C53.3, C53.4).
  documentExtractionFields: 'document_extractions.fields',
  chipChallengeAaResponse: 'chip_challenges.aa_response',
  chipChallengeDeviceReport: 'chip_challenges.device_report',
  chipReadFields: 'chip_reads.fields',
  chipReadSodSignature: 'chip_reads.sod_signature',
  businessRegistryRecord: 'business_registry_records.record',
  // Phase 6 (C73.2, C73.4).
  reportQuery: 'reports.query',
  reportResult: 'reports.result',
  reportActionDetails: 'report_actions.details',
  reportMatchSnapshot: 'report_matches.snapshot',
  webhookCustomHeaders: 'webhooks.custom_headers',
  webhookPreviousSecret: 'webhooks.previous_secret',
  // Phase 7, Workflow 7A (C91.1, C91.3, C91.6).
  inquirySessionLocation: 'inquiry_sessions.location',
  networkIp: 'networks.ip',
  networkLocation: 'networks.location',
  // Phase 7, Workflow 7A (C94.2): bound to `sessionSignalRowKey(session id, sequence)`.
  sessionSignalComponents: 'inquiry_session_signals.components',
  sessionSignalBehaviour: 'inquiry_session_signals.behaviour',
  // Phase 7, Workflow 7B (C98.1, C99.3, C100.2).
  listItemValue: 'list_items.value',
  listItemFaceTemplate: 'list_item_faces.template',
  listMatchMatchedValue: 'list_matches.matched_value',
  listMatchReason: 'list_matches.reason',
  // Bound to `importRowKey(importer id, row)`.
  listImportRowValue: 'list_import_rows.value',
  // Phase 7, Workflow 7B (C105.1, C105.4).
  transactionFields: 'transactions.fields',
  transactionFileFilename: 'transaction_files.filename',
  // Phase 7, Workflow 7B (C102.4).
  graphQueryParams: 'graph_queries.params',
  // Phase 8, Workflow 8A (C117.2, C118.2, C118.3).
  workflowRunTriggerSnapshot: 'workflow_runs.trigger_snapshot',
  workflowRunInputs: 'workflow_runs.inputs',
  workflowRunVariables: 'workflow_runs.variables',
  workflowRunOutputs: 'workflow_runs.outputs',
  workflowStepInput: 'workflow_run_steps.input',
  workflowStepOutput: 'workflow_run_steps.output',
  workflowStepConsole: 'workflow_run_steps.console',
  workflowEffectResult: 'workflow_step_effects.result',
  workflowRunFileFilename: 'workflow_run_files.filename',
  scheduledRunInputs: 'scheduled_runs.inputs',
  inquiryDecisionComment: 'inquiry_decisions.comment',
  // C125.1 (Workflow 8A (X)).
  workflowSecretValue: 'workflow_secret_values.value',
  workflowSecretPreviousValue: 'workflow_secret_values.previous_value',
  // C136.4, C134.1, C137.4 (Workflow 8B (C)).
  caseFields: 'cases.fields',
  caseCommentMessage: 'case_comments.message',
  caseBulkActionRequest: 'case_bulk_actions.request',
  // C135.2, C138.1 (Workflow 8B (F)): an attachment's original filename and an export's request.
  caseAttachmentFilename: 'case_attachments.original_filename',
  caseExportRequest: 'case_exports.request',
  // C166.1 (Workflow 9B Stage 1b (X)): an export's request, the filter with its values.
  exportRequest: 'exports.request',
  // Workflow 11A Stage 1b (C) (C230.5, C231.3): bound to the connection's id.
  connectAgreementReference: 'connect_connections.agreement_reference',
  // Workflow 11A Stage 1b (K) (C230.5, C236): bound to the record's id.
  consentAttestedTextBody: 'consent_records.attested_text_body',
  consentEvidenceIp: 'consent_records.evidence_ip',
  consentEvidenceUserAgent: 'consent_records.evidence_user_agent',
  consentEvidenceReference: 'consent_records.evidence_reference',
  // P11: bound to `consentTextRowId(environment id, sha256)`.
  consentTextBody: 'consent_texts.body',
  // Workflow 11B Stage 1b (A) (C248.3, C248.4): bound to the provider's id, and to the login state's
  // `binding_sha256`.
  ssoProviderClientSecret: 'sso_providers.client_secret',
  ssoLoginStateNonce: 'sso_login_states.nonce',
  ssoLoginStateCodeVerifier: 'sso_login_states.code_verifier',
} as const;
