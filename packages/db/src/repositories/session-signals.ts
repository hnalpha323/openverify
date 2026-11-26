/**
 * C94.2 (Workflow 7A): the flow signal bodies. Owner: `api-signals`; the signatures are frozen by
 * `foundation-7a` (Stage 1b (S)).
 *
 * The `integrity` and `recognition` members (and the route's bounded request facts, V13) are
 * sealed together as `components`, the `behaviour` member as `behaviour`, each bound to
 * `sessionSignalRowKey(session id, sequence)`. At most 200 bodies are stored per session (P23);
 * further ones are counted in `inquiry_sessions.signal_bodies_dropped`.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { inquirySessions, inquirySessionSignals, sessionSignalRowKey } from '../schema.js';
import { openJson, sealJson, type Sealed } from '../sealed.js';

/** C94.2 (P23): the stored bodies per session (the contracts' `FLOW_SIGNALS_MAX_BODIES_PER_SESSION`). */
export const MAX_SESSION_SIGNAL_BODIES = 200;

/** A body as `POST /flow/signals` stores it; recognition already dropped without its tier. */
export interface SessionSignalBodyWrite {
  inquirySessionId: string;
  sequence: number;
  screen: string;
  platform: 'web' | 'android';
  collectorVersion: number;
  components: Record<string, unknown> | null;
  behaviour: Record<string, unknown> | null;
  at: Date;
}

/** `stored`; `repeated` for a known `(session, sequence)`; `dropped` beyond the cap (counted). */
export type StoreSessionSignalOutcome = 'stored' | 'repeated' | 'dropped';

/** A stored body, opened. */
export interface SessionSignalBody {
  inquirySessionId: string;
  sequence: number;
  screen: string;
  platform: 'web' | 'android';
  collectorVersion: number;
  /** `null` after the component retention (C91.7) or redaction. */
  components: Record<string, unknown> | null;
  /** `null` after redaction. */
  behaviour: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * K7A-7 (owner decision 1 after Workflow 7A): the sequence a reloaded page or a later SDK launch
 * numbers its next body with: one past the session's highest stored sequence, and past the bodies
 * counted beyond the cap, whose own sequences are not kept.
 */
export async function nextSessionSignalSequence(
  db: Db,
  environmentId: string,
  sessionId: string,
): Promise<number> {
  const [row] = await db
    .select({
      next: sql<number>`(
        coalesce(
          (select max(${inquirySessionSignals.sequence}) + 1
             from ${inquirySessionSignals}
            where ${inquirySessionSignals.environmentId} = ${environmentId}
              and ${inquirySessionSignals.inquirySessionId} = ${sessionId}),
          0
        ) + ${inquirySessions.signalBodiesDropped}
      )::int`,
    })
    .from(inquirySessions)
    .where(
      and(eq(inquirySessions.environmentId, environmentId), eq(inquirySessions.id, sessionId)),
    );
  return row?.next ?? 0;
}

/**
 * C94.2: stores the body in `tx` unless its sequence is known or the session holds 200 bodies.
 */
export async function storeSessionSignalBody(
  tx: Db,
  environmentId: string,
  write: SessionSignalBodyWrite,
): Promise<StoreSessionSignalOutcome> {
  const session = and(
    eq(inquirySessions.environmentId, environmentId),
    eq(inquirySessions.id, write.inquirySessionId),
  );
  // The session's row lock serialises its bodies, so the cap holds under concurrent posts.
  const [locked] = await tx
    .select({ id: inquirySessions.id })
    .from(inquirySessions)
    .where(session)
    .for('update');
  if (locked === undefined) {
    throw new Error('The inquiry session is not in this environment.');
  }
  const ofSession = and(
    eq(inquirySessionSignals.environmentId, environmentId),
    eq(inquirySessionSignals.inquirySessionId, write.inquirySessionId),
  );
  const [stored] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      repeated: sql<boolean>`coalesce(bool_or(${inquirySessionSignals.sequence} = ${write.sequence}), false)`,
    })
    .from(inquirySessionSignals)
    .where(ofSession);
  if (stored?.repeated === true) {
    return 'repeated';
  }
  if ((stored?.count ?? 0) >= MAX_SESSION_SIGNAL_BODIES) {
    await tx
      .update(inquirySessions)
      .set({ signalBodiesDropped: sql`${inquirySessions.signalBodiesDropped} + 1` })
      .where(session);
    return 'dropped';
  }
  const key = sessionSignalRowKey(write.inquirySessionId, write.sequence);
  const inserted = await tx
    .insert(inquirySessionSignals)
    .values({
      environmentId,
      inquirySessionId: write.inquirySessionId,
      sequence: write.sequence,
      screen: write.screen,
      platform: write.platform,
      collectorVersion: write.collectorVersion,
      componentsSealed:
        write.components === null
          ? null
          : sealJson(SEALED.sessionSignalComponents, key, write.components),
      behaviourSealed:
        write.behaviour === null
          ? null
          : sealJson(SEALED.sessionSignalBehaviour, key, write.behaviour),
      createdAt: write.at,
    })
    .onConflictDoNothing()
    .returning({ id: inquirySessionSignals.id });
  return inserted.length === 0 ? 'repeated' : 'stored';
}

/**
 * C90.4: the stored bodies of `sessionIds`, opened, by session then sequence (the signals job).
 */
export async function listSessionSignalBodies(
  db: Db,
  environmentId: string,
  sessionIds: readonly string[],
): Promise<SessionSignalBody[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(inquirySessionSignals)
    .where(
      and(
        eq(inquirySessionSignals.environmentId, environmentId),
        inArray(inquirySessionSignals.inquirySessionId, [...sessionIds]),
      ),
    )
    .orderBy(asc(inquirySessionSignals.inquirySessionId), asc(inquirySessionSignals.sequence));
  return rows.map((row) => {
    const key = sessionSignalRowKey(row.inquirySessionId, row.sequence);
    const open = (column: string, sealed: Sealed | null) =>
      sealed === null ? null : (openJson(column, key, sealed) as Record<string, unknown>);
    return {
      inquirySessionId: row.inquirySessionId,
      sequence: row.sequence,
      screen: row.screen,
      platform: row.platform,
      collectorVersion: row.collectorVersion,
      components: open(SEALED.sessionSignalComponents, row.componentsSealed),
      behaviour: open(SEALED.sessionSignalBehaviour, row.behaviourSealed),
      createdAt: row.createdAt,
    };
  });
}

/**
 * C94.6: adds `tiers` to the session's `signals_collected`, keeping each tier once.
 */
export async function recordSessionSignalsCollected(
  tx: Db,
  environmentId: string,
  inquirySessionId: string,
  tiers: readonly ('session-integrity' | 'device-recognition')[],
): Promise<void> {
  if (tiers.length === 0) {
    return;
  }
  const added = sql.join(
    tiers.map((tier) => sql`${tier}`),
    sql`, `,
  );
  await tx
    .update(inquirySessions)
    .set({
      signalsCollected: sql`array(select distinct tier from unnest(${inquirySessions.signalsCollected} || array[${added}]::text[]) as tier order by tier)`,
    })
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        eq(inquirySessions.id, inquirySessionId),
      ),
    );
}

/**
 * C91.5: how many sessions the inquiry has ever had, in any status (the public cap counts expired
 * and canceled sessions too).
 */
export async function countInquirySessions(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inquirySessions)
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        eq(inquirySessions.inquiryId, inquiryId),
      ),
    );
  return row?.count ?? 0;
}
