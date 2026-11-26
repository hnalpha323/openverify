import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  inquirySessions,
  networks,
  sessionDevices,
  type ConsentRecord,
  type InquirySession,
  type InquirySessionRow,
  type InquirySessionStatus,
  type NetworkLocation,
} from '../schema.js';
import { openJson, openOptional, sealOptional } from '../sealed.js';
import { DEFAULT_SWEEP_LIMIT, type SweepOptions } from './sweeps.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted, type OneOrMany } from './rows.js';

/**
 * Opens the first flow call's IP and user agent, and the IP location of its network facts (C91.1),
 * and drops the ciphertexts.
 */
export function toInquirySession(row: InquirySessionRow): InquirySession {
  const { ipSealed, userAgentSealed, locationSealed, ...session } = row;
  return {
    ...session,
    ip: openOptional(SEALED.inquirySessionIp, row.id, ipSealed),
    userAgent: openOptional(SEALED.inquirySessionUserAgent, row.id, userAgentSealed),
    location:
      locationSealed === null
        ? null
        : (openJson(SEALED.inquirySessionLocation, row.id, locationSealed) as NetworkLocation),
  };
}

const sessionOrNull = (rows: InquirySessionRow[]): InquirySession | null => {
  const row = firstOrNull(rows);
  return row === null ? null : toInquirySession(row);
};

export interface NewInquirySessionInput {
  id: string;
  inquiryId: string;
  /** `hashSessionToken(token)` of the `ovs_...` token. */
  tokenHash: string;
  /** C1: 24 hours after creation. */
  expiresAt: Date;
}

export async function createInquirySession(
  db: Db,
  environmentId: string,
  input: NewInquirySessionInput,
): Promise<InquirySession> {
  const rows = await db
    .insert(inquirySessions)
    .values({
      id: input.id,
      environmentId,
      inquiryId: input.inquiryId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    })
    .returning();
  return toInquirySession(inserted(rows, 'createInquirySession'));
}

/**
 * The flow auth lookup (C3): an unexpired, unrevoked session by token hash, across
 * environments, because the session is what tells us the environment.
 */
export async function findActiveInquirySessionByTokenHash(
  db: Db,
  tokenHash: string,
  now: Date = new Date(),
): Promise<InquirySession | null> {
  return sessionOrNull(
    await db
      .select()
      .from(inquirySessions)
      .where(
        and(
          eq(inquirySessions.tokenHash, tokenHash),
          eq(inquirySessions.status, 'active'),
          isNull(inquirySessions.revokedAt),
          gt(inquirySessions.expiresAt, now),
        ),
      )
      .limit(1),
  );
}

/** Stores the consent record (C3 `POST /flow/consent`) on an unrevoked session. */
export async function recordInquirySessionConsent(
  db: Db,
  environmentId: string,
  id: string,
  consent: ConsentRecord,
): Promise<InquirySession | null> {
  return sessionOrNull(
    await db
      .update(inquirySessions)
      .set({ consent })
      .where(
        and(
          eq(inquirySessions.id, id),
          eq(inquirySessions.environmentId, environmentId),
          isNull(inquirySessions.revokedAt),
        ),
      )
      .returning(),
  );
}

/** The most recently accepted consent across all sessions of an inquiry. */
export async function getLatestInquiryConsent(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<ConsentRecord | null> {
  const row = firstOrNull(
    await db
      .select({ consent: inquirySessions.consent })
      .from(inquirySessions)
      .where(
        and(
          eq(inquirySessions.environmentId, environmentId),
          eq(inquirySessions.inquiryId, inquiryId),
          isNotNull(inquirySessions.consent),
        ),
      )
      .orderBy(desc(sql`${inquirySessions.consent} ->> 'accepted_at'`))
      .limit(1),
  );
  return row?.consent ?? null;
}

/**
 * C94.6 (Workflow 7A, V03): who a consent gate asks about: the inquiry, and the flow session that
 * acts (the session of the flow call, or the session that created the selfie capture); `null` for
 * an act no flow session made (a server-created attempt, a row from before Phase 7).
 */
export interface ConsentHolder {
  environmentId: string;
  inquiryId: string;
  sessionId: string | null;
}

/**
 * C94.6 (V03, P01): the consent every gate reads, instead of the inquiry-level read. For a session
 * a handoff created, its own consent, or `null` (also once the issuing session rejected it: a
 * rejected phone's consent authorises nothing). For any other holder, the latest consent among the
 * inquiry's sessions, leaving out rejected handoff sessions. Until a handoff session exists this is
 * {@link getLatestInquiryConsent}.
 */
export async function getEffectiveConsent(
  db: Db,
  holder: ConsentHolder,
): Promise<ConsentRecord | null> {
  const { environmentId, inquiryId, sessionId } = holder;
  if (sessionId !== null) {
    const acting = firstOrNull(
      await db
        .select({
          consent: inquirySessions.consent,
          fromSessionId: inquirySessions.handoffFromSessionId,
          rejectedAt: inquirySessions.handoffRejectedAt,
        })
        .from(inquirySessions)
        .where(
          and(
            eq(inquirySessions.environmentId, environmentId),
            eq(inquirySessions.inquiryId, inquiryId),
            eq(inquirySessions.id, sessionId),
          ),
        )
        .limit(1),
    );
    if (acting !== null && acting.fromSessionId !== null) {
      return acting.rejectedAt === null ? acting.consent : null;
    }
  }
  const row = firstOrNull(
    await db
      .select({ consent: inquirySessions.consent })
      .from(inquirySessions)
      .where(
        and(
          eq(inquirySessions.environmentId, environmentId),
          eq(inquirySessions.inquiryId, inquiryId),
          isNotNull(inquirySessions.consent),
          or(
            isNull(inquirySessions.handoffFromSessionId),
            isNull(inquirySessions.handoffRejectedAt),
          ),
        ),
      )
      .orderBy(desc(sql`${inquirySessions.consent} ->> 'accepted_at'`))
      .limit(1),
  );
  return row?.consent ?? null;
}

/**
 * Revokes every open session of an inquiry, e.g. once it is finished: they become
 * `canceled` (C10). Returns the count.
 */
export async function revokeInquirySessions(
  db: Db,
  environmentId: string,
  inquiryId: string,
  at: Date = new Date(),
): Promise<number> {
  const rows = await db
    .update(inquirySessions)
    .set({
      revokedAt: at,
      status: sql`case when ${inquirySessions.status} = 'active' then 'canceled'::inquiry_session_status else ${inquirySessions.status} end`,
      canceledAt: sql`case when ${inquirySessions.status} = 'active' then ${at.toISOString()}::timestamptz else ${inquirySessions.canceledAt} end`,
    })
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        eq(inquirySessions.inquiryId, inquiryId),
        isNull(inquirySessions.revokedAt),
      ),
    )
    .returning({ id: inquirySessions.id });
  return rows.length;
}

const sessionCursor = environmentCursor(inquirySessions);
const inEnvironment = (environmentId: string, id: string) =>
  and(eq(inquirySessions.id, id), eq(inquirySessions.environmentId, environmentId));

export interface ListInquirySessionsOptions extends PageRequest {
  /** C10 `filter[inquiry-id]`. */
  inquiryId?: OneOrMany<string> | undefined;
  status?: OneOrMany<InquirySessionStatus> | undefined;
}

export interface SessionStart {
  /** Defaults to now. */
  at?: Date;
  /** The first flow call's client IP; sealed for the row. */
  ip?: string | null;
  /** The first flow call's user agent; sealed for the row. */
  userAgent?: string | null;
}

/** A session past its TTL that is still `active` (C10 expiry sweep). */
export interface OverdueInquirySession {
  id: string;
  environmentId: string;
  inquiryId: string;
  expiresAt: Date;
}

/**
 * The flow auth lookup in any status, across environments, so the API can answer an
 * expired or canceled token with its C10 `session_expired` / `session_canceled` code.
 */
export async function findInquirySessionByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<InquirySession | null> {
  return sessionOrNull(
    await db
      .select()
      .from(inquirySessions)
      .where(eq(inquirySessions.tokenHash, tokenHash))
      .limit(1),
  );
}

/**
 * The C10 status a session has now: `canceled` and `expired` as stored, and `expired` too
 * once its TTL has passed, before the sweep has marked it.
 */
export function inquirySessionState(
  session: Pick<InquirySession, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): InquirySessionStatus {
  if (session.status !== 'active') {
    return session.status;
  }
  return session.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
}

export async function getInquirySession(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquirySession | null> {
  return sessionOrNull(
    await db.select().from(inquirySessions).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/** C10 `GET /inquiry-sessions`: newest first, by inquiry and status. */
export async function listInquirySessions(
  db: Db,
  environmentId: string,
  options: ListInquirySessionsOptions = {},
): Promise<Page<InquirySession>> {
  const filters = allFilters([
    eq(inquirySessions.environmentId, environmentId),
    equalsAny(inquirySessions.inquiryId, options.inquiryId),
    equalsAny(inquirySessions.status, options.status),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, sessionCursor, environmentId, options, async (after, limit) =>
    (
      await db
        .select()
        .from(inquirySessions)
        .where(and(...filters, after))
        .orderBy(...newestFirst(sessionCursor))
        .limit(limit)
    ).map(toInquirySession),
  );
}

/**
 * Records the first successful flow call (C10 `inquiry-session.started`) with its IP and
 * user agent, sealed for the row. Only the first call wins: later ones, and a session that
 * is not here, get `null`, so the event is emitted once.
 */
export async function markInquirySessionStarted(
  db: Db,
  environmentId: string,
  id: string,
  start: SessionStart,
): Promise<InquirySession | null> {
  return sessionOrNull(
    await db
      .update(inquirySessions)
      .set({
        startedAt: start.at ?? sql`now()`,
        ipSealed: sealOptional(SEALED.inquirySessionIp, id, start.ip),
        userAgentSealed: sealOptional(SEALED.inquirySessionUserAgent, id, start.userAgent),
      })
      .where(and(inEnvironment(environmentId, id), isNull(inquirySessions.startedAt)))
      .returning(),
  );
}

async function endActiveSessions(
  db: Db,
  environmentId: string,
  where: ReturnType<typeof and>,
  status: 'expired' | 'canceled',
  at: Date,
): Promise<InquirySession[]> {
  const rows = await db
    .update(inquirySessions)
    .set(
      status === 'expired'
        ? { status, expiredAt: at, revokedAt: at }
        : { status, canceledAt: at, revokedAt: at },
    )
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        eq(inquirySessions.status, 'active'),
        where,
      ),
    )
    .returning();
  return rows.map(toInquirySession);
}

/** C10 `POST /inquiry-sessions/:id/expire`; `null` unless the session was active here. */
export async function expireInquirySession(
  db: Db,
  environmentId: string,
  id: string,
  at: Date = new Date(),
): Promise<InquirySession | null> {
  const [session] = await endActiveSessions(
    db,
    environmentId,
    eq(inquirySessions.id, id),
    'expired',
    at,
  );
  return session ?? null;
}

/** C10 `POST /inquiry-sessions/expire-all`: the inquiry's active sessions, now expired. */
export async function expireInquirySessions(
  db: Db,
  environmentId: string,
  inquiryId: string,
  at: Date = new Date(),
): Promise<InquirySession[]> {
  return endActiveSessions(
    db,
    environmentId,
    eq(inquirySessions.inquiryId, inquiryId),
    'expired',
    at,
  );
}

/**
 * C10 `inquiry-session.canceled`: when the inquiry leaves `created` or `pending`, its
 * active sessions are canceled. Returns them.
 */
export async function cancelInquirySessions(
  db: Db,
  environmentId: string,
  inquiryId: string,
  at: Date = new Date(),
): Promise<InquirySession[]> {
  return endActiveSessions(
    db,
    environmentId,
    eq(inquirySessions.inquiryId, inquiryId),
    'canceled',
    at,
  );
}

/**
 * The C10 session sweep: `active` sessions past their TTL, oldest first, across
 * environments. With `lock`, rows are taken `FOR UPDATE SKIP LOCKED` inside the caller's
 * transaction.
 */
export async function listOverdueInquirySessions(
  db: Db,
  options: SweepOptions = {},
): Promise<OverdueInquirySession[]> {
  const query = db
    .select({
      id: inquirySessions.id,
      environmentId: inquirySessions.environmentId,
      inquiryId: inquirySessions.inquiryId,
      expiresAt: inquirySessions.expiresAt,
    })
    .from(inquirySessions)
    .where(
      and(
        eq(inquirySessions.status, 'active'),
        lte(inquirySessions.expiresAt, options.now ?? new Date()),
      ),
    )
    .orderBy(asc(inquirySessions.expiresAt), asc(inquirySessions.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
  return options.lock === true ? query.for('update', { skipLocked: true }) : query;
}

/** C91.1 (Workflow 7A): the ids a session's relationships name, `null` without one. */
export interface SessionLinks {
  networkId: string | null;
  deviceId: string | null;
}

/**
 * C91.1, C91.2, C91.3: the `network` and `device` of each of `sessionIds`, in one query; a session
 * of another environment or without either reads `null` for it.
 */
export async function listSessionLinks(
  db: Db,
  environmentId: string,
  sessionIds: readonly string[],
): Promise<Map<string, SessionLinks>> {
  const links = new Map<string, SessionLinks>(
    sessionIds.map((id) => [id, { networkId: null, deviceId: null }]),
  );
  if (sessionIds.length === 0) {
    return links;
  }
  const rows = await db
    .select({
      sessionId: inquirySessions.id,
      networkId: networks.id,
      deviceId: sessionDevices.deviceId,
    })
    .from(inquirySessions)
    .leftJoin(
      networks,
      and(
        eq(networks.environmentId, inquirySessions.environmentId),
        eq(networks.inquirySessionId, inquirySessions.id),
      ),
    )
    .leftJoin(
      sessionDevices,
      and(
        eq(sessionDevices.environmentId, inquirySessions.environmentId),
        eq(sessionDevices.inquirySessionId, inquirySessions.id),
      ),
    )
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        inArray(inquirySessions.id, [...sessionIds]),
      ),
    );
  for (const row of rows) {
    links.set(row.sessionId, { networkId: row.networkId, deviceId: row.deviceId });
  }
  return links;
}
