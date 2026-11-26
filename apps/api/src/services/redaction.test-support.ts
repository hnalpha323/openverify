/**
 * Seeds one synthetic end user into every table that stores PII about them, for the C16
 * redaction tests (unit and Testcontainers). Every value is synthetic and carries a marker
 * string, so a test can assert that no copy of it survives redaction. Only tests import this.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  addAccountRelation,
  addTransactionObjects,
  addTransactionRelation,
  claimIdempotencyKey,
  completeIdempotencyKey,
  createAccount,
  createConsentRecord,
  consumeSelfieCapture,
  createApiLog,
  createEvent,
  createFaceTemplate,
  createSelfieBackground,
  createSelfieCapture,
  createFile,
  createGovernmentIdExtraction,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createVerification,
  encryptBytes,
  getEnvironment,
  hashSessionToken,
  markInquirySessionStarted,
  SEALED,
  sealJson,
  sealValue,
  recordInquirySessionConsent,
  replaceVerificationChecks,
  type Db,
  type Keyring,
} from '@openverify/db';
import { newId, newSessionToken } from '@openverify/contracts';
import {
  seedBusinessRegistryRecord,
  seedChipChallenge,
  seedChipRead,
  seedCryptoChallenge,
  seedDocumentExtraction,
  seedDevice,
  seedGraphAttribute,
  seedGraphQuery,
  seedGraphQueryTemplate,
  seedOtpChallenge,
  seedList,
  seedListItem,
  seedListItemBackground,
  seedListItemFace,
  seedListMatch,
  seedNetwork,
  seedSessionSignalBody,
  seedTransaction,
  seedTransactionFile,
  seedTransactionType,
  seedVerificationInputs,
} from '@openverify/db/testing';
import type { FileStorage } from '../ports.js';
import { seedConnection } from './connect/consent.test-support.js';

/** Appears in every PII value of the seeded subject. */
export const PII_MARKER = 'Zyxw-synthetic-pii';

/**
 * Tables holding PII about an end user (the encrypted columns of `ENCRYPTED_COLUMNS`, except
 * operator data) plus the check details. {@link seedPiiSubject} writes one row to each.
 */
export const SUBJECT_PII_TABLES = [
  'accounts',
  'api_logs',
  'business_registry_records',
  'chip_challenges',
  // KP11-14 (Workflow 11B, `dsar-export`; C241.3, C236.10): a consent record's sealed evidence and
  // attested text, about the subject's inquiry or account; the subject's redaction clears them
  // (`services/connect/redaction-hooks.ts`), the bare fact kept for `consent-proof-retention-days`.
  'consent_records',
  'chip_reads',
  'crypto_challenges',
  'document_extractions',
  'events',
  'face_templates',
  'files',
  'government_id_extractions',
  'idempotency_keys',
  'inquiries',
  // Workflow 10B Stage 1b (I) (C221.3): a device's integrity token sealed in its challenge, and the
  // inquiry's verdict; the inquiry's redaction deletes both.
  'inquiry_integrity_challenges',
  'inquiry_integrity_verdicts',
  // Workflow 7A (S) (C94.2, C91.4): a session's signal bodies, components and behaviour sealed.
  'inquiry_session_signals',
  'inquiry_sessions',
  // Workflow 7B (C98.4, C99.7): a face template and a background of the subject, on an item whose
  // source is the inquiry. `BiometricItemRedactor` removes them with the inquiry.
  'list_item_backgrounds',
  'list_item_faces',
  // Workflow 7B (C98.4, C99.3): a match's compared value and dismissal reason, sealed. The inquiry
  // redaction nulls them.
  'list_matches',
  // Workflow 7A (C91.3, C91.4): a session's network evaluation, its address and location sealed.
  // The inquiry and account redactions null them (`redactInquiryRecords`).
  'networks',
  'otp_challenges',
  // C73.5: the report tables. `api-reports` seeds a report of the subject and scans it after
  // redaction when it implements the report redaction hook (`services/reports/redaction.ts`).
  'report_actions',
  'report_matches',
  'reports',
  'selfie_backgrounds',
  'selfie_captures',
  // Owner decision 1 after Workflow 7B: a transaction linked to the subject goes with the subject,
  // its sealed fields and its file's name, whatever kind of link names it (K7B-1).
  'transaction_files',
  'transactions',
  'verification_checks',
  'verification_inputs',
] as const;

/** Tables with encrypted columns that hold operator or configuration data, never an end user's. */
export const OPERATOR_PII_TABLES = ['audit_logs', 'mfa_factors', 'webhooks'] as const;

/**
 * C107.5 (Workflow 7B): third-party list PII: values an operator entered about people who need not
 * be inquiry subjects, so no subject redaction reaches them. They go by `item-retention-days`, with
 * their list, or, for a staged row, when the import ends (C98.4, C100.2).
 */
export const THIRD_PARTY_LIST_PII_TABLES = ['importers', 'list_import_rows', 'list_items'] as const;

/**
 * C102.4, C102.7 (Workflow 7B): a graph query's bound parameters, the values a principal searched
 * the graph for. They go by `graph-query-retention-days` (default 30), which `redactGraphQueryRecords`'
 * tests scan. A subject's redaction removes the account from every stored result (C101.4) but the
 * parameters stay the searcher's record until their retention; `api-graph` builds that scrub.
 */
export const GRAPH_QUERY_PII_TABLES = ['graph_queries'] as const;

/**
 * C120.9 (Workflow 8A): a run's sealed values. A subject's redaction reaches them through
 * `workflow_run_subjects`, which `redactRunsForSubjectsInTx` (`workflows/runs/redaction.ts`) walks and
 * `api-engine`'s suite scans; before it lands no run exists to seed here.
 */
export const WORKFLOW_RUN_PII_TABLES = [
  'scheduled_runs',
  'workflow_run_files',
  'workflow_run_steps',
  'workflow_runs',
  'workflow_step_effects',
] as const;

/**
 * C128.1 (V25): a decision keeps its record through a redaction, and only its comment goes, through
 * `redactDecisionCommentsInTx`, whose coverage per subject type is `api-actions`' suite's.
 */
export const DECISION_PII_TABLES = ['inquiry_decisions'] as const;

/**
 * C125.1: sealed, and not personal data: a workflow secret is the operator's own credential, which
 * no subject's redaction reaches.
 */
export const WORKFLOW_SECRET_TABLES = ['workflow_secret_values'] as const;

/**
 * C139.1, C137.4 (Workflow 8B): a case redacts only itself, through `redactCasesInTx`
 * (`services/cases/redaction.ts`), whose coverage of these tables is `api-cases`' suite's; before it
 * lands no case exists to seed here. A bulk action's sealed request is its requester's, kept until
 * the job has done.
 *
 * Checkpoint (F) (C135, C138.1): an attachment goes with its case (`redactCaseAttachmentsInTx`), a
 * rendition page with its source (`deleteRenditionsForFilesInTx`, an attachment's redaction) and an
 * export's request and file with the export (sealed until it finished, the file gone after 24 hours);
 * their coverage is `api-case-files`' suite's, because until it lands none of them can exist.
 */
export const CASE_PII_TABLES = [
  'case_attachments',
  'case_bulk_actions',
  'case_comments',
  'case_exports',
  'cases',
  'rendition_pages',
] as const;

/**
 * C156.4, C174.5 (Workflow 9A Stage 1b (T)): a simulation preset's scope is sealed because an operator
 * may paste a real person's values into it (review P12), but it belongs to the user who saved it and
 * names no subject, so no subject's redaction reaches it; it goes with its user or when deleted.
 */
export const SIMULATION_PRESET_TABLES = ['simulation_presets'] as const;

/**
 * C160.6, C174.5 (Workflow 9A Stage 1b (H)): a theme asset (a logo or a font) is the operator's
 * configuration, envelope-encrypted like every stored object, and names no subject.
 */
export const THEME_ASSET_TABLES = ['theme_assets'] as const;

/**
 * C166.1, C174.5 (Workflow 9B Stage 1b (X)): an export is a principal's own 24-hour copy of a list,
 * its request (the filter's values) sealed until it finished and its file an envelope object deleted
 * by `export-sweep` and the C16 pass after 24 hours (`runExportRetention`). No subject's redaction
 * reaches it: an export cut before a redaction keeps that person's data until it expires, at most 24
 * hours, which the export page and the docs say (review P36). As 7B gave `graph_queries` its own list.
 */
export const EXPORT_PII_TABLES = ['exports'] as const;

/**
 * C166.5, C174.5 (Workflow 9B Stage 1b (X); review P24): a bulk report job's uploaded CSV holds
 * third-party personal data (the query sources of people who need not be inquiry subjects), so no
 * subject redaction reaches it; it is deleted when the job ends and swept by `export-sweep` for a job
 * that ended or is older than 24 hours. Beside 7B's `THIRD_PARTY_LIST_PII_TABLES`.
 */
export const THIRD_PARTY_REPORT_BULK_PII_TABLES = ['report_bulk_jobs'] as const;

/**
 * C241.5 (Workflow 11A Stage 1b (C)): a connection's sealed `agreement_reference` is the two
 * organisations' data-sharing agreement reference, which its help text asks never to hold personal
 * data; no subject's redaction reaches it, and connections are kept for audit (C231.7).
 */
export const CONNECT_AGREEMENT_TABLES = ['connect_connections'] as const;

/**
 * C241.3, C236.10 (Workflow 11A Stage 1b (K)): the flow texts consent records cite. A `consent_texts`
 * row holds the server's composed text, no subject value, and is deleted by the retention pass when
 * no record cites it. `consent_records` itself moved into `SUBJECT_PII_TABLES` with its seed
 * (KP11-14, Workflow 11B `dsar-export`), since its redaction with the data it covers landed
 * (`services/connect/redaction-hooks.ts`).
 */
export const CONSENT_PII_TABLES = ['consent_texts'] as const;

/**
 * C248.3, C248.4 (Workflow 11B Stage 1b (A); review P35, Stage 1a amendment 11): an operator's
 * secrets of console sign-in, not subject PII: an SSO provider's client secret, and a login
 * state's nonce and PKCE verifier (single use, deleted by the C16 pass a day after they expire).
 * No subject's redaction reaches them.
 */
export const OPERATOR_AUTH_SECRET_TABLES = ['sso_login_states', 'sso_providers'] as const;

/**
 * C253 (Workflow 11B Stage 1b (D)): an access export's row holds ids, counts and times, and the
 * wrapped data key of its sealed manifest (subject PII, in storage under the export's id). It is not
 * redacted in place: any redaction or retention deletion of an item it lists deletes the export and
 * its manifest first (C253.4, `account-export/hooks.ts`), and the C16 pass expires it after
 * `account-export-ttl-days`.
 */
export const ACCOUNT_EXPORT_TABLES = ['account_exports'] as const;

export interface SeededPiiSubject {
  accountId: string;
  inquiryId: string;
  sessionId: string;
  verificationId: string;
  fileIds: string[];
  storageKeys: string[];
  /** An account that absorbed the subject's account copy in an `account.consolidated` event. */
  otherAccountId: string;
  apiLogIds: string[];
  idempotencyKeyIds: number[];
  eventIds: string[];
  /** Workflow 5A (C53.2): a database verification's entered values, an OTP and a wallet challenge. */
  inputsVerificationId: string;
  otpChallengeId: string;
  cryptoChallengeId: string;
  /** Workflow 5B (C53.3): a document's extraction, a chip's challenge and read, a registry record. */
  documentVerificationId: string;
  chipVerificationId: string;
  chipChallengeId: string;
  businessVerificationId: string;
  /** Workflow 7A (S) (C91.2, C91.4): the device known only through the subject's session. */
  deviceId: string;
  /** Workflow 7B (C99.3): a list match of the subject's inquiry, with its dismissal reason. */
  listMatchId: string;
  /** C98.4, C99.7: the face and background items whose source is the inquiry. */
  listItemIds: string[];
  /** The background item's masked object; `files` does not hold it (C98.1). */
  maskedObjectKey: string;
  /**
   * Workflow 7B (C101.4, plan (G) item 15): a stored graph result naming the subject's account;
   * `graph_attributes` holds a row of the account's own and one of its inquiry's.
   */
  graphQueryId: string;
  /**
   * K7B-1 (owner decision 1 after Workflow 7B): transactions with a sealed field and a file, each
   * tied to the subject by one link: through `transaction_objects` to the account, the inquiry or
   * a verification, or through `transaction_relations` to the account.
   */
  transactions: Record<'account' | 'inquiry' | 'verification' | 'relation', SeededPiiTransaction>;
}

export interface SeededPiiTransaction {
  id: string;
  fileId: string;
  storageKey: string;
}

export interface SeedPiiOptions {
  db: Db;
  storage: FileStorage;
  keyring: Keyring;
  environmentId: string;
}

const pii = (label: string) => `${label} ${PII_MARKER}`;

/** KP11-14: two consent records of the subject, their evidence sealed and marked. */
async function seedConsentRecords(
  db: Db,
  environmentId: string,
  subject: { inquiryId: string; accountId: string; sessionId: string },
): Promise<void> {
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    throw new Error('seedPiiSubject: the environment is missing');
  }
  // One self-connection per organisation (a second subject of the tenant reuses it).
  const existing = (
    (await db.execute(sql`select id from connect_connections
      where source_organization_id = ${environment.organizationId}
        and destination_organization_id = ${environment.organizationId}`)) as {
      rows: { id: string }[];
    }
  ).rows[0];
  const connection =
    existing ??
    (await seedConnection(db, {
      sourceOrganizationId: environment.organizationId,
      destinationOrganizationId: environment.organizationId,
    }));
  const common = {
    side: 'source' as const,
    outcome: 'accepted' as const,
    purpose: 'share.reuse-kyc' as const,
    connectionId: connection.id,
    recipientOrganizationId: environment.organizationId,
    recipientName: 'Example Partner',
    dataCategories: ['identity-fields'],
    textLocale: 'en',
    textKeys: ['share.consent.source'],
    textSha256: 'c'.repeat(64),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  };
  await createConsentRecord(db, environmentId, {
    ...common,
    id: newId('cnsr'),
    subjectType: 'inquiry',
    subjectId: subject.inquiryId,
    method: 'flow',
    sessionId: subject.sessionId,
    acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
    evidenceIp: '203.0.113.7',
    evidenceUserAgent: pii('Mozilla/5.0'),
  });
  await createConsentRecord(db, environmentId, {
    ...common,
    id: newId('cnsr'),
    subjectType: 'account',
    subjectId: subject.accountId,
    method: 'attested',
    attestedAt: new Date('2026-10-01T00:00:00.000Z'),
    attestedByType: 'api-key',
    attestedById: newId('key'),
    attestedTextBody: pii('I agree to share my identity'),
    evidenceReference: pii('Signed form 42'),
  });
}

/** Writes the subject: an account with an inquiry, its session, checks, files and copies. */
export async function seedPiiSubject(options: SeedPiiOptions): Promise<SeededPiiSubject> {
  const { db, storage, keyring, environmentId } = options;
  const account = await createAccount(db, environmentId, {
    id: newId('acc'),
    referenceId: `ref-${newId('acc')}`,
    fields: { name_first: pii('Jane'), birthdate: '1990-01-31' },
  });
  const other = await createAccount(db, environmentId, { id: newId('acc') });
  await addAccountRelation(db, environmentId, {
    fromAccountId: account.id,
    toAccountId: other.id,
    relationType: 'spouse',
  });
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Synthetic template',
    version: { id: newId('itmplv'), flow: {}, verificationConfig: {} },
  });
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.currentVersion.id,
    accountId: account.id,
    fields: { name_first: pii('Jane'), email_address: pii('jane@example.test') },
    note: pii('Operator note'),
  });
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(newSessionToken()),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await markInquirySessionStarted(db, environmentId, session.id, {
    ip: '203.0.113.7',
    userAgent: pii('Mozilla/5.0'),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    locale: 'en',
    ip: '203.0.113.7',
    userAgent: pii('Mozilla/5.0'),
  });
  // Workflow 7A (S) (C94.2, C91.4): a signal body with collector components and behaviour, and a
  // device known only through this session.
  await seedSessionSignalBody(db, environmentId, {
    inquirySessionId: session.id,
    components: { integrity: { timezone: pii('Synthetic/Zone') } },
    behaviour: { 'paste-count': 1, note: pii('aggregate') },
  });
  const device = await seedDevice(db, environmentId, { sessionIds: [session.id] });
  // Workflow 10B Stage 1b (I) (C211.3, C211.4): a token taken for a challenge of this session, and the
  // inquiry's decoded verdict, each sealed for its row.
  const integrityChallengeId = newId('ich');
  await db.execute(
    sql`insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
          request_hash, token, expires_at, consumed_at)
        values (${integrityChallengeId}, ${environmentId}, ${inquiry.id}, ${session.id},
          ${'A'.repeat(43)},
          ${sealValue(SEALED.integrityChallengeToken, integrityChallengeId, pii('integrity token'), keyring)},
          now() + interval '10 minutes', now())`,
  );
  await db.execute(
    sql`insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict, decoded_at)
        values (${environmentId}, ${inquiry.id}, 'sandbox',
          ${sealJson(SEALED.integrityVerdict, inquiry.id, { note: pii('verdict') }, keyring)}, now())`,
  );
  // K7A-9 (C91.3, C91.4): the session's network, its address and location sealed.
  await seedNetwork(db, environmentId, {
    inquirySessionId: session.id,
    ip: '203.0.113.7',
    location: { regionCode: 'ZZ-01', regionName: pii('Region'), latitude: -30, longitude: -140 },
  });
  // Workflow 7B (C98.4, C99.3): the compared value and the dismissal reason are the subject's.
  const list = await seedList(db, environmentId, { kind: 'email-address' });
  const listItem = await seedListItem(db, environmentId, { listId: list.id, prefix: 'liea' });
  const listMatch = await seedListMatch(db, environmentId, {
    listId: list.id,
    listItemId: listItem.id,
    inquiryId: inquiry.id,
    matchedValue: pii('matched value'),
    dismissal: { reason: pii('dismissal reason'), at: new Date() },
  });
  const verification = await createVerification(db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await replaceVerificationChecks(db, environmentId, verification.id, [
    {
      name: 'id_blur_detection',
      status: 'failed',
      type: 'user_behavior',
      requirement: 'required',
      reasons: ['blurry_image'],
      metadata: { blur_score: 4.2, extracted_name: pii('Jane') },
    },
  ]);
  // C31.7: the extraction of the government ID, with its blind index and perceptual hash.
  await createGovernmentIdExtraction(db, environmentId, {
    verificationId: verification.id,
    fields: {
      'name-first': pii('Jane'),
      'name-middle': null,
      'name-last': pii('Synthetic'),
      birthdate: '1990-01-31',
      sex: 'F',
      nationality: 'UTO',
      'identification-number': 'X12K45P78',
      'personal-number': null,
      'issue-date': '2024-03-01',
      'expiration-date': '2034-02-28',
      'issuing-authority-code': 'UTO',
      'address-street-1': pii('12 Lantern Row'),
      'address-street-2': null,
      'address-city': 'North Haven',
      'address-subdivision': null,
      'address-postal-code': 'UT 1024',
      'address-country-code': null,
      endorsements: null,
      restrictions: null,
      'vehicle-class': null,
    },
    fieldSources: { 'name-first': ['mrz', 'viz'], birthdate: ['mrz', 'viz'] },
    identificationNumberIndex: createHash('sha256').update(pii('number')).digest('hex'),
    frontPhash: '0123456789abcdef',
  });
  // C40.5, C42: a selfie capture with a sealed device, a face template and a background row.
  const selfie = await createVerification(db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  const capture = await createSelfieCapture(db, environmentId, {
    id: newId('self'),
    verificationId: selfie.id,
    inquiryId: inquiry.id,
    method: 'camera',
    liveness: 'active',
    prompts: ['center', 'left', 'right'],
    nonceSha256: createHash('sha256').update(pii('nonce')).digest(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 180_000),
  });
  await consumeSelfieCapture(db, environmentId, {
    id: capture.id,
    verificationId: selfie.id,
    now: new Date(),
    device: { label: pii('Camera of Jane') },
  });
  const faceTemplate = await createFaceTemplate(db, environmentId, {
    id: newId('ver').replace(/^ver_/, 'ftpl_'),
    verificationId: selfie.id,
    inquiryId: inquiry.id,
    model: 'sface-2021dec',
    embedding: Array.from({ length: 128 }, () => 0.088),
  });
  await createSelfieBackground(db, environmentId, {
    id: newId('ver').replace(/^ver_/, 'sbg_'),
    verificationId: selfie.id,
    inquiryId: inquiry.id,
    faceTemplateId: faceTemplate.id,
    layout: Array.from({ length: 144 }, (_, index) => index / 3),
    validCells: '1'.repeat(48),
    coverage: 1,
  });
  // Workflow 5A (C53.2, C53.6): entered values, an OTP destination and a wallet's evidence.
  const entered = await createVerification(db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'database',
  });
  await seedVerificationInputs(db, environmentId, {
    verificationId: entered.id,
    inquiryId: inquiry.id,
    values: { 'name-first': pii('Jane'), 'address-street-1': pii('12 Lantern Row') },
  });
  const email = await createVerification(db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'email_address',
  });
  const otpChallengeId = await seedOtpChallenge(db, environmentId, {
    verificationId: email.id,
    inquiryId: inquiry.id,
    channel: 'email',
    destination: `jane.${PII_MARKER.toLowerCase()}@example.test`,
    destinationIndex: createHash('sha256').update(pii('email')).digest('hex'),
  });
  const wallet = await createVerification(db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'crypto_wallet',
  });
  const cryptoChallengeId = await seedCryptoChallenge(db, environmentId, {
    verificationId: wallet.id,
    inquiryId: inquiry.id,
    chainId: 'eip155:1',
    walletAddress: pii('0xwallet'),
    addressIndex: createHash('sha256').update(pii('wallet')).digest('hex'),
    message: pii('Sign in as Jane'),
    status: 'submitted',
    signature: pii('signature'),
    signedMessage: pii('Sign in as Jane'),
  });
  // Workflow 5B (C53.3, C53.6): a document's values, a chip's evidence and a registry record.
  const ofType = async (type: 'document' | 'government_id_nfc' | 'database_business') =>
    (await createVerification(db, environmentId, { id: newId('ver'), inquiryId: inquiry.id, type }))
      .id;
  const documentVerificationId = await ofType('document');
  await seedDocumentExtraction(db, environmentId, {
    verificationId: documentVerificationId,
    inquiryId: inquiry.id,
    fields: { name: pii('Jane'), 'address-street-1': pii('12 Lantern Row') },
  });
  const chipVerificationId = await ofType('government_id_nfc');
  const chipChallengeId = await seedChipChallenge(db, environmentId, {
    verificationId: chipVerificationId,
    inquiryId: inquiry.id,
    status: 'submitted',
    aaResponse: pii('aa response'),
    deviceReport: JSON.stringify({ note: pii('device') }),
  });
  await seedChipRead(db, environmentId, {
    verificationId: chipVerificationId,
    inquiryId: inquiry.id,
    fields: { 'name-last': pii('Jane'), 'identification-number': pii('X1') },
    sodSignature: new TextEncoder().encode(pii('sod signature')),
    sodSignatureIndex: createHash('sha256').update(pii('sod')).digest('hex'),
  });
  const businessVerificationId = await ofType('database_business');
  await seedBusinessRegistryRecord(db, environmentId, {
    verificationId: businessVerificationId,
    inquiryId: inquiry.id,
    record: { recordId: 'SANDBOX0001', legalName: pii('Jane Trading') },
  });
  const fileIds: string[] = [];
  const storageKeys: string[] = [];
  for (const kind of ['front', 'back'] as const) {
    const id = newId('file');
    const plaintext = new TextEncoder().encode(pii(`image ${kind}`));
    const sealed = encryptBytes(plaintext, keyring, { context: id });
    const storageKey = `${environmentId}/${id}`;
    await storage.put(storageKey, sealed.ciphertext);
    await createFile(db, environmentId, {
      id,
      verificationId: verification.id,
      kind,
      storageKey,
      mimeType: 'image/jpeg',
      byteSize: plaintext.byteLength,
      sha256: createHash('sha256').update(plaintext).digest('hex'),
      wrappedDek: sealed.wrappedDek,
    });
    fileIds.push(id);
    storageKeys.push(storageKey);
  }
  const faceList = await seedList(db, environmentId, { kind: 'face' });
  const faceItem = await seedListItem(db, environmentId, {
    listId: faceList.id,
    prefix: 'lifc',
    value: null,
    matchKey: null,
  });
  await seedListItemFace(db, environmentId, {
    itemId: faceItem.id,
    sourceInquiryId: inquiry.id,
    template: pii('face template'),
  });
  const backgroundList = await seedList(db, environmentId, { kind: 'selfie-background' });
  const backgroundItem = await seedListItem(db, environmentId, {
    listId: backgroundList.id,
    prefix: 'lisb',
    value: null,
    matchKey: null,
  });
  const maskedImage = new TextEncoder().encode(pii('masked image'));
  const maskedFile = encryptBytes(maskedImage, keyring, { context: backgroundItem.id });
  const maskedKey = `${environmentId}/${backgroundItem.id}`;
  await storage.put(maskedKey, maskedFile.ciphertext);
  await seedListItemBackground(db, environmentId, {
    itemId: backgroundItem.id,
    sourceInquiryId: inquiry.id,
    maskedFile: { key: maskedKey, wrappedDek: maskedFile.wrappedDek },
  });
  // K7B-1: one transaction per kind of link, with a sealed field and a file holding the marker.
  const transactionType = await seedTransactionType(db, environmentId);
  const seedLinkedTransaction = async (
    link: (transactionId: string) => Promise<unknown>,
  ): Promise<SeededPiiTransaction> => {
    const transaction = await seedTransaction(db, environmentId, {
      transactionTypeId: transactionType.id,
      transactionTypeVersionId: transactionType.versionId,
      fields: { note: { type: 'string', value: pii('Transaction note') } },
    });
    const fileId = newId('txnf');
    const sealed = encryptBytes(new TextEncoder().encode(pii('statement')), keyring, {
      context: fileId,
    });
    const file = await seedTransactionFile(db, environmentId, {
      id: fileId,
      transactionId: transaction.id,
      filename: pii('statement.pdf'),
      storageKey: `${environmentId}/${fileId}`,
      wrappedDek: sealed.wrappedDek,
    });
    await storage.put(file.storageKey, sealed.ciphertext);
    await link(transaction.id);
    return { id: transaction.id, fileId, storageKey: file.storageKey };
  };
  const transactions = {
    account: await seedLinkedTransaction((id) =>
      addTransactionObjects(db, environmentId, id, [account.id]),
    ),
    inquiry: await seedLinkedTransaction((id) =>
      addTransactionObjects(db, environmentId, id, [inquiry.id]),
    ),
    verification: await seedLinkedTransaction((id) =>
      addTransactionObjects(db, environmentId, id, [verification.id]),
    ),
    relation: await seedLinkedTransaction((id) =>
      addTransactionRelation(db, environmentId, {
        transactionId: id,
        relationSchemaKey: 'beneficiary',
        targetId: account.id,
      }),
    ),
  };
  const accountData = (id: string, fields: Record<string, unknown>) => ({
    type: 'account',
    id,
    attributes: { fields },
  });
  const eventIds: string[] = [];
  for (const [name, payload] of [
    [
      'inquiry.created',
      { data: { type: 'inquiry', id: inquiry.id, attributes: { fields: { n: pii('Jane') } } } },
    ],
    [
      'verification.failed',
      {
        data: {
          type: 'verification/government-id',
          id: verification.id,
          // C31.6: a verification payload carries the extraction attributes (Phase 3 worker).
          attributes: {
            checks: [{ metadata: { extracted_name: pii('Jane') } }],
            'name-first': pii('Jane'),
            'address-street-1': pii('12 Lantern Row'),
            'extraction-sources': { 'name-first': ['mrz', 'viz'] },
          },
        },
      },
    ],
    [
      'inquiry-session.started',
      {
        data: {
          type: 'inquiry-session',
          id: session.id,
          attributes: { 'user-agent': pii('Mozilla/5.0') },
        },
      },
    ],
    ['account.created', { data: accountData(account.id, { name_first: pii('Jane') }) }],
    [
      'selfie.created',
      {
        data: {
          type: 'selfie',
          id: capture.id,
          attributes: {
            status: 'initiated',
            'capture-method': 'camera',
            liveness: 'active',
            prompts: ['center', 'left', 'right'],
            'prompt-timings': [],
            'created-at': new Date().toISOString(),
            'expires-at': new Date().toISOString(),
            'submitted-at': null,
            'processed-at': null,
            'error-code': null,
          },
          relationships: {
            verification: { data: { type: 'verification/selfie', id: selfie.id } },
            inquiry: { data: { type: 'inquiry', id: inquiry.id } },
          },
        },
      },
    ],
    [
      'account.consolidated',
      {
        data: accountData(other.id, {}),
        included: [accountData(account.id, { name_first: pii('Jane') })],
        meta: { 'source-account-ids': [account.id] },
      },
    ],
  ] as const) {
    const event = await createEvent(db, environmentId, {
      id: newId('evt'),
      name,
      payload,
    });
    eventIds.push(event.id);
  }
  const apiLogIds: string[] = [];
  // Copies whose resource id is not the subject's: a list answer (no id) and an event read
  // (the event's id) that embed the subject (Workflow 2B F005, F017).
  const embedded = (type: string, id: string) => ({
    type,
    id,
    attributes: { fields: { name_first: pii('Jane') } },
  });
  for (const [path, resourceId, responseBody] of [
    ['/api/v1/inquiries', null, { data: [embedded('inquiry', inquiry.id)] }],
    ['/api/v1/accounts', null, { data: [embedded('account', account.id)] }],
    [
      `/api/v1/events/${eventIds[0] ?? ''}`,
      eventIds[0] ?? null,
      {
        data: { type: 'event', attributes: { payload: { data: embedded('inquiry', inquiry.id) } } },
      },
    ],
  ] as const) {
    const log = await createApiLog(db, environmentId, {
      id: newId('alog'),
      method: 'GET',
      path,
      status: 200,
      durationMs: 2,
      resourceId,
      responseBody,
    });
    apiLogIds.push(log.id);
  }
  for (const resourceId of [inquiry.id, account.id, capture.id]) {
    const log = await createApiLog(db, environmentId, {
      id: newId('alog'),
      method: 'POST',
      path: `/api/v1/resources/${resourceId}`,
      status: 200,
      durationMs: 3,
      resourceId,
      query: { search: pii('query') },
      requestBody: { fields: { name_first: pii('Jane') } },
      responseBody: { data: { attributes: { fields: { name_first: pii('Jane') } } } },
    });
    apiLogIds.push(log.id);
  }
  const idempotencyKeyIds: number[] = [];
  for (const resourceId of [inquiry.id, account.id, capture.id]) {
    const claim = await claimIdempotencyKey(db, environmentId, {
      principalType: 'api_key',
      principalId: newId('key'),
      key: `key-${resourceId}`,
      fingerprint: createHash('sha256').update(resourceId).digest('hex'),
    });
    if (claim.outcome !== 'claimed') {
      throw new Error('seedPiiSubject: the idempotency key was not claimed');
    }
    await completeIdempotencyKey(db, environmentId, claim.id, {
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { attributes: { fields: { name_first: pii('Jane') } } } }),
      resourceId,
    });
    idempotencyKeyIds.push(claim.id);
  }
  // A consolidation answer about the other account that embeds the subject's account.
  const consolidation = await claimIdempotencyKey(db, environmentId, {
    principalType: 'api_key',
    principalId: newId('key'),
    key: `consolidate-${other.id}`,
    fingerprint: createHash('sha256').update(other.id).digest('hex'),
  });
  if (consolidation.outcome !== 'claimed') {
    throw new Error('seedPiiSubject: the idempotency key was not claimed');
  }
  await completeIdempotencyKey(db, environmentId, consolidation.id, {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data: accountData(other.id, {}),
      included: [embedded('account', account.id)],
    }),
    resourceId: other.id,
  });
  idempotencyKeyIds.push(consolidation.id);
  // Workflow 7B (C101.4): the subject's graph rows and a stored result naming the account.
  await seedGraphAttribute(db, environmentId, { accountId: account.id, kind: 8 });
  await seedGraphAttribute(db, environmentId, {
    accountId: account.id,
    kind: 4,
    source: { type: 'inquiry', id: inquiry.id },
  });
  // KP11-14 (C236.4, C236.5): a source-side consent record witnessed in the subject's session, and
  // one attested about its account, each with sealed evidence; a self-connection of the subject's
  // organisation is enough for the records' foreign keys.
  await seedConsentRecords(db, environmentId, {
    inquiryId: inquiry.id,
    accountId: account.id,
    sessionId: session.id,
  });
  const graphTemplate = await seedGraphQueryTemplate(db, environmentId);
  const graphQuery = await seedGraphQuery(db, environmentId, {
    graphQueryTemplateId: graphTemplate.id,
    graphQueryTemplateVersionId: graphTemplate.versionId,
    accountIds: [account.id, other.id],
  });
  return {
    accountId: account.id,
    inquiryId: inquiry.id,
    sessionId: session.id,
    verificationId: verification.id,
    fileIds,
    storageKeys,
    otherAccountId: other.id,
    apiLogIds,
    idempotencyKeyIds,
    eventIds,
    inputsVerificationId: entered.id,
    otpChallengeId,
    cryptoChallengeId,
    documentVerificationId,
    chipVerificationId,
    chipChallengeId,
    businessVerificationId,
    deviceId: device.id,
    listMatchId: listMatch.id,
    listItemIds: [faceItem.id, backgroundItem.id],
    maskedObjectKey: maskedKey,
    graphQueryId: graphQuery.id,
    transactions,
  };
}
