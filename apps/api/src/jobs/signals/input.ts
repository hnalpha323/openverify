/**
 * C150.9 (Workflow 9A Stage 1b (S)): the input of Phase 7's signal computation, moved unchanged out
 * of the `inquiry-signals` job (`process.ts`, Workflow 7A's `computeInTx`) so that the flow's
 * provisional snapshots (`jobs/flow/signal-snapshot.ts`, `api-flow-actions`) compute from the same
 * reading of the stored session facts, never a copy of it. It reads the version's step types, every
 * session with its network row and sealed signal bodies, the effective consent, and the country of
 * the latest decided government ID; it computes and writes nothing.
 */
import type { DeviceIntegrityProvider } from '../../ports.js';
import { deviceIntegritySignalsInput } from '../../services/device-integrity/signals-input.js';
import type {
  BehaviourInput,
  InquirySignalsInput,
  IntegrityInput,
  NetworkReasonInput,
  SignalBodyInput,
  SignalRequestHeaders,
  SignalSessionInput,
  SignalSourceRef,
} from '@openverify/checks';
import {
  getEffectiveConsent,
  getInquiryTemplateVersion,
  listInquirySessions,
  listInquiryVerifications,
  listSessionNetworks,
  listSessionSignalBodies,
  type ConsentRecord,
  type Db,
  type Inquiry,
  type InquirySession,
  type Network,
  type SessionSignalBody,
} from '@openverify/db';
import { storedFlowView } from '../../services/stored-flow.js';

/** What the computation needs beside the inquiry's stored facts. */
export interface InquirySignalsInputContext {
  environment: InquirySignalsInput['environment'];
  computedAt: Date;
  /**
   * C211.5 (Workflow 10B): the environment kind's bound `deviceIntegrity` provider (`null`: none
   * bound). When given, the input carries the inquiry's Play Integrity facts
   * (`deviceIntegritySignalsInput`); when left out, the two Play Integrity signals read
   * `collector_missing`.
   */
  deviceIntegrity?: DeviceIntegrityProvider | null | undefined;
}

/**
 * The input of `computeInquirySignals` for the inquiry, read in `tx` (the caller holds the
 * inquiry's lock), for the signals `collect` names.
 */
export async function inquirySignalsInputInTx(
  tx: Db,
  inquiry: Pick<Inquiry, 'id' | 'environmentId' | 'inquiryTemplateVersionId'>,
  collect: InquirySignalsInput['collect'],
  context: InquirySignalsInputContext,
): Promise<InquirySignalsInput> {
  const { environmentId, id: inquiryId } = inquiry;
  const version = await getInquiryTemplateVersion(
    tx,
    environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const stepTypes = new Map<string, string>(
    version === null ? [] : storedFlowView(version.flow).steps.map((step) => [step.id, step.type]),
  );
  const sessions = await sessionsOf(tx, environmentId, inquiryId);
  const sessionIds = sessions.map((session) => session.id);
  const networks = new Map(
    (await listSessionNetworks(tx, environmentId, sessionIds)).map((network) => [
      network.inquirySessionId,
      network,
    ]),
  );
  const bodies = new Map<string, SessionSignalBody[]>();
  for (const body of await listSessionSignalBodies(tx, environmentId, sessionIds)) {
    bodies.set(body.inquirySessionId, [...(bodies.get(body.inquirySessionId) ?? []), body]);
  }
  // The consent a session without its own inherits: never a rejected handoff session's (V03).
  const consent = await getEffectiveConsent(tx, { environmentId, inquiryId, sessionId: null });
  return {
    environment: context.environment,
    collect,
    computedAt: context.computedAt,
    sessions: sessions.map((session) =>
      sessionInput(session, {
        consent,
        network: networks.get(session.id) ?? null,
        bodies: bodies.get(session.id) ?? [],
        stepTypes,
      }),
    ),
    governmentIdCountry: await governmentIdCountryOf(tx, environmentId, inquiryId),
    ...(context.deviceIntegrity === undefined
      ? {}
      : {
          deviceIntegrity: await deviceIntegritySignalsInput(
            tx,
            { environmentId, id: inquiryId },
            context.deviceIntegrity,
          ),
        }),
  };
}

/** Every session of the inquiry, every page. */
async function sessionsOf(tx: Db, environmentId: string, inquiryId: string) {
  const sessions: InquirySession[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await listInquirySessions(tx, environmentId, { inquiryId, size: 100, after });
    sessions.push(...page.items);
    if (page.next === null) {
      return sessions;
    }
    after = page.next;
  }
}

/**
 * C90.4 (V07, V03): a session is consented when it recorded consent itself or, unless a handoff
 * created it, was created after the consent it inherits; a rejected handoff session never is (a
 * rejected phone's consent authorises nothing), and a handoff session relies only on its own.
 */
function consentedSession(session: InquirySession, consent: ConsentRecord | null): boolean {
  if (session.handoffRejectedAt !== null) {
    return false;
  }
  if (session.handoffFromSessionId !== null || session.consent !== null) {
    return session.consent !== null;
  }
  return consent !== null && session.createdAt.getTime() >= consent.acceptedAt.getTime();
}

function sessionInput(
  session: InquirySession,
  context: {
    consent: ConsentRecord | null;
    network: Network | null;
    bodies: readonly SessionSignalBody[];
    stepTypes: ReadonlyMap<string, string>;
  },
): SignalSessionInput {
  const { network } = context;
  return {
    id: session.id,
    createdAt: session.createdAt,
    consented: consentedSession(session, context.consent),
    signalsCollected: session.signalsCollected,
    userAgent: session.userAgent,
    network:
      session.networkEvaluatedAt === null
        ? null
        : {
            isTor: session.isTor,
            isDatacenter: session.isDatacenter === true ? true : null,
            isVpn: session.isVpn === true ? true : null,
            isProxy: session.isProxy,
            hostingAsn: session.hostingAsn === true ? true : null,
            privacyRelay: network?.privacyRelay ?? null,
            countryCode: session.countryCode,
            latitude: session.location?.latitude ?? null,
            longitude: session.location?.longitude ?? null,
            asn: network?.asn ?? null,
            reasons: (network?.reasons ?? []) as readonly NetworkReasonInput[],
            sources: (network?.sources ?? []) as unknown as readonly SignalSourceRef[],
          },
    bodies: context.bodies.map((body) => bodyInput(body, context.stepTypes)),
    handoffFromSessionId: session.handoffFromSessionId,
  };
}

/** The sealed `components` of a body, as `POST /flow/signals` keeps them (C94.2, V13). */
interface StoredComponents {
  integrity?: IntegrityInput;
  'android-integrity'?: SignalBodyInput['androidIntegrity'];
  'device-class'?: 'smartphone' | 'tablet';
  'sandbox-outcome'?: 'bot' | 'human';
  request?: SignalRequestHeaders;
}

/** A stored body as the signal logic reads it (C94.2). */
function bodyInput(
  body: SessionSignalBody,
  stepTypes: ReadonlyMap<string, string>,
): SignalBodyInput {
  // The members were validated by `flowSignalsSchema` before they were sealed (C94.2).
  const components = (body.components ?? {}) as StoredComponents;
  return {
    screen: body.screen,
    screenType: stepTypes.get(body.screen) ?? null,
    sequence: body.sequence,
    platform: body.platform,
    integrity: components.integrity ?? null,
    behaviour: body.behaviour as BehaviourInput | null,
    androidIntegrity: components['android-integrity'] ?? null,
    deviceClass: components['device-class'] ?? null,
    sandboxOutcome: components['sandbox-outcome'] ?? null,
    requestHeaders: components.request ?? null,
  };
}

/**
 * C90.2: the issuing country of the latest government ID verification decided `passed` or
 * `needs_review`, never one from a rejected handoff (C96.3); `null` without one.
 */
async function governmentIdCountryOf(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<string | null> {
  const decided = (await listInquiryVerifications(tx, environmentId, inquiryId)).filter(
    (verification) =>
      verification.type === 'government_id' &&
      (verification.status === 'passed' || verification.status === 'needs_review') &&
      !verification.fromRejectedHandoff,
  );
  return decided.at(-1)?.country ?? null;
}
