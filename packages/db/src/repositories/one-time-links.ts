import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { inquiries, oneTimeLinks, type OneTimeLink } from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

export interface NewOneTimeLinkInput {
  inquiryId: string;
  /** `hashSessionToken(token)` of the `ovo_...` token. */
  tokenHash: string;
  /** C9: default 24 h, at most 30 days, never past the inquiry's `expires-at` (the API). */
  expiresAt: Date;
  /** Defaults to now; the time older links are revoked at. */
  at?: Date;
}

export interface CreatedOneTimeLink {
  link: OneTimeLink;
  /** How many older unused links of the inquiry were revoked. */
  revokedCount: number;
}

export interface RedeemOneTimeLinkInput {
  inquiryId: string;
  tokenHash: string;
  /** Defaults to now. */
  now?: Date;
}

const unused = and(isNull(oneTimeLinks.usedAt), isNull(oneTimeLinks.revokedAt));

/**
 * C10 `generate-one-time-link`: stores the new link and revokes the inquiry's older unused
 * links, in one transaction.
 */
export async function createOneTimeLink(
  db: Db,
  environmentId: string,
  input: NewOneTimeLinkInput,
): Promise<CreatedOneTimeLink> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const revoked = await revokeLinks(tx, environmentId, input.inquiryId, at);
    const link = inserted(
      await tx
        .insert(oneTimeLinks)
        .values({
          environmentId,
          inquiryId: input.inquiryId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        })
        .returning(),
      'createOneTimeLink',
    );
    return { link, revokedCount: revoked };
  });
}

/**
 * C10 `POST /flow/one-time-links/redeem`: marks the link used, exactly once, and returns
 * it (its `environmentId` scopes what follows). Everything that must refuse the redeem
 * returns `null` alike, so the API can answer one generic 401: an unknown, used, revoked
 * or expired token, a token of another inquiry, and an inquiry that is no longer `created`
 * or `pending`, or is past its own expiry. Cross-environment on purpose: the token is what
 * tells the environment. Run it in the transaction that creates the session, so a failure
 * there leaves the link unused.
 */
export async function redeemOneTimeLink(
  db: Db,
  input: RedeemOneTimeLinkInput,
): Promise<OneTimeLink | null> {
  const now = input.now ?? new Date();
  return firstOrNull(
    await db
      .update(oneTimeLinks)
      .set({ usedAt: now })
      .where(
        and(
          eq(oneTimeLinks.tokenHash, input.tokenHash),
          eq(oneTimeLinks.inquiryId, input.inquiryId),
          unused,
          gt(oneTimeLinks.expiresAt, now),
          sql`exists (select 1 from ${inquiries}
            where ${inquiries.id} = ${oneTimeLinks.inquiryId}
              and ${inquiries.environmentId} = ${oneTimeLinks.environmentId}
              and ${inArray(inquiries.status, ['created', 'pending'])}
              and ${gt(inquiries.expiresAt, now)})`,
        ),
      )
      .returning(),
  );
}

async function revokeLinks(db: Db, environmentId: string, inquiryId: string, at: Date) {
  const rows = await db
    .update(oneTimeLinks)
    .set({ revokedAt: at })
    .where(
      and(
        eq(oneTimeLinks.environmentId, environmentId),
        eq(oneTimeLinks.inquiryId, inquiryId),
        unused,
      ),
    )
    .returning({ id: oneTimeLinks.id });
  return rows.length;
}

/** Revokes the inquiry's unused links, e.g. when it expires or is redacted. Returns the count. */
export async function revokeOneTimeLinks(
  db: Db,
  environmentId: string,
  inquiryId: string,
  at: Date = new Date(),
): Promise<number> {
  return revokeLinks(db, environmentId, inquiryId, at);
}
