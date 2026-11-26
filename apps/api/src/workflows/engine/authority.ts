/**
 * C121: what a run may do. A run acts on a frozen grant of API scopes, and the executor checks every
 * action against it, so a derivation bug fails closed (C121.2). An adverse step reached because of an
 * event also needs the event's causing principal to hold its scope (C121.3).
 */
import { isId } from '@openverify/contracts';
import { isApiScope, type ApiScope } from '@openverify/core';
import {
  getApiKey,
  getEventCause,
  listUserPermissions,
  type Db,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from '@openverify/db';
import type { ActionGrant } from '@openverify/workflow-engine/actions';
import type { RunGrant } from './action-port.js';

/** The grant a run row holds; anything unreadable is no grant at all. */
export function grantOf(stored: Readonly<Record<string, unknown>>): RunGrant {
  const scopes = Array.isArray(stored.scopes)
    ? (stored.scopes as unknown[]).filter(
        (scope): scope is ApiScope => typeof scope === 'string' && isApiScope(scope),
      )
    : [];
  return { scopes, pii: stored.pii === true };
}

/** What `held` lacks of `needed`; `pii:view` names the PII flag. */
export function missingFromGrant(held: RunGrant, needed: ActionGrant): string[] {
  const missing: string[] = needed.scopes.filter((scope) => !held.scopes.includes(scope));
  return needed.pii && !held.pii ? [...missing, 'pii:view'] : missing;
}

/** A principal's permissions now; one that is gone holds none, which fails closed. */
export async function principalPermissions(
  db: Db,
  run: Pick<WorkflowRunRow, 'environmentId'>,
  organizationId: string,
  principal: string,
): Promise<ReadonlySet<string>> {
  if (isId('key', principal)) {
    const key = await getApiKey(db, run.environmentId, principal);
    return new Set(key === null || key.revokedAt != null ? [] : key.scopes);
  }
  return new Set(await listUserPermissions(db, organizationId, principal));
}

/** C121.3: the run's cause, and the cause of each event that resumed a wait on it. */
export async function causingPrincipals(
  db: Db,
  run: WorkflowRunRow,
  steps: readonly WorkflowRunStepRow[],
): Promise<string[]> {
  const principals = new Set<string>();
  if (run.causedByPrincipal !== null) {
    principals.add(run.causedByPrincipal);
  }
  for (const { resolvedByEventId: eventId } of steps) {
    if (eventId !== null) {
      const event = await getEventCause(db, run.environmentId, eventId);
      if (event?.causedByPrincipal != null) {
        principals.add(event.causedByPrincipal);
      }
    }
  }
  return [...principals];
}

/** C121.3: `true` when a causing principal lacks a scope of this step. */
export async function causeLacksScope(
  db: Db,
  run: WorkflowRunRow,
  organizationId: string,
  steps: readonly WorkflowRunStepRow[],
  scopes: readonly string[],
): Promise<boolean> {
  for (const principal of await causingPrincipals(db, run, steps)) {
    const held = await principalPermissions(db, run, organizationId, principal);
    if (scopes.some((scope) => !held.has(scope))) {
      return true;
    }
  }
  return false;
}
