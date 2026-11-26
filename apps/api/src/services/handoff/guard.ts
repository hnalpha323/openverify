/**
 * C96.3 (Workflow 7A; F13): one capturing device at a time. While a session a redemption created
 * from this one is active, every non-GET flow route of this (issuing) session is refused with 409
 * `session_handed_off`, except the handoff routes; `assertSessionNotHandedOff`
 * (`auth/flow-session.ts`) asks {@link isSessionHandedOff} on each such request. Owner:
 * `flow-handoff`; the signature is frozen by `foundation-7a` (Stage 1b (H)).
 *
 * A phone session that ended (canceled, expired, past its TTL) or that the desktop rejected no
 * longer holds the desktop; the index `inquiry_sessions_handoff_from_session_id_idx` serves the read.
 */
import { findActiveHandoffSession, type Db } from '@openverify/db';
import type { FlowSession } from '../../auth/flow-session.js';

/** Whether `session` handed off to a redeemed session that is still active at `now`. */
export async function isSessionHandedOff(
  db: Db,
  session: FlowSession,
  now: Date,
): Promise<boolean> {
  return (await findActiveHandoffSession(db, session.environmentId, session.id, now)) !== null;
}
