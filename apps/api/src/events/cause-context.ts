/**
 * C121.3 (V04, V21): the request-scoped cause of an event. `stage()` reads it when no cause is
 * passed, so no call site changes. The auth plugin opens a store for every request and fills it in
 * once the principal is known; the step executor, the test-run executor and the bulk job each run
 * their own work under {@link runWithEventCause}. An end user's flow and a system job name no
 * principal, so their events have no cause, which is what C121.3 exempts.
 *
 * The cause is internal: it goes on the `events` row and never into a payload.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventCause } from '@openverify/db';
import type { Principal } from '../ports.js';

const context = new AsyncLocalStorage<EventCause>();

/** The cause of the current async context, or `undefined` when nothing set one. */
export function currentEventCause(): EventCause | undefined {
  return context.getStore();
}

/** Runs `run` with `cause` as the context's cause. */
export function runWithEventCause<Result>(cause: EventCause, run: () => Result): Result {
  return context.run(cause, run);
}

/** Fills the current request's store once its principal is known; outside a request, nothing. */
export function enterRequestEventCause(cause: EventCause): void {
  const store = context.getStore();
  if (store !== undefined) {
    Object.assign(store, cause);
  }
}

/** What a principal puts in the cause: who, and whether it held `inquiries:write` (C128.2). */
export function eventCauseOf(principal: Principal): EventCause {
  return {
    principal: principal.kind === 'user' ? principal.userId : principal.apiKeyId,
    principalHeldInquiriesWrite: principal.permissions.has('inquiries:write'),
  };
}
