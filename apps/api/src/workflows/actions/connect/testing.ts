/**
 * Test support for Connect's workflow steps (`workflow-connect`): a share as the services find it,
 * written through the repositories on any database (PGlite for the unit suite, Postgres for the
 * integration suite). A source organisation and a destination that turned on `connect-inbound`, each
 * with an environment of the same kind; an `active` connection between them under the golden share
 * policy; a source inquiry with a passed government ID; and the source-side consent record a token
 * cites. Only tests import this file. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { newId } from '@openverify/contracts';
import {
  consentRecords,
  createConnection,
  createVerification,
  replaceVerificationChecks,
  setOrganizationConnectInbound,
  setVerificationStatus,
  updateConnection,
  type Db,
} from '@openverify/db';
import { createTestInquiry, createTestTenant } from '@openverify/db/testing';
import { createShareTokenInTx } from '../../../services/connect/share-tokens.js';

export const SHARE_POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** Every category, so a consent covers whatever the share carries. */
export const ALL_SHARE_CATEGORIES = [
  'identity-fields',
  'contact-fields',
  'other-fields',
  'document-images',
  'biometric',
  'check-results',
];

const DAY_MS = 86_400_000;

export const CONNECT_GRANT = {
  scopes: [
    'inquiries:read',
    'connect-share-tokens:read',
    'connect-share-tokens:write',
    'connect-share-tokens:redeem',
  ],
  pii: false,
} as const;

export interface ShareSide {
  organizationId: string;
  environmentId: string;
}

export interface SeededShare {
  source: ShareSide;
  destination: ShareSide;
  connectionId: string;
  inquiryId: string;
  verificationId: string;
}

/**
 * A source (`source`, or a new tenant) and a destination (`destination`, or a new tenant), both
 * opted in, and an `active` connection from the one to the other.
 */
export async function seedShare(
  db: Db,
  options: { source?: ShareSide; destination?: ShareSide; now?: Date } = {},
): Promise<SeededShare> {
  const now = options.now ?? new Date();
  const tenantOf = async (side: ShareSide | undefined): Promise<ShareSide> => {
    if (side !== undefined) {
      return side;
    }
    const tenant = await createTestTenant(db, {
      kind: 'sandbox',
      organizationName: 'Example Partner',
    });
    return { organizationId: tenant.organization.id, environmentId: tenant.environment.id };
  };
  const source = await tenantOf(options.source);
  const destination = await tenantOf(options.destination);
  await setOrganizationConnectInbound(db, destination.organizationId, true);
  const connectionId = newId('cxn');
  const { policy } = await createConnection(db, {
    id: connectionId,
    sourceOrganizationId: source.organizationId,
    destinationOrganizationId: destination.organizationId,
    creatorType: 'api-key',
    creatorId: newId('key'),
    policyId: newId('cxnp'),
    policy: SHARE_POLICY,
  });
  await updateConnection(db, connectionId, {
    status: 'active',
    acceptedPolicyId: policy.id,
    activatedAt: now,
    updatedAt: now,
  });
  const { inquiry } = await createTestInquiry(db, source.environmentId);
  const verification = await createVerification(db, source.environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await replaceVerificationChecks(db, source.environmentId, verification.id, [
    {
      name: 'id_blur_detection',
      status: 'passed',
      type: 'user_behavior',
      requirement: 'required',
      reasons: [],
      metadata: {},
    },
  ]);
  await setVerificationStatus(db, source.environmentId, verification.id, { to: 'passed' });
  return {
    source,
    destination,
    connectionId,
    inquiryId: inquiry.id,
    verificationId: verification.id,
  };
}

/**
 * A consent record: the source's `flow` record about the shared inquiry, or with `side:
 * 'destination'` the destination's record of a token (C234.1: its `share-token-id`, the
 * destination's organisation as recipient).
 */
export async function seedConsent(
  db: Db,
  share: SeededShare,
  options: {
    side?: 'source' | 'destination';
    shareTokenId?: string;
    now?: Date;
    overrides?: Partial<typeof consentRecords.$inferInsert>;
  } = {},
): Promise<string> {
  const id = newId('cnsr');
  const now = options.now ?? new Date();
  const destination = options.side === 'destination';
  await db.insert(consentRecords).values({
    environmentId: destination ? share.destination.environmentId : share.source.environmentId,
    id,
    side: destination ? 'destination' : 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: destination ? 'share-token' : 'inquiry',
    subjectId: destination ? (options.shareTokenId ?? null) : share.inquiryId,
    connectionId: share.connectionId,
    shareTokenId: destination ? (options.shareTokenId ?? null) : null,
    recipientOrganizationId: share.destination.organizationId,
    recipientName: 'Example Partner',
    dataCategories: ALL_SHARE_CATEGORIES,
    explicitBiometric: true,
    textLocale: 'en',
    textKeys: [destination ? 'share.consent.destination' : 'share.consent.source'],
    textSha256: 'a'.repeat(64),
    method: 'flow',
    acceptedAt: now,
    expiresAt: new Date(now.getTime() + 30 * DAY_MS),
    ...options.overrides,
  });
  return id;
}

/**
 * A `created` token of `share`, made by an API key of the source through `api-connect`'s service,
 * citing a new source consent record: what a step finds to expire or redeem.
 */
export async function createTokenAsKey(
  db: Db,
  deps: Parameters<typeof createShareTokenInTx>[0],
  share: SeededShare,
  now: Date = new Date(),
): Promise<string> {
  const consentRecordId = await seedConsent(db, share, { now });
  const { document } = await db.transaction((tx) =>
    createShareTokenInTx(
      deps,
      tx,
      {
        ctx: {
          organizationId: share.source.organizationId,
          environmentId: share.source.environmentId,
        },
        actor: { type: 'api-key', id: newId('key') },
        environmentKind: 'sandbox',
      },
      {
        'connection-id': share.connectionId,
        'source-id': share.inquiryId,
        'consent-record-id': consentRecordId,
      },
      now,
    ),
  );
  return document.data.id;
}
