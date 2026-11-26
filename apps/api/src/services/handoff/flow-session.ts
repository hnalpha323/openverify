/**
 * C96.3 (Workflow 7A; F01, F30, V05): the `handoff` and `handoff-context` members of
 * `GET /api/v1/flow/session`. Owner: `flow-handoff`; the signature is frozen by `foundation-7a`
 * (Stage 1b (H)).
 *
 * - `handoff`: `{ step-id, state }` of the flow's current `device_handoff` step (`steps.ts`), the
 *   state kept per inquiry and step (`inquiry_handoff_steps`), `pending` before any; `null` when the
 *   flow has none. A session with `mobile-sdk-name` set, or (with `skipOnMobile`) a parsed
 *   `smartphone` or `tablet` device type, reads `skipped` while the step is not done. `handed-off`
 *   is `true` for the issuing session while the phone's session is active (K7A-5).
 * - `handoff-context`: for a session a redemption created and the issuing session has not rejected,
 *   what its context screen shows (`organization-display-name` from the environment's settings,
 *   the remaining step types, when the flow started, the issuing session's country with the
 *   attribution of its source when network data placed it); `null` for every other session.
 */
import type { FlowHandoff, HandoffContext } from '@openverify/contracts';
import {
  getInquirySession,
  listInquiryHandoffSteps,
  type Db,
  type Environment,
  type Inquiry,
} from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type { FlowSession } from '../../auth/flow-session.js';
import { isSessionHandedOff } from './guard.js';
import { currentHandoffStep, handoffContextOf, servedHandoffState } from './steps.js';

export interface FlowSessionHandoffContext {
  db: Db;
  session: FlowSession;
  inquiry: Inquiry;
  /** The pinned flow. */
  flow: Flow;
  /** The time of the read: a phone session past its life no longer holds the desktop. */
  now: Date;
  environment: Pick<Environment, 'id' | 'kind' | 'settings' | 'organizationId'>;
}

export interface FlowSessionHandoff {
  handoff: FlowHandoff | null;
  handoffContext: HandoffContext | null;
}

export async function flowSessionHandoffOf(
  context: FlowSessionHandoffContext,
): Promise<FlowSessionHandoff> {
  const { db, session, inquiry, flow, environment, now } = context;
  const stored = await listInquiryHandoffSteps(db, session.environmentId, inquiry.id);
  const current = currentHandoffStep(flow, stored);
  const row = await getInquirySession(db, session.environmentId, session.id);
  if (current === null || row === null) {
    return { handoff: null, handoffContext: null };
  }
  const handoff: FlowHandoff = {
    'step-id': current.step.id,
    state: servedHandoffState(current, row),
    // K7A-5: a reloaded desktop stays on the step while the phone works.
    ...((await isSessionHandedOff(db, session, now)) ? { 'handed-off': true } : {}),
  };
  const fromSessionId = row.handoffFromSessionId;
  if (fromSessionId === null || row.handoffRejectedAt !== null) {
    return { handoff, handoffContext: null };
  }
  return {
    handoff,
    handoffContext: await handoffContextOf(db, {
      environment,
      flow,
      stepId: current.step.id,
      environmentId: session.environmentId,
      issuingSessionId: fromSessionId,
    }),
  };
}
