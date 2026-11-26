/**
 * C211.3 (Workflow 10B): the flow session's `integrity` member. Owner: `api-integrity`; the hook in
 * `getFlowSession` (`services/flow.ts`, beside the theme's) was placed by `foundation-10b`
 * (Stage 1b (I)).
 *
 * `{ request: true }` when the SDK should take a challenge and post a token: the environment kind
 * binds a `deviceIntegrity` provider (an unbound provider means no request, C211.1), the session may
 * collect the session-integrity tier (`signals.integrity`, after consent), that consent showed
 * `notice.play-integrity` (C211.9, applied on every read: Workflow 10D review A001), and the inquiry
 * has no verdict yet (one request per inquiry, C211.3). The member is not appearance-only (C194.4).
 *
 * Built by `api-integrity`: left out (`null`) where the environment kind binds no provider, so an
 * off-by-default install serves the session unchanged; otherwise `{ request }` by
 * {@link integrityRequested}, the rule the challenge route applies too.
 */
import type { FlowSessionIntegrity, FlowSessionSignals } from '@openverify/contracts';
import type { EnvironmentKind } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import { integrityRequested, playIntegrityNoticeShown } from './challenges.js';

/** What the session read knows when it asks for the member. */
export interface IntegritySessionMemberInput {
  environmentId: string;
  environmentKind: EnvironmentKind;
  inquiryId: string;
  sessionId: string;
  /** The session's collection tiers, `null` until it may collect (C94.6). */
  signals: FlowSessionSignals | null;
  /** The text keys the consent the session relies on showed, `null` before consent (C211.9). */
  consentTextKeys: readonly string[] | null;
}

/** The session's `integrity` member, or `null` to leave it out. */
export async function integritySessionMember(
  deps: ApiDependencies,
  input: IntegritySessionMemberInput,
): Promise<FlowSessionIntegrity | null> {
  if (deps.providers[input.environmentKind].deviceIntegrity === undefined) {
    return null;
  }
  return {
    request: await integrityRequested(deps, {
      environmentId: input.environmentId,
      environmentKind: input.environmentKind,
      inquiryId: input.inquiryId,
      sessionIntegrity: input.signals?.integrity === true,
      playIntegrityNotice: playIntegrityNoticeShown(input.consentTextKeys),
    }),
  };
}
