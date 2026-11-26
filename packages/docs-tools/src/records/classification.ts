/**
 * C276.2 (Workflow 11E, `docs-records`): the data classification, generated from the code and
 * never the other way round (review F07; Workflow 11E Stage 1a amendment 2(f)).
 *
 * - The classes, the share categories and the class of every field type come from
 *   `packages/core/src/connect/categories.ts` (`DATA_CLASSES`, `SHARE_CATEGORY_DATA_CLASS`,
 *   `FIELD_TYPE_CLASS`, `WELL_KNOWN_FIELD_CATEGORY`).
 * - `categories.ts` holds no column-to-class map, so {@link COLUMN_CLASSES} is that table, held by
 *   a test to name exactly the `ENCRYPTED_COLUMNS` entries (`packages/db/src/encrypted-columns.ts`).
 * - The redaction categories are parsed from `apps/api/src/services/redaction.test-support.ts`
 *   (it seeds a database, so it is read as text, never imported), the retention defaults read from
 *   `DASHBOARD_SETTINGS_DEFAULTS` and the access export's sections from
 *   `accountExportManifestSchema` (`@openverify/contracts`).
 *
 * {@link dataClassification} is the interface docs-compliance's record-of-processing generator
 * reads (C278.5); {@link renderDataClassification} writes `docs/security/data-classification.md`.
 */
import { DASHBOARD_SETTINGS_DEFAULTS } from '@openverify/contracts';
import {
  DATA_CLASSES,
  FIELD_TYPE_CLASS,
  SHARE_CATEGORIES,
  SHARE_CATEGORY_DATA_CLASS,
  SHARE_FIELD_TYPES,
  WELL_KNOWN_FIELD_CATEGORY,
  type DataClass,
  type ShareCategory,
  type ShareFieldType,
} from '@openverify/core';
import { ENCRYPTED_COLUMNS } from '../../../db/src/encrypted-columns.js';
import type { Repository } from '../types.js';

/** Where the redaction categories are declared (parsed, never imported: it seeds a database). */
export const REDACTION_CATEGORIES_PATH = 'apps/api/src/services/redaction.test-support.ts';

/** Where the tables are declared (parsed for their names). */
export const TABLES_DIRECTORY = 'packages/db/src/tables';

/** The committed page this module renders. */
export const DATA_CLASSIFICATION_PATH = 'docs/security/data-classification.md';

/** How one class of data is handled. Each sentence describes the code at its commit. */
export interface ClassProfile {
  readonly title: string;
  readonly holds: string;
  readonly encryption: string;
  /** Environment settings (keys of `DASHBOARD_SETTINGS_DEFAULTS`) that set its retention. */
  readonly retentionSettings: readonly string[];
  readonly retention: string;
  readonly logging: string;
  readonly permission: string;
  /** Access-export manifest sections (`subject.<name>`, `operator-review.<name>`, `files`). */
  readonly exportSections: readonly string[];
  readonly exportNote: string;
  /** Why no share category maps to it, or how it travels in a share. */
  readonly shareNote: string;
}

/** The class of one sealed column, and what it holds. */
export interface ColumnClass {
  readonly class: DataClass;
  readonly holds: string;
}

/** Data kept in plaintext (or as a digest or HMAC) by decision, with its reason. */
export interface PlaintextRecord {
  readonly where: string;
  /** The tables it lives in (none for an object-storage prefix); each must exist. */
  readonly tables: readonly string[];
  readonly class: DataClass;
  readonly holds: string;
  readonly reason: string;
  readonly retentionSettings: readonly string[];
  readonly retention: string;
}

/** A redaction category of `apps/api/src/services/redaction.test-support.ts`. */
export interface HandlingGroupProfile {
  readonly title: string;
  readonly description: string;
}

export const CLASS_PROFILES: Readonly<Record<DataClass, ClassProfile>> = Object.freeze({
  biometric: {
    title: 'Biometric',
    holds:
      'Face templates, selfie and ID portrait images, liveness and face-match evidence, and the face and background items of biometric lists.',
    encryption:
      'Face templates are sealed per row (AES-256-GCM under a fresh data key wrapped by the KEK, `packages/db/src/sealed.ts`); images and masked backgrounds are objects in storage, each under its own data key, whose wrapped copy is the sealed column.',
    retentionSettings: ['face-template-retention-days', 'inquiry-retention-days'],
    retention:
      "The C16 pass deletes face templates and their background rows after `face-template-retention-days`, whatever the inquiry's own retention; images go with the inquiry's redaction. A face or background list item has its list's `item-retention-days`, required on those lists.",
    logging:
      'Never logged. The worker redacts `template`, `embedding`, `landmarks`, `layout` and `bytes` wherever they appear (`apps/api/src/jobs/logger.ts`; `docs/security/logging.md`).',
    permission:
      "A file's content and a biometric list item need `pii:view`, checked in the handler; `biometric-lists-basis` is changed under `settings:privacy`.",
    exportSections: ['subject.face-templates'],
    exportNote:
      'Face templates are listed as present with their count, never exported (C253.3); selfie images are listed with the verification files (`files`).',
    shareNote:
      'A face template is in no category: it is never shared (`categories.ts`, decision 23).',
  },
  'identity-documents': {
    title: 'Identity documents',
    holds:
      'Document images, the data extracted from them (OCR, barcodes, the MRZ), what an NFC chip returned, and the check results derived from them.',
    encryption:
      'Extractions and chip data are sealed per row (`government_id_extractions.fields`, `document_extractions.fields`, `chip_reads.fields`); images, case attachments and rendition pages are objects under their own data keys.',
    retentionSettings: ['inquiry-retention-days'],
    retention:
      "With the inquiry: the C16 pass redacts an inquiry in a terminal status after its template version's `retention-days`, else the environment's `inquiry-retention-days` (unset by default, so an inquiry is kept until it is redacted).",
    logging:
      "Never logged. `chipFile`, `aaResponse` and the nfc client view's MRZ member are pino redaction keys (`apps/api/src/logger.ts`).",
    permission:
      '`pii:view` unmasks the extraction attributes and allows file content (`apps/api/src/auth/pii.ts`); without it they are served masked.',
    exportSections: ['subject.verifications', 'files'],
    exportNote:
      'Verifications with their extracted data and checks; each file as a manifest entry (kind, size, SHA-256), its bytes streamed from the live object.',
    shareNote: '',
  },
  'identity-fields': {
    title: 'Identity fields',
    holds:
      "The subject's fields (names, dates, addresses, identification numbers, any free-form value), notes and comments about the subject, and the bodies that carry them (API logs, events, idempotent answers, workflow run values).",
    encryption:
      "Sealed: per row since schema v2, per column for Phase 1's `inquiries.fields` and `events.payload`.",
    retentionSettings: [
      'inquiry-retention-days',
      'report-retention-days',
      'case-retention-days',
      'workflow-run-retention-days',
      'api-log-retention-days',
      'event-retention-days',
    ],
    retention:
      'With the object that holds them: an inquiry by its template or environment retention; reports, cases and workflow run values by their own settings; API logs and events by theirs. An account has no retention setting and is kept until it is redacted.',
    logging:
      'Never logged as a value. Code that must log personal data nests it under a `pii` key, which pino redacts (C53.8); a stored API log is sealed and masked for a reader without `pii:view` (`docs/security/logging.md`).',
    permission:
      "`pii:view` unmasks `fields`, `note` and the other masked attributes (`apps/api/src/auth/pii.ts`); a redaction needs the object's `:redact` scope.",
    exportSections: [
      'subject.account',
      'subject.inquiries',
      'subject.decisions',
      'subject.reports',
      'subject.consent-records',
      'subject.connect-shares',
      'operator-review.cases',
    ],
    exportNote:
      'The account and its linked records, as the API serves them with `pii:view`; cases and their comments under `operator-review`, labelled "review before disclosure".',
    shareNote: '',
  },
  contact: {
    title: 'Contact',
    holds:
      "Email addresses and phone numbers: a field of type `email-address` or a well-known contact key, and an OTP challenge's destination.",
    encryption:
      "Inside the sealed fields of the object that holds them; an OTP challenge's destination is sealed per row.",
    retentionSettings: ['inquiry-retention-days'],
    retention:
      "With the inquiry or account that holds them; an OTP challenge goes with its inquiry's redaction.",
    logging:
      '`otpCode` and `otpDestination` are pino redaction keys; a stored API log masks `phone-number` and `email-address` for a reader without `pii:view`.',
    permission: '`pii:view`.',
    exportSections: [],
    exportNote:
      "Inside the account's and the inquiries' fields (`subject.account`, `subject.inquiries`).",
    shareNote: '',
  },
  'device-and-network': {
    title: 'Device and network',
    holds:
      "The client's address, location and user agent, signal bodies' components and behaviour, device HMACs, network facts, device-integrity tokens and verdicts, and the client a session names.",
    encryption:
      "Addresses, locations, user agents, signal components and behaviour, integrity tokens and verdicts are sealed per row (the consent's address and user agent inside its jsonb, per column); device HMACs, network facts and the parsed device fields are plaintext by decision (below).",
    retentionSettings: [
      'signal-component-retention-days',
      'ip-retention-days',
      'device-retention-days',
    ],
    retention:
      'The C16 pass nulls signal components after `signal-component-retention-days` (the behaviour aggregates stay with the inquiry), nulls session and network addresses after `ip-retention-days` (unset: kept with the inquiry), deletes devices unseen for `device-retention-days`, and deletes integrity challenges once expired and integrity records of a redacted inquiry.',
    logging:
      'The request log is `{ method, route }` (C93.7): no URL, host, client address or port. An address, coordinate, fingerprint or user agent is logged only under the `pii` key (C53.8).',
    permission:
      "`pii:view` unmasks a session's address and user agent and the other signal attributes (`PII_SIGNAL_ATTRIBUTES`); the collection tiers are changed under `settings:privacy`.",
    exportSections: [
      'subject.inquiry-sessions',
      'subject.devices',
      'operator-review.signals',
      'operator-review.integrity-verdicts',
    ],
    exportNote:
      'Sessions (with their consent, address and user agent) and devices under `subject`; signals and integrity verdicts under `operator-review`.',
    shareNote:
      'No share category maps to it: a clone never writes a signal, a session record or a device fact (C234.3, `apps/api/src/services/connect/clone.ts`).',
  },
  'financial-and-crypto': {
    title: 'Financial and crypto',
    holds:
      "Transactions' fields and files, and crypto-wallet challenges (the wallet address, the message, the signature and the signed message).",
    encryption: 'Sealed per row; a transaction file is an object under its own data key.',
    retentionSettings: ['transaction-retention-days', 'inquiry-retention-days'],
    retention:
      "Transactions are redacted, never deleted, after `transaction-retention-days` (unset: kept) and with their linked subject's redaction (owner decision 1 after Workflow 7B); a field marked `never` is kept. Wallet challenges go with the inquiry.",
    logging:
      "`walletAddress`, `challengeMessage` and `signedMessage` are pino redaction keys; a stored API log masks a transaction's fields and a searched `filter[identifier][value]`.",
    permission:
      "`transactions:read` and `transactions:write`; a transaction file's content needs `pii:view`, checked in the handler.",
    exportSections: ['subject.transactions'],
    exportNote:
      'Transactions linked to the account; their files as `transaction-file` entries of `files`.',
    shareNote:
      "No share category maps to it: a hydrated transaction's fields travel under their field types' categories (C230.4, `apps/api/src/services/connect/hydrate.ts`).",
  },
  'operator-and-audit': {
    title: 'Operator and audit',
    holds:
      "The operators' own records: the audit log's address and user agent, consent texts and the bare facts of consent records, connections' agreement references, theme assets and analytics rollups.",
    encryption:
      'The audit address is sealed per column and its user agent per row; consent texts, agreement references and theme assets are sealed; rollups are plaintext aggregates.',
    retentionSettings: [
      'audit-log-retention-days',
      'consent-proof-retention-days',
      'analytics-retention-months',
      'analytics-assignee-retention-months',
    ],
    retention:
      "Audit entries are append-only and kept unless `audit-log-retention-days` is set; a consent record's bare fact is kept `consent-proof-retention-days` after the data it covers is gone; rollups by the analytics settings.",
    logging:
      'The audit log is the record; the processes never write its address or user agent to their logs.',
    permission: '`audit-logs:read`; the settings under `settings:read` and `settings:write`.',
    exportSections: [],
    exportNote: "Not in the access export: it is the operator's record, not the subject's.",
    shareNote: 'No share category maps to it.',
  },
  secrets: {
    title: 'Secrets',
    holds:
      'Credentials (webhook secrets and custom headers, TOTP secrets, workflow secret values, SSO client secrets and login states) and the hashes, HMACs and digests that stand for passwords, keys and tokens.',
    encryption:
      'Sealed where the value must be read back; kept only as a hash, an HMAC or a digest where it need only be compared (`docs/security/crypto-inventory.md`).',
    retentionSettings: [],
    retention:
      'Until rotated or deleted. Console sessions, one-time links and handoff tokens are deleted 30 days past their expiry, SSO login states a day after they expire.',
    logging:
      'Never logged: credential headers are redacted on requests and responses, the worker redacts `secret` and `serviceToken`, and a stored API log replaces each `API_LOG_REDACTED_KEYS` member with `[REDACTED]` before storage.',
    permission:
      "Written through the routes of the object that holds them (workflow secrets, webhooks, MFA factors, SSO providers), under those routes' permissions.",
    exportSections: [],
    exportNote: 'Never in the access export.',
    shareNote: 'Never shared.',
  },
  'public-and-list-data': {
    title: 'Public and list data',
    holds:
      "Data that is public or that operators enter about people who need not be subjects: public watchlist entries, the operator's lists and their imports, publishers' network data, trust anchors, and the snapshot of a matched entry.",
    encryption:
      "An operator's list item values, import rows and importer objects are sealed (third-party personal data); public watchlist entries, network data and trust anchors are plaintext.",
    retentionSettings: [],
    retention:
      "A list item has its list's `item-retention-days` (at most 3,650; required on face and background lists); an importer's object goes 7 days after the import ended; public sources are replaced at each sync; a network snapshot is kept 7 days after it is superseded.",
    logging:
      '`reportQuery`, `matchedName`, `listEntryName` and `articleTitle` are pino redaction keys; a stored API log masks list item values and match values (`PII_LIST_ATTRIBUTES`).',
    permission:
      '`lists:read`, `lists:write` and `importers:*`; `/lists/match` and biometric items need `pii:view`, checked in the handler.',
    exportSections: ['operator-review.list-memberships'],
    exportNote:
      "The account's list memberships under `operator-review`; a list's items about other people are never in a subject's export.",
    shareNote: 'No share category maps to it.',
  },
});

const column = (cls: DataClass, holds: string): ColumnClass => Object.freeze({ class: cls, holds });

/** The class of every `ENCRYPTED_COLUMNS` entry, keyed `<table>.<column>` (amendment 2(f)). */
export const COLUMN_CLASSES: Readonly<Record<string, ColumnClass>> = Object.freeze({
  'account_exports.wrapped_dek': column(
    'identity-fields',
    "the data key of an access export's sealed manifest, which holds every class of the subject's data",
  ),
  'accounts.fields': column('identity-fields', "an account's fields, each classed by its type"),
  'api_logs.ip': column('device-and-network', "the API caller's address"),
  'api_logs.user_agent': column('device-and-network', "the API caller's user agent"),
  'api_logs.query': column('identity-fields', "a request's query parameters"),
  'api_logs.request_body': column('identity-fields', 'a request body, after the stored-log rules'),
  'api_logs.response_body': column(
    'identity-fields',
    'a response body, after the stored-log rules',
  ),
  'audit_logs.ip': column('operator-and-audit', "the acting principal's address"),
  'audit_logs.user_agent': column('operator-and-audit', "the acting principal's user agent"),
  'business_registry_records.record': column('identity-fields', 'a business registry record'),
  'chip_challenges.aa_response': column(
    'identity-documents',
    "a chip's Active Authentication response",
  ),
  'chip_challenges.device_report': column('device-and-network', "the reading device's report"),
  'chip_reads.fields': column('identity-documents', "the data groups' fields a chip returned"),
  'chip_reads.sod_signature': column(
    'identity-documents',
    "the chip's document security object signature",
  ),
  'connect_connections.agreement_reference': column(
    'operator-and-audit',
    "the two organisations' data-sharing agreement reference",
  ),
  'consent_records.attested_text_body': column(
    'operator-and-audit',
    'the text an attested consent showed',
  ),
  'consent_records.evidence_ip': column('device-and-network', "the consenting client's address"),
  'consent_records.evidence_user_agent': column(
    'device-and-network',
    "the consenting client's user agent",
  ),
  'consent_records.evidence_reference': column(
    'identity-fields',
    "an attestation's reference to the operator's own evidence (free text, which may name the subject)",
  ),
  'consent_texts.body': column(
    'operator-and-audit',
    'a composed flow consent text, keyed by its SHA-256',
  ),
  'crypto_challenges.message': column(
    'financial-and-crypto',
    'the message a wallet is asked to sign',
  ),
  'crypto_challenges.signature': column('financial-and-crypto', "the wallet's signature"),
  'crypto_challenges.signed_message': column('financial-and-crypto', 'the message as signed'),
  'crypto_challenges.wallet_address': column('financial-and-crypto', 'the wallet address'),
  'document_extractions.fields': column('identity-documents', "a document's extracted fields"),
  'events.payload': column('identity-fields', "an event's payload, the resource it carries"),
  'exports.request': column('identity-fields', "an export's request, its filter with the values"),
  'exports.wrapped_dek': column('identity-fields', "the data key of an export's file"),
  'face_templates.template': column('biometric', 'a face template'),
  'files.wrapped_dek': column(
    'biometric',
    'the data key of an uploaded file: document images and selfies (classed by its most sensitive content)',
  ),
  'government_id_extractions.fields': column('identity-documents', "an ID's extracted fields"),
  'graph_queries.params': column(
    'identity-fields',
    "a graph query's bound parameters, the values a principal searched for",
  ),
  'idempotency_keys.response_body': column(
    'identity-fields',
    'the answer an idempotency key replays',
  ),
  'importers.wrapped_dek': column(
    'public-and-list-data',
    "the data key of an importer's uploaded file",
  ),
  'inquiries.fields': column('identity-fields', "an inquiry's fields, each classed by its type"),
  'inquiries.note': column('identity-fields', "an inquiry's free-text note"),
  'inquiries.initial_fields': column(
    'identity-fields',
    'the fields set when the inquiry was created',
  ),
  'inquiry_session_signals.behaviour': column(
    'device-and-network',
    "a signal body's behaviour aggregates",
  ),
  'inquiry_session_signals.components': column(
    'device-and-network',
    "a signal body's collector components",
  ),
  'inquiry_integrity_challenges.token': column(
    'device-and-network',
    "a device's integrity token until its decode",
  ),
  'inquiry_integrity_verdicts.verdict': column(
    'device-and-network',
    "the integrity verdict's fixed projection",
  ),
  'inquiry_sessions.consent': column(
    'device-and-network',
    "the session consent's address and user agent, sealed inside the jsonb",
  ),
  'inquiry_sessions.ip': column('device-and-network', "the session's client address"),
  'inquiry_sessions.location': column('device-and-network', "the session's IP location"),
  'inquiry_sessions.user_agent': column('device-and-network', "the session's user agent"),
  'list_import_rows.value': column('public-and-list-data', "a staged import row's value"),
  'list_item_backgrounds.masked_file_wrapped_dek': column(
    'biometric',
    "the data key of a background list item's masked object",
  ),
  'list_item_faces.template': column('biometric', "a face list item's sealed template"),
  'list_items.value': column('public-and-list-data', 'a list item as entered'),
  'list_matches.matched_value': column(
    'identity-fields',
    "the subject's value a list matched (a name, an address, a number)",
  ),
  'list_matches.reason': column('identity-fields', "a match's dismissal reason (free text)"),
  'mfa_factors.totp_secret': column('secrets', "an operator's TOTP secret"),
  'networks.ip': column('device-and-network', "a network evaluation's address"),
  'networks.location': column('device-and-network', "a network evaluation's IP location"),
  'otp_challenges.destination': column('contact', "an OTP's email address or phone number"),
  'report_actions.details': column('identity-fields', "a report action's details"),
  'report_matches.snapshot': column('public-and-list-data', "the matched list entry's snapshot"),
  'report_bulk_jobs.wrapped_dek': column(
    'identity-fields',
    "the data key of a bulk report job's uploaded CSV, about people who need not be subjects",
  ),
  'reports.query': column('identity-fields', "a report's query, the values screened"),
  'reports.result': column('identity-fields', "a report's result"),
  'selfie_captures.device': column(
    'device-and-network',
    "the capturing device's snapshot and camera label",
  ),
  'transaction_files.filename': column('financial-and-crypto', "a transaction file's name"),
  'transaction_files.wrapped_dek': column(
    'financial-and-crypto',
    'the data key of a transaction file',
  ),
  'transactions.fields': column('financial-and-crypto', "a transaction's fields"),
  'workflow_runs.trigger_snapshot': column('identity-fields', "a run's trigger snapshot"),
  'workflow_runs.inputs': column('identity-fields', "a run's inputs"),
  'workflow_runs.variables': column('identity-fields', "a run's variables"),
  'workflow_runs.outputs': column('identity-fields', "a run's outputs"),
  'workflow_run_steps.input': column('identity-fields', "a step's input"),
  'workflow_run_steps.output': column('identity-fields', "a step's output"),
  'workflow_run_steps.console': column('identity-fields', "an Evaluate Code step's console"),
  'workflow_step_effects.result': column('identity-fields', "an effect's result"),
  'workflow_run_files.filename': column('identity-fields', "a run file's name"),
  'workflow_run_files.wrapped_dek': column('identity-fields', 'the data key of a run file'),
  'scheduled_runs.inputs': column('identity-fields', "a scheduled run's mapped inputs"),
  'inquiry_decisions.comment': column('identity-fields', "a decision's comment"),
  'workflow_secret_values.value': column('secrets', "a workflow secret's value"),
  'workflow_secret_values.previous_value': column(
    'secrets',
    "a workflow secret's previous value in a rotation",
  ),
  'cases.fields': column('identity-fields', "a case's fields"),
  'case_comments.message': column('identity-fields', "a case comment's message"),
  'case_bulk_actions.request': column('identity-fields', "a bulk case action's request"),
  'case_attachments.original_filename': column('identity-fields', "an attachment's original name"),
  'case_attachments.wrapped_dek': column('identity-documents', 'the data key of a case attachment'),
  'case_exports.request': column('identity-fields', "a case export's request"),
  'case_exports.wrapped_dek': column('identity-fields', "the data key of a case export's file"),
  'rendition_pages.wrapped_dek': column('identity-documents', 'the data key of a rendition page'),
  'verification_inputs.values': column('identity-fields', "a verification's entered values"),
  'simulation_presets.scope': column(
    'identity-fields',
    "a simulation preset's scope, sealed because an operator may paste a real person's values into it",
  ),
  'sso_login_states.code_verifier': column('secrets', "a console sign-in's PKCE verifier"),
  'sso_login_states.nonce': column('secrets', "a console sign-in's nonce"),
  'sso_providers.client_secret': column('secrets', "an SSO provider's client secret"),
  'theme_assets.wrapped_dek': column(
    'operator-and-audit',
    "the data key of a theme's logo or font",
  ),
  'webhooks.custom_headers': column(
    'secrets',
    "a webhook's custom headers (the receiver's credentials)",
  ),
  'webhooks.previous_secret': column('secrets', "a webhook's previous signing secret"),
  'webhooks.secret': column('secrets', "a webhook's signing secret"),
});

const plaintext = (record: PlaintextRecord): PlaintextRecord => Object.freeze(record);

/** What is kept in plaintext, or only as a digest or an HMAC, by decision (rule 10: each says why). */
export const PLAINTEXT_RECORDS: readonly PlaintextRecord[] = Object.freeze([
  plaintext({
    where:
      '`devices` (`browser_fingerprint`, `device_fingerprint`, `device_class`, `key_id`) and `session_devices`',
    tables: ['devices', 'session_devices'],
    class: 'device-and-network',
    holds:
      "HMACs of the strict browser fingerprint, the `ANDROID_ID` and the device class, with the key id, and each session's link to its device",
    reason:
      "64-hex HMACs under the environment's blind-index subkey (C94.4): matchable, not reversible without the key; a device exists only when the device-recognition tier recorded one",
    retentionSettings: ['device-retention-days'],
    retention: 'deleted when unseen for `device-retention-days`',
  }),
  plaintext({
    where: '`networks`, every column but `ip` and `location`',
    tables: ['networks'],
    class: 'device-and-network',
    holds: "a session's network facts (autonomous system, organisation, country, connection type)",
    reason: 'plaintext by decision (C107.5): they describe a network, not a person',
    retentionSettings: ['ip-retention-days'],
    retention: 'kept with the inquiry; the address beside them is nulled by `ip-retention-days`',
  }),
  plaintext({
    where:
      '`inquiry_sessions` (`os_name`, `browser_name`, `device_type`, `device_name`, `mobile_sdk_name` and their versions)',
    tables: ['inquiry_sessions'],
    class: 'device-and-network',
    holds: "the parsed facts of the session's client, and the client SDK a session names",
    reason: 'parsed fields of at most 64 characters each (C94.5), no address and no identifier',
    retentionSettings: ['inquiry-retention-days'],
    retention: 'with the inquiry',
  }),
  plaintext({
    where: '`network_sources`, `network_syncs`, and the objects `network/<source>/<sha256>`',
    tables: ['network_sources', 'network_syncs'],
    class: 'public-and-list-data',
    holds:
      "publishers' network data (DB-IP Lite, the Tor exit list, cloud range files) and its syncs",
    reason: 'public data with no personal data in it',
    retentionSettings: [],
    retention: 'a snapshot is kept 7 days after it is superseded',
  }),
  plaintext({
    where:
      '`watchlist_sources`, `watchlist_entries`, `watchlist_names`, `watchlist_identifiers`, `watchlist_crypto_addresses`',
    tables: [
      'watchlist_sources',
      'watchlist_entries',
      'watchlist_names',
      'watchlist_identifiers',
      'watchlist_crypto_addresses',
    ],
    class: 'public-and-list-data',
    holds: 'the entries of public sanctions, politically exposed person and other public lists',
    reason: 'published by their sources',
    retentionSettings: [],
    retention: 'replaced at each sync',
  }),
  plaintext({
    where: '`trust_anchors`, `trust_crls`, `trust_anchor_sources`',
    tables: ['trust_anchors', 'trust_crls', 'trust_anchor_sources'],
    class: 'public-and-list-data',
    holds:
      'country signing certificates and revocation lists for chip reads, and the sandbox-only Utopia test anchor (`trust:sandbox-utopia`)',
    reason: 'public certificates',
    retentionSettings: [],
    retention: 'replaced at each refresh',
  }),
  plaintext({
    where: '`list_item_keys`, `list_items.country_code`',
    tables: ['list_item_keys', 'list_items'],
    class: 'public-and-list-data',
    holds: "the HMAC keys a list item is matched by, and an item's country code",
    reason:
      "matchable keys under the list kinds' identifier labels; plaintext by decision (C107.5)",
    retentionSettings: [],
    retention: 'with the item',
  }),
  plaintext({
    where: '`graph_attributes.value_key`',
    tables: ['graph_attributes'],
    class: 'identity-fields',
    holds: 'a 64-hex HMAC of each indexed attribute of an inquiry or account',
    reason:
      "pseudonymous keys under each kind's identifier subkey, with no sealed column (C101.1); indexing is the `graph-indexing` setting",
    retentionSettings: [],
    retention: "deleted with the inquiry's or account's redaction",
  }),
  plaintext({
    where: '`transaction_field_keys.value_key`',
    tables: ['transaction_field_keys'],
    class: 'financial-and-crypto',
    holds: 'an HMAC of each searchable field of a transaction',
    reason: 'searchable without decrypting the sealed fields',
    retentionSettings: ['transaction-retention-days'],
    retention: "with the transaction's redaction",
  }),
  plaintext({
    where: '`audit_log_ip_index.ip_hmac`',
    tables: ['audit_log_ip_index'],
    class: 'operator-and-audit',
    holds: "an HMAC of each audit entry's address",
    reason: "the audit explorer's address search, under the environment's blind-index subkey",
    retentionSettings: ['audit-log-retention-days'],
    retention: 'with its audit entry',
  }),
  plaintext({
    where: 'the `analytics_*` rollup tables',
    tables: [
      'analytics_inquiry_daily',
      'analytics_verification_daily',
      'analytics_check_daily',
      'analytics_case_assignee_daily',
    ],
    class: 'operator-and-audit',
    holds: 'daily counts and rates; the per-reviewer rollup names operators',
    reason: 'aggregates, served with small-count suppression (`analytics-suppression-threshold`)',
    retentionSettings: ['analytics-retention-months', 'analytics-assignee-retention-months'],
    retention: 'deleted after their months',
  }),
  plaintext({
    where: '`consent_records`, every column but the sealed evidence and attested text',
    tables: ['consent_records'],
    class: 'operator-and-audit',
    holds:
      "a consent's bare fact: its time, side, purpose, recipient, categories, the text's SHA-256 and its method",
    reason: 'the proof of a consent outlives the data it covers (C241.3)',
    retentionSettings: ['consent-proof-retention-days'],
    retention: 'kept `consent-proof-retention-days` after the covered data is gone',
  }),
  plaintext({
    where: '`connect_share_tokens`',
    tables: ['connect_share_tokens'],
    class: 'operator-and-audit',
    holds:
      "a share token's ids, status, categories and times; no shared value (the id is a handle, not a secret)",
    reason: 'a redeemed token is the disclosure record (C241.4)',
    retentionSettings: [],
    retention:
      'expired and failed tokens 30 days after they ended; a redeemed one while its source or a copy exists',
  }),
  plaintext({
    where: '`users.password_hash`, `mfa_recovery_codes.code_hash`',
    tables: ['users', 'mfa_recovery_codes'],
    class: 'secrets',
    holds: 'Argon2id hashes of passwords and recovery codes',
    reason: 'compared, never read back',
    retentionSettings: [],
    retention: 'until changed or regenerated',
  }),
  plaintext({
    where: '`api_keys.secret_hash`',
    tables: ['api_keys'],
    class: 'secrets',
    holds: 'an HMAC-SHA-256 of each API key under the pepper',
    reason: 'compared, never read back',
    retentionSettings: [],
    retention: 'until the key is deleted',
  }),
  plaintext({
    where:
      '`user_sessions.token_hash`, `one_time_links.token_hash`, `mfa_challenges.token_hash`, `users.invitation_token_hash`, `handoff_tokens` (`token_hash`, `confirmation_code_hash`)',
    tables: ['user_sessions', 'one_time_links', 'mfa_challenges', 'users', 'handoff_tokens'],
    class: 'secrets',
    holds:
      'digests of console session, one-time link, MFA challenge, invitation and handoff tokens, and of a handoff confirmation code over its token',
    reason: 'compared, never read back',
    retentionSettings: [],
    retention:
      'deleted 30 days past expiry (sessions, links, handoff tokens) or once expired (challenges)',
  }),
]);

/** What each redaction category of the code means for the data in it. */
export const HANDLING_GROUPS: Readonly<Record<string, HandlingGroupProfile>> = Object.freeze({
  SUBJECT_PII_TABLES: {
    title: "The subject's data",
    description: "An inquiry's or account's redaction reaches every one of these tables.",
  },
  OPERATOR_PII_TABLES: {
    title: 'Operator and configuration data',
    description: "Sealed columns that hold operators' or configuration data, never a subject's.",
  },
  THIRD_PARTY_LIST_PII_TABLES: {
    title: 'Third-party list data',
    description:
      "Values an operator entered about people who need not be subjects (C107.5): no subject's redaction reaches them; they go by their list's `item-retention-days`.",
  },
  GRAPH_QUERY_PII_TABLES: {
    title: "The searcher's record",
    description:
      "A graph query's parameters, kept `graph-query-retention-days`; a subject's redaction scrubs the account from stored results, never the parameters.",
  },
  WORKFLOW_RUN_PII_TABLES: {
    title: 'Workflow run values',
    description:
      "Reached by a subject's redaction through `workflow_run_subjects`; the values go `workflow-run-retention-days` after a run ends.",
  },
  DECISION_PII_TABLES: {
    title: 'Decision records',
    description: 'A decision keeps its record through a redaction; only its comment is redacted.',
  },
  WORKFLOW_SECRET_TABLES: {
    title: 'Workflow secrets',
    description:
      "An operator's own credential, not personal data; no subject's redaction reaches it.",
  },
  CASE_PII_TABLES: {
    title: 'Cases',
    description:
      'A case redacts only itself; its attachments, rendition pages and exports go with it.',
  },
  SIMULATION_PRESET_TABLES: {
    title: 'Simulation presets',
    description:
      "A user's own preset, which names no subject; it goes with its user or when deleted.",
  },
  THEME_ASSET_TABLES: {
    title: 'Theme assets',
    description: "The operator's logos and fonts, envelope-encrypted like every stored object.",
  },
  EXPORT_PII_TABLES: {
    title: 'Exports',
    description:
      "A principal's own 24-hour export: no subject's redaction reaches it, so an export cut before a redaction keeps that person's data until it expires.",
  },
  THIRD_PARTY_REPORT_BULK_PII_TABLES: {
    title: 'Bulk report uploads',
    description:
      "A bulk report job's uploaded CSV, about people who need not be subjects; deleted when the job ends, or swept once the job is a day old.",
  },
  CONNECT_AGREEMENT_TABLES: {
    title: 'Connect agreements',
    description:
      "A connection's agreement reference, which holds no subject's data; connections are kept for audit.",
  },
  CONSENT_PII_TABLES: {
    title: 'Consent texts',
    description: 'The composed flow texts consent records cite; deleted when no record cites them.',
  },
  OPERATOR_AUTH_SECRET_TABLES: {
    title: 'Console sign-in secrets',
    description: "An SSO provider's client secret and a login state's nonce and PKCE verifier.",
  },
  ACCOUNT_EXPORT_TABLES: {
    title: 'Access exports',
    description:
      'Deleted before any redaction or retention deletion of an item it lists, and expired after `account-export-ttl-days`.',
  },
});

export interface ClassifiedColumn {
  readonly table: string;
  readonly column: string;
  readonly aad: string;
  readonly class: DataClass;
  readonly holds: string;
  /** The redaction category that holds its table, or `null` when none does. */
  readonly handlingGroup: string | null;
}

export interface ClassifiedFieldType {
  readonly type: string;
  readonly shareCategory: ShareCategory;
  readonly class: DataClass;
}

export interface ClassifiedKey {
  readonly key: string;
  readonly shareCategory: ShareCategory;
  readonly class: DataClass;
}

export interface RetentionDefault {
  readonly key: string;
  /** The default `DASHBOARD_SETTINGS_DEFAULTS` holds (`null`: unset, kept). */
  readonly default: unknown;
}

export interface ClassEntry {
  readonly id: DataClass;
  readonly profile: ClassProfile;
  readonly shareCategories: readonly ShareCategory[];
  readonly retentionDefaults: readonly RetentionDefault[];
  readonly columns: readonly ClassifiedColumn[];
  readonly plaintext: readonly PlaintextRecord[];
  readonly fieldTypes: readonly ClassifiedFieldType[];
}

export interface HandlingGroup {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly tables: readonly string[];
}

/** The classification's data: docs-compliance's record-of-processing generator reads this. */
export interface DataClassification {
  readonly classes: readonly ClassEntry[];
  readonly columns: readonly ClassifiedColumn[];
  readonly plaintext: readonly PlaintextRecord[];
  readonly fieldTypes: readonly ClassifiedFieldType[];
  readonly wellKnownKeys: readonly ClassifiedKey[];
  readonly handlingGroups: readonly HandlingGroup[];
}

const LIST_DECLARATION = /export const ([A-Z][A-Z0-9_]*_TABLES)\s*=\s*\[([\s\S]*?)\]\s*as const;/g;
const QUOTED = /'([a-z0-9_]+)'/g;

/** `body` with its `//` line comments removed. */
const withoutLineComments = (body: string): string =>
  body
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

/** The redaction categories `redaction.test-support.ts` declares, by name, in their order. */
export function readHandlingGroups(repo: Repository): ReadonlyMap<string, readonly string[]> {
  const text = repo.readText(REDACTION_CATEGORIES_PATH);
  const groups = new Map<string, readonly string[]>();
  for (const match of text.matchAll(LIST_DECLARATION)) {
    const [, name = '', body = ''] = match;
    groups.set(
      name,
      [...withoutLineComments(body).matchAll(QUOTED)].map((quoted) => quoted[1] ?? ''),
    );
  }
  return groups;
}

const TABLE_DECLARATION = /pgTable\(\s*'([a-z0-9_]+)'/g;

/** Every `pgTable('<name>'` the tables directory declares. */
export function readTableNames(repo: Repository): ReadonlySet<string> {
  const names = new Set<string>();
  for (const file of repo.listFiles(TABLES_DIRECTORY)) {
    if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
      for (const match of repo.readText(file).matchAll(TABLE_DECLARATION)) {
        names.add(match[1] ?? '');
      }
    }
  }
  return names;
}

const SETTINGS = DASHBOARD_SETTINGS_DEFAULTS as Readonly<Record<string, unknown>>;

/** The classification of the repository at hand. */
export function dataClassification(repo: Repository): DataClassification {
  const groups = readHandlingGroups(repo);
  const groupOf = (table: string): string | null =>
    [...groups.entries()].find(([, tables]) => tables.includes(table))?.[0] ?? null;

  const columns: ClassifiedColumn[] = ENCRYPTED_COLUMNS.map((entry) => {
    const name = `${entry.table}.${entry.column}`;
    const classified = COLUMN_CLASSES[name];
    if (classified === undefined) {
      throw new Error(`no class for the sealed column ${name} (COLUMN_CLASSES)`);
    }
    return Object.freeze({
      table: entry.table,
      column: entry.column,
      aad: entry.aad,
      class: classified.class,
      holds: classified.holds,
      handlingGroup: groupOf(entry.table),
    });
  }).sort((a, b) => compare(`${a.table}.${a.column}`, `${b.table}.${b.column}`));

  const fieldTypes: ClassifiedFieldType[] = SHARE_FIELD_TYPES.map((type: ShareFieldType) => {
    const shareCategory = FIELD_TYPE_CLASS[type];
    return Object.freeze({ type, shareCategory, class: SHARE_CATEGORY_DATA_CLASS[shareCategory] });
  });

  const wellKnownKeys: ClassifiedKey[] = Object.entries(WELL_KNOWN_FIELD_CATEGORY)
    .map(([key, shareCategory]) =>
      Object.freeze({ key, shareCategory, class: SHARE_CATEGORY_DATA_CLASS[shareCategory] }),
    )
    .sort((a, b) => compare(a.key, b.key));

  const classes: ClassEntry[] = DATA_CLASSES.map((id) => {
    const profile = CLASS_PROFILES[id];
    return Object.freeze({
      id,
      profile,
      shareCategories: SHARE_CATEGORIES.filter(
        (category) => SHARE_CATEGORY_DATA_CLASS[category] === id,
      ),
      retentionDefaults: profile.retentionSettings.map((key) =>
        Object.freeze({ key, default: SETTINGS[key] ?? null }),
      ),
      columns: columns.filter((entry) => entry.class === id),
      plaintext: PLAINTEXT_RECORDS.filter((record) => record.class === id),
      fieldTypes: fieldTypes.filter((entry) => entry.class === id),
    });
  });

  const handlingGroups: HandlingGroup[] = [...groups.entries()].map(([name, tables]) => {
    const profile = HANDLING_GROUPS[name];
    return Object.freeze({
      name,
      title: profile?.title ?? name,
      description: profile?.description ?? '',
      tables: [...tables].sort(compare),
    });
  });

  return Object.freeze({
    classes,
    columns,
    plaintext: PLAINTEXT_RECORDS,
    fieldTypes,
    wellKnownKeys,
    handlingGroups,
  });
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const BINDING: Readonly<Record<string, string>> = Object.freeze({
  static: 'per column',
  row: 'per row',
  file: 'object data key',
});

const code = (text: string): string => `\`${text}\``;
const cell = (text: string): string => text.replaceAll('|', '\\|');

/** A setting's default as the page states it. */
function defaultText(value: unknown): string {
  if (value === null || value === undefined) {
    return 'unset';
  }
  return typeof value === 'number' ? value.toLocaleString('en-US') : JSON.stringify(value);
}

function settingsText(entries: readonly RetentionDefault[]): string {
  return entries.length === 0
    ? 'no environment setting'
    : entries
        .map((entry) => `${code(entry.key)} (default ${defaultText(entry.default)})`)
        .join(', ');
}

function renderClass(entry: ClassEntry): string[] {
  const { profile } = entry;
  const lines = [
    `### ${code(entry.id)}: ${profile.title}`,
    '',
    profile.holds,
    '',
    `- **Encryption at rest:** ${profile.encryption}`,
    `- **Default retention:** ${settingsText(entry.retentionDefaults)}. ${profile.retention}`,
    `- **Logging rule:** ${profile.logging}`,
    `- **Permission:** ${profile.permission}`,
    `- **Access export (C253):** ${
      profile.exportSections.length === 0
        ? 'no section of its own.'
        : `${profile.exportSections.map(code).join(', ')}.`
    } ${profile.exportNote}`,
    `- **Share category (C230.4):** ${
      entry.shareCategories.length === 0
        ? 'none.'
        : `${entry.shareCategories.map(code).join(', ')}.`
    }${profile.shareNote === '' ? '' : ` ${profile.shareNote}`}`,
    '',
  ];
  if (entry.columns.length > 0) {
    lines.push(
      `Sealed columns (${String(entry.columns.length)}):`,
      '',
      '| Column | Binding | Redaction category | Holds |',
      '|---|---|---|---|',
      ...entry.columns.map(
        (c) =>
          `| ${code(`${c.table}.${c.column}`)} | ${BINDING[c.aad] ?? c.aad} | ${
            c.handlingGroup === null ? 'none' : code(c.handlingGroup)
          } | ${cell(c.holds)} |`,
      ),
      '',
    );
  }
  if (entry.plaintext.length > 0) {
    lines.push(
      'Kept in plaintext, or only as a digest or an HMAC, by decision:',
      '',
      '| Where | Holds | Why | Retention |',
      '|---|---|---|---|',
      ...entry.plaintext.map(
        (p) => `| ${cell(p.where)} | ${cell(p.holds)} | ${cell(p.reason)} | ${cell(p.retention)} |`,
      ),
      '',
    );
  }
  if (entry.fieldTypes.length > 0) {
    lines.push(
      `Field types: ${entry.fieldTypes.map((f) => code(f.type)).join(', ')} (see "Field types").`,
      '',
    );
  }
  return lines;
}

/** `docs/security/data-classification.md` as the generator renders it. */
export function renderDataClassification(repo: Repository): string {
  const data = dataClassification(repo);
  const lines: string[] = [
    '# Data classification',
    '',
    '<!-- Generated by `pnpm --filter @openverify/docs-tools docs:records`; do not edit by hand. -->',
    '',
    "Generated from the code (C276.2): the classes, the share categories and the class of each field type from `packages/core/src/connect/categories.ts`; every sealed column from `ENCRYPTED_COLUMNS` (`packages/db/src/encrypted-columns.ts`); the redaction categories from `apps/api/src/services/redaction.test-support.ts`; the retention defaults from `DASHBOARD_SETTINGS_DEFAULTS` (`packages/contracts/src/dashboard-api.ts`); and the access export's sections from `accountExportManifestSchema` (`packages/contracts/src/account-exports.ts`). The column classes and the class profiles are the table in `packages/docs-tools/src/records/classification.ts`, whose test fails when a sealed column, a field type, a setting, an export section or a redaction category has no place here, and when this page differs from a fresh render.",
    '',
    "It describes the code at its commit. It is the input of the record-of-processing template (`docs/compliance/record-of-processing.md`), not legal advice: which law applies to a class, and on what basis it may be processed, are questions for the operator's counsel.",
    '',
    '## Summary',
    '',
    '| Class | Sealed columns | Kept in plaintext by decision | Field types | Share categories |',
    '|---|---|---|---|---|',
    ...data.classes.map(
      (entry) =>
        `| ${code(entry.id)} | ${String(entry.columns.length)} | ${String(entry.plaintext.length)} | ${String(
          entry.fieldTypes.length,
        )} | ${entry.shareCategories.length === 0 ? 'none' : entry.shareCategories.map(code).join(', ')} |`,
    ),
    `| All | ${String(data.columns.length)} | ${String(data.plaintext.length)} | ${String(data.fieldTypes.length)} | ${String(SHARE_CATEGORIES.length)} |`,
    '',
    "A column has one class, its most sensitive content's, and one redaction category, its table's. The classes say what kind of data a column holds; the redaction categories say whose data it is and what reaches it. Third-party list data, for one, is the `public-and-list-data` class in the `THIRD_PARTY_LIST_PII_TABLES` category: no subject's redaction reaches it.",
    '',
    '## Classes',
    '',
    ...data.classes.flatMap(renderClass),
    '## Field types',
    '',
    'A field of a template, an account type or a transaction type is classed by its type through its share category (`FIELD_TYPE_CLASS`, then `SHARE_CATEGORY_DATA_CLASS`). A free-form type is classed as identity: it may hold a name, an address or a number, and the class that needs the more specific consent wins.',
    '',
    '| Field type | Share category | Class |',
    '|---|---|---|',
    ...data.fieldTypes.map(
      (f) => `| ${code(f.type)} | ${code(f.shareCategory)} | ${code(f.class)} |`,
    ),
    '',
    "A well-known key keeps its category whatever type a template declares it with (`WELL_KNOWN_FIELD_CATEGORY`); an inquiry's snake_case key is read in kebab-case:",
    '',
    '| Key | Share category | Class |',
    '|---|---|---|',
    ...data.wellKnownKeys.map(
      (k) => `| ${code(k.key)} | ${code(k.shareCategory)} | ${code(k.class)} |`,
    ),
    '',
    '## Redaction categories',
    '',
    'Each sealed table belongs to exactly one category of `apps/api/src/services/redaction.test-support.ts`, whose seeded scans hold that a redaction leaves none of its values.',
    '',
    '| Category | What it means | Tables |',
    '|---|---|---|',
    ...data.handlingGroups.map(
      (g) =>
        `| ${code(g.name)} (${cell(g.title)}) | ${cell(g.description)} | ${g.tables.map(code).join(', ')} |`,
    ),
    '',
    '## Limits of this page',
    '',
    "- The column classes, the profiles and the plaintext rows are written in the generator's table, by hand; the test holds that each names what exists (every sealed column, setting, export section, redaction category and table), not that each sentence is right. A review reads them at each phase end.",
    '- `DATA_CLASSES` has no class of its own for third-party list data; the redaction categories carry that distinction (`docs/tdd/phase11-docs-records.tdd.md`).',
    '- Backups keep redacted data until they expire, and nothing here reaches a copy outside the install (`docs/self-hosting/backups-and-restore.md`).',
    '',
  ];
  return lines.join('\n');
}
