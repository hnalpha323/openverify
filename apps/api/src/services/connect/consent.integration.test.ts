/**
 * C236.5 (V08), C237.2, C241.2, C241.4 (Workflow 11A, `api-consent`) on Postgres 17 (Testcontainers):
 *
 * - the account path of the decline guard: an account-subject attestation is refused while a
 *   witnessed decline stands on one of the account's inquiries (V08's Testcontainers case);
 * - two withdrawals of one record at once: the record is taken `FOR UPDATE`, so exactly one withdraws
 *   and the other answers 409 `consent_already_withdrawn`, whichever starts first (both orders);
 * - a source redacted 31 days after a redemption: the pass of that day keeps the redeemed token (its
 *   copy exists), and the redaction then tells the destination (`connect/share-token.source-redacted`).
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  createAccount,
  createConsentRecord,
  createDatabase,
  createEnvironment,
  createInquiry,
  createInquiryTemplate,
  createKeyring,
  createOrganization,
  getConsentRecord,
  listEvents,
  eventObject,
  runMigrations,
  setDefaultKeyring,
  type Database,
  type NewOpenedConsentRecord,
} from '@openverify/db';
import { createIntegrationPool, ifSet, startIntegrationPostgres } from '@openverify/db/testing';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { ulidIdGenerator } from '../../ports.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import type { Acting } from '../inquiries.js';
import { attestConsentRecord } from './consent.js';
import { seedConnection, seedShareToken, shareTokenRow } from './consent.test-support.js';
import { connectRedactionHooks } from './redaction-hooks.js';
import { runConnectRetention } from './retention.js';
import { withdrawConsentRecordInTx } from './withdrawal.js';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
const clock = fixedClock();
const deps = () => ({
  db,
  clock,
  ids: ulidIdGenerator,
  events: createRecordingEventPublisher(),
  audit: createRecordingAuditLogger(),
});
let source: { organizationId: string; environmentId: string };
let destination: { organizationId: string; environmentId: string };
let connection: { id: string; policyId: string };
let templateId: string;
let versionId: string;

const DAY = 86_400_000;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(createKeyring(randomBytes(32)));
  const tenant = async (name: string) => {
    const organization = await createOrganization(db, { id: newId('org'), name });
    const environment = await createEnvironment(db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    });
    return { organizationId: organization.id, environmentId: environment.id };
  };
  source = await tenant('Example Source');
  destination = await tenant('Example Partner');
  connection = await seedConnection(db, {
    sourceOrganizationId: source.organizationId,
    destinationOrganizationId: destination.organizationId,
  });
  const defaults = defaultInquiryTemplateAttributes();
  const template = await createInquiryTemplate(db, source.environmentId, {
    id: newId('itmpl'),
    name: 'Consent',
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

const inquiryOf = async (environmentId: string, accountId: string) =>
  (
    await createInquiry(db, environmentId, {
      id: newId('inq'),
      inquiryTemplateId: templateId,
      inquiryTemplateVersionId: versionId,
      accountId,
    })
  ).id;

const record = (
  subject: { type: string; id: string },
  extra: Partial<NewOpenedConsentRecord> = {},
) =>
  createConsentRecord(db, source.environmentId, {
    id: newId('cnsr'),
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: subject.type as 'inquiry',
    subjectId: subject.id,
    connectionId: connection.id,
    recipientOrganizationId: destination.organizationId,
    recipientName: 'Example Partner',
    dataCategories: ['identity-fields'],
    explicitBiometric: false,
    textLocale: 'en',
    textKeys: ['share.consent.source'],
    textSha256: 'a'.repeat(64),
    method: 'flow',
    sessionId: newId('iqse'),
    acceptedAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + DAY),
    ...extra,
  });

const acting = (): Acting => ({
  ctx: { organizationId: source.organizationId, environmentId: source.environmentId },
  actor: { type: 'api-key', id: newId('key') },
  mask: UNMASKED,
  environmentKind: 'sandbox',
});

describe('the decline guard over an account (C236.5, V08)', () => {
  it('refuses an account attestation while a decline stands on one of its inquiries', async () => {
    const account = await createAccount(db, source.environmentId, { id: newId('acc') });
    const inquiryId = await inquiryOf(source.environmentId, account.id);
    await record({ type: 'inquiry', id: inquiryId }, { outcome: 'declined', acceptedAt: null });
    const attest = () =>
      attestConsentRecord(deps(), acting(), {
        data: {
          type: 'consent-record',
          attributes: {
            side: 'source',
            'connection-id': connection.id,
            'subject-id': account.id,
            'data-categories': ['identity-fields'],
            'explicit-biometric': false,
            'expires-in-seconds': 86_400,
            'evidence-reference': 'synthetic-ref',
            'attested-at': new Date(clock.now().getTime() - 60_000).toISOString(),
            'text-locale': 'en',
            'text-body': 'Synthetic attested text.',
          },
        },
      });
    await expect(attest()).rejects.toMatchObject({ code: 'consent_declined_in_flow' });
    const other = await createAccount(db, source.environmentId, { id: newId('acc') });
    await expect(
      attestConsentRecord(deps(), acting(), {
        data: {
          type: 'consent-record',
          attributes: {
            side: 'source',
            'connection-id': connection.id,
            'subject-id': other.id,
            'data-categories': ['identity-fields'],
            'explicit-biometric': false,
            'expires-in-seconds': 86_400,
            'evidence-reference': 'synthetic-ref',
            'attested-at': new Date(clock.now().getTime() - 60_000).toISOString(),
            'text-locale': 'en',
            'text-body': 'Synthetic attested text.',
          },
        },
      }),
    ).resolves.toMatchObject({ data: { attributes: { witnessed: false } } });
  });
});

describe('two withdrawals of one record at once (C237.2)', () => {
  for (const first of ['api', 'flow'] as const) {
    it(`withdraws once, the ${first} channel starting first`, async () => {
      const account = await createAccount(db, source.environmentId, { id: newId('acc') });
      const consent = await record({
        type: 'inquiry',
        id: await inquiryOf(source.environmentId, account.id),
      });
      const withdraw = (via: 'api' | 'flow') =>
        db.transaction((tx) =>
          withdrawConsentRecordInTx(tx, deps(), {
            environmentId: source.environmentId,
            id: consent.id,
            via,
            reason: null,
            actor: via === 'api' ? { kind: 'principal', acting: acting() } : { kind: 'flow' },
          }),
        );
      const second = first === 'api' ? 'flow' : 'api';
      const outcomes = await Promise.allSettled([withdraw(first), withdraw(second)]);
      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const refused = outcomes.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ code: 'consent_already_withdrawn' });
      expect((await getConsentRecord(db, source.environmentId, consent.id))?.withdrawnAt).not.toBe(
        null,
      );
    });
  }
});

describe('a source redacted 31 days after a redemption (C241.2, C241.4)', () => {
  it('keeps the redeemed token while the copy exists, and tells the destination', async () => {
    const account = await createAccount(db, source.environmentId, { id: newId('acc') });
    const sourceInquiry = await inquiryOf(source.environmentId, account.id);
    const consent = await record({ type: 'inquiry', id: sourceInquiry });
    const token = await seedShareToken(db, {
      sourceEnvironmentId: source.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: consent.id,
      sourceId: sourceInquiry,
      status: 'redeemed',
    });
    const destinationAccount = await createAccount(db, destination.environmentId, {
      id: newId('acc'),
    });
    const destinationTemplate = await createInquiryTemplate(db, destination.environmentId, {
      id: newId('itmpl'),
      name: 'Destination',
      version: { id: newId('itmplv'), flow: {}, verificationConfig: {} },
    });
    const copy = await createInquiry(db, destination.environmentId, {
      id: newId('inq'),
      inquiryTemplateId: destinationTemplate.id,
      inquiryTemplateVersionId: destinationTemplate.currentVersion.id,
      accountId: destinationAccount.id,
    });
    const redeemedAt = new Date(clock.now().getTime() - 31 * DAY);
    await pool.query(
      `update connect_share_tokens set redeemed_at = $2, pending_at = $2, destination_type = 'inquiry',
         destination_id = $3 where id = $1`,
      [token, redeemedAt, copy.id],
    );
    const now = clock.now();
    await runConnectRetention({ db, clock, now, batch: { now, limit: 500 } });
    expect((await shareTokenRow(db, token)).status).toBe('redeemed');

    await db.transaction((tx) =>
      connectRedactionHooks.inquiryRedactedInTx(tx, {
        environmentId: source.environmentId,
        id: sourceInquiry,
        at: now,
      }),
    );
    const told = (
      await listEvents(db, destination.environmentId, {
        name: 'connect/share-token.source-redacted',
        size: 100,
      })
    ).items.map((event) => eventObject(event.payload).id);
    expect(told).toContain(token);
    expect((await shareTokenRow(db, token)).status).toBe('redeemed');
  });
});
