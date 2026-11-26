/**
 * C38: the 2B lock gaps, against real Postgres 17 row locks (Testcontainers). Each test holds a
 * row lock in a second connection, as a concurrent request or job would, and runs the service:
 * - F015: `submitVerification` re-reads the inquiry under its row lock in its transaction, so an
 *   inquiry closed concurrently (expired, decided, redacted) is never submitted for;
 * - F016: `resumeInquiry` locks the inquiry before it opens a session, so no session is opened
 *   on an inquiry that closed meanwhile;
 * - F025: add-objects and remove-objects lock every account involved in id order before the
 *   inquiries, the order of inquiry creation (the account, then its inquiry) and consolidation
 *   (accounts in id order, then their inquiries), so a move waits for a change of the account its
 *   inquiry leaves.
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createDatabase,
  createEnvironment,
  createFile,
  createInquiry,
  createInquiryTemplate,
  createKeyring,
  createOrganization,
  createVerification,
  encryptBytes,
  getInquiry,
  getVerification,
  listInquirySessions,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../auth/pii.js';
import { ConflictError } from '../errors.js';
import { ulidIdGenerator } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../test-support/fakes.js';
import { addAccountObjects, createAccountsService } from './accounts.js';
import type { ApiDependencies } from './context.js';
import { submitVerification } from './flow.js';
import { resumeInquiry, type Acting } from './inquiries.js';

const keyring = createKeyring(randomBytes(32));
const defaults = defaultInquiryTemplateAttributes();

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let environmentId: string;
let templateId: string;
let versionId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  const clock = fixedClock();
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
  const organization = await createOrganization(db, { id: newId('org'), name: 'Example Org' });
  environmentId = (
    await createEnvironment(db, { id: newId('env'), organizationId: organization.id, kind: 'sandbox' })
  ).id;
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Locks',
    version: {
      id: newId('itmplv'),
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    },
  });
  templateId = template.id;
  versionId = template.currentVersion.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const acting = (): Acting => ({
  ctx: { organizationId: 'org_X', environmentId },
  actor: { type: 'api-key', id: 'key_X' },
  mask: UNMASKED,
  environmentKind: 'sandbox',
});

async function pendingInquiry(accountId?: string) {
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
    ...(accountId === undefined ? {} : { accountId }),
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  return inquiry;
}

/** A government ID verification with both sides uploaded, ready to submit. */
async function readyGovernmentId(inquiryId: string) {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type: 'government_id' });
  for (const kind of ['front', 'back'] as const) {
    const fileId = newId('file');
    const sealed = encryptBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), keyring, {
      context: fileId,
    });
    await createFile(db, environmentId, {
      id: fileId,
      verificationId: id,
      kind,
      storageKey: `${environmentId}/${fileId}`,
      mimeType: 'image/jpeg',
      byteSize: 4,
      sha256: 'a'.repeat(64),
      wrappedDek: sealed.wrappedDek,
    });
  }
  return id;
}

/**
 * Runs `held` in a transaction of its own connection and keeps it open while `service` starts,
 * then commits. Resolves with whether `service` settled before the commit, and its outcome.
 */
async function whileHeld(
  held: (client: PoolClient) => Promise<void>,
  service: () => Promise<unknown>,
): Promise<{ settledBeforeCommit: boolean; outcome: unknown }> {
  const client = await pool.connect();
  let committed = false;
  let settledBeforeCommit = false;
  try {
    await client.query('BEGIN');
    await held(client);
    const running = service().then(
      (value: unknown) => value,
      (error: unknown) => error,
    );
    const settled = running.then(() => {
      settledBeforeCommit = !committed;
    });
    // Long enough for a service that takes no lock to finish first.
    await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 1_500))]);
    committed = true;
    await client.query('COMMIT');
    return { outcome: await running, settledBeforeCommit };
  } finally {
    client.release();
  }
}

describe('2B F015: submitVerification and the inquiry lock', () => {
  it('waits for a concurrent change of the inquiry and refuses once it has closed', async () => {
    const inquiry = await pendingInquiry();
    const verificationId = await readyGovernmentId(inquiry.id);

    const { outcome, settledBeforeCommit } = await whileHeld(
      async (client) => {
        await client.query('SELECT id FROM inquiries WHERE id = $1 FOR UPDATE', [inquiry.id]);
        await client.query(
          "UPDATE inquiries SET status = 'expired', expired_at = now() WHERE id = $1",
          [inquiry.id],
        );
      },
      () => submitVerification(deps, { id: 'iqse_X', environmentId, inquiryId: inquiry.id }, verificationId),
    );

    expect(settledBeforeCommit).toBe(false);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((await getVerification(db, environmentId, verificationId))?.status).toBe('initiated');
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('expired');
  });
});

describe('2B F016: resumeInquiry and the inquiry lock', () => {
  it('waits for a concurrent change of the inquiry and opens no session once it has closed', async () => {
    const inquiry = await pendingInquiry();

    const { outcome, settledBeforeCommit } = await whileHeld(
      async (client) => {
        await client.query('SELECT id FROM inquiries WHERE id = $1 FOR UPDATE', [inquiry.id]);
        await client.query(
          "UPDATE inquiries SET status = 'completed', completed_at = now() WHERE id = $1",
          [inquiry.id],
        );
      },
      () => resumeInquiry(deps, acting(), inquiry.id),
    );

    expect(settledBeforeCommit).toBe(false);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((await listInquirySessions(db, environmentId, { inquiryId: inquiry.id })).items).toEqual([]);
  });
});

describe('2B F025: add-objects locks the accounts before the inquiries', () => {
  it('waits for a concurrent change of the account its inquiry leaves, then moves it', async () => {
    const source = await pendingInquiry();
    const target = await pendingInquiry();

    const { outcome, settledBeforeCommit } = await whileHeld(
      async (client) => {
        // As a consolidation or redaction of the source account would.
        await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [source.accountId]);
      },
      () => addAccountObjects(deps, acting().ctx, acting().actor, target.accountId, [source.id]),
    );

    expect(settledBeforeCommit).toBe(false);
    expect(outcome).toMatchObject({ account: { id: target.accountId } });
    expect((await getInquiry(db, environmentId, source.id))?.accountId).toBe(target.accountId);
  });

  it('refuses with 409 when an inquiry moves to another account while it waits for its row', async () => {
    const source = await pendingInquiry();
    const target = await pendingInquiry();
    const elsewhere = await pendingInquiry();

    const { outcome } = await whileHeld(
      async (client) => {
        await client.query('UPDATE inquiries SET account_id = $1 WHERE id = $2', [
          elsewhere.accountId,
          source.id,
        ]);
      },
      () => addAccountObjects(deps, acting().ctx, acting().actor, target.accountId, [source.id]),
    );

    expect(outcome).toBeInstanceOf(ConflictError);
    expect((await getInquiry(db, environmentId, source.id))?.accountId).toBe(elsewhere.accountId);
  });
});
