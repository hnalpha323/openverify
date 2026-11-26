/**
 * C240.5, C253.2, KP11-16 (Workflow 11B, `dsar-export`; Stage 1a amendment 23): the access export's
 * read of Connect on a real Postgres, through `crossTenant.listSharesTouching` only. A source
 * inquiry is shared and redeemed by a clone at the destination (the production redemption):
 *
 * - the **source** account's export lists the outbound share with its recipient as the subject was
 *   shown it (`{organization-id, organization-name}` from the source record), and its own consent
 *   record; never the destination's record;
 * - the **destination** account's export (the clone's account) lists the inbound share with its
 *   source named from the copy's provenance, and its own (destination) record; never the source's
 *   record, its evidence or any counterparty user (review P26).
 *
 * Synthetic rows only (rule 9).
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  createConsentRecord,
  createDatabase,
  createKeyring,
  createVerification,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { createEventPublisher } from '../../events/index.js';
import { processConnectRedeem } from '../../jobs/connect-redeem/process.js';
import { createCapturingLogger, createRecordingQueue } from '../../jobs/testing.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { seedConnection, seedShareToken } from '../connect/consent.test-support.js';
import { redeemShareTokenInTx, redemptionCrossTenant } from '../connect/redeem.js';
import type { ApiDependencies } from '../context.js';
import { collectAccountExport } from './collect.js';
import { buildAccountExportManifest } from './manifest.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-11-13T10:00:00.000Z');
const clock = { now: () => NOW };

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 6 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the test expected a value');
  }
  return value;
}

const POLICY = {
  purpose: 'share.reuse-kyc',
  'source-types': ['inquiry', 'account', 'transaction', 'verification'],
  verifications: {
    types: ['government-id'],
    'extracted-data': true,
    'check-results': true,
    files: true,
  },
  fields: { inquiry: [], account: [], transaction: [] },
  biometric: false,
  peek: {},
  'attested-consent': 'all',
};
const CATEGORIES = ['identity-fields', 'check-results'];

type NewRecord = Parameters<typeof createConsentRecord>[2];

const record = (environmentId: string, input: Partial<NewRecord>) =>
  createConsentRecord(db, environmentId, {
    id: newId('cnsr'),
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    dataCategories: CATEGORIES,
    textLocale: 'en',
    textSha256: 'e'.repeat(64),
    method: 'flow',
    acceptedAt: NOW,
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    ...input,
  } as NewRecord);

describe('the access export reads Connect on both sides (C240.5, KP11-16)', () => {
  it('names the recipient at the source and the source at the destination, each side’s own records only', async () => {
    const source = await createTestTenant(db);
    const destination = await createTestTenant(db);
    const connection = await seedConnection(db, {
      sourceOrganizationId: source.organization.id,
      destinationOrganizationId: destination.organization.id,
      policy: POLICY,
    });
    const { inquiry } = await createTestInquiry(db, source.environment.id);
    const verificationId = newId('ver');
    await createVerification(db, source.environment.id, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    await setVerificationStatus(db, source.environment.id, verificationId, { to: 'submitted' });
    await setVerificationStatus(db, source.environment.id, verificationId, { to: 'passed' });
    const sourceRecord = await record(source.environment.id, {
      side: 'source',
      subjectType: 'inquiry',
      subjectId: inquiry.id,
      connectionId: connection.id,
      recipientOrganizationId: destination.organization.id,
      recipientName: 'Example Partner Bank',
      textKeys: ['share.consent.source'],
      evidenceIp: '192.0.2.44',
      evidenceUserAgent: 'Synthetic source agent',
    });
    const { template } = await createTestInquiry(db, destination.environment.id);
    const tokenId = await seedShareToken(db, {
      sourceEnvironmentId: source.environment.id,
      destinationEnvironmentId: destination.environment.id,
      connection,
      consentRecordId: sourceRecord.id,
      sourceType: 'inquiry',
      sourceId: inquiry.id,
      categories: CATEGORIES,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const destinationRecord = await record(destination.environment.id, {
      side: 'destination',
      subjectType: 'share-token',
      subjectId: tokenId,
      shareTokenId: tokenId,
      connectionId: connection.id,
      recipientOrganizationId: destination.organization.id,
      recipientName: 'Example Partner Bank',
      textKeys: ['share.consent.destination'],
      evidenceIp: '198.51.100.45',
      evidenceUserAgent: 'Synthetic destination agent',
    });
    await db.transaction((tx) =>
      redeemShareTokenInTx(
        tx,
        {
          deps: {} as ApiDependencies,
          acting: {
            ctx: {
              organizationId: destination.organization.id,
              environmentId: destination.environment.id,
            },
            actor: { type: 'api-key', id: 'key_01M5CN0000000000000011B361' },
            mask: UNMASKED,
            environmentKind: 'sandbox',
          },
          now: NOW,
        },
        tokenId,
        {
          meta: {
            'inquiry-template-id': template.id,
            'destination-consent-record-id': destinationRecord.id,
          },
        },
      ),
    );
    await expect(
      processConnectRedeem(
        { environmentId: destination.environment.id, shareTokenId: tokenId },
        {
          db,
          clock,
          logger: createCapturingLogger(),
          keyring,
          storage: createInMemoryFileStorage(),
          events: createEventPublisher({
            db,
            deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
          }),
          crossTenant: redemptionCrossTenant,
        },
      ),
    ).resolves.toEqual({ outcome: 'redeemed' });
    const { rows } = await pool.query<{ account_id: string; clone: string }>(
      `select i.account_id, t.destination_id as clone from connect_share_tokens t
         join inquiries i on i.id = t.destination_id where t.id = $1`,
      [tokenId],
    );
    const cloneAccountId = must(rows[0]).account_id;

    // The source side.
    const atSource = await collectAccountExport(
      { db, clock },
      source.environment.id,
      inquiry.accountId,
    );
    expect(atSource.connectShares).toEqual([
      {
        'share-token-id': tokenId,
        direction: 'outbound',
        status: 'redeemed',
        'data-categories': CATEGORIES,
        'created-at': expect.any(String) as unknown,
        'redeemed-at': NOW.toISOString(),
        recipient: {
          'organization-id': destination.organization.id,
          'organization-name': 'Example Partner Bank',
        },
        source: null,
      },
    ]);
    expect(atSource.consentRecords.map(({ id }) => id)).toEqual([sourceRecord.id]);
    const sourceText = JSON.stringify(atSource);
    expect(sourceText).toContain('192.0.2.44');
    expect(sourceText).not.toContain('198.51.100.45');
    expect(sourceText).not.toContain(destinationRecord.id);

    // The destination side: the clone's account.
    const atDestination = await collectAccountExport(
      { db, clock },
      destination.environment.id,
      cloneAccountId,
    );
    expect(atDestination.connectShares).toEqual([
      expect.objectContaining({
        'share-token-id': tokenId,
        direction: 'inbound',
        status: 'redeemed',
        recipient: null,
        source: { 'organization-name': expect.any(String) as unknown },
      }),
    ]);
    expect(atDestination.consentRecords.map(({ id }) => id)).toEqual([destinationRecord.id]);
    const destinationText = JSON.stringify(atDestination);
    expect(destinationText).toContain('198.51.100.45');
    expect(destinationText).not.toContain('192.0.2.44');
    expect(destinationText).not.toContain(sourceRecord.id);

    // Both manifests hold to the schema.
    for (const [environmentId, accountId, collected] of [
      [source.environment.id, inquiry.accountId, atSource],
      [destination.environment.id, cloneAccountId, atDestination],
    ] as const) {
      expect(
        buildAccountExportManifest(collected, {
          exportId: 'aexp_01M5CN0000000000000011B101',
          environmentId,
          accountId,
          generatedAt: NOW,
        }).subject['connect-shares'],
      ).toHaveLength(1);
    }
  });
});
