/**
 * Test support for `api-consent`'s suites (Workflow 11A): Connect rows written with SQL, as
 * `api-connect`'s create and `api-redeem`'s job write them, so the consent suites do not depend on
 * those routes. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { sql } from 'drizzle-orm';

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows;

/** A share policy body that shares every category, with biometric on (the contracts' rules). */
export const FULL_POLICY = Object.freeze({
  purpose: 'share.reuse-kyc',
  'source-types': ['inquiry', 'account', 'transaction', 'verification'],
  verifications: {
    types: ['government-id', 'selfie', 'database', 'document', 'email-address', 'phone-number'],
    'extracted-data': true,
    'check-results': true,
    files: true,
  },
  fields: { inquiry: ['name-first', 'email-address'], account: [], transaction: [] },
  biometric: true,
  peek: {},
  'attested-consent': 'all',
});

/** A connection (with its policy version 1) from one organisation to another, in `status`. */
export async function seedConnection(
  db: Db,
  input: {
    sourceOrganizationId: string;
    destinationOrganizationId: string;
    status?: 'pending' | 'active' | 'inactive';
    policy?: Record<string, unknown>;
  },
): Promise<{ id: string; policyId: string }> {
  const id = newId('cxn');
  const policyId = newId('cxnp');
  await db.execute(sql`
    insert into connect_connections (id, source_organization_id, destination_organization_id,
      status, creator_type, creator_id, activated_at)
    values (${id}, ${input.sourceOrganizationId}, ${input.destinationOrganizationId},
      ${input.status ?? 'active'}, 'api-key', ${newId('key')},
      ${input.status === 'pending' ? null : new Date('2026-11-01T00:00:00.000Z')})`);
  await db.execute(sql`
    insert into connect_share_policies (id, connection_id, version, body, created_by_type,
      created_by_id)
    values (${policyId}, ${id}, 1, ${JSON.stringify(input.policy ?? FULL_POLICY)}::jsonb, 'api-key',
      ${newId('key')})`);
  await db.execute(sql`
    update connect_connections set current_policy_id = ${policyId},
      accepted_policy_id = ${input.status === 'pending' ? null : policyId}
    where id = ${id}`);
  return { id, policyId };
}

/** A share token in the source environment, citing `consentRecordId`, in `status`. */
export async function seedShareToken(
  db: Db,
  input: {
    sourceEnvironmentId: string;
    destinationEnvironmentId: string;
    connection: { id: string; policyId: string };
    consentRecordId: string;
    sourceType?: 'inquiry' | 'account' | 'transaction' | 'verification';
    sourceId?: string;
    status?: 'created' | 'pending' | 'redeemed' | 'expired' | 'failed';
    categories?: readonly string[];
    reservedInquiryId?: string | null;
    destinationConsentRecordId?: string | null;
    expiresAt?: Date;
  },
): Promise<string> {
  const id = newId('cnst');
  const status = input.status ?? 'created';
  const at = new Date('2026-11-02T00:00:00.000Z');
  await db.execute(sql`
    insert into connect_share_tokens (environment_id, id, connection_id, policy_id,
      environment_kind, destination_environment_id, source_type, source_id, consent_record_id,
      data_categories, status, creator_type, creator_id, expires_at, pending_at, redeemed_at,
      expired_at, expiry_reason, failed_at, failure_reason, reserved_inquiry_id,
      destination_consent_record_id, redeem_mode)
    values (${input.sourceEnvironmentId}, ${id}, ${input.connection.id},
      ${input.connection.policyId}, 'sandbox', ${input.destinationEnvironmentId},
      ${input.sourceType ?? 'inquiry'}, ${input.sourceId ?? newId('inq')},
      ${input.consentRecordId},
      ${`{${(input.categories ?? ['identity-fields', 'check-results']).join(',')}}`}::text[],
      ${status}, 'api-key', ${newId('key')},
      ${input.expiresAt ?? new Date('2026-12-01T00:00:00.000Z')},
      ${status === 'pending' || status === 'redeemed' ? at : null},
      ${status === 'redeemed' ? at : null},
      ${status === 'expired' ? at : null}, ${status === 'expired' ? 'time' : null},
      ${status === 'failed' ? at : null}, ${status === 'failed' ? 'import_failed' : null},
      ${input.reservedInquiryId ?? null}, ${input.destinationConsentRecordId ?? null},
      ${status === 'pending' || status === 'redeemed' ? 'clone' : null})`);
  return id;
}

/** A share token's status and reasons, read back. */
export async function shareTokenRow(
  db: Db,
  id: string,
): Promise<{ status: string; expiry_reason: string | null; failure_reason: string | null }> {
  const [row] = rowsOf<{
    status: string;
    expiry_reason: string | null;
    failure_reason: string | null;
  }>(
    await db.execute(
      sql`select status, expiry_reason, failure_reason from connect_share_tokens where id = ${id}`,
    ),
  );
  if (row === undefined) {
    throw new Error(`no share token ${id}`);
  }
  return row;
}
