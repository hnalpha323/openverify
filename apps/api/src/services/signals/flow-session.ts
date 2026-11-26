/**
 * C94.6 (Workflow 7A; P14): the `signals` member of `GET /api/v1/flow/session`: the collection
 * tiers of the session (`{ integrity, recognition }`), or `null` until it may collect, so the
 * collector instantiates nothing before then. Owner: `api-signals`; the signature is frozen by
 * `foundation-7a` (Stage 1b (S)).
 *
 * The tiers (C90.8, C94.6), decided by {@link collectionTiersOf} for this route and for
 * `POST /flow/signals` alike:
 * - **none** before the session consented (the consent the session may rely on);
 * - **session integrity** when the environment's `session-integrity` is `on` and the consent
 *   showed the required notice key `notice.session-integrity`;
 * - **device recognition**: in `consent` mode when the session ticked the optional key
 *   `consent.device-recognition`; in `exempt` mode when the consent showed the required notice
 *   key `notice.device-recognition` and the step does not offer the optional tick (a declined
 *   tick is never overridden); never in `off` mode.
 *
 * Reporting the tiers records them on the session (`signals-collected`), so the signals job can
 * tell a consented session that sent nothing (`collector_missing`) from one whose tier did not
 * apply (`collection_disabled`).
 */
import {
  DEVICE_RECOGNITION_CONSENT_TEXT_KEY,
  DEVICE_RECOGNITION_NOTICE_TEXT_KEY,
  SESSION_INTEGRITY_NOTICE_TEXT_KEY,
  type FlowSessionSignals,
} from '@openverify/contracts';
import {
  nextSessionSignalSequence,
  recordSessionSignalsCollected,
  resolveSignalSettings,
  type Db,
  type Environment,
  type Inquiry,
} from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type { FlowSession } from '../../auth/flow-session.js';

/** The consent the session may rely on, `null` before it. */
export interface CollectionConsent {
  acceptedAt: Date;
  /** The consent texts shown (the step's required keys). */
  textKeys: readonly string[];
  /** The optional texts ticked. */
  optionalTextKeys: readonly string[];
}

export interface FlowSessionSignalsContext {
  db: Db;
  session: FlowSession;
  inquiry: Inquiry;
  /** The pinned flow, whose consent step lists the notice and consent keys. */
  flow: Flow;
  environment: Pick<Environment, 'id' | 'kind' | 'settings'>;
  /** The consent the session may rely on, `null` before it. */
  consent: CollectionConsent | null;
}

/** C94.6: the tiers that apply to a session with `consent`, or `null` before consent. */
export function collectionTiersOf(
  settings: Environment['settings'],
  flow: Flow,
  consent: CollectionConsent | null,
): FlowSessionSignals | null {
  if (consent === null) {
    return null;
  }
  const collection = resolveSignalSettings(settings)['signal-collection'];
  const shown = new Set(consent.textKeys);
  const offered = flow.steps.flatMap((step) =>
    step.type === 'consent' ? (step.optionalTextKeys ?? []) : [],
  );
  const mode = collection['device-recognition'];
  return {
    integrity:
      collection['session-integrity'] === 'on' && shown.has(SESSION_INTEGRITY_NOTICE_TEXT_KEY),
    recognition:
      mode === 'consent'
        ? consent.optionalTextKeys.includes(DEVICE_RECOGNITION_CONSENT_TEXT_KEY)
        : mode === 'exempt' &&
          shown.has(DEVICE_RECOGNITION_NOTICE_TEXT_KEY) &&
          !offered.includes(DEVICE_RECOGNITION_CONSENT_TEXT_KEY),
  };
}

/** The `signals-collected` names of `tiers`. */
export function collectedTiersOf(
  tiers: FlowSessionSignals,
): ('session-integrity' | 'device-recognition')[] {
  return [
    ...(tiers.integrity ? (['session-integrity'] as const) : []),
    ...(tiers.recognition ? (['device-recognition'] as const) : []),
  ];
}

/** The session's tiers, recorded on the session once it may collect. */
export async function flowSessionSignalsOf(
  ctx: FlowSessionSignalsContext,
): Promise<FlowSessionSignals | null> {
  const tiers = collectionTiersOf(ctx.environment.settings, ctx.flow, ctx.consent);
  if (tiers !== null) {
    await recordSessionSignalsCollected(
      ctx.db,
      ctx.environment.id,
      ctx.session.id,
      collectedTiersOf(tiers),
    );
    return {
      ...tiers,
      'next-sequence': await nextSessionSignalSequence(ctx.db, ctx.environment.id, ctx.session.id),
    };
  }
  return tiers;
}
