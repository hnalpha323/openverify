/**
 * C132, C133 (Workflow 8B, `api-queues-sla`): what an assignment or an SLA change writes besides the
 * case row, wherever it runs: a request (a {@link CaseUnit}), `assignOnEntry` inside `api-cases`'
 * transaction, the status hook, or a sweep acting as the system. Each names its history actor (a
 * policy or the system have no audit actor) and where its events are staged.
 *
 * Events carry the case as it is now and no field value (`caseEventResource`, C136.4); a notification
 * names a kind and a case, never text (C134.4).
 */
import type { EventName } from '@openverify/contracts';
import type { CaseNotificationKind } from '@openverify/core';
import {
  environments,
  getCaseRow,
  users,
  type CaseHistoryActorType,
  type Db,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import type { StagedEvent, TransactionalEventPublisher } from '../../../events/index.js';
import { NotFoundError } from '../../../errors.js';
import { caseEventResource } from '../resources.js';
import { historyActor, type CaseUnit } from '../shared.js';
import { notifyByPreferencesInTx } from '../notification-channels.js';

/** One assignment or SLA change's transaction and context. */
export interface QueueWork {
  tx: Db;
  environmentId: string;
  organizationId: string;
  at: Date;
  requestId: string | null;
  /** Who the history rows name. */
  actor: { actorType: CaseHistoryActorType; actorId: string | null };
  /** Where events are staged; `null` when the caller stages them itself (on entry). */
  events: { publisher: TransactionalEventPublisher; staged: StagedEvent[] } | null;
}

/** The system acting (a sweep, the status hook): no id, no audit actor. */
export const SYSTEM_ACTOR = { actorType: 'system', actorId: null } as const;

/** The work of a request's unit, its events staged with the unit's. */
export function workOfUnit(unit: CaseUnit): QueueWork {
  return {
    tx: unit.tx,
    environmentId: unit.acting.ctx.environmentId,
    organizationId: unit.acting.ctx.organizationId,
    at: unit.at,
    requestId: unit.acting.ctx.requestId ?? null,
    actor: historyActor(unit.acting),
    events: { publisher: unit.deps.events, staged: unit.staged },
  };
}

/** The organisation of an environment. */
export async function organizationOf(db: Db, environmentId: string): Promise<string> {
  const [environment] = await db
    .select({ organizationId: environments.organizationId })
    .from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);
  if (environment === undefined) {
    throw new NotFoundError(`Environment ${environmentId} was not found.`);
  }
  return environment.organizationId;
}

/** Stages a case event in the work's transaction; nothing when the caller stages its own. */
export async function stageCaseEvent(
  work: QueueWork,
  caseId: string,
  name: EventName,
): Promise<void> {
  if (work.events === null) {
    return;
  }
  const row = await getCaseRow(work.tx, work.environmentId, caseId);
  if (row === null) {
    throw new Error(`stageCaseEvent: case ${caseId} was not found`);
  }
  work.events.staged.push(
    await work.events.publisher.stage(work.tx, {
      environmentId: work.environmentId,
      name,
      payload: { data: await caseEventResource(work.tx, work.environmentId, row) },
    }),
  );
}

/** C134.4: a notification of `kind` for `userId`, when it is a user of the organisation. */
export async function notifyUser(
  work: QueueWork,
  caseId: string,
  kind: CaseNotificationKind,
  userId: string,
): Promise<void> {
  const [user] = await work.tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, work.organizationId)))
    .limit(1);
  if (user === undefined) {
    return;
  }
  await notifyByPreferencesInTx(work.tx, work.environmentId, caseId, kind, [userId]);
}
