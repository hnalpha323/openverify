/**
 * C207.2 (Phase 10, Workflow 10C; review H17) against Postgres 17 (Testcontainers), `contracts-10c`:
 * the SDK asks for a chip challenge when the person presses "I'm ready", before the chip is read,
 * so before any chip file exists. This confirms what Phase 5 built: a challenge taken on an
 * `initiated` verification that holds no file is created, stays open while the files are uploaded
 * afterwards, and is accepted by the submit that names it. Every chip and key is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { CHIP_CHALLENGE_NONCE_HEX_LENGTH, newId } from '@openverify/contracts';
import {
  createDatabase,
  createFile,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createKeyring,
  createVerification,
  encryptBytes,
  getVerification,
  hashSessionToken,
  listChipChallenges,
  listVerificationFiles,
  recordInquirySessionConsent,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  type Database,
  type FileKind,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowSession } from '../../auth/flow-session.js';
import { ulidIdGenerator } from '../../ports.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../../test-support/fakes.js';
import { installSandboxTrustAnchor } from '../../trust-anchors/sandbox.js';
import { createAccountsService } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { submitVerification } from '../flow.js';
import { createFlowChipChallenge } from './create.js';
import { chipUploads, nfcTemplateAttributes, testChip } from './testing.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let environmentId: string;
let templateId: string;
let versionId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 4 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  const clock = fixedClock(new Date());
  const events = createRecordingEventPublisher();
  deps = {
    db,
    keyring,
    storage: createInMemoryFileStorage(),
    events,
    queue: createRecordingQueue(),
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.test',
    flowCorsOrigins: ['https://flow.example.test'],
    accounts: createAccountsService({ events }),
    redaction: createRecordingRedactionService(clock),
    audit: createRecordingAuditLogger(),
    rateLimiter: createAllowAllRateLimiter(clock),
    mailer: createCapturingMailer(),
    ...phase5TestDependencies(clock),
  };
  environmentId = (await createTestTenant(db, { organizationName: 'Chip Before Upload Org' }))
    .environment.id;
  const attributes = nfcTemplateAttributes();
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Challenge before upload',
    version: {
      id: newId('itmplv'),
      flow: attributes.flow,
      verificationConfig: attributes['verification-config'],
    },
  });
  templateId = template.id;
  versionId = template.currentVersion.id;
  await installSandboxTrustAnchor(db, { now: new Date() });
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/** A pending inquiry whose session consented, with an `initiated` NFC verification and no file. */
async function consentedWithoutFiles(): Promise<{ session: FlowSession; verificationId: string }> {
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_synthetic_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id_nfc',
  });
  return { session: { id: session.id, environmentId, inquiryId: inquiry.id }, verificationId };
}

/** Stores the chip's files as the upload route does, after the challenge exists. */
async function uploadChipFiles(verificationId: string, seed: string): Promise<void> {
  for (const [kind, bytes] of chipUploads(testChip({ now: new Date(), seed }))) {
    const id = newId('file');
    const sealed = encryptBytes(bytes, keyring, { context: id });
    const storageKey = `${environmentId}/${id}`;
    await deps.storage.put(storageKey, sealed.ciphertext);
    await createFile(db, environmentId, {
      id,
      verificationId,
      kind: kind as FileKind,
      storageKey,
      mimeType: 'application/octet-stream',
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      wrappedDek: sealed.wrappedDek,
    });
  }
}

describe('C207.2: a chip challenge taken before any chip file is uploaded', () => {
  it('is created on an initiated verification that holds no file', async () => {
    const flow = await consentedWithoutFiles();
    expect(await listVerificationFiles(db, environmentId, [flow.verificationId])).toEqual([]);

    const challenge = await createFlowChipChallenge(deps, flow.session, flow.verificationId);

    expect(challenge.id.startsWith('chc_')).toBe(true);
    expect(challenge.nonce).toMatch(
      new RegExp(`^[0-9a-f]{${String(CHIP_CHALLENGE_NONCE_HEX_LENGTH)}}$`),
    );
    expect((await getVerification(db, environmentId, flow.verificationId))?.status).toBe(
      'initiated',
    );
    const rows = await listChipChallenges(db, environmentId, flow.verificationId);
    expect(rows.map((row) => [row.id, row.status, row.submittedAt])).toEqual([
      [challenge.id, 'initiated', null],
    ]);
  });

  it('is accepted by the submit once the files were uploaded after it', async () => {
    const flow = await consentedWithoutFiles();
    const challenge = await createFlowChipChallenge(deps, flow.session, flow.verificationId);

    await uploadChipFiles(flow.verificationId, 'before-upload/submit');
    await submitVerification(deps, flow.session, flow.verificationId, {
      chip: { 'challenge-id': challenge.id, nonce: challenge.nonce },
    });

    expect((await getVerification(db, environmentId, flow.verificationId))?.status).toBe(
      'submitted',
    );
    const [row] = await listChipChallenges(db, environmentId, flow.verificationId);
    expect(row?.id).toBe(challenge.id);
    expect(row?.status).toBe('submitted');
    expect(row?.submittedAt).not.toBeNull();
  });
});
