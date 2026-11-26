/**
 * C16 KEK rotation: every encrypted column is rewrapped under the current KEK, in batches
 * that resume from an id cursor, without touching updated_at or the payloads.
 */
import { createHash, randomBytes } from 'node:crypto';
import { emptyExtractedFields } from '@openverify/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createKeyring,
  decryptBytes,
  encryptBytes,
  setDefaultKeyring,
  type Keyring,
} from '../crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { sealJson, sealValue } from '../sealed.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedBusinessRegistryRecord,
  seedChipChallenge,
  seedChipRead,
  seedCryptoChallenge,
  seedDocumentExtraction,
  seedImporter,
  seedList,
  seedListImportRow,
  seedGraphQuery,
  seedGraphQueryTemplate,
  seedInquiryDecision,
  seedScheduledRun,
  seedTransaction,
  seedTransactionFile,
  seedTransactionType,
  seedWorkflowEffect,
  seedWorkflowRun,
  seedWorkflowRunFile,
  seedWorkflowRunStep,
  seedWorkflowSecret,
  seedWorkflowSecretValue,
  seedCase,
  seedCaseAttachment,
  seedCaseBulkAction,
  seedCaseComment,
  seedCaseExport,
  seedRenditionPage,
  seedCaseTemplate,
  seedListItem,
  seedListItemBackground,
  seedListItemFace,
  seedListMatch,
  seedNetwork,
  seedSessionSignalBody,
  seedOtpChallenge,
  seedReport,
  seedReportAction,
  seedReportMatch,
  seedReportRun,
  seedReportTemplate,
  seedVerificationInputs,
  testId,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  appendAuditLog,
  claimIdempotencyKey,
  completeIdempotencyKey,
  createAccount,
  createApiLog,
  createEvent,
  createFile,
  consumeSelfieCapture,
  createFaceTemplate,
  createGovernmentIdExtraction,
  createSelfieCapture,
  createInquirySession,
  createTotpFactor,
  createUser,
  createVerification,
  createWebhook,
  getAccount,
  getApiLog,
  getFile,
  getGovernmentIdExtraction,
  getInquiry,
  getInquirySession,
  getTotpSecret,
  getVerificationInputs,
  getWebhookDispatchConfig,
  listAuditLogs,
  markInquirySessionStarted,
  openBusinessRegistryRecord,
  openChipChallengeEvidence,
  openChipReadEvidence,
  openCryptoChallengeEvidence,
  openDocumentExtractionFields,
  openOtpChallengeDestination,
  recordInquirySessionConsent,
  REWRAP_TABLES,
  rewrapAll,
  rewrapTableBatch,
  rotateWebhookSecret,
  updateInquiry,
} from './index.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const oldKeyring = createKeyring(oldKek);
const rotating = createKeyring(newKek, [oldKek]);
const newOnly = createKeyring(newKek);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: oldKeyring });
});

afterAll(async () => {
  await database.close();
});

/** The key id of every ciphertext stored in the encrypted columns, by `table.column`. */
async function storedKeyIds(): Promise<Map<string, Set<string>>> {
  const ids = new Map<string, Set<string>>();
  for (const { table, column } of ENCRYPTED_COLUMNS) {
    const rows = await database.client.query<{ value: string | null }>(
      `select "${column}"::text as value from "${table}" where "${column}" is not null`,
    );
    const found = new Set<string>();
    for (const { value } of rows.rows) {
      for (const match of (value ?? '').matchAll(/ov1\.([A-Za-z0-9_-]{11})\./g)) {
        found.add(match[1] ?? '');
      }
    }
    ids.set(`${table}.${column}`, found);
  }
  return ids;
}

async function seedEverything(keyring: Keyring) {
  const { organization, environment } = await createTestTenant(database.db);
  const env = environment.id;
  const { inquiry } = await createTestInquiry(database.db, env, {
    fields: { 'name-first': 'Jane' },
  });
  await updateInquiry(database.db, env, inquiry.id, { note: 'synthetic note' });
  // Workflow 9A Stage 1b (S) (C149.4): the initial fields, sealed for the row.
  await database.db.execute(
    sql`update inquiries set initial_fields = ${sealJson(SEALED.inquiryInitialFields, inquiry.id, {
      'name-first': 'Jane',
    })} where id = ${inquiry.id}`,
  );
  const session = await createInquirySession(database.db, env, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await markInquirySessionStarted(database.db, env, session.id, {
    ip: '203.0.113.1',
    userAgent: 'UA/1',
  });
  // Workflow 7A (C91.1, C91.3): the session's IP location and its network row, both sealed.
  await seedNetwork(database.db, env, {
    inquirySessionId: session.id,
    ip: '203.0.113.1',
    location: { regionCode: 'ZZ-1', regionName: 'Synthetic', latitude: 0.5, longitude: -30.5 },
    asn: 64_502,
    countryCode: 'ZZ',
  });
  // Workflow 7A (S) (C94.2): a signal body's components and behaviour, both sealed.
  await seedSessionSignalBody(database.db, env, { inquirySessionId: session.id });
  // Workflow 10B Stage 1b (I) (C211.3, C211.4): a challenge's token and the inquiry's verdict, each
  // sealed for its row.
  const integrityChallengeId = testId('ich');
  await database.db.execute(
    sql`insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
          request_hash, token, expires_at, consumed_at)
        values (${integrityChallengeId}, ${env}, ${inquiry.id}, ${session.id}, ${'A'.repeat(43)},
          ${sealValue(SEALED.integrityChallengeToken, integrityChallengeId, 'synthetic-integrity-token', keyring)},
          now() + interval '10 minutes', now())`,
  );
  await database.db.execute(
    sql`insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict, decoded_at)
        values (${env}, ${inquiry.id}, 'sandbox',
          ${sealJson(SEALED.integrityVerdict, inquiry.id, { 'device-recognition': [] }, keyring)}, now())`,
  );
  // Workflow 11A Stage 1b (C) (C230.5, C231.3): a self-connection's agreement reference, sealed for its row.
  const connectionId = testId('cxn');
  await database.db.execute(
    sql`insert into connect_connections (id, source_organization_id, destination_organization_id,
          status, creator_type, creator_id, agreement_reference)
        values (${connectionId}, ${organization.id}, ${organization.id}, 'pending', 'api-key', ${testId('key')},
          ${sealValue(SEALED.connectAgreementReference, connectionId, 'Example agreement (synthetic)', keyring)})`,
  );
  // Workflow 11A Stage 1b (K) (C230.5, C236): a consent record's evidence and attested text, and a
  // flow text, each sealed for its row.
  const consentRecordId = testId('cnsr');
  const textSha256 = 'b'.repeat(64);
  await database.db.execute(
    sql`insert into consent_records (environment_id, id, side, outcome, purpose, subject_type,
          subject_id, connection_id, recipient_organization_id, recipient_name, data_categories,
          text_sha256, method, attested_at, attested_by_type, attested_by_id, expires_at,
          attested_text_body, evidence_ip, evidence_user_agent, evidence_reference)
        values (${env}, ${consentRecordId}, 'source', 'accepted', 'share.reuse-kyc', 'inquiry',
          ${inquiry.id}, ${connectionId}, ${organization.id}, 'Example Partner', '{identity-fields}',
          ${textSha256}, 'attested', now(), 'api-key', ${testId('key')}, now() + interval '1 day',
          ${sealValue(SEALED.consentAttestedTextBody, consentRecordId, 'Example text (synthetic)', keyring)},
          ${sealValue(SEALED.consentEvidenceIp, consentRecordId, '203.0.113.1', keyring)},
          ${sealValue(SEALED.consentEvidenceUserAgent, consentRecordId, 'UA/1', keyring)},
          ${sealValue(SEALED.consentEvidenceReference, consentRecordId, 'Example reference', keyring)})`,
  );
  await database.db.execute(
    sql`insert into consent_texts (environment_id, sha256, locale, body)
        values (${env}, ${textSha256}, 'en',
          ${sealValue(SEALED.consentTextBody, `${env}:${textSha256}`, 'Example text (synthetic)', keyring)})`,
  );
  // Workflow 11B Stage 1b (A) (C248.3, C248.4): a provider's client secret, and a login state's nonce
  // and PKCE verifier, each sealed for its row (the state's row is its binding digest).
  const ssoProviderId = testId('ssop');
  await database.db.execute(
    sql`insert into sso_providers (id, organization_id, display_name, issuer, client_id,
          client_secret, allowed_email_domains)
        values (${ssoProviderId}, ${organization.id}, 'Example IdP', 'https://idp.example.com',
          'synthetic-client-id',
          ${sealValue(SEALED.ssoProviderClientSecret, ssoProviderId, 'synthetic-client-secret', keyring)},
          '{example.com}')`,
  );
  const bindingSha256 = 'c'.repeat(64);
  await database.db.execute(
    sql`insert into sso_login_states (binding_sha256, organization_id, provider_id, purpose,
          state_sha256, nonce, code_verifier, expires_at)
        values (${bindingSha256}, ${organization.id}, ${ssoProviderId}, 'sign-in', ${'d'.repeat(64)},
          ${sealValue(SEALED.ssoLoginStateNonce, bindingSha256, 'synthetic-nonce', keyring)},
          ${sealValue(SEALED.ssoLoginStateCodeVerifier, bindingSha256, 'synthetic-verifier', keyring)},
          now() + interval '10 minutes')`,
  );
  // Workflow 7B (L) (C98.3, C100.2, P18): an item as entered, a face template, a masked background
  // object, a match's value and reason, an importer's object and a staged row.
  const strings = await seedList(database.db, env);
  const item = await seedListItem(database.db, env, { listId: strings.id });
  await seedListMatch(database.db, env, {
    listId: strings.id,
    listItemId: item.id,
    inquiryId: inquiry.id,
    dismissal: { reason: 'Synthetic reason', at: new Date() },
  });
  const faces = await seedList(database.db, env, { kind: 'face' });
  const face = await seedListItem(database.db, env, {
    listId: faces.id,
    prefix: 'lifc',
    value: null,
    matchKey: null,
  });
  await seedListItemFace(database.db, env, {
    itemId: face.id,
    sourceInquiryId: inquiry.id,
    template: 'synthetic-template',
  });
  const backgrounds = await seedList(database.db, env, { kind: 'selfie-background' });
  const background = await seedListItem(database.db, env, {
    listId: backgrounds.id,
    prefix: 'lisb',
    value: null,
    matchKey: null,
  });
  await seedListItemBackground(database.db, env, {
    itemId: background.id,
    sourceInquiryId: inquiry.id,
    maskedFile: {
      key: 'list-backgrounds/synthetic',
      wrappedDek: encryptBytes(randomBytes(16), keyring, { context: background.id }).wrappedDek,
    },
  });
  const importer = await seedImporter(database.db, env, {
    listId: strings.id,
    wrappedDek: encryptBytes(randomBytes(16), keyring, { context: 'mprt' }).wrappedDek,
  });
  await seedListImportRow(database.db, env, {
    importerId: importer.id,
    row: 1,
    value: { value: 'synthetic' },
  });
  // Workflow 7B (T) (C105.1, C105.4): a transaction's fields, a file's name and its object.
  const transactionType = await seedTransactionType(database.db, env);
  const transaction = await seedTransaction(database.db, env, {
    transactionTypeId: transactionType.id,
    transactionTypeVersionId: transactionType.versionId,
  });
  await seedTransactionFile(database.db, env, {
    transactionId: transaction.id,
    wrappedDek: encryptBytes(randomBytes(16), keyring, { context: 'txnf' }).wrappedDek,
  });
  // Workflow 7B (G) (C102.4): a graph query's bound parameters.
  const graphTemplate = await seedGraphQueryTemplate(database.db, env);
  await seedGraphQuery(database.db, env, {
    graphQueryTemplateId: graphTemplate.id,
    graphQueryTemplateVersionId: graphTemplate.versionId,
  });
  // Workflow 8A (E) (C117.2, C118.2, C118.3): a run's values, a step's, an effect's result, a trigger
  // file and a scheduled run's inputs.
  const run = await seedWorkflowRun(database.db, env, {
    triggerSnapshot: { canary: 'snapshot' },
    inputs: { canary: 'inputs' },
    variables: { canary: 'variables' },
    outputs: { canary: 'outputs' },
  });
  const step = await seedWorkflowRunStep(database.db, env, {
    runId: run.id,
    input: { canary: 'input' },
    output: { canary: 'output' },
    console: ['synthetic line'],
  });
  await seedWorkflowEffect(database.db, env, {
    runId: run.id,
    stepId: step.id,
    result: { canary: 'result' },
  });
  await seedWorkflowRunFile(database.db, env, { runId: run.id });
  await seedScheduledRun(database.db, env, {
    targetWorkflowId: run.workflowId,
    inputs: { canary: 'scheduled' },
  });
  await seedInquiryDecision(database.db, env, { comment: 'synthetic comment' });
  // Workflow 8A (X) (C125.1): a secret's value and its previous value.
  const secret = await seedWorkflowSecret(database.db, organization.id);
  await seedWorkflowSecretValue(database.db, {
    organizationId: organization.id,
    environmentId: env,
    secretId: secret.id,
    value: 'canary-secret-current',
    previousValue: 'canary-secret-previous',
  });
  // Workflow 8B (C) (C136.4, C134.1, C137.4): a case's fields, a comment and a bulk action's request.
  const caseTemplate = await seedCaseTemplate(database.db, env);
  const seededCase = await seedCase(database.db, env, {
    caseTemplateId: caseTemplate.id,
    caseTemplateVersionId: caseTemplate.versionId,
    key: caseTemplate.key,
    number: 1,
    fields: { canary: { type: 'string', value: 'synthetic' } },
  });
  await seedCaseComment(database.db, env, { caseId: seededCase.id });
  await seedCaseBulkAction(database.db, env);
  // Workflow 8B (F) (C135.2, C135.3, C138.1): an attachment's name and object, a rendition page's
  // object, and an export's request and file.
  const attachment = await seedCaseAttachment(database.db, env, {
    caseId: seededCase.id,
    wrappedDek: encryptBytes(randomBytes(16), keyring, { context: 'catt' }).wrappedDek,
  });
  await seedRenditionPage(database.db, env, {
    sourceId: attachment.id,
    wrappedDek: encryptBytes(randomBytes(16), keyring, { context: 'page' }).wrappedDek,
  });
  await seedCaseExport(database.db, env, { request: { filter: { status: ['open'] } } });
  const finished = await seedCaseExport(database.db, env);
  await database.db.execute(sql`
    update case_exports set status = 'completed', request = null, case_count = 1, byte_size = 16,
      storage_key = ${`exports/${finished.id}`},
      wrapped_dek = ${encryptBytes(randomBytes(16), keyring, { context: 'cexp' }).wrappedDek},
      completed_at = now(), expires_at = now() + interval '24 hours'
    where id = ${finished.id}`);
  await recordInquirySessionConsent(database.db, env, session.id, {
    acceptedAt: new Date(),
    textKeys: [],
    locale: 'en',
    ip: '203.0.113.1',
    userAgent: 'UA/1',
  });
  await createEvent(database.db, env, {
    id: testId('evt'),
    name: 'inquiry.created',
    payload: { data: { id: inquiry.id } },
  });
  const webhook = await createWebhook(database.db, env, {
    id: testId('wbh'),
    url: 'https://hooks.example.test/k',
    enabledEvents: ['*'],
    secret: 'wbhsec_synthetic_kek_one_abcd',
    customHeaders: { 'X-A': 'one' },
  });
  await rotateWebhookSecret(database.db, env, webhook.id, {
    secret: 'wbhsec_synthetic_kek_two_wxyz',
    previousSecretExpiresAt: new Date(Date.now() + 3_600_000),
  });
  const audit = await appendAuditLog(database.db, env, {
    actorType: 'user',
    action: 'file.viewed',
    ip: '198.51.100.3',
    userAgent: 'UA/2',
  });
  const verification = await createVerification(database.db, env, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  const fileId = testId('file');
  const bytes = randomBytes(32);
  const sealed = encryptBytes(bytes, keyring, { context: fileId });
  await createFile(database.db, env, {
    id: fileId,
    verificationId: verification.id,
    kind: 'selfie-center',
    storageKey: `${env}/${fileId}`,
    mimeType: 'image/png',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  // C31.7: the extraction, sealed to its verification row.
  const governmentId = await createVerification(database.db, env, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await createGovernmentIdExtraction(database.db, env, {
    verificationId: governmentId.id,
    fields: { ...emptyExtractedFields(), 'name-last': 'SYNTHETIC' },
    fieldSources: { 'name-last': ['viz'] },
    identificationNumberIndex: null,
    frontPhash: null,
  });
  // C40.5, C42.1: a capture's sealed device and a sealed face template are rewrapped too.
  const selfie = await createVerification(database.db, env, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  const capture = await createSelfieCapture(database.db, env, {
    id: testId('self'),
    verificationId: selfie.id,
    inquiryId: inquiry.id,
    method: 'camera',
    liveness: 'active',
    prompts: ['center', 'left', 'right'],
    nonceSha256: new Uint8Array(32),
    createdAt: new Date('2026-10-21T12:00:00.000Z'),
    expiresAt: new Date('2099-10-21T12:03:00.000Z'),
  });
  await consumeSelfieCapture(database.db, env, {
    id: capture.id,
    verificationId: selfie.id,
    now: new Date('2026-10-21T12:01:00.000Z'),
    device: { label: 'Synthetic Test Camera' },
  });
  await createFaceTemplate(database.db, env, {
    id: testId('ftpl'),
    verificationId: selfie.id,
    inquiryId: inquiry.id,
    model: 'sface-2021dec',
    embedding: Array.from({ length: 128 }, () => 0.088),
  });
  // Workflow 5A (C53.4): one value of each sealed column of the C53.2 tables.
  const phone = await createVerification(database.db, env, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'phone_number',
  });
  const otpChallengeId = await seedOtpChallenge(database.db, env, {
    verificationId: phone.id,
    inquiryId: inquiry.id,
    channel: 'sms',
    destination: '+15550100010',
  });
  const wallet = await createVerification(database.db, env, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'crypto_wallet',
  });
  const cryptoChallengeId = await seedCryptoChallenge(database.db, env, {
    verificationId: wallet.id,
    inquiryId: inquiry.id,
    chainId: 'eip155:1',
    walletAddress: '0x00000000000000000000000000000000000000cc',
    message: 'synthetic challenge',
    status: 'submitted',
    signature: '0xsynthetic',
    signedMessage: 'synthetic signed',
  });
  const entered = await createVerification(database.db, env, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'database',
  });
  await seedVerificationInputs(database.db, env, {
    verificationId: entered.id,
    inquiryId: inquiry.id,
    values: { 'name-first': 'SYNTHETIC' },
  });
  // Workflow 5B (C53.4): one value of each sealed column of the C53.3 tables.
  const ofType = async (type: 'document' | 'government_id_nfc' | 'database_business') =>
    (await createVerification(database.db, env, { id: testId('ver'), inquiryId: inquiry.id, type }))
      .id;
  const documentVerificationId = await ofType('document');
  await seedDocumentExtraction(database.db, env, {
    verificationId: documentVerificationId,
    inquiryId: inquiry.id,
    fields: { name: 'SYNTHETIC' },
  });
  const chipVerificationId = await ofType('government_id_nfc');
  const chipChallengeId = await seedChipChallenge(database.db, env, {
    verificationId: chipVerificationId,
    inquiryId: inquiry.id,
    status: 'submitted',
    aaResponse: 'c3ludGhldGlj',
    deviceReport: '{"read-ms":1}',
  });
  await seedChipRead(database.db, env, {
    verificationId: chipVerificationId,
    inquiryId: inquiry.id,
    fields: { 'name-last': 'SYNTHETIC' },
    sodSignature: new Uint8Array([1, 2, 3]),
  });
  const businessVerificationId = await ofType('database_business');
  await seedBusinessRegistryRecord(database.db, env, {
    verificationId: businessVerificationId,
    inquiryId: inquiry.id,
    record: { recordId: 'SANDBOX0001', legalName: 'SYNTHETIC LTD' },
  });
  // Phase 6 (C73.4): a report's query and result, a match's snapshot and an action's details.
  const { templateId, versionId } = await seedReportTemplate(database.db, env);
  const reportId = await seedReport(database.db, env, {
    templateId,
    versionId,
    result: { 'email-domain-kind': 'custom' },
  });
  const reportRunId = await seedReportRun(database.db, env, { reportId });
  await seedReportMatch(database.db, env, { reportId, runId: reportRunId });
  await seedReportAction(database.db, env, { reportId });
  const account = await createAccount(database.db, env, { id: testId('acc'), fields: { a: 1 } });
  const claim = await claimIdempotencyKey(database.db, env, {
    principalType: 'api_key',
    principalId: testId('key'),
    key: 'k',
    fingerprint: 'c'.repeat(64),
  });
  if (claim.outcome !== 'claimed') throw new Error(claim.outcome);
  await completeIdempotencyKey(database.db, env, claim.id, {
    status: 200,
    headers: {},
    body: '{}',
  });
  const apiLog = await createApiLog(database.db, env, {
    id: testId('alog'),
    method: 'GET',
    path: '/x',
    status: 200,
    durationMs: 1,
    ip: '203.0.113.2',
    userAgent: 'UA/3',
    query: {},
    requestBody: {},
    responseBody: {},
  });
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: `${testId('usr').toLowerCase()}@example.test`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
  });
  // Workflow 9A Stage 1b (T) (C156.4): a user's simulation preset, its scope sealed for the row.
  const presetId = testId('ssp');
  await database.db.execute(
    sql`insert into simulation_presets (id, environment_id, user_id, name, scope)
        values (${presetId}, ${env}, ${user.id}, 'Passing ID', ${sealJson(
          SEALED.simulationPresetScope,
          presetId,
          {
            fields: { name_first: 'Jane' },
          },
        )})`,
  );
  // Workflow 9A Stage 1b (H) (C160.6): a theme asset's envelope.
  const themeAssetId = testId('tsa');
  await database.db.execute(
    sql`insert into theme_assets (id, environment_id, kind, media_type, byte_size, width, height,
          storage_key, sha256, wrapped_dek)
        values (${themeAssetId}, ${env}, 'logo', 'image/png', 16, 1, 1, ${`synthetic/${themeAssetId}`},
          ${'0'.repeat(64)}, ${encryptBytes(randomBytes(16), keyring, { context: themeAssetId }).wrappedDek})`,
  );
  // Workflow 9B Stage 1b (X) (C166.1, C166.5): an export's sealed request, a completed export's
  // file and a bulk job's uploaded CSV.
  const pendingExportId = testId('exp');
  await database.db.execute(
    sql`insert into exports (id, environment_id, creator_type, creator_id, object_type, format,
          request)
        values (${pendingExportId}, ${env}, 'user', ${user.id}, 'inquiries', 'csv',
          ${sealJson(SEALED.exportRequest, pendingExportId, { 'filter[status]': 'completed' })})`,
  );
  const completedExportId = testId('exp');
  await database.db.execute(
    sql`insert into exports (id, environment_id, creator_type, creator_id, object_type, format,
          status, row_count, byte_size, storage_key, wrapped_dek, cut_at, completed_at, expires_at)
        values (${completedExportId}, ${env}, 'user', ${user.id}, 'inquiries', 'csv', 'completed',
          1, 16, ${`synthetic/${completedExportId}`},
          ${encryptBytes(randomBytes(16), keyring, { context: completedExportId }).wrappedDek},
          now(), now(), now() + interval '24 hours')`,
  );
  // Workflow 11B Stage 1b (D) (C253.2): a ready access export's sealed manifest, its wrapped key.
  const accountExportId = testId('aexp');
  await database.db.execute(
    sql`insert into account_exports (id, environment_id, account_id, creator_type, creator_id,
          status, item_ids, item_count, byte_count, storage_key, wrapped_dek, admitted_at,
          ready_at, expires_at)
        values (${accountExportId}, ${env}, ${account.id}, 'user', ${user.id}, 'ready',
          ${`{${account.id}}`}, 1, 16, ${`synthetic/${accountExportId}`},
          ${encryptBytes(randomBytes(16), keyring, { context: accountExportId }).wrappedDek},
          now(), now(), now() + interval '7 days')`,
  );
  const bulkJobId = testId('rbulk');
  await database.db.execute(
    sql`insert into report_bulk_jobs (id, environment_id, creator_type, creator_id,
          report_template_id, storage_key, wrapped_dek)
        values (${bulkJobId}, ${env}, 'user', ${user.id}, ${templateId},
          ${`synthetic/${bulkJobId}`},
          ${encryptBytes(randomBytes(16), keyring, { context: bulkJobId }).wrappedDek})`,
  );
  const factor = await createTotpFactor(database.db, organization.id, {
    id: testId('mfa'),
    userId: user.id,
    name: 'Phone',
    secret: 'JBSWY3DPEHPK3PXP',
  });
  return {
    env,
    org: organization.id,
    inquiry,
    session,
    webhook,
    audit,
    fileId,
    bytes,
    sealed,
    account,
    apiLog,
    factor,
    governmentIdVerificationId: governmentId.id,
    otpChallengeId,
    cryptoChallengeId,
    inputsVerificationId: entered.id,
    documentVerificationId,
    chipVerificationId,
    chipChallengeId,
    businessVerificationId,
  };
}

describe('KEK rewrap (C16)', () => {
  it('covers every table with an encrypted column', () => {
    expect([...REWRAP_TABLES].sort()).toEqual(
      [...new Set(ENCRYPTED_COLUMNS.map((entry) => entry.table))].sort(),
    );
  });

  it('rewraps every encrypted column, resumably, leaving updated_at and plaintext alone', async () => {
    setDefaultKeyring(oldKeyring);
    const seeded = await seedEverything(oldKeyring);
    const before = await database.client.query<{ updated_at: Date }>(
      `select updated_at from inquiries where id = $1`,
      [seeded.inquiry.id],
    );
    setDefaultKeyring(rotating);

    const dryRun = await rewrapAll(database.db, { keyring: rotating, dryRun: true });
    expect(dryRun.rewrapped).toBeGreaterThanOrEqual(ENCRYPTED_COLUMNS.length);
    expect(
      [...(await storedKeyIds()).values()].some((ids) => ids.has(oldKeyring.currentKeyId)),
    ).toBe(true);

    // Stop after the first batch, then resume from the reported position.
    const positions: { table: string; after: string | null }[] = [];
    await rewrapTableBatch(database.db, 'inquiries', { keyring: rotating, limit: 1 });
    const result = await rewrapAll(database.db, {
      keyring: rotating,
      batchSize: 2,
      onBatch: (batch) => {
        positions.push({ table: batch.table, after: batch.next });
      },
    });
    const after = await database.client.query<{ updated_at: Date }>(
      `select updated_at from inquiries where id = $1`,
      [seeded.inquiry.id],
    );

    expect(result.rewrapped).toBeGreaterThan(0);
    expect(positions.length).toBeGreaterThan(REWRAP_TABLES.length);
    for (const [column, ids] of await storedKeyIds()) {
      expect([column, [...ids]]).toEqual([column, ids.size === 0 ? [] : [rotating.currentKeyId]]);
    }
    expect(after.rows[0]?.updated_at).toEqual(before.rows[0]?.updated_at);
    expect((await rewrapAll(database.db, { keyring: rotating })).rewrapped).toBe(0);

    // Everything reads with the new KEK alone.
    setDefaultKeyring(newOnly);
    const { env, org } = seeded;
    expect((await getInquiry(database.db, env, seeded.inquiry.id))?.note).toBe('synthetic note');
    expect(
      (await getGovernmentIdExtraction(database.db, env, seeded.governmentIdVerificationId))
        ?.fields?.['name-last'],
    ).toBe('SYNTHETIC');
    expect(await getInquirySession(database.db, env, seeded.session.id)).toMatchObject({
      ip: '203.0.113.1',
      consent: { ip: '203.0.113.1' },
    });
    expect((await getWebhookDispatchConfig(database.db, env, seeded.webhook.id))?.secrets).toEqual([
      'wbhsec_synthetic_kek_two_wxyz',
      'wbhsec_synthetic_kek_one_abcd',
    ]);
    expect((await listAuditLogs(database.db, env))[0]).toMatchObject({
      ip: '198.51.100.3',
      userAgent: 'UA/2',
    });
    const file = await getFile(database.db, env, seeded.fileId);
    expect(
      decryptBytes(
        { wrappedDek: file?.wrappedDek ?? '', ciphertext: seeded.sealed.ciphertext },
        newOnly,
        {
          context: seeded.fileId,
        },
      ).equals(seeded.bytes),
    ).toBe(true);
    expect((await getAccount(database.db, env, seeded.account.id))?.fields).toEqual({ a: 1 });
    expect(await openOtpChallengeDestination(database.db, env, seeded.otpChallengeId)).toBe(
      '+15550100010',
    );
    expect(await openCryptoChallengeEvidence(database.db, env, seeded.cryptoChallengeId)).toEqual({
      walletAddress: '0x00000000000000000000000000000000000000cc',
      message: 'synthetic challenge',
      signature: '0xsynthetic',
      signedMessage: 'synthetic signed',
    });
    expect(
      (await getVerificationInputs(database.db, env, seeded.inputsVerificationId))?.values,
    ).toEqual({ 'name-first': 'SYNTHETIC' });
    expect(
      await openDocumentExtractionFields(database.db, env, seeded.documentVerificationId),
    ).toEqual({ name: 'SYNTHETIC' });
    expect(await openChipChallengeEvidence(database.db, env, seeded.chipChallengeId)).toEqual({
      aaResponse: 'c3ludGhldGlj',
      deviceReport: '{"read-ms":1}',
    });
    const chip = await openChipReadEvidence(database.db, env, seeded.chipVerificationId);
    expect(chip?.fields).toEqual({ 'name-last': 'SYNTHETIC' });
    expect([...(chip?.sodSignature ?? [])]).toEqual([1, 2, 3]);
    expect(
      (await openBusinessRegistryRecord(database.db, env, seeded.businessVerificationId))
        ?.legalName,
    ).toBe('SYNTHETIC LTD');
    expect((await getApiLog(database.db, env, seeded.apiLog.id))?.userAgent).toBe('UA/3');
    expect((await getTotpSecret(database.db, org, seeded.factor.id))?.secret).toBe(
      'JBSWY3DPEHPK3PXP',
    );
    const replay = await database.client.query<{ response_body: string }>(
      `select response_body from idempotency_keys`,
    );
    expect(replay.rows.every((row) => row.response_body.includes(rotating.currentKeyId))).toBe(
      true,
    );
    setDefaultKeyring(rotating);
  });

  it('refuses an unknown table', async () => {
    await expect(
      rewrapTableBatch(database.db, 'organizations' as (typeof REWRAP_TABLES)[number], {
        keyring: rotating,
      }),
    ).rejects.toThrow(/not an encrypted table/);
  });
});
