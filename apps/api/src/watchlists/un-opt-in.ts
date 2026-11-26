/**
 * C254.1 (Phase 11, Workflow 11B, ingestion-11b; hardening H2, connect K10; Q10 granted 2026-11-21,
 * Workflow 11G records-11g, KP11-31): the UN Security Council list's opt-in.
 *
 * The UN's site terms grant non-commercial use only. The owner's answer to Q10 (ADR 0005's reading)
 * is that an environment admin may enable `un-sc` with an audited acknowledgement of those terms, so
 * the install switch `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` (`ApiConfig.watchlistUnOptInAllowed`)
 * is `true` by default in `config.ts`, `.env.example`, compose and the chart; no image bakes a value
 * and no seed opts an environment in. The switch reaches the opt-in routes (`routes/dashboard/admin.ts`),
 * every reconcile caller ({@link watchlistReconcileOptIn}) and the screening path
 * (`jobs/reports/screening.ts`, through {@link environmentMayScreenSource}). An install that sets it
 * `false` locks the list. While it is false:
 * - every opt-in and every withdrawal answers 409 `watchlist_source_locked`, before anything is read
 *   or written, and nothing is audited;
 * - no environment may screen `un-sc` ({@link environmentMayScreenSource}), whatever a setting
 *   holds, and {@link optedInWatchlistSources} names none, so the reconcile keeps `un-sc` disabled
 *   exactly as Phase 6 left it ("cannot be enabled in this release").
 *
 * When an install sets it true, an environment admin (`settings:write` and `settings:privacy`, the
 * route's) opts the environment in with an acknowledgement naming the terms link of
 * `watchlists/sources.json` (`terms.url`) and Phase 9's step-up; the acceptance (which terms, when,
 * by whom) is stored in the environment's settings (`watchlist-un-opt-in`) and audited
 * (`watchlist-source.opt-in-accepted`, the user and time); a withdrawal clears it and is audited
 * (`.opt-in-withdrawn`). Ours: the acknowledgement records an operator's acceptance of the UN's
 * terms under ADR 0005's reading of operator-fetched data; it is not legal advice.
 */
import {
  WATCHLIST_OPT_IN_AUDIT_ACTIONS,
  WATCHLIST_OPT_IN_SOURCES,
  watchlistOptInSchema,
  type AuditActor,
  type WatchlistOptIn,
  type WatchlistOptInBody,
} from '@openverify/contracts';
import { updateEnvironmentSettings, type Db, type EnvironmentSettings } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { AppError, NotFoundError, UnprocessableContentError } from '../errors.js';
import type { AuditLogger, Clock, ServiceContext } from '../ports.js';
import { assertSteppedUp } from '../services/access/acting.js';
import { auditEntryOf } from '../services/context.js';
import { watchlistManifest, type WatchlistManifest } from './manifest.js';

/** What the opt-in writes with. */
export interface WatchlistOptInDeps {
  db: Db;
  audit: AuditLogger;
  clock: Clock;
}

/** Who opts in: the environment, the user (audited), and the session the step-up is read from. */
export interface WatchlistOptInActing {
  ctx: ServiceContext;
  actor: AuditActor;
  userId: string;
  sessionId: string | undefined;
}

/** The switch, the source and the manifest whose terms the acknowledgement must name. */
export interface WatchlistOptInRequest {
  /** `ApiConfig.watchlistUnOptInAllowed`. */
  allowed: boolean;
  sourceId: string;
  /** The committed manifest by default; tests pass their own. */
  manifest?: WatchlistManifest | undefined;
}

const OPT_IN_SOURCES: ReadonlySet<string> = new Set(WATCHLIST_OPT_IN_SOURCES);
const SETTING = 'watchlist-un-opt-in';
const RESOURCE_TYPE = 'watchlist-source';

function locked(): AppError {
  return new AppError({
    status: 409,
    code: 'watchlist_source_locked',
    detail: 'This list cannot be enabled on this installation.',
  });
}

/** The opt-in source of the request, after the lock; 404 for a source that takes no opt-in. */
function optInSourceOf(request: WatchlistOptInRequest): 'un-sc' {
  if (!OPT_IN_SOURCES.has(request.sourceId)) {
    throw new NotFoundError(`Watchlist source ${request.sourceId} takes no opt-in.`);
  }
  if (!request.allowed) {
    throw locked();
  }
  return 'un-sc';
}

/**
 * C254.1: records the environment's acceptance of the UN list's terms.
 * @throws {NotFoundError} for a source that takes no opt-in.
 * @throws {AppError} 409 `watchlist_source_locked` while the switch is false.
 * @throws {UnprocessableContentError} for an acknowledgement of other terms.
 * @throws {AccessProblemError} 403 `step_up_required` without a recent second factor.
 */
export async function acceptWatchlistOptIn(
  deps: WatchlistOptInDeps,
  acting: WatchlistOptInActing,
  request: WatchlistOptInRequest,
  body: WatchlistOptInBody,
): Promise<WatchlistOptIn> {
  const sourceId = optInSourceOf(request);
  const manifest = request.manifest ?? watchlistManifest();
  const terms = manifest.sources.find((source) => source.id === sourceId)?.terms.url;
  if (terms === undefined || body.acknowledgement['terms-url'] !== terms) {
    throw new UnprocessableContentError(
      'The acknowledgement must name the terms the sources page links for this list.',
      [
        {
          location: 'body',
          pointer: '/acknowledgement/terms-url',
          detail: 'not the terms of this list',
        },
      ],
    );
  }
  const now = deps.clock.now();
  const optIn: WatchlistOptIn = {
    'source-id': sourceId,
    'terms-url': terms,
    'accepted-at': now.toISOString(),
    'accepted-by': acting.userId,
  };
  await deps.db.transaction(async (tx) => {
    await assertSteppedUp(tx, acting.sessionId, now);
    await updateEnvironmentSettings(tx, acting.ctx.environmentId, { [SETTING]: optIn });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: WATCHLIST_OPT_IN_AUDIT_ACTIONS.accepted,
        resourceType: RESOURCE_TYPE,
        resourceId: sourceId,
        metadata: { 'source-id': sourceId, 'terms-url': terms },
      }),
    );
  });
  return optIn;
}

/**
 * C254.1: withdraws the environment's opt-in (its settings hold `null` after).
 * @throws as {@link acceptWatchlistOptIn}, but for the acknowledgement.
 */
export async function withdrawWatchlistOptIn(
  deps: WatchlistOptInDeps,
  acting: WatchlistOptInActing,
  request: WatchlistOptInRequest,
): Promise<void> {
  const sourceId = optInSourceOf(request);
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await assertSteppedUp(tx, acting.sessionId, now);
    await updateEnvironmentSettings(tx, acting.ctx.environmentId, { [SETTING]: null });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: WATCHLIST_OPT_IN_AUDIT_ACTIONS.withdrawn,
        resourceType: RESOURCE_TYPE,
        resourceId: sourceId,
        metadata: { 'source-id': sourceId },
      }),
    );
  });
}

/** The environment's recorded opt-in, or `null` (absent, withdrawn, or not a valid record). */
export function watchlistOptInOf(settings: EnvironmentSettings): WatchlistOptIn | null {
  const parsed = watchlistOptInSchema.safeParse(settings[SETTING]);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether an environment may screen against `sourceId`: any source that takes no opt-in is the
 * reconcile's and the templates' as before; an opt-in source only while the switch is true and the
 * environment holds its acceptance.
 */
export function environmentMayScreenSource(
  sourceId: string,
  settings: EnvironmentSettings,
  allowed: boolean,
): boolean {
  if (!OPT_IN_SOURCES.has(sourceId)) {
    return true;
  }
  return allowed && watchlistOptInOf(settings)?.['source-id'] === sourceId;
}

/**
 * C254.1 (Q10 granted 2026-11-21; KP11-31): what a reconcile caller spreads into its options, so
 * an opt-in source an environment accepted stays enabled while the install allows it. While it does
 * not, nothing (the options stay Phase 6's, byte for byte), and the database is not read.
 */
export async function watchlistReconcileOptIn(
  db: Db,
  allowed: boolean,
): Promise<{ optInSources?: readonly string[] }> {
  return allowed ? { optInSources: await optedInWatchlistSources(db, true) } : {};
}

/**
 * The opt-in sources at least one environment of the install accepted, for the reconcile: none
 * while the switch is false, whatever the settings hold.
 */
export async function optedInWatchlistSources(db: Db, allowed: boolean): Promise<string[]> {
  if (!allowed) {
    return [];
  }
  const result: unknown = await db.execute(
    sql`select settings -> ${SETTING} as opt_in from environments
        where jsonb_typeof(settings -> ${SETTING}) = 'object'`,
  );
  const rows = (result as { rows: { opt_in: unknown }[] }).rows;
  const accepted = new Set(
    rows.flatMap((row) => {
      const parsed = watchlistOptInSchema.safeParse(row.opt_in);
      return parsed.success ? [parsed.data['source-id']] : [];
    }),
  );
  return WATCHLIST_OPT_IN_SOURCES.filter((source) => accepted.has(source));
}
