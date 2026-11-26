/**
 * C234.2-C234.11, C235, C236.10, C241.1 (Workflow 11A, `api-redeem` checkpoint 2): the
 * `connect-redeem` job. A clone of an inquiry makes a new inquiry under the requested version with
 * its provenance and the shareable verifications cloned onto it, in review while
 * `accept-cloned-results` is off; the token is `redeemed` with its `redeem-summary`; the destination
 * record's subject becomes the copy, the token id kept; both sides are told. A source redacted while
 * pending, a withdrawn consent and a share that grew past the token's categories each end the token
 * `failed`, both sides told, nothing copied. A hydrate writes fields only; `fill-inquiry` clones onto
 * the reserved inquiry without moving it.
 *
 * The source side is read through the production redemption port, `cross-tenant.ts`'s
 * `markInboundShareToken` and `readRedemptionSource` (integration-11a). Synthetic rows only (rule 9).
 */
import { newId } from '@openverify/contracts';
import { getConsentRecord, getInquiry, listInquiryVerifications, type Db } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { seedConnection, seedShareToken } from '../../services/connect/consent.test-support.js';
import {
  redeemShareTokenInTx,
  redemptionCrossTenant,
  requestFillInquiryRedemptionInTx,
  type RedeemCaller,
  type RedemptionCrossTenant,
} from '../../services/connect/redeem.js';
import { createTestApi, seedVerification, type TestApi } from '../../test-support/harness.js';
import { createCapturingLogger } from '../testing.js';
import { processConnectRedeem } from './process.js';

let api: TestApi;
let db: Db;

beforeAll(async () => {
  api = await createTestApi();
  db = api.database.db;
}, 120_000);

afterAll(async () => {
  await api.close();
});

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows;
/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the test expected a value');
  }
  return value;
}

const NOW = new Date('2026-11-12T10:00:00.000Z');

/** The suite's port: the production binding of `cross-tenant.ts` (integration-11a). */
const port: RedemptionCrossTenant = redemptionCrossTenant;

const ID_ONLY_POLICY = {
  purpose: 'share.reuse-kyc',
  'source-types': ['inquiry', 'account', 'transaction', 'verification'],
  verifications: {
    types: ['government-id'],
    'extracted-data': true,
    'check-results': true,
    files: true,
  },
  fields: { inquiry: [], account: ['name_first'], transaction: [] },
  biometric: false,
  peek: {},
  'attested-consent': 'all',
};

async function consentRecord(
  environmentId: string,
  input: {
    side: 'source' | 'destination';
    connectionId: string;
    recipientOrganizationId: string;
    shareTokenId?: string | null;
    subject: { type: string; id: string };
    categories: readonly string[];
  },
): Promise<string> {
  const id = newId('cnsr');
  await db.execute(sql`
    insert into consent_records (environment_id, id, side, outcome, purpose, subject_type, subject_id,
      connection_id, share_token_id, recipient_organization_id, recipient_name, data_categories,
      explicit_biometric, text_locale, text_keys, text_sha256, method, accepted_at, expires_at)
    values (${environmentId}, ${id}, ${input.side}, 'accepted', 'share.reuse-kyc',
      ${input.subject.type}, ${input.subject.id}, ${input.connectionId},
      ${input.shareTokenId ?? null}, ${input.recipientOrganizationId}, 'Example Partner',
      ${`{${input.categories.join(',')}}`}::text[], false, 'en',
      '{share.consent.destination}'::text[], ${'b'.repeat(64)}, 'flow', ${NOW},
      ${new Date('2026-12-31T00:00:00.000Z')})`);
  return id;
}

const CATEGORIES = ['identity-fields', 'document-images', 'check-results'];

interface Redemption {
  tokenId: string;
  destination: { organizationId: string; environmentId: string };
  source: { environmentId: string; inquiryId: string; verificationId: string };
  destinationRecordId: string;
  templateId: string;
  reservedInquiryId: string;
}

async function pendingShare(
  options: {
    categories?: readonly string[];
    sourceType?: 'inquiry' | 'account';
    fill?: boolean;
  } = {},
): Promise<Redemption> {
  const source = await api.newTenant();
  const destination = await api.newTenant();
  const connection = await seedConnection(db, {
    sourceOrganizationId: source.organizationId,
    destinationOrganizationId: destination.organizationId,
    policy: ID_ONLY_POLICY,
  });
  const { inquiry } = await createTestInquiry(db, source.environmentId);
  const verification = await seedVerification(api, source.environmentId, inquiry.id, {
    status: 'passed',
    files: ['front'],
    checks: [{ name: 'id_expired_detection', status: 'passed' }],
  });
  const sourceRecordId = await consentRecord(source.environmentId, {
    side: 'source',
    connectionId: connection.id,
    recipientOrganizationId: destination.organizationId,
    subject: { type: 'inquiry', id: inquiry.id },
    categories: CATEGORIES,
  });
  const destinationInquiry = await createTestInquiry(db, destination.environmentId);
  const tokenId = await seedShareToken(db, {
    sourceEnvironmentId: source.environmentId,
    destinationEnvironmentId: destination.environmentId,
    connection,
    consentRecordId: sourceRecordId,
    sourceType: 'inquiry',
    sourceId: inquiry.id,
    categories: options.categories ?? CATEGORIES,
    reservedInquiryId: options.fill === true ? destinationInquiry.inquiry.id : null,
  });
  const destinationRecordId = await consentRecord(destination.environmentId, {
    side: 'destination',
    connectionId: connection.id,
    recipientOrganizationId: destination.organizationId,
    shareTokenId: tokenId,
    subject: { type: 'share-token', id: tokenId },
    categories: CATEGORIES,
  });
  return {
    tokenId,
    destination: {
      organizationId: destination.organizationId,
      environmentId: destination.environmentId,
    },
    source: {
      environmentId: source.environmentId,
      inquiryId: inquiry.id,
      verificationId: verification.id,
    },
    destinationRecordId,
    templateId: destinationInquiry.template.id,
    reservedInquiryId: destinationInquiry.inquiry.id,
  };
}

const callerOf = (r: Redemption): RedeemCaller => ({
  deps: api.deps,
  acting: {
    ctx: r.destination,
    actor: { type: 'api-key', id: 'key_01M5CN0000000000000011A350' },
    mask: UNMASKED,
    environmentKind: 'sandbox',
  },
  now: NOW,
});

async function askClone(r: Redemption): Promise<void> {
  await db.transaction((tx) =>
    redeemShareTokenInTx(
      tx,
      callerOf(r),
      r.tokenId,
      {
        meta: {
          'inquiry-template-id': r.templateId,
          'destination-consent-record-id': r.destinationRecordId,
        },
      },
      port,
    ),
  );
}

const run = (r: Redemption) =>
  processConnectRedeem(
    { environmentId: r.destination.environmentId, shareTokenId: r.tokenId },
    {
      db,
      clock: api.clock,
      logger: createCapturingLogger(),
      keyring: api.database.keyring,
      storage: api.storage,
      events: api.events,
      api: api.deps,
      crossTenant: port,
    },
  );

async function token(id: string) {
  const [row] = rowsOf<{
    status: string;
    failure_reason: string | null;
    destination_id: string | null;
    redeem_summary: Record<string, unknown> | null;
  }>(
    await db.execute(sql`select status, failure_reason, destination_id, redeem_summary
      from connect_share_tokens where id = ${id}`),
  );
  return must(row);
}

const staged = (name: string) =>
  api.events.events.filter((event) => event.name === name).map((event) => event.environmentId);

describe('the connect-redeem job: a clone of an inquiry (C234.3, C235)', () => {
  it('makes a new inquiry under the version, in review while accept-cloned-results is off, and redeems', async () => {
    const r = await pendingShare();
    await askClone(r);
    await expect(run(r)).resolves.toEqual({ outcome: 'redeemed' });
    const row = await token(r.tokenId);
    expect(row.status).toBe('redeemed');
    const clone = must(await getInquiry(db, r.destination.environmentId, must(row.destination_id)));
    expect(clone.status).toBe('needs_review');
    expect(clone.provenance).toMatchObject({
      kind: 'connect-clone',
      'share-token-id': r.tokenId,
      // The source organisation's own name, read through cross-tenant.ts (the double fixed it).
      'source-organization-name': 'Example Test Org',
    });
    expect(JSON.stringify(clone.provenance)).not.toContain(r.source.inquiryId);
    const [copied] = await listInquiryVerifications(db, r.destination.environmentId, clone.id);
    expect(copied).toMatchObject({ type: 'government_id', status: 'passed' });
    expect(must(copied).checks.map(({ name }) => name)).toEqual(['id_expired_detection']);
    expect(row.redeem_summary).toEqual({
      'policy-version': 1,
      verifications: 1,
      checks: 1,
      files: 1,
      fields: 0,
      'dropped-fields': [],
      'peek-count': 0,
    });
  });

  it('moves the destination record to the copy, keeping the token id (C236.10)', async () => {
    const r = await pendingShare();
    await askClone(r);
    await run(r);
    const row = await token(r.tokenId);
    expect(
      await getConsentRecord(db, r.destination.environmentId, r.destinationRecordId),
    ).toMatchObject({
      subjectType: 'inquiry',
      subjectId: row.destination_id,
      shareTokenId: r.tokenId,
    });
  });

  it('tells both sides and stages no verification event for the clone (C239.1, C235.7(a))', async () => {
    const r = await pendingShare();
    await askClone(r);
    const before = api.events.events.length;
    await run(r);
    const names = api.events.events.slice(before).map((event) => event.name);
    expect(names).toContain('connect/share-token.inbound-redeemed');
    expect(names).toContain('connect/share-token.outbound-redeemed');
    expect(names.filter((name) => name.startsWith('verification.'))).toEqual([]);
    expect(names).toContain('inquiry.created');
    for (const event of api.events.events.slice(before)) {
      if (event.name.startsWith('inquiry.')) {
        expect(
          (event.payload as { data: { attributes: { provenance?: unknown } } }).data.attributes
            .provenance,
        ).toMatchObject({ kind: 'connect-clone' });
      }
    }
  });
});

describe('the connect-redeem job’s failures (C234.2, C241.1)', () => {
  it('fails a source redacted while pending with source_redacted, copying nothing, both sides told', async () => {
    const r = await pendingShare();
    await askClone(r);
    await db.execute(
      sql`update inquiries set redacted_at = ${NOW} where id = ${r.source.inquiryId}`,
    );
    const before = staged('connect/share-token.failed').length;
    await expect(run(r)).resolves.toEqual({ outcome: 'failed', failureReason: 'source_redacted' });
    expect(await token(r.tokenId)).toMatchObject({
      status: 'failed',
      failure_reason: 'source_redacted',
      destination_id: null,
    });
    expect(staged('connect/share-token.failed').length - before).toBe(2);
  });

  it('fails on a withdrawn destination consent with consent_withdrawn', async () => {
    const r = await pendingShare();
    await askClone(r);
    await db.execute(sql`update consent_records set withdrawn_at = ${NOW}, withdrawn_via = 'api'
      where id = ${r.destinationRecordId}`);
    await expect(run(r)).resolves.toEqual({
      outcome: 'failed',
      failureReason: 'consent_withdrawn',
    });
  });

  it('fails when the rows to copy hold a category the token did not store (consent_scope_exceeded, H04)', async () => {
    const r = await pendingShare({ categories: ['identity-fields', 'check-results'] });
    await askClone(r);
    await expect(run(r)).resolves.toEqual({
      outcome: 'failed',
      failureReason: 'consent_scope_exceeded',
    });
  });

  it('leaves a token that is no longer pending alone', async () => {
    const r = await pendingShare();
    await expect(run(r)).resolves.toEqual({ outcome: 'skipped' });
    expect((await token(r.tokenId)).status).toBe('created');
  });
});

describe('fill-inquiry (C234.11)', () => {
  it('clones onto the reserved inquiry without moving it, and redeems', async () => {
    const r = await pendingShare({ fill: true });
    await db.transaction((tx) =>
      requestFillInquiryRedemptionInTx(
        tx,
        {
          deps: api.deps,
          caller: { ...r.destination, environmentKind: 'sandbox' },
          actor: { type: 'api-key', id: 'key_01M5CN0000000000000011A351' },
          request: {
            'share-token-id': r.tokenId,
            'inquiry-id': r.reservedInquiryId,
            'destination-consent-record-id': r.destinationRecordId,
          },
          now: NOW,
        },
        port,
      ),
    );
    await expect(run(r)).resolves.toEqual({ outcome: 'redeemed' });
    const inquiry = must(await getInquiry(db, r.destination.environmentId, r.reservedInquiryId));
    expect(inquiry.status).toBe('created');
    const [copied] = await listInquiryVerifications(db, r.destination.environmentId, inquiry.id);
    expect(copied?.provenance).toMatchObject({ kind: 'connect-clone' });
    expect((await token(r.tokenId)).destination_id).toBe(inquiry.id);
  });
});
