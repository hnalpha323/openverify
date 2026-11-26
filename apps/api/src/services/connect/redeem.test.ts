/**
 * C234.1 (Workflow 11A, `api-redeem` checkpoint 1): the synchronous part of a redemption, as the
 * destination. Each refusal in its order with its problem; on success the token is `pending` with
 * its mode, destination and destination consent record, the request is audited in the destination's
 * environment with ids and keys only, and the answer names the `connect-redeem` job.
 *
 * The destination's change of the inbound token is `cross-tenant.ts`'s to write; until it has that
 * entry point (`markInboundShareToken`, a contract deviation), this suite passes a port whose
 * `markInboundShareToken` writes the row with SQL, as the entry point will, and every other member
 * is the production binding. Rows are synthetic (rule 9).
 */
import { newId, type RedeemShareTokenBody } from '@openverify/contracts';
import { listAuditLogs, type Db } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { createTestApi, type TestApi } from '../../test-support/harness.js';
import { seedConnection, seedShareToken } from './consent.test-support.js';
import { ConnectProblemError } from './problems.js';
import {
  REDEEM_REQUESTED_ACTION,
  redeemShareTokenInTx,
  redemptionCrossTenant,
  type RedeemCaller,
  type RedemptionCrossTenant,
} from './redeem.js';

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

/** The port of the suite: the production binding, with the inbound token write in SQL. */
const testRedemptionPort: RedemptionCrossTenant = {
  ...redemptionCrossTenant,
  async markInboundShareToken(tx, caller, token, changes) {
    const columns: Record<string, string> = {
      status: 'status',
      pendingAt: 'pending_at',
      redeemedAt: 'redeemed_at',
      failedAt: 'failed_at',
      failureReason: 'failure_reason',
      redeemMode: 'redeem_mode',
      destinationType: 'destination_type',
      destinationId: 'destination_id',
      destinationConsentRecordId: 'destination_consent_record_id',
      redeemSummary: 'redeem_summary',
      updatedAt: 'updated_at',
    };
    const sets = Object.entries(changes).map(([key, value]) =>
      key === 'redeemSummary'
        ? sql`${sql.raw(columns[key] ?? key)} = ${JSON.stringify(value)}::jsonb`
        : sql`${sql.raw(columns[key] ?? key)} = ${value instanceof Date ? value.toISOString() : value}`,
    );
    await tx.execute(sql`update connect_share_tokens set ${sql.join(sets, sql`, `)}
      where id = ${token.id} and destination_environment_id = ${caller.environmentId}`);
    return redemptionCrossTenant.getInboundShareToken(tx, caller, token.id);
  },
};

interface Share {
  source: { organizationId: string; environmentId: string };
  destination: { organizationId: string; environmentId: string };
  connection: { id: string; policyId: string };
  tokenId: string;
  destinationRecordId: string;
  templateId: string;
}

async function consentRecord(
  environmentId: string,
  input: {
    side: 'source' | 'destination';
    connectionId: string;
    recipientOrganizationId: string;
    shareTokenId?: string | null;
    subject?: { type: string; id: string } | null;
    categories?: readonly string[];
    outcome?: 'accepted' | 'declined';
    expiresAt?: Date;
  },
): Promise<string> {
  const id = newId('cnsr');
  const subject = input.subject ?? null;
  await db.execute(sql`
    insert into consent_records (environment_id, id, side, outcome, purpose, subject_type, subject_id,
      connection_id, share_token_id, recipient_organization_id, recipient_name, data_categories,
      explicit_biometric, text_locale, text_keys, text_sha256, method, accepted_at, expires_at)
    values (${environmentId}, ${id}, ${input.side}, ${input.outcome ?? 'accepted'},
      'share.reuse-kyc', ${subject?.type ?? null}, ${subject?.id ?? null}, ${input.connectionId},
      ${input.shareTokenId ?? null}, ${input.recipientOrganizationId}, 'Example Partner',
      ${`{${(input.categories ?? ['identity-fields', 'check-results']).join(',')}}`}::text[], false,
      'en', '{share.consent.destination}'::text[], ${'a'.repeat(64)}, 'flow',
      ${new Date('2026-11-01T00:00:00.000Z')},
      ${input.expiresAt ?? new Date('2026-12-31T00:00:00.000Z')})`);
  return id;
}

async function share(
  options: {
    status?: 'created' | 'pending' | 'redeemed' | 'expired' | 'failed';
    connection?: 'active' | 'inactive';
    sourceType?: 'inquiry' | 'account' | 'verification';
    expiresAt?: Date;
    reservedDecline?: boolean;
  } = {},
): Promise<Share> {
  const source = await api.newTenant();
  const destination = await api.newTenant();
  const connection = await seedConnection(db, {
    sourceOrganizationId: source.organizationId,
    destinationOrganizationId: destination.organizationId,
    status: options.connection ?? 'active',
  });
  const sourceRecordId = await consentRecord(source.environmentId, {
    side: 'source',
    connectionId: connection.id,
    recipientOrganizationId: destination.organizationId,
    subject: { type: 'inquiry', id: newId('inq') },
  });
  const { inquiry, template } = await createTestInquiry(db, destination.environmentId);
  const tokenId = await seedShareToken(db, {
    sourceEnvironmentId: source.environmentId,
    destinationEnvironmentId: destination.environmentId,
    connection,
    consentRecordId: sourceRecordId,
    sourceType: options.sourceType ?? 'inquiry',
    ...(options.sourceType === 'account' ? { sourceId: newId('acc') } : {}),
    ...(options.sourceType === 'verification' ? { sourceId: newId('ver') } : {}),
    status: options.status ?? 'created',
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
    reservedInquiryId: options.reservedDecline === true ? inquiry.id : null,
  });
  if (options.reservedDecline === true) {
    await consentRecord(destination.environmentId, {
      side: 'destination',
      connectionId: connection.id,
      recipientOrganizationId: destination.organizationId,
      shareTokenId: tokenId,
      subject: { type: 'inquiry', id: inquiry.id },
      outcome: 'declined',
    });
  }
  const destinationRecordId = await consentRecord(destination.environmentId, {
    side: 'destination',
    connectionId: connection.id,
    recipientOrganizationId: destination.organizationId,
    shareTokenId: tokenId,
    subject: { type: 'share-token', id: tokenId },
  });
  return {
    source: { organizationId: source.organizationId, environmentId: source.environmentId },
    destination: {
      organizationId: destination.organizationId,
      environmentId: destination.environmentId,
    },
    connection,
    tokenId,
    destinationRecordId,
    templateId: template.id,
  };
}

const callerFor = (environment: {
  organizationId: string;
  environmentId: string;
}): RedeemCaller => ({
  deps: api.deps,
  acting: {
    ctx: {
      organizationId: environment.organizationId,
      environmentId: environment.environmentId,
    },
    actor: { type: 'api-key', id: 'key_01M5CN0000000000000011A340' },
    mask: UNMASKED,
    environmentKind: 'sandbox',
  },
  now: new Date('2026-11-12T10:00:00.000Z'),
});

const cloneBody = (s: Share, meta: Record<string, unknown> = {}): RedeemShareTokenBody => ({
  meta: {
    'inquiry-template-id': s.templateId,
    'destination-consent-record-id': s.destinationRecordId,
    ...meta,
  },
});

const redeem = (s: Share, body: RedeemShareTokenBody, caller = callerFor(s.destination)) =>
  db.transaction((tx) => redeemShareTokenInTx(tx, caller, s.tokenId, body, testRedemptionPort));

async function tokenRow(id: string) {
  const [row] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`select status, redeem_mode, destination_type, destination_id,
      destination_consent_record_id, pending_at from connect_share_tokens where id = ${id}`),
  );
  return row;
}

async function refusal(
  work: Promise<unknown>,
): Promise<{ code: string; reason?: string; pointer?: string }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ConnectProblemError) {
      const problem = error as unknown as {
        code: string;
        reason?: string;
        errors?: { pointer: string }[];
      };
      return {
        code: problem.code,
        ...(problem.reason === undefined ? {} : { reason: problem.reason }),
        ...(problem.errors?.[0] === undefined ? {} : { pointer: problem.errors[0].pointer }),
      };
    }
    const status = (error as { status?: number }).status;
    return {
      code:
        (error as { code?: string }).code ??
        (status === undefined ? (error as Error).name : `status-${String(status)}`),
    };
  }
  throw new Error('the redemption was not refused');
}

describe('a redemption’s synchronous part (C234.1)', () => {
  it('sets the token pending with its mode and destination record, audits the request, and names the job', async () => {
    const s = await share();
    const answer = await redeem(s, cloneBody(s));
    expect(answer.token).toMatchObject({
      id: s.tokenId,
      attributes: { status: 'pending', direction: 'inbound' },
    });
    expect(answer.job).toEqual({
      environmentId: s.destination.environmentId,
      shareTokenId: s.tokenId,
    });
    expect(await tokenRow(s.tokenId)).toMatchObject({
      status: 'pending',
      redeem_mode: 'clone',
      destination_type: 'inquiry',
      destination_id: null,
      destination_consent_record_id: s.destinationRecordId,
    });
    const [entry] = await listAuditLogs(db, s.destination.environmentId, {
      resourceType: 'connect-share-token',
      resourceId: s.tokenId,
    });
    expect(entry).toMatchObject({ action: REDEEM_REQUESTED_ACTION });
    expect(JSON.stringify(entry?.metadata)).toContain(s.templateId);
  });

  it('refuses members that exclude each other (422 share_redeem_meta_conflict)', async () => {
    const s = await share();
    expect(
      await refusal(
        redeem(
          s,
          cloneBody(s, { 'account-id': newId('acc'), 'auto-create-account-reference-id': 'ref' }),
        ),
      ),
    ).toMatchObject({ code: 'share_redeem_meta_conflict' });
  });

  it('answers the one 404 to another environment’s caller', async () => {
    const s = await share();
    expect(await refusal(redeem(s, cloneBody(s), callerFor(s.source)))).toEqual({
      code: 'status-404',
    });
  });

  it('refuses a clone of an account (422 share_redeem_mode_invalid)', async () => {
    const s = await share({ sourceType: 'account' });
    expect(await refusal(redeem(s, cloneBody(s)))).toMatchObject({
      code: 'share_redeem_mode_invalid',
    });
  });

  it('refuses on an inactive connection (409 connection_not_active)', async () => {
    const s = await share({ connection: 'inactive' });
    expect(await refusal(redeem(s, cloneBody(s)))).toMatchObject({ code: 'connection_not_active' });
  });

  it.each([
    ['pending', 'share_token_already_redeemed'],
    ['redeemed', 'share_token_already_redeemed'],
    ['expired', 'share_token_expired'],
    ['failed', 'share_token_not_redeemable'],
  ] as const)('refuses a %s token (409 %s)', async (status, code) => {
    const s = await share({ status });
    expect(await refusal(redeem(s, cloneBody(s)))).toMatchObject({ code });
  });

  it('refuses a created token past its expiry the sweep has not reached (409 share_token_expired)', async () => {
    const s = await share({ expiresAt: new Date('2026-11-12T09:59:59.000Z') });
    expect(await refusal(redeem(s, cloneBody(s)))).toMatchObject({ code: 'share_token_expired' });
  });

  it('refuses a missing template with its pointer (422 destination_not_found)', async () => {
    const s = await share();
    expect(
      await refusal(redeem(s, cloneBody(s, { 'inquiry-template-id': newId('itmpl') }))),
    ).toEqual({ code: 'destination_not_found', pointer: '/meta/inquiry-template-id' });
  });

  it('refuses a clone of a verification onto an inquiry that is not open (409)', async () => {
    const s = await share({ sourceType: 'verification' });
    const { inquiry } = await createTestInquiry(db, s.destination.environmentId);
    await db.execute(sql`update inquiries set status = 'completed' where id = ${inquiry.id}`);
    expect(
      await refusal(
        redeem(s, {
          meta: {
            'inquiry-id': inquiry.id,
            'destination-consent-record-id': s.destinationRecordId,
          },
        }),
      ),
    ).toMatchObject({ code: 'destination_inquiry_not_open' });
  });

  it('refuses without a covering destination consent record (422 consent_required with its reason)', async () => {
    const s = await share();
    expect(
      await refusal(redeem(s, cloneBody(s, { 'destination-consent-record-id': newId('cnsr') }))),
    ).toMatchObject({ code: 'consent_required', reason: 'missing' });
    const other = await consentRecord(s.destination.environmentId, {
      side: 'destination',
      connectionId: s.connection.id,
      recipientOrganizationId: s.destination.organizationId,
      shareTokenId: newId('cnst'),
      subject: { type: 'share-token', id: newId('cnst') },
    });
    expect(
      await refusal(redeem(s, cloneBody(s, { 'destination-consent-record-id': other }))),
    ).toMatchObject({ code: 'consent_required', reason: 'subject' });
    const narrow = await consentRecord(s.destination.environmentId, {
      side: 'destination',
      connectionId: s.connection.id,
      recipientOrganizationId: s.destination.organizationId,
      shareTokenId: s.tokenId,
      subject: { type: 'share-token', id: s.tokenId },
      categories: ['identity-fields'],
    });
    expect(
      await refusal(redeem(s, cloneBody(s, { 'destination-consent-record-id': narrow }))),
    ).toMatchObject({ code: 'consent_required', reason: 'categories' });
    expect((await tokenRow(s.tokenId))?.status).toBe('created');
  });

  it('refuses a token whose reserved inquiry recorded a decline (409 consent_declined_in_flow)', async () => {
    const s = await share({ reservedDecline: true });
    expect(await refusal(redeem(s, cloneBody(s)))).toMatchObject({
      code: 'consent_declined_in_flow',
    });
  });
});
